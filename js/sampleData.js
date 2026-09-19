// Demo records for the supervisor dashboard. Every worker is flagged `sample: true`
// so the UI can tag the rows and remove them without touching real records.
// Dates are offsets from `now`, so the mix of statuses looks the same on any day.
import { checkinsOf } from './store.js';

import { PACKS, DEFAULT_PACK } from './packs.js';

const DAY = 86400000;
const HOUR = 3600000;
const MINUTE = 60000;

// Spread around the session score, sums to zero so the lifts average back to it.
const LIFT_OFFSETS = [-4, 3, 0, 5, -4];

const clamp = (n) => Math.max(0, Math.min(100, n));

function lifts(score, topFault) {
  return LIFT_OFFSETS.map((d) => ({
    score: clamp(score + d),
    faults: topFault && d <= 0 ? [topFault] : [],
  }));
}

function session(now, daysAgo, score, topFault = null) {
  return {
    date: now - daysAgo * DAY - 3 * HOUR,
    score,
    passed: score >= 70,
    topFault,
    lifts: lifts(score, topFault),
    // Marked per session too: a real recheck saved under a sample name must survive "Clear sample data".
    sample: true,
  };
}

// Calendar arithmetic rather than `now - n * DAY`: across a clock change that can land on the wrong day.
function localTime(now, daysAgo, hour = 0, minute = 0) {
  const d = new Date(now);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() - daysAgo, hour, minute).getTime();
}

const isWeekend = (ms) => [0, 6].includes(new Date(ms).getDay());

function movements(quality) {
  return PACKS[DEFAULT_PACK].warmup.map((id, i) => ({
    id,
    completed: true,
    quality: Math.round((quality - 0.04 * i) * 100) / 100,
    durationMs: 21000 + 4000 * i,
  }));
}

// Day 0 is stamped a few minutes back but never before midnight, so it is still "today" at 00:01.
function checkin(now, daysAgo, soreness = null) {
  const date = daysAgo === 0
    ? Math.max(localTime(now, 0), now - 5 * MINUTE)
    : localTime(now, daysAgo, 6, 40 + daysAgo);
  return { date, soreness, completed: true, movements: movements(0.92 - 0.01 * (daysAgo % 5)), sample: true };
}

const checkins = (now, daysAgo, sorenessToday = null) => [...daysAgo]
  .sort((a, b) => b - a)
  .map((d) => checkin(now, d, d === 0 ? sorenessToday : null));

// Today plus every weekday in the eleven days before it: weekends off must not break the streak.
function weekdayRun(now) {
  const back = Array.from({ length: 11 }, (_, i) => i + 1).filter((d) => !isWeekend(localTime(now, d)));
  return [0, ...back];
}

// Demo sign-in. Everyone on the demo roster uses worker PIN 1234; the demo manager PIN is 9999.
// Both are shown on the kiosk while the demo business is loaded.
export const DEMO_PINS = { worker: '1234', manager: '9999' };
const DEMO_WORKER_PIN = { salt: 'demo-worker', hash: 'a8d666225679c565e5ba4fd495f6a6168265ea275a8d326d43f1b84431cc183d' };
const DEMO_MANAGER_PIN = { salt: 'demo-manager', hash: 'e43957dd0d6e41c0609ead1c7b7d4a0529674ca3a97443a77394bebeecdb8d22' };
export const DEMO_BUSINESS = { name: 'Hillside Movers (demo)', managerPin: DEMO_MANAGER_PIN, demo: true };

const slug = (name) => name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
const worker = (name, sessions, checkins) => ({
  id: `demo-${slug(name)}`, name, pin: DEMO_WORKER_PIN, sample: true, sessions, checkins,
});

// With the default 90-day interval: Tavita is overdue, Ingrid is due soon, Noor has only warmed up
// and is not certified, the rest are current. Tavita has not warmed up this week; Bao not today.
export function sampleWorkers(now) {
  return [
    worker('Zuri Okonkwo-Bell', [
      session(now, 150, 58, 'stoop'),
      session(now, 75, 71, 'trunk'),
      session(now, 12, 88),
    ], checkins(now, weekdayRun(now))),
    worker('Tavita Moana', [
      session(now, 210, 61, 'stoop'),
      session(now, 104, 66, 'stoop'),
    ], checkins(now, [9, 10])),
    worker('Ingrid Solheimdottir', [
      session(now, 172, 68, 'trunk'),
      session(now, 82, 74, 'trunk'),
    ], checkins(now, [0, 1, 2], 'lower-back')),
    worker('Bao Quillfeather', [
      session(now, 120, 82),
      session(now, 30, 64, 'reach'),
    ], checkins(now, [1, 3])),
    worker('Mirela Vantongeren', [
      session(now, 5, 93),
    ], checkins(now, [0, 1, 2, 3, 4])),
    worker('Noor Castellanos', [], checkins(now, [0, 1])),
  ];
}

// ---------- loading and clearing sample data ----------

const norm = (name) => name.trim().toLowerCase();

// Sample dates are relative to `now`, so loading again replaces the made-up records
// rather than skipping names already present: yesterday's sample rows would otherwise
// go stale. Real records on a sample worker are kept and merged in date order.
export function mergeSample(db, now) {
  const kept = withoutSample(db).workers;
  const byDate = (a, b) => a.date - b.date;
  const merged = sampleWorkers(now).map((s) => {
    const real = kept.find((w) => norm(w.name) === norm(s.name));
    if (!real) return s;
    return {
      ...s,
      sessions: [...s.sessions, ...real.sessions].sort(byDate),
      checkins: [...checkinsOf(s), ...checkinsOf(real)].sort(byDate),
    };
  });
  const sampleNames = new Set(merged.map((w) => norm(w.name)));
  return { ...db, workers: [...kept.filter((w) => !sampleNames.has(norm(w.name))), ...merged] };
}

// A Recheck or a warm-up on a sample row appends a real record to that worker. Keep those:
// drop only the made-up sessions and check-ins, and the sample flag with them.
function realPart(w) {
  if (w.sample !== true) return w;
  const sessions = (w.sessions ?? []).filter((s) => s.sample !== true);
  const checkins = checkinsOf(w).filter((c) => c.sample !== true);
  // Real records stay with the person, so they can still sign in afterwards.
  return sessions.length + checkins.length ? { id: w.id, name: w.name, pin: w.pin, sessions, checkins } : null;
}

export const withoutSample = (db) => ({ ...db, workers: (db.workers ?? []).map(realPart).filter(Boolean) });
