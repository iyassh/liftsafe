# LiftSafe Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** A browser app where a worker does five box lifts in front of a webcam, gets live red/green coaching and a Lift Safety Score, and the result is saved as a dated training record on a supervisor dashboard with a 90-day recheck status.

**Architecture:** Static site, no backend, no build step. MediaPipe Pose Landmarker runs in the browser on the webcam feed. A small pure-JS engine turns landmarks into metrics (trunk angle, knee angle, reach), a state machine segments each lift, and a scoring module converts a lift into a 0–100 score with named faults. Records live in `localStorage`. The engine has no DOM or MediaPipe dependency, so it is unit-tested with Node's built-in test runner.

**Tech Stack:** Plain HTML/CSS/ES modules. `@mediapipe/tasks-vision` (vendored locally so the demo survives bad Wi-Fi). `node --test` for engine tests. `python3 -m http.server` for local dev. GitHub Pages for hosting.

**Design doc:** `docs/plans/2026-09-18-liftsafe-design.md`

**Rules that constrain us:** everything presented must be written during the event. Do not copy code from the reference repo (thaochu05/AI-Personal-Trainer) — it is unlicensed and pre-existing. We reuse its *ideas* only: joint angles → thresholds → state machine, plus a side-on check. No Claude attribution lines on commits.

---

## Timeline

| When | Target | Tasks |
|---|---|---|
| Fri 6:45–9:00 PM | Skeleton on screen, engine tested | 0, 1, 2, 3, 4 |
| Sat 9:00 AM–12:00 PM | Full 5-lift check works end to end | 5, 6, 7 |
| Sat 12:00–2:00 PM | Records + dashboard | 8, 9 |
| Sat 2:00–3:00 PM | **Tune thresholds with a real box. Record backup video.** | 10 |
| Sat ~3:00 PM | **Mentor demo (required to present Sunday)** | — |
| Sat 3:00–7:00 PM | Landing page, polish, deploy, stretch items | 11, 12, 13 |
| Sat 7:00–9:00 PM | Slides and pitch rehearsal only. Code freeze at 7. | — |
| Sun 9:30 AM | Arrive. Test camera and lighting in the room. | — |

Ask the organizers tonight: **when exactly is the Saturday mentor demo, and may teams work outside the official sessions?** Adjust the table to their answer.

## Team split

Tasks are grouped so people do not edit the same files.

- **Engine (1 person):** Tasks 1–4, then 10. Pure JS + tests. No browser needed until Task 10.
- **Check screen (1 person):** Tasks 0, 5, 6, 7. Camera, skeleton, session flow.
- **Dashboard + landing (1 person):** Tasks 8, 9, 11. Depends only on the `store.js` API in Task 8.
- **Pitch (1 person, or everyone after 7 PM Sat):** slides from the design doc, the BC industry-count number, the backup video, the box.

Solo: do the tasks in numeric order.

## File map

```
index.html            landing page (Task 11)
check.html            the lift check (Tasks 5–7)
dashboard.html        supervisor dashboard (Task 9)
css/style.css
js/engine/geometry.js     Task 1
js/engine/poseMetrics.js  Task 2
js/engine/liftAnalyzer.js Task 3
js/engine/scoring.js      Task 4
js/engine/positioning.js  Task 6
js/store.js               Task 8
js/sampleData.js          Task 9
js/check.js  js/dashboard.js
tests/*.test.mjs
vendor/mediapipe/     wasm + model, downloaded in Task 0
```

## What the camera can and cannot see (read before touching thresholds)

MediaPipe gives 33 landmarks but **none along the spine**. We cannot literally see a "rounded back". From a side view we can measure:

- **Trunk angle** — hip→shoulder line vs vertical. 0° upright, 90° horizontal.
- **Knee angle** — hip–knee–ankle. 180° straight leg.
- **Reach** — horizontal wrist-to-ankle distance, in torso lengths.

