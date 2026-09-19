import { test } from 'node:test';
import assert from 'node:assert/strict';
import { emptyDb, addSession, nextDue, workerStatus, mostCommonFault, load, save } from '../js/store.js';

const DAY = 86400000;
const t0 = Date.UTC(2026, 8, 19);
const session = (score, topFault = null) => ({ score, passed: score >= 70, topFault, lifts: [] });

test('addSession creates a worker, then appends to the same worker (case-insensitive)', () => {
  let db = addSession(emptyDb(), 'Sam Lee', session(62, 'stoop'), t0);
  db = addSession(db, 'sam lee ', session(88), t0 + DAY);
  assert.equal(db.workers.length, 1);
  assert.equal(db.workers[0].sessions.length, 2);
  assert.equal(db.workers[0].sessions[1].date, t0 + DAY);
});

test('addSession does not mutate the db it was given', () => {
  const db = emptyDb();
  addSession(db, 'Sam', session(80), t0);
  assert.equal(db.workers.length, 0);
});

test('nextDue is interval days after the latest session', () => {
  const db = addSession(emptyDb(), 'Sam', session(80), t0);
  assert.equal(nextDue(db.workers[0], 90), t0 + 90 * DAY);
});

test('status: current, due-soon within 14 days, overdue after', () => {
  const w = addSession(emptyDb(), 'Sam', session(80), t0).workers[0];
  assert.equal(workerStatus(w, t0 + 10 * DAY), 'current');
  assert.equal(workerStatus(w, t0 + 80 * DAY), 'due-soon');
  assert.equal(workerStatus(w, t0 + 91 * DAY), 'overdue');
});

test('mostCommonFault across latest sessions', () => {
  let db = addSession(emptyDb(), 'A', session(60, 'stoop'), t0);
  db = addSession(db, 'B', session(65, 'stoop'), t0);
  db = addSession(db, 'C', session(70, 'reach'), t0);
  assert.equal(mostCommonFault(db), 'stoop');
  assert.equal(mostCommonFault(emptyDb()), null);
});

test('load/save round-trip, and corrupt storage falls back to an empty db', () => {
  const mem = new Map();
  const storage = { getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, v) };
  assert.deepEqual(load(storage), emptyDb());
  const db = addSession(emptyDb(), 'Sam', session(80), t0);
  save(db, storage);
  assert.deepEqual(load(storage), db);
  for (const k of mem.keys()) mem.set(k, '{not json');
  assert.deepEqual(load(storage), emptyDb());
});

const memStorage = (value) => ({ getItem: () => value, setItem: () => {} });

test('load: JSON that is not a db falls back to an empty db', () => {
  for (const raw of ['null', '[]', '"x"', '42', '{"workers":"x"}', '{}']) {
    const db = load(memStorage(raw));
    assert.ok(Array.isArray(db.workers), raw);
    assert.equal(db.workers.length, 0, raw);
    assert.equal(db.intervalDays, 90, raw);
  }
});

test('load: drops workers the dashboard could not render, keeps the good ones', () => {
  const good = { name: 'Sam', sessions: [{ score: 80, passed: true, topFault: null, lifts: [], date: t0 }] };
  const raw = JSON.stringify({
    intervalDays: 'soon',
    workers: [good, null, 'x', { name: 'No sessions', sessions: [] }, { name: 'Old shape', score: 50 },
      { name: 7, sessions: good.sessions }, { name: 'Bad date', sessions: [{ score: 1, date: 'yesterday' }] }],
  });
  const db = load(memStorage(raw));
  assert.deepEqual(db.workers, [good]);
  assert.equal(db.intervalDays, 90);
  assert.equal(workerStatus(db.workers[0], t0), 'current');
  assert.equal(mostCommonFault(db), null);
});

test('load: blocked localStorage falls back to an empty db instead of throwing', () => {
  const had = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    get() { throw new Error('SecurityError'); },
  });
  try {
    assert.deepEqual(load(), emptyDb());
  } finally {
    if (had) Object.defineProperty(globalThis, 'localStorage', had);
    else delete globalThis.localStorage;
  }
});

test('addSession: names that differ only in spacing or unicode form are the same worker', () => {
  let db = addSession(emptyDb(), 'Sam  Lee', session(60), t0);
  db = addSession(db, ' sam\tlee', session(70), t0 + DAY);
  db = addSession(db, 'Zoë', session(70), t0);
  db = addSession(db, 'Zoë', session(75), t0 + DAY);
  assert.equal(db.workers.length, 2);
  assert.equal(db.workers[0].name, 'Sam Lee');
});

test('addSession: an empty, whitespace or missing name still saves under a placeholder', () => {
  let db = addSession(emptyDb(), '   ', session(60), t0);
  db = addSession(db, '', session(70), t0 + DAY);
  db = addSession(db, undefined, session(80), t0 + 2 * DAY);
  assert.equal(db.workers.length, 1);
  assert.equal(db.workers[0].sessions.length, 3);
  assert.ok(db.workers[0].name.trim().length > 0);
});

test('addSession: a very long name is capped, and still matches itself next time', () => {
  const long = 'x'.repeat(5000);
  let db = addSession(emptyDb(), long, session(60), t0);
  db = addSession(db, long, session(70), t0 + DAY);
  assert.equal(db.workers.length, 1);
  assert.ok(db.workers[0].name.length <= 80);
});

test('mostCommonFault tolerates a worker with no sessions', () => {
  const db = { intervalDays: 90, workers: [{ name: 'New', sessions: [] }] };
  assert.equal(mostCommonFault(db), null);
});
