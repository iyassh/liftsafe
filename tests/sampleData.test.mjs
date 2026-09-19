import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sampleWorkers } from '../js/sampleData.js';
import { workerStatus, addSession, addCheckin, emptyDb, streak, todaySummary, checkinsOf } from '../js/store.js';
import { mergeSample, withoutSample } from '../js/dashboard.js';
import { FAULTS } from '../js/engine/scoring.js';
import { MOVEMENTS } from '../js/engine/movements.js';

const now = Date.UTC(2026, 8, 19, 17, 30);
const workers = sampleWorkers(now);
const sessions = workers.flatMap((w) => w.sessions);
const checkins = workers.flatMap((w) => w.checkins);

test('six sample workers, all flagged as sample', () => {
  assert.equal(workers.length, 6);
  for (const w of workers) assert.equal(w.sample, true);
  assert.equal(new Set(workers.map((w) => w.name)).size, 6);
});

test('all three recheck statuses appear, with several current', () => {
  const statuses = workers.map((w) => workerStatus(w, now, 90));
  assert.ok(statuses.includes('overdue'));
  assert.ok(statuses.includes('due-soon'));
  assert.ok(statuses.filter((s) => s === 'current').length >= 2);
});

test('statuses hold at other times of day and year', () => {
  for (const t of [0, Date.UTC(2027, 1, 28, 23, 59, 59), Date.UTC(2030, 5, 1, 0, 0, 1)]) {
    const statuses = new Set(sampleWorkers(t).map((w) => workerStatus(w, t, 90)));
    assert.deepEqual([...statuses].sort(), ['current', 'due-soon', 'overdue', 'uncertified']);
  }
});

test('no session is dated in the future', () => {
  for (const s of sessions) assert.ok(s.date <= now);
});

test('sessions within a worker are in ascending date order', () => {
  assert.equal(workers.filter((w) => w.sessions.length === 0).length, 1);
  for (const w of workers) {
    assert.ok(w.sessions.length + w.checkins.length >= 1, w.name);
    for (let i = 1; i < w.sessions.length; i++) {
      assert.ok(w.sessions[i].date > w.sessions[i - 1].date, w.name);
    }
  }
});

test('every topFault is null or a known fault id, and the mix is varied', () => {
  for (const s of sessions) assert.ok(s.topFault === null || s.topFault in FAULTS, String(s.topFault));
  const seen = new Set(sessions.map((s) => s.topFault));
  for (const f of ['stoop', 'reach', 'trunk', null]) assert.ok(seen.has(f), String(f));
});

test('sessions have the stored shape', () => {
  for (const s of sessions) {
    assert.ok(Number.isInteger(s.score) && s.score >= 0 && s.score <= 100);
    assert.equal(s.passed, s.score >= 70);
    assert.ok(s.lifts.length > 0);
    for (const l of s.lifts) {
      assert.ok(l.score >= 0 && l.score <= 100);
      for (const f of l.faults) assert.ok(f in FAULTS);
    }
  }
});

test('one worker clearly improves over three sessions and one gets worse', () => {
  const scores = workers.map((w) => w.sessions.map((s) => s.score));
  assert.ok(scores.some((s) => s.length >= 3 && s.every((v, i) => i === 0 || v > s[i - 1]) && s.at(-1) - s[0] >= 20));
  assert.ok(scores.some((s) => s.length >= 2 && s.at(-1) < s[0]));
});

test('pure: same now gives deep-equal results', () => {
  assert.deepEqual(sampleWorkers(now), sampleWorkers(now));
});

test('loading twice adds no duplicates and leaves real records alone', () => {
  const real = addSession(emptyDb(), 'Real Person', { score: 80, passed: true, topFault: null, lifts: [] }, now);
  const twice = mergeSample(mergeSample(real, now), now);
  assert.equal(twice.workers.length, 7);
  assert.deepEqual(twice.workers[0], real.workers[0]);
  assert.deepEqual(withoutSample(twice), real);
});

test('a real recheck saved under a sample name survives clearing sample data', () => {
  const name = workers[0].name;
  const db = addSession(mergeSample(emptyDb(), now), name, { score: 77, passed: true, topFault: null, lifts: [] }, now);
  const cleared = withoutSample(db);
  assert.equal(cleared.workers.length, 1);
  assert.equal(cleared.workers[0].name, name);
  assert.equal(cleared.workers[0].sample, undefined);
  assert.deepEqual(cleared.workers[0].sessions.map((s) => s.score), [77]);
});

test('every check-in is tagged sample, not in the future, and in ascending order', () => {
  for (const t of [now, 0, Date.UTC(2027, 1, 28, 23, 59, 59), Date.UTC(2030, 5, 1, 0, 0, 1)]) {
    for (const w of sampleWorkers(t)) {
      w.checkins.forEach((c, i) => {
        assert.equal(c.sample, true);
        assert.ok(c.date <= t, w.name);
        assert.ok(i === 0 || c.date > w.checkins[i - 1].date, w.name);
      });
    }
  }
});

