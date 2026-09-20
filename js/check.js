import { PoseLandmarker, FilesetResolver } from '../vendor/mediapipe/vision_bundle.mjs';
import { computeMetrics } from './engine/poseMetrics.js';
import { checkPosition } from './engine/positioning.js';
import { LiftAnalyzer } from './engine/liftAnalyzer.js';
import { FAULTS, scoreLift, liveFaults, summariseSession } from './engine/scoring.js';
import { devLog, devFlag } from './devLog.js';
import { load, save, addSession } from './store.js';
import { currentSession, touchSession } from './auth.js';
import { speak, voiceOn, setVoice, stopSpeaking } from './voice.js';
import { DEMOS, playDemo } from './demoFigure.js';

const LIFTS_PER_SESSION = 5;
const READY_HOLD_MS = 1500; // position must be good this long before scoring starts
const READY_SHOW_MS = 700; // how long "✓ Ready" stays up
const PAUSE_AFTER_MS = 2000; // bad position this long mid-session pauses scoring
const TIP_MS = 3000;
const FRAME_GAP_MS = 500; // longer than this between frames and the timers start over
const SCREENS = ['name', 'positioning', 'lifting', 'results'];
const COLOR = { ok: '#34c759', warn: '#ffcc00', bad: '#ff3b30' };

// The whole body the model sees: head, arms and hands, trunk, legs and feet.
const BONES = [
  [0, 7], [0, 8], // head
  [11, 13], [13, 15], [15, 19], [12, 14], [14, 16], [16, 20], // arms and hands
  [11, 12], [11, 23], [12, 24], [23, 24], // trunk
  [23, 25], [25, 27], [24, 26], [26, 28], // legs
  [27, 29], [29, 31], [27, 31], [28, 30], [30, 32], [28, 32], // feet
];
const JOINTS = [...new Set(BONES.flat())];

const params = new URLSearchParams(location.search);
const testVideoUrl = params.get('video');
const debugOn = devFlag('debug');

const $ = (id) => document.getElementById(id);
const el = {
  stage: $('stage'), video: $('cam'), canvas: $('overlay'), stageMsg: $('stageMsg'),
  nameForm: $('nameForm'), nameInput: $('workerName'), startBtn: $('startBtn'),
  startError: $('startError'), startErrorMsg: $('startErrorMsg'), retryBtn: $('retryBtn'),
  liftCount: $('liftCount'), dots: $('dots'), lastScore: $('lastScore'), tip: $('tip'),
  resultName: $('resultName'), sessionScore: $('sessionScore'), verdict: $('verdict'),
  liftScores: $('liftScores'), topFaultLabel: $('topFaultLabel'), topFaultTip: $('topFaultTip'),
  saveBtn: $('saveBtn'), againBtn: $('againBtn'), doneBtn: $('doneBtn'), who: $('who'), saved: $('saved'), savedMsg: $('savedMsg'),
  dashLink: $('dashLink'),
  improved: $('improved'), coach: $('coach'), demoWrong: $('demoWrong'), demoRight: $('demoRight'),
  demoWrongLabel: $('demoWrongLabel'), demoRightLabel: $('demoRightLabel'),
  debug: $('debug'), liveStats: $('liveStats'), measures: $('measures'), voiceBtn: $('voiceBtn'),
};
const ctx = el.canvas.getContext('2d');

// Everything that changes during a check lives here; go() is the only place the screen changes.
const state = {
  screen: 'name',
  name: '',
  landmarker: null,
  stream: null,
  opening: false, // a model load or camera request is in flight
  analyzer: null,
  scored: [],
  summary: null,
  goodSince: null, // positioning: when checkPosition first came back clean
  badSince: null, // lifting: when checkPosition first failed
  paused: false,
  tipUntil: 0,
  lastFrameAt: 0,
  attempts: [], // session scores this visit: test, coach, test again
  stopDemo: null,
};

window.__liftsafe = {
  get state() { return state.screen; },
  get scored() { return state.scored; },
};

const band = (score) => (score >= 70 ? 'ok' : score >= 50 ? 'warn' : 'bad');

// ---------- screens ----------