So the faults we report are: **stooping** (trunk far forward while knees stay straight), **excessive forward lean**, **load far from body**, **lifting too fast**. In the UI and the pitch, say "bending at the waist", never "spinal curvature". Threshold bands start from REBA (trunk 20–60° moderate, >60° high) and the NIOSH horizontal-distance idea; they are starting points and get tuned in Task 10.

---

### Task 0: Scaffold and vendored MediaPipe

**Files:**
- Create: `package.json`, `.gitignore`, `vendor/mediapipe/*`, `README.md`

**Step 1: package.json**

```json
{
  "name": "liftsafe",
  "private": true,
  "type": "module",
  "scripts": {
    "test": "node --test tests/",
    "dev": "python3 -m http.server 8000"
  }
}
```

**Step 2: .gitignore**

```
node_modules/
.DS_Store
```

**Step 3: Vendor MediaPipe** (so the demo works offline)

```bash
mkdir -p vendor/mediapipe/wasm tmp_mp && cd tmp_mp
npm pack @mediapipe/tasks-vision@0.10.14 && tar -xzf mediapipe-tasks-vision-0.10.14.tgz
cp package/vision_bundle.mjs ../vendor/mediapipe/
cp package/wasm/* ../vendor/mediapipe/wasm/
cd .. && rm -rf tmp_mp
curl -L -o vendor/mediapipe/pose_landmarker_lite.task \
  https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task
ls -lh vendor/mediapipe vendor/mediapipe/wasm
```

Expected: `vision_bundle.mjs`, a `.task` file of a few MB, and `vision_wasm_internal.{js,wasm}` (plus nosimd variants). If the npm version is unavailable, use the latest 0.10.x and note it in the README.

**Step 4: README.md** — three lines: what it is, `npm run dev` then open `http://localhost:8000`, `npm test`.

**Step 5: Commit**

```bash
git add -A && git commit -m "Scaffold project and vendor MediaPipe pose model"
```

---

### Task 1: Geometry helpers

**Files:**
- Create: `js/engine/geometry.js`
- Test: `tests/geometry.test.mjs`

**Step 1: Write the failing test**

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { angleAt, angleFromVertical, dist, ramp } from '../js/engine/geometry.js';

const near = (a, b, tol = 0.5) => assert.ok(Math.abs(a - b) <= tol, `${a} !~ ${b}`);

test('angleAt: straight line is 180, right angle is 90', () => {
  near(angleAt({ x: 0, y: 0 }, { x: 0, y: 1 }, { x: 0, y: 2 }), 180);
  near(angleAt({ x: 0, y: 0 }, { x: 0, y: 1 }, { x: 1, y: 1 }), 90);
});

test('angleFromVertical: image y grows downward, so "up" is negative y', () => {
  near(angleFromVertical({ x: 0, y: 1 }, { x: 0, y: 0 }), 0);   // shoulder directly above hip
  near(angleFromVertical({ x: 0, y: 1 }, { x: 1, y: 1 }), 90);  // torso horizontal
  near(angleFromVertical({ x: 0, y: 1 }, { x: 1, y: 0 }), 45);
  near(angleFromVertical({ x: 0, y: 1 }, { x: -1, y: 0 }), 45); // direction-agnostic
});

test('dist', () => near(dist({ x: 0, y: 0 }, { x: 3, y: 4 }), 5, 1e-9));

test('ramp clamps to 0..1', () => {
  assert.equal(ramp(5, 10, 20), 0);
  assert.equal(ramp(15, 10, 20), 0.5);
  assert.equal(ramp(99, 10, 20), 1);
});
```

**Step 2: Run to verify it fails**

Run: `npm test`
Expected: FAIL — cannot find module `geometry.js`.

**Step 3: Implement**

```js
const DEG = 180 / Math.PI;

