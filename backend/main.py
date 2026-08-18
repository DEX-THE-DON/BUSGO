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
    hash_password,
    require_roles,
    verify_password,
    get_current_user,
)
from backend.db import AsyncSessionLocal, engine, get_async_db
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
)

app = FastAPI(title="BUSGO API", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


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
                ]
            )

        v_count = await session.scalar(select(func.count()).select_from(Vehicle))
        if v_count == 0:
            vehicle_types = await session.execute(select(VehicleType))
            vt_map = {vt.slug: vt.id for vt in vehicle_types.scalars().all()}
            session.add_all(
                [
                    Vehicle(plate_number='KDA 123A', vehicle_type_id=vt_map.get('matatu_14'), is_electric=False),
                    Vehicle(plate_number='KCE 999B', vehicle_type_id=vt_map.get('ev_bus_33'), is_electric=True),
                    Vehicle(plate_number='KAA 556C', vehicle_type_id=vt_map.get('bus_51'), is_electric=False),
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


class ConnectionManager:
    def __init__(self):
        self.active_connections: List[WebSocket] = []

    async def connect(self, websocket: WebSocket):
        await websocket.accept()
        self.active_connections.append(websocket)

    def disconnect(self, websocket: WebSocket):
        self.active_connections.remove(websocket)

    async def broadcast(self, message: dict):
        for connection in self.active_connections:
            await connection.send_json(message)


manager = ConnectionManager()


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
        SELECT t.id, t.name, t.status, t.scheduled_at,
               r.id AS route_id, r.name AS route_name,
               v.id AS vehicle_id, v.plate_number, vt.seat_capacity
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
    if current_user.role == 'admin':
        query = text(
            """
            SELECT t.id, t.name, t.status, t.scheduled_at,
                   r.name AS route_name, v.plate_number
            FROM trips t
            JOIN routes r ON r.id = t.route_id
            LEFT JOIN vehicles v ON v.id = t.vehicle_id
            ORDER BY t.id ASC;
            """
        )
        rows = (await db.execute(query)).mappings().all()
    else:
        query = text(
            """
            SELECT t.id, t.name, t.status, t.scheduled_at,
                   r.name AS route_name, v.plate_number
            FROM trips t
            JOIN routes r ON r.id = t.route_id
            LEFT JOIN vehicles v ON v.id = t.vehicle_id
            WHERE t.driver_id = :driver_id
            ORDER BY t.id ASC;
            """
        )
        rows = (await db.execute(query, {"driver_id": current_user.id})).mappings().all()

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
    await manager.broadcast({"event": "trip_status", "trip_id": trip_id, "status": payload.status})
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
    await manager.broadcast({
        "event": "booking_pending",
        "trip_id": booking.trip_id,
        "seat_number": booking.seat_number,
        "booking_id": booking_id,
        "board_stop_order": booking.board_stop_order,
        "alight_stop_order": booking.alight_stop_order,
    })

    return {"status": "pending", "booking_id": booking_id, "payment_id": payment_id, "message": "Booking created and awaiting payment."}


class PaymentRequest(BaseModel):
    phone_number: str
    amount: float
    booking_id: int


@app.post("/api/pay/mpesa-stk")
async def trigger_mpesa_stk(payment: PaymentRequest, db=Depends(get_async_db), current_user: User = Depends(get_current_user)):
    """
    Simulate sending an M-Pesa STK push and immediately mark payment completed for demo purposes.
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
        if p_row:
            payment_id = p_row['id']
            await db.execute(
                text("UPDATE payments SET status = :status, provider = :provider, provider_payload = :payload WHERE id = :id;"),
                {"status": 'completed', "provider": 'mpesa_sim', "payload": json.dumps({"phone": payment.phone_number}), "id": payment_id},
            )
        else:
            ir = await db.execute(
                text("INSERT INTO payments (booking_id, provider, provider_payload, amount, status) VALUES (:booking_id, :provider, :payload, :amount, :status) RETURNING id;"),
                {"booking_id": payment.booking_id, "provider": 'mpesa_sim', "payload": json.dumps({"phone": payment.phone_number}), "amount": payment.amount, "status": 'completed'},
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
        await manager.broadcast({
            'event': 'seat_booked',
            'trip_id': booking_row['trip_id'],
            'seat_number': booking_row['seat_number'],
            'board_stop_order': booking_row['board_stop_order'],
            'alight_stop_order': booking_row['alight_stop_order'],
            'booking_id': payment.booking_id,
        })

    return {
        "status": "success",
        "message": f"M-Pesa STK push simulated and payment recorded for booking {payment.booking_id}",
        "payment_id": payment_id,
        "booking_id": payment.booking_id,
    }


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
    rows = (await db.execute(text("SELECT id, slug, display_name, seat_capacity FROM vehicle_types ORDER BY id;"))).mappings().all()
    return {"vehicle_types": [dict(r) for r in rows]}


@app.post("/api/admin/vehicle-types")
async def admin_create_vehicle_type(payload: VehicleTypeIn, db=Depends(get_async_db), _: User = Depends(require_roles('admin'))):
    res = await db.execute(
        text("INSERT INTO vehicle_types (slug, display_name, seat_capacity) VALUES (:slug, :display_name, :seat_capacity) RETURNING id, slug, display_name, seat_capacity;"),
        {"slug": payload.slug, "display_name": payload.display_name, "seat_capacity": payload.seat_capacity},
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
    routes = (await db.execute(text("SELECT id, name, country FROM routes ORDER BY id;"))).mappings().all()
    out = []
    for r in routes:
        stops = (await db.execute(
            text("SELECT id, stop_name, stop_order FROM route_stops WHERE route_id = :rid ORDER BY stop_order;"),
            {"rid": r["id"]},
        )).mappings().all()
        out.append({**dict(r), "stops": [dict(s) for s in stops]})
    return {"routes": out}


@app.get("/api/admin/users")
async def admin_list_users(db=Depends(get_async_db), _: User = Depends(require_roles('admin'))):
    rows = (await db.execute(text("SELECT id, full_name, email, phone, role FROM users ORDER BY id;"))).mappings().all()
    return {"users": [dict(r) for r in rows]}


@app.post("/api/admin/routes")
async def admin_create_route(payload: RouteIn, db=Depends(get_async_db), _: User = Depends(require_roles('admin'))):
    res = await db.execute(
        text("INSERT INTO routes (name, country) VALUES (:name, :country) RETURNING id;"),
        {"name": payload.name, "country": payload.country},
    )
    route_id = res.scalar_one()
    for order, stop_name in enumerate(payload.stops, start=1):
        await db.execute(
            text("INSERT INTO route_stops (route_id, stop_name, stop_order) VALUES (:rid, :stop, :order);"),
            {"rid": route_id, "stop": stop_name, "order": order},
        )
    await db.commit()
    return {"id": route_id, "name": payload.name, "country": payload.country, "stops": payload.stops}


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
    await manager.connect(websocket)
    try:
        while True:
            data = await websocket.receive_text()
            await manager.broadcast({"message": data})
    except WebSocketDisconnect:
        manager.disconnect(websocket)
