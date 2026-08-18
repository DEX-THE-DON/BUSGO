# BUSGO — Dynamic Transit Booking Platform

A transit booking system for Kenya's bus/matatu fleet with **dynamic partial-segment seating**:
the same physical seat can be sold to multiple passengers for *non-overlapping legs* of the same
trip (e.g. seat 3 Nairobi→Westlands, then re-sold Eldoret→Nakuru). Overlap conflicts are prevented
at the database level by a Postgres trigger, so double-booking is impossible even under concurrent
requests.

## Stack

- **Backend** (`backend/`): FastAPI, async SQLAlchemy 2.x, asyncpg, Alembic, PostgreSQL
- **Frontend** (`frontend/`): Next.js 16 (App Router), React 19, TypeScript, Tailwind CSS 4

## Features

- 🪑 Segment-aware seat booking with live seat grid + simulated M-Pesa STK push
- 🔐 JWT authentication with role-based access (`admin` / `driver` / `user`)
- 🚌 **Admin**: fleet CRUD — vehicle types, vehicles, routes, trips, driver assignment, users
- 👥 **Passenger**: booking history (upcoming + past) with stop names and payment status
- 🧾 **Driver**: assigned trips, live passenger manifest (seat / passenger / phone / stops), trip
  status controls (`scheduled → boarding → in_transit → completed`), walk-up booking
- 📡 WebSocket live updates for seat bookings and trip status

## Running locally

Prerequisites: Python 3.13+, Node 20+, a running PostgreSQL with a `busgo_db` database.

```bash
# 1. Backend
python3 -m venv backend/venv
source backend/venv/bin/activate
pip install -r backend/requirements.txt

# (optional but recommended) apply migrations
DATABASE_URL="postgresql+asyncpg://postgres:DEX@localhost:5432/busgo_db" \
  python -m alembic -c backend/alembic.ini upgrade head

# start the API (from the project ROOT — the app imports `backend.*`)
uvicorn backend.main:app --host 127.0.0.1 --port 8000
# or detached: ./backend/run_backend.sh

# 2. Frontend
cd frontend
npm install
npm run dev
# → http://localhost:3000
```

### Demo accounts

| Role | Email | Password | Page |
|------|-------|----------|------|
| Admin | `admin@busgo.test` | `admin123` | `/admin` |
| Driver | `driver1@busgo.test` | `driver123` | `/driver` |
| Passenger | `passenger1@busgo.test` | `pass123` | `/user` |

## Configuration

Copy `.env.example` → `.env` and adjust. Key variables:

- `DATABASE_URL` — async SQLAlchemy Postgres URL
- `JWT_SECRET_KEY` — **must** be changed outside local dev
- `ACCESS_TOKEN_EXPIRE_MINUTES` — token lifetime

## API

Interactive docs (Swagger UI) at `http://127.0.0.1:8000/docs`.

### Selected endpoints

| Method | Path | Access |
|--------|------|--------|
| POST | `/api/auth/register`, `/api/auth/login` | public |
| GET | `/api/auth/me` | any authed |
| GET | `/api/trips`, `/api/trips/{id}/stops`, `/api/trips/{id}/booked-seats` | public |
| POST | `/api/book-seat` | authed (user derived from JWT) |
| POST | `/api/pay/mpesa-stk` | authed owner or admin |
| GET | `/api/user/bookings` | authed (own bookings) |
| GET | `/api/admin/vehicles`, `/routes`, `/trips`, `/users` … | admin |
| GET | `/api/driver/trips`, `/api/trips/{id}/manifest` | driver/admin |
| PATCH | `/api/trips/{id}/status` | driver/admin |
| WS | `/ws/trip/{trip_id}` | public (live seat/status events) |

## Migrations

Alembic chain: `a1b2c3d4e5f6` (reconcile schema) → `b7c8d9e0f1a2` (dedupe route stops).

```bash
DATABASE_URL="postgresql+asyncpg://postgres:DEX@localhost:5432/busgo_db" \
  python -m alembic -c backend/alembic.ini revision --autogenerate -m "description"
DATABASE_URL="postgresql+asyncpg://postgres:DEX@localhost:5432/busgo_db" \
  python -m alembic -c backend/alembic.ini upgrade head
```

## Project layout

```
backend/
  main.py            # FastAPI app: auth, booking, payment, admin, driver, user endpoints
  auth.py            # bcrypt + JWT + role dependencies
  models.py          # SQLAlchemy models
  db.py              # async engine/session
  alembic/           # migrations
frontend/
  src/app/           # Next.js pages (/ , /login, /register, /user, /driver, /admin)
  src/context/       # AuthContext
  src/components/    # RequireRole guard
  src/services/      # api.ts (typed authed client)
```

## Notes & known limitations

- M-Pesa is **simulated** (no Daraja API call yet) — it records the payment and confirms the booking.
- CORS is open (`*`) for local development; tighten before deploying.
- Seat-conflict trigger, index names, and column types were reconciled to the live DB via the Alembic
  baseline migrations (the original pre-Alembic schema had drifted).
