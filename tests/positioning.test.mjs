import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkPosition } from '../js/engine/positioning.js';
import { LM } from '../js/engine/poseMetrics.js';

function pose(overrides = {}) {
  const lms = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, visibility: 0.9 }));
  const base = {
    nose: { x: 0.5, y: 0.15 }, leftShoulder: { x: 0.5, y: 0.3 }, rightShoulder: { x: 0.52, y: 0.3 },
    leftHip: { x: 0.5, y: 0.55 }, rightHip: { x: 0.51, y: 0.55 },
    leftKnee: { x: 0.5, y: 0.72 }, leftAnkle: { x: 0.5, y: 0.9 }, rightAnkle: { x: 0.5, y: 0.9 },
  };
  for (const [k, p] of Object.entries({ ...base, ...overrides })) lms[LM[k]] = { visibility: 0.9, ...p };
  return lms;
}

test('side-on, full body in frame → ready', () => assert.equal(checkPosition(pose(), 1), null));

test('no pose → step into view', () => assert.equal(checkPosition(null, 1).id, 'no-person'));

test('feet cut off → step back', () =>
  assert.equal(checkPosition(pose({ leftAnkle: { x: 0.5, y: 0.99 }, rightAnkle: { x: 0.5, y: 0.99 } }), 1).id, 'too-close'));

test('facing the camera → turn sideways', () =>
  assert.equal(checkPosition(pose({ leftShoulder: { x: 0.4, y: 0.3 }, rightShoulder: { x: 0.6, y: 0.3 } }), 1).id, 'turn-sideways'));

test('hidden legs → cannot see', () => {
  const hidden = { x: 0.5, y: 0.8, visibility: 0.05 }; // both sides, or pickSide just switches legs
  const lms = pose({ leftKnee: hidden, leftAnkle: hidden, rightKnee: hidden, rightAnkle: hidden });
  assert.equal(checkPosition(lms, 1).id, 'not-visible');
});

test('every problem carries a plain-language message', () => {
  assert.match(checkPosition(null, 1).message, /\w+/);
});
