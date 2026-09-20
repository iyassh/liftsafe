// Animated side-view figure that demonstrates a lift: the mistake a person made
// next to the way to do it. Drawn from a few joint angles, so a new demonstration
// is a new set of numbers, in the same spirit as the movement specs.
const DEG = Math.PI / 180;
const PHASE_MS = 1500;

// Angles in degrees at the bottom of the lift (all are 0 standing upright).
// shin/trunk lean forward, thigh drops back, arm swings forward from hanging.
export const GOOD = { shin: 22, thigh: -70, trunk: 30, arm: 16, speed: 1 };
export const DEMOS = {
  stoop: { wrong: { shin: 0, thigh: -4, trunk: 82, arm: 4, speed: 1 }, focus: 'knee', wrongLabel: 'Straight legs, bent back', rightLabel: 'Bend your knees' },
  trunk: { wrong: { shin: 12, thigh: -35, trunk: 72, arm: 4, speed: 1 }, focus: 'shoulder', wrongLabel: 'Chest down', rightLabel: 'Chest up, hips low' },
  reach: { wrong: { shin: 16, thigh: -55, trunk: 40, arm: 48, speed: 1 }, focus: 'hand', wrongLabel: 'Box far from your body', rightLabel: 'Step in, keep it close' },
  fast: { wrong: { ...GOOD, speed: 3 }, focus: 'hip', wrongLabel: 'Too fast', rightLabel: 'Slow and smooth' },
};

// The warm-up movements, demonstrated the same way. `hold` stays at the top for two beats.
export const MOVES = {
  overheadReach: { shin: 0, thigh: 0, trunk: 0, arm: 176, speed: 1, box: false, hold: true, focus: 'hand' },
  squat: { shin: 26, thigh: -82, trunk: 34, arm: 72, speed: 1, box: false, focus: 'knee' },
  hipHinge: { shin: 6, thigh: -14, trunk: 62, arm: 8, speed: 1, box: false, focus: 'hip' },
};

const lerp = (a, b, t) => a + (b - a) * t;
const ease = (t) => t * t * (3 - 2 * t);

// Joint positions for a pose at depth t (0 standing, 1 at the box), in units of body height.
function joints(pose, t) {
  const up = (from, len, angle) => ({ x: from.x + len * Math.sin(angle * DEG), y: from.y - len * Math.cos(angle * DEG) });
  const ankle = { x: 0, y: 0 };
  const knee = up(ankle, 0.25, pose.shin * t);
  const hip = up(knee, 0.25, pose.thigh * t);
  const shoulder = up(hip, 0.3, pose.trunk * t);
  const head = up(shoulder, 0.1, pose.trunk * t);
  const armAngle = lerp(0, pose.arm, t) * DEG;
  const hand = { x: shoulder.x + 0.3 * Math.sin(armAngle), y: shoulder.y + 0.3 * Math.cos(armAngle) };
  return { ankle, knee, hip, shoulder, head, hand, toe: { x: 0.11, y: 0 } };
}

