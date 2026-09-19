// Supervisor dashboard. Everything is rebuilt from load() after each action, so the
// page never holds a copy of the records that could drift from localStorage.
import {
  load, save, emptyDb, latest, nextDue, workerStatus, mostCommonFault, checkinsOf, streak, todaySummary,
} from './store.js';
import { FAULTS } from './engine/scoring.js';
import { PACKS, DEFAULT_PACK } from './packs.js';
import { mergeSample, withoutSample } from './sampleData.js';
import { requireRole, keepAlive, endSession } from './auth.js';
import {
  STATE_LABEL, FILTERS, trainingStatus, compliance, alerts, markAlertsRead, searchWorkers, matchesFilter,
} from './training.js';

const SVG_NS = 'http://www.w3.org/2000/svg';
const CONFIRM_MS = 4000;
// A double-click lands its second click this soon; it must not count as the confirmation.
const DOUBLE_CLICK_MS = 600;
const MIN_SPAN = 20;
const STATUS = {
  overdue: { rank: 0, label: 'Overdue', pill: 'pill-bad' },
  'due-soon': { rank: 1, label: 'Due soon', pill: 'pill-warn' },
  uncertified: { rank: 2, label: 'Not certified', pill: 'pill-neutral' },
  current: { rank: 3, label: 'Current', pill: 'pill-ok' },
};
const SORENESS = { 'lower-back': 'Lower back', shoulders: 'Shoulders', knees: 'Knees', other: 'Other' };

const norm = (name) => name.trim().toLowerCase();

export const bandClass = (score) => (score >= 70 ? 'text-ok' : score >= 50 ? 'text-warn' : 'text-bad');

// Built by hand: toLocaleDateString gives "Sep 19, 2026" for en-CA and "19 Sept 2026"
// for en-GB depending on the browser's ICU data. The design calls for "19 Sep 2026".
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export function formatDate(ms) {
  const d = new Date(ms);
  return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}

// load() does not check scores, and one hand-edited record without a number would turn the
// average into NaN. A worker who has only warmed up has no sessions at all, which is normal.
const tracked = (db) => (db.workers ?? [])
  .filter((w) => Array.isArray(w.sessions) && w.sessions.every((s) => Number.isFinite(s.score)));

const certified = (db) => tracked(db).filter((w) => w.sessions.length > 0);

// Uncertified workers have no due date, so they go by name.
const byDue = (a, b) => (a.due === null || b.due === null ? a.worker.name.localeCompare(b.worker.name) : a.due - b.due);

export function sortedRows(db, now) {
  return tracked(db)
    .map((w) => ({ worker: w, status: workerStatus(w, now, db.intervalDays), due: nextDue(w, db.intervalDays) }))
    .sort((a, b) => STATUS[a.status].rank - STATUS[b.status].rank || byDue(a, b));
}

export function summary(db, now) {
  const workers = certified(db);
  const scores = workers.map((w) => latest(w).score);
  return {
    workers: tracked(db).length,
    average: scores.length ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : null,
    overdue: workers.filter((w) => workerStatus(w, now, db.intervalDays) === 'overdue').length,
    fault: mostCommonFault({ ...db, workers }),
  };
}

export const participationClass = (pct) => (pct >= 80 ? 'text-ok' : pct >= 50 ? 'text-warn' : 'text-bad');

export function longestStreak(db, now) {
  return tracked(db)
    .map((w) => ({ name: w.name, shifts: streak(w, now) }))
    .reduce((best, s) => (s.shifts > best.shifts ? s : best), { name: null, shifts: 0 });
}

export const lastWarmup = (w) => checkinsOf(w).reduce((max, c) => Math.max(max, c.date), -Infinity);

export { mergeSample, withoutSample };

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function tile(label, value, valueClass = '', details = []) {
  const card = el('div', 'card');
  card.append(el('p', 'tile-label muted', label), el('p', `tile-value ${valueClass}`.trim(), value));
  if (details.length) {
    const list = el('ul', 'tile-list');
    list.append(...details.map((d) => el('li', '', d)));
    card.append(list);
  }
  return card;
}

