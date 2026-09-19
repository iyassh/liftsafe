import { ramp } from './geometry.js';

// The camera sees trunk lean, knee bend and reach. It cannot see the spine, so
// faults are worded as posture ("bending at the waist"), never spinal curvature.
export const FAULTS = {
  stoop: { label: 'Bending at the waist, not the knees', tip: 'Bend your knees and keep your chest up.' },
  trunk: { label: 'Leaning too far forward', tip: 'Get closer and go down with your legs so your back stays upright.' },
  reach: { label: 'Load too far from your body', tip: 'Step in. Keep the load close to your belt.' },
  fast: { label: 'Lifting too fast', tip: 'Lift smoothly. No jerking.' },
};

// Starting points from the REBA trunk bands (20–60° moderate, >60° high) and the
// NIOSH horizontal-distance idea. Tuned against real lifts.
export const THRESHOLDS = {
  // A stoop alone must fail a lift: real stoops measured 40–60° of lean with knees at
  // 151–160°, and at 35 points five of them averaged a pass.
  stoopTrunk: 40, stoopKnee: [130, 160], stoopPenalty: 50,
  trunk: [45, 80], trunkPenalty: 30,
  reach: [0.8, 1.2], reachPenalty: 25,
  fastMs: 1000, fastPenalty: 10,
  passMark: 70,
  namedAt: 5, // a fault is named once it costs at least this many points
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

// lift: a summary from LiftAnalyzer. Returns { score: 0–100, faults: [fault ids] }.
export function scoreLift(lift, t = THRESHOLDS) {
  const p = penalties(lift.maxTrunk, lift.kneeAtMaxTrunk, lift.maxReach, lift.durationMs, t);
  const total = Object.values(p).reduce((a, b) => a + b, 0);
  return { score: Math.max(0, Math.round(100 - total)), faults: named(p, t) };
}

// Same thresholds applied to a single frame, so the skeleton can turn red mid-lift.
export function liveFaults(m, t = THRESHOLDS) {
  return named(penalties(m.trunkAngle, m.kneeAngle, m.reach, null, t), t);
}

export function summariseSession(lifts, t = THRESHOLDS) {
  const scores = lifts.map((l) => l.score).filter(Number.isFinite);
  const score = scores.length ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : 0;
  const counts = {};
  for (const l of lifts) for (const f of l.faults) counts[f] = (counts[f] ?? 0) + 1;
  const topFault = Object.keys(counts).sort((a, b) => counts[b] - counts[a])[0] ?? null;
  return { score, passed: score >= t.passMark, topFault };
}
