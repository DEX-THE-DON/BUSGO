// Compares the TS backend (:8000) against the reference FastAPI backend (:8001).
// Usage: npx tsx server/scripts/parity_check.ts

const TS = 'http://127.0.0.1:8000';
const PY = 'http://127.0.0.1:8001';

const ISO_RE = /^\d{4}-\d{2}-\d{2}T[\d:.+Z-]+$/;
const JWT_RE = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;

async function login(base: string, email: string, password: string): Promise<string> {
  const r = await fetch(`${base}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const data = (await r.json()) as { access_token: string };
  return data.access_token;
}

function norm(v: any): any {
  if (typeof v === 'string') {
    if (ISO_RE.test(v)) return '<TS>';
    if (JWT_RE.test(v)) return '<TOK>';
    return v;
  }
  if (Array.isArray(v)) return v.map(norm);
  if (v && typeof v === 'object') {
    const out: Record<string, any> = {};
    for (const k of Object.keys(v).sort()) out[k] = norm(v[k]);
    return out;
  }
  return v;
}

function deepEqual(a: any, b: any): boolean {
  if (typeof a === 'number' && typeof b === 'number') return Math.abs(a - b) < 0.001;
  if (typeof a !== typeof b) return false;
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    return a.every((x, i) => deepEqual(x, b[i]));
  }
  if (a && b && typeof a === 'object') {
    const ka = Object.keys(a).sort(), kb = Object.keys(b).sort();
    if (ka.join() !== kb.join()) return false;
    return ka.every((k) => deepEqual(a[k], b[k]));
  }
  return a === b;
}

interface CompareOpts {
  token?: string;
  body?: Record<string, any>;
}

async function compare(name: string, method: string, path: string, { token, body }: CompareOpts = {}): Promise<boolean> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const opts = (m: string, b?: Record<string, any>): RequestInit => ({
    method: m,
    headers,
    body: b ? JSON.stringify(b) : undefined,
  });

  const [tsRes, pyRes] = await Promise.all([
    fetch(TS + path, opts(method, body)),
    fetch(PY + path, opts(method, body)),
  ]);
  const [tsJson, pyJson] = await Promise.all([tsRes.json().catch(() => null), pyRes.json().catch(() => null)]);
  const ok = tsRes.status === pyRes.status && deepEqual(norm(tsJson), norm(pyJson));
  console.log((ok ? 'PASS' : 'FAIL') + ` [${tsRes.status}/${pyRes.status}] ${method} ${path}`);
  if (!ok) {
    console.log('  TS:', JSON.stringify(norm(tsJson)).slice(0, 400));
    console.log('  PY:', JSON.stringify(norm(pyJson)).slice(0, 400));
  }
  return ok;
}

const pass: string[] = [];
const fail: string[] = [];
const run = async (name: string, method: string, path: string, opts?: CompareOpts) => {
  const ok = await compare(name, method, path, opts);
  (ok ? pass : fail).push(name);
};

async function main() {
  const pTok = await login(TS, 'passenger1@busgo.test', 'pass123');
  const aTok = await login(TS, 'admin@busgo.test', 'admin123');
  const dTok = await login(TS, 'driver1@busgo.test', 'driver123');

  await run('root', 'GET', '/');
  await run('trips', 'GET', '/api/trips');
  await run('stops', 'GET', '/api/trips/1/stops');
  await run('booked-seats', 'GET', '/api/trips/1/booked-seats?board_order=1&alight_order=2');
  await run('seat-map', 'GET', '/api/trips/1/seat-map?board_order=1&alight_order=2');
  await run('chains', 'GET', '/api/trips/1/chains');
  await run('routes', 'GET', '/api/routes');
  await run('me', 'GET', '/api/auth/me', { token: pTok });
  await run('user-bookings', 'GET', '/api/user/bookings', { token: pTok });
  await run('seat-interests', 'GET', '/api/seat-interests', { token: pTok });
  await run('notifications', 'GET', '/api/notifications', { token: pTok });
  await run('admin-vehicle-types', 'GET', '/api/admin/vehicle-types', { token: aTok });
  await run('admin-vehicles', 'GET', '/api/admin/vehicles', { token: aTok });
  await run('admin-drivers', 'GET', '/api/admin/drivers', { token: aTok });
  await run('admin-analytics', 'GET', '/api/admin/analytics', { token: aTok });
  await run('admin-payments', 'GET', '/api/admin/payments', { token: aTok });
  await run('admin-users', 'GET', '/api/admin/users', { token: aTok });
  await run('driver-trips', 'GET', '/api/driver/trips', { token: dTok });
  await run('manifest', 'GET', '/api/trips/1/manifest', { token: dTok });
  await run('login-ts-token-check', 'POST', '/api/auth/login', { body: { email: 'passenger1@busgo.test', password: 'pass123' } });

  console.log(`\nPARITY PASS=${pass.length} FAIL=${fail.length}`);
  if (fail.length) {
    console.log('failures:', fail.join(', '));
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