export function dist(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

// Interior angle at b, in degrees, for the path a–b–c.
export function angleAt(a, b, c) {
  const v1 = { x: a.x - b.x, y: a.y - b.y };
  const v2 = { x: c.x - b.x, y: c.y - b.y };
  const m = Math.hypot(v1.x, v1.y) * Math.hypot(v2.x, v2.y);
  if (m === 0) return 180;
  const cos = Math.min(1, Math.max(-1, (v1.x * v2.x + v1.y * v2.y) / m));
  return Math.acos(cos) * DEG;
}

// Angle between the vector from→to and straight up. Image coordinates: y grows downward.
export function angleFromVertical(from, to) {
  const v = { x: to.x - from.x, y: to.y - from.y };
  const m = Math.hypot(v.x, v.y);
  if (m === 0) return 0;
  return Math.acos(Math.min(1, Math.max(-1, -v.y / m))) * DEG;
}

// 0 below lo, 1 above hi, linear between.
export function ramp(v, lo, hi) {
  return Math.min(1, Math.max(0, (v - lo) / (hi - lo)));
}
```

**Step 4: Run** `npm test` → PASS.

**Step 5: Commit** `git add -A && git commit -m "Add geometry helpers"`

---

### Task 2: Pose metrics

**Files:**
- Create: `js/engine/poseMetrics.js`
- Test: `tests/poseMetrics.test.mjs`

**Gotcha:** MediaPipe landmarks are normalized 0..1 on each axis separately. On a 16:9 video, angles computed on raw values are wrong. Multiply x by `aspect = width / height` first.

**Step 1: Write the failing test**

```js
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
    leftShoulder: { x: 0.5, y: 0.3 }, leftHip: { x: 0.5, y: 0.5 },   // torso = 0.2
    leftKnee: { x: 0.5, y: 0.7 }, leftAnkle: { x: 0.5, y: 0.9 },
    leftWrist: { x: 0.7, y: 0.8 },                                    // 0.2 in front
  });
  near(computeMetrics(p, 1).reach, 1, 0.01);
});

test('not visible when key joints are hidden', () => {
  assert.equal(computeMetrics(pose({ leftShoulder: { x: 0.5, y: 0.3 } }), 1).visible, false);
});
```

**Step 2: Run** `npm test` → FAIL (module missing).

**Step 3: Implement**

```js
import { angleAt, angleFromVertical, dist } from './geometry.js';

export const LM = {
  nose: 0, leftEar: 7, rightEar: 8,
  leftShoulder: 11, rightShoulder: 12, leftWrist: 15, rightWrist: 16,
  leftHip: 23, rightHip: 24, leftKnee: 25, rightKnee: 26, leftAnkle: 27, rightAnkle: 28,
};

const CORE = ['Shoulder', 'Hip', 'Knee', 'Ankle'];
const MIN_VIS = 0.5;

const vis = (lms, side) => CORE.reduce((s, j) => s + (lms[LM[side + j]].visibility ?? 0), 0) / CORE.length;

export function pickSide(lms) {
  return vis(lms, 'left') >= vis(lms, 'right') ? 'left' : 'right';
}

