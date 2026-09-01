/**
 * Seat-chain engine — a direct port of backend/chains.py.
 *
 * Every physical seat on a trip is modelled as a *chain* of segment bookings
 * (seat 7: A→B 🔗 B→C 🔗 C→D). The chain is recomputed whenever a booking is
 * created, cancelled, or paid, and drives the relay notifications:
 *
 *   - *handoff*: the passenger boarding at the same stop where the previous
 *     passenger alights is told their seat is (or will be) ready.
 *   - *freed gap*: any segment between two chain links with no occupant is
 *     offered to matching waitlisted users.
 */
import type { ConnectionManager } from './ws.js';
import type { Db, Row } from './db.js';

export function utcnow(): Date {
  return new Date();
}

export async function getChainRows(db: Db, tripId: number, seatNumber: number): Promise<Row[]> {
  return db.all(
    `SELECT b.id AS booking_id, b.board_stop_order, b.alight_stop_order,
            b.user_id, b.status, b.payment_status,
            u.full_name AS passenger_name,
            (SELECT stop_name FROM route_stops
              WHERE route_id = r.id AND stop_order = b.board_stop_order) AS board_stop,
            (SELECT stop_name FROM route_stops
              WHERE route_id = r.id AND stop_order = b.alight_stop_order) AS alight_stop
     FROM bookings b
     JOIN trips t ON t.id = b.trip_id
     JOIN routes r ON r.id = t.route_id
     LEFT JOIN users u ON u.id = b.user_id
     WHERE b.trip_id = :trip_id AND b.seat_number = :seat_number
       AND b.status != 'cancelled'
     ORDER BY b.board_stop_order ASC, b.id ASC;`,
    { trip_id: tripId, seat_number: seatNumber },
  );
}

/**
 * Replace the stored chain for (trip, seat) with the current bookings.
 * Returns the ordered chain rows so callers can drive notifications without
 * an extra query.
 */
export async function recomputeChain(db: Db, tripId: number, seatNumber: number): Promise<Row[]> {
  const chainRows = await getChainRows(db, tripId, seatNumber);

  const chainId = await db.scalarOne(
    `INSERT INTO seat_chains (trip_id, seat_number, created_at)
     VALUES (:trip_id, :seat_number, now())
     ON CONFLICT (trip_id, seat_number)
     DO UPDATE SET seat_number = EXCLUDED.seat_number
     RETURNING id;`,
    { trip_id: tripId, seat_number: seatNumber },
  );

  await db.execute('DELETE FROM seat_chain_links WHERE chain_id = :chain_id;', { chain_id: chainId });
  for (const [position, row] of chainRows.entries()) {
    await db.execute(
      `INSERT INTO seat_chain_links (chain_id, booking_id, position, board_stop_order, alight_stop_order)
       VALUES (:chain_id, :booking_id, :position, :board, :alight);`,
      {
        chain_id: chainId,
        booking_id: row.booking_id,
        position: position + 1,
        board: row.board_stop_order,
        alight: row.alight_stop_order,
      },
    );
  }
  return chainRows;
}

export async function createNotification(
  db: Db,
  userId: number,
  kind: string,
  title: string,
  body: string,
  payload: Record<string, unknown> | null = null,
): Promise<Row> {
  const row = await db.first(
    `INSERT INTO notifications (user_id, kind, title, body, payload, read, created_at)
     VALUES (:user_id, :kind, :title, :body, CAST(:payload AS jsonb), false, now())
     RETURNING id, user_id, kind, title, body, payload, read, created_at;`,
    { user_id: userId, kind, title, body, payload },
  );
  return row ?? {};
}

export async function pushUserNotification(
  db: Db,
  manager: ConnectionManager,
  userId: number,
  kind: string,
  title: string,
  body: string,
  payload: Record<string, unknown> | null = null,
): Promise<void> {
  if (userId === undefined || userId === null) return;
  const notif = await createNotification(db, userId, kind, title, body, payload);
  await db.commit();
  await manager.sendToUser(userId, { event: 'notification', notification: notif });
}

/**
 * Emit relay notifications for the (recomputed) chain of one seat.
 *  - Handoffs:  passenger Pn boards at the exact stop Pn-1 alights.
 *  - Freed gaps: a segment with no occupant becomes available for waitlists.
 */
