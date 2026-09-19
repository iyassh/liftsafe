import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sampleWorkers } from '../js/sampleData.js';
import { workerStatus, addSession, emptyDb } from '../js/store.js';
import { mergeSample, withoutSample } from '../js/dashboard.js';
import { FAULTS } from '../js/engine/scoring.js';

const now = Date.UTC(2026, 8, 19, 17, 30);
const workers = sampleWorkers(now);
const sessions = workers.flatMap((w) => w.sessions);

test('five sample workers, all flagged as sample', () => {
  assert.equal(workers.length, 5);
  for (const w of workers) assert.equal(w.sample, true);
  assert.equal(new Set(workers.map((w) => w.name)).size, 5);
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
    assert.deepEqual([...statuses].sort(), ['current', 'due-soon', 'overdue']);
  }
});

test('no session is dated in the future', () => {
  for (const s of sessions) assert.ok(s.date <= now);
});

test('sessions within a worker are in ascending date order', () => {
  for (const w of workers) {
    assert.ok(w.sessions.length >= 1);
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
  assert.equal(twice.workers.length, 6);
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
