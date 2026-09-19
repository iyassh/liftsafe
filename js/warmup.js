import { createLandmarker, startPoseCamera, drawSkeleton } from './poseCamera.js';
import { computeMetrics } from './engine/poseMetrics.js';
import { checkPosition } from './engine/positioning.js';
import { MOVEMENTS, MovementTracker } from './engine/movements.js';
import { PACKS, DEFAULT_PACK } from './packs.js';
import { devLog, devFlag } from './devLog.js';
import { load, save, addCheckin, streak } from './store.js';

const READY_HOLD_MS = 1500; // position must be good this long before the first movement
const READY_SHOW_MS = 700; // how long "✓ Ready" stays up
const PAUSE_AFTER_MS = 2000; // body out of view this long mid-movement shows the positioning message
const DONE_SHOW_MS = 1000; // how long "✓ Done" stays up between movements
const CUE_AFTER_MS = 400; // arms passing through the part-way zone on the way up are not a fault
const FRAME_GAP_MS = 500; // longer than this between frames and the timers start over
const SCREENS = ['name', 'soreness', 'positioning', 'movement', 'done'];
const COLOR = { ok: '#34c759', warn: '#ffcc00' };
const VOICE_KEY = 'liftsafe.voice';
const SORENESS_NOTE = 'Your supervisor sees this so they can help.';

const params = new URLSearchParams(location.search);
const testVideoUrl = params.get('video');
const debugOn = devFlag('debug');

const $ = (id) => document.getElementById(id);
const el = {
  main: $('warmup'), stage: $('stage'), video: $('cam'), canvas: $('overlay'), stageMsg: $('stageMsg'),
  packLine: $('packLine'), nameForm: $('nameForm'), nameInput: $('workerName'), startBtn: $('startBtn'),
  startError: $('startError'), startErrorMsg: $('startErrorMsg'), retryBtn: $('retryBtn'),
  sorenessOptions: $('sorenessOptions'), sorenessNote: $('sorenessNote'),
  moveStep: $('moveStep'), moveName: $('moveName'), moveInstruction: $('moveInstruction'),
  repsProgress: $('repsProgress'), repCount: $('repCount'), dots: $('dots'),
  holdProgress: $('holdProgress'), holdSeconds: $('holdSeconds'), holdFill: $('holdFill'),
  skipBtn: $('skipBtn'), voiceBtn: $('voiceBtn'),
  doneName: $('doneName'), doneTime: $('doneTime'), doneStreak: $('doneStreak'), doneMoves: $('doneMoves'),
  saveError: $('saveError'), retrySaveBtn: $('retrySaveBtn'), liftLink: $('liftLink'),
  debug: $('debug'),
};
const ctx = el.canvas.getContext('2d');

const pack = PACKS[load().pack] ?? PACKS[DEFAULT_PACK];
const movementIds = pack.warmup.filter((id) => MOVEMENTS[id]);

// Everything that changes during a warm-up lives here; go() is the only place the screen changes.
const state = {
  screen: 'name',
  name: '',
  soreness: null,
  camera: null,
  opening: false, // a model load or camera request is in flight
  index: 0, // which movement of the pack is running
  tracker: null,
  results: [],
  movementStartedAt: 0,
  finishing: false, // "✓ Done" is up; the next movement is on a timer
  nextTimer: 0,
  goodSince: null, // positioning: when checkPosition first came back clean
  badSince: null, // movement: when the body first went out of view
  paused: false,
  cueSince: null,
  spokenCue: null,
  lastFrameAt: 0,
  checkedInAt: 0,
  saved: false,
  voiceOn: readVoicePref(),
};

window.__liftsafe = {
  get state() { return state.screen; },
  get results() { return state.results; },
};

// ---------- screens ----------

function go(screen) {
  const leavingCamera = screen === 'done' || screen === 'name';
  if (leavingCamera) stopCamera();
  clearTimeout(state.nextTimer);
  state.screen = screen;
  devLog.event('screen', { screen, movement: screen === 'movement' ? currentSpec().id : undefined });
  for (const s of SCREENS) $(`screen-${s}`).hidden = s !== screen;
  el.stage.hidden = screen !== 'positioning' && screen !== 'movement';
  el.main.dataset.screen = screen;
  setStageMsg(null);

  if (screen === 'positioning') resetRun();
  if (screen === 'done') renderDone();
}

