// Prototype sign-in for a shared kiosk device. PINs are salted and hashed, and the
// session lives in sessionStorage with an expiry, but all of it is checked in the
// browser: good for a demo, replaced by server-side auth in the real product.
const KEY = 'liftsafe.session';
const ROLES = ['worker', 'manager'];

// Idle time before a shared device signs someone out.
export const SESSION_MS = { worker: 10 * 60_000, manager: 15 * 60_000 };

export const validPin = (pin) => typeof pin === 'string' && /^\d{4}$/.test(pin);

const hex = (bytes) => [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');

async function hashPin(pin, salt) {
  const data = new TextEncoder().encode(`${salt}:${pin}`);
  return hex(new Uint8Array(await crypto.subtle.digest('SHA-256', data)));
}

// The PIN itself is never stored, only this record.
export async function makePin(pin) {
  const salt = hex(crypto.getRandomValues(new Uint8Array(8)));
  return { salt, hash: await hashPin(pin, salt) };
}

export async function checkPin(pin, record) {
  if (!validPin(pin) || typeof record?.salt !== 'string' || typeof record?.hash !== 'string') return false;
  return (await hashPin(pin, record.salt)) === record.hash;
}

export function startSession(role, worker, now, storage = sessionStorage) {
  const session = { role, expires: now + SESSION_MS[role] };
  if (role === 'worker') Object.assign(session, { workerId: worker.id, name: worker.name });
  storage.setItem(KEY, JSON.stringify(session));
}

export function currentSession(now, storage = sessionStorage) {
  try {
    const s = JSON.parse(storage.getItem(KEY));
    const ok = s && ROLES.includes(s.role) && Number.isFinite(s.expires) && s.expires > now;
    if (!ok) return null;
    return s.role === 'worker'
      ? { role: s.role, workerId: s.workerId, name: s.name, expires: s.expires }
      : { role: s.role, expires: s.expires };
  } catch {
    return null;
  }
}

// Activity keeps a live session going; it never revives an expired one.
export function touchSession(now, storage = sessionStorage) {
  const s = currentSession(now, storage);
  if (s) storage.setItem(KEY, JSON.stringify({ ...s, expires: now + SESSION_MS[s.role] }));
}

export function endSession(storage = sessionStorage) {
  storage.removeItem(KEY);
}

// Page guard: returns the session, or sends the browser to the kiosk and returns null.
export function requireRole(roles, now = Date.now()) {
  const s = currentSession(now);
  if (s && roles.includes(s.role)) return s;
  location.replace(roles.includes('manager') && !roles.includes('worker') ? 'app.html?manager=1' : 'app.html');
  return null;
}

// Any tap or key press counts as activity on a guarded page.
export function keepAlive() {
  for (const type of ['pointerdown', 'keydown']) addEventListener(type, () => touchSession(Date.now()), { passive: true });
}
