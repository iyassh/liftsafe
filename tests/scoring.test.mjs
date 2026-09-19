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