function go(screen) {
  const leavingCamera = screen === 'results' || screen === 'name';
  if (leavingCamera) stopSource();
  state.screen = screen;
  state.stopDemo?.();
  state.stopDemo = null;
  devLog.event('screen', { screen });
  for (const s of SCREENS) $(`screen-${s}`).hidden = s !== screen;
  el.stage.hidden = screen === 'name' || screen === 'results';
  $('check').dataset.screen = screen;
  setStageMsg(null);

  if (screen === 'positioning') resetSession();
  if (screen === 'lifting') {
    renderPanel();
    speak('Ready. Pick the box up, stand tall, then put it back down.');
  }
  if (screen === 'results') renderResults();
}

function resetSession() {
  state.analyzer = new LiftAnalyzer();
  state.scored = [];
  state.summary = null;
  state.goodSince = null;
  state.badSince = null;
  state.paused = false;
  state.tipUntil = 0;
  el.tip.textContent = '';
}

function setStageMsg(text, tone = 'warn') {
  el.stageMsg.hidden = !text;
  if (!text) return;
  if (el.stageMsg.textContent !== text) el.stageMsg.textContent = text;
  el.stageMsg.className = `stage-msg text-${tone}`;
}

// ---------- name screen ----------

function syncStartButton() {
  state.name = el.nameInput.value.trim();
  el.startBtn.disabled = state.name === '';
}

function showStartError(message) {
  el.startError.hidden = !message;
  el.startErrorMsg.textContent = message ?? '';
}

function cameraErrorMessage(err) {
  if (testVideoUrl) return `Could not play the test video: ${err.message}`;
  if (!navigator.mediaDevices?.getUserMedia) {
    return 'This browser cannot open a camera here. Open LiftSafe from localhost or https, in a current browser.';
  }
  switch (err.name) {
    case 'NotAllowedError':
    case 'SecurityError':
      return 'Camera access was blocked. Allow the camera for this page in the address bar, then press Retry.';
    case 'NotFoundError':
    case 'OverconstrainedError':
      return 'No camera was found. Plug one in, then press Retry.';
    case 'NotReadableError':
      return 'The camera is in use by another app. Close it, then press Retry.';
    default:
      return `Could not start the camera: ${err.message} Press Retry.`;
  }
}

async function begin() {
  syncStartButton();
  if (!state.name) return;
  showStartError(null);
  el.startBtn.disabled = true;
  el.retryBtn.disabled = true;
  el.startBtn.textContent = 'Starting…';
  try {
    await openCheck();
  } finally {
    el.startBtn.textContent = 'Start';
    el.retryBtn.disabled = false;
    syncStartButton();
  }
}

// Loads the model, opens the source and moves to positioning. On failure the
// worker lands on the name screen with a message and Retry, never a blank page.
async function openCheck() {
  // A second click while the camera prompt is up would open, and leak, a second stream.
  if (state.opening) return;
  state.opening = true;
  try {
    await openSourceAndStart();
  } finally {
    state.opening = false;
  }
}

async function openSourceAndStart() {
  try {
    state.landmarker = await getLandmarker();
  } catch (err) {
    console.error(err);
    landmarkerPromise = null;
    go('name');
    showStartError('Could not load the pose model. Check that the vendor/mediapipe folder is being served, then press Retry.');
    return;
  }
  try {
    await startSource();
  } catch (err) {
    console.error(err);
    go('name');
    showStartError(cameraErrorMessage(err));
    return;
  }
  go('positioning');
  startLoop();
}

// ---------- MediaPipe + video source ----------

let landmarkerPromise = null;

function getLandmarker() {
  landmarkerPromise ??= createLandmarker();
  return landmarkerPromise;
}

async function createLandmarker() {
  const fileset = await FilesetResolver.forVisionTasks('vendor/mediapipe/wasm');
  const options = (delegate) => ({
    baseOptions: { modelAssetPath: 'vendor/mediapipe/pose_landmarker_lite.task', delegate },
    runningMode: 'VIDEO',
    numPoses: 1,
  });
  try {
    return await PoseLandmarker.createFromOptions(fileset, options('GPU'));
  } catch (err) {
    console.warn('GPU delegate unavailable, using CPU', err);
    return PoseLandmarker.createFromOptions(fileset, options('CPU'));
  }
}

