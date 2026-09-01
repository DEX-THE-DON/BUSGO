import type { FastifyInstance } from 'fastify';
import { BookingRequestSchema, type BookingRequest } from '@busgo/types';
import { authenticate } from '../auth.js';
import { HttpError } from '../http-error.js';
import { validateBody, parseId } from '../util.js';
import { notifyChainChange, recomputeChain, tripStopNames } from '../chains.js';
import { manager } from '../ws.js';

export function registerBookingsRoutes(app: FastifyInstance): void {
  app.post(
    '/api/book-seat',
    { preValidation: validateBody(BookingRequestSchema), preHandler: [authenticate] },
    async (request) => {
      const body = request.body as BookingRequest;
      const db = request.db;
      const user = request.user!;

      let bookingId: number;
      let paymentId: number;
      try {
        const booking = await db.first(
          `INSERT INTO bookings (trip_id, user_id, seat_number, board_stop_order, alight_stop_order, status, payment_status)
           VALUES (:trip_id, :user_id, :seat_number, :board_order, :alight_order, 'pending', 'unpaid')
           RETURNING id;`,
          {
            trip_id: body.trip_id,
            user_id: user.id,
            seat_number: body.seat_number,
            board_order: body.board_stop_order,
            alight_order: body.alight_stop_order,
          },
        );
        bookingId = booking!.id as number;

        const payment = await db.first(
          `INSERT INTO payments (booking_id, provider, provider_payload, amount, status)
           VALUES (:booking_id, 'mpesa_sim', NULL, 500.00, 'initiated')
           RETURNING id;`,
          { booking_id: bookingId },
        );
        paymentId = payment!.id as number;

        await db.commit();
      } catch (e) {
        await db.rollback();
        const msg = String((e as { message?: unknown })?.message ?? e);
        if (msg.includes('Seat conflict')) {
          throw new HttpError(400, 'Seat is already occupied for this specific route segment.');
        }
        throw new HttpError(500, msg);
      }

      // Notify listeners about the pending booking.
      await manager.broadcastTrip(body.trip_id, {
        event: 'booking_pending',
        trip_id: body.trip_id,
        seat_number: body.seat_number,
        booking_id: bookingId,
        board_stop_order: body.board_stop_order,
        alight_stop_order: body.alight_stop_order,
      });

      // Recompute the seat chain and fire relay/waitlist notifications.
      const stopNames = await tripStopNames(db, body.trip_id);
      const chain = await recomputeChain(db, body.trip_id, body.seat_number);
      await notifyChainChange(db, manager, body.trip_id, body.seat_number, chain, stopNames);

      return {
        status: 'pending',
        booking_id: bookingId,
        payment_id: paymentId,
        message: 'Booking created and awaiting payment.',
      };
    },
  );

  app.delete('/api/bookings/:booking_id', { preHandler: [authenticate] }, async (request) => {
    const bookingId = parseId((request.params as { booking_id?: string }).booking_id);
    const db = request.db;
    const user = request.user!;

    const booking = await db.first(
      'SELECT id, trip_id, seat_number, user_id FROM bookings WHERE id = :id;',
      { id: bookingId },
    );
    if (!booking) throw new HttpError(404, 'Booking not found.');
    if (booking.user_id !== user.id && !['admin', 'driver'].includes(user.role)) {
      throw new HttpError(403, 'You can only cancel your own booking.');
    }

    await db.execute("UPDATE bookings SET status = 'cancelled' WHERE id = :id;", { id: bookingId });
    await db.commit();

    // The seat just freed up — recompute the chain and let waitlists know.
    const tripId = booking.trip_id as number;
    const seatNumber = booking.seat_number as number;
    const stopNames = await tripStopNames(db, tripId);
    const chain = await recomputeChain(db, tripId, seatNumber);
    await notifyChainChange(db, manager, tripId, seatNumber, chain, stopNames);
    await manager.broadcastTrip(tripId, {
      event: 'booking_cancelled',
      trip_id: tripId,
      seat_number: seatNumber,
      booking_id: bookingId,
    });

    return { deleted: bookingId, seat_freed: true };
  });

  app.get('/api/user/bookings', { preHandler: [authenticate] }, async (request) => {
    const user = request.user!;
    const rows = await request.db.all(
      `SELECT b.id, b.trip_id, b.seat_number, b.board_stop_order, b.alight_stop_order,
              b.status, b.payment_status, b.created_at,
              t.name AS trip_name, t.status AS trip_status,
              r.name AS route_name,
              (SELECT stop_name FROM route_stops
                WHERE route_id = t.route_id AND stop_order = b.board_stop_order) AS board_stop,
              (SELECT stop_name FROM route_stops
                WHERE route_id = t.route_id AND stop_order = b.alight_stop_order) AS alight_stop
       FROM bookings b
       JOIN trips t ON t.id = b.trip_id
       JOIN routes r ON r.id = t.route_id
       WHERE b.user_id = :uid
       ORDER BY b.created_at DESC, b.id DESC;`,
      { uid: user.id },
    );
    return { bookings: rows };
  });
}
