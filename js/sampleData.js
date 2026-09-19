// Demo records for the supervisor dashboard. Every worker is flagged `sample: true`
// so the UI can tag the rows and remove them without touching real records.
// Dates are offsets from `now`, so the mix of statuses looks the same on any day.
const DAY = 86400000;
const HOUR = 3600000;

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

const worker = (name, sessions) => ({ name, sample: true, sessions });

// With the default 90-day interval: Tavita is overdue, Ingrid is due soon, the rest are current.
export function sampleWorkers(now) {
  return [
    worker('Zuri Okonkwo-Bell', [
      session(now, 150, 58, 'stoop'),
      session(now, 75, 71, 'trunk'),
      session(now, 12, 88),
    ]),
    worker('Tavita Moana', [
      session(now, 210, 61, 'stoop'),
      session(now, 104, 66, 'stoop'),
    ]),
    worker('Ingrid Solheimdottir', [
      session(now, 172, 68, 'trunk'),
      session(now, 82, 74, 'trunk'),
    ]),
    worker('Bao Quillfeather', [
      session(now, 120, 82),
      session(now, 30, 64, 'reach'),
    ]),
    worker('Mirela Vantongeren', [
      session(now, 5, 93),
    ]),
  ];
}
