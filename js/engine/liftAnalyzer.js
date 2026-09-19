const DEFAULTS = {
  startBend: 45, // degrees of bend that starts a lift
  endBend: 25, // back under this = standing again
  minDurationMs: 600, // shorter than this is noise
  smoothing: 0.4, // EMA factor; 1 = off
};

// Segments a stream of pose metrics into lifts. One signal drives the phases:
// bend = max(trunkAngle, 180 - kneeAngle), which rises whether the worker
// squats (knees) or stoops (trunk).
export class LiftAnalyzer {
  constructor(config = {}) {
    this.cfg = { ...DEFAULTS, ...config };
    this.reset();
  }

  reset() {
    this.phase = 'standing';
    this.smooth = null;
    this.cur = null;
  }

  // Smoothed values for the on-screen overlay; null until the first visible frame.
  get current() {
    return this.smooth;
  }

  // Returns a lift summary when a lift completes, otherwise null.
  update(m, tMs) {
    if (!m.visible) return null;
    const k = this.cfg.smoothing;
    const prev = this.smooth;
    const s = prev
      ? {
          trunkAngle: prev.trunkAngle + k * (m.trunkAngle - prev.trunkAngle),
          kneeAngle: prev.kneeAngle + k * (m.kneeAngle - prev.kneeAngle),
          reach: prev.reach + k * (m.reach - prev.reach),
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
      return {
        durationMs,
        maxTrunk: c.maxTrunk,
        kneeAtMaxTrunk: c.kneeAtMaxTrunk,
        minKnee: c.minKnee,
        maxReach: c.maxReach,
      };
    }
    this.#collect(s);
    return null;
  }

  #collect(s) {
    const c = this.cur;
    if (s.trunkAngle > c.maxTrunk) {
      c.maxTrunk = s.trunkAngle;
      c.kneeAtMaxTrunk = s.kneeAngle;
    }
    c.minKnee = Math.min(c.minKnee, s.kneeAngle);
    c.maxReach = Math.max(c.maxReach, s.reach);
  }
}
