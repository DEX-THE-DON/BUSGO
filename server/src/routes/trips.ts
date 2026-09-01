import type { FastifyInstance } from 'fastify';
import { HttpError } from '../http-error.js';
import { parseId, toNum } from '../util.js';
import type { Row } from '../db.js';

interface Interval {
  board_stop_order: number;
  alight_stop_order: number;
}

/**
 * Merge overlapping [board, alight) intervals over the requested segment and
 * classify a seat as 'full' (covered continuously) or 'partial' (frees at a
 * later stop). A direct port of the Python `classify` helper.
 */
function classify(
  intervals: Interval[],
  boardOrder: number,
  alightOrder: number,
): { state: 'partial' | 'full'; freeAt: { stop_order: number; stop: string | null } | null } {
  const merged: Array<[number, number]> = [];
  const sorted = [...intervals].sort(
    (a, b) => a.board_stop_order - b.board_stop_order || a.alight_stop_order - b.alight_stop_order,
  );
  for (const iv of sorted) {
    const b = iv.board_stop_order;
    const a = iv.alight_stop_order;
    if (merged.length && b <= merged[merged.length - 1]![1]) {
      merged[merged.length - 1]![1] = Math.max(merged[merged.length - 1]![1], a);
    } else {
      merged.push([b, a]);
    }
  }

  if (merged[0]![0] > boardOrder) return { state: 'partial', freeAt: { stop_order: boardOrder, stop: null } };
  let cursor = merged[0]![1];
  for (let i = 1; i < merged.length; i++) {
    const [b, a] = merged[i]!;
    if (b > cursor) return { state: 'partial', freeAt: { stop_order: cursor, stop: null } };
    cursor = Math.max(cursor, a);
  }
  if (cursor < alightOrder) return { state: 'partial', freeAt: { stop_order: cursor, stop: null } };
  return { state: 'full', freeAt: null };
}


