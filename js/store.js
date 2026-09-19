// Training records. Only scores and fault ids are stored, never images or video.
// Pure functions take `db` and `now` so they can be tested; load/save wrap localStorage.
const KEY = 'liftsafe.db.v1';
const DAY = 86400000;

export const emptyDb = () => ({ intervalDays: 90, pack: 'warehouse', workers: [] });

const MAX_NAME = 80;
const NO_NAME = 'Unnamed worker';

// Names are typed by hand: fold spacing and unicode form so one person stays one record.
const clean = (name) => String(name ?? '').normalize('NFKC').replace(/\s+/g, ' ').trim()
  .slice(0, MAX_NAME).trim() || NO_NAME;
const norm = (name) => clean(name).toLowerCase();

// Appends `entry` to one of a worker's lists ('sessions' or 'checkins'), creating the worker if new.
function appendTo(db, name, list, entry) {
  const i = db.workers.findIndex((w) => norm(w.name) === norm(name));
  const workers = i === -1
    ? [...db.workers, { name: clean(name), sessions: [], checkins: [], [list]: [entry] }]
    : db.workers.map((w, j) => (j === i ? { ...w, [list]: [...(w[list] ?? []), entry] } : w));
  return { ...db, workers };
}

// A quarterly lift check.
export function addSession(db, name, session, now) {
  return appendTo(db, name, 'sessions', { ...session, date: now });
}

// A pre-shift warm-up.
export function addCheckin(db, name, checkin, now) {
  return appendTo(db, name, 'checkins', { ...checkin, date: now });
}

// Records written before check-ins existed have no list; read through this.
export const checkinsOf = (w) => w.checkins ?? [];

export const latest = (w) => w.sessions[w.sessions.length - 1];

// null until the worker has done a lift check.
export const nextDue = (w, intervalDays = 90) => (latest(w) ? latest(w).date + intervalDays * DAY : null);

export function workerStatus(w, now, intervalDays = 90, soonDays = 14) {
  const due = nextDue(w, intervalDays);
  if (due === null) return 'uncertified';
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
const validList = (list) => Array.isArray(list) && list.every(validSession);
// A worker needs at least one dated record: a lift check or a warm-up.
const validWorker = (w) => w !== null && typeof w === 'object' && typeof w.name === 'string'
  && validList(w.sessions) && (w.checkins === undefined || validList(w.checkins))
  && w.sessions.length + checkinsOf(w).length > 0;

// Anything can be sitting under our key: an older shape, a hand edit, another app.
function sanitise(raw) {
  if (raw === null || typeof raw !== 'object' || !Array.isArray(raw.workers)) return emptyDb();
  const intervalDays = Number.isFinite(raw.intervalDays) && raw.intervalDays > 0 ? raw.intervalDays : 90;
  const pack = typeof raw.pack === 'string' ? raw.pack : 'warehouse';
  return { ...raw, intervalDays, pack, workers: raw.workers.filter(validWorker) };
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

// ---------- pre-shift warm-up ----------

const STREAK_GAP_DAYS = 3; // a weekend off keeps a streak alive; most of a week off ends it
const dayOf = (ms) => { const d = new Date(ms); return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime(); };
const daysBetween = (a, b) => Math.round((dayOf(b) - dayOf(a)) / DAY);

// Shifts checked in to in a row, counting each calendar day once.
export function streak(w, now) {
  const days = [...new Set(checkinsOf(w).map((c) => dayOf(c.date)))].sort((a, b) => b - a);
  if (!days.length || daysBetween(days[0], now) > STREAK_GAP_DAYS) return 0;
  let n = 1;
  while (n < days.length && daysBetween(days[n], days[n - 1]) <= STREAK_GAP_DAYS) n += 1;
  return n;
}

export function todaySummary(db, now) {
  const today = (c) => dayOf(c.date) === dayOf(now);
  const thisWeek = (c) => { const d = daysBetween(c.date, now); return d >= 0 && d < 7; };
  const todays = db.workers.flatMap((w) => checkinsOf(w).filter(today).slice(-1).map((c) => ({ w, c })));
  const active = db.workers.filter((w) => checkinsOf(w).some(thisWeek)).length;
  return {
    total: db.workers.length,
    checkedIn: todays.length,
    soreness: todays.filter(({ c }) => c.soreness).map(({ w, c }) => ({ name: w.name, area: c.soreness })),
    participation7d: db.workers.length ? Math.round((100 * active) / db.workers.length) : 0,
  };
}