export function drawFigure(ctx, w, h, pose, focus, color, time) {
  // Four phases: down empty, up with the box, down with the box, up empty.
  const cycle = (time * pose.speed) % (PHASE_MS * 4);
  const phase = Math.floor(cycle / PHASE_MS);
  const p = ease((cycle % PHASE_MS) / PHASE_MS);
  const t = pose.hold ? [p, 1, 1, 1 - p][phase] : phase % 2 === 0 ? p : 1 - p;
  const holding = pose.box !== false && (phase === 1 || phase === 2);

  const scale = h * 0.74;
  const origin = { x: w * 0.4, y: h * 0.88 };
  const at = (pt) => [origin.x + pt.x * scale, origin.y + pt.y * scale];
  const j = joints(pose, t);
  const rest = joints(pose, 1).hand; // where the box sits on the floor

  ctx.clearRect(0, 0, w, h);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  // floor
  ctx.strokeStyle = 'rgba(255,255,255,0.25)';
  ctx.lineWidth = 2;
  ctx.setLineDash([4, 8]);
  ctx.beginPath(); ctx.moveTo(w * 0.08, origin.y + 3); ctx.lineTo(w * 0.92, origin.y + 3); ctx.stroke();
  ctx.setLineDash([]);

  // box: on the floor, or in the hands (the warm-up movements have none)
  const size = pose.box === false ? 0 : scale * 0.17;
  const [bx, by] = at(holding ? j.hand : { x: rest.x, y: -size / scale });
  const top = holding ? by - size * 0.15 : origin.y - size;
  ctx.fillStyle = 'rgba(255,204,0,0.18)';
  ctx.strokeStyle = '#ffcc00';
  ctx.lineWidth = 3;
  ctx.beginPath(); ctx.rect(bx - size / 2, top, size, size); ctx.fill(); ctx.stroke();

  // body
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = Math.max(4, scale * 0.028);
  const line = (...pts) => { ctx.beginPath(); pts.forEach((pt, i) => (i ? ctx.lineTo(...at(pt)) : ctx.moveTo(...at(pt)))); ctx.stroke(); };
  line(j.toe, j.ankle, j.knee, j.hip, j.shoulder);
  line(j.shoulder, j.hand);
  const [hx, hy] = at(j.head);
  ctx.beginPath(); ctx.arc(hx, hy, scale * 0.06, 0, Math.PI * 2); ctx.stroke();
  for (const pt of [j.ankle, j.knee, j.hip, j.shoulder, j.hand]) {
    ctx.beginPath(); ctx.arc(...at(pt), scale * 0.02, 0, Math.PI * 2); ctx.fill();
  }

  // ring around the joint this demonstration is about
  const [fx, fy] = at(j[focus]);
  ctx.strokeStyle = '#ffcc00';
  ctx.lineWidth = 3;
  ctx.beginPath(); ctx.arc(fx, fy, scale * 0.055, 0, Math.PI * 2); ctx.stroke();
}

// Runs a wrong/right pair on two canvases. Returns a function that stops the animation.
export function playDemo(fault, wrongCanvas, rightCanvas) {
  const demo = DEMOS[fault];
  if (!demo) return () => {};
  let raf = 0;
  const start = performance.now();
  const size = (canvas) => {
    const ratio = window.devicePixelRatio || 1;
    const { width, height } = canvas.getBoundingClientRect();
    canvas.width = Math.max(1, Math.round(width * ratio));
    canvas.height = Math.max(1, Math.round(height * ratio));
  };
  size(wrongCanvas);
  size(rightCanvas);
  const frame = (now) => {
    drawFigure(wrongCanvas.getContext('2d'), wrongCanvas.width, wrongCanvas.height, demo.wrong, demo.focus, '#ff3b30', now - start);
    drawFigure(rightCanvas.getContext('2d'), rightCanvas.width, rightCanvas.height, GOOD, demo.focus, '#34c759', now - start);
    raf = requestAnimationFrame(frame);
  };
  raf = requestAnimationFrame(frame);
  return () => cancelAnimationFrame(raf);
}

// Loops one warm-up movement on a canvas. Returns a function that stops it.
export function playMovement(id, canvas) {
  const pose = MOVES[id];
  if (!pose) return () => {};
  let raf = 0;
  const start = performance.now();
  const ratio = window.devicePixelRatio || 1;
  const { width, height } = canvas.getBoundingClientRect();
  canvas.width = Math.max(1, Math.round(width * ratio));
  canvas.height = Math.max(1, Math.round(height * ratio));
  const frame = (now) => {
    drawFigure(canvas.getContext('2d'), canvas.width, canvas.height, pose, pose.focus, '#34c759', now - start);
    raf = requestAnimationFrame(frame);
  };
  raf = requestAnimationFrame(frame);
  return () => cancelAnimationFrame(raf);
}
