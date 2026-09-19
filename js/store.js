// Training records. Only scores and fault ids are stored, never images or video.
// Pure functions take `db` and `now` so they can be tested; load/save wrap localStorage.
const KEY = 'liftsafe.db.v1';
const DAY = 86400000;

export const emptyDb = () => ({ intervalDays: 90, workers: [] });

const norm = (name) => name.trim().toLowerCase();

export function addSession(db, name, session, now) {
  const entry = { ...session, date: now };
  const i = db.workers.findIndex((w) => norm(w.name) === norm(name));
  const workers = i === -1
    ? [...db.workers, { name: name.trim(), sessions: [entry] }]
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
    const f = latest(w).topFault;
    if (f) counts[f] = (counts[f] ?? 0) + 1;
  }
  return Object.keys(counts).sort((a, b) => counts[b] - counts[a])[0] ?? null;
}

export function load(storage = localStorage) {
  try {
    return JSON.parse(storage.getItem(KEY)) ?? emptyDb();
  } catch {
    return emptyDb();
  }
}

export function save(db, storage = localStorage) {
  storage.setItem(KEY, JSON.stringify(db));
}
