// Training records, CBL-style: a catalogue of trainings, and for any team member and
// training a status worked out from the records already stored (lift checks and
// warm-ups). Nothing extra is saved, so the matrix, the alerts and the employee
// record can never disagree with the underlying history.
import { checkinsOf } from './store.js';

const DAY = 86400000;
const DUE_SOON_DAYS = 14;
const RECENT_DAYS = 7; // how long a completion stays in the manager's alert feed

export const TRAININGS = {
  liftCert: {
    id: 'liftCert', name: 'Lift Safety Certification', blurb: 'Five lifts with live coaching and a score',
    page: 'check.html', passMark: 70, repeats: 'interval',
  },
  warmup: {
    id: 'warmup', name: 'Pre-shift Warm-up', blurb: 'Three camera-verified movements',
    page: 'warmup.html', repeats: 'daily',
  },
};
export const TRAINING_ORDER = ['liftCert', 'warmup'];

export const STATE_LABEL = {
  'not-started': 'Not started', completed: 'Completed', 'due-soon': 'Due soon',
  overdue: 'Overdue', retake: 'Needs retake', 'due-today': 'Due today',
};
const GOOD_STANDING = new Set(['completed', 'due-soon']);
const SORENESS = { 'lower-back': 'lower back', shoulders: 'shoulders', knees: 'knees', other: 'other' };

const startOfDay = (ms) => { const d = new Date(ms); return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime(); };
const sameDay = (a, b) => startOfDay(a) === startOfDay(b);
const last = (list) => list[list.length - 1];
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

function liftStatus(w, db, now) {
  const base = { id: 'liftCert', attempts: w.sessions.length, score: null, completedAt: null, dueAt: null, daysLeft: null };
  const latest = last(w.sessions);
  if (!latest) return { ...base, state: 'not-started' };
  if (!latest.passed) return { ...base, state: 'retake', score: latest.score, completedAt: latest.date };
  const dueAt = latest.date + (db.intervalDays ?? 90) * DAY;
  const daysLeft = Math.ceil((dueAt - now) / DAY);
  const state = now > dueAt ? 'overdue' : daysLeft <= DUE_SOON_DAYS ? 'due-soon' : 'completed';
  return { ...base, state, score: latest.score, completedAt: latest.date, dueAt, daysLeft };
}

function warmupStatus(w, now) {
  const checkins = checkinsOf(w);
  const latest = last(checkins);
  const base = { id: 'warmup', attempts: checkins.length, score: null, completedAt: latest?.date ?? null, dueAt: null, daysLeft: null };
  if (!latest) return { ...base, state: 'not-started' };
  if (sameDay(latest.date, now)) return { ...base, state: 'completed', dueAt: startOfDay(now) + DAY, daysLeft: 1 };
  return { ...base, state: 'due-today', dueAt: startOfDay(now), daysLeft: 0 };
}

// Where one team member stands on one training.
export function trainingStatus(w, id, db, now) {
  return id === 'liftCert' ? liftStatus(w, db, now) : warmupStatus(w, now);
}

export const allStatuses = (w, db, now) => TRAINING_ORDER.map((id) => trainingStatus(w, id, db, now));

// Percentage of trainings in good standing.
export function compliance(w, db, now) {
  const good = allStatuses(w, db, now).filter((s) => GOOD_STANDING.has(s.state)).length;
  return Math.round((100 * good) / TRAINING_ORDER.length);
}

// Everything the team member has done, newest first.
export function transcript(w) {
  return [
    ...w.sessions.map((s) => ({ trainingId: 'liftCert', date: s.date, score: s.score, passed: s.passed, topFault: s.topFault ?? null, sample: s.sample === true })),
    ...checkinsOf(w).map((c) => ({ trainingId: 'warmup', date: c.date, completed: c.completed, soreness: c.soreness ?? null, sample: c.sample === true })),
  ].sort((a, b) => b.date - a.date);
}

// What falls due next, soonest first.
export function upcoming(w, db, now) {
  return allStatuses(w, db, now)
    .filter((s) => s.dueAt !== null)
    .map((s) => ({ trainingId: s.id, dueAt: s.dueAt, state: s.state }))
    .sort((a, b) => a.dueAt - b.dueAt);
}

// The manager's feed. Derived, so an alert disappears by itself once it is dealt with.
export function alerts(db, now) {
  const out = [];
  const name = TRAININGS.liftCert.name;
  for (const w of db.workers) {
    const s = liftStatus(w, db, now);
    const push = (type, at, text) => out.push({ id: `${type}:${w.name}:${at}`, type, worker: w.name, workerId: w.id ?? null, at, text });
    if (s.state === 'retake') push('retake', s.completedAt, `${w.name} needs a retake: scored ${s.score} on ${name}`);
    if (s.state === 'overdue') push('overdue', s.dueAt, `${w.name} is ${plural(Math.floor((now - s.dueAt) / DAY), 'day')} overdue for ${name}`);
    if (s.state === 'due-soon') push('due-soon', s.dueAt - DUE_SOON_DAYS * DAY, `${w.name}'s ${name} is due in ${plural(s.daysLeft, 'day')}`);
    const passedRecently = s.completedAt !== null && s.state !== 'retake' && now - s.completedAt <= RECENT_DAYS * DAY;
    if (passedRecently) push('completed', s.completedAt, `${w.name} completed ${name} · scored ${s.score}`);
    const today = checkinsOf(w).filter((c) => sameDay(c.date, now) && c.soreness);
    if (today.length) push('soreness', last(today).date, `${w.name} reported ${SORENESS[last(today).soreness] ?? 'other'} soreness today`);
  }
  return out.sort((a, b) => b.at - a.at);
}

export const unreadCount = (db, now) => alerts(db, now).filter((a) => a.at > (db.alertsSeenAt ?? 0) && a.at <= now).length;

export const markAlertsRead = (db, now) => ({ ...db, alertsSeenAt: now });

// Every word typed must appear somewhere in the name.
export function searchWorkers(workers, query) {
  const words = String(query ?? '').toLowerCase().split(/\s+/).filter(Boolean);
  return workers.filter((w) => words.every((word) => w.name.toLowerCase().includes(word)));
}

export const FILTERS = [
  ['all', 'All'], ['overdue', 'Overdue'], ['due-soon', 'Due soon'], ['retake', 'Needs retake'],
  ['not-started', 'Not started'], ['done-today', 'Warmed up today'], ['soreness', 'Soreness today'],
];

export function matchesFilter(w, filter, db, now) {
  if (filter === 'all') return true;
  if (filter === 'done-today') return warmupStatus(w, now).state === 'completed';
  if (filter === 'soreness') return checkinsOf(w).some((c) => sameDay(c.date, now) && c.soreness);
  return liftStatus(w, db, now).state === filter;
}