async function startSource() {
  stopSource();
  const { video } = el;
  if (testVideoUrl) {
    video.src = testVideoUrl;
    video.loop = true;
    video.muted = true;
    video.playsInline = true;
  } else {
    if (!navigator.mediaDevices?.getUserMedia) throw new Error('getUserMedia is not available');
    state.stream = await navigator.mediaDevices.getUserMedia({
      video: { width: { ideal: 1280 }, height: { ideal: 720 } },
      audio: false,
    });
    // Fires when the camera is unplugged or revoked, not when we stop the track ourselves.
    state.stream.getVideoTracks()[0]?.addEventListener('ended', onCameraLost);
    video.srcObject = state.stream;
  }
  await video.play();
  syncCanvasSize();
}

function onCameraLost() {
  if (state.screen !== 'positioning' && state.screen !== 'lifting') return;
  go('name');
  showStartError('The camera stopped. Reconnect it, then press Retry.');
}

function stopSource() {
  const { video } = el;
  if (state.stream) {
    for (const track of state.stream.getTracks()) track.stop();
    state.stream = null;
  }
  video.pause();
  video.srcObject = null;
  if (video.hasAttribute('src')) {
    video.removeAttribute('src');
    video.load();
  }
  ctx.clearRect(0, 0, el.canvas.width, el.canvas.height);
}

function syncCanvasSize() {
  const { video, canvas } = el;
  if (!video.videoWidth) return;
  if (canvas.width !== video.videoWidth) canvas.width = video.videoWidth;
  if (canvas.height !== video.videoHeight) canvas.height = video.videoHeight;
}

// ---------- frame loop ----------

let loopStarted = false;
let lastVideoTime = -1;
let lastStamp = 0;
let frameErrorLogged = false;

function startLoop() {
  if (loopStarted) return;
  loopStarted = true;
  requestAnimationFrame(loop);
}

function loop() {
  try {
    tick(performance.now());
  } catch (err) {
    // One bad frame must not end the session; log the first so the console stays readable.
    if (!frameErrorLogged) console.error('Frame failed', err);
    frameErrorLogged = true;
  }
  requestAnimationFrame(loop);
}

function tick(now) {
  const active = state.screen === 'positioning' || state.screen === 'lifting';
  if (!active) return;
  if (state.tipUntil && now > state.tipUntil) {
    state.tipUntil = 0;
    el.tip.textContent = '';
  }
  const { video } = el;
  if (video.readyState < 2 || !video.videoWidth || video.currentTime === lastVideoTime) return;
  lastVideoTime = video.currentTime;
  syncCanvasSize();

  // detectForVideo needs strictly increasing timestamps, even across a looped test video.
  const stamp = Math.max(now, lastStamp + 1);
  lastStamp = stamp;
  const lms = state.landmarker.detectForVideo(video, stamp).landmarks?.[0] ?? null;
  onFrame(lms, now);
}

function onFrame(lms, now) {
  const aspect = el.video.videoWidth / el.video.videoHeight;
  const problem = checkPosition(lms, aspect);
  const m = lms ? computeMetrics(lms, aspect) : null;
  // After a hidden tab or a stall the hold and pause timers would count time nobody was watched.
  if (now - state.lastFrameAt > FRAME_GAP_MS) {
    state.goodSince = null;
    state.badSince = null;
  }
  state.lastFrameAt = now;
  const tone = state.screen === 'positioning'
    ? framePositioning(problem, now)
    // Once in position, only an unseeable body stops scoring. The stricter checks misfire on a
    // bent-over worker: a real session read "turn sideways" and "too close" mid-lift.
    : frameLifting(m, m?.visible ? null : problem, now);

  ctx.clearRect(0, 0, el.canvas.width, el.canvas.height);
  if (lms) drawSkeleton(lms, COLOR[tone]);
  if (debugOn) renderDebug(m, problem);
  renderLiveStats(m);
  devLog.frame(now, state.screen, state.analyzer?.phase, m, problem, m?.visible ? liveFaults(m) : []);
}

function framePositioning(problem, now) {
  if (problem) {
    state.goodSince = null;
    setStageMsg(problem.message, 'warn');
    return 'warn';
  }
  state.goodSince ??= now;
  const held = now - state.goodSince;
  if (held >= READY_HOLD_MS + READY_SHOW_MS) go('lifting');
  else if (held >= READY_HOLD_MS) setStageMsg('✓ Ready', 'ok');
  else setStageMsg('Hold it there…', 'ok');
  return 'ok';
}