export function computeMetrics(lms, aspect) {
  const side = pickSide(lms);
  const visibility = vis(lms, side);
  const pt = (j) => ({ x: lms[LM[side + j]].x * aspect, y: lms[LM[side + j]].y });
  const [shoulder, hip, knee, ankle, wrist] = ['Shoulder', 'Hip', 'Knee', 'Ankle', 'Wrist'].map(pt);
  const torso = dist(shoulder, hip);
  return {
    side,
    visibility,
    visible: visibility >= MIN_VIS && torso > 0,
    trunkAngle: angleFromVertical(hip, shoulder),
    kneeAngle: angleAt(hip, knee, ankle),
    reach: torso > 0 ? Math.abs(wrist.x - ankle.x) / torso : 0,
  };
}
```

**Step 4: Run** `npm test` → PASS.

**Step 5: Commit** `git add -A && git commit -m "Compute trunk, knee and reach metrics from pose landmarks"`

---

### Task 3: Lift analyzer (state machine)

**Files:**
- Create: `js/engine/liftAnalyzer.js`
- Test: `tests/liftAnalyzer.test.mjs`

One signal drives the phases: `bend = max(trunkAngle, 180 − kneeAngle)`. It rises whether the worker squats (knees) or stoops (trunk). `standing → lifting` when bend exceeds `startBend`; `lifting → standing` when it drops under `endBend` (hysteresis stops flicker). On return to standing, emit a lift summary if it lasted long enough. Inputs are smoothed with an exponential moving average because raw landmarks jitter.

**Step 1: Write the failing test**

```js
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
  const a = new LiftAnalyzer(opts);
  const lifts = run(a, [
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
```

**Step 2: Run** `npm test` → FAIL.

**Step 3: Implement**

```js
const DEFAULTS = {
  startBend: 45,       // degrees of bend that starts a lift
  endBend: 25,         // back under this = standing again
  minDurationMs: 600,  // shorter than this is noise
  smoothing: 0.4,      // EMA factor; 1 = off
};

export class LiftAnalyzer {
  constructor(config = {}) {
    this.cfg = { ...DEFAULTS, ...config };
    this.phase = 'standing';
    this.smooth = null;
    this.cur = null;
  }

  // Returns a lift summary when a lift completes, otherwise null.
  update(m, tMs) {
    if (!m.visible) return null;
    const k = this.cfg.smoothing;
    const s = this.smooth
      ? {
          trunkAngle: this.smooth.trunkAngle + k * (m.trunkAngle - this.smooth.trunkAngle),
          kneeAngle: this.smooth.kneeAngle + k * (m.kneeAngle - this.smooth.kneeAngle),
          reach: this.smooth.reach + k * (m.reach - this.smooth.reach),
        }
      : { trunkAngle: m.trunkAngle, kneeAngle: m.kneeAngle, reach: m.reach };
    this.smooth = s;
    const bend = Math.max(s.trunkAngle, 180 - s.kneeAngle);

    if (this.phase === 'standing') {
      if (bend > this.cfg.startBend) {
        this.phase = 'lifting';
        this.cur = { start: tMs, maxTrunk: -1, kneeAtMaxTrunk: 180, minKnee: 180, maxReach: 0 };
        this.#collect(s);
      }
      return null;
    }

    if (bend < this.cfg.endBend) {
      const c = this.cur;
      this.phase = 'standing';
      this.cur = null;
      const durationMs = tMs - c.start;
      if (durationMs < this.cfg.minDurationMs) return null;
      return { durationMs, maxTrunk: c.maxTrunk, kneeAtMaxTrunk: c.kneeAtMaxTrunk, minKnee: c.minKnee, maxReach: c.maxReach };
    }
    this.#collect(s);
    return null;
  }

  // Live values for the on-screen overlay.
  get current() {
    return this.smooth;
  }

  #collect(s) {
    const c = this.cur;
    if (s.trunkAngle > c.maxTrunk) { c.maxTrunk = s.trunkAngle; c.kneeAtMaxTrunk = s.kneeAngle; }
    c.minKnee = Math.min(c.minKnee, s.kneeAngle);
    c.maxReach = Math.max(c.maxReach, s.reach);
  }
}
```

**Step 4: Run** `npm test` → PASS.

**Step 5: Commit** `git add -A && git commit -m "Segment lifts with a bend-driven state machine"`

---

### Task 4: Scoring

**Files:**
- Create: `js/engine/scoring.js`
- Test: `tests/scoring.test.mjs`

A lift starts at 100 and loses points per fault. Each penalty ramps in, so a slightly-off lift loses a little, not everything. A fault is *named* only when its penalty is at least 5. `liveFaults` applies the same thresholds to a single frame so the skeleton can turn red mid-lift.

**Step 1: Write the failing test**

```js
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
```

**Step 2: Run** `npm test` → FAIL.

**Step 3: Implement**

```js
import { ramp } from './geometry.js';

export const FAULTS = {
  stoop: { label: 'Bending at the waist, not the knees', tip: 'Bend your knees and keep your chest up.' },
  trunk: { label: 'Leaning too far forward', tip: 'Get closer and go down with your legs so your back stays upright.' },
  reach: { label: 'Load too far from your body', tip: 'Step in. Keep the load close to your belt.' },
  fast: { label: 'Lifting too fast', tip: 'Lift smoothly. No jerking.' },
};

// Starting points from REBA trunk bands and the NIOSH horizontal-distance idea. Tuned in Task 10.
export const THRESHOLDS = {
  stoopTrunk: 40, stoopKnee: [130, 160], stoopPenalty: 35,
  trunk: [60, 90], trunkPenalty: 30,
  reach: [0.8, 1.2], reachPenalty: 25,
  fastMs: 1000, fastPenalty: 10,
  passMark: 70,
  namedAt: 5,
};

function penalties(trunk, knee, reach, durationMs, t) {
  return {
    stoop: trunk >= t.stoopTrunk ? t.stoopPenalty * ramp(knee, ...t.stoopKnee) : 0,
    trunk: t.trunkPenalty * ramp(trunk, ...t.trunk),
    reach: t.reachPenalty * ramp(reach, ...t.reach),
    fast: durationMs != null && durationMs < t.fastMs ? t.fastPenalty : 0,
  };
}

const named = (p, t) => Object.keys(p).filter((k) => p[k] >= t.namedAt);

export function scoreLift(lift, t = THRESHOLDS) {
  const p = penalties(lift.maxTrunk, lift.kneeAtMaxTrunk, lift.maxReach, lift.durationMs, t);
  const total = Object.values(p).reduce((a, b) => a + b, 0);
  return { score: Math.max(0, Math.round(100 - total)), faults: named(p, t) };
}

export function liveFaults(m, t = THRESHOLDS) {
  return named(penalties(m.trunkAngle, m.kneeAngle, m.reach, null, t), t);
}

export function summariseSession(lifts, t = THRESHOLDS) {
  const score = Math.round(lifts.reduce((s, l) => s + l.score, 0) / lifts.length);
  const counts = {};
  for (const l of lifts) for (const f of l.faults) counts[f] = (counts[f] ?? 0) + 1;
  const topFault = Object.keys(counts).sort((a, b) => counts[b] - counts[a])[0] ?? null;
  return { score, passed: score >= t.passMark, topFault };
}
```

**Step 4: Run** `npm test` → PASS (all four test files).

**Step 5: Commit** `git add -A && git commit -m "Score lifts and name faults"` then `git push`.

**Friday-night checkpoint: engine done and tested.**

---

### Task 5: Camera + live skeleton (check.html)

**Files:**
- Create: `check.html`, `js/check.js`, `css/style.css`

No unit tests; verify in the browser. Run `npm run dev`, open `http://localhost:8000/check.html`. (Camera needs `localhost` or https — opening the file directly will not work.)

**Step 1: check.html** — a `<main>` with: a header (`LiftSafe` + privacy badge "🔒 Video never leaves this device"), a stage `div.stage` containing `<video id="cam" autoplay playsinline muted>` and `<canvas id="overlay">` stacked with CSS (canvas absolutely positioned over video, both mirrored with `transform: scaleX(-1)`), a status line `#status`, and a side panel `#panel` (used in Task 7). `<script type="module" src="js/check.js">`.

**Step 2: js/check.js — MediaPipe init and loop**

```js
import { PoseLandmarker, FilesetResolver } from '../vendor/mediapipe/vision_bundle.mjs';
import { computeMetrics } from './engine/poseMetrics.js';
import { liveFaults } from './engine/scoring.js';

const video = document.getElementById('cam');
const canvas = document.getElementById('overlay');
const ctx = canvas.getContext('2d');
const statusEl = document.getElementById('status');

const BONES = [[11, 13], [13, 15], [12, 14], [14, 16], [11, 12], [11, 23], [12, 24], [23, 24],
  [23, 25], [25, 27], [24, 26], [26, 28]];

async function init() {
  statusEl.textContent = 'Loading pose model…';
  const fileset = await FilesetResolver.forVisionTasks('vendor/mediapipe/wasm');
  const landmarker = await PoseLandmarker.createFromOptions(fileset, {
    baseOptions: { modelAssetPath: 'vendor/mediapipe/pose_landmarker_lite.task', delegate: 'GPU' },
    runningMode: 'VIDEO',
    numPoses: 1,
  });
  video.srcObject = await navigator.mediaDevices.getUserMedia({ video: { width: 1280, height: 720 }, audio: false });
  await video.play();
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  statusEl.textContent = 'Ready';
  requestAnimationFrame(() => loop(landmarker));
}

let lastTime = -1;
function loop(landmarker) {
  if (video.currentTime !== lastTime) {
    lastTime = video.currentTime;
    const now = performance.now();
    const res = landmarker.detectForVideo(video, now);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const lms = res.landmarks?.[0];
    if (lms) onPose(lms, now);
  }
  requestAnimationFrame(() => loop(landmarker));
}

function onPose(lms, now) {
  const m = computeMetrics(lms, canvas.width / canvas.height);
  const bad = m.visible && liveFaults(m).length > 0;
  drawSkeleton(lms, bad ? '#ff3b30' : '#34c759');
}

function drawSkeleton(lms, color) {
  const px = (i) => [lms[i].x * canvas.width, lms[i].y * canvas.height];
  ctx.lineWidth = 6; ctx.strokeStyle = color; ctx.fillStyle = color; ctx.lineCap = 'round';
  for (const [a, b] of BONES) {
    if ((lms[a].visibility ?? 0) < 0.5 || (lms[b].visibility ?? 0) < 0.5) continue;
    ctx.beginPath(); ctx.moveTo(...px(a)); ctx.lineTo(...px(b)); ctx.stroke();
  }
  for (const i of new Set(BONES.flat())) {
    if ((lms[i].visibility ?? 0) < 0.5) continue;
    ctx.beginPath(); ctx.arc(...px(i), 7, 0, Math.PI * 2); ctx.fill();
  }
}

init().catch((e) => { statusEl.textContent = `Could not start: ${e.message}`; console.error(e); });
```

If `delegate: 'GPU'` fails on a machine, fall back to `'CPU'` in a try/catch.

**Step 3: css/style.css** — dark background (`#0b0f14`), hi-vis palette (green `#34c759`, amber `#ffcc00`, red `#ff3b30`), large type readable from 2 m, `.stage { position: relative; aspect-ratio: 16/9 }`, video and canvas `width: 100%`.

**Step 4: Verify in browser:** skeleton tracks you, green upright; bend at the waist with straight knees → red. Camera denied → readable message in `#status`.

**Step 5: Commit + push** `git add -A && git commit -m "Live skeleton overlay with fault colouring" && git push`

**Friday stretch goal. If it is 9 PM, stop here.**

---

### Task 6: Positioning check

**Files:**
- Create: `js/engine/positioning.js`, `tests/positioning.test.mjs`
- Modify: `js/check.js`

Returns the first problem found, or `null` when ready. This is the fix for the reference app's cryptic "CAMERA NOT ALIGNED PROPERLY".

**Step 1: Failing test**

```js
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
```

**Step 2: Run** → FAIL.

**Step 3: Implement**

```js
import { LM, computeMetrics } from './poseMetrics.js';
import { dist } from './geometry.js';

const MSG = {
  'no-person': 'Step into view',
  'not-visible': "We can't see your whole body. Clear the space around you.",
  'too-close': "Step back — we can't see your feet",
  'turn-sideways': 'Turn sideways to the camera ↻',
};
const problem = (id) => ({ id, message: MSG[id] });

export function checkPosition(lms, aspect) {
  if (!lms) return problem('no-person');
  const m = computeMetrics(lms, aspect);
  if (!m.visible) return problem('not-visible');
  const ankleY = Math.max(lms[LM.leftAnkle].y, lms[LM.rightAnkle].y);
  if (ankleY > 0.97 || lms[LM.nose].y < 0.03) return problem('too-close');
  const sc = (i) => ({ x: lms[i].x * aspect, y: lms[i].y });
  const torso = dist(sc(LM[m.side + 'Shoulder']), sc(LM[m.side + 'Hip']));
  const shoulderSpread = Math.abs(lms[LM.leftShoulder].x - lms[LM.rightShoulder].x) * aspect;
  if (shoulderSpread / torso > 0.45) return problem('turn-sideways');
  return null;
}
```

**Step 4: Run** → PASS.

**Step 5: Wire into check.js:** while in the `positioning` state (Task 7), show `problem.message` large over the video in amber; when `null` for 1.5 s continuously, show a green "✓ Ready" and move on. Verify in the browser: face the camera → "Turn sideways"; walk close → "Step back".

**Step 6: Commit** `git add -A && git commit -m "Guide the worker into position before scoring"`

---

### Task 7: Five-lift session flow

**Files:**
- Modify: `check.html`, `js/check.js`, `css/style.css`

Screen states, one visible at a time: `name → positioning → lifting → results`.

1. **name:** one input "Worker name" + big **Start** button. Read `?name=` from the URL to prefill (dashboard "Recheck" links use it).
2. **positioning:** Task 6.
3. **lifting:** create `new LiftAnalyzer()`. Each frame: `const lift = analyzer.update(m, now)`. If `lift`, `scored.push(scoreLift(lift))`. Panel shows `Lift 3 of 5`, the last lift's score, and its first fault tip (`FAULTS[id].tip`) for 3 s. Live: current fault label over the video in red while `liveFaults(m)` is non-empty. If `checkPosition` fails for > 2 s mid-session, pause and show its message. After 5 lifts → results.
4. **results:** big session score (green ≥ 70, amber 50–69, red < 50), PASS / NEEDS COACHING, per-lift scores, top fault with its tip, buttons **Save record** (Task 8 API → then link to dashboard) and **Try again**.

**Verify:** complete a full session with an empty box. Deliberately stoop on two lifts; they should score lower and name `stoop`.

**Commit + push** `git add -A && git commit -m "Five-lift session with live coaching and results" && git push`

---

### Task 8: Records store

**Files:**
- Create: `js/store.js`, `tests/store.test.mjs`

Pure functions take `db` and `now` so they are testable; `load`/`save` wrap `localStorage`.

**Step 1: Failing test**

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { emptyDb, addSession, nextDue, workerStatus, mostCommonFault } from '../js/store.js';

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
});
```

**Step 2: Run** → FAIL.

**Step 3: Implement**

```js
const KEY = 'liftsafe.db.v1';
const DAY = 86400000;

