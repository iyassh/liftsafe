// Kiosk: first-run setup, then "who's starting their shift?" with a PIN pad.
// One shared device, so nothing here trusts who is standing in front of it
// until a PIN checks out, and sessions are handed to auth.js.
import { load, save, setBusiness, addWorker, checkinsOf, streak } from './store.js';
import { validPin, makePin, checkPin, startSession, endSession } from './auth.js';
import { PACKS, DEFAULT_PACK } from './packs.js';
import { mergeSample, DEMO_BUSINESS, DEMO_PINS } from './sampleData.js';

const MAX_TRIES = 5;
const LOCK_MS = 30_000;

const $ = (id) => document.getElementById(id);
const newId = () => `w_${crypto.randomUUID()}`;

// Workers typed into the setup form, held until Finish: [{ id, name, pin: {salt, hash} }]
const draftTeam = [];
const pinState = { target: null, digits: '', tries: 0, lockedUntil: 0, busy: false };

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function show(screen) {
  $('screen-setup').hidden = screen !== 'setup';
  $('screen-kiosk').hidden = screen !== 'kiosk';
}

// ---------- setup ----------

function showSetupError(message) {
  $('setupError').hidden = !message;
  $('setupError').textContent = message ?? '';
}

function renderDraftTeam() {
  $('teamList').replaceChildren(...draftTeam.map((w) => {
    const li = el('li');
    const remove = el('button', 'link-btn', 'Remove');
    remove.type = 'button';
    remove.addEventListener('click', () => {
      draftTeam.splice(draftTeam.indexOf(w), 1);
      renderDraftTeam();
    });
    li.append(el('span', '', w.name), el('span', 'muted small', 'PIN set'), remove);
    return li;
  }));
}

async function addDraftWorker() {
  const name = $('newName').value.trim();
  const pin = $('newPin').value;
  if (!name) return showSetupError('Enter the worker\'s name.');
  if (!validPin(pin)) return showSetupError('A worker PIN is 4 digits.');
  if (draftTeam.some((w) => w.name.toLowerCase() === name.toLowerCase())) return showSetupError(`${name} is already on the list.`);
  draftTeam.push({ id: newId(), name, pin: await makePin(pin) });
  $('newName').value = '';
  $('newPin').value = '';
  showSetupError(null);
  renderDraftTeam();
  $('newName').focus();
}

async function finishSetup(e) {
  e.preventDefault();
  const name = $('bizName').value.trim();
  const managerPin = $('mgrPin').value;
  if (!name) return showSetupError('Enter your business name.');
  if (!validPin(managerPin)) return showSetupError('The manager PIN is 4 digits.');
  if ($('newName').value.trim()) await addDraftWorker();
  if (!draftTeam.length) return showSetupError('Add at least one worker.');
  try {
    let db = setBusiness({ ...load(), pack: $('bizPack').value }, { name, managerPin: await makePin(managerPin) });
    for (const w of draftTeam) db = addWorker(db, w);
    save(db);
  } catch (err) {
    return showSetupError(err.message);
  }
  draftTeam.length = 0;
  renderKiosk();
}

function loadDemo() {
  try {
    save({ ...mergeSample(load(), Date.now()), business: DEMO_BUSINESS });
  } catch (err) {
    return showSetupError(`Could not save to this device: ${err.message}`);
  }
  renderKiosk();
}

function initSetup() {
  $('bizPack').replaceChildren(...Object.entries(PACKS).map(([id, p]) => {
    const option = el('option', '', `${p.name} · ${p.blurb}`);
    option.value = id;
    option.selected = id === DEFAULT_PACK;
    return option;
  }));
  $('addWorkerBtn').addEventListener('click', addDraftWorker);
  $('newPin').addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    addDraftWorker();
  });
  $('setupForm').addEventListener('submit', finishSetup);
  $('loadDemo').addEventListener('click', loadDemo);
}

// ---------- kiosk ----------

const sameDay = (a, b) => new Date(a).toDateString() === new Date(b).toDateString();

function workerTile(w, now) {
  const tile = el('button', 'worker-tile');
  tile.type = 'button';
  const done = checkinsOf(w).some((c) => sameDay(c.date, now));
  const run = streak(w, now);
  tile.append(el('span', 'tile-name', w.name));
  tile.append(el('span', `tile-status ${done ? 'text-ok' : 'muted'}`, done ? '✓ Warmed up today' : 'Not yet today'));
  if (run > 1) tile.append(el('span', 'tile-streak', `🔥 ${run}`));
  tile.addEventListener('click', () => openPin({ kind: 'worker', worker: w }));
  return tile;
}

