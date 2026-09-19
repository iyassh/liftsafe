# Movement Platform Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make "LiftSafe adapts to any business" true in the demo: a generic movement engine where a module is configuration, a second working module (camera-verified pre-shift warm-up with check-in and streak), a supervisor "Today" view, and a module picker.

**Architecture:** A movement is a spec: a signal read from pose metrics, enter/exit thresholds, and a target (reps or hold time). One `MovementTracker` runs any spec. Packs are lists of movement ids per business type. A new `warmup.html` runs a pack; check-ins are stored next to lift sessions in the same localStorage db. The working lift check (`check.html`, `js/check.js`) is not modified, so Sunday's demo is safe whatever happens here.

**Tech Stack:** unchanged. Plain ES modules, MediaPipe vendored, `node --test`.

**Context:** `docs/plans/2026-09-19-liftsafe-winning-plan.md`. Code freeze Saturday 7 PM.

---

### Task 1: Arm metric
**Files:** modify `js/engine/poseMetrics.js`, `tests/poseMetrics.test.mjs`
`computeMetrics` also returns `armRaise`: 0° arm hanging at the side, 180° straight overhead (shoulder→wrist vs straight down), `0` when the wrist is unseen. Tests first: hanging ≈ 0, forward ≈ 90, overhead ≈ 180, hidden wrist = 0.

### Task 2: Movement tracker
**Files:** create `js/engine/movements.js`, `tests/movements.test.mjs`
- `MOVEMENTS`: `overheadReach` (hold: armRaise ≥ 150 for 5 s), `squat` (reps ×5: knee flexion `180 − kneeAngle` ≥ 70, back under 25), `hipHinge` (reps ×5: trunkAngle ≥ 45, back under 15). Each has `name`, `instruction`, `cueShallow`.
- `class MovementTracker(spec)`: `update(m, tMs)` → `{ count, target, progress 0..1, done, cue }`. Reps use hysteresis (enter then exit = one rep). A peak that gets past halfway but not to `enter` returns the spec's shallow cue ("Go deeper"). Hold accumulates continuous time above `enter`, resets below `exit`. Invisible/non-finite frames are ignored; a gap over 1 s resets an in-progress rep or hold. `result()` → `{ id, completed, quality 0..1, durationMs }`, quality = mean peak ÷ ideal, clamped.
- Tests first: counts 5 clean reps; shallow rep not counted and cues; hold completes only after continuous 5 s; hold resets when dropped; NaN frames ignored; gap resets.

### Task 3: Packs
**Files:** create `js/packs.js`, `tests/packs.test.mjs`
`PACKS`: `warehouse`, `movers`, `retail`, each `{ name, blurb, warmup: [movement ids], modules: ['lift','warmup'] }`. `COMING_SOON`: overhead work, patient handling, housekeeping, workstation tasks (label only). Test: every id in every pack exists in `MOVEMENTS`.

### Task 4: Check-ins in the store
**Files:** modify `js/store.js`, `tests/store.test.mjs`
- `addCheckin(db, name, checkin, now)`; a worker may have `checkins` and no `sessions`.
- `sanitise`: keep workers with sessions **or** checkins; default missing arrays to `[]`.
- `workerStatus` → `'uncertified'` when there are no sessions; `nextDue` → `null`.
- `streak(worker, now)`: consecutive check-ins where each gap ≤ 3 days and the latest is ≤ 3 days old (weekends do not break it).
- `todaySummary(db, now)` → `{ checkedIn, total, soreness: [{name, area}], participation7d }`.
- `db.pack` (default `'warehouse'`).
- Tests first, including: old dbs without `checkins` still load; a checkin-only worker survives `load`; existing tests untouched.

### Task 5: Shared camera + pose loop
**Files:** create `js/poseCamera.js`
`startPoseCamera({ video, canvas, onFrame, testVideoUrl })` → `{ stop }`; `drawSkeleton(ctx, lms, color)`. Written fresh for the warm-up page. `js/check.js` keeps its own copy for now (protects the working demo; merge after the hackathon).

### Task 6: Warm-up page
**Files:** create `warmup.html`, `js/warmup.js`, `css/warmup.css`
Screens: name → soreness tap (None / Lower back / Shoulders / Knees / Other; note "your supervisor sees this so they can help") → positioning (reuse `checkPosition`) → each movement in the pack (big instruction, progress ring or bar, count, cue, red/green skeleton) → "Shift-ready ✓" with time, streak, and Save. Same test hooks as the check page (`?video=`, sticky `?debug=1`, `?log=1`, `window.__liftsafe`). Voice: speak each instruction and cue with `speechSynthesis` (mute toggle).

### Task 7: Dashboard "Today"
**Files:** modify `dashboard.html`, `js/dashboard.js`, `css/dashboard.css`, `js/sampleData.js`, `tests/sampleData.test.mjs`
Today strip above the table: checked in today X of N, 7-day participation %, soreness flags (names + area), longest streak. Table gains Streak and handles `uncertified` (grey pill "Not certified", action "Certify"). Pack selector (saves `db.pack`). Sample workers get check-ins so every tile is populated, still tagged Sample.

### Task 8: Module picker on the landing page
**Files:** modify `index.html`, `css/landing.css`
"One engine. Built for your business." Live cards: Lift check, Pre-shift warm-up. Greyed cards honestly marked "Coming soon": Overhead work, Patient handling, Housekeeping, Workstation tasks. Nav gains "Warm-up" on all pages.

### Task 9: Verify, deploy
`npm test` green. Browser pass on localhost for all four pages with `?video=`. Push (Pages auto-deploys). Real-person run of the warm-up with the dev log on; tune `enter` thresholds from the log.

### Then, if time before 7 PM (from the winning plan)
Worst-moment skeleton snapshot on lift results → voice on the lift check → "download session data" for the validation study → NIOSH estimate.
