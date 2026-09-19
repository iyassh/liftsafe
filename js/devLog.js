// Development telemetry for tuning thresholds. Off unless switched on with ?log=1.
// Sends numbers only (angles, phase, scores) to the local dev server (tools/dev-server.mjs),
// never images or video, and never to another origin.
// Sticky: ?log=1 turns it on for this browser until ?log=0, so it survives reloads
// and nav links that drop the query string.
export function devFlag(name) {
  const param = new URLSearchParams(location.search).get(name);
  const key = `liftsafe.dev.${name}`;
  try {
    if (param === '1') localStorage.setItem(key, '1');
    if (param === '0') localStorage.removeItem(key);
    return localStorage.getItem(key) === '1';
  } catch {
    return param === '1';
  }
}

const on = devFlag('log');
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

// Visible whenever telemetry is on, so nobody records a session without knowing it.
function showIndicator() {
  const tag = document.createElement('div');
  tag.textContent = '● Dev log on (numbers only) · ?log=0 to stop';
  tag.style.cssText = 'position:fixed;top:8px;left:50%;transform:translateX(-50%);z-index:99;'
    + 'padding:4px 12px;border-radius:999px;background:#ff3b30;color:#fff;font:600 12px system-ui';
  document.body.append(tag);
}

if (on) {
  setInterval(flush, FLUSH_EVERY_MS);
  addEventListener('pagehide', flush);
  showIndicator();
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
