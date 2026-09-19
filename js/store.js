// Training records. Only scores and fault ids are stored, never images or video.
// Pure functions take `db` and `now` so they can be tested; load/save wrap localStorage.
const KEY = 'liftsafe.db.v1';
const DAY = 86400000;

export const emptyDb = () => ({ intervalDays: 90, workers: [] });

const MAX_NAME = 80;
const NO_NAME = 'Unnamed worker';

// Names are typed by hand: fold spacing and unicode form so one person stays one record.
const clean = (name) => String(name ?? '').normalize('NFKC').replace(/\s+/g, ' ').trim()
  .slice(0, MAX_NAME).trim() || NO_NAME;
const norm = (name) => clean(name).toLowerCase();

export function addSession(db, name, session, now) {
  const entry = { ...session, date: now };
  const i = db.workers.findIndex((w) => norm(w.name) === norm(name));
  const workers = i === -1
    ? [...db.workers, { name: clean(name), sessions: [entry] }]
    : db.workers.map((w, j) => (j === i ? { ...w, sessions: [...w.sessions, entry] } : w));
  return { ...db, workers };
}

export const latest = (w) => w.sessions[w.sessions.length - 1];

export const nextDue = (w, intervalDays = 90) => latest(w).date + intervalDays * DAY;

export function workerStatus(w, now, intervalDays = 90, soonDays = 14) {
  const due = nextDue(w, intervalDays);
  if (now > due) return 'overdue';
  return due - now <= soonDays * DAY ? 'due-soon' : 'current';
}

export function mostCommonFault(db) {
  const counts = {};
  for (const w of db.workers) {
    const f = latest(w)?.topFault;
    if (f) counts[f] = (counts[f] ?? 0) + 1;
  }
  return Object.keys(counts).sort((a, b) => counts[b] - counts[a])[0] ?? null;
}

const validSession = (s) => s !== null && typeof s === 'object' && Number.isFinite(s.date);
const validWorker = (w) => w !== null && typeof w === 'object' && typeof w.name === 'string'
  && Array.isArray(w.sessions) && w.sessions.length > 0 && w.sessions.every(validSession);

// Anything can be sitting under our key: an older shape, a hand edit, another app.
function sanitise(raw) {
  if (raw === null || typeof raw !== 'object' || !Array.isArray(raw.workers)) return emptyDb();
  const intervalDays = Number.isFinite(raw.intervalDays) && raw.intervalDays > 0 ? raw.intervalDays : 90;
  return { ...raw, intervalDays, workers: raw.workers.filter(validWorker) };
}

// `storage` is resolved inside the try: touching localStorage itself throws when site data is blocked.
export function load(storage) {
  try {
    return sanitise(JSON.parse((storage ?? localStorage).getItem(KEY)));
  } catch {
    return emptyDb();
  }
}

export function save(db, storage = localStorage) {
  storage.setItem(KEY, JSON.stringify(db));
}