function resetRun() {
  state.index = 0;
  state.tracker = null;
  state.results = [];
  state.finishing = false;
  state.goodSince = null;
  state.badSince = null;
  state.paused = false;
  state.saved = false;
}

function setStageMsg(text, tone = 'warn') {
  el.stageMsg.hidden = !text;
  if (!text) return;
  if (el.stageMsg.textContent !== text) el.stageMsg.textContent = text;
  el.stageMsg.className = `stage-msg text-${tone}`;
}

// ---------- voice ----------

function readVoicePref() {
  try {
    return localStorage.getItem(VOICE_KEY) !== 'off';
  } catch {
    return true;
  }
}

function speak(text) {
  if (!state.voiceOn) return;
  try {
    const synth = window.speechSynthesis;
    if (!synth || typeof SpeechSynthesisUtterance !== 'function') return;
    synth.cancel();
    synth.speak(new SpeechSynthesisUtterance(text));
  } catch (err) {
    console.warn('Voice unavailable', err);
  }
}

function renderVoiceButton() {
  el.voiceBtn.textContent = state.voiceOn ? '🔊 Voice on' : '🔇 Voice off';
  el.voiceBtn.setAttribute('aria-pressed', String(state.voiceOn));
}

function toggleVoice() {
  state.voiceOn = !state.voiceOn;
  try {
    if (!state.voiceOn) window.speechSynthesis?.cancel();
    localStorage.setItem(VOICE_KEY, state.voiceOn ? 'on' : 'off');
  } catch {
    // The choice still holds for this visit.
  }
  renderVoiceButton();
}

// ---------- name screen ----------

function renderPackLine() {
  const names = movementIds.map((id) => MOVEMENTS[id].name);
  el.packLine.textContent = [`${pack.name} warm-up`, ...names, 'about 3 minutes'].join(' · ');
}

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

function begin() {
  syncStartButton();
  if (!state.name) return;
  showStartError(null);
  go('soreness');
}

// ---------- soreness screen ----------

// The camera opens only after this answer, so the question is never rushed by a live video.
function chooseSoreness(area) {
  if (state.opening) return;
  state.soreness = area || null;
  openWarmup();
}

function setOpening(opening) {
  state.opening = opening;
  for (const btn of el.sorenessOptions.querySelectorAll('button')) btn.disabled = opening;
  el.retryBtn.disabled = opening;
  el.sorenessNote.textContent = opening ? 'Starting the camera…' : SORENESS_NOTE;
}

// Loads the model, opens the source and moves to positioning. On failure the worker lands
// on the name screen with a message and Retry (which keeps their soreness answer).
async function openWarmup() {
  // A second click while the camera prompt is up would open, and leak, a second stream.
  if (state.opening) return;
  syncStartButton();
  if (!state.name) return;
  setOpening(true);
  showStartError(null);
  try {
    await openSourceAndStart();
  } finally {
    setOpening(false);
  }
}

async function openSourceAndStart() {
  try {
    await createLandmarker();
  } catch (err) {
    console.error(err);
    go('name');
    showStartError('Could not load the pose model. Check that the vendor/mediapipe folder is being served, then press Retry.');
    return;
  }
  stopCamera();
  try {
    state.camera = await startPoseCamera({
      video: el.video, canvas: el.canvas, onFrame, onLost: onCameraLost, testVideoUrl,
    });
  } catch (err) {
    console.error(err);
    go('name');
    showStartError(cameraErrorMessage(err));
    return;
  }
  go('positioning');
}

function stopCamera() {
  state.camera?.stop();
  state.camera = null;
}

function onCameraLost() {
  if (state.screen !== 'positioning' && state.screen !== 'movement') return;
  go('name');
  showStartError('The camera stopped. Reconnect it, then press Retry.');
}

// ---------- frames ----------

function onFrame(lms, now, aspect) {
  if (state.screen !== 'positioning' && state.screen !== 'movement') return;
  const problem = checkPosition(lms, aspect);
  const m = lms ? computeMetrics(lms, aspect) : null;
  // After a hidden tab or a stall the hold and pause timers would count time nobody was watched.
  if (now - state.lastFrameAt > FRAME_GAP_MS) {
    state.goodSince = null;
    state.badSince = null;
  }
  state.lastFrameAt = now;
  const movementId = state.screen === 'movement' ? currentSpec().id : undefined;
  const tone = state.screen === 'positioning'
    ? framePositioning(problem, now)
    // Once in position, only an unseeable body stops tracking. The stricter checks misfire on
    // a worker who is squatting, hinging or has their arms up.
    : frameMovement(m, m?.visible ? null : problem, now);

  ctx.clearRect(0, 0, el.canvas.width, el.canvas.height);
  if (lms) drawSkeleton(ctx, el.canvas, lms, COLOR[tone]);
  if (debugOn) renderDebug(m, problem);
  devLog.frame(now, state.screen, movementId, m, problem, []);
}

