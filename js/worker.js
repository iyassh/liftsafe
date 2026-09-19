// Worker home: what a signed-in worker sees between the PIN pad and the camera.
// Shows only their own records.
import { load, findWorker, checkinsOf, streak, latest } from './store.js';
import { TRAININGS, STATE_LABEL, allStatuses } from './training.js';
import { requireRole, endSession, keepAlive } from './auth.js';
import { FAULTS } from './engine/scoring.js';

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

const PILL = {
  completed: 'pill-ok', 'due-soon': 'pill-warn', 'due-today': 'pill-warn',
  overdue: 'pill-bad', retake: 'pill-bad', 'not-started': 'pill-neutral',
};

function courseDetail(s) {
  if (s.id === 'warmup') return s.state === 'completed' ? 'Done for today. Back tomorrow.' : 'Every shift · about 3 minutes';
  if (s.state === 'not-started') return 'Five lifts · about 2 minutes';
  if (s.state === 'retake') return `You scored ${s.score}. ${TRAININGS.liftCert.passMark} passes. Have another go.`;
  if (s.state === 'overdue') return `Scored ${s.score} · was due ${formatDate(s.dueAt)}`;
  return `Scored ${s.score} · valid until ${formatDate(s.dueAt)}`;
}

// One card per training, like a course list: where I stand, my score, and a way in.
function renderCourses(statuses) {
  $('courses').replaceChildren(...statuses.map((s) => {
    const t = TRAININGS[s.id];
    const needsDoing = !['completed', 'due-soon'].includes(s.state);
    const card = document.createElement('article');
    card.className = 'card course';
    const head = document.createElement('div');
    head.className = 'course-head';
    const title = document.createElement('h3');
    title.textContent = t.name;
    const pill = document.createElement('span');
    pill.className = `pill ${PILL[s.state]}`;
    pill.textContent = STATE_LABEL[s.state];
    head.append(title, pill);
    const blurb = document.createElement('p');
    blurb.className = 'muted';
    blurb.textContent = t.blurb;
    const detail = document.createElement('p');
    detail.textContent = courseDetail(s);
    const start = document.createElement('a');
    start.className = needsDoing ? 'btn' : 'btn btn-ghost';
    start.href = t.page;
    start.textContent = s.state === 'not-started' ? 'Start' : s.state === 'retake' ? 'Retake' : needsDoing ? 'Start' : 'Practise again';
    card.append(head, blurb, detail, start);
    return card;
  }));
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

  $('bizTitle').textContent = db.business?.name ?? '';
  $('greeting').textContent = `${greeting(now)}, ${worker.name.split(' ')[0]}`;
  $('todayStatus').textContent = doneToday ? '✓ Shift-ready' : 'Warm-up to do';
  $('todayStatus').className = `stat-value ${doneToday ? 'text-ok' : 'text-warn'}`;
  $('streakValue').textContent = run ? `🔥 ${run} ${run === 1 ? 'shift' : 'shifts'}` : 'Starts today';
  const statuses = allStatuses(worker, db, now);
  const done = statuses.filter((st) => ['completed', 'due-soon'].includes(st.state)).length;
  $('progress').textContent = `${done} of ${statuses.length} complete`;
  $('progress').className = `stat-value ${done === statuses.length ? 'text-ok' : 'text-warn'}`;
  $('progressDetail').textContent = done === statuses.length ? 'You are up to date.' : 'See what is left below.';
  renderCourses(statuses);
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
