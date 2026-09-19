import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LM, pickSide, computeMetrics } from '../js/engine/poseMetrics.js';

const near = (a, b, tol = 1) => assert.ok(Math.abs(a - b) <= tol, `${a} !~ ${b}`);

// Build a 33-landmark array; unspecified landmarks are invisible.
function pose(points) {
  const lms = Array.from({ length: 33 }, () => ({ x: 0, y: 0, visibility: 0 }));
  for (const [name, p] of Object.entries(points)) lms[LM[name]] = { visibility: 0.9, ...p };
  return lms;
}

const standingLeft = pose({
  leftShoulder: { x: 0.5, y: 0.3 }, leftHip: { x: 0.5, y: 0.55 },
  leftKnee: { x: 0.5, y: 0.75 }, leftAnkle: { x: 0.5, y: 0.95 },
  leftWrist: { x: 0.5, y: 0.6 },
});

test('pickSide prefers the more visible side', () => {
  assert.equal(pickSide(standingLeft), 'left');
});

test('standing upright: trunk ~0, knee ~180, reach ~0', () => {
  const m = computeMetrics(standingLeft, 1);
  near(m.trunkAngle, 0); near(m.kneeAngle, 180); near(m.reach, 0, 0.05);
  assert.ok(m.visible);
});

test('aspect ratio is applied to x before measuring angles', () => {
  // Shoulder 0.1 right and 0.1 up of hip. Square video: 45°. 2:1 video: x doubles → ~63.4°.
  const p = pose({
    leftShoulder: { x: 0.6, y: 0.4 }, leftHip: { x: 0.5, y: 0.5 },
    leftKnee: { x: 0.5, y: 0.7 }, leftAnkle: { x: 0.5, y: 0.9 }, leftWrist: { x: 0.5, y: 0.5 },
  });
  near(computeMetrics(p, 1).trunkAngle, 45);
  near(computeMetrics(p, 2).trunkAngle, 63.4);
});

test('reach is horizontal wrist–ankle distance in torso lengths', () => {
  const p = pose({
    leftShoulder: { x: 0.5, y: 0.3 }, leftHip: { x: 0.5, y: 0.5 }, // torso = 0.2
    leftKnee: { x: 0.5, y: 0.7 }, leftAnkle: { x: 0.5, y: 0.9 },
    leftWrist: { x: 0.7, y: 0.8 }, // 0.2 in front
  });
  near(computeMetrics(p, 1).reach, 1, 0.01);
});

test('a hidden wrist does not invent a reach value', () => {
  const p = pose({
    leftShoulder: { x: 0.5, y: 0.3 }, leftHip: { x: 0.5, y: 0.5 },
    leftKnee: { x: 0.5, y: 0.7 }, leftAnkle: { x: 0.5, y: 0.9 },
    leftWrist: { x: 0.95, y: 0.8, visibility: 0.1 },
  });
  assert.equal(computeMetrics(p, 1).reach, 0);
});

// Seen on real footage: a waist-up shot, where MediaPipe guesses the legs below the frame.
test('confident shoulder and hip do not make up for an unseen ankle', () => {
  const p = pose({
    leftShoulder: { x: 0.5, y: 0.3, visibility: 1 }, leftHip: { x: 0.5, y: 0.72, visibility: 0.99 },
    leftKnee: { x: 0.5, y: 0.95, visibility: 0.61 }, leftAnkle: { x: 0.5, y: 0.98, visibility: 0.2 },
  });
  assert.equal(computeMetrics(p, 1).visible, false);
});

test('joints guessed outside the frame are not visible, whatever their confidence', () => {
  const p = pose({
    leftShoulder: { x: 0.5, y: 0.3 }, leftHip: { x: 0.5, y: 0.72 },
    leftKnee: { x: 0.5, y: 1.02 }, leftAnkle: { x: 0.5, y: 1.23 },
  });
  assert.equal(computeMetrics(p, 1).visible, false);
});

test('not visible when key joints are hidden', () => {
  assert.equal(computeMetrics(pose({ leftShoulder: { x: 0.5, y: 0.3 } }), 1).visible, false);
});

const arm = (wrist) => pose({
  leftShoulder: { x: 0.5, y: 0.3 }, leftHip: { x: 0.5, y: 0.55 },
  leftKnee: { x: 0.5, y: 0.75 }, leftAnkle: { x: 0.5, y: 0.95 }, leftWrist: wrist,
});

test('armRaise: 0 hanging at the side, 90 straight forward, 180 overhead', () => {
  near(computeMetrics(arm({ x: 0.5, y: 0.55 }), 1).armRaise, 0);
  near(computeMetrics(arm({ x: 0.75, y: 0.3 }), 1).armRaise, 90);
  near(computeMetrics(arm({ x: 0.5, y: 0.05 }), 1).armRaise, 180);
});

test('armRaise is 0 when the wrist is not seen', () => {
  assert.equal(computeMetrics(arm({ x: 0.5, y: 0.05, visibility: 0.1 }), 1).armRaise, 0);
});