function renderToday(db, now) {
  const t = todaySummary({ ...db, workers: tracked(db) }, now);
  const best = longestStreak(db, now);
  const flags = t.soreness.map((f) => `${f.name} · ${SORENESS[f.area] ?? SORENESS.other}`);
  document.getElementById('today-date').textContent = `${WEEKDAYS[new Date(now).getDay()]} ${formatDate(now)}`;
  const sum = summary(db, now);
  const needs = tracked(db).filter((w) => ['overdue', 'retake'].includes(trainingStatus(w, 'liftCert', db, now).state)).length;
  document.getElementById('today-tiles').replaceChildren(
    tile('Warmed up today', `${t.checkedIn} of ${t.total}`),
    tile('Need attention', String(needs), needs > 0 ? 'text-bad' : 'text-ok', needs > 0 ? ['Overdue or needs a retake'] : ['Everyone is up to date']),
    tile('Average lift score', sum.average === null ? '—' : String(sum.average), sum.average === null ? '' : bandClass(sum.average)),
    tile('Soreness flags', String(flags.length), flags.length > 0 ? 'text-warn' : '', flags),
  );
}


function sparkline(scores, className) {
  const w = 72;
  const h = 24;
  const pad = 3;
  const x = (i) => pad + (i * (w - 2 * pad)) / (scores.length - 1);
  // Scaled to the worker's own range: on a fixed 0-100 axis a 58 → 88 climb looks flat at this size.
  // The window never shrinks below MIN_SPAN points, so a 70 → 71 wobble does not draw as a steep climb.
  const min = Math.min(...scores);
  const span = Math.max(Math.max(...scores) - min, MIN_SPAN);
  const lo = (min + Math.max(...scores) - span) / 2;
  const y = (v) => h - pad - ((v - lo) * (h - 2 * pad)) / span;
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('class', `spark ${className}`);
  svg.setAttribute('width', w);
  svg.setAttribute('height', h);
  svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', `Scores over time: ${scores.join(', ')}`);
  const line = document.createElementNS(SVG_NS, 'polyline');
  line.setAttribute('points', scores.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' '));
  const dot = document.createElementNS(SVG_NS, 'circle');
  dot.setAttribute('cx', x(scores.length - 1).toFixed(1));
  dot.setAttribute('cy', y(scores[scores.length - 1]).toFixed(1));
  dot.setAttribute('r', 3);
  svg.append(line, dot);
  return svg;
}

function trendCell(worker) {
  const td = el('td');
  const scores = worker.sessions.map((s) => s.score);
  if (scores.length < 2) {
    td.append(el('span', 'muted', '—'));
    return td;
  }
  const first = scores[0];
  const last = scores[scores.length - 1];
  const dir = last > first ? 'up' : last < first ? 'down' : 'flat';
  const look = { up: ['▲', 'text-ok', 'improved'], down: ['▼', 'text-bad', 'got worse'], flat: ['▬', 'muted', 'no change'] }[dir];
  const wrap = el('div', 'trend');
  const text = el('span', '', `${first} → ${last} `);
  const arrow = el('span', look[1], look[0]);
  arrow.setAttribute('aria-hidden', 'true');
  text.append(arrow, el('span', 'sr-only', ` ${look[2]}`));
  wrap.append(text, sparkline(scores, look[1]));
  td.append(wrap);
  return td;
}

function dash() {
  const td = el('td');
  td.append(el('span', 'muted', '—'));
  return td;
}

const dateCell = (ms) => (Number.isFinite(ms) ? el('td', '', formatDate(ms)) : dash());

function streakCell(shifts) {
  if (shifts === 0) return dash();
  const td = el('td', 'streak');
  const flame = el('span', '', '🔥');
  flame.setAttribute('aria-hidden', 'true');
  td.append(flame, ` ${shifts}`, el('span', 'sr-only', shifts === 1 ? ' shift in a row' : ' shifts in a row'));
  return td;
}

function actionLink(className, text, page, worker) {
  const link = el('a', className, text);
  link.href = `${page}?name=${encodeURIComponent(worker.name)}`;
  link.setAttribute('aria-label', `${text} ${worker.name}`);
  return link;
}

