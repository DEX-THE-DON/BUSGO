# BUSGO — Dynamic Transit Booking Platform

A transit booking system for Kenya's bus/matatu fleet with **dynamic partial-segment seating**:
the same physical seat can be sold to multiple passengers for *non-overlapping legs* of the same
trip — and each seat is modelled as a **relay chain** (A→B 🔗 B→C 🔗 C→D) so passengers are
notified when the seat frees up at their stop. Overlap conflicts are prevented at the database
level by a Postgres trigger, so double-booking is impossible even under concurrent requests.

## Stack

- **Backend** (`backend/`): FastAPI, async SQLAlchemy 2.x, asyncpg, Alembic, PostgreSQL
- **Frontend** (`frontend/`): Next.js 16 (App Router), React 19, TypeScript, Tailwind CSS 4

## Features

- 🔗 **Seat relay chains**: passengers boarding where the previous passenger alights are notified
  their seat is ready; waitlisted users learn the instant a seat frees up for their segment
- 🚏 **Direct & stopwise routes**: `route_type` on routes — direct = non-stop origin→destination,
  stopwise = pickups/drop-offs at every stop (the relay mode)
- 🪑 **Bus-size-aware seat grids**: matatu 14 / bus 33 / coach 51 / EV variants render the correct
  layout; seats show 🟢 free · 🟡 frees up before you alight · 🔴 occupied
- 💳 **Real M-Pesa Daraja STK push** (opt-in via `MPESA_*` env vars) with verified callback webhook;
  falls back to a built-in simulator when unconfigured
- 🔔 **Notifications center**: in-app + WebSocket push for `seat_freed`, `booking_confirmed`,
  `payment_update` — live bell on every dashboard
- 🕐 **Waitlist / seat interests**: "notify me when this segment frees up" with one-shot offers
- 🧑‍✈️ **Admin**: fleet CRUD, driver account creation, revenue/occupancy analytics, payment log
- 🚌 **Driver**: assigned trips, live manifest, **stop-progress reporting** ("bus is at stop X")
  which releases seats and notifies the next passenger in each chain
- 👥 **Passenger**: booking history, cancellations (frees the seat chain), waitlist management
- 📡 WebSocket live updates for seat bookings, trip status, seat-release events

## Running locally

Prerequisites: Python 3.13+, Node 20+, a running PostgreSQL with a `busgo_db` database.

```bash
# 1. Backend
python3 -m venv backend/venv
source backend/venv/bin/activate
pip install -r backend/requirements.txt

# apply migrations
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

To try the relay flow: log in as `passenger1` and two more accounts, then book the same seat
for consecutive segments (e.g. stop 1→2, 2→3, 3→4) — the seat map turns yellow/red and the
passenger boarding next gets a "seat ready" notification.

## Configuration

Copy `.env.example` → `.env` and adjust. Key variables:

- `DATABASE_URL` — async SQLAlchemy Postgres URL
- `JWT_SECRET_KEY` — **must** be changed outside local dev
- `ACCESS_TOKEN_EXPIRE_MINUTES` — token lifetime
- `MPESA_ENV` / `MPESA_CONSUMER_KEY` / `MPESA_CONSUMER_SECRET` / `MPESA_PASSKEY` /
  `MPESA_SHORTCODE` / `MPESA_CALLBACK_URL` — enable **real** M-Pesa STK pushes (leave blank for
  the simulated flow)

## API

Interactive docs (Swagger UI) at `http://127.0.0.1:8000/docs`.

### Selected endpoints

| Method | Path | Access |
|--------|------|--------|
| POST | `/api/auth/register`, `/api/auth/login` | public |
| GET | `/api/auth/me` | any authed |
| GET | `/api/trips`, `/api/trips/{id}/stops` | public |
| GET | `/api/trips/{id}/seat-map` | public (per-seat free/partial/full + next-free stop) |
| GET | `/api/trips/{id}/chains` | public (per-seat relay chains) |
| POST | `/api/book-seat` | authed (user derived from JWT) |
| DELETE | `/api/bookings/{id}` | authed owner (frees the seat chain) |
| POST | `/api/pay/mpesa-stk` | authed owner or admin (simulator) |
| POST | `/api/pay/daraja/stk` | authed owner or admin (real STK push) |
| POST | `/api/pay/daraja/callback` | Safaricom webhook (verified) |
| POST/GET/DELETE | `/api/seat-interests` | authed (waitlist) |
| GET | `/api/notifications`, `/api/notifications/{id}/read` | authed |
| GET | `/api/user/bookings` | authed (own bookings) |
| GET/POST | `/api/admin/vehicles`, `/routes`, `/trips`, `/users`, `/drivers` … | admin |
| GET | `/api/admin/analytics`, `/api/admin/payments` | admin |
| GET | `/api/driver/trips`, `/api/trips/{id}/manifest` | driver/admin |
| PATCH | `/api/trips/{id}/status` | driver/admin |
| PATCH | `/api/trips/{id}/current-stop` | driver/admin (releases seats + notifies) |
| WS | `/ws/trip/{trip_id}` | public (live seat/status events) |
| WS | `/ws/notifications?token=<jwt>` | authed (per-user push) |

## Migrations

Alembic chain: `a1b2c3d4e5f6` (reconcile schema) → `b7c8d9e0f1a2` (dedupe stops) →
`c3d4e5f6a7b8` (relay schema: route_type, seat chains, waitlist, notifications, payment refs) →
`d4e5f6a7b8c9` (trips.current_stop_order).

```bash
DATABASE_URL="postgresql+asyncpg://postgres:DEX@localhost:5432/busgo_db" \
  python -m alembic -c backend/alembic.ini upgrade head
```

## Project layout

```
backend/
  main.py            # FastAPI app: auth, booking, relay chains, payments, admin, driver, user
  auth.py            # bcrypt + JWT + role dependencies
  chains.py          # seat-chain engine: recompute, handoff/freed-gap notifications, stop release
  daraja.py          # M-Pesa Daraja client (OAuth token, STK push, callback parsing)
  ws.py              # WebSocket connection manager (trip + per-user channels)
  models.py          # SQLAlchemy models
  db.py              # async engine/session
  alembic/           # migrations
frontend/
  src/app/           # Next.js pages (/ , /login, /register, /user, /driver, /admin)
  src/components/    # SeatGrid (bus-size aware), ChainView (relay), NotificationsBell, RequireRole
  src/context/       # AuthContext
  src/services/      # api.ts (typed authed client)
```

## Notes & known limitations

- M-Pesa Daraja works when the `MPESA_*` env vars are set; otherwise the simulated flow is used.
  The webhook is verified by matching the `CheckoutRequestID`; signature/security hardening
  (Basic-auth headers, TLS-only callbacks) is expected before production deployment.
- CORS is open (`*`) for local development; tighten before deploying.
- Seat-conflict trigger, index names, and column types were reconciled to the live DB via the Alembic
  baseline migrations (the original pre-Alembic schema had drifted).
