import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  TRAININGS, TRAINING_ORDER, trainingStatus, compliance, transcript, upcoming, alerts, unreadCount,
  markAlertsRead, searchWorkers, matchesFilter,
} from '../js/training.js';
import { emptyDb, addSession, addCheckin } from '../js/store.js';

const DAY = 86400000;
const now = new Date(2026, 8, 19, 12).getTime();
const lift = (score, topFault = null) => ({ score, passed: score >= 70, topFault, lifts: [] });
const warm = (soreness = null) => ({ soreness, completed: true, movements: [] });
const only = (db) => db.workers[0];

test('the catalogue lists each training once, in order, with what the screens need', () => {
  assert.deepEqual(TRAINING_ORDER, ['liftCert', 'warmup']);
  for (const id of TRAINING_ORDER) assert.ok(TRAININGS[id].name && TRAININGS[id].blurb && TRAININGS[id].page);
});

test('lift certification: never attempted is not started', () => {
  const db = addCheckin(emptyDb(), 'Sam', warm(), now);
  const s = trainingStatus(only(db), 'liftCert', db, now);
  assert.equal(s.state, 'not-started');
  assert.equal(s.score, null);
  assert.equal(s.attempts, 0);
  assert.equal(s.dueAt, null);
});

test('lift certification: a pass is completed and valid for the interval', () => {
  const db = addSession(emptyDb(), 'Sam', lift(88), now - 10 * DAY);
  const s = trainingStatus(only(db), 'liftCert', db, now);
  assert.equal(s.state, 'completed');
  assert.equal(s.score, 88);
  assert.equal(s.completedAt, now - 10 * DAY);
  assert.equal(s.dueAt, now + 80 * DAY);
  assert.equal(s.daysLeft, 80);
});

test('lift certification: due soon inside 14 days, overdue after, and the interval is the business setting', () => {
  const db = addSession(emptyDb(), 'Sam', lift(80), now - 80 * DAY);
  assert.equal(trainingStatus(only(db), 'liftCert', db, now).state, 'due-soon');
  assert.equal(trainingStatus(only(db), 'liftCert', db, now + 11 * DAY).state, 'overdue');
  assert.equal(trainingStatus(only(db), 'liftCert', { ...db, intervalDays: 30 }, now).state, 'overdue');
});

test('lift certification: a failed latest attempt needs a retake, even after an earlier pass', () => {
  let db = addSession(emptyDb(), 'Sam', lift(85), now - 20 * DAY);
  db = addSession(db, 'Sam', lift(55, 'stoop'), now - DAY);
  const s = trainingStatus(only(db), 'liftCert', db, now);
  assert.equal(s.state, 'retake');
  assert.equal(s.score, 55);
  assert.equal(s.attempts, 2);
});

test('warm-up: completed today, due today if done before, not started if never', () => {
  const today = addCheckin(emptyDb(), 'Sam', warm(), now - 3600000);
  assert.equal(trainingStatus(only(today), 'warmup', today, now).state, 'completed');
  const yesterday = addCheckin(emptyDb(), 'Sam', warm(), now - DAY);
  assert.equal(trainingStatus(only(yesterday), 'warmup', yesterday, now).state, 'due-today');
  const never = addSession(emptyDb(), 'Sam', lift(80), now);
  assert.equal(trainingStatus(only(never), 'warmup', never, now).state, 'not-started');
});

test('compliance is the share of trainings in good standing', () => {
  let db = addSession(emptyDb(), 'Sam', lift(80), now - DAY);
  assert.equal(compliance(only(db), db, now), 50);
  db = addCheckin(db, 'Sam', warm(), now);
  assert.equal(compliance(only(db), db, now), 100);
  const none = addSession(emptyDb(), 'Ana', lift(40), now);
  assert.equal(compliance(only(none), none, now), 0);
});

