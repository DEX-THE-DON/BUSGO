import WebSocket from 'ws';
import pg from 'pg';

const B = 'http://127.0.0.1:8000';
const W = 'ws://127.0.0.1:8000';

const login = await fetch(`${B}/api/auth/login`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email: 'passenger1@busgo.test', password: 'pass123' }),
}).then((r) => r.json());
const tok = login.access_token;
const trips = await fetch(`${B}/api/trips`).then((r) => r.json());
const tripId = trips.trips[0].id;

// pick a seat with zero booking history (cancelled rows still trip the trigger)
const client = new pg.Client({ connectionString: 'postgres://postgres:DEX@localhost:5432/busgo_db' });
await client.connect();
const res = await client.query(`
  SELECT s.n AS seat FROM generate_series(1, 14) AS s(n)
  WHERE NOT EXISTS (SELECT 1 FROM bookings b WHERE b.trip_id = $1 AND b.seat_number = s.n)
  LIMIT 1`, [tripId]);
const seat = res.rows[0].seat;
await client.end();
console.log('testing seat', seat, 'on trip', tripId);

let bookingId = null;
const ws = new WebSocket(`${W}/ws/notifications?token=${tok}`);
ws.on('message', async (d) => {
  const msg = JSON.parse(d.toString());
  if (msg.event === 'booking_confirmed') {
    console.log('PASS [ws-live] received booking_confirmed event', JSON.stringify(msg));
    if (bookingId) await fetch(`${B}/api/bookings/${bookingId}`, { method: 'DELETE', headers: { Authorization: `Bearer ${tok}` } });
    ws.close();
    console.log('cleanup: cancelled booking', bookingId);
    process.exit(0);
  }
});
ws.on('open', async () => {
  const book = await fetch(`${B}/api/book-seat`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tok}` },
    body: JSON.stringify({ trip_id: tripId, seat_number: seat, board_stop_order: 1, alight_stop_order: 2 }),
  }).then((r) => r.json());
  bookingId = book.booking_id;
  console.log('booked', bookingId);
  await fetch(`${B}/api/pay/mpesa-stk`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tok}` },
    body: JSON.stringify({ booking_id: bookingId, phone_number: '0712345678', amount: 500 }),
  });
});
ws.on('close', (code) => { if (code !== 1000) console.log('ws closed', code); });
setTimeout(() => {
  console.log('FAIL [ws-live] notification timeout');
  process.exit(1);
}, 8000);
