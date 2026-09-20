import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validPin, makePin, checkPin, startSession, currentSession, touchSession, endSession, SESSION_MS } from '../js/auth.js';

const memStorage = () => {
  const m = new Map();
  return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) };
};
const worker = { id: 'w_1', name: 'Sam Lee' };
const t0 = 1_800_000_000_000;

test('a PIN is exactly four digits', () => {
  assert.equal(validPin('0427'), true);
  for (const bad of ['', '123', '12345', '12a4', ' 1234', null, undefined, 1234]) assert.equal(validPin(bad), false, String(bad));
});

test('makePin never stores the PIN itself, and salts each one differently', async () => {
  const a = await makePin('1234');
  const b = await makePin('1234');
  assert.ok(!JSON.stringify(a).includes('1234'));
  assert.notEqual(a.salt, b.salt);
  assert.notEqual(a.hash, b.hash);
  assert.match(a.hash, /^[0-9a-f]{64}$/);
});

test('checkPin accepts the right PIN and rejects everything else', async () => {
  const record = await makePin('0427');
  assert.equal(await checkPin('0427', record), true);
  assert.equal(await checkPin('0428', record), false);
  assert.equal(await checkPin('', record), false);
  assert.equal(await checkPin('0427', null), false);
  assert.equal(await checkPin('0427', { salt: 'x' }), false);
});

test('a worker session carries who it is and expires after idle time', () => {
  const s = memStorage();
  startSession('worker', worker, t0, s);
  assert.deepEqual(currentSession(t0 + 1000, s), { role: 'worker', workerId: 'w_1', name: 'Sam Lee', expires: t0 + SESSION_MS.worker });
  assert.equal(currentSession(t0 + SESSION_MS.worker + 1, s), null);
});

test('activity extends a live session but cannot revive an expired one', () => {
  const s = memStorage();
  startSession('worker', worker, t0, s);
  touchSession(t0 + 60_000, s);
  assert.ok(currentSession(t0 + SESSION_MS.worker + 30_000, s));
  touchSession(t0 + 10 * SESSION_MS.worker, s);
  assert.equal(currentSession(t0 + 10 * SESSION_MS.worker, s), null);
});

test('a manager session has no worker, and lasts longer', () => {
  const s = memStorage();
  startSession('manager', null, t0, s);
  const session = currentSession(t0, s);
  assert.equal(session.role, 'manager');
  assert.equal(session.workerId, undefined);
  assert.ok(SESSION_MS.manager > SESSION_MS.worker);
});

test('endSession signs out, and junk in storage is not a session', () => {
  const s = memStorage();
  startSession('worker', worker, t0, s);
  endSession(s);
  assert.equal(currentSession(t0, s), null);
  for (const junk of ['{not json', 'null', '[]', '{"role":"admin","expires":9e15}', '{"role":"worker","expires":"soon"}']) {
    s.setItem('liftsafe.session', junk);
    assert.equal(currentSession(t0, s), null, junk);
  }
});

test('a demo session can be given a longer life, and activity keeps extending it by that much', () => {
  const s = memStorage();
  const ttl = 3 * 60 * 60_000;
  startSession('manager', null, t0, s, ttl);
  assert.ok(currentSession(t0 + SESSION_MS.manager + 1, s), 'outlives the normal idle time');
  touchSession(t0 + 60_000, s);
  assert.equal(currentSession(t0 + 60_000, s).expires, t0 + 60_000 + ttl);
  assert.equal(currentSession(t0 + 60_000 + ttl + 1, s), null);
});
