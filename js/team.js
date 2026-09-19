// Manager's team and settings page. Rebuilt from load() after every change, like the dashboard.
import { load, save, addWorker, removeWorker, setWorkerPin, exportCsv, checkinsOf } from './store.js';
import { requireRole, keepAlive, endSession, validPin, makePin } from './auth.js';
import { PACKS, DEFAULT_PACK } from './packs.js';
import { searchWorkers } from './training.js';

const CONFIRM_MS = 4000;
const $ = (id) => document.getElementById(id);
const newId = () => `w_${crypto.randomUUID()}`;

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function showError(id, message) {
  $(id).hidden = !message;
  $(id).textContent = message ?? '';
}

// First click arms the button, a second click within a few seconds confirms.
// (Not window.confirm: a kiosk should never be stuck behind a browser dialog.)
function confirmButton(label, armedLabel, onConfirm) {
  const b = el('button', 'link-btn', label);
  b.type = 'button';
  let timer = null;
  b.addEventListener('click', () => {
    if (timer === null) {
      b.textContent = armedLabel;
      b.classList.add('text-bad');
      timer = setTimeout(() => { timer = null; b.textContent = label; b.classList.remove('text-bad'); }, CONFIRM_MS);
      return;
    }
    clearTimeout(timer);
    onConfirm();
  });
  return b;
}

function resetPinControl(worker) {
  const wrap = el('span', 'add-row');
  const input = el('input', 'pin-input');
  Object.assign(input, { type: 'text', inputMode: 'numeric', maxLength: 4, placeholder: 'New PIN', autocomplete: 'off' });
  input.setAttribute('aria-label', `New PIN for ${worker.name}`);
  const set = el('button', 'link-btn', 'Set PIN');
  set.type = 'button';
  set.addEventListener('click', async () => {
    if (!validPin(input.value)) return showError('teamError', 'A PIN is 4 digits.');
    save(setWorkerPin(load(), worker.id, await makePin(input.value)));
    showError('teamError', null);
    set.textContent = 'PIN updated ✓';
    input.value = '';
  });
  wrap.append(input, set);
  return wrap;
}

function renderRoster(db) {
  const roster = db.workers.filter((w) => typeof w.id === 'string').sort((a, b) => a.name.localeCompare(b.name));
  const shown = searchWorkers(roster, $('findMember').value);
  $('noMatch').hidden = shown.length > 0 || roster.length === 0;
  $('roster').replaceChildren(...shown.map((w) => {
    const li = el('li');
    const records = w.sessions.length + checkinsOf(w).length;
    const who = el('span', 'who', w.name);
    if (w.sample) who.append(' ', el('span', 'muted small', 'demo'));
    const remove = confirmButton('Remove', records ? `Remove and delete ${records} records?` : 'Click again to remove', () => {
      save(removeWorker(load(), w.id));
      render();
    });
    li.append(who, resetPinControl(w), remove);
    return li;
  }));
  $('noRoster').hidden = roster.length > 0;
}

function renderSettings(db) {
  $('bizLine').textContent = db.business?.name ?? '';
  $('bizName').value = db.business?.name ?? '';
  $('bizPack').replaceChildren(...Object.entries(PACKS).map(([id, p]) => {
    const option = el('option', '', `${p.name} · ${p.blurb}`);
    option.value = id;
    option.selected = id === (PACKS[db.pack] ? db.pack : DEFAULT_PACK);
    return option;
  }));
  $('interval').value = String([30, 60, 90, 180].includes(db.intervalDays) ? db.intervalDays : 90);
}

function render() {
  const db = load();
  renderRoster(db);
  renderSettings(db);
  $('team').hidden = false;
}

async function addFromForm(e) {
  e.preventDefault();
  const name = $('newName').value;
  const pin = $('newPin').value;
  if (!validPin(pin)) return showError('teamError', 'A PIN is 4 digits.');
  try {
    save(addWorker(load(), { id: newId(), name, pin: await makePin(pin) }));
  } catch (err) {
    return showError('teamError', err.message);
  }
  showError('teamError', null);
  $('newName').value = '';
  $('newPin').value = '';
  render();
}

async function saveSettings(e) {
  e.preventDefault();
  const db = load();
  const name = $('bizName').value.trim();
  const newPin = $('mgrPin').value;
  if (!name) return showError('settingsError', 'Enter your business name.');
  if (newPin && !validPin(newPin)) return showError('settingsError', 'The manager PIN is 4 digits.');
  const managerPin = newPin ? await makePin(newPin) : db.business?.managerPin;
  try {
    save({
      ...db,
      business: { ...db.business, name, managerPin }, // spread keeps the demo flag
      pack: $('bizPack').value,
      intervalDays: Number($('interval').value),
    });
  } catch (err) {
    return showError('settingsError', `Could not save: ${err.message}`);
  }
  showError('settingsError', null);
  $('mgrPin').value = '';
  $('settingsSaved').hidden = false;
  setTimeout(() => { $('settingsSaved').hidden = true; }, 2500);
  render();
}

function downloadCsv() {
  const url = URL.createObjectURL(new Blob([exportCsv(load())], { type: 'text/csv' }));
  const a = Object.assign(document.createElement('a'), { href: url, download: `liftsafe-records-${new Date().toISOString().slice(0, 10)}.csv` });
  document.body.append(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

if (requireRole(['manager'])) {
  keepAlive();
  $('signOut').addEventListener('click', () => { endSession(); location.replace('app.html'); });
  $('addForm').addEventListener('submit', addFromForm);
  $('settingsForm').addEventListener('submit', saveSettings);
  $('exportBtn').addEventListener('click', downloadCsv);
  $('findMember').addEventListener('input', () => renderRoster(load()));
  render();
}
