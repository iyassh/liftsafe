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
