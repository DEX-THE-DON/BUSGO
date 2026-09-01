import type { FastifyInstance } from 'fastify';
import {
  CurrentStopRequestSchema,
  TripStatusRequestSchema,
  type CurrentStopRequest,
  type TripStatusRequest,
} from '@busgo/types';
import { authenticate, authorize } from '../auth.js';
import { HttpError } from '../http-error.js';
import { validateBody, parseId } from '../util.js';
import { notifySeatReleasedAtStop } from '../chains.js';
import { manager } from '../ws.js';

export function registerDriverRoutes(app: FastifyInstance): void {
  app.get(
    '/api/driver/trips',
    { preHandler: [authenticate, authorize('driver', 'admin')] },
    async (request) => {
      const user = request.user!;
      const base = `
        SELECT t.id, t.name, t.status, t.scheduled_at, t.current_stop_order,
               r.name AS route_name, r.route_type,
               v.plate_number, v.is_electric, vt.seat_capacity, vt.seat_layout
        FROM trips t
        JOIN routes r ON r.id = t.route_id
        LEFT JOIN vehicles v ON v.id = t.vehicle_id
        LEFT JOIN vehicle_types vt ON vt.id = v.vehicle_type_id
      `;
      let rows;
      if (user.role === 'admin') {
        rows = await request.db.all(base + ' ORDER BY t.id ASC;');
      } else {
        rows = await request.db.all(base + ' WHERE t.driver_id = :driver_id ORDER BY t.id ASC;', {
          driver_id: user.id,
        });
      }
      return { trips: rows };
    },
  );

  app.get(
    '/api/trips/:trip_id/manifest',
    { preHandler: [authenticate, authorize('driver', 'admin')] },
    async (request) => {
      const tripId = parseId((request.params as { trip_id?: string }).trip_id);
      const db = request.db;
      const user = request.user!;

      const trip = await db.first('SELECT route_id FROM trips WHERE id = :id;', { id: tripId });
      if (!trip) throw new HttpError(404, 'Trip not found.');

      const rows = await db.all(
        `SELECT b.seat_number, b.user_id, u.full_name, u.phone, b.board_stop_order, b.alight_stop_order,
                (SELECT stop_name FROM route_stops
                  WHERE route_id = trips.route_id AND stop_order = b.board_stop_order) AS board_stop,
                (SELECT stop_name FROM route_stops
                  WHERE route_id = trips.route_id AND stop_order = b.alight_stop_order) AS alight_stop
         FROM bookings b
         LEFT JOIN users u ON u.id = b.user_id
         JOIN trips ON trips.id = b.trip_id
         WHERE b.trip_id = :trip_id
         ORDER BY b.seat_number ASC;`,
        { trip_id: tripId },
      );

      // Driver access is limited to trips assigned to them; admins see everything.
      if (user.role === 'driver') {
        const owned = await db.value(
          'SELECT id FROM trips WHERE id = :id AND driver_id = :driver_id;',
          { id: tripId, driver_id: user.id },
        );
        if (owned === undefined) {
          throw new HttpError(403, 'This trip is not assigned to you.');
        }
      }

      return { trip_id: tripId, manifest: rows };
    },
  );

  app.patch(
    '/api/trips/:trip_id/status',
    { preValidation: validateBody(TripStatusRequestSchema), preHandler: [authenticate, authorize('driver', 'admin')] },
    async (request) => {
      const tripId = parseId((request.params as { trip_id?: string }).trip_id);
      const payload = request.body as TripStatusRequest;
      const db = request.db;
      const user = request.user!;

      const allowed = new Set(['scheduled', 'boarding', 'in_transit', 'completed', 'cancelled']);
      if (!allowed.has(payload.status)) {
        throw new HttpError(400, `status must be one of: ${[...allowed].sort().join(', ')}`);
      }

      const trip = await db.first('SELECT id FROM trips WHERE id = :id;', { id: tripId });
      if (!trip) throw new HttpError(404, 'Trip not found.');
      if (user.role === 'driver') {
        const owned = await db.value('SELECT id FROM trips WHERE id = :id AND driver_id = :driver_id;', {
          id: tripId,
          driver_id: user.id,
        });
        if (owned === undefined) {
          throw new HttpError(403, 'This trip is not assigned to you.');
        }
      }

      await db.execute('UPDATE trips SET status = :status WHERE id = :id;', {
        status: payload.status,
        id: tripId,
      });
      await db.commit();
      await manager.broadcastTrip(tripId, {
        event: 'trip_status',
        trip_id: tripId,
        status: payload.status,
      });
      return { trip_id: tripId, status: payload.status };
    },
  );

  app.patch(
    '/api/trips/:trip_id/current-stop',
    { preValidation: validateBody(CurrentStopRequestSchema), preHandler: [authenticate, authorize('driver', 'admin')] },
    async (request) => {
      const tripId = parseId((request.params as { trip_id?: string }).trip_id);
      const payload = request.body as CurrentStopRequest;
      const db = request.db;
      const user = request.user!;

      const trip = await db.first('SELECT id, route_id, driver_id FROM trips WHERE id = :id;', {
        id: tripId,
      });
      if (!trip) throw new HttpError(404, 'Trip not found.');
      if (user.role === 'driver' && trip.driver_id !== user.id) {
        throw new HttpError(403, 'This trip is not assigned to you.');
      }

      // Validate the stop belongs to the route.
      const valid = await db.value(
        'SELECT id FROM route_stops WHERE route_id = :rid AND stop_order = :so;',
        { rid: trip.route_id, so: payload.stop_order },
      );
      if (valid === undefined) {
        throw new HttpError(400, "Stop not found on this trip's route.");
      }

      await db.execute('UPDATE trips SET current_stop_order = :so WHERE id = :id;', {
        so: payload.stop_order,
        id: tripId,
      });
      await db.commit();

      // Release seats whose passengers alight here + notify the relay/waitlists.
      const released = await notifySeatReleasedAtStop(db, manager, tripId, payload.stop_order);
      await manager.broadcastTrip(tripId, {
        event: 'trip_at_stop',
        trip_id: tripId,
        stop_order: payload.stop_order,
        released_seats: released,
      });
      return { trip_id: tripId, stop_order: payload.stop_order, released_seats: released };
    },
  );
}

