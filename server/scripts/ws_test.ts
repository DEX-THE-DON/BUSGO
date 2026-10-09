import WebSocket from 'ws';

const base = 'ws://127.0.0.1:8000';
let ok = 0, fail = 0;
const check = (name: string, cond: boolean) => {
  console.log((cond ? 'PASS' : 'FAIL') + ' [ws] ' + name);
  if (cond) ok++; else fail++;
};

// 1. trip channel: send a message, expect broadcast echo back
const trip = new WebSocket(base + '/ws/trip/1');
trip.on('open', () => trip.send('hello'));
trip.on('message', (d: any) => {
  const msg = JSON.parse(d.toString());
  check('trip echo broadcast', msg.message === 'hello');
  trip.close();
});

// 2. notifications: bad token should close with 4401
const bad = new WebSocket(base + '/ws/notifications?token=garbage');
bad.on('close', (code: number) => {
  check('bad token closes 4401', code === 4401);
  finish();
});

function finish() {
  console.log('WS TOTAL PASS=' + ok + ' FAIL=' + fail);
  process.exit(fail ? 1 : 0);
}

setTimeout(() => {
  console.log('timeout');
  process.exit(1);
}, 8000);