function framePositioning(problem, now) {
  if (problem) {
    state.goodSince = null;
    setStageMsg(problem.message, 'warn');
    return 'warn';
  }
  state.goodSince ??= now;
  const held = now - state.goodSince;
  if (held >= READY_HOLD_MS + READY_SHOW_MS) startMovement(0);
  else if (held >= READY_HOLD_MS) setStageMsg('✓ Ready', 'ok');
  else setStageMsg('Hold it there…', 'ok');
  return 'ok';
}

function frameMovement(m, problem, now) {
  if (state.finishing) return 'ok';
  if (problem) {
    // A short blip is ignored. The tracker drops a half-done rep or hold by itself
    // once it has gone a second without a usable frame.
    state.badSince ??= now;
    if (!state.paused && now - state.badSince > PAUSE_AFTER_MS) {
      state.paused = true;
      devLog.event('paused', { pos: problem.id });
    }
    setStageMsg(state.paused ? problem.message : null, 'warn');
    return 'warn';
  }
  state.badSince = null;
  state.paused = false;

  const status = state.tracker.update(m, now);
  renderProgress(status);
  if (status.done) {
    finishMovement(state.tracker.result());
    return 'ok';
  }
  const cue = settledCue(status.cue, now);
  setStageMsg(cue, 'warn');
  if (cue && cue !== state.spokenCue) speak(cue);
  state.spokenCue = cue;
  return cue ? 'warn' : 'ok';
}

function settledCue(cue, now) {
  if (!cue) {
    state.cueSince = null;
    return null;
  }
  state.cueSince ??= now;
  return now - state.cueSince >= CUE_AFTER_MS ? cue : null;
}

// ---------- movements ----------

const currentSpec = () => MOVEMENTS[movementIds[state.index]];

function startMovement(index) {
  if (index >= movementIds.length) {
    go('done');
    return;
  }
  state.index = index;
  state.tracker = new MovementTracker(currentSpec());
  state.movementStartedAt = performance.now();
  state.finishing = false;
  state.badSince = null;
  state.paused = false;
  state.cueSince = null;
  state.spokenCue = null;
  go('movement');
  renderMovement();
  speak(currentSpec().instruction);
}

function finishMovement(result) {
  if (state.finishing) return; // Skip pressed twice, or pressed as the last rep landed
  state.finishing = true;
  state.results.push(result);
  devLog.event('movement', { n: state.results.length, result });
  el.skipBtn.disabled = true;
  if (result.completed) setStageMsg('✓ Done', 'ok');
  else setStageMsg(null);
  state.nextTimer = setTimeout(() => startMovement(state.index + 1), result.completed ? DONE_SHOW_MS : 0);
}

// A worker who cannot do a movement is never stuck: this is coaching, not a gate.
function skipMovement() {
  if (state.screen !== 'movement' || state.finishing) return;
  const durationMs = Math.round(performance.now() - state.movementStartedAt);
  finishMovement({ id: currentSpec().id, completed: false, quality: 0, durationMs });
}

function renderMovement() {
  const spec = currentSpec();
  el.moveStep.textContent = `Movement ${state.index + 1} of ${movementIds.length}`;
  el.moveName.textContent = spec.name;
  el.moveInstruction.textContent = spec.instruction;
  el.repsProgress.hidden = spec.kind !== 'reps';
  el.holdProgress.hidden = spec.kind !== 'hold';
  el.skipBtn.disabled = false;
  renderProgress(state.tracker.status());
}

function renderProgress(status) {
  if (currentSpec().kind === 'reps') renderReps(status);
  else renderHold(status);
}

