// A movement is configuration: which signal to read from the pose metrics, the
// thresholds that define doing it, and the target. One tracker runs any of them,
// so a new module for a business is a new spec, not new code.
const knee = (m) => 180 - m.kneeAngle; // knee flexion: 0 standing, ~90 in a deep squat

export const MOVEMENTS = {
  overheadReach: {
    id: 'overheadReach',
    name: 'Overhead reach',
    instruction: 'Reach both arms straight overhead and hold',
    cueShallow: 'Reach higher',
    kind: 'hold',
    signal: (m) => m.armRaise,
    enter: 150, exit: 120, ideal: 170,
    holdMs: 5000,
  },
  squat: {
    id: 'squat',
    name: 'Squats',
    instruction: 'Five slow squats, chest up',
    cueShallow: 'Go deeper',
    kind: 'reps',
    signal: knee,
    enter: 70, exit: 25, ideal: 90,
    reps: 5,
  },
  hipHinge: {
    id: 'hipHinge',
    name: 'Hip hinge',
    instruction: 'Five hip hinges: push your hips back, soft knees, flat back',
    cueShallow: 'Hinge further',
    kind: 'reps',
    signal: (m) => m.trunkAngle,
    enter: 45, exit: 15, ideal: 60,
    reps: 5,
  },
};

const MAX_GAP_MS = 1000; // longer than this without a usable frame and the attempt starts over
const CUE_MS = 2500;

export class MovementTracker {
  constructor(spec) {
    this.spec = spec;
    this.count = 0;
    this.peaks = []; // peak signal of each counted rep, or of the completed hold
    this.startedAt = null;
    this.lastT = null;
    this.finishedAt = null;
    this.cue = null;
    this.cueUntil = 0;
    this.#clearAttempt();
  }

  get done() {
    return this.finishedAt !== null;
  }

  // Feed one frame of pose metrics. Returns what the screen needs to show.
  update(m, tMs) {
    const value = m?.visible ? this.spec.signal(m) : NaN;
    if (Number.isFinite(value) && !this.done) {
      if (this.lastT !== null && (tMs - this.lastT > MAX_GAP_MS || tMs < this.lastT)) this.#clearAttempt();
      this.lastT = tMs;
      this.startedAt ??= tMs;
      if (this.spec.kind === 'reps') this.#rep(value, tMs);
      else this.#hold(value, tMs);
    }
    if (this.cue && tMs > this.cueUntil) this.cue = null;
    return this.status(tMs);
  }

  status(tMs = this.lastT ?? 0) {
    const { spec } = this;
    const held = this.holdStart === null ? 0 : tMs - this.holdStart;
    const progress = this.done ? 1
      : spec.kind === 'reps' ? this.count / spec.reps
        : Math.min(1, held / spec.holdMs);
    return {
      count: this.count,
      target: spec.kind === 'reps' ? spec.reps : spec.holdMs,
      progress,
      done: this.done,
      cue: this.cue,
    };
  }

  result() {
    const { spec } = this;
    const mean = this.peaks.length ? this.peaks.reduce((a, b) => a + b, 0) / this.peaks.length : 0;
    return {
      id: spec.id,
      completed: this.done,
      quality: Math.max(0, Math.min(1, mean / spec.ideal)),
      durationMs: this.startedAt === null ? 0 : (this.finishedAt ?? this.lastT) - this.startedAt,
    };
  }

  #clearAttempt() {
    this.inRep = false;
    this.peak = -Infinity;
    this.holdStart = null;
  }

  #setCue(text, tMs) {
    this.cue = text;
    this.cueUntil = tMs + CUE_MS;
  }

  #rep(value, tMs) {
    const { enter, exit, reps, cueShallow } = this.spec;
    this.peak = Math.max(this.peak, value);
    if (!this.inRep && value >= enter) this.inRep = true;
    if (value > exit) return;
    // Back at rest: either a rep just finished, or an attempt fell short.
    if (this.inRep) {
      this.count += 1;
      this.peaks.push(this.peak);
      this.cue = null;
      if (this.count >= reps) this.finishedAt = tMs;
    } else if (this.peak >= exit + (enter - exit) / 2) {
      this.#setCue(cueShallow, tMs);
    }
    this.inRep = false;
    this.peak = -Infinity;
  }

  #hold(value, tMs) {
    const { enter, exit, holdMs, cueShallow } = this.spec;
    if (value >= enter) {
      this.holdStart ??= tMs;
      this.peak = Math.max(this.peak, value);
      this.cue = null;
      if (tMs - this.holdStart >= holdMs) {
        this.peaks.push(this.peak);
        this.finishedAt = tMs;
      }
    } else if (value < exit) {
      if (this.holdStart !== null) this.#clearAttempt();
    } else if (this.holdStart === null) {
      this.#setCue(cueShallow, tMs); // arms part-way up, never reached the hold position
    }
  }
}