function renderKiosk() {
  const db = load();
  if (!db.business) return show('setup');
  const now = Date.now();
  const roster = db.workers.filter((w) => typeof w.id === 'string').sort((a, b) => a.name.localeCompare(b.name));
  $('bizTitle').textContent = db.business.name;
  $('workerTiles').replaceChildren(...roster.map((w) => workerTile(w, now)));
  $('noWorkers').hidden = roster.length > 0;
  $('demoNote').hidden = db.business.demo !== true;
  $('demoNote').textContent = `Demo business. Every worker's PIN is ${DEMO_PINS.worker}; the manager PIN is ${DEMO_PINS.manager}.`;
  show('kiosk');
}

function tickClock() {
  $('clock').textContent = new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

// ---------- PIN pad ----------

function renderDots() {
  [...$('pinDots').children].forEach((dot, i) => dot.classList.toggle('filled', i < pinState.digits.length));
}

function showPinError(message) {
  $('pinError').hidden = !message;
  $('pinError').textContent = message ?? '';
}

function openPin(target) {
  Object.assign(pinState, { target, digits: '', busy: false });
  $('pinPrompt').textContent = target.kind === 'manager' ? 'Manager sign-in' : 'Enter your PIN';
  $('pinWho').textContent = target.kind === 'manager' ? 'Manager PIN' : target.worker.name;
  showPinError(null);
  renderDots();
  $('pinOverlay').hidden = false;
}

function closePin() {
  $('pinOverlay').hidden = true;
  pinState.target = null;
  pinState.digits = '';
}

async function submitPin() {
  const { target, digits } = pinState;
  pinState.busy = true;
  const record = target.kind === 'manager' ? load().business?.managerPin : target.worker.pin;
  const ok = await checkPin(digits, record);
  pinState.busy = false;
  if (pinState.target !== target) return; // cancelled while hashing
  if (ok) {
    pinState.tries = 0;
    startSession(target.kind, target.worker ?? null, Date.now());
    location.href = target.kind === 'manager' ? 'dashboard.html' : 'worker.html';
    return;
  }
  pinState.digits = '';
  pinState.tries += 1;
  renderDots();
  $('pinDots').classList.remove('shake');
  void $('pinDots').offsetWidth; // restart the animation
  $('pinDots').classList.add('shake');
  if (pinState.tries >= MAX_TRIES) {
    pinState.lockedUntil = Date.now() + LOCK_MS;
    pinState.tries = 0;
    showPinError('Too many tries. Wait 30 seconds.');
  } else {
    showPinError('Wrong PIN. Try again.');
  }
}

function press(key) {
  if (!pinState.target || pinState.busy) return;
  if (Date.now() < pinState.lockedUntil) return showPinError('Too many tries. Wait a moment.');
  if (key === 'back') pinState.digits = pinState.digits.slice(0, -1);
  else if (pinState.digits.length < 4) pinState.digits += key;
  showPinError(null);
  renderDots();
  if (pinState.digits.length === 4) submitPin();
}

function initPinPad() {
  const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', 'back'];
  $('pinPad').replaceChildren(...keys.map((k) => {
    if (!k) return el('span');
    const b = el('button', 'pin-key', k === 'back' ? '⌫' : k);
    b.type = 'button';
    if (k === 'back') b.setAttribute('aria-label', 'Delete');
    b.addEventListener('click', () => press(k));
    return b;
  }));
  $('pinCancel').addEventListener('click', closePin);
  addEventListener('keydown', (e) => {
    if (!pinState.target) return;
    if (/^\d$/.test(e.key)) press(e.key);
    else if (e.key === 'Backspace') press('back');
    else if (e.key === 'Escape') closePin();
  });
}

// ---------- start ----------

endSession(); // arriving at the kiosk always signs the last person out
initSetup();
initPinPad();
$('managerBtn').addEventListener('click', () => openPin({ kind: 'manager' }));
renderKiosk();
tickClock();
setInterval(tickClock, 15_000);
addEventListener('pageshow', (e) => { if (e.persisted) { endSession(); renderKiosk(); } });
if (new URLSearchParams(location.search).get('manager') === '1' && load().business) openPin({ kind: 'manager' });
