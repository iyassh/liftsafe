// Supervisor dashboard. Everything is rebuilt from load() after each action, so the
// page never holds a copy of the records that could drift from localStorage.
import {
  load, save, emptyDb, latest, nextDue, workerStatus, mostCommonFault, checkinsOf, streak, todaySummary,
} from './store.js';
import { FAULTS } from './engine/scoring.js';
import { PACKS, DEFAULT_PACK } from './packs.js';
import { mergeSample, withoutSample } from './sampleData.js';

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
  document.getElementById('today-tiles').replaceChildren(
    tile('Checked in today', `${t.checkedIn} of ${t.total}`),
    tile('7-day participation', `${t.participation7d}%`, participationClass(t.participation7d)),
    tile('Soreness flags', String(flags.length), flags.length > 0 ? 'text-warn' : '', flags),
    tile('Longest streak', best.shifts ? `${best.shifts} ${best.shifts === 1 ? 'shift' : 'shifts'}` : '—', '', best.shifts ? [best.name] : []),
  );
}

function renderTiles(db, now) {
  const s = summary(db, now);
  document.getElementById('tiles').replaceChildren(
    tile('Workers', String(s.workers)),
    tile('Average latest score', s.average === null ? '—' : String(s.average), s.average === null ? '' : bandClass(s.average)),
    tile('Overdue rechecks', String(s.overdue), s.overdue > 0 ? 'text-bad' : ''),
    tile('Most common issue', FAULTS[s.fault]?.label ?? 'None yet', 'is-text'),
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

function row({ worker, status, due }, now) {
  const tr = el('tr');
  const last = latest(worker);

  const name = el('td');
  name.append(el('span', 'name', worker.name));
  if (worker.sample === true) name.append(el('span', 'tag', 'Sample'));

  const score = last ? el('td') : dash();
  if (last) score.append(el('span', `score ${bandClass(last.score)}`, String(last.score)));

  const state = el('td');
  state.append(el('span', `pill ${STATUS[status].pill}`, STATUS[status].label));

  const action = el('td', 'actions');
  action.append(
    actionLink('recheck', last ? 'Recheck' : 'Certify', 'check.html', worker),
    actionLink('warmup-link', 'Warm-up', 'warmup.html', worker),
  );

  tr.append(
    name, score, trendCell(worker), dateCell(last?.date), dateCell(due), state,
    streakCell(streak(worker, now)), dateCell(lastWarmup(worker)), action,
  );
  return tr;
}

function render() {
  const db = { ...emptyDb(), ...load() };
  const now = Date.now();
  const rows = sortedRows(db, now);
  const all = db.workers ?? [];
  const hasSample = all.some((w) => w.sample === true);
  const isEmpty = rows.length === 0;

  document.getElementById('interval').textContent = `Recheck every ${db.intervalDays} days`;
  document.getElementById('pack').value = db.pack in PACKS ? db.pack : DEFAULT_PACK;
  renderToday(db, now);
  renderTiles(db, now);
  document.getElementById('rows').replaceChildren(...rows.map((r) => row(r, now)));
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
  save({ ...emptyDb(), intervalDays: load().intervalDays ?? emptyDb().intervalDays });
  return true;
}

const ACTIONS = {
  'load-sample': () => { save(mergeSample({ ...emptyDb(), ...load() }, Date.now())); return true; },
  'clear-sample': () => { save(withoutSample({ ...emptyDb(), ...load() })); return true; },
  'clear-all': clearAll,
};

function initPack() {
  const select = document.getElementById('pack');
  for (const [id, pack] of Object.entries(PACKS)) {
    const option = el('option', '', `${pack.name} · ${pack.blurb}`);
    option.value = id;
    select.append(option);
  }
  select.addEventListener('change', () => {
    try {
      save({ ...load(), pack: select.value });
    } catch (err) {
      console.warn('LiftSafe: could not save the business type', err);
    }
    render();
  });
}

function init() {
  initPack();
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
if (typeof document !== 'undefined') init();
