import Fastify from 'fastify';
import cors from '@fastify/cors';
import swagger from '@fastify/swagger';
import websocket from '@fastify/websocket';
import { pool, Db, type Row } from './db.js';
import { env } from './env.js';
import { HttpError } from './http-error.js';
import { initializeDatabase } from './seed.js';
import { manager } from './ws.js';
import { decodeAccessToken } from './auth.js';
import { registerAuthRoutes } from './routes/auth.js';
import { registerTripsRoutes } from './routes/trips.js';
import { registerBookingsRoutes } from './routes/bookings.js';
import { registerPaymentsRoutes } from './routes/payments.js';
import { registerInterestsRoutes } from './routes/interests.js';
import { registerNotificationsRoutes } from './routes/notifications.js';
import { registerDriverRoutes } from './routes/driver.js';
import { registerAdminRoutes } from './routes/admin.js';

const app = Fastify({ logger: true });

// CORS wide open for local dev (mirrors the FastAPI backend).
await app.register(cors, { origin: true, credentials: true });

// OpenAPI docs at /docs (replaces FastAPI's Swagger UI).
await app.register(swagger, {
  openapi: { info: { title: 'BUSGO API', version: '1.0.0' } },
});

// WebSocket support (/ws/*).
await app.register(websocket, { options: { maxPayload: 1048576 } });

// Per-request database session — one pooled client per HTTP request, released
// when the response finishes (mirrors SQLAlchemy's per-request session).
app.addHook('onRequest', async (request) => {
  const isWsUpgrade = String(request.headers.upgrade ?? '').toLowerCase() === 'websocket';
  if (isWsUpgrade) {
    (request as { db?: Db | null }).db = null;
    return;
  }
  const client = await pool.connect();
  (request as { db?: Db | null }).db = new Db(client);
});

app.addHook('onResponse', async (request) => {
  const db = (request as { db?: Db | null }).db;
  if (db) await db.close();
});

// Errors -> { detail } JSON, exactly like FastAPI's HTTPException.
app.setErrorHandler((error, request, reply) => {
  if (error instanceof HttpError) {
    return reply.code(error.statusCode).send({ detail: error.message });
  }
  request.log.error(error);
  return reply.code(500).send({ detail: String((error as { message?: unknown })?.message ?? error) });
});

app.setNotFoundHandler((_request, reply) => {
  reply.code(404).send({ detail: 'Not Found' });
});

app.get('/', async () => ({
  message: 'Welcome to BUSGO API - Dynamic Transport & Seating Platform',
}));

app.get('/progress', async (_request, reply) => {
  reply.type('text/html').send(`<!DOCTYPE html>
    <html lang="en">
      <head><meta charset="UTF-8" /><title>BUSGO Backend Progress</title></head>
      <body>
        <h1>BUSGO Backend Progress</h1>
        <p>The TypeScript backend is running.</p>
        <ul>
          <li><a href="/">Root API</a></li>
          <li><a href="/api/trips">Trips</a></li>
          <li><a href="/docs">OpenAPI docs</a></li>
        </ul>
      </body>
    </html>`);
});

// ---------------------------------------------------------------------------
// WebSocket channels
// ---------------------------------------------------------------------------

app.get('/ws/trip/:trip_id', { websocket: true }, (socket, req) => {
  const tripId = Number((req.params as { trip_id?: string }).trip_id);
  manager.connectTrip(socket, tripId);
  socket.on('message', (data) => {
    const text = typeof data === 'string' ? data : data.toString();
    manager.broadcastTrip(tripId, { message: text });
  });
  socket.on('close', () => manager.disconnect(socket));
});

app.get('/ws/notifications', { websocket: true }, async (socket, req) => {
  const token = String((req.query as { token?: string })?.token ?? '');

  // Auth via ?token=<jwt> (browsers cannot set headers on WS upgrade requests).
  let user: Row | null = null;
  if (token) {
    const client = await pool.connect();
    const db = new Db(client);
    try {
      const payload = decodeAccessToken(token);
      const userId = Number(payload.sub ?? 0);
      const row = await db.first(
        'SELECT id, full_name, email, phone, role FROM users WHERE id = :id;',
        { id: userId },
      );
      user = row ?? null;
    } catch {
      user = null;
    } finally {
      await db.close();
    }
  }

  if (!user) {
    socket.close(4401);
    return;
  }
  manager.connectUser(socket, Number(user.id));
  socket.on('message', () => {});
  socket.on('close', () => manager.disconnect(socket));
});

// ---------------------------------------------------------------------------
// Route modules
// ---------------------------------------------------------------------------

registerAuthRoutes(app);
registerTripsRoutes(app);
registerBookingsRoutes(app);
registerPaymentsRoutes(app);
registerInterestsRoutes(app);
registerNotificationsRoutes(app);
registerDriverRoutes(app);
registerAdminRoutes(app);

// Seed schema objects + demo data (idempotent) — same as the FastAPI startup hook.
await initializeDatabase();

try {
  await app.listen({ port: env.port, host: env.host });
} catch (err) {
  app.log.error(err);
  process.exit(1);
}

async function shutdown(): Promise<void> {
  await app.close();
  await pool.end();
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