function frameLifting(m, problem, now) {
  if (problem) {
    // Frames from a bad position are not scored. A short blip is ignored; a long
    // one drops the half-seen lift so it cannot be scored from partial data.
    state.badSince ??= now;
    if (!state.paused && now - state.badSince > PAUSE_AFTER_MS) {
      state.paused = true;
      state.analyzer.reset();
      devLog.event('paused', { pos: problem.id });
    }
    setStageMsg(state.paused ? problem.message : null, 'warn');
    return 'warn';
  }
  state.badSince = null;
  state.paused = false;

  const wasLifting = state.analyzer.phase === 'lifting';
  const lift = state.analyzer.update(m, now);
  // A lift that ends without a summary was dropped (too short, or a gap in usable frames).
  if (wasLifting && state.analyzer.phase === 'standing' && !lift) devLog.event('lift-dropped');
  if (lift) {
    const result = { ...scoreLift(lift), measures: measuresOf(lift) };
    devLog.event('lift', { n: state.scored.length + 1, lift, result });
    recordLift(result, now);
  }
  if (state.screen !== 'lifting') return 'ok';

  const live = liveFaults(m);
  setStageMsg(live.length ? FAULTS[live[0]].label : null, 'bad');
  coachAloud(live[0] ?? null, now);
  return live.length ? 'bad' : 'ok';
}

// Test, coach, test again: show the mistake next to the fix, and on a retake show the change.
function renderCoaching(summary) {
  const before = state.attempts[state.attempts.length - 1];
  state.attempts.push(summary.score);
  const change = before === undefined ? null : summary.score - before;
  el.improved.hidden = change === null;
  if (change !== null) {
    el.improved.textContent = change > 0 ? `First try ${before}  →  now ${summary.score}   ▲ +${change}`
      : change < 0 ? `Last try ${before}  →  now ${summary.score}   ▼ ${change}` : `Same as last try: ${summary.score}`;
    el.improved.className = `improved text-${change > 0 ? 'ok' : change < 0 ? 'bad' : 'warn'}`;
  }

  const demo = DEMOS[summary.topFault];
  el.coach.hidden = !demo;
  if (demo) {
    el.demoWrongLabel.textContent = `✗ ${demo.wrongLabel}`;
    el.demoRightLabel.textContent = `✓ ${demo.rightLabel}`;
    // After layout, so the canvases know their size.
    requestAnimationFrame(() => { state.stopDemo = playDemo(summary.topFault, el.demoWrong, el.demoRight); });
    el.againBtn.textContent = 'Watch, then try again';
  } else {
    el.againBtn.textContent = 'Try again';
  }

  const result = `Your lift safety score is ${summary.score}. ${summary.passed ? 'Pass.' : 'Needs coaching.'}`;
  const progress = change > 0 ? ` Up ${change} from your first try.` : '';
  speak(`${result}${progress}${demo ? ` ${FAULTS[summary.topFault].tip}` : ''}`);
}

// The numbers behind a score, rounded for people. Saved with the record.
const measuresOf = (lift) => ({
  back: Math.round(lift.maxTrunk), knees: Math.round(lift.kneeAtMaxTrunk),
  reach: +lift.maxReach.toFixed(2), seconds: +(lift.durationMs / 1000).toFixed(1),
});

// Live numbers over the video: proof that the score comes from measurement.
function renderLiveStats(m) {
  const show = Boolean(m?.visible) && (state.screen === 'lifting' || state.screen === 'positioning');
  el.liveStats.hidden = !show;
  if (show) el.liveStats.textContent = `Back ${Math.round(m.trunkAngle)}°  ·  Knees ${Math.round(m.kneeAngle)}°  ·  Reach ${m.reach.toFixed(1)}`;
}

// Says a fault once when it appears, not on every frame it persists.
const COACH_GAP_MS = 3500;
let lastCoached = { fault: null, at: -Infinity };
function coachAloud(fault, now) {
  if (!fault) { lastCoached.fault = null; return; }
  if (fault === lastCoached.fault || now - lastCoached.at < COACH_GAP_MS) return;
  lastCoached = { fault, at: now };
  speak(FAULTS[fault].tip);
}

