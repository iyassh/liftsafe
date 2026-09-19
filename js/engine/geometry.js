const DEG = 180 / Math.PI;

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

export function dist(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

// Interior angle at b, in degrees, for the path a–b–c.
export function angleAt(a, b, c) {
  const v1 = { x: a.x - b.x, y: a.y - b.y };
  const v2 = { x: c.x - b.x, y: c.y - b.y };
  const m = Math.hypot(v1.x, v1.y) * Math.hypot(v2.x, v2.y);
  if (m === 0) return 180;
  return Math.acos(clamp((v1.x * v2.x + v1.y * v2.y) / m, -1, 1)) * DEG;
}

// Angle between the vector from→to and straight up. Image coordinates: y grows downward.
export function angleFromVertical(from, to) {
  const v = { x: to.x - from.x, y: to.y - from.y };
  const m = Math.hypot(v.x, v.y);
  if (m === 0) return 0;
  return Math.acos(clamp(-v.y / m, -1, 1)) * DEG;
}

// 0 below lo, 1 above hi, linear between.
export function ramp(v, lo, hi) {
  return clamp((v - lo) / (hi - lo), 0, 1);
}
