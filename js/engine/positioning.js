import { LM, computeMetrics } from './poseMetrics.js';
import { dist } from './geometry.js';

const MSG = {
  'no-person': 'Step into view',
  'not-visible': "We can't see your whole body. Clear the space around you.",
  'too-close': "Step back — we can't see your feet",
  'turn-sideways': 'Turn sideways to the camera ↻',
};
const problem = (id) => ({ id, message: MSG[id] });

const FRAME_MARGIN = 0.03;
const MAX_SHOULDER_SPREAD = 0.45; // shoulder-to-shoulder width, in torso lengths

// Returns the first thing the worker should fix, or null when ready to score.
export function checkPosition(lms, aspect) {
  if (!lms) return problem('no-person');
  // Checked before visibility: feet below the frame also read as "not visible",
  // and "step back" is the instruction that fixes it.
  const ankleY = Math.max(lms[LM.leftAnkle].y, lms[LM.rightAnkle].y);
  if (ankleY > 1 - FRAME_MARGIN || lms[LM.nose].y < FRAME_MARGIN) return problem('too-close');
  const m = computeMetrics(lms, aspect);
  if (!m.visible) return problem('not-visible');
  const scaled = (i) => ({ x: lms[i].x * aspect, y: lms[i].y });
  const torso = dist(scaled(LM[m.side + 'Shoulder']), scaled(LM[m.side + 'Hip']));
  const shoulderSpread = Math.abs(lms[LM.leftShoulder].x - lms[LM.rightShoulder].x) * aspect;
  if (shoulderSpread / torso > MAX_SHOULDER_SPREAD) return problem('turn-sideways');
  return null;
}
