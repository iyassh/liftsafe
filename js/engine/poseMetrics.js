import { angleAt, angleFromVertical, dist } from './geometry.js';

// MediaPipe Pose landmark indices.
export const LM = {
  nose: 0, leftEar: 7, rightEar: 8,
  leftShoulder: 11, rightShoulder: 12, leftWrist: 15, rightWrist: 16,
  leftHip: 23, rightHip: 24, leftKnee: 25, rightKnee: 26, leftAnkle: 27, rightAnkle: 28,
};

const CORE = ['Shoulder', 'Hip', 'Knee', 'Ankle'];
const MIN_VIS = 0.5;

const visOf = (lm) => lm.visibility ?? 0;
const sideVis = (lms, side) => CORE.reduce((s, j) => s + visOf(lms[LM[side + j]]), 0) / CORE.length;

// Side-on, one half of the body faces the camera. Measure that half.
export function pickSide(lms) {
  return sideVis(lms, 'left') >= sideVis(lms, 'right') ? 'left' : 'right';
}

// Landmarks are normalized 0..1 per axis, so x is scaled by aspect (width / height)
// before measuring; otherwise angles are wrong on non-square video.
export function computeMetrics(lms, aspect) {
  const side = pickSide(lms);
  const visibility = sideVis(lms, side);
  const pt = (j) => ({ x: lms[LM[side + j]].x * aspect, y: lms[LM[side + j]].y });
  const [shoulder, hip, knee, ankle, wrist] = ['Shoulder', 'Hip', 'Knee', 'Ankle', 'Wrist'].map(pt);
  const torso = dist(shoulder, hip);
  const wristSeen = visOf(lms[LM[side + 'Wrist']]) >= MIN_VIS;
  return {
    side,
    visibility,
    visible: visibility >= MIN_VIS && torso > 0,
    trunkAngle: angleFromVertical(hip, shoulder),
    kneeAngle: angleAt(hip, knee, ankle),
    reach: wristSeen && torso > 0 ? Math.abs(wrist.x - ankle.x) / torso : 0,
  };
}
