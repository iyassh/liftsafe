// Development telemetry for tuning thresholds. Off unless the page is opened with ?log=1.
// Sends numbers only (angles, phase, scores) to the local dev server (tools/dev-server.mjs),
// never images or video, and never to another origin.
const on = new URLSearchParams(location.search).get('log') === '1';
const FRAME_EVERY_MS = 100;
const FLUSH_EVERY_MS = 500;

const queue = [];
let lastFrameAt = -Infinity;

const round = (v, dp = 1) => (Number.isFinite(v) ? +v.toFixed(dp) : null);

function flush() {
  if (!queue.length) return;
  const body = queue.splice(0).map((r) => JSON.stringify(r)).join('\n');
  fetch('/__log', { method: 'POST', body, keepalive: true }).catch(() => {});
}

if (on) {
  setInterval(flush, FLUSH_EVERY_MS);
  addEventListener('pagehide', flush);
}

export const devLog = {
  on,

  // Something happened once: a screen change, a scored lift, a reset.
  event(type, data = {}) {
    if (!on) return;
    queue.push({ k: 'event', type, wall: Date.now(), ...data });
  },

  // Per-frame metrics, thinned to ~10 Hz.
  frame(now, screen, phase, m, problem, faults) {
    if (!on || now - lastFrameAt < FRAME_EVERY_MS) return;
    lastFrameAt = now;
    queue.push({
      k: 'frame',
      t: Math.round(now),
      screen,
      phase,
      pos: problem?.id ?? 'ok',
      side: m?.side ?? null,
      vis: round(m?.visibility, 2),
      trunk: round(m?.trunkAngle),
      knee: round(m?.kneeAngle),
      reach: round(m?.reach, 2),
      faults,
    });
  },
};
