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

// ---------- check-ins (pre-shift warm-up) ----------
import { addCheckin, streak, todaySummary } from '../js/store.js';

const checkin = (soreness = null) => ({ soreness, completed: true, movements: [] });
const noon = (dayOffset) => new Date(2026, 8, 21 + dayOffset, 12).getTime(); // Mon 21 Sep 2026 + n days

test('addCheckin creates a worker with no lift sessions, and appends next time', () => {
  let db = addCheckin(emptyDb(), 'Sam Lee', checkin(), noon(0));
  db = addCheckin(db, ' sam  lee', checkin('lower-back'), noon(1));
  assert.equal(db.workers.length, 1);
  assert.deepEqual(db.workers[0].sessions, []);
  assert.equal(db.workers[0].checkins.length, 2);
  assert.equal(db.workers[0].checkins[1].date, noon(1));
});

test('a worker with check-ins but no lift check is uncertified, with no due date', () => {
  const w = addCheckin(emptyDb(), 'Sam', checkin(), noon(0)).workers[0];
  assert.equal(workerStatus(w, noon(0)), 'uncertified');
  assert.equal(nextDue(w), null);
});

test('load keeps a check-in-only worker, and an old db without check-ins still loads', () => {
  const mem = new Map();
  const storage = { getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, v) };
  save(addCheckin(emptyDb(), 'Sam', checkin(), noon(0)), storage);
  assert.equal(load(storage).workers.length, 1);

  const old = { intervalDays: 90, workers: [{ name: 'Old', sessions: [{ score: 80, date: t0 }] }] };
  for (const k of mem.keys()) mem.set(k, JSON.stringify(old));
  const db = load(storage);
  assert.equal(db.workers.length, 1);
  assert.equal(streak(db.workers[0], t0), 0);
  assert.equal(todaySummary(db, t0).checkedIn, 0);
});

test('streak counts shifts in a row; a weekend does not break it, a week off does', () => {
  let db = emptyDb();
  for (const d of [0, 1, 2, 3, 4, 7, 8]) db = addCheckin(db, 'Sam', checkin(), noon(d)); // Mon–Fri, Mon, Tue
  const w = db.workers[0];
  assert.equal(streak(w, noon(8)), 7);
  assert.equal(streak(w, noon(10)), 7); // two days later, still alive
  assert.equal(streak(w, noon(14)), 0); // nothing for six days: gone
  db = addCheckin(db, 'Sam', checkin(), noon(16));
  assert.equal(streak(db.workers[0], noon(16)), 1);
});

test('two check-ins on the same day count once toward the streak', () => {
  let db = addCheckin(emptyDb(), 'Sam', checkin(), noon(0));
  db = addCheckin(db, 'Sam', checkin(), noon(0) + 3600000);
  assert.equal(streak(db.workers[0], noon(0)), 1);
});

test('todaySummary: who checked in today, soreness flags, seven-day participation', () => {
  let db = addCheckin(emptyDb(), 'Ana', checkin(), noon(0));
  db = addCheckin(db, 'Ben', checkin('shoulders'), noon(0));
  db = addCheckin(db, 'Cal', checkin(), noon(-2));
  db = addSession(db, 'Dee', session(80), noon(-5)); // certified, never checked in
  const s = todaySummary(db, noon(0) + 3600000);
  assert.equal(s.total, 4);
  assert.equal(s.checkedIn, 2);
  assert.deepEqual(s.soreness, [{ name: 'Ben', area: 'shoulders' }]);
  assert.equal(s.participation7d, 75); // Ana, Ben, Cal of four
  assert.equal(todaySummary(emptyDb(), noon(0)).participation7d, 0);
});

test('the business pack defaults to warehouse and survives a round trip', () => {
  assert.equal(emptyDb().pack, 'warehouse');
  const mem = new Map();
  const storage = { getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, v) };
  save({ ...emptyDb(), pack: 'retail' }, storage);
  assert.equal(load(storage).pack, 'retail');
  for (const k of mem.keys()) mem.set(k, JSON.stringify({ workers: [], pack: 42 }));
  assert.equal(load(storage).pack, 'warehouse');
});

