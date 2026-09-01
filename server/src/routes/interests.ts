import type { FastifyInstance } from 'fastify';
import { SeatInterestInSchema, type SeatInterestIn } from '@busgo/types';
import { authenticate } from '../auth.js';
import { HttpError } from '../http-error.js';
import { validateBody, parseId } from '../util.js';

export function registerInterestsRoutes(app: FastifyInstance): void {
  app.post(
    '/api/seat-interests',
    { preValidation: validateBody(SeatInterestInSchema), preHandler: [authenticate] },
    async (request) => {
      const payload = request.body as SeatInterestIn;
      const db = request.db;
      const user = request.user!;

      if (payload.board_stop_order >= payload.alight_stop_order) {
        throw new HttpError(400, 'Alighting stop must be further down the route than boarding.');
      }

      const row = await db.first(
        `INSERT INTO seat_interests (user_id, trip_id, board_stop_order, alight_stop_order, seat_number, status, created_at)
         VALUES (:uid, :trip_id, :board, :alight, :seat, 'active', now())
         RETURNING id, trip_id, board_stop_order, alight_stop_order, seat_number, status;`,
        {
          uid: user.id,
          trip_id: payload.trip_id,
          board: payload.board_stop_order,
          alight: payload.alight_stop_order,
          seat: payload.seat_number ?? null,
        },
      );
      await db.commit();
      return row;
    },
  );

  app.get('/api/seat-interests', { preHandler: [authenticate] }, async (request) => {
    const user = request.user!;
    const rows = await request.db.all(
      `SELECT si.id, si.trip_id, si.board_stop_order, si.alight_stop_order, si.seat_number, si.status, si.created_at,
              t.name AS trip_name, r.name AS route_name,
              (SELECT stop_name FROM route_stops WHERE route_id = r.id AND stop_order = si.board_stop_order) AS board_stop,
              (SELECT stop_name FROM route_stops WHERE route_id = r.id AND stop_order = si.alight_stop_order) AS alight_stop
       FROM seat_interests si
       JOIN trips t ON t.id = si.trip_id
       JOIN routes r ON r.id = t.route_id
       WHERE si.user_id = :uid
       ORDER BY si.created_at DESC;`,
      { uid: user.id },
    );
    return { interests: rows };
  });

  app.delete('/api/seat-interests/:interest_id', { preHandler: [authenticate] }, async (request) => {
    const interestId = parseId((request.params as { interest_id?: string }).interest_id);
    const db = request.db;
    const user = request.user!;

    const row = await db.first('SELECT id, user_id FROM seat_interests WHERE id = :id;', {
      id: interestId,
    });
    if (!row) throw new HttpError(404, 'Waitlist entry not found.');
    if (row.user_id !== user.id && user.role !== 'admin') {
      throw new HttpError(403, 'You can only remove your own waitlist entry.');
    }
    await db.execute("UPDATE seat_interests SET status = 'cancelled' WHERE id = :id;", {
      id: interestId,
    });
    await db.commit();
    return { deleted: interestId };
  });
}
