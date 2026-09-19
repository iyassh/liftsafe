// Demo records for the supervisor dashboard. Every worker is flagged `sample: true`
// so the UI can tag the rows and remove them without touching real records.
// Dates are offsets from `now`, so the mix of statuses looks the same on any day.
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

const worker = (name, sessions, checkins) => ({ name, sample: true, sessions, checkins });

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
