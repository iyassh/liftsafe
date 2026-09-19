import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LiftAnalyzer } from '../js/engine/liftAnalyzer.js';

const frame = (trunkAngle, kneeAngle, reach = 0.2) => ({ visible: true, trunkAngle, kneeAngle, reach });

// Feed a sequence of [trunk, knee, reach] at 100 ms spacing; return emitted lifts.
function run(analyzer, frames, t0 = 0) {
  const lifts = [];
  frames.forEach((f, i) => {
    const ev = analyzer.update(frame(...f), t0 + i * 100);
    if (ev) lifts.push(ev);
  });
  return lifts;
}

const hold = (f, n) => Array.from({ length: n }, () => f);
const opts = { smoothing: 1 }; // no smoothing, so tests are exact

test('a squat lift is detected once and summarised', () => {
  const lifts = run(new LiftAnalyzer(opts), [
    ...hold([5, 175], 5), ...hold([30, 100, 0.5], 10), ...hold([5, 175], 5),
  ]);
  assert.equal(lifts.length, 1);
  const l = lifts[0];
  assert.equal(l.maxTrunk, 30);
  assert.equal(l.kneeAtMaxTrunk, 100);
  assert.equal(l.minKnee, 100);
  assert.equal(l.maxReach, 0.5);
  assert.ok(l.durationMs >= 900);
});

test('a stoop (straight knees, trunk forward) is also a lift', () => {
  const lifts = run(new LiftAnalyzer(opts), [
    ...hold([5, 175], 3), ...hold([80, 170], 10), ...hold([5, 175], 3),
  ]);
  assert.equal(lifts.length, 1);
  assert.equal(lifts[0].kneeAtMaxTrunk, 170);
});

test('a brief wobble is ignored', () => {
  const lifts = run(new LiftAnalyzer(opts), [
    ...hold([5, 175], 3), ...hold([50, 170], 2), ...hold([5, 175], 3),
  ]);
  assert.equal(lifts.length, 0);
});

test('phase is exposed and invisible frames do not advance state', () => {
  const a = new LiftAnalyzer(opts);
  a.update(frame(5, 175), 0);
  assert.equal(a.phase, 'standing');
  a.update(frame(60, 170), 100);
  assert.equal(a.phase, 'lifting');
  a.update({ visible: false }, 200);
  assert.equal(a.phase, 'lifting');
});

test('two lifts in a row give two events', () => {
  const one = [...hold([5, 175], 3), ...hold([30, 100], 10)];
  const lifts = run(new LiftAnalyzer(opts), [...one, ...one, ...hold([5, 175], 3)]);
  assert.equal(lifts.length, 2);
});

test('default smoothing still detects a realistic lift', () => {
  const down = Array.from({ length: 10 }, (_, i) => [5 + i * 3, 175 - i * 8]);
  const lifts = run(new LiftAnalyzer(), [
    ...hold([5, 175], 5), ...down, ...hold([35, 95], 8), ...down.toReversed(), ...hold([5, 175], 8),
  ]);
  assert.equal(lifts.length, 1);
  assert.ok(lifts[0].minKnee < 110, `minKnee ${lifts[0].minKnee}`);
});

test('reset returns to standing and drops the lift in progress', () => {
  const a = new LiftAnalyzer(opts);
  a.update(frame(60, 170), 0);
  a.reset();
  assert.equal(a.phase, 'standing');
  assert.equal(run(a, hold([5, 175], 3), 1000).length, 0);
});