export const emptyDb = () => ({ intervalDays: 90, workers: [] });

const norm = (name) => name.trim().toLowerCase();

export function addSession(db, name, session, now) {
  const entry = { ...session, date: now };
  const i = db.workers.findIndex((w) => norm(w.name) === norm(name));
  const workers = i === -1
    ? [...db.workers, { name: name.trim(), sessions: [entry] }]
    : db.workers.map((w, j) => (j === i ? { ...w, sessions: [...w.sessions, entry] } : w));
  return { ...db, workers };
}

export const latest = (w) => w.sessions[w.sessions.length - 1];

export const nextDue = (w, intervalDays = 90) => latest(w).date + intervalDays * DAY;

export function workerStatus(w, now, intervalDays = 90, soonDays = 14) {
  const due = nextDue(w, intervalDays);
  if (now > due) return 'overdue';
  return due - now <= soonDays * DAY ? 'due-soon' : 'current';
}

export function mostCommonFault(db) {
  const counts = {};
  for (const w of db.workers) {
    const f = latest(w).topFault;
    if (f) counts[f] = (counts[f] ?? 0) + 1;
  }
  return Object.keys(counts).sort((a, b) => counts[b] - counts[a])[0] ?? null;
}

export function load(storage = localStorage) {
  try { return JSON.parse(storage.getItem(KEY)) ?? emptyDb(); } catch { return emptyDb(); }
}