// ---------- roster (kiosk sign-in) ----------
import { setBusiness, addWorker, removeWorker, setWorkerPin, findWorker, exportCsv } from '../js/store.js';

const pin = { salt: 's', hash: 'h' };

test('setBusiness stores the name and manager PIN record; a fresh db has no business', () => {
  assert.equal(emptyDb().business, null);
  const db = setBusiness(emptyDb(), { name: '  Hillside Movers ', managerPin: pin });
  assert.deepEqual(db.business, { name: 'Hillside Movers', managerPin: pin });
});

test('addWorker puts a worker on the roster with no records, and refuses a duplicate name', () => {
  let db = addWorker(emptyDb(), { id: 'w_1', name: 'Sam  Lee', pin });
  assert.deepEqual(db.workers[0], { id: 'w_1', name: 'Sam Lee', pin, sessions: [], checkins: [] });
  assert.throws(() => addWorker(db, { id: 'w_2', name: ' sam lee', pin }), /already/i);
  assert.throws(() => addWorker(db, { id: 'w_3', name: '   ', pin }), /name/i);
  db = addWorker(db, { id: 'w_2', name: 'Ana', pin });
  assert.equal(db.workers.length, 2);
});

test('a roster member with no records yet survives a reload; a nameless stray still does not', () => {
  const mem = new Map();
  const storage = { getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, v) };
  save(addWorker(emptyDb(), { id: 'w_1', name: 'Sam', pin }), storage);
  const db = load(storage);
  assert.equal(db.workers.length, 1);
  assert.equal(workerStatus(db.workers[0], t0), 'uncertified');
  assert.equal(streak(db.workers[0], t0), 0);
});

test('records land on the roster member with the same name, keeping id and PIN', () => {
  let db = addWorker(emptyDb(), { id: 'w_1', name: 'Sam Lee', pin });
  db = addCheckin(db, 'sam lee', checkin(), noon(0));
  db = addSession(db, 'Sam Lee', session(80), noon(0));
  assert.equal(db.workers.length, 1);
  assert.equal(db.workers[0].id, 'w_1');
  assert.equal(db.workers[0].checkins.length, 1);
  assert.equal(db.workers[0].sessions.length, 1);
});

test('findWorker, setWorkerPin and removeWorker work by id and leave others alone', () => {
  let db = addWorker(addWorker(emptyDb(), { id: 'w_1', name: 'Sam', pin }), { id: 'w_2', name: 'Ana', pin });
  assert.equal(findWorker(db, 'w_2').name, 'Ana');
  assert.equal(findWorker(db, 'nope'), null);
  db = setWorkerPin(db, 'w_1', { salt: 'n', hash: 'n' });
  assert.deepEqual(findWorker(db, 'w_1').pin, { salt: 'n', hash: 'n' });
  assert.deepEqual(findWorker(db, 'w_2').pin, pin);
  db = removeWorker(db, 'w_1');
  assert.deepEqual(db.workers.map((w) => w.name), ['Ana']);
});

test('exportCsv: one row per record, quoted safely, and never includes PINs', () => {
  let db = addWorker(emptyDb(), { id: 'w_1', name: 'Lee, "Sam"', pin: { salt: 'SALT', hash: 'HASH' } });
  db = addSession(db, 'Lee, "Sam"', session(62, 'stoop'), noon(0));
  db = addCheckin(db, 'Lee, "Sam"', checkin('knees'), noon(1));
  const csv = exportCsv(db);
  const lines = csv.trim().split('\n');
  assert.equal(lines[0], 'worker,type,date,score,passed,top_fault,soreness,completed');
  assert.equal(lines.length, 3);
  assert.ok(lines[1].startsWith('"Lee, ""Sam""",lift check,'));
  assert.ok(lines[1].includes(',62,no,stoop,'));
  assert.ok(lines[2].includes('warm-up') && lines[2].includes('knees'));
  assert.ok(!csv.includes('SALT') && !csv.includes('HASH'));
});

test('exportCsv defuses spreadsheet formulas in worker names', () => {
  const db = addSession(emptyDb(), '=HYPERLINK("http://x")', session(80), noon(0));
  assert.ok(!exportCsv(db).split('\n')[1].startsWith('=') && !exportCsv(db).split('\n')[1].startsWith('"='));
});