test('check-ins have the stored shape', () => {
  assert.ok(checkins.length > 0);
  for (const c of checkins) {
    assert.ok([null, 'lower-back', 'shoulders', 'knees', 'other'].includes(c.soreness));
    assert.equal(c.completed, true);
    assert.ok(c.movements.length > 0);
    for (const m of c.movements) {
      assert.ok(m.id in MOVEMENTS, m.id);
      assert.ok(m.quality >= 0 && m.quality <= 1);
      assert.ok(m.durationMs > 0);
    }
  }
});

test('every Today tile is populated', () => {
  const s = todaySummary({ ...emptyDb(), workers }, now);
  assert.equal(s.total, 6);
  assert.ok(s.checkedIn >= 2 && s.checkedIn < s.total);
  assert.ok(s.soreness.some((f) => f.area === 'lower-back'));
  assert.ok(s.participation7d > 0 && s.participation7d < 100);
  assert.ok(workers.some((w) => streak(w, now) >= 6));
});

test('Today tiles stay populated at any time of day, on any day of the week', () => {
  const start = new Date(2026, 10, 1, 0, 0, 30).getTime();
  for (let day = 0; day < 8; day++) {
    for (const hours of [0, 9.5, 23.99]) {
      const t = start + day * 86400000 + hours * 3600000;
      const sample = sampleWorkers(t);
      const s = todaySummary({ ...emptyDb(), workers: sample }, t);
      assert.ok(s.checkedIn >= 2, new Date(t).toString());
      assert.ok(s.soreness.length >= 1);
      assert.ok(s.participation7d > 0 && s.participation7d < 100);
      assert.ok(Math.max(...sample.map((w) => streak(w, t))) >= 6, new Date(t).toString());
    }
  }
});

test('one worker has warmed up but never done a lift check', () => {
  const uncertified = workers.filter((w) => workerStatus(w, now, 90) === 'uncertified');
  assert.equal(uncertified.length, 1);
  assert.ok(uncertified[0].checkins.length > 0);
});

test('a real warm-up saved under a sample name survives clearing sample data', () => {
  const name = workers.find((w) => w.sessions.length === 0).name;
  const db = addCheckin(mergeSample(emptyDb(), now), name, { soreness: 'knees', completed: true, movements: [] }, now);
  const cleared = withoutSample(db);
  assert.equal(cleared.workers.length, 1);
  assert.equal(cleared.workers[0].name, name);
  assert.equal(cleared.workers[0].sample, undefined);
  assert.deepEqual(cleared.workers[0].sessions, []);
  assert.deepEqual(checkinsOf(cleared.workers[0]).map((c) => c.soreness), ['knees']);
});

test('clearing sample data removes a sample worker with nothing real left', () => {
  assert.deepEqual(withoutSample(mergeSample(emptyDb(), now)).workers, []);
});

// Seen in a real browser: sample data loaded before check-ins existed stayed stale,
// because loading again skipped every name already present. Today read "1 of 8".
test('loading sample data again refreshes stale sample rows', () => {
  const now = new Date(2026, 8, 19, 11).getTime();
  const stale = {
    ...emptyDb(),
    workers: sampleWorkers(now - 5 * 86400000).map((w) => ({ name: w.name, sample: true, sessions: w.sessions })),
  };
  const fresh = mergeSample(stale, now);
  assert.equal(fresh.workers.length, sampleWorkers(now).length);
  assert.deepEqual(todaySummary(fresh, now), todaySummary(mergeSample(emptyDb(), now), now));
});

test('refreshing keeps a real record on a sample worker, and clearing still leaves only that', () => {
  const now = new Date(2026, 8, 19, 11).getTime();
  const name = sampleWorkers(now)[0].name;
  const real = { score: 91, passed: true, topFault: null, lifts: [] };
  const db = mergeSample(addSession(mergeSample(emptyDb(), now), name, real, now), now);
  const worker = db.workers.find((w) => w.name === name);
  assert.equal(worker.sessions.filter((s) => s.sample !== true).length, 1);
  assert.equal(worker.sessions.length, sampleWorkers(now)[0].sessions.length + 1);
  assert.ok(worker.sessions.every((s, i, all) => i === 0 || all[i - 1].date <= s.date), 'sessions stay in date order');
  assert.deepEqual(withoutSample(db).workers.map((w) => w.sessions.length), [1]);
});

// ---------- demo business (kiosk) ----------
import { DEMO_PINS, DEMO_BUSINESS } from '../js/sampleData.js';
import { checkPin } from '../js/auth.js';

test('every demo worker can sign in with the demo PIN, and ids are unique and stable', async () => {
  const now = new Date(2026, 8, 19, 11).getTime();
  const workers = sampleWorkers(now);
  for (const w of workers) assert.equal(await checkPin(DEMO_PINS.worker, w.pin), true, w.name);
  assert.equal(new Set(workers.map((w) => w.id)).size, workers.length);
  assert.deepEqual(workers.map((w) => w.id), sampleWorkers(now + 86400000).map((w) => w.id));
});

test('the demo manager PIN opens the demo business, and the worker PIN does not', async () => {
  assert.equal(await checkPin(DEMO_PINS.manager, DEMO_BUSINESS.managerPin), true);
  assert.equal(await checkPin(DEMO_PINS.worker, DEMO_BUSINESS.managerPin), false);
  assert.equal(DEMO_BUSINESS.demo, true);
});
