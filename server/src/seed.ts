/**
 * Database bootstrap — a direct port of `initialize_database()` from the
 * FastAPI backend. Creates the seat-conflict trigger/indexes, then seeds the
 * catalog (vehicle types/vehicles), demo accounts, a demo route/trip and a
 * sample booking if the database is empty. All SQL is kept verbatim.
 */
import { pool, Db } from './db.js';
import { hashPassword } from './auth.js';
import { toNum } from './util.js';

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

const CHECK_SEAT_CONFLICT_FN = `
CREATE OR REPLACE FUNCTION check_seat_conflict() RETURNS trigger AS $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM bookings b
        WHERE b.trip_id = NEW.trip_id
          AND b.seat_number = NEW.seat_number
          AND NOT (b.alight_stop_order <= NEW.board_stop_order OR b.board_stop_order >= NEW.alight_stop_order)
          AND (TG_OP = 'INSERT' OR b.id != NEW.id)
    ) THEN
        RAISE EXCEPTION 'Seat conflict for trip % and seat %', NEW.trip_id, NEW.seat_number;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;
`;

export async function initializeDatabase(): Promise<void> {
  const client = await pool.connect();
  const db = new Db(client);
  try {
    // ------------------------------------------------------------------
    // Schema objects (idempotent DDL)
    // ------------------------------------------------------------------
    await db.execute(CHECK_SEAT_CONFLICT_FN);
    await db.execute('DROP TRIGGER IF EXISTS trg_check_seat_conflict ON bookings;');
    await db.execute(
      'CREATE TRIGGER trg_check_seat_conflict BEFORE INSERT OR UPDATE ON bookings FOR EACH ROW EXECUTE FUNCTION check_seat_conflict();',
    );
    await db.execute('CREATE INDEX IF NOT EXISTS idx_bookings_trip_seat ON bookings (trip_id, seat_number);');
    await db.execute('CREATE INDEX IF NOT EXISTS idx_route_stops_route_order ON route_stops (route_id, stop_order);');
    await db.commit();

    // ------------------------------------------------------------------
    // Vehicle types
    // ------------------------------------------------------------------
    const vtCount = await db.value('SELECT count(*) FROM vehicle_types;');
    if (toNum(vtCount) === 0) {
      const types: Array<[string, string, number]> = [
        ['matatu_14', 'Matatu (14 seats)', 14],
        ['bus_33', 'Standard Bus (33 seats)', 33],
        ['bus_51', 'Large Coach (51 seats)', 51],
        ['ev_bus_33', 'EV Bus (33 seats)', 33],
        ['ev_matatu_14', 'EV Matatu (14 seats)', 14],
      ];
      for (const [slug, displayName, capacity] of types) {
        await db.execute(
          `INSERT INTO vehicle_types (slug, display_name, seat_capacity, seat_layout)
           VALUES (:slug, :display_name, :seat_capacity, CAST(:layout AS jsonb));`,
          {
            slug,
            display_name: displayName,
            seat_capacity: capacity,
            layout: defaultSeatLayout(capacity),
          },
        );
      }
    }

    // Backfill seat layouts for any vehicle type that lacks one.
    const vehicleTypes = await db.all('SELECT id, seat_capacity, seat_layout FROM vehicle_types;');
    for (const vt of vehicleTypes) {
      if (!vt.seat_layout) {
        await db.execute(
          'UPDATE vehicle_types SET seat_layout = CAST(:layout AS jsonb) WHERE id = :id;',
          { layout: defaultSeatLayout(toNum(vt.seat_capacity)), id: vt.id },
        );
      }
    }

    // ------------------------------------------------------------------
    // Vehicles
    // ------------------------------------------------------------------
    const vCount = await db.value('SELECT count(*) FROM vehicles;');
    if (toNum(vCount) === 0) {
      const vtMap = new Map<string, number>();
      for (const vt of await db.all('SELECT id, slug FROM vehicle_types;')) {
        vtMap.set(vt.slug as string, vt.id as number);
      }
      const vehicles: Array<[string, string, boolean]> = [
        ['KDA 123A', 'matatu_14', false],
        ['KDK 456E', 'ev_matatu_14', true],
        ['KCE 999B', 'ev_bus_33', true],
        ['KAA 556C', 'bus_51', false],
        ['KDB 777D', 'bus_33', false],
      ];
      for (const [plate, slug, isElectric] of vehicles) {
        await db.execute(
          `INSERT INTO vehicles (plate_number, vehicle_type_id, is_electric)
           VALUES (:plate, :vt_id, :electric);`,
          { plate, vt_id: vtMap.get(slug), electric: isElectric },
        );
      }
    }

    // ------------------------------------------------------------------
    // Demo users + passwords
    // ------------------------------------------------------------------
    const uCount = await db.value('SELECT count(*) FROM users;');
    if (toNum(uCount) === 0) {
      const demoUsers: Array<[string, string, string, string]> = [
        ['Admin User', 'admin@busgo.test', 'admin123', 'admin'],
        ['Driver One', 'driver1@busgo.test', 'driver123', 'driver'],
        ['Passenger One', 'passenger1@busgo.test', 'pass123', 'user'],
      ];
      for (const [fullName, email, password, role] of demoUsers) {
        await db.execute(
          `INSERT INTO users (full_name, email, phone, password_hash, role, created_at)
           VALUES (:full_name, :email, NULL, :pw, :role, now());`,
          { full_name: fullName, email, pw: hashPassword(password), role },
        );
      }
    }

    // Ensure the demo accounts always have a usable password hash, even if
    // they were seeded before password hashing was introduced.
    const demo = {
      'admin@busgo.test': 'admin123',
      'driver1@busgo.test': 'driver123',
      'passenger1@busgo.test': 'pass123',
    };
    for (const [email, password] of Object.entries(demo)) {
      const row = await db.first('SELECT id, password_hash FROM users WHERE email = :email;', { email });
      if (row && (row.password_hash === null || row.password_hash === undefined)) {
        await db.execute('UPDATE users SET password_hash = :pw WHERE id = :id;', {
          pw: hashPassword(password),
          id: row.id,
        });
      }
    }

    // Assign the seeded driver to any trips that have no driver yet, so the
    // driver dashboard/manifest has data to show.
    const driver = await db.first("SELECT id FROM users WHERE role = 'driver' LIMIT 1;");
    if (driver) {
      await db.execute('UPDATE trips SET driver_id = :driver_id WHERE driver_id IS NULL;', {
        driver_id: driver.id,
      });
    }

    // ------------------------------------------------------------------
    // Demo route + trip
    // ------------------------------------------------------------------
    const routeCount = await db.value('SELECT count(*) FROM routes;');
    let tripId: number | null = null;
    if (toNum(routeCount) === 0) {
      const route = await db.first(
        "INSERT INTO routes (name, country) VALUES ('Nairobi - Nakuru Express', 'KE') RETURNING id;",
      );
      const routeId = route!.id as number;
      const stops: Array<[string, number]> = [
        ['Nairobi Station', 1],
        ['Westlands', 2],
        ['Eldoret Junction', 3],
        ['Nakuru Terminal', 4],
      ];
      for (const [stopName, stopOrder] of stops) {
        await db.execute(
          'INSERT INTO route_stops (route_id, stop_name, stop_order) VALUES (:rid, :stop, :order);',
          { rid: routeId, stop: stopName, order: stopOrder },
        );
      }
      const vehicle = await db.first('SELECT id FROM vehicles LIMIT 1;');
      const vehicleId = vehicle ? (vehicle.id as number) : null;
      const trip = await db.first(
        `INSERT INTO trips (route_id, vehicle_id, name)
         VALUES (:rid, :vid, 'Nairobi - Nakuru Express Morning')
         RETURNING id;`,
        { rid: routeId, vid: vehicleId },
      );
      tripId = trip!.id as number;
    } else {
      const trip = await db.first('SELECT t.id FROM trips t JOIN routes r ON r.id = t.route_id LIMIT 1;');
      tripId = trip ? (trip.id as number) : null;
    }

    // ------------------------------------------------------------------
    // Sample booking + payment
    // ------------------------------------------------------------------
    const bookingCount = await db.value('SELECT count(*) FROM bookings;');
    if (toNum(bookingCount) === 0 && tripId !== null) {
      let user = await db.first("SELECT id FROM users WHERE role = 'user' LIMIT 1;");
      if (!user) {
        user = await db.first(
          `INSERT INTO users (full_name, phone, email, password_hash, role, created_at)
           VALUES ('Passenger Fallback', NULL, 'pf@busgo.test', NULL, 'user', now())
           RETURNING id;`,
        );
      }
      const booking = await db.first(
        `INSERT INTO bookings (trip_id, user_id, seat_number, board_stop_order, alight_stop_order, status, payment_status, created_at)
         VALUES (:trip_id, :user_id, 3, 1, 3, 'confirmed', 'paid', now())
         RETURNING id;`,
        { trip_id: tripId, user_id: user!.id },
      );
      await db.execute(
        `INSERT INTO payments (booking_id, provider, provider_payload, amount, status, created_at)
         VALUES (:bid, 'mpesa_sim', NULL, 500.00, 'completed', now());`,
        { bid: booking!.id },
      );
    }

    await db.commit();
  } finally {
    await db.close();
  }
}