function renderVoiceButton() {
  el.voiceBtn.textContent = voiceOn() ? '🔊 Voice on' : '🔇 Voice off';
}

function recordLift(result, now) {
  touchSession(Date.now()); // a lift is activity: keep a kiosk session alive through the check
  state.scored.push(result);
  state.tipUntil = now + TIP_MS;
  renderPanel();
  const first = result.faults[0];
  el.tip.textContent = first ? FAULTS[first].tip : 'Good lift!';
  el.tip.className = `tip text-${first ? 'warn' : 'ok'}`;
  const left = LIFTS_PER_SESSION - state.scored.length;
  speak(`${result.score}. ${first ? FAULTS[first].tip : 'Good lift.'}${left > 0 ? ` ${left} to go.` : ''}`);
  if (state.scored.length >= LIFTS_PER_SESSION) go('results');
}

function drawSkeleton(lms, color) {
  const { canvas } = el;
  const seen = (i) => (lms[i].visibility ?? 0) >= 0.5;
  const px = (i) => [lms[i].x * canvas.width, lms[i].y * canvas.height];
  const unit = canvas.height / 720; // keep line weight constant whatever the camera resolution
  ctx.lineWidth = 6 * unit;
  ctx.lineCap = 'round';
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  for (const [a, b] of BONES) {
    if (!seen(a) || !seen(b)) continue;
    ctx.beginPath();
    ctx.moveTo(...px(a));
    ctx.lineTo(...px(b));
    ctx.stroke();
  }
  for (const i of JOINTS) {
    if (!seen(i)) continue;
    ctx.beginPath();
    ctx.arc(...px(i), 7 * unit, 0, Math.PI * 2);
    ctx.fill();
  }
}

// ---------- lifting panel ----------

function renderPanel() {
  const done = state.scored.length;
  el.liftCount.textContent = `Lift ${Math.min(done + 1, LIFTS_PER_SESSION)} of ${LIFTS_PER_SESSION}`;
  const dots = Array.from({ length: LIFTS_PER_SESSION }, (_, i) => {
    const dot = document.createElement('span');
    const kind = i < done ? `dot-${band(state.scored[i].score)}` : i === done ? 'dot-current' : '';
    dot.className = `dot ${kind}`.trim();
    return dot;
  });
  el.dots.replaceChildren(...dots);
  const last = state.scored[done - 1];
  el.lastScore.textContent = last ? String(last.score) : '–';
  el.lastScore.className = `last-score ${last ? `text-${band(last.score)}` : 'muted'}`;
}

// ---------- results ----------

function renderResults() {
  const summary = summariseSession(state.scored);
  state.summary = summary;
  // At the kiosk the record saves by itself and there is one way out; a guest chooses whether to save.
  if (kioskWorker) queueMicrotask(() => { saveRecord(); el.saveBtn.hidden = true; el.doneBtn.hidden = false; });
  devLog.event('session', { summary });
  const tone = band(summary.score);

  el.resultName.textContent = state.name;
  el.sessionScore.textContent = String(summary.score);
  el.sessionScore.className = `session-score text-${tone}`;
  el.verdict.textContent = summary.passed ? 'PASS' : 'NEEDS COACHING';
  el.verdict.className = `pill pill-${summary.passed ? 'ok' : tone}`;

  const items = state.scored.map((lift, i) => {
    const li = document.createElement('li');
    const n = document.createElement('span');
    n.className = 'muted';
    n.textContent = `Lift ${i + 1}`;
    const score = document.createElement('strong');
    score.className = `text-${band(lift.score)}`;
    score.textContent = String(lift.score);
    li.append(n, score);
    return li;
  });
  el.liftScores.replaceChildren(...items);
  el.measures.replaceChildren(...state.scored.map((lift, i) => {
    const tr = document.createElement('tr');
    const m = lift.measures;
    const cells = [`${i + 1}`, `${m.back}°`, `${m.knees}°`, m.reach.toFixed(2), `${m.seconds}s`, String(lift.score)];
    cells.forEach((text, c) => {
      const td = document.createElement('td');
      td.textContent = text;
      if (c === cells.length - 1) td.className = `text-${band(lift.score)}`;
      tr.append(td);
    });
    return tr;
  }));
  renderCoaching(summary);

  const fault = summary.topFault ? FAULTS[summary.topFault] : null;
  el.topFaultLabel.textContent = fault ? `Work on: ${fault.label}` : 'Clean technique on every lift.';
  el.topFaultLabel.className = `top-fault-label text-${fault ? 'warn' : 'ok'}`;
  el.topFaultTip.textContent = fault ? fault.tip : 'Knees bent, chest up, load close. Keep lifting like that.';

  el.saveBtn.disabled = false;
  el.saveBtn.textContent = 'Save record';
  el.saved.hidden = true;
}