export async function notifyChainChange(
  db: Db,
  manager: ConnectionManager,
  tripId: number,
  seatNumber: number,
  chainRows: Row[],
  stopNames: Record<number, string>,
): Promise<void> {
  if (!chainRows.length) return;

  const stopName = (order: number) => stopNames[order] ?? `Stop ${order}`;

  // 1) Adjacent handoffs -> notify the boarding passenger.
  for (let i = 0; i < chainRows.length - 1; i++) {
    const prev = chainRows[i]!;
    const nxt = chainRows[i + 1]!;
    if (nxt.board_stop_order === prev.alight_stop_order && nxt.user_id) {
      await pushUserNotification(
        db,
        manager,
        nxt.user_id as number,
        'seat_freed',
        `Seat #${seatNumber} is ready for you`,
        `The passenger ahead alights at ${stopName(prev.alight_stop_order as number)} — ` +
          `board here for seat #${seatNumber} (booking #${nxt.booking_id}).`,
        {
          trip_id: tripId,
          seat_number: seatNumber,
          stop_order: prev.alight_stop_order,
          booking_id: nxt.booking_id,
        },
      );
    }
  }

  // 2) Freed gaps between links -> offer to waitlisted users.
  for (let i = 0; i < chainRows.length - 1; i++) {
    const prev = chainRows[i]!;
    const nxt = chainRows[i + 1]!;
    const gapBoard = prev.alight_stop_order as number;
    const gapAlight = nxt.board_stop_order as number;
    if (gapAlight > gapBoard) {
      await offerGap(db, manager, tripId, seatNumber, gapBoard, gapAlight, stopName);
    }
  }

  // 3) Open tail after the last link -> waitlists on that segment.
  const last = chainRows[chainRows.length - 1]!;
  const orders = Object.keys(stopNames).map(Number);
  const maxOrder = orders.length ? Math.max(...orders) : (last.alight_stop_order as number);
  if ((last.alight_stop_order as number) < maxOrder) {
    await offerGap(db, manager, tripId, seatNumber, last.alight_stop_order as number, maxOrder, stopName);
  }
}

/** Notify active waitlist entries whose requested segment fits a free gap. */
export async function offerGap(
  db: Db,
  manager: ConnectionManager,
  tripId: number,
  seatNumber: number,
  gapBoard: number,
  gapAlight: number,
  stopName: (order: number) => string,
): Promise<void> {
  const interests = await db.all(
    `SELECT si.id, si.user_id, si.board_stop_order, si.alight_stop_order, si.seat_number
     FROM seat_interests si
     WHERE si.trip_id = :trip_id AND si.status = 'active'
       AND si.board_stop_order >= :gap_board AND si.alight_stop_order <= :gap_alight
       AND (si.seat_number IS NULL OR si.seat_number = :seat_number);`,
    {
      trip_id: tripId,
      gap_board: gapBoard,
      gap_alight: gapAlight,
      seat_number: seatNumber,
    },
  );

  for (const interest of interests) {
    await pushUserNotification(
      db,
      manager,
      interest.user_id as number,
      'seat_freed',
      `Seat #${seatNumber} just freed up`,
      `A seat on this trip is now free for ` +
        `${stopName(interest.board_stop_order as number)} → ${stopName(interest.alight_stop_order as number)}. Book it now!`,
      {
        trip_id: tripId,
        seat_number: seatNumber,
        board_stop_order: interest.board_stop_order,
        alight_stop_order: interest.alight_stop_order,
      },
    );
    // One notification per interest per offer, then park it so we don't spam.
    await db.execute("UPDATE seat_interests SET status = 'notified' WHERE id = :id;", { id: interest.id });
  }
  if (interests.length) await db.commit();
}

export async function tripStopNames(db: Db, tripId: number): Promise<Record<number, string>> {
  const rows = await db.all(
    `SELECT rs.stop_order, rs.stop_name
     FROM trips t JOIN route_stops rs ON t.route_id = rs.route_id
     WHERE t.id = :trip_id
     ORDER BY rs.stop_order ASC;`,
    { trip_id: tripId },
  );
  const out: Record<number, string> = {};
  for (const r of rows) out[r.stop_order as number] = r.stop_name as string;
  return out;
}

/**
 * Driver called "bus is at stop X" -> release seats whose passenger alights.
 * Returns the number of released (non-cancelled) bookings.
 */
export async function notifySeatReleasedAtStop(
  db: Db,
  manager: ConnectionManager,
  tripId: number,
  stopOrder: number,
): Promise<number> {
  const released = await db.all(
    `SELECT b.id, b.seat_number, b.user_id
     FROM bookings b
     WHERE b.trip_id = :trip_id AND b.alight_stop_order = :stop_order
       AND b.status NOT IN ('cancelled');`,
    { trip_id: tripId, stop_order: stopOrder },
  );

  const stopNames = await tripStopNames(db, tripId);
  for (const row of released) {
    await manager.broadcastTrip(tripId, {
      event: 'seat_freed',
      trip_id: tripId,
      seat_number: row.seat_number,
      stop_order: stopOrder,
      stop_name: stopNames[stopOrder] ?? null,
    });
  }

  // Recompute chains for every released seat and notify waitlists/handoffs.
  for (const row of released) {
    const seatNumber = row.seat_number as number;
    const chain = await recomputeChain(db, tripId, seatNumber);
    await notifyChainChange(db, manager, tripId, seatNumber, chain, stopNames);
  }

  if (released.length) await db.commit();
  return released.length;
}