export function registerTripsRoutes(app: FastifyInstance): void {
  app.get('/api/trips', async (request) => {
    const rows = await request.db.all(`
        SELECT t.id, t.name, t.status, t.scheduled_at, t.current_stop_order,
               r.id AS route_id, r.name AS route_name, r.route_type,
               v.id AS vehicle_id, v.plate_number, v.is_electric,
               vt.seat_capacity, vt.slug AS vehicle_type, vt.seat_layout
        FROM trips t
        JOIN routes r ON r.id = t.route_id
        LEFT JOIN vehicles v ON v.id = t.vehicle_id
        LEFT JOIN vehicle_types vt ON vt.id = v.vehicle_type_id
        WHERE t.status != 'cancelled'
        ORDER BY t.id ASC;
    `);
    return { trips: rows };
  });

  app.get('/api/trips/:trip_id/stops', async (request) => {
    const tripId = parseId((request.params as { trip_id?: string }).trip_id);
    const rows = await request.db.all(
      `SELECT rs.id, rs.stop_name, rs.stop_order
       FROM trips t
       JOIN route_stops rs ON t.route_id = rs.route_id
       WHERE t.id = :trip_id
       ORDER BY rs.stop_order ASC;`,
      { trip_id: tripId },
    );
    return { trip_id: tripId, stops: rows };
  });

  app.get('/api/trips/:trip_id/booked-seats', async (request) => {
    const tripId = parseId((request.params as { trip_id?: string }).trip_id);
    const query = request.query as { board_order?: string; alight_order?: string };
    const boardOrder = Number(query.board_order ?? '1');
    const alightOrder = Number(query.alight_order ?? '2');
    const rows = await request.db.all(
      `SELECT DISTINCT seat_number FROM bookings
       WHERE trip_id = :trip_id
         AND NOT (alight_stop_order <= :board_order OR board_stop_order >= :alight_order);`,
      { trip_id: tripId, board_order: boardOrder, alight_order: alightOrder },
    );
    const booked = rows.map((r) => r.seat_number);
    return { trip_id: tripId, booked_seats: booked };
  });

  app.get('/api/trips/:trip_id/chains', async (request) => {
    const tripId = parseId((request.params as { trip_id?: string }).trip_id);
    const db = request.db;

    const capacity = await db.value(
      `SELECT vt.seat_capacity
       FROM trips t
       LEFT JOIN vehicles v ON v.id = t.vehicle_id
       LEFT JOIN vehicle_types vt ON vt.id = v.vehicle_type_id
       WHERE t.id = :trip_id;`,
      { trip_id: tripId },
    );
    if (capacity === undefined || capacity === null) throw new HttpError(404, 'Trip not found.');

    const chainRows = await db.all(
      `SELECT b.seat_number, b.id AS booking_id, b.board_stop_order, b.alight_stop_order,
              b.user_id, u.full_name AS passenger_name,
              (SELECT stop_name FROM route_stops
                WHERE route_id = r.id AND stop_order = b.board_stop_order) AS board_stop,
              (SELECT stop_name FROM route_stops
                WHERE route_id = r.id AND stop_order = b.alight_stop_order) AS alight_stop
       FROM bookings b
       JOIN trips t ON t.id = b.trip_id
       JOIN routes r ON r.id = t.route_id
       LEFT JOIN users u ON u.id = b.user_id
       WHERE b.trip_id = :trip_id AND b.status != 'cancelled'
       ORDER BY b.seat_number ASC, b.board_stop_order ASC;`,
      { trip_id: tripId },
    );

    const chains = new Map<number, Array<Record<string, unknown>>>();
    for (const r of chainRows) {
      const seat = r.seat_number as number;
      if (!chains.has(seat)) chains.set(seat, []);
      chains.get(seat)!.push({
        booking_id: r.booking_id,
        board_stop_order: r.board_stop_order,
        alight_stop_order: r.alight_stop_order,
        board_stop: r.board_stop,
        alight_stop: r.alight_stop,
        passenger_name: r.passenger_name ?? 'Walk-up / Unregistered',
      });
    }

    return {
      trip_id: tripId,
      seat_capacity: capacity,
      chains: [...chains.entries()]
        .sort((a, b) => a[0] - b[0])
        .map(([seat_number, links]) => ({ seat_number, links })),
    };
  });

  app.get('/api/trips/:trip_id/seat-map', async (request) => {
    const tripId = parseId((request.params as { trip_id?: string }).trip_id);
    const query = request.query as { board_order?: string; alight_order?: string };
    const boardOrder = Number(query.board_order ?? '1');
    const alightOrder = Number(query.alight_order ?? '2');
    const db = request.db;

    const rows = await db.first(
      `SELECT vt.seat_capacity
       FROM trips t
       LEFT JOIN vehicles v ON v.id = t.vehicle_id
       LEFT JOIN vehicle_types vt ON vt.id = v.vehicle_type_id
       WHERE t.id = :trip_id;`,
      { trip_id: tripId },
    );
    if (!rows) throw new HttpError(404, 'Trip not found.');
    const capacity = toNum(rows.seat_capacity);

    // All non-cancelled bookings overlapping the requested segment, per seat.
    const overlaps = await db.all(
      `SELECT b.seat_number, b.board_stop_order, b.alight_stop_order,
              (SELECT stop_name FROM route_stops
                WHERE route_id = t.route_id AND stop_order = b.alight_stop_order) AS alight_stop
       FROM bookings b
       JOIN trips t ON t.id = b.trip_id
       WHERE b.trip_id = :trip_id
         AND b.status != 'cancelled'
         AND NOT (b.alight_stop_order <= :bo OR b.board_stop_order >= :ao)
       ORDER BY b.seat_number ASC, b.alight_stop_order DESC;`,
      { trip_id: tripId, bo: boardOrder, ao: alightOrder },
    );

    const bySeat = new Map<number, Row[]>();
    for (const o of overlaps) {
      const seat = o.seat_number as number;
      if (!bySeat.has(seat)) bySeat.set(seat, []);
      bySeat.get(seat)!.push(o);
    }

    const stopByOrder = new Map<number, string>();
    for (const o of overlaps) stopByOrder.set(o.alight_stop_order as number, o.alight_stop as string);

    const seats: Array<Record<string, unknown>> = [];
    for (let num = 1; num <= capacity; num++) {
      const occ = bySeat.get(num) ?? [];
      if (!occ.length) {
        seats.push({ seat_number: num, state: 'free', next_free_stop: null, next_free_stop_order: null });
        continue;
      }
      const { state, freeAt } = classify(occ as unknown as Interval[], boardOrder, alightOrder);
      if (state === 'partial' && freeAt !== null) {
        // Name the freeing stop for the driver/relay UI.
        let freeName = stopByOrder.get(freeAt.stop_order);
        if (freeName === undefined) {
          freeName = (await db.value(
            `SELECT stop_name FROM route_stops
             WHERE route_id = (SELECT route_id FROM trips WHERE id = :trip_id)
               AND stop_order = :so;`,
            { trip_id: tripId, so: freeAt.stop_order },
          )) as string | undefined;
        }
        seats.push({
          seat_number: num,
          state: 'partial',
          next_free_stop: freeName ?? null,
          next_free_stop_order: freeAt.stop_order,
        });
      } else {
        seats.push({ seat_number: num, state, next_free_stop: null, next_free_stop_order: null });
      }
    }

    return {
      trip_id: tripId,
      board_order: boardOrder,
      alight_order: alightOrder,
      seat_capacity: capacity,
      seats,
    };
  });
}
