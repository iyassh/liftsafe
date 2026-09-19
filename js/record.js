// One team member's training record: where they stand on every training, what is
// coming up, and everything they have done. Also the sheet a manager prints.
import { load, findWorker, streak, checkinsOf } from './store.js';
import { requireRole, keepAlive } from './auth.js';
import { TRAININGS, STATE_LABEL, allStatuses, compliance, transcript, upcoming } from './training.js';
import { FAULTS } from './engine/scoring.js';

const PILL = { completed: 'pill-ok', 'due-soon': 'pill-warn', 'due-today': 'pill-warn', overdue: 'pill-bad', retake: 'pill-bad', 'not-started': 'pill-neutral' };
const SORENESS = { 'lower-back': 'Lower back', shoulders: 'Shoulders', knees: 'Knees', other: 'Other' };
const $ = (id) => document.getElementById(id);
const band = (score) => (score >= 70 ? 'text-ok' : score >= 50 ? 'text-warn' : 'text-bad');
const formatDate = (ms) => new Date(ms).toLocaleDateString([], { day: 'numeric', month: 'short', year: 'numeric' });
const formatTime = (ms) => new Date(ms).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function listInto(listId, emptyId, items) {
  $(listId).replaceChildren(...items);
  $(emptyId).hidden = items.length > 0;
}

function row(title, detail, right, rightClass = '') {
  const li = el('li');
  const what = el('span', 'what');
  what.append(el('span', '', title));
  if (detail) what.append(el('small', '', detail));
  li.append(what, el('strong', rightClass, right));
  return li;
}

function renderTraining(statuses) {
  $('trainingRows').replaceChildren(...statuses.map((s) => {
    const tr = el('tr');
    const name = el('td');
    name.append(el('strong', '', TRAININGS[s.id].name));
    const status = el('td');
    status.append(el('span', `pill ${PILL[s.state]}`, STATE_LABEL[s.state]));
    const score = el('td', s.score === null ? 'muted' : band(s.score), s.score === null ? '—' : String(s.score));
    tr.append(name, status, score,
      el('td', '', String(s.attempts)),
      el('td', '', s.completedAt === null ? '—' : formatDate(s.completedAt)),
      el('td', '', s.dueAt === null ? '—' : s.id === 'warmup' ? 'Every shift' : formatDate(s.dueAt)));
    return tr;
  }));
}

function mostCommonFault(worker) {
  const counts = {};
  for (const s of worker.sessions) if (s.topFault) counts[s.topFault] = (counts[s.topFault] ?? 0) + 1;
  const top = Object.keys(counts).sort((a, b) => counts[b] - counts[a])[0];
  return FAULTS[top]?.label ?? 'None found';
}

function historyRow(e) {
  const sample = e.sample ? ' · demo data' : '';
  if (e.trainingId === 'liftCert') {
    const fault = FAULTS[e.topFault]?.label;
    return row(TRAININGS.liftCert.name, `${formatDate(e.date)}${fault ? ` · ${fault}` : ''}${sample}`,
      `${e.score} · ${e.passed ? 'Pass' : 'Needs retake'}`, band(e.score));
  }
  return row(TRAININGS.warmup.name, `${formatDate(e.date)} · ${formatTime(e.date)}${sample}`,
    e.completed ? '✓ Completed' : 'Partly done', e.completed ? 'text-ok' : 'text-warn');
}

function render() {
  const db = load();
  const worker = findWorker(db, new URLSearchParams(location.search).get('id'))
    ?? db.workers.find((w) => w.name === new URLSearchParams(location.search).get('name'));
  if (!worker) { $('missing').hidden = false; return; }
  const now = Date.now();
  const statuses = allStatuses(worker, db, now);
  const pct = compliance(worker, db, now);
  const run = streak(worker, now);
  const records = transcript(worker);

  document.title = `${worker.name} · Training record`;
  $('bizTitle').textContent = db.business?.name ?? '';
  $('name').textContent = worker.name;
  $('subtitle').textContent = records.length
    ? `Training record · ${records.length} ${records.length === 1 ? 'entry' : 'entries'} since ${formatDate(records[records.length - 1].date)}`
    : 'Training record · nothing completed yet';
  $('compliance').textContent = `${pct}%`;
  $('compliance').className = `stat-value ${pct === 100 ? 'text-ok' : pct >= 50 ? 'text-warn' : 'text-bad'}`;
  $('streak').textContent = run ? `🔥 ${run}` : '—';
  $('topFault').textContent = mostCommonFault(worker);
  renderTraining(statuses);

  listInto('upcoming', 'noUpcoming', upcoming(worker, db, now).map((u) => row(
    TRAININGS[u.trainingId].name,
    u.trainingId === 'warmup' ? 'Every shift' : formatDate(u.dueAt),
    STATE_LABEL[u.state], PILL[u.state].replace('pill-', 'text-').replace('text-neutral', 'muted'),
  )));
  listInto('soreness', 'noSoreness', checkinsOf(worker).filter((c) => c.soreness).reverse().slice(0, 10)
    .map((c) => row(SORENESS[c.soreness] ?? 'Other', c.sample ? 'demo data' : '', formatDate(c.date), 'text-warn')));
  listInto('history', 'noHistory', records.slice(0, 40).map(historyRow));
  $('printFoot').textContent = `Printed ${formatDate(now)} from LiftSafe. Scores are recorded by the app on this device; no video is stored.`;
  $('record').hidden = false;
}

if (requireRole(['manager'])) {
  keepAlive();
  $('printBtn').addEventListener('click', () => window.print());
  render();
}