test('transcript lists every attempt newest first; upcoming lists what falls due', () => {
  let db = addSession(emptyDb(), 'Sam', lift(62, 'stoop'), now - 40 * DAY);
  db = addSession(db, 'Sam', lift(88), now - 5 * DAY);
  db = addCheckin(db, 'Sam', warm('knees'), now - DAY);
  const t = transcript(only(db));
  assert.deepEqual(t.map((e) => e.trainingId), ['warmup', 'liftCert', 'liftCert']);
  assert.equal(t[0].soreness, 'knees');
  assert.deepEqual([t[1].score, t[1].passed, t[2].topFault], [88, true, 'stoop']);
  const u = upcoming(only(db), db, now);
  assert.deepEqual(u.map((e) => e.trainingId), ['warmup', 'liftCert']);
  assert.equal(u[1].dueAt, now - 5 * DAY + 90 * DAY);
});

test('alerts: recent completions, retakes, overdue, due soon and today\'s soreness, newest first', () => {
  let db = addSession(emptyDb(), 'Zuri', lift(88), now - 2 * 3600000);
  db = addSession(db, 'Bao', lift(64, 'stoop'), now - DAY);
  db = addSession(db, 'Tavita', lift(75), now - 105 * DAY);
  db = addSession(db, 'Ingrid', lift(74), now - 85 * DAY);
  db = addCheckin(db, 'Ingrid', warm('lower-back'), now - 1800000);
  db = addSession(db, 'Old', lift(90), now - 30 * DAY); // completed long ago: no alert
  const list = alerts(db, now);
  const byType = Object.fromEntries(list.map((a) => [a.type, a]));
  assert.deepEqual(new Set(list.map((a) => a.type)), new Set(['completed', 'retake', 'overdue', 'due-soon', 'soreness']));
  assert.match(byType.completed.text, /Zuri.*completed.*Lift Safety Certification.*88/);
  assert.match(byType.retake.text, /Bao.*retake.*64/);
  assert.match(byType.overdue.text, /Tavita.*15 days overdue/);
  assert.match(byType['due-soon'].text, /Ingrid.*due in 5 days/);
  assert.match(byType.soreness.text, /Ingrid.*lower back/i);
  assert.ok(list.every((a, i) => i === 0 || list[i - 1].at >= a.at), 'newest first');
  assert.ok(list.every((a) => a.id && a.worker), 'each alert names its team member and has a stable id');
  assert.ok(!list.some((a) => a.worker === 'Old'));
});

test('unread count drops to zero once marked read, and new events count again', () => {
  let db = addSession(emptyDb(), 'Zuri', lift(88), now - 3600000);
  assert.equal(unreadCount(db, now), 1);
  db = markAlertsRead(db, now);
  assert.equal(unreadCount(db, now), 0);
  db = addSession(db, 'Bao', lift(50), now + 60000);
  assert.equal(unreadCount(db, now + 120000), 1);
});

test('search matches any part of the name, every word, ignoring case and spacing', () => {
  const workers = [{ name: 'Zuri Okonkwo-Bell' }, { name: 'Bao Quillfeather' }, { name: 'Ingrid Solheimdottir' }];
  const names = (q) => searchWorkers(workers, q).map((w) => w.name);
  assert.deepEqual(names(''), workers.map((w) => w.name));
  assert.deepEqual(names('  ZUR '), ['Zuri Okonkwo-Bell']);
  assert.deepEqual(names('bell zuri'), ['Zuri Okonkwo-Bell']);
  assert.deepEqual(names('i'), workers.map((w) => w.name).filter((n) => /i/i.test(n)));
  assert.deepEqual(names('xyz'), []);
});

test('filters pick team members by training state', () => {
  let db = addSession(emptyDb(), 'Tavita', lift(75), now - 105 * DAY);
  db = addSession(db, 'Bao', lift(64), now - DAY);
  db = addCheckin(db, 'Noor', warm('knees'), now - 3600000);
  const pick = (f) => db.workers.filter((w) => matchesFilter(w, f, db, now)).map((w) => w.name);
  assert.deepEqual(pick('all'), ['Tavita', 'Bao', 'Noor']);
  assert.deepEqual(pick('overdue'), ['Tavita']);
  assert.deepEqual(pick('retake'), ['Bao']);
  assert.deepEqual(pick('not-started'), ['Noor']);
  assert.deepEqual(pick('done-today'), ['Noor']);
  assert.deepEqual(pick('soreness'), ['Noor']);
});