const TRAINING_PILL = {
  completed: 'pill-ok', 'due-soon': 'pill-warn', 'due-today': 'pill-warn',
  overdue: 'pill-bad', retake: 'pill-bad', 'not-started': 'pill-neutral',
};

// What the manager needs under each pill: the score, and when it next matters.
function trainingDetail(s) {
  if (s.id === 'warmup') return s.completedAt === null ? '' : `Last: ${formatDate(s.completedAt)}`;
  if (s.state === 'not-started') return '';
  if (s.state === 'retake') return `Scored ${s.score}`;
  if (s.state === 'overdue') return `Scored ${s.score} · was due ${formatDate(s.dueAt)}`;
  return `Scored ${s.score} · due ${formatDate(s.dueAt)}`;
}

function trainingCell(worker, id, db, now) {
  const status = trainingStatus(worker, id, db, now);
  const td = el('td');
  td.append(el('span', `pill ${TRAINING_PILL[status.state]}`, STATE_LABEL[status.state]));
  const detail = trainingDetail(status);
  if (detail) td.append(el('span', 'cell-sub', detail));
  return td;
}

const recordHref = (worker) => (worker.id
  ? `record.html?id=${encodeURIComponent(worker.id)}`
  : `record.html?name=${encodeURIComponent(worker.name)}`);

function row({ worker }, db, now) {
  const tr = el('tr');
  const name = el('td');
  const link = el('a', 'name', worker.name);
  link.href = recordHref(worker);
  name.append(link);
  if (worker.sample === true) name.append(el('span', 'tag', 'Sample'));

  const pct = compliance(worker, db, now);
  const action = el('td', 'actions');
  const open = el('a', 'recheck', 'Open record');
  open.href = recordHref(worker);
  open.setAttribute('aria-label', `Open ${worker.name}'s training record`);
  action.append(open);

  tr.append(
    name, trainingCell(worker, 'liftCert', db, now), trainingCell(worker, 'warmup', db, now),
    trendCell(worker), streakCell(streak(worker, now)),
    el('td', pct === 100 ? 'text-ok' : pct >= 50 ? 'text-warn' : 'text-bad', `${pct}%`), action,
  );
  return tr;
}

// ---------- alerts ----------

const ALERT_ICON = { completed: '✅', retake: '⚠️', overdue: '🔴', 'due-soon': '🟡', soreness: '🩹' };
const MAX_ALERTS = 8;

