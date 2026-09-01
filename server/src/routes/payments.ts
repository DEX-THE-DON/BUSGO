import type { FastifyInstance } from 'fastify';
import {
  DarajaStkRequestSchema,
  PaymentRequestSchema,
  type DarajaStkRequest,
  type PaymentRequest,
} from '@busgo/types';
import { authenticate } from '../auth.js';
import * as daraja from '../daraja.js';
import { HttpError } from '../http-error.js';
import { validateBody, parseId } from '../util.js';
import {
  createNotification,
  notifyChainChange,
  recomputeChain,
  tripStopNames,
} from '../chains.js';
import { manager } from '../ws.js';
import type { Row } from '../db.js';

export function registerPaymentsRoutes(app: FastifyInstance): void {
  app.post(
    '/api/pay/mpesa-stk',
    { preValidation: validateBody(PaymentRequestSchema), preHandler: [authenticate] },
    async (request) => {
      const payment = request.body as PaymentRequest;
      const db = request.db;
      const user = request.user!;

      let paymentId = 0;
      let bookingRow: Row | undefined;
      let bookingRowFull: Row | undefined;

      try {
        // Ensure the booking the payment refers to actually exists, so a stray
        // booking_id can never be silently marked as paid.
        bookingRowFull = await db.first('SELECT id, user_id FROM bookings WHERE id = :booking_id;', {
          booking_id: payment.booking_id,
        });
        if (!bookingRowFull) {
          throw new HttpError(404, `Booking ${payment.booking_id} does not exist.`);
        }
        // Only the passenger who owns the booking (or an admin) may pay for it.
        if (bookingRowFull.user_id !== user.id && user.role !== 'admin') {
          throw new HttpError(403, 'You can only pay for your own booking.');
        }

        const pRow = await db.first(
          'SELECT id, status FROM payments WHERE booking_id = :booking_id LIMIT 1;',
          { booking_id: payment.booking_id },
        );
        const payload = JSON.stringify({ phone: payment.phone_number, simulated: true });

        if (pRow) {
          const existingId = pRow.id as number;
          await db.execute(
            `UPDATE payments
             SET status = 'completed', provider = 'mpesa_sim', provider_payload = CAST(:payload AS jsonb),
                 provider_reference = :ref, phone_number = :phone, callback_verified = true
             WHERE id = :id;`,
            {
              payload,
              ref: `SIM-${payment.booking_id}`,
              phone: payment.phone_number,
              id: existingId,
            },
          );
          paymentId = existingId;
        } else {
          const inserted = await db.first(
            `INSERT INTO payments (booking_id, provider, provider_payload, amount, status, provider_reference, phone_number, callback_verified)
             VALUES (:booking_id, 'mpesa_sim', CAST(:payload AS jsonb), :amount, 'completed', :ref, :phone, true)
             RETURNING id;`,
            {
              booking_id: payment.booking_id,
              payload,
              amount: payment.amount,
              ref: `SIM-${payment.booking_id}`,
              phone: payment.phone_number,
            },
          );
          paymentId = inserted!.id as number;
        }

        bookingRow = await db.first(
          `UPDATE bookings SET payment_status = 'paid', status = 'confirmed'
           WHERE id = :id
           RETURNING trip_id, seat_number, board_stop_order, alight_stop_order;`,
          { id: payment.booking_id },
        );
        await db.commit();
      } catch (e) {
        if (e instanceof HttpError) throw e;
        await db.rollback();
        throw new HttpError(500, String((e as { message?: unknown })?.message ?? e));
      }

      // Broadcast seat_booked so UIs and drivers know the seat is now taken.
      if (bookingRow) {
        const tripId = bookingRow.trip_id as number;
        const seatNumber = bookingRow.seat_number as number;
        await manager.broadcastTrip(tripId, {
          event: 'seat_booked',
          trip_id: tripId,
          seat_number: seatNumber,
          board_stop_order: bookingRow.board_stop_order,
          alight_stop_order: bookingRow.alight_stop_order,
          booking_id: payment.booking_id,
        });

        // Recompute chain + relay notifications now that the booking is confirmed.
        const stopNames = await tripStopNames(db, tripId);
        const chain = await recomputeChain(db, tripId, seatNumber);
        await notifyChainChange(db, manager, tripId, seatNumber, chain, stopNames);

        // Confirm notification for the passenger.
        await createNotification(
          db,
          bookingRowFull!.user_id as number,
          'booking_confirmed',
          `Seat #${seatNumber} confirmed`,
          `Payment received. Your seat #${seatNumber} is confirmed on trip #${tripId}.`,
          { trip_id: tripId, seat_number: seatNumber, booking_id: payment.booking_id },
        );
        await db.commit();
        await manager.sendToUser(bookingRowFull!.user_id as number, {
          event: 'booking_confirmed',
          trip_id: tripId,
          seat_number: seatNumber,
          booking_id: payment.booking_id,
        });
      }

      return {
        status: 'success',
        message: `M-Pesa STK push simulated and payment recorded for booking ${payment.booking_id}`,
        payment_id: paymentId,
        booking_id: payment.booking_id,
      };
    },
  );

  // ------------------------------------------------------------------
  // Real M-Pesa Daraja STK push (used when MPESA_* env vars are configured)
  // ------------------------------------------------------------------
  app.post(
    '/api/pay/daraja/stk',
    { preValidation: validateBody(DarajaStkRequestSchema), preHandler: [authenticate] },
    async (request) => {
      const payload = request.body as DarajaStkRequest;
      const db = request.db;
      const user = request.user!;

      if (!daraja.configured()) {
        throw new HttpError(
          400,
          'Daraja is not configured. Set MPESA_CONSUMER_KEY, MPESA_CONSUMER_SECRET and MPESA_PASSKEY (see .env.example), or use POST /api/pay/mpesa-stk for the simulator.',
        );
      }

      const booking = await db.first('SELECT id, user_id FROM bookings WHERE id = :id;', {
        id: payload.booking_id,
      });
      if (!booking) throw new HttpError(404, `Booking ${payload.booking_id} does not exist.`);
      if (booking.user_id !== user.id && user.role !== 'admin') {
        throw new HttpError(403, 'You can only pay for your own booking.');
      }

      let resp: Record<string, unknown>;
      try {
        resp = await daraja.stkPush(
          payload.phone_number,
          payload.amount,
          `BUSGO-${payload.booking_id}`,
        );
      } catch (e) {
        if (e instanceof daraja.DarajaValidationError) {
          throw new HttpError(400, e.message);
        }
        throw new HttpError(502, `Daraja request failed: ${e}`);
      }

      const checkoutId = resp.CheckoutRequestID;
      if (!checkoutId) throw new HttpError(502, `Daraja rejected the STK push: ${JSON.stringify(resp)}`);

      // Record the pending payment linked to the provider reference.
      await db.execute(
        `UPDATE payments
         SET provider = 'mpesa_daraja', status = 'initiated',
             provider_reference = :ref, phone_number = :phone,
             provider_payload = CAST(:payload AS jsonb)
         WHERE booking_id = :booking_id;`,
        { ref: checkoutId, phone: payload.phone_number, payload: resp, booking_id: payload.booking_id },
      );
      await db.commit();

      return {
        status: 'initiated',
        message: 'STK push sent — enter your M-Pesa PIN to approve.',
        provider: 'mpesa_daraja',
        checkout_request_id: checkoutId,
        booking_id: payload.booking_id,
      };
    },
  );

  // ------------------------------------------------------------------
  // Safaricom webhook: verify + apply the STK push result idempotently
  // ------------------------------------------------------------------
  app.post('/api/pay/daraja/callback', async (request) => {
    const body = request.body as Record<string, unknown>;
    const db = request.db;

    const parsed = daraja.parseCallback(body);
    if (!parsed) throw new HttpError(400, 'Malformed Daraja callback.');

    const checkoutId = parsed.checkout_request_id;
    const pRow = await db.first(
      'SELECT id, booking_id FROM payments WHERE provider_reference = :ref LIMIT 1;',
      { ref: checkoutId },
    );
    if (!pRow) {
      // Unknown/duplicate callback — still acknowledge (Daraja retries).
      return { ResultCode: 0, ResultDesc: 'Accepted' };
    }

    const paymentId = pRow.id as number;
    const success = parsed.result_code === 0;
    const newStatus = success ? 'completed' : 'failed';

    await db.execute(
      `UPDATE payments
       SET status = :status, callback_payload = CAST(:cb AS jsonb), callback_verified = true
       WHERE id = :id;`,
      { status: newStatus, cb: body, id: paymentId },
    );

    let bookingRow: Row | undefined;
    if (success) {
      bookingRow = await db.first(
        `UPDATE bookings SET payment_status = 'paid', status = 'confirmed'
         WHERE id = :id
         RETURNING id, trip_id, seat_number, board_stop_order, alight_stop_order, user_id;`,
        { id: pRow.booking_id },
      );
    } else {
      // Failed payment -> release the pending booking so the seat frees up.
      await db.execute(
        "UPDATE bookings SET status = 'cancelled', payment_status = 'unpaid' WHERE id = :id;",
        { id: pRow.booking_id },
      );
    }
    await db.commit();

    if (bookingRow) {
      const tripId = bookingRow.trip_id as number;
      const seatNumber = bookingRow.seat_number as number;
      await manager.broadcastTrip(tripId, {
        event: 'seat_booked',
        trip_id: tripId,
        seat_number: seatNumber,
        board_stop_order: bookingRow.board_stop_order,
        alight_stop_order: bookingRow.alight_stop_order,
        booking_id: bookingRow.id,
      });
      const stopNames = await tripStopNames(db, tripId);
      const chain = await recomputeChain(db, tripId, seatNumber);
      await notifyChainChange(db, manager, tripId, seatNumber, chain, stopNames);
      await createNotification(
        db,
        bookingRow.user_id as number,
        'payment_update',
        'Payment received',
        `M-Pesa confirmed for seat #${seatNumber} on trip #${tripId}.`,
        { trip_id: tripId, seat_number: seatNumber },
      );
      await db.commit();
    }

    return { ResultCode: 0, ResultDesc: 'Accepted' };
  });
}