function renderReps({ count, target }) {
  const text = `${count} / ${target}`;
  if (el.repCount.textContent === text && el.dots.childElementCount === target) return;
  el.repCount.textContent = text;
  const dots = Array.from({ length: target }, (_, i) => {
    const dot = document.createElement('span');
    const kind = i < count ? 'dot-ok' : i === count ? 'dot-current' : '';
    dot.className = `dot ${kind}`.trim();
    return dot;
  });
  el.dots.replaceChildren(...dots);
}

function renderHold({ target, progress }) {
  const seconds = String(Math.ceil(((1 - progress) * target) / 1000));
  if (el.holdSeconds.textContent !== seconds) el.holdSeconds.textContent = seconds;
  el.holdFill.style.width = `${(progress * 100).toFixed(1)}%`;
  el.holdProgress.classList.toggle('holding', progress > 0);
}

// ---------- done ----------

function renderDone() {
  state.checkedInAt = Date.now();
  el.doneName.textContent = state.name;
  const time = new Date(state.checkedInAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  el.doneTime.textContent = `Checked in at ${time}`;
  el.liftLink.href = `check.html?name=${encodeURIComponent(state.name)}`;

  const items = state.results.map((result) => {
    const li = document.createElement('li');
    const name = document.createElement('span');
    name.textContent = MOVEMENTS[result.id].name;
    const mark = document.createElement('strong');
    mark.className = result.completed ? 'text-ok' : 'muted';
    mark.textContent = result.completed ? '✓' : 'skipped';
    li.append(name, mark);
    return li;
  });
  el.doneMoves.replaceChildren(...items);

  saveCheckin();
  speak('Shift ready');
}

// Runs once on entering the done screen; Retry save runs it again only if that attempt failed.
function saveCheckin() {
  if (state.saved) return;
  const checkin = {
    soreness: state.soreness,
    completed: state.results.length > 0 && state.results.every((r) => r.completed),
    movements: state.results,
  };
  let worker;
  try {
    const before = load();
    const after = addCheckin(before, state.name, checkin, state.checkedInAt);
    save(after);
    // The store folds spacing and case in names, so find the record it touched rather than
    // matching on the typed name: addCheckin replaces only that worker's object.
    worker = after.workers.find((w, i) => w !== before.workers[i]);
  } catch (err) {
    console.error(err);
    el.doneStreak.textContent = '';
    el.saveError.hidden = false;
    return;
  }
  state.saved = true;
  el.saveError.hidden = true;
  devLog.event('checkin', { checkin });
  if (worker) el.doneName.textContent = worker.name; // as the dashboard will list them
  const n = worker ? streak(worker, state.checkedInAt) : 1;
  el.doneStreak.textContent = n > 1 ? `🔥 ${n} shifts in a row` : 'First check-in. Nice start.';
}

// ---------- debug readout (?debug=1) ----------

function renderDebug(m, problem) {
  const f = (v, d = 0) => (Number.isFinite(v) ? v.toFixed(d) : '–');
  const spec = state.screen === 'movement' ? currentSpec() : null;
  const status = spec ? state.tracker.status() : null;
  el.debug.textContent = [
    `state      ${state.screen}${state.paused ? ' (paused)' : ''}`,
    `movement   ${spec?.id ?? '–'}`,
    `signal     ${f(spec && m ? spec.signal(m) : null)}`,
    `count      ${status ? `${status.count} / ${status.target}` : '–'}`,
    `progress   ${f(status?.progress, 2)}`,
    `cue        ${status?.cue ?? '–'}`,
    `visibility ${f(m?.visibility, 2)}${m ? ` (${m.side})` : ''}`,
    `position   ${problem?.id ?? 'ok'}`,
  ].join('\n');
}

// ---------- wiring ----------

el.nameInput.value = (params.get('name') ?? '').slice(0, el.nameInput.maxLength);
el.nameInput.addEventListener('input', syncStartButton);
el.nameForm.addEventListener('submit', (e) => {
  e.preventDefault();
  begin();
});
el.retryBtn.addEventListener('click', openWarmup);
el.sorenessOptions.addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-area]');
  if (btn) chooseSoreness(btn.dataset.area);
});
el.skipBtn.addEventListener('click', skipMovement);
el.voiceBtn.addEventListener('click', toggleVoice);
el.retrySaveBtn.addEventListener('click', saveCheckin);

el.debug.hidden = !debugOn;
renderPackLine();
renderVoiceButton();
syncStartButton();
go('name');
// Warm the model while the worker types their name; a failure is reported when the camera opens.
createLandmarker().catch(() => {});