function ago(at, now) {
  const mins = Math.round((now - at) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  if (mins < 60 * 24) return `${Math.round(mins / 60)} h ago`;
  return formatDate(at);
}

function renderAlerts(db, now) {
  const list = alerts({ ...db, workers: tracked(db) }, now);
  const seen = db.alertsSeenAt ?? 0;
  const unread = list.filter((a) => a.at > seen).length;
  document.getElementById('alerts').hidden = list.length === 0;
  document.getElementById('alertCount').hidden = unread === 0;
  document.getElementById('alertCount').textContent = String(unread);
  document.getElementById('markRead').hidden = unread === 0;
  document.getElementById('alertList').replaceChildren(...list.slice(0, MAX_ALERTS).map((a) => {
    const li = el('li', a.at > seen ? 'unread' : '');
    const worker = db.workers.find((w) => w.name === a.worker);
    const link = el('a', '', a.text);
    if (worker) link.href = recordHref(worker);
    const time = el('time', '', ago(a.at, now));
    li.append(el('span', 'icon', ALERT_ICON[a.type]), link, time);
    return li;
  }));
}

// ---------- search and filters ----------

const view = { query: '', filter: 'all' };

function renderFilters() {
  document.getElementById('filters').replaceChildren(...FILTERS.map(([id, label]) => {
    const chip = el('button', 'chip', label);
    chip.type = 'button';
    chip.setAttribute('aria-pressed', String(view.filter === id));
    chip.addEventListener('click', () => { view.filter = id; render(); });
    return chip;
  }));
}

function render() {
  const db = { ...emptyDb(), ...load() };
  const now = Date.now();
  const rows = sortedRows(db, now);
  const all = db.workers ?? [];
  const hasSample = all.some((w) => w.sample === true);
  const isEmpty = rows.length === 0;

  const pack = PACKS[db.pack] ?? PACKS[DEFAULT_PACK];
  document.getElementById('bizTitle').textContent = db.business?.name ?? '';
  document.getElementById('interval').textContent = `${pack.name} · lift certification every ${db.intervalDays} days`;
  renderToday(db, now);
  const names = new Set(searchWorkers(rows.map((r) => r.worker), view.query)
    .filter((w) => matchesFilter(w, view.filter, db, now)).map((w) => w.name));
  const shown = rows.filter((r) => names.has(r.worker.name));
  document.getElementById('rows').replaceChildren(...shown.map((r) => row(r, db, now)));
  document.getElementById('noMatch').hidden = shown.length > 0 || isEmpty;
  document.getElementById('noMatch').textContent = view.query.trim()
    ? `No team member matches "${view.query.trim()}"${view.filter === 'all' ? '' : ' with that filter'}.`
    : 'No team member matches that filter.';
  renderFilters();
  renderAlerts(db, now);
  document.getElementById('today').hidden = isEmpty;
  document.getElementById('empty').hidden = !isEmpty;
  document.getElementById('records').hidden = isEmpty;
  document.getElementById('sample-note').hidden = !hasSample;
  // The empty card has its own Load sample data button.
  document.getElementById('load-sample').hidden = isEmpty;
  document.getElementById('clear-sample').hidden = !hasSample;
  document.getElementById('clear-all').hidden = all.length === 0;
}

let confirmTimer = null;
let armedAt = 0;

function disarm() {
  clearTimeout(confirmTimer);
  confirmTimer = null;
  const btn = document.getElementById('clear-all');
  btn.textContent = 'Clear all records';
  btn.classList.remove('btn-danger');
}

// Two clicks instead of window.confirm, which blocks browser automation.
function clearAll() {
  if (confirmTimer === null) {
    const btn = document.getElementById('clear-all');
    btn.textContent = 'Click again to confirm';
    btn.classList.add('btn-danger');
    confirmTimer = setTimeout(disarm, CONFIRM_MS);
    armedAt = Date.now();
    return false;
  }
  if (Date.now() - armedAt < DOUBLE_CLICK_MS) return false;
  disarm();
  // Records go; the business, its settings and the real roster (with PINs) stay.
  const db = load();
  const roster = db.workers.filter((w) => typeof w.id === 'string' && w.sample !== true)
    .map((w) => ({ ...w, sessions: [], checkins: [] }));
  save({ ...db, workers: roster, alertsSeenAt: 0 });
  return true;
}

const ACTIONS = {
  'load-sample': () => { save(mergeSample({ ...emptyDb(), ...load() }, Date.now())); return true; },
  'clear-sample': () => { save(withoutSample({ ...emptyDb(), ...load() })); return true; },
  'clear-all': clearAll,
  'mark-read': () => { save(markAlertsRead(load(), Date.now())); return true; },
};


function init() {
  document.getElementById('search').addEventListener('input', (e) => { view.query = e.target.value; render(); });
  document.addEventListener('click', (e) => {
    const action = e.target.closest('[data-action]')?.dataset.action;
    if (!action) return;
    if (action !== 'clear-all' && confirmTimer !== null) disarm();
    // save() throws when site data is blocked or full; still redraw from what is really stored.
    try {
      if (!ACTIONS[action]()) return;
    } catch (err) {
      console.warn('LiftSafe: could not update records', err);
    }
    render();
  });
  window.addEventListener('storage', render);
  // Back from a Recheck in this same tab: no storage event fires and the page may come from the bfcache.
  window.addEventListener('pageshow', (e) => { if (e.persisted) render(); });
  render();
}

// Guarded so the pure helpers above can be imported from node for checks.
// In the browser this is the manager's area: no manager session, back to the kiosk.
if (typeof document !== 'undefined' && requireRole(['manager'])) {
  keepAlive();
  document.getElementById('signOut').addEventListener('click', () => {
    endSession();
    location.replace('app.html');
  });
  init();
}
