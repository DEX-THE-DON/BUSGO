import type { FastifyInstance } from 'fastify';
import {
  DriverInSchema,
  RouteInSchema,
  TripInSchema,
  TripPatchSchema,
  VehicleInSchema,
  VehicleTypeInSchema,
  type DriverIn,
  type RouteIn,
  type TripIn,
  type TripPatch,
  type VehicleIn,
  type VehicleTypeIn,
} from '@busgo/types';
import { authenticate, authorize, hashPassword } from '../auth.js';
import { HttpError } from '../http-error.js';
import { validateBody, parseId, toNum, toNumRecord } from '../util.js';

function defaultSeatLayout(capacity: number, columns = 4): { columns: number; rows: number[][] } {
  const rows: number[][] = [];
  let seat = 1;
  while (seat <= capacity) {
    const take = Math.min(columns, capacity - seat + 1);
    rows.push(Array.from({ length: take }, (_, i) => seat + i));
    seat += take;
  }
  return { columns, rows };
}

export function registerAdminRoutes(app: FastifyInstance): void {
  // ------------------------------------------------------------------
  // Vehicle types
  // ------------------------------------------------------------------
  app.get(
    '/api/admin/vehicle-types',
    { preHandler: [authenticate, authorize('admin')] },
    async (request) => {
      const rows = await request.db.all(
        'SELECT id, slug, display_name, seat_capacity, seat_layout FROM vehicle_types ORDER BY id;',
      );
      return { vehicle_types: rows };
    },
  );

  app.post(
    '/api/admin/vehicle-types',
    { preValidation: validateBody(VehicleTypeInSchema), preHandler: [authenticate, authorize('admin')] },
    async (request) => {
      const payload = request.body as VehicleTypeIn;
      const db = request.db;
      const row = await db.first(
        `INSERT INTO vehicle_types (slug, display_name, seat_capacity, seat_layout)
         VALUES (:slug, :display_name, :seat_capacity, CAST(:layout AS jsonb))
         RETURNING id, slug, display_name, seat_capacity, seat_layout;`,
        {
          slug: payload.slug,
          display_name: payload.display_name,
          seat_capacity: payload.seat_capacity,
          layout: defaultSeatLayout(payload.seat_capacity),
        },
      );
      await db.commit();
      return row;
    },
  );

  // ------------------------------------------------------------------
  // Vehicles
  // ------------------------------------------------------------------
  app.get('/api/admin/vehicles', { preHandler: [authenticate, authorize('admin')] }, async (request) => {
    const rows = await request.db.all(
      `SELECT v.id, v.plate_number, v.vehicle_type_id, v.is_electric, v.created_at,
              vt.slug AS category, vt.display_name AS vehicle_type_name, vt.seat_capacity
       FROM vehicles v
       JOIN vehicle_types vt ON vt.id = v.vehicle_type_id
       ORDER BY v.id;`,
    );
    return { vehicles: rows };
  });

  app.post(
    '/api/admin/vehicles',
    { preValidation: validateBody(VehicleInSchema), preHandler: [authenticate, authorize('admin')] },
    async (request) => {
      const payload = request.body as VehicleIn;
      const db = request.db;
      let vid: number;
      try {
        const row = await db.first(
          `INSERT INTO vehicles (plate_number, vehicle_type_id, is_electric)
           VALUES (:plate, :vt_id, :electric)
           RETURNING id;`,
          { plate: payload.plate_number, vt_id: payload.vehicle_type_id, electric: payload.is_electric },
        );
        vid = row!.id as number;
        await db.commit();
      } catch (e) {
        await db.rollback();
        const msg = String((e as { message?: unknown })?.message ?? e).toLowerCase();
        if (msg.includes('unique') || msg.includes('duplicate')) {
          throw new HttpError(409, 'A vehicle with that plate number already exists.');
        }
        throw new HttpError(500, msg);
      }
      return {
        id: vid,
        plate_number: payload.plate_number,
        vehicle_type_id: payload.vehicle_type_id,
        is_electric: payload.is_electric,
      };
    },
  );

  app.delete(
    '/api/admin/vehicles/:vehicle_id',
    { preHandler: [authenticate, authorize('admin')] },
    async (request) => {
      const vehicleId = parseId((request.params as { vehicle_id?: string }).vehicle_id);
      const db = request.db;
      const row = await db.first('SELECT id FROM vehicles WHERE id = :id;', { id: vehicleId });
      if (!row) throw new HttpError(404, 'Vehicle not found.');
      await db.execute('DELETE FROM vehicles WHERE id = :id;', { id: vehicleId });
      await db.commit();
      return { deleted: vehicleId };
    },
  );

  // ------------------------------------------------------------------
  // Public routes listing
  // ------------------------------------------------------------------
  app.get('/api/routes', async (request) => {
    const db = request.db;
    const routes = await db.all('SELECT id, name, country, route_type FROM routes ORDER BY id;');
    const out = [];
    for (const r of routes) {
      const stops = await db.all(
        'SELECT id, stop_name, stop_order FROM route_stops WHERE route_id = :rid ORDER BY stop_order;',
        { rid: r.id },
      );
      out.push({ ...r, stops });
    }
    return { routes: out };
  });

  // ------------------------------------------------------------------
  // Drivers
  // ------------------------------------------------------------------
  app.get('/api/admin/drivers', { preHandler: [authenticate, authorize('admin')] }, async (request) => {
    const rows = await request.db.all(
      "SELECT id, full_name, email, phone, created_at FROM users WHERE role = 'driver' ORDER BY id;",
    );
    return { drivers: rows };
  });

  app.post(
    '/api/admin/drivers',
    { preValidation: validateBody(DriverInSchema), preHandler: [authenticate, authorize('admin')] },
    async (request) => {
      const payload = request.body as DriverIn;
      const db = request.db;

      const existing = await db.first('SELECT id FROM users WHERE email = :email;', { email: payload.email });
      if (existing) throw new HttpError(409, 'A user with that email already exists.');

      const row = await db.first(
        `INSERT INTO users (full_name, email, phone, password_hash, role, created_at)
         VALUES (:name, :email, :phone, :pw, 'driver', now())
         RETURNING id, full_name, email, phone, role;`,
        {
          name: payload.full_name,
          email: payload.email,
          phone: payload.phone ?? null,
          pw: hashPassword(payload.password),
        },
      );
      await db.commit();
      return row;
    },
  );

  // ------------------------------------------------------------------
  // Analytics + payment log
  // ------------------------------------------------------------------
  app.get('/api/admin/analytics', { preHandler: [authenticate, authorize('admin')] }, async (request) => {
    const db = request.db;

    const revenue = await db.first(`
        SELECT
          COALESCE(SUM(p.amount) FILTER (WHERE p.created_at >= date_trunc('day', now())), 0) AS today,
          COALESCE(SUM(p.amount) FILTER (WHERE p.created_at >= date_trunc('week', now())), 0) AS week,
          COALESCE(SUM(p.amount) FILTER (WHERE p.created_at >= date_trunc('month', now())), 0) AS month,
          COALESCE(SUM(p.amount) FILTER (WHERE p.created_at >= date_trunc('year', now())), 0) AS year,
          COALESCE(SUM(p.amount), 0) AS total,
          COUNT(DISTINCT p.booking_id) AS paid_bookings,
          COUNT(*) FILTER (WHERE p.status = 'completed') AS completed_payments,
          COUNT(*) FILTER (WHERE p.status = 'failed') AS failed_payments
        FROM payments p;
    `);

    const prev = await db.first(`
        SELECT
          COALESCE(SUM(p.amount) FILTER (WHERE p.created_at >= date_trunc('week', now()) - interval '7 days'
                                          AND p.created_at < date_trunc('week', now())), 0) AS week,
          COALESCE(SUM(p.amount) FILTER (WHERE p.created_at >= date_trunc('month', now()) - interval '1 month'
                                          AND p.created_at < date_trunc('month', now())), 0) AS month,
          COALESCE(SUM(p.amount) FILTER (WHERE p.created_at >= date_trunc('year', now()) - interval '1 year'
                                          AND p.created_at < date_trunc('year', now())), 0) AS year
        FROM payments p
        WHERE p.status = 'completed';
    `);

    const perDay = await db.all(
      `SELECT to_char(date_trunc('day', created_at), 'YYYY-MM-DD') AS day, COUNT(*) AS bookings
       FROM bookings
       WHERE created_at >= now() - interval '14 days'
       GROUP BY 1 ORDER BY 1;`,
    );

    const occupancy = await db.all(
      `SELECT t.id, t.name, r.name AS route_name, vt.seat_capacity,
              COUNT(b.id) FILTER (WHERE b.status NOT IN ('cancelled')) AS seats_taken
       FROM trips t
       JOIN routes r ON r.id = t.route_id
       LEFT JOIN vehicles v ON v.id = t.vehicle_id
       LEFT JOIN vehicle_types vt ON vt.id = v.vehicle_type_id
       LEFT JOIN bookings b ON b.trip_id = t.id
       GROUP BY t.id, r.name, vt.seat_capacity
       ORDER BY t.id;`,
    );

    return {
      revenue: toNumRecord(revenue!, [
        'today',
        'week',
        'month',
        'year',
        'total',
        'paid_bookings',
        'completed_payments',
        'failed_payments',
      ]),
      revenue_prev: toNumRecord(prev!, ['week', 'month', 'year']),
      bookings_per_day: perDay.map((r) => ({ day: r.day, bookings: toNum(r.bookings) })),
      occupancy: occupancy.map((r) => ({
        ...r,
        seat_capacity: r.seat_capacity === null ? null : toNum(r.seat_capacity),
        seats_taken: toNum(r.seats_taken),
      })),
    };
  });

  app.get('/api/admin/payments', { preHandler: [authenticate, authorize('admin')] }, async (request) => {
    const query = request.query as { limit?: string };
    const limit = Number(query.limit ?? '50');
    const rows = await request.db.all(
      `SELECT p.id, p.provider, p.status, p.amount, p.phone_number, p.provider_reference,
              p.callback_verified, p.created_at, b.trip_id, b.seat_number
       FROM payments p
       JOIN bookings b ON b.id = p.booking_id
       ORDER BY p.created_at DESC, p.id DESC
       LIMIT :limit;`,
      { limit },
    );
    return { payments: rows.map((r) => ({ ...r, amount: toNum(r.amount) })) };
  });

  app.get('/api/admin/users', { preHandler: [authenticate, authorize('admin')] }, async (request) => {
    const rows = await request.db.all(
      'SELECT id, full_name, email, phone, role FROM users ORDER BY id;',
    );
    return { users: rows };
  });

  // ------------------------------------------------------------------
  // Routes (admin CRUD)
  // ------------------------------------------------------------------
  app.post(
    '/api/admin/routes',
    { preValidation: validateBody(RouteInSchema), preHandler: [authenticate, authorize('admin')] },
    async (request) => {
      const payload = request.body as RouteIn;
      const db = request.db;

      if (payload.route_type !== 'direct' && payload.route_type !== 'stopwise') {
        throw new HttpError(400, "route_type must be 'direct' or 'stopwise'.");
      }
      if (payload.stops.length < 2) {
        throw new HttpError(400, 'A route needs at least 2 stops.');
      }
      if (payload.route_type === 'direct' && payload.stops.length > 2) {
        throw new HttpError(400, 'Direct routes have exactly 2 stops (origin, destination).');
      }

      const res = await db.first(
        'INSERT INTO routes (name, country, route_type) VALUES (:name, :country, :route_type) RETURNING id;',
        { name: payload.name, country: payload.country, route_type: payload.route_type },
      );
      const routeId = res!.id as number;
      for (const [order, stopName] of payload.stops.entries()) {
        await db.execute(
          'INSERT INTO route_stops (route_id, stop_name, stop_order) VALUES (:rid, :stop, :order);',
          { rid: routeId, stop: stopName, order: order + 1 },
        );
      }
      await db.commit();
      return {
        id: routeId,
        name: payload.name,
        country: payload.country,
        route_type: payload.route_type,
        stops: payload.stops,
      };
    },
  );

  app.delete(
    '/api/admin/routes/:route_id',
    { preHandler: [authenticate, authorize('admin')] },
    async (request) => {
      const routeId = parseId((request.params as { route_id?: string }).route_id);
      const db = request.db;

      const row = await db.first('SELECT id FROM routes WHERE id = :id;', { id: routeId });
      if (!row) throw new HttpError(404, 'Route not found.');

      await db.execute('DELETE FROM route_stops WHERE route_id = :id;', { id: routeId });
      await db.execute('DELETE FROM routes WHERE id = :id;', { id: routeId });
      await db.commit();
      return { deleted: routeId };
    },
  );

  // ------------------------------------------------------------------
  // Trips (admin CRUD)
  // ------------------------------------------------------------------
  app.post(
    '/api/admin/trips',
    { preValidation: validateBody(TripInSchema), preHandler: [authenticate, authorize('admin')] },
    async (request) => {
      const payload = request.body as TripIn;
      const db = request.db;
      let tripId: number;
      try {
        const row = await db.first(
          `INSERT INTO trips (route_id, vehicle_id, driver_id, name, scheduled_at, status)
           VALUES (:route_id, :vehicle_id, :driver_id, :name, :scheduled_at, :status)
           RETURNING id;`,
          {
            route_id: payload.route_id,
            vehicle_id: payload.vehicle_id ?? null,
            driver_id: payload.driver_id ?? null,
            name: payload.name,
            scheduled_at: payload.scheduled_at ?? null,
            status: payload.status,
          },
        );
        tripId = row!.id as number;
        await db.commit();
      } catch (e) {
        await db.rollback();
        const msg = String((e as { message?: unknown })?.message ?? e).toLowerCase();
        if (msg.includes('foreign key') || msg.includes('violates')) {
          throw new HttpError(400, 'Invalid route, vehicle, or driver id.');
        }
        throw new HttpError(500, msg);
      }
      return { id: tripId, name: payload.name, status: payload.status };
    },
  );

  app.patch(
    '/api/admin/trips/:trip_id',
    { preValidation: validateBody(TripPatchSchema), preHandler: [authenticate, authorize('admin')] },
    async (request) => {
      const tripId = parseId((request.params as { trip_id?: string }).trip_id);
      const payload = request.body as TripPatch;
      const db = request.db;

      const trip = await db.first('SELECT id FROM trips WHERE id = :id;', { id: tripId });
      if (!trip) throw new HttpError(404, 'Trip not found.');

      await db.execute(
        `UPDATE trips SET
            route_id = COALESCE(:route_id, route_id),
            vehicle_id = COALESCE(:vehicle_id, vehicle_id),
            driver_id = COALESCE(:driver_id, driver_id),
            name = COALESCE(:name, name),
            scheduled_at = COALESCE(:scheduled_at, scheduled_at),
            status = COALESCE(:status, status)
         WHERE id = :id;`,
        {
          id: tripId,
          route_id: payload.route_id ?? null,
          vehicle_id: payload.vehicle_id ?? null,
          driver_id: payload.driver_id ?? null,
          name: payload.name ?? null,
          scheduled_at: payload.scheduled_at ?? null,
          status: payload.status ?? null,
        },
      );
      await db.commit();
      return { id: tripId, updated: true };
    },
  );

  app.delete(
    '/api/admin/trips/:trip_id',
    { preHandler: [authenticate, authorize('admin')] },
    async (request) => {
      const tripId = parseId((request.params as { trip_id?: string }).trip_id);
      const db = request.db;

      const row = await db.first('SELECT id FROM trips WHERE id = :id;', { id: tripId });
      if (!row) throw new HttpError(404, 'Trip not found.');

      await db.execute('DELETE FROM trips WHERE id = :id;', { id: tripId });
      await db.commit();
      return { deleted: tripId };
    },
  );
}


