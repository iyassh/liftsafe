import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MOVEMENTS, MovementTracker } from '../js/engine/movements.js';

// A frame standing upright with arms down; override what the movement changes.
const frame = (over = {}) => ({ visible: true, trunkAngle: 5, kneeAngle: 175, reach: 0.2, armRaise: 5, ...over });
const hold = (f, n) => Array.from({ length: n }, () => f);

// Feed frames 100 ms apart; return the last status.
function run(tracker, frames, t0 = 0) {
  let status;
  frames.forEach((f, i) => { status = tracker.update(f, t0 + i * 100); });
  return status;
}

const squatDown = frame({ kneeAngle: 95 });
const oneSquat = [...hold(frame(), 3), ...hold(squatDown, 5), ...hold(frame(), 3)];

test('squat: five clean reps complete the movement', () => {
  const t = new MovementTracker(MOVEMENTS.squat);
  const status = run(t, Array.from({ length: 5 }, () => oneSquat).flat());
  assert.equal(status.count, 5);
  assert.equal(status.done, true);
  assert.equal(status.progress, 1);
  assert.equal(t.result().completed, true);
});

test('squat: a rep only counts once the worker comes back up', () => {
  const t = new MovementTracker(MOVEMENTS.squat);
  assert.equal(run(t, [...hold(frame(), 3), ...hold(squatDown, 5)]).count, 0);
  assert.equal(run(t, hold(frame(), 3), 800).count, 1);
});

test('squat: a shallow rep is not counted and gets a cue', () => {
  const t = new MovementTracker(MOVEMENTS.squat);
  const shallow = frame({ kneeAngle: 130 }); // 50° of flexion: past halfway, short of 70°
  const status = run(t, [...hold(frame(), 3), ...hold(shallow, 5), ...hold(frame(), 3)]);
  assert.equal(status.count, 0);
  assert.equal(status.cue, MOVEMENTS.squat.cueShallow);
});

test('squat: a small wobble gets no cue', () => {
  const t = new MovementTracker(MOVEMENTS.squat);
  const status = run(t, [...hold(frame(), 3), ...hold(frame({ kneeAngle: 160 }), 3), ...hold(frame(), 3)]);
  assert.equal(status.cue, null);
});

test('hip hinge counts on trunk angle', () => {
  const t = new MovementTracker(MOVEMENTS.hipHinge);
  const rep = [...hold(frame(), 3), ...hold(frame({ trunkAngle: 60 }), 5), ...hold(frame(), 3)];
  assert.equal(run(t, [...rep, ...rep]).count, 2);
});

test('overhead reach: completes only after holding continuously for the full time', () => {
  const t = new MovementTracker(MOVEMENTS.overheadReach);
  const up = frame({ armRaise: 170 });
  const almost = run(t, hold(up, 40)); // 3.9 s
  assert.equal(almost.done, false);
  assert.ok(almost.progress > 0.7 && almost.progress < 1);
  assert.equal(run(t, hold(up, 15), 4000).done, true);
});

test('overhead reach: dropping the arms starts the hold again', () => {
  const t = new MovementTracker(MOVEMENTS.overheadReach);
  const up = frame({ armRaise: 170 });
  run(t, hold(up, 30));
  run(t, hold(frame(), 5), 3000);
  const status = run(t, hold(up, 30), 3500);
  assert.equal(status.done, false);
  assert.ok(status.progress < 0.7);
});

test('invisible and non-finite frames are ignored', () => {
  const t = new MovementTracker(MOVEMENTS.squat);
  run(t, hold(frame(), 3));
  t.update({ visible: false }, 300);
  t.update(frame({ kneeAngle: NaN }), 400);
  t.update(null, 500);
  assert.equal(run(t, oneSquat, 600).count, 1);
});

test('a long gap drops the rep in progress', () => {
  const t = new MovementTracker(MOVEMENTS.squat);
  run(t, [...hold(frame(), 3), ...hold(squatDown, 5)]);
  assert.equal(run(t, hold(frame(), 3), 60000).count, 0);
});

test('result reports quality between 0 and 1 and how long it took', () => {
  const t = new MovementTracker(MOVEMENTS.squat);
  run(t, Array.from({ length: 5 }, () => oneSquat).flat());
  const r = t.result();
  assert.equal(r.id, 'squat');
  assert.ok(r.quality > 0 && r.quality <= 1);
  assert.ok(r.durationMs > 0);
});

test('every movement has what the screen needs', () => {
  for (const [id, m] of Object.entries(MOVEMENTS)) {
    assert.equal(m.id, id);
    assert.ok(m.name && m.instruction && m.cueShallow);
    assert.ok(m.kind === 'reps' || m.kind === 'hold');
    assert.ok(m.enter > m.exit);
  }
});
