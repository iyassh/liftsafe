// Worker home: what a signed-in worker sees between the PIN pad and the camera.
// Shows only their own records.
import { load, findWorker, checkinsOf, streak, latest, nextDue, workerStatus } from './store.js';
import { requireRole, endSession, keepAlive } from './auth.js';
import { FAULTS } from './engine/scoring.js';
import { PACKS, DEFAULT_PACK } from './packs.js';
import { MOVEMENTS } from './engine/movements.js';

const DAY = 86400000;
const $ = (id) => document.getElementById(id);
const band = (score) => (score >= 70 ? 'text-ok' : score >= 50 ? 'text-warn' : 'text-bad');
const formatDate = (ms) => new Date(ms).toLocaleDateString([], { day: 'numeric', month: 'short', year: 'numeric' });
const sameDay = (a, b) => new Date(a).toDateString() === new Date(b).toDateString();

function greeting(now) {
  const h = new Date(now).getHours();
  return h < 12 ? 'Morning' : h < 18 ? 'Afternoon' : 'Evening';
}

function signOut() {
  endSession();
  location.replace('app.html');
}

function renderCert(worker, db, now) {
  const status = workerStatus(worker, now, db.intervalDays);
  const due = nextDue(worker, db.intervalDays);
  const daysLeft = due === null ? null : Math.ceil((due - now) / DAY);
  const view = {
    uncertified: ['Not certified yet', 'text-warn', 'Do a lift check to get certified.'],
    current: ['Certified', 'text-ok', `Until ${due === null ? '' : formatDate(due)}`],
    'due-soon': [`Due in ${daysLeft} ${daysLeft === 1 ? 'day' : 'days'}`, 'text-warn', 'Time for your lift check.'],
    overdue: ['Overdue', 'text-bad', `Was due ${due === null ? '' : formatDate(due)}`],
  }[status];
  $('certStatus').textContent = view[0];
  $('certStatus').className = `stat-value ${view[1]}`;
  $('certDetail').textContent = view[2];
  $('liftSub').textContent = status === 'current' ? 'Practise any time' : 'Five lifts, about 2 minutes';
}

function renderHistory(worker) {
  const items = worker.sessions.slice(-5).reverse().map((s) => {
    const li = document.createElement('li');
    const when = document.createElement('span');
    when.textContent = formatDate(s.date);
    const score = document.createElement('strong');
    score.className = band(s.score);
    score.textContent = `${s.score} · ${s.passed ? 'Pass' : 'Needs coaching'}`;
    li.append(when, score);
    return li;
  });
  $('history').replaceChildren(...items);
  $('noHistory').hidden = items.length > 0;
}

function renderTip(worker) {
  const fault = FAULTS[latest(worker)?.topFault];
  $('tipCard').hidden = !fault;
  if (!fault) return;
  $('tipLabel').textContent = fault.label;
  $('tipText').textContent = fault.tip;
}

function render(session) {
  const db = load();
  const worker = findWorker(db, session.workerId);
  if (!worker) return signOut(); // removed from the team while signed in
  const now = Date.now();
  const doneToday = checkinsOf(worker).some((c) => sameDay(c.date, now));
  const run = streak(worker, now);
  const pack = PACKS[db.pack] ?? PACKS[DEFAULT_PACK];

  $('bizTitle').textContent = db.business?.name ?? '';
  $('greeting').textContent = `${greeting(now)}, ${worker.name.split(' ')[0]}`;
  $('todayStatus').textContent = doneToday ? '✓ Shift-ready' : 'Warm-up to do';
  $('todayStatus').className = `stat-value ${doneToday ? 'text-ok' : 'text-warn'}`;
  $('streakValue').textContent = run ? `🔥 ${run} ${run === 1 ? 'shift' : 'shifts'}` : 'Starts today';
  $('warmupSub').textContent = doneToday ? 'Done today. Go again if you like.' : pack.warmup.map((id) => MOVEMENTS[id].name).join(' · ');
  renderCert(worker, db, now);
  renderTip(worker);
  renderHistory(worker);
  $('worker').hidden = false;
}

const session = requireRole(['worker']);
if (session) {
  keepAlive();
  $('signOut').addEventListener('click', signOut);
  render(session);
  addEventListener('pageshow', (e) => { if (e.persisted && requireRole(['worker'])) render(session); });
}
