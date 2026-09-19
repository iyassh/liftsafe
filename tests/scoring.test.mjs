import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scoreLift, summariseSession, liveFaults, FAULTS } from '../js/engine/scoring.js';

const good = { durationMs: 2500, maxTrunk: 35, kneeAtMaxTrunk: 95, minKnee: 90, maxReach: 0.5 };

test('a clean squat lift scores 100 with no faults', () => {
  assert.deepEqual(scoreLift(good), { score: 100, faults: [] });
});

test('stooping with straight knees is heavily penalised', () => {
  const r = scoreLift({ ...good, maxTrunk: 80, kneeAtMaxTrunk: 170 });
  assert.ok(r.score <= 50, `score ${r.score}`);
  assert.ok(r.faults.includes('stoop'));
  assert.ok(r.faults.includes('trunk'));
});

// From a real webcam session: deliberate stoops measured 40–60° of trunk lean with
// knees at 151–160°+, and five of them passed at 73. A stoop must fail on its own.
test('a real-world stoop (moderate lean, straight knees) clearly fails', () => {
  const r = scoreLift({ ...good, maxTrunk: 55, kneeAtMaxTrunk: 160 });
  assert.ok(r.score <= 50, `score ${r.score}`);
  assert.ok(scoreLift({ ...good, maxTrunk: 50, kneeAtMaxTrunk: 151 }).score <= 65);
});

test('the recorded bad-form session (four stoops and a deep forward lean) does not pass', () => {
  const stoops = [151, 160, 156, 160].map((k) => ({ ...good, maxTrunk: 50, kneeAtMaxTrunk: k }));
  const lean = { ...good, maxTrunk: 71, kneeAtMaxTrunk: 120 };
  const session = summariseSession([...stoops, lean].map((l) => scoreLift(l)));
  assert.equal(session.passed, false);
  assert.equal(session.topFault, 'stoop');
});

test('a good lift with some forward lean and bent knees still scores well', () => {
  assert.ok(scoreLift({ ...good, maxTrunk: 50, kneeAtMaxTrunk: 100 }).score >= 85);
});

test('bent knees excuse a forward trunk from the stoop fault', () => {
  assert.ok(!scoreLift({ ...good, maxTrunk: 55, kneeAtMaxTrunk: 100 }).faults.includes('stoop'));
});

test('reaching and rushing are flagged', () => {
  assert.ok(scoreLift({ ...good, maxReach: 1.3 }).faults.includes('reach'));
  assert.ok(scoreLift({ ...good, durationMs: 700 }).faults.includes('fast'));
});

test('score never goes below 0', () => {
  const r = scoreLift({ durationMs: 600, maxTrunk: 95, kneeAtMaxTrunk: 178, minKnee: 175, maxReach: 2 });
  assert.ok(r.score >= 0);
});

test('session summary: mean score, pass mark, most common fault', () => {
  const s = summariseSession([
    { score: 100, faults: [] }, { score: 60, faults: ['stoop', 'reach'] }, { score: 80, faults: ['stoop'] },
  ]);
  assert.equal(s.score, 80);
  assert.equal(s.passed, true);
  assert.equal(s.topFault, 'stoop');
  assert.equal(summariseSession([{ score: 100, faults: [] }]).topFault, null);
});

test('liveFaults flags the frame that is going wrong', () => {
  assert.deepEqual(liveFaults({ trunkAngle: 10, kneeAngle: 175, reach: 0.2 }), []);
  assert.ok(liveFaults({ trunkAngle: 70, kneeAngle: 170, reach: 0.2 }).includes('stoop'));
  assert.ok(liveFaults({ trunkAngle: 30, kneeAngle: 100, reach: 1.3 }).includes('reach'));
});

test('every fault has a label and a tip', () => {
  for (const f of Object.values(FAULTS)) assert.ok(f.label && f.tip);
});

test('an empty session summarises to a failed zero, not NaN', () => {
  assert.deepEqual(summariseSession([]), { score: 0, passed: false, topFault: null });
});

test('a lift with a non-finite score does not turn the session score into NaN', () => {
  const s = summariseSession([{ score: 80, faults: [] }, { score: NaN, faults: [] }]);
  assert.equal(s.score, 80);
});

test('a lift with a missing or non-finite measurement still gets a numeric score', () => {
  const r = scoreLift({ ...good, maxReach: NaN });
  assert.equal(r.score, 100);
  assert.ok(Number.isFinite(scoreLift({ ...good, maxTrunk: undefined }).score));
});
