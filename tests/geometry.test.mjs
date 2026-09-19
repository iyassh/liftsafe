import { test } from 'node:test';
import assert from 'node:assert/strict';
import { angleAt, angleFromVertical, dist, ramp } from '../js/engine/geometry.js';

const near = (a, b, tol = 0.5) => assert.ok(Math.abs(a - b) <= tol, `${a} !~ ${b}`);

test('angleAt: straight line is 180, right angle is 90', () => {
  near(angleAt({ x: 0, y: 0 }, { x: 0, y: 1 }, { x: 0, y: 2 }), 180);
  near(angleAt({ x: 0, y: 0 }, { x: 0, y: 1 }, { x: 1, y: 1 }), 90);
});

test('angleFromVertical: image y grows downward, so "up" is negative y', () => {
  near(angleFromVertical({ x: 0, y: 1 }, { x: 0, y: 0 }), 0); // shoulder directly above hip
  near(angleFromVertical({ x: 0, y: 1 }, { x: 1, y: 1 }), 90); // torso horizontal
  near(angleFromVertical({ x: 0, y: 1 }, { x: 1, y: 0 }), 45);
  near(angleFromVertical({ x: 0, y: 1 }, { x: -1, y: 0 }), 45); // direction-agnostic
});

test('degenerate inputs do not produce NaN', () => {
  const p = { x: 1, y: 1 };
  assert.ok(Number.isFinite(angleAt(p, p, p)));
  assert.ok(Number.isFinite(angleFromVertical(p, p)));
});

test('dist', () => near(dist({ x: 0, y: 0 }, { x: 3, y: 4 }), 5, 1e-9));

test('ramp clamps to 0..1', () => {
  assert.equal(ramp(5, 10, 20), 0);
  assert.equal(ramp(15, 10, 20), 0.5);
  assert.equal(ramp(99, 10, 20), 1);
});