export function save(db, storage = localStorage) {
  storage.setItem(KEY, JSON.stringify(db));
}
```

**Step 4: Run** → PASS.

**Step 5: Wire "Save record"** in `check.js`: `save(addSession(load(), name, { ...summary, lifts: scored }, Date.now()))`. Only scores and fault ids are stored — never images. 

**Step 6: Commit** `git add -A && git commit -m "Store training records with recheck due dates"`

---

### Task 9: Supervisor dashboard

**Files:**
- Create: `dashboard.html`, `js/dashboard.js`, `js/sampleData.js`
- Modify: `css/style.css`

- **Summary tiles:** workers trained, average latest score, overdue count, most common fault (`FAULTS[id].label`).
- **Table:** Name · Latest score · Trend (first → latest, e.g. `62 → 88 ▲`, or an inline SVG sparkline if time) · Last check · Next due · Status pill (🟢 Current / 🟡 Due soon / 🔴 Overdue) · **Recheck** link to `check.html?name=…`.
- Sort: overdue first, then due soon, then current.
- **Sample data:** `sampleData.js` exports `sampleDb(now)` — five workers with sessions dated relative to `now` so all three statuses and an improving trend appear. A **Load sample data** button and a visible `Sample data` tag on those rows; a **Clear** button. Never present sample rows as real.
- Recheck interval shown as "Recheck every 90 days" (read from `db.intervalDays`).

**Verify:** load sample data → all three statuses visible; complete a real check → your row appears as Current.

**Commit + push** `git add -A && git commit -m "Supervisor dashboard with recheck status" && git push`

---

### Task 10: Tune with a real box + backup video  ← do before the mentor demo

**Files:** Modify `js/engine/scoring.js` (THRESHOLDS), `js/engine/liftAnalyzer.js` (DEFAULTS) only.

1. Add a temporary debug readout on `check.html` (`?debug=1`): live trunk, knee, reach, bend, phase.
2. Two people, 5 good squat-lifts and 5 deliberate stoops each. Note `maxTrunk`, `kneeAtMaxTrunk`, `maxReach` per lift.
3. Adjust thresholds so good lifts score ≥ 85 and stoops ≤ 55. Update the unit tests if a band moves. `npm test` must stay green.
4. Note what breaks it (box hiding the knees, baggy clothes, backlight) → these become the demo setup rules.
5. **Screen-record one clean full run** (positioning → 5 lifts → results → dashboard). This is the Sunday fallback.

**Commit** `git commit -am "Tune lift thresholds from real trials"`

---

### Task 11: Landing page

`index.html`: product name, the one-liner, tagline "Lift right. Every time.", two big buttons (**Start a lift check**, **Supervisor dashboard**), three icons (🔒 no video stored · ⏱ 2 minutes · 📋 training record), and the line "Recheck every 90 days". Commit.

---

### Task 12: Deploy to GitHub Pages

```bash
gh api -X POST repos/iyassh/liftsafe/pages -f "source[branch]=main" -f "source[path]=/"
```

Wait ~1 min, open `https://iyassh.github.io/liftsafe/`. HTTPS means the camera works on phones and tablets too. Confirm the vendored wasm and model load (Network tab, no 404s). Put the URL in the README and on the last slide as a QR code.

---

### Task 13: Stretch (only after the mentor demo, only if everything above is solid)

In value order: voice cues (`speechSynthesis.speak` of the fault tip — hands are full during a lift) → printable certificate (`window.print()` on a styled results view) → QR code on the landing page → squat "gym mode" (second config for `LiftAnalyzer` + `scoring`) to show the engine is generic.

---

## Demo setup checklist (Sunday)

- Laptop on a table ~3 m from the lifting spot, camera at hip height, worker side-on, plain background, light in front of the worker not behind.
- Empty cardboard box. Tape an X on the floor where to stand.
- App opened from `localhost` (not Wi-Fi dependent) with sample data loaded. Pages URL as second option.
- Backup video open in another tab.
- Charger plugged in. Notifications off.