function saveRecord() {
  if (el.saveBtn.disabled || !state.summary) return;
  el.saveBtn.disabled = true; // one click, one training record
  try {
    save(addSession(load(), state.name, { ...state.summary, lifts: state.scored }, Date.now()));
  } catch (err) {
    console.error(err);
    el.saveBtn.disabled = false;
    el.savedMsg.textContent = 'Could not save on this device. Check that browser storage is allowed. ';
    el.saved.className = 'saved text-bad';
    el.dashLink.hidden = true;
    el.saved.hidden = false;
    return;
  }
  el.saveBtn.textContent = 'Saved ✓';
  el.savedMsg.textContent = 'Saved ✓ Training record added. ';
  el.saved.className = 'saved text-ok';
  el.dashLink.hidden = false;
  el.saved.hidden = false;
}

async function tryAgain() {
  el.againBtn.disabled = true;
  try {
    await openCheck();
  } finally {
    el.againBtn.disabled = false;
  }
}

// ---------- debug readout (?debug=1) ----------

function renderDebug(m, problem) {
  const s = state.analyzer?.current ?? m;
  const f = (v, d = 0) => (v == null ? '–' : v.toFixed(d));
  el.debug.textContent = [
    `state      ${state.screen}${state.paused ? ' (paused)' : ''}`,
    `phase      ${state.analyzer?.phase ?? '–'}`,
    `trunkAngle ${f(m?.trunkAngle)}`,
    `kneeAngle  ${f(m?.kneeAngle)}`,
    `reach      ${f(m?.reach, 2)}`,
    `bend       ${f(s ? Math.max(s.trunkAngle, 180 - s.kneeAngle) : null)}`,
    `visibility ${f(m?.visibility, 2)}${m ? ` (${m.side})` : ''}`,
    `position   ${problem?.id ?? 'ok'}`,
    `lifts      ${state.scored.map((l) => l.score).join(' ') || '–'}`,
  ].join('\n');
}

// ---------- wiring ----------

el.nameInput.value = (params.get('name') ?? '').slice(0, el.nameInput.maxLength);
// Signed in at the kiosk: the name comes from the session, and finishing leads back there.
const kioskWorker = currentSession(Date.now())?.role === 'worker' ? currentSession(Date.now()) : null;
if (kioskWorker) {
  el.nameInput.value = kioskWorker.name;
  el.nameInput.readOnly = true;
  el.dashLink.href = 'worker.html';
  el.dashLink.textContent = 'Back to my training →';
  el.who.textContent = kioskWorker.name;
} else {
  // A guest cannot open the manager's dashboard, so the way out is the kiosk.
  el.dashLink.href = 'app.html';
  el.dashLink.textContent = 'Back to shift start →';
  el.who.textContent = 'Guest';
}
el.nameInput.addEventListener('input', syncStartButton);
el.nameForm.addEventListener('submit', (e) => {
  e.preventDefault();
  begin();
});
el.retryBtn.addEventListener('click', begin);
el.saveBtn.addEventListener('click', saveRecord);
el.againBtn.addEventListener('click', tryAgain);
el.voiceBtn.addEventListener('click', () => { setVoice(!voiceOn()); renderVoiceButton(); });
renderVoiceButton();
addEventListener('pagehide', stopSpeaking);
el.video.addEventListener('loadedmetadata', syncCanvasSize);
el.video.addEventListener('resize', syncCanvasSize);

el.debug.hidden = !debugOn;
syncStartButton();
go('name');
// Signed in at the kiosk: they already said who they are, so go straight to the camera.
if (kioskWorker) begin();
// Warm the model while the worker types their name; a failure is reported on Start.
getLandmarker().catch(() => {});
