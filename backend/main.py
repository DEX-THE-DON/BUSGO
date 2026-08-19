import os
import json
from typing import List

from fastapi import FastAPI, Depends, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import HTMLResponse
from pydantic import BaseModel
from sqlalchemy import func, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from backend.auth import (
    create_access_token,
    decode_access_token,
    hash_password,
    require_roles,
    verify_password,
    get_current_user,
)
from backend.db import AsyncSessionLocal, engine, get_async_db
from backend.ws import manager
from backend.chains import (
    recompute_chain,
    notify_chain_change,
    trip_stop_names,
    notify_seat_released_at_stop,
    create_notification,
)
from backend import daraja
from backend.models import (
    Base,
    Booking,
    Payment,
    Route,
    RouteStop,
    Trip,
    User,
    Vehicle,
    VehicleType,
    SeatChain,
    SeatChainLink,
    SeatInterest,
    Notification,
)

app = FastAPI(title="BUSGO API", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


def _default_seat_layout(capacity: int, columns: int = 4) -> dict:
    """A simple N-column grid descriptor, e.g. for a 14-seater matatu."""
    rows: list[list[int]] = []
    seat = 1
    while seat <= capacity:
        take = min(columns, capacity - seat + 1)
        rows.append(list(range(seat, seat + take)))
        seat += take
    return {"columns": columns, "rows": rows}


async def initialize_database() -> None:
    """
    Create a more complete schema for BUSGO and seed initial data.
    Tables:
      - users (role: admin/driver/user)
      - vehicle_types (matatu_14, bus_33, bus_51, ev variants)
      - vehicles
      - routes
      - trips (assigned to a vehicle)
      - route_stops
      - bookings (with status)
      - payments

    This version uses SQLAlchemy async sessions and model metadata for schema creation, then seeds the database.
    """
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

        await conn.execute(
            text(
                """
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
                """
            )
        )
        await conn.execute(text("DROP TRIGGER IF EXISTS trg_check_seat_conflict ON bookings;"))
        await conn.execute(
            text(
                """
                CREATE TRIGGER trg_check_seat_conflict
                BEFORE INSERT OR UPDATE ON bookings
                FOR EACH ROW EXECUTE FUNCTION check_seat_conflict();
                """
            )
        )
        await conn.execute(text("CREATE INDEX IF NOT EXISTS idx_bookings_trip_seat ON bookings (trip_id, seat_number);"))
        await conn.execute(text("CREATE INDEX IF NOT EXISTS idx_route_stops_route_order ON route_stops (route_id, stop_order);"))

    async with AsyncSessionLocal() as session:
        vt_count = await session.scalar(select(func.count()).select_from(VehicleType))
        if vt_count == 0:
            session.add_all(
                [
                    VehicleType(slug='matatu_14', display_name='Matatu (14 seats)', seat_capacity=14),
                    VehicleType(slug='bus_33', display_name='Standard Bus (33 seats)', seat_capacity=33),
                    VehicleType(slug='bus_51', display_name='Large Coach (51 seats)', seat_capacity=51),
                    VehicleType(slug='ev_bus_33', display_name='EV Bus (33 seats)', seat_capacity=33),
                    VehicleType(slug='ev_matatu_14', display_name='EV Matatu (14 seats)', seat_capacity=14),
                ]
            )

        # Backfill seat layouts for any vehicle type that lacks one (e.g. types
        # created in the admin panel before this feature existed).
        for vt in (await session.execute(select(VehicleType))).scalars().all():
            if not vt.seat_layout:
                vt.seat_layout = _default_seat_layout(vt.seat_capacity)

        v_count = await session.scalar(select(func.count()).select_from(Vehicle))
        if v_count == 0:
            vehicle_types = await session.execute(select(VehicleType))
            vt_map = {vt.slug: vt.id for vt in vehicle_types.scalars().all()}
            session.add_all(
                [
                    Vehicle(plate_number='KDA 123A', vehicle_type_id=vt_map.get('matatu_14'), is_electric=False),
                    Vehicle(plate_number='KDK 456E', vehicle_type_id=vt_map.get('ev_matatu_14'), is_electric=True),
                    Vehicle(plate_number='KCE 999B', vehicle_type_id=vt_map.get('ev_bus_33'), is_electric=True),
                    Vehicle(plate_number='KAA 556C', vehicle_type_id=vt_map.get('bus_51'), is_electric=False),
                    Vehicle(plate_number='KDB 777D', vehicle_type_id=vt_map.get('bus_33'), is_electric=False),
                ]
            )

        u_count = await session.scalar(select(func.count()).select_from(User))
        if u_count == 0:
            session.add_all(
                [
                    User(full_name='Admin User', phone=None, email='admin@busgo.test', password_hash=hash_password('admin123'), role='admin'),
                    User(full_name='Driver One', phone=None, email='driver1@busgo.test', password_hash=hash_password('driver123'), role='driver'),
                    User(full_name='Passenger One', phone=None, email='passenger1@busgo.test', password_hash=hash_password('pass123'), role='user'),
                ]
            )

        # Ensure the demo accounts always have a usable password hash, even if
        # they were seeded before password hashing was introduced.
        async def _ensure_demo_passwords() -> None:
            demo = {
                'admin@busgo.test': 'admin123',
                'driver1@busgo.test': 'driver123',
                'passenger1@busgo.test': 'pass123',
            }
            for email, pw in demo.items():
                row = (await session.execute(select(User).where(User.email == email))).scalars().first()
                if row is not None and (row.password_hash is None or not row.password_hash):
                    row.password_hash = hash_password(pw)
        await _ensure_demo_passwords()

        # Assign the seeded driver to any trips that have no driver yet, so the
        # driver dashboard/manifest has data to show.
        driver_user = (await session.execute(select(User).where(User.role == 'driver').limit(1))).scalars().first()
        if driver_user is not None:
            orphan_trips = (await session.execute(select(Trip).where(Trip.driver_id.is_(None)))).scalars().all()
            for t in orphan_trips:
                t.driver_id = driver_user.id

        route_count = await session.scalar(select(func.count()).select_from(Route))
        trip_id = None
        if route_count == 0:
            route = Route(name='Nairobi - Nakuru Express', country='KE')
            session.add(route)
            await session.flush()

            session.add_all(
                [
                    RouteStop(route_id=route.id, stop_name='Nairobi Station', stop_order=1),
                    RouteStop(route_id=route.id, stop_name='Westlands', stop_order=2),
                    RouteStop(route_id=route.id, stop_name='Eldoret Junction', stop_order=3),
                    RouteStop(route_id=route.id, stop_name='Nakuru Terminal', stop_order=4),
                ]
            )

            vehicle = (await session.execute(select(Vehicle).limit(1))).scalars().first()
            vehicle_id = vehicle.id if vehicle else None
            trip = Trip(route_id=route.id, vehicle_id=vehicle_id, name='Nairobi - Nakuru Express Morning')
            session.add(trip)
            await session.flush()
            trip_id = trip.id
        else:
            trip = (await session.execute(select(Trip).join(Route).limit(1))).scalars().first()
            trip_id = trip.id if trip else None

        booking_count = await session.scalar(select(func.count()).select_from(Booking))
        if booking_count == 0 and trip_id is not None:
            user = (await session.execute(select(User).where(User.role == 'user').limit(1))).scalars().first()
            if user is None:
                user = User(full_name='Passenger Fallback', phone=None, email='pf@busgo.test', password_hash=None, role='user')
                session.add(user)
                await session.flush()

            booking = Booking(
                trip_id=trip_id,
                user_id=user.id,
                seat_number=3,
                board_stop_order=1,
                alight_stop_order=3,
                status='confirmed',
                payment_status='paid',
            )
            session.add(booking)
            await session.flush()
            payment = Payment(
                booking_id=booking.id,
                provider='mpesa_sim',
                provider_payload=None,
                amount=500.00,
                status='completed',
            )
            session.add(payment)

        await session.commit()


@app.on_event("startup")
async def on_startup():
    await initialize_database()


@app.get("/")
def read_root():
    return {"message": "Welcome to BUSGO API - Dynamic Transport & Seating Platform"}


@app.get("/progress", response_class=HTMLResponse)
def progress_page():
    return """
    <!DOCTYPE html>
    <html lang="en">
      <head>
        <meta charset="UTF-8" />
        <title>BUSGO Backend Progress</title>
        <style>
          body { font-family: system-ui, sans-serif; background: #0f172a; color: #e2e8f0; margin: 0; padding: 32px; }
          h1 { color: #22c55e; margin-bottom: 16px; }
          section { margin-bottom: 24px; }
          code { background: #111827; padding: 2px 6px; border-radius: 6px; }
          a { color: #38bdf8; text-decoration: none; }
          a:hover { text-decoration: underline; }
        </style>
      </head>
      <body>
        <h1>BUSGO Backend Progress</h1>
        <section>
          <p>The backend is running and the async database layer is configured.</p>
          <ul>
            <li>Async DB module: <code>backend/db.py</code></li>
            <li>ORM models: <code>backend/models.py</code></li>
            <li>Alembic initialized: <code>backend/alembic/</code></li>
            <li>Initial migration: <code>backend/alembic/versions/c861d38ec0fb_initial_models.py</code></li>
            <li>Async SQLAlchemy-based endpoints enabled</li>
          </ul>
        </section>
        <section>
          <h2>Try these endpoints</h2>
          <ul>
            <li><a href="/">Root API</a></li>
            <li><a href="/api/trips/1/stops">Trip stops</a></li>
            <li><a href="/api/trips/1/booked-seats?board_order=1&alight_order=3">Booked seats</a></li>
            <li><a href="/api/trips/1/manifest">Trip manifest</a></li>
          </ul>
        </section>
      </body>
    </html>
    """


from sqlalchemy import text
from backend.db import get_async_db
from sqlalchemy.exc import DBAPIError


# --------------------------------------------------------------------------
# Authentication
# --------------------------------------------------------------------------
class RegisterRequest(BaseModel):
    full_name: str
    email: str
    phone: str | None = None
    password: str


class LoginRequest(BaseModel):
    email: str
    password: str


class UserOut(BaseModel):
    id: int
    full_name: str
    email: str | None = None
    phone: str | None = None
    role: str

    class Config:
        from_attributes = True


class AuthResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: UserOut


@app.post("/api/auth/register", response_model=AuthResponse)
async def register_user(payload: RegisterRequest, db=Depends(get_async_db)):
    """Create a new passenger account and return a JWT. New accounts always
    get the `user` role — self-service registration can never create an
    admin or driver."""
    existing = (
        await db.execute(select(User).where(User.email == payload.email))
    ).scalars().first()
    if existing is not None:
        raise HTTPException(status_code=409, detail="An account with that email already exists.")

    user = User(
        full_name=payload.full_name,
        email=payload.email,
        phone=payload.phone,
        password_hash=hash_password(payload.password),
        role='user',
    )
    db.add(user)
    await db.commit()
    await db.refresh(user)

    token = create_access_token({"sub": str(user.id), "role": user.role})
    return AuthResponse(access_token=token, user=UserOut.model_validate(user))


@app.post("/api/auth/login", response_model=AuthResponse)
async def login(payload: LoginRequest, db=Depends(get_async_db)):
    """Exchange email + password for a JWT access token."""
    user = (
        await db.execute(select(User).where(User.email == payload.email))
    ).scalars().first()
    if user is None or not verify_password(payload.password, user.password_hash):
        raise HTTPException(status_code=401, detail="Invalid email or password.")

    token = create_access_token({"sub": str(user.id), "role": user.role})
    return AuthResponse(access_token=token, user=UserOut.model_validate(user))


@app.get("/api/auth/me", response_model=UserOut)
async def me(current_user: User = Depends(get_current_user)):
    return current_user


@app.get("/api/trips")
async def list_trips(db=Depends(get_async_db)):
    """Public: all trips available for booking, with route/vehicle details
    and the seat capacity of the assigned vehicle."""
    rows = (await db.execute(
        text("""
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
        """)
    )).mappings().all()
    return {"trips": [dict(r) for r in rows]}


@app.get("/api/trips/{trip_id}/stops")
async def get_trip_stops(trip_id: int, db=Depends(get_async_db)):
    query = text(
        """
        SELECT rs.id, rs.stop_name, rs.stop_order
        FROM trips t
        JOIN route_stops rs ON t.route_id = rs.route_id
        WHERE t.id = :trip_id
        ORDER BY rs.stop_order ASC;
        """
    )
    res = await db.execute(query, {"trip_id": trip_id})
    rows = [dict(r) for r in res.mappings().all()]
    return {"trip_id": trip_id, "stops": rows}


@app.get("/api/trips/{trip_id}/booked-seats")
async def get_booked_seats(trip_id: int, board_order: int, alight_order: int, db=Depends(get_async_db)):
    query = text(
        """
        SELECT DISTINCT seat_number FROM bookings
        WHERE trip_id = :trip_id
          AND NOT (alight_stop_order <= :board_order OR board_stop_order >= :alight_order);
        """
    )
    res = await db.execute(query, {"trip_id": trip_id, "board_order": board_order, "alight_order": alight_order})
    booked = [r[0] for r in res.all()]
    return {"trip_id": trip_id, "booked_seats": booked}


@app.get("/api/trips/{trip_id}/manifest")
async def get_trip_manifest(trip_id: int, db=Depends(get_async_db), current_user: User = Depends(require_roles('driver', 'admin'))):
    """Driver/Admin-only: passenger list for a trip, with names and stops."""
    query = text(
        """
        SELECT b.seat_number, b.user_id, u.full_name, u.phone, b.board_stop_order, b.alight_stop_order,
               (SELECT stop_name FROM route_stops
                 WHERE route_id = trips.route_id AND stop_order = b.board_stop_order) AS board_stop,
               (SELECT stop_name FROM route_stops
                 WHERE route_id = trips.route_id AND stop_order = b.alight_stop_order) AS alight_stop
        FROM bookings b
        LEFT JOIN users u ON u.id = b.user_id
        JOIN trips ON trips.id = b.trip_id
        WHERE b.trip_id = :trip_id
        ORDER BY b.seat_number ASC;
        """
    )
    trip = (await db.execute(text("SELECT route_id FROM trips WHERE id = :id;"), {"id": trip_id})).mappings().first()
    if trip is None:
        raise HTTPException(status_code=404, detail="Trip not found.")
    res = await db.execute(query, {"trip_id": trip_id})
    rows = [dict(r) for r in res.mappings().all()]

    # Driver access is limited to trips assigned to them; admins see everything.
    if current_user.role == 'driver':
        driver_trip = (await db.execute(
            text("SELECT id FROM trips WHERE id = :id AND driver_id = :driver_id;"),
            {"id": trip_id, "driver_id": current_user.id},
        )).scalars().first()
        if driver_trip is None:
            raise HTTPException(status_code=403, detail="This trip is not assigned to you.")

    return {"trip_id": trip_id, "manifest": rows}


@app.get("/api/driver/trips")
async def driver_trips(db=Depends(get_async_db), current_user: User = Depends(require_roles('driver', 'admin'))):
    """Driver/Admin-only: the trips assigned to the authenticated driver
    (or every trip, for admins), with route and vehicle details."""
    base = """
        SELECT t.id, t.name, t.status, t.scheduled_at, t.current_stop_order,
               r.name AS route_name, r.route_type,
               v.plate_number, v.is_electric, vt.seat_capacity, vt.seat_layout
        FROM trips t
        JOIN routes r ON r.id = t.route_id
        LEFT JOIN vehicles v ON v.id = t.vehicle_id
        LEFT JOIN vehicle_types vt ON vt.id = v.vehicle_type_id
    """
    if current_user.role == 'admin':
        rows = (await db.execute(text(base + " ORDER BY t.id ASC;"))).mappings().all()
    else:
        rows = (await db.execute(
            text(base + " WHERE t.driver_id = :driver_id ORDER BY t.id ASC;"),
            {"driver_id": current_user.id},
        )).mappings().all()

    return {"trips": [dict(r) for r in rows]}


class TripStatusRequest(BaseModel):
    status: str


@app.patch("/api/trips/{trip_id}/status")
async def update_trip_status(trip_id: int, payload: TripStatusRequest, db=Depends(get_async_db), current_user: User = Depends(require_roles('driver', 'admin'))):
    """Driver/Admin-only: update a trip's lifecycle status."""
    allowed = {'scheduled', 'boarding', 'in_transit', 'completed', 'cancelled'}
    if payload.status not in allowed:
        raise HTTPException(status_code=400, detail=f"status must be one of: {', '.join(sorted(allowed))}")

    trip = (await db.execute(text("SELECT id FROM trips WHERE id = :id;"), {"id": trip_id})).mappings().first()
    if trip is None:
        raise HTTPException(status_code=404, detail="Trip not found.")
    if current_user.role == 'driver':
        owner = (await db.execute(
            text("SELECT id FROM trips WHERE id = :id AND driver_id = :driver_id;"),
            {"id": trip_id, "driver_id": current_user.id},
        )).scalars().first()
        if owner is None:
            raise HTTPException(status_code=403, detail="This trip is not assigned to you.")

    await db.execute(text("UPDATE trips SET status = :status WHERE id = :id;"), {"status": payload.status, "id": trip_id})
    await db.commit()
    await manager.broadcast_trip(trip_id, {"event": "trip_status", "trip_id": trip_id, "status": payload.status})
    return {"trip_id": trip_id, "status": payload.status}


class BookingRequest(BaseModel):
    trip_id: int
    seat_number: int
    board_stop_order: int
    alight_stop_order: int


@app.post("/api/book-seat")
async def book_seat(booking: BookingRequest, db=Depends(get_async_db), current_user: User = Depends(get_current_user)):
    """Create a booking for the AUTHENTICATED user (the client cannot choose
    who the booking belongs to)."""
    try:
        insert_booking = text(
            "INSERT INTO bookings (trip_id, user_id, seat_number, board_stop_order, alight_stop_order, status, payment_status) VALUES (:trip_id, :user_id, :seat_number, :board_order, :alight_order, :status, :payment_status) RETURNING id;"
        )
        res = await db.execute(
            insert_booking,
            {
                "trip_id": booking.trip_id,
                "user_id": current_user.id,
                "seat_number": booking.seat_number,
                "board_order": booking.board_stop_order,
                "alight_order": booking.alight_stop_order,
                "status": 'pending',
                "payment_status": 'unpaid',
            },
        )
        booking_id = res.scalar_one()

        insert_payment = text(
            "INSERT INTO payments (booking_id, provider, provider_payload, amount, status) VALUES (:booking_id, :provider, :payload, :amount, :status) RETURNING id;"
        )
        pres = await db.execute(
            insert_payment,
            {"booking_id": booking_id, "provider": 'mpesa_sim', "payload": None, "amount": 500.00, "status": 'initiated'},
        )
        payment_id = pres.scalar_one()

        await db.commit()

    except DBAPIError as e:
        await db.rollback()
        msg = str(e)
        if 'Seat conflict' in msg or 'Seat conflict for trip' in msg:
            raise HTTPException(status_code=400, detail='Seat is already occupied for this specific route segment.')
        raise HTTPException(status_code=500, detail=msg)

    # Notify listeners about pending booking (so drivers/other systems can be aware)
    await manager.broadcast_trip(booking.trip_id, {
        "event": "booking_pending",
        "trip_id": booking.trip_id,
        "seat_number": booking.seat_number,
        "booking_id": booking_id,
        "board_stop_order": booking.board_stop_order,
        "alight_stop_order": booking.alight_stop_order,
    })

    # Recompute the seat chain and fire relay/waitlist notifications: the
    # passenger ahead is told the seat continues, waitlisted users learn about
    # any newly freed segments.
    stop_names = await trip_stop_names(db, booking.trip_id)
    chain = await recompute_chain(db, booking.trip_id, booking.seat_number)
    await notify_chain_change(db, manager, booking.trip_id, booking.seat_number, chain, stop_names)

    return {"status": "pending", "booking_id": booking_id, "payment_id": payment_id, "message": "Booking created and awaiting payment."}


class PaymentRequest(BaseModel):
    phone_number: str
    amount: float
    booking_id: int


@app.post("/api/pay/mpesa-stk")
async def trigger_mpesa_stk(payment: PaymentRequest, db=Depends(get_async_db), current_user: User = Depends(get_current_user)):
    """
    Simulate sending an M-Pesa STK push and immediately mark payment completed
    for demo purposes. (When Daraja credentials are configured, use
    POST /api/pay/daraja/stk for a real STK push instead.)
    This will update the payments table and set booking to confirmed.
    """
    try:
        # Ensure the booking the payment refers to actually exists, so a stray
        # booking_id can never be silently marked as paid.
        booking_check = await db.execute(
            text("SELECT id, user_id FROM bookings WHERE id = :booking_id;"), {"booking_id": payment.booking_id}
        )
        booking_row_full = booking_check.mappings().first()
        if booking_row_full is None:
            raise HTTPException(status_code=404, detail=f"Booking {payment.booking_id} does not exist.")

        # Only the passenger who owns the booking (or an admin) may pay for it.
        if booking_row_full["user_id"] != current_user.id and current_user.role != 'admin':
            raise HTTPException(status_code=403, detail="You can only pay for your own booking.")

        # Find existing payment row
        q = text("SELECT id, status FROM payments WHERE booking_id = :booking_id LIMIT 1;")
        res = await db.execute(q, {"booking_id": payment.booking_id})
        p_row = res.mappings().first()
        payload = json.dumps({"phone": payment.phone_number, "simulated": True})
        if p_row:
            payment_id = p_row['id']
            await db.execute(
                text("""
                    UPDATE payments
                    SET status = :status, provider = :provider, provider_payload = :payload,
                        provider_reference = :ref, phone_number = :phone, callback_verified = true
                    WHERE id = :id;
                """),
                {"status": 'completed', "provider": 'mpesa_sim', "payload": payload,
                 "ref": f"SIM-{payment.booking_id}", "phone": payment.phone_number, "id": payment_id},
            )
        else:
            ir = await db.execute(
                text("""
                    INSERT INTO payments (booking_id, provider, provider_payload, amount, status, provider_reference, phone_number, callback_verified)
                    VALUES (:booking_id, :provider, :payload, :amount, :status, :ref, :phone, true) RETURNING id;
                """),
                {"booking_id": payment.booking_id, "provider": 'mpesa_sim', "payload": payload,
                 "amount": payment.amount, "status": 'completed', "ref": f"SIM-{payment.booking_id}",
                 "phone": payment.phone_number},
            )
            payment_id = ir.scalar_one()

        br = await db.execute(
            text("UPDATE bookings SET payment_status = :ps, status = :s WHERE id = :id RETURNING trip_id, seat_number, board_stop_order, alight_stop_order;"),
            {"ps": 'paid', "s": 'confirmed', "id": payment.booking_id},
        )
        booking_row = br.mappings().first()
        await db.commit()

    except HTTPException:
        raise
    except Exception as e:
        await db.rollback()
        raise HTTPException(status_code=500, detail=str(e))

    # Broadcast seat_booked so UIs and drivers know seat is now taken
    if booking_row:
        await manager.broadcast_trip(booking_row['trip_id'], {
            'event': 'seat_booked',
            'trip_id': booking_row['trip_id'],
            'seat_number': booking_row['seat_number'],
            'board_stop_order': booking_row['board_stop_order'],
            'alight_stop_order': booking_row['alight_stop_order'],
            'booking_id': payment.booking_id,
        })

        # Recompute chain + relay notifications now that the booking is confirmed.
        stop_names = await trip_stop_names(db, booking_row['trip_id'])
        chain = await recompute_chain(db, booking_row['trip_id'], booking_row['seat_number'])
        await notify_chain_change(db, manager, booking_row['trip_id'], booking_row['seat_number'], chain, stop_names)

        # Confirm notification for the passenger.
        await create_notification(
            db, booking_row_full["user_id"], 'booking_confirmed',
            f"Seat #{booking_row['seat_number']} confirmed",
            f"Payment received. Your seat #{booking_row['seat_number']} is confirmed on trip #{booking_row['trip_id']}.",
            {"trip_id": booking_row['trip_id'], "seat_number": booking_row['seat_number'], "booking_id": payment.booking_id},
        )
        await db.commit()
        await manager.send_to_user(booking_row_full["user_id"], {
            "event": "booking_confirmed",
            "trip_id": booking_row['trip_id'],
            "seat_number": booking_row['seat_number'],
            "booking_id": payment.booking_id,
        })

    return {
        "status": "success",
        "message": f"M-Pesa STK push simulated and payment recorded for booking {payment.booking_id}",
        "payment_id": payment_id,
        "booking_id": payment.booking_id,
    }


# --------------------------------------------------------------------------
# Real M-Pesa Daraja STK push (used when MPESA_* env vars are configured)
# --------------------------------------------------------------------------
class DarajaStkRequest(BaseModel):
    booking_id: int
    phone_number: str
    amount: float = 500.0


@app.post("/api/pay/daraja/stk")
async def daraja_stk(payload: DarajaStkRequest, db=Depends(get_async_db), current_user: User = Depends(get_current_user)):
    """Initiate a REAL M-Pesa STK push via the Safaricom Daraja API.

    Requires MPESA_CONSUMER_KEY / MPESA_CONSUMER_SECRET / MPESA_PASSKEY to be
    configured, otherwise returns 400 and suggests the simulated endpoint.
    """
    if not daraja.configured():
        raise HTTPException(
            status_code=400,
            detail="Daraja is not configured. Set MPESA_CONSUMER_KEY, MPESA_CONSUMER_SECRET and MPESA_PASSKEY (see .env.example), or use POST /api/pay/mpesa-stk for the simulator.",
        )

    booking = (await db.execute(
        text("SELECT id, user_id FROM bookings WHERE id = :id;"), {"id": payload.booking_id}
    )).mappings().first()
    if booking is None:
        raise HTTPException(status_code=404, detail=f"Booking {payload.booking_id} does not exist.")
    if booking["user_id"] != current_user.id and current_user.role != 'admin':
        raise HTTPException(status_code=403, detail="You can only pay for your own booking.")

    try:
        resp = await daraja.stk_push(
            phone=payload.phone_number,
            amount=payload.amount,
            account_reference=f"BUSGO-{payload.booking_id}",
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Daraja request failed: {e}")

    checkout_id = resp.get("CheckoutRequestID")
    if not checkout_id:
        raise HTTPException(status_code=502, detail=f"Daraja rejected the STK push: {resp}")

    # Record the pending payment linked to the provider reference.
    await db.execute(
        text("""
            UPDATE payments
            SET provider = 'mpesa_daraja', status = 'initiated',
                provider_reference = :ref, phone_number = :phone,
                provider_payload = CAST(:payload AS jsonb)
            WHERE booking_id = :booking_id;
        """),
        {"ref": checkout_id, "phone": payload.phone_number,
         "payload": json.dumps(resp), "booking_id": payload.booking_id},
    )
    await db.commit()

    return {
        "status": "initiated",
        "message": "STK push sent — enter your M-Pesa PIN to approve.",
        "provider": "mpesa_daraja",
        "checkout_request_id": checkout_id,
        "booking_id": payload.booking_id,
    }


@app.post("/api/pay/daraja/callback")
async def daraja_callback(body: dict, db=Depends(get_async_db)):
    """Safaricom webhook: verify + apply the STK push result idempotently.

    Daraja calls this URL (MPESA_CALLBACK_URL) after the customer approves or
    rejects the push. We look the payment up by CheckoutRequestID and mark the
    booking confirmed only when ResultCode == 0.
    """
    parsed = daraja.parse_callback(body)
    if parsed is None:
        raise HTTPException(status_code=400, detail="Malformed Daraja callback.")

    checkout_id = parsed["checkout_request_id"]
    p_row = (await db.execute(
        text("SELECT id, booking_id FROM payments WHERE provider_reference = :ref LIMIT 1;"),
        {"ref": checkout_id},
    )).mappings().first()
    if p_row is None:
        # Unknown/duplicate callback — still acknowledge (Daraja retries).
        return {"ResultCode": 0, "ResultDesc": "Accepted"}

    payment_id = p_row["id"]
    success = parsed["result_code"] == 0
    new_status = "completed" if success else "failed"

    await db.execute(
        text("""
            UPDATE payments
            SET status = :status, callback_payload = CAST(:cb AS jsonb), callback_verified = true
            WHERE id = :id;
        """),
        {"status": new_status, "cb": json.dumps(body), "id": payment_id},
    )

    booking_row = None
    if success:
        br = await db.execute(
            text("""
                UPDATE bookings SET payment_status = 'paid', status = 'confirmed'
                WHERE id = :id
                RETURNING id, trip_id, seat_number, board_stop_order, alight_stop_order, user_id;
            """),
            {"id": p_row["booking_id"]},
        )
        booking_row = br.mappings().first()
    else:
        # Failed payment -> release the pending booking so the seat frees up.
        await db.execute(
            text("UPDATE bookings SET status = 'cancelled', payment_status = 'unpaid' WHERE id = :id;"),
            {"id": p_row["booking_id"]},
        )
    await db.commit()

    if booking_row is not None:
        await manager.broadcast_trip(booking_row["trip_id"], {
            "event": "seat_booked",
            "trip_id": booking_row["trip_id"],
            "seat_number": booking_row["seat_number"],
            "board_stop_order": booking_row["board_stop_order"],
            "alight_stop_order": booking_row["alight_stop_order"],
            "booking_id": booking_row["id"],
        })
        stop_names = await trip_stop_names(db, booking_row["trip_id"])
        chain = await recompute_chain(db, booking_row["trip_id"], booking_row["seat_number"])
        await notify_chain_change(db, manager, booking_row["trip_id"], booking_row["seat_number"], chain, stop_names)
        await create_notification(
            db, booking_row["user_id"], "payment_update",
            "Payment received",
            f"M-Pesa confirmed for seat #{booking_row['seat_number']} on trip #{booking_row['trip_id']}.",
            {"trip_id": booking_row["trip_id"], "seat_number": booking_row["seat_number"]},
        )
        await db.commit()

    return {"ResultCode": 0, "ResultDesc": "Accepted"}


# --------------------------------------------------------------------------
# Bookings: cancellation (frees the seat chain + notifies waitlists)
# --------------------------------------------------------------------------
@app.delete("/api/bookings/{booking_id}")
async def cancel_booking(booking_id: int, db=Depends(get_async_db), current_user: User = Depends(get_current_user)):
    booking = (await db.execute(
        text("SELECT id, trip_id, seat_number, user_id FROM bookings WHERE id = :id;"),
        {"id": booking_id},
    )).mappings().first()
    if booking is None:
        raise HTTPException(status_code=404, detail="Booking not found.")
    if booking["user_id"] != current_user.id and current_user.role not in ('admin', 'driver'):
        raise HTTPException(status_code=403, detail="You can only cancel your own booking.")

    await db.execute(
        text("UPDATE bookings SET status = 'cancelled' WHERE id = :id;"), {"id": booking_id}
    )
    await db.commit()

    # The seat just freed up — recompute the chain and let waitlists know.
    stop_names = await trip_stop_names(db, booking["trip_id"])
    chain = await recompute_chain(db, booking["trip_id"], booking["seat_number"])
    await notify_chain_change(db, manager, booking["trip_id"], booking["seat_number"], chain, stop_names)
    await manager.broadcast_trip(booking["trip_id"], {
        "event": "booking_cancelled",
        "trip_id": booking["trip_id"],
        "seat_number": booking["seat_number"],
        "booking_id": booking_id,
    })
    return {"deleted": booking_id, "seat_freed": True}


# --------------------------------------------------------------------------
# Seat chains & seat map (public) — the relay view
# --------------------------------------------------------------------------
@app.get("/api/trips/{trip_id}/chains")
async def get_trip_chains(trip_id: int, db=Depends(get_async_db)):
    """Per-seat chains: ordered segment bookings sharing each physical seat."""
    capacity = (await db.execute(
        text("""
            SELECT vt.seat_capacity
            FROM trips t
            LEFT JOIN vehicles v ON v.id = t.vehicle_id
            LEFT JOIN vehicle_types vt ON vt.id = v.vehicle_type_id
            WHERE t.id = :trip_id;
        """),
        {"trip_id": trip_id},
    )).scalars().first()
    if capacity is None:
        raise HTTPException(status_code=404, detail="Trip not found.")

    chain_rows = (await db.execute(
        text("""
            SELECT b.seat_number, b.id AS booking_id, b.board_stop_order, b.alight_stop_order,
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
            ORDER BY b.seat_number ASC, b.board_stop_order ASC;
        """),
        {"trip_id": trip_id},
    )).mappings().all()

    chains: dict[int, list[dict]] = {}
    for r in chain_rows:
        chains.setdefault(r["seat_number"], []).append({
            "booking_id": r["booking_id"],
            "board_stop_order": r["board_stop_order"],
            "alight_stop_order": r["alight_stop_order"],
            "board_stop": r["board_stop"],
            "alight_stop": r["alight_stop"],
            "passenger_name": r["passenger_name"] or "Walk-up / Unregistered",
        })

    return {
        "trip_id": trip_id,
        "seat_capacity": capacity,
        "chains": [{"seat_number": seat, "links": links} for seat, links in sorted(chains.items())],
    }


@app.get("/api/trips/{trip_id}/seat-map")
async def get_seat_map(trip_id: int, board_order: int = 1, alight_order: int = 2, db=Depends(get_async_db)):
    """Per-seat availability for the requested board→alight segment.

    state: 'free' (no overlap) | 'partial' (seat frees before your alight) | 'full'.
    next_free_stop: for partial seats, the stop where the seat frees up.
    """
    rows = (await db.execute(
        text("""
            SELECT vt.seat_capacity
            FROM trips t
            LEFT JOIN vehicles v ON v.id = t.vehicle_id
            LEFT JOIN vehicle_types vt ON vt.id = v.vehicle_type_id
            WHERE t.id = :trip_id;
        """),
        {"trip_id": trip_id},
    )).mappings().first()
    if rows is None:
        raise HTTPException(status_code=404, detail="Trip not found.")
    capacity = rows["seat_capacity"] or 0

    # All non-cancelled bookings overlapping the requested segment, per seat.
    overlaps = (await db.execute(
        text("""
            SELECT b.seat_number, b.board_stop_order, b.alight_stop_order,
                   (SELECT stop_name FROM route_stops
                     WHERE route_id = t.route_id AND stop_order = b.alight_stop_order) AS alight_stop
            FROM bookings b
            JOIN trips t ON t.id = b.trip_id
            WHERE b.trip_id = :trip_id
              AND b.status != 'cancelled'
              AND NOT (b.alight_stop_order <= :bo OR b.board_stop_order >= :ao)
            ORDER BY b.seat_number ASC, b.alight_stop_order DESC;
        """),
        {"trip_id": trip_id, "bo": board_order, "ao": alight_order},
    )).mappings().all()

    by_seat: dict[int, list[dict]] = {}
    for o in overlaps:
        by_seat.setdefault(o["seat_number"], []).append(dict(o))

    def classify(intervals: list[dict]) -> tuple[str, dict | None]:
        """Merge overlapping [board, alight) intervals over the requested
        segment. Return the seat state + the first free slot (relay point).

        - 'full'    : the seat is covered continuously across [board, alight).
        - 'partial' : covered for part of the segment; it frees at next_free.
        - 'free'    : no occupancy at all (handled by the caller).
        """
        merged: list[list[int]] = []
        for iv in sorted(intervals, key=lambda x: (x["board_stop_order"], x["alight_stop_order"])):
            b, a = iv["board_stop_order"], iv["alight_stop_order"]
            if merged and b <= merged[-1][1]:
                merged[-1][1] = max(merged[-1][1], a)
            else:
                merged.append([b, a])

        # Gap before the first occupant?
        if merged[0][0] > board_order:
            return "partial", {"stop_order": board_order, "stop": None}
        cursor = merged[0][1]
        for b, a in merged[1:]:
            if b > cursor:
                return "partial", {"stop_order": cursor, "stop": None}
            cursor = max(cursor, a)
        if cursor < alight_order:
            return "partial", {"stop_order": cursor, "stop": None}
        return "full", None

    stop_by_order = {o["alight_stop_order"]: o["alight_stop"] for iv in overlaps for o in [iv]}

    seats = []
    for num in range(1, capacity + 1):
        occ = by_seat.get(num, [])
        if not occ:
            seats.append({"seat_number": num, "state": "free", "next_free_stop": None, "next_free_stop_order": None})
            continue
        state, free_at = classify(occ)
        if state == "partial" and free_at is not None:
            # Name the freeing stop for the driver/relay UI.
            free_name = stop_by_order.get(free_at["stop_order"], None)
            if free_name is None:
                stop_name_row = (await db.execute(
                    text("""
                        SELECT stop_name FROM route_stops
                        WHERE route_id = (SELECT route_id FROM trips WHERE id = :trip_id)
                          AND stop_order = :so;
                    """),
                    {"trip_id": trip_id, "so": free_at["stop_order"]},
                )).scalars().first()
                free_name = stop_name_row
            seats.append({
                "seat_number": num,
                "state": "partial",
                "next_free_stop": free_name,
                "next_free_stop_order": free_at["stop_order"],
            })
        else:
            seats.append({"seat_number": num, "state": state, "next_free_stop": None, "next_free_stop_order": None})

    return {
        "trip_id": trip_id,
        "board_order": board_order,
        "alight_order": alight_order,
        "seat_capacity": capacity,
        "seats": seats,
    }


# --------------------------------------------------------------------------
# Waitlist (seat interests) — "notify me when this segment frees up"
# --------------------------------------------------------------------------
class SeatInterestIn(BaseModel):
    trip_id: int
    board_stop_order: int
    alight_stop_order: int
    seat_number: int | None = None


@app.post("/api/seat-interests")
async def create_seat_interest(payload: SeatInterestIn, db=Depends(get_async_db), current_user: User = Depends(get_current_user)):
    if payload.board_stop_order >= payload.alight_stop_order:
        raise HTTPException(status_code=400, detail="Alighting stop must be further down the route than boarding.")
    row = (await db.execute(
        text("""
            INSERT INTO seat_interests (user_id, trip_id, board_stop_order, alight_stop_order, seat_number, status, created_at)
            VALUES (:uid, :trip_id, :board, :alight, :seat, 'active', now())
            RETURNING id, trip_id, board_stop_order, alight_stop_order, seat_number, status;
        """),
        {"uid": current_user.id, "trip_id": payload.trip_id, "board": payload.board_stop_order,
         "alight": payload.alight_stop_order, "seat": payload.seat_number},
    )).mappings().first()
    await db.commit()
    return dict(row)


@app.get("/api/seat-interests")
async def list_seat_interests(db=Depends(get_async_db), current_user: User = Depends(get_current_user)):
    rows = (await db.execute(
        text("""
            SELECT si.id, si.trip_id, si.board_stop_order, si.alight_stop_order, si.seat_number, si.status, si.created_at,
                   t.name AS trip_name, r.name AS route_name,
                   (SELECT stop_name FROM route_stops WHERE route_id = r.id AND stop_order = si.board_stop_order) AS board_stop,
                   (SELECT stop_name FROM route_stops WHERE route_id = r.id AND stop_order = si.alight_stop_order) AS alight_stop
            FROM seat_interests si
            JOIN trips t ON t.id = si.trip_id
            JOIN routes r ON r.id = t.route_id
            WHERE si.user_id = :uid
            ORDER BY si.created_at DESC;
        """),
        {"uid": current_user.id},
    )).mappings().all()
    return {"interests": [dict(r) for r in rows]}


@app.delete("/api/seat-interests/{interest_id}")
async def delete_seat_interest(interest_id: int, db=Depends(get_async_db), current_user: User = Depends(get_current_user)):
    row = (await db.execute(
        text("SELECT id, user_id FROM seat_interests WHERE id = :id;"), {"id": interest_id}
    )).mappings().first()
    if row is None:
        raise HTTPException(status_code=404, detail="Waitlist entry not found.")
    if row["user_id"] != current_user.id and current_user.role != 'admin':
        raise HTTPException(status_code=403, detail="You can only remove your own waitlist entry.")
    await db.execute(text("UPDATE seat_interests SET status = 'cancelled' WHERE id = :id;"), {"id": interest_id})
    await db.commit()
    return {"deleted": interest_id}


# --------------------------------------------------------------------------
# Notifications (in-app + WS push)
# --------------------------------------------------------------------------
@app.get("/api/notifications")
async def list_notifications(limit: int = 30, db=Depends(get_async_db), current_user: User = Depends(get_current_user)):
    rows = (await db.execute(
        text("""
            SELECT id, kind, title, body, payload, read, created_at
            FROM notifications
            WHERE user_id = :uid
            ORDER BY created_at DESC, id DESC
            LIMIT :limit;
        """),
        {"uid": current_user.id, "limit": limit},
    )).mappings().all()
    unread = (await db.execute(
        text("SELECT count(*) FROM notifications WHERE user_id = :uid AND read = false;"),
        {"uid": current_user.id},
    )).scalar()
    return {"notifications": [dict(r) for r in rows], "unread": unread}


@app.post("/api/notifications/{notif_id}/read")
async def mark_notification_read(notif_id: int, db=Depends(get_async_db), current_user: User = Depends(get_current_user)):
    row = (await db.execute(
        text("SELECT id, user_id FROM notifications WHERE id = :id;"), {"id": notif_id}
    )).mappings().first()
    if row is None:
        raise HTTPException(status_code=404, detail="Notification not found.")
    if row["user_id"] != current_user.id:
        raise HTTPException(status_code=403, detail="Not your notification.")
    await db.execute(text("UPDATE notifications SET read = true WHERE id = :id;"), {"id": notif_id})
    await db.commit()
    return {"read": True}


@app.post("/api/notifications/read-all")
async def mark_all_notifications_read(db=Depends(get_async_db), current_user: User = Depends(get_current_user)):
    await db.execute(
        text("UPDATE notifications SET read = true WHERE user_id = :uid AND read = false;"),
        {"uid": current_user.id},
    )
    await db.commit()
    return {"read_all": True}


# --------------------------------------------------------------------------
# Driver: report which stop the bus is at (drives seat-release notifications)
# --------------------------------------------------------------------------
class CurrentStopRequest(BaseModel):
    stop_order: int


@app.patch("/api/trips/{trip_id}/current-stop")
async def set_current_stop(trip_id: int, payload: CurrentStopRequest, db=Depends(get_async_db), current_user: User = Depends(require_roles('driver', 'admin'))):
    trip = (await db.execute(text("SELECT id, route_id, driver_id FROM trips WHERE id = :id;"), {"id": trip_id})).mappings().first()
    if trip is None:
        raise HTTPException(status_code=404, detail="Trip not found.")
    if current_user.role == 'driver' and trip["driver_id"] != current_user.id:
        raise HTTPException(status_code=403, detail="This trip is not assigned to you.")

    # Validate the stop belongs to the route.
    valid = (await db.execute(
        text("SELECT id FROM route_stops WHERE route_id = :rid AND stop_order = :so;"),
        {"rid": trip["route_id"], "so": payload.stop_order},
    )).scalars().first()
    if valid is None:
        raise HTTPException(status_code=400, detail="Stop not found on this trip's route.")

    await db.execute(
        text("UPDATE trips SET current_stop_order = :so WHERE id = :id;"),
        {"so": payload.stop_order, "id": trip_id},
    )
    await db.commit()

    # Release seats whose passengers alight here + notify the relay/waitlists.
    released = await notify_seat_released_at_stop(db, manager, trip_id, payload.stop_order)
    await manager.broadcast_trip(trip_id, {
        "event": "trip_at_stop",
        "trip_id": trip_id,
        "stop_order": payload.stop_order,
        "released_seats": released,
    })
    return {"trip_id": trip_id, "stop_order": payload.stop_order, "released_seats": released}


# --------------------------------------------------------------------------
# Admin: Fleet & Catalog management (admin only)
# --------------------------------------------------------------------------
class VehicleTypeIn(BaseModel):
    slug: str
    display_name: str
    seat_capacity: int


class VehicleIn(BaseModel):
    plate_number: str
    vehicle_type_id: int
    is_electric: bool = False


class RouteIn(BaseModel):
    name: str
    country: str = 'KE'
    route_type: str = 'stopwise'   # 'direct' | 'stopwise'
    stops: list[str] = []


class TripIn(BaseModel):
    route_id: int
    vehicle_id: int | None = None
    driver_id: int | None = None
    name: str
    scheduled_at: str | None = None
    status: str = 'scheduled'


class TripPatch(BaseModel):
    route_id: int | None = None
    vehicle_id: int | None = None
    driver_id: int | None = None
    name: str | None = None
    scheduled_at: str | None = None
    status: str | None = None


@app.get("/api/admin/vehicle-types")
async def admin_list_vehicle_types(db=Depends(get_async_db), _: User = Depends(require_roles('admin'))):
    rows = (await db.execute(text("SELECT id, slug, display_name, seat_capacity, seat_layout FROM vehicle_types ORDER BY id;"))).mappings().all()
    return {"vehicle_types": [dict(r) for r in rows]}


@app.post("/api/admin/vehicle-types")
async def admin_create_vehicle_type(payload: VehicleTypeIn, db=Depends(get_async_db), _: User = Depends(require_roles('admin'))):
    res = await db.execute(
        text("""
            INSERT INTO vehicle_types (slug, display_name, seat_capacity, seat_layout)
            VALUES (:slug, :display_name, :seat_capacity, CAST(:layout AS jsonb))
            RETURNING id, slug, display_name, seat_capacity, seat_layout;
        """),
        {"slug": payload.slug, "display_name": payload.display_name,
         "seat_capacity": payload.seat_capacity,
         "layout": json.dumps(_default_seat_layout(payload.seat_capacity))},
    )
    row = dict(res.mappings().first())
    await db.commit()
    return row


@app.get("/api/admin/vehicles")
async def admin_list_vehicles(db=Depends(get_async_db), _: User = Depends(require_roles('admin'))):
    rows = (await db.execute(
        text("""
        SELECT v.id, v.plate_number, v.vehicle_type_id, v.is_electric, v.created_at,
               vt.slug AS category, vt.display_name AS vehicle_type_name, vt.seat_capacity
        FROM vehicles v
        JOIN vehicle_types vt ON vt.id = v.vehicle_type_id
        ORDER BY v.id;
        """)
    )).mappings().all()
    return {"vehicles": [dict(r) for r in rows]}


@app.post("/api/admin/vehicles")
async def admin_create_vehicle(payload: VehicleIn, db=Depends(get_async_db), _: User = Depends(require_roles('admin'))):
    try:
        res = await db.execute(
            text("INSERT INTO vehicles (plate_number, vehicle_type_id, is_electric) VALUES (:plate, :vt_id, :electric) RETURNING id;"),
            {"plate": payload.plate_number, "vt_id": payload.vehicle_type_id, "electric": payload.is_electric},
        )
        vid = res.scalar_one()
        await db.commit()
    except DBAPIError as e:
        await db.rollback()
        if 'unique' in str(e).lower() or 'duplicate' in str(e).lower():
            raise HTTPException(status_code=409, detail="A vehicle with that plate number already exists.")
        raise HTTPException(status_code=500, detail=str(e))
    return {"id": vid, "plate_number": payload.plate_number, "vehicle_type_id": payload.vehicle_type_id, "is_electric": payload.is_electric}


@app.delete("/api/admin/vehicles/{vehicle_id}")
async def admin_delete_vehicle(vehicle_id: int, db=Depends(get_async_db), _: User = Depends(require_roles('admin'))):
    row = (await db.execute(text("SELECT id FROM vehicles WHERE id = :id;"), {"id": vehicle_id})).mappings().first()
    if row is None:
        raise HTTPException(status_code=404, detail="Vehicle not found.")
    await db.execute(text("DELETE FROM vehicles WHERE id = :id;"), {"id": vehicle_id})
    await db.commit()
    return {"deleted": vehicle_id}


@app.get("/api/routes")
async def list_routes(db=Depends(get_async_db)):
    """Public: all routes with their stops."""
    routes = (await db.execute(text("SELECT id, name, country, route_type FROM routes ORDER BY id;"))).mappings().all()
    out = []
    for r in routes:
        stops = (await db.execute(
            text("SELECT id, stop_name, stop_order FROM route_stops WHERE route_id = :rid ORDER BY stop_order;"),
            {"rid": r["id"]},
        )).mappings().all()
        out.append({**dict(r), "stops": [dict(s) for s in stops]})
    return {"routes": out}
# --------------------------------------------------------------------------
# Admin: driver management
# --------------------------------------------------------------------------
class DriverIn(BaseModel):
    full_name: str
    email: str
    phone: str | None = None
    password: str


@app.get("/api/admin/drivers")
async def admin_list_drivers(db=Depends(get_async_db), _: User = Depends(require_roles('admin'))):
    rows = (await db.execute(
        text("SELECT id, full_name, email, phone, created_at FROM users WHERE role = 'driver' ORDER BY id;")
    )).mappings().all()
    return {"drivers": [dict(r) for r in rows]}


@app.post("/api/admin/drivers")
async def admin_create_driver(payload: DriverIn, db=Depends(get_async_db), _: User = Depends(require_roles('admin'))):
    existing = (await db.execute(text("SELECT id FROM users WHERE email = :email;"), {"email": payload.email})).scalars().first()
    if existing is not None:
        raise HTTPException(status_code=409, detail="A user with that email already exists.")
    row = (await db.execute(
        text("""
            INSERT INTO users (full_name, email, phone, password_hash, role, created_at)
            VALUES (:name, :email, :phone, :pw, 'driver', now())
            RETURNING id, full_name, email, phone, role;
        """),
        {"name": payload.full_name, "email": payload.email, "phone": payload.phone,
         "pw": hash_password(payload.password)},
    )).mappings().first()
    await db.commit()
    return dict(row)


# --------------------------------------------------------------------------
# Admin: analytics + payment log
# --------------------------------------------------------------------------
@app.get("/api/admin/analytics")
async def admin_analytics(db=Depends(get_async_db), _: User = Depends(require_roles('admin'))):
    """Revenue + booking/occupancy analytics for the admin dashboard."""
    # Revenue segmented by time period (today / week / month / year), plus the
    # previous equivalent period so the UI can render ▲/▼ trend indicators.
    revenue = (await db.execute(
        text("""
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
        """)
    )).mappings().first()

    prev = (await db.execute(
        text("""
            SELECT
              COALESCE(SUM(p.amount) FILTER (WHERE p.created_at >= date_trunc('week', now()) - interval '7 days'
                                              AND p.created_at < date_trunc('week', now())), 0) AS week,
              COALESCE(SUM(p.amount) FILTER (WHERE p.created_at >= date_trunc('month', now()) - interval '1 month'
                                              AND p.created_at < date_trunc('month', now())), 0) AS month,
              COALESCE(SUM(p.amount) FILTER (WHERE p.created_at >= date_trunc('year', now()) - interval '1 year'
                                              AND p.created_at < date_trunc('year', now())), 0) AS year
            FROM payments p
            WHERE p.status = 'completed';
        """)
    )).mappings().first()

    # Bookings per day (last 14 days) for the chart.
    per_day = (await db.execute(
        text("""
            SELECT date_trunc('day', created_at)::date AS day, COUNT(*) AS bookings
            FROM bookings
            WHERE created_at >= now() - interval '14 days'
            GROUP BY 1 ORDER BY 1;
        """)
    )).mappings().all()

    # Occupancy: capacity vs confirmed bookings per trip.
    occupancy = (await db.execute(
        text("""
            SELECT t.id, t.name, r.name AS route_name, vt.seat_capacity,
                   COUNT(b.id) FILTER (WHERE b.status NOT IN ('cancelled')) AS seats_taken
            FROM trips t
            JOIN routes r ON r.id = t.route_id
            LEFT JOIN vehicles v ON v.id = t.vehicle_id
            LEFT JOIN vehicle_types vt ON vt.id = v.vehicle_type_id
            LEFT JOIN bookings b ON b.trip_id = t.id
            GROUP BY t.id, r.name, vt.seat_capacity
            ORDER BY t.id;
        """)
    )).mappings().all()

    return {
        "revenue": dict(revenue),
        "revenue_prev": dict(prev),
        "bookings_per_day": [dict(r) for r in per_day],
        "occupancy": [dict(r) for r in occupancy],
    }


@app.get("/api/admin/payments")
async def admin_payments(limit: int = 50, db=Depends(get_async_db), _: User = Depends(require_roles('admin'))):
    rows = (await db.execute(
        text("""
            SELECT p.id, p.provider, p.status, p.amount, p.phone_number, p.provider_reference,
                   p.callback_verified, p.created_at, b.trip_id, b.seat_number
            FROM payments p
            JOIN bookings b ON b.id = p.booking_id
            ORDER BY p.created_at DESC, p.id DESC
            LIMIT :limit;
        """),
        {"limit": limit},
    )).mappings().all()
    return {"payments": [dict(r) for r in rows]}




@app.get("/api/admin/users")
async def admin_list_users(db=Depends(get_async_db), _: User = Depends(require_roles('admin'))):
    rows = (await db.execute(text("SELECT id, full_name, email, phone, role FROM users ORDER BY id;"))).mappings().all()
    return {"users": [dict(r) for r in rows]}


@app.post("/api/admin/routes")
async def admin_create_route(payload: RouteIn, db=Depends(get_async_db), _: User = Depends(require_roles('admin'))):
    if payload.route_type not in ('direct', 'stopwise'):
        raise HTTPException(status_code=400, detail="route_type must be 'direct' or 'stopwise'.")
    if len(payload.stops) < 2:
        raise HTTPException(status_code=400, detail="A route needs at least 2 stops.")
    if payload.route_type == 'direct' and len(payload.stops) > 2:
        raise HTTPException(status_code=400, detail="Direct routes have exactly 2 stops (origin, destination).")

    res = await db.execute(
        text("INSERT INTO routes (name, country, route_type) VALUES (:name, :country, :route_type) RETURNING id;"),
        {"name": payload.name, "country": payload.country, "route_type": payload.route_type},
    )
    route_id = res.scalar_one()
    for order, stop_name in enumerate(payload.stops, start=1):
        await db.execute(
            text("INSERT INTO route_stops (route_id, stop_name, stop_order) VALUES (:rid, :stop, :order);"),
            {"rid": route_id, "stop": stop_name, "order": order},
        )
    await db.commit()
    return {"id": route_id, "name": payload.name, "country": payload.country, "route_type": payload.route_type, "stops": payload.stops}


@app.delete("/api/admin/routes/{route_id}")
async def admin_delete_route(route_id: int, db=Depends(get_async_db), _: User = Depends(require_roles('admin'))):
    row = (await db.execute(text("SELECT id FROM routes WHERE id = :id;"), {"id": route_id})).mappings().first()
    if row is None:
        raise HTTPException(status_code=404, detail="Route not found.")
    await db.execute(text("DELETE FROM route_stops WHERE route_id = :id;"), {"id": route_id})
    await db.execute(text("DELETE FROM routes WHERE id = :id;"), {"id": route_id})
    await db.commit()
    return {"deleted": route_id}


@app.post("/api/admin/trips")
async def admin_create_trip(payload: TripIn, db=Depends(get_async_db), _: User = Depends(require_roles('admin'))):
    try:
        res = await db.execute(
            text("""
            INSERT INTO trips (route_id, vehicle_id, driver_id, name, scheduled_at, status)
            VALUES (:route_id, :vehicle_id, :driver_id, :name, :scheduled_at, :status)
            RETURNING id;
            """),
            {
                "route_id": payload.route_id,
                "vehicle_id": payload.vehicle_id,
                "driver_id": payload.driver_id,
                "name": payload.name,
                "scheduled_at": payload.scheduled_at,
                "status": payload.status,
            },
        )
        trip_id = res.scalar_one()
        await db.commit()
    except DBAPIError as e:
        await db.rollback()
        if 'foreign key' in str(e).lower() or 'violates' in str(e).lower():
            raise HTTPException(status_code=400, detail="Invalid route, vehicle, or driver id.")
        raise HTTPException(status_code=500, detail=str(e))
    return {"id": trip_id, "name": payload.name, "status": payload.status}


@app.patch("/api/admin/trips/{trip_id}")
async def admin_update_trip(trip_id: int, payload: TripPatch, db=Depends(get_async_db), _: User = Depends(require_roles('admin'))):
    trip = (await db.execute(text("SELECT id FROM trips WHERE id = :id;"), {"id": trip_id})).mappings().first()
    if trip is None:
        raise HTTPException(status_code=404, detail="Trip not found.")

    await db.execute(
        text("""
        UPDATE trips SET
            route_id = COALESCE(:route_id, route_id),
            vehicle_id = COALESCE(:vehicle_id, vehicle_id),
            driver_id = COALESCE(:driver_id, driver_id),
            name = COALESCE(:name, name),
            scheduled_at = COALESCE(:scheduled_at, scheduled_at),
            status = COALESCE(:status, status)
        WHERE id = :id;
        """),
        {
            "id": trip_id,
            "route_id": payload.route_id,
            "vehicle_id": payload.vehicle_id,
            "driver_id": payload.driver_id,
            "name": payload.name,
            "scheduled_at": payload.scheduled_at,
            "status": payload.status,
        },
    )
    await db.commit()
    return {"id": trip_id, "updated": True}


@app.delete("/api/admin/trips/{trip_id}")
async def admin_delete_trip(trip_id: int, db=Depends(get_async_db), _: User = Depends(require_roles('admin'))):
    row = (await db.execute(text("SELECT id FROM trips WHERE id = :id;"), {"id": trip_id})).mappings().first()
    if row is None:
        raise HTTPException(status_code=404, detail="Trip not found.")
    await db.execute(text("DELETE FROM trips WHERE id = :id;"), {"id": trip_id})
    await db.commit()
    return {"deleted": trip_id}


# --------------------------------------------------------------------------
# Passenger: booking history (any authenticated user, own bookings only)
# --------------------------------------------------------------------------
@app.get("/api/user/bookings")
async def user_bookings(db=Depends(get_async_db), current_user: User = Depends(get_current_user)):
    rows = (await db.execute(
        text("""
        SELECT b.id, b.trip_id, b.seat_number, b.board_stop_order, b.alight_stop_order,
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
        ORDER BY b.created_at DESC, b.id DESC;
        """),
        {"uid": current_user.id},
    )).mappings().all()
    return {"bookings": [dict(r) for r in rows]}


@app.websocket("/ws/trip/{trip_id}")
async def trip_websocket(websocket: WebSocket, trip_id: int):
    await manager.connect_trip(websocket, trip_id)
    try:
        while True:
            data = await websocket.receive_text()
            await manager.broadcast_trip(trip_id, {"message": data})
    except WebSocketDisconnect:
        manager.disconnect(websocket)


@app.websocket("/ws/notifications")
async def notifications_websocket(websocket: WebSocket, token: str = ""):
    """Per-user notification channel. Auth via ?token=<jwt> (browsers cannot
    set headers on WebSocket upgrade requests)."""
    user = None
    if token:
        try:
            payload = decode_access_token(token)
            user_id = int(payload.get("sub", 0))
            async with AsyncSessionLocal() as db:
                user = (await db.execute(select(User).where(User.id == user_id))).scalars().first()
        except Exception:
            user = None
    if user is None:
        await websocket.close(code=4401)
        return
    await manager.connect_user(websocket, user.id)
    try:
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        manager.disconnect(websocket)
