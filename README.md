# BUSGO — Dynamic Transit Booking Platform

A transit booking system for Kenya's bus/matatu fleet with **dynamic partial-segment seating**:
the same physical seat can be sold to multiple passengers for *non-overlapping legs* of the same
trip — and each seat is modelled as a **relay chain** (A→B 🔗 B→C 🔗 C→D) so passengers are
notified when the seat frees up at their stop. Overlap conflicts are prevented at the database
level by a Postgres trigger, so double-booking is impossible even under concurrent requests.

## Stack (100% TypeScript)

- **Backend** (`server/`): Fastify 5, node-postgres (`pg`), Zod validation, bcrypt + JWT,
  `ws`-based live push, OpenAPI docs at `/docs`
- **Shared contracts** (`packages/types/`): Zod schemas + inferred types — the single source of
  truth for every API request/response used by both the server and the frontend
- **Frontend** (`frontend/`): Next.js 16 (App Router), React 19, TypeScript, Tailwind CSS 4
- **Database**: PostgreSQL (unchanged schema, seat-conflict trigger, relay tables)

The original FastAPI backend has been fully replaced. A byte-level parity check (20/20 endpoints)
was run against it before cutover; the Python directory may still exist in the working tree as a
reference until you delete it.

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

Prerequisites: Node 20+ (Node 24 recommended), a running PostgreSQL with a `busgo_db` database.

```bash
# 1. Install workspace deps (server + shared types)
npm install

# 2. Build shared types + server, then start the API (binds 0.0.0.0:8000)
npm run build
npm run start:server          # or detached: ./server/run_server.sh

# 3. Frontend (separate npm project)
cd frontend
npm install
npm run dev                   # → http://localhost:3000
```

`npm run dev:server` recompiles and runs the server with `node --watch` for development.
Both servers and the shared package live in one npm workspace at the repo root; the frontend
consumes `@busgo/types` via a `file:` dependency (type-only imports).

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

- `DATABASE_URL` — Postgres URL; `postgresql+asyncpg://…` is accepted and translated to `postgres://`
- `PORT` / `HOST` — API binding (defaults `8000` / `0.0.0.0`)
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

## Database & migrations

The schema is unchanged from the FastAPI era and is created idempotently at startup
(`server/src/seed.ts`): tables, the `check_seat_conflict` trigger, indexes, and demo data
(vehicle types/vehicles, demo users, a sample route/trip/booking) — only when missing. The
original Alembic migration chain under `backend/alembic/` documents the schema history.

## Project layout

```
packages/types/        # Zod schemas + inferred types shared by server & frontend
server/
  src/index.ts         # Fastify bootstrap, CORS, Swagger, WebSocket routes, hooks
  src/db.ts            # pg pool + per-request session (named-param SQL helper)
  src/auth.ts          # bcrypt + JWT + role guards
  src/chains.ts        # seat-chain engine: recompute, handoff/freed-gap notifications, stop release
  src/daraja.ts        # M-Pesa Daraja client (OAuth token, STK push, callback parsing)
  src/seed.ts          # idempotent schema + demo-data bootstrap
  src/routes/          # auth, trips, bookings, payments, interests, notifications, driver, admin
  scripts/             # smoke tests + parity check (vs the reference backend)
frontend/
  src/app/             # Next.js pages (/ , /login, /register, /user, /driver, /admin)
  src/components/      # SeatGrid (bus-size aware), ChainView (relay), NotificationsBell, RequireRole
  src/context/         # AuthContext
  src/services/        # api.ts (typed authed client importing @busgo/types)
```

## Testing

```bash
npm run typecheck                    # tsc across shared types + server
node server/scripts/parity_check.mjs # diff TS backend vs a reference backend on :8001
node server/scripts/ws_test.mjs      # WebSocket channel smoke test
```

## Notes & known limitations

- M-Pesa Daraja works when the `MPESA_*` env vars are set; otherwise the simulated flow is used.
  The webhook is verified by matching the `CheckoutRequestID`; signature/security hardening
  (Basic-auth headers, TLS-only callbacks) is expected before production deployment.
- CORS is open for local development; tighten before deploying.
- The seat-conflict trigger ignores a booking's `status` (including `cancelled` rows), while the
  seat map hides cancelled rows — so a cancelled booking's seat can still trip the overlap
  guard. This matches the original FastAPI behaviour exactly.
- Passwords stay compatible with the previous backend (bcrypt, 12 rounds) — existing users log
  in without a reset.

