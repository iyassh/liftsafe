// Summarise tmp/session-log.jsonl: what each lift measured, what was dropped, and
// how the raw signals moved, so thresholds can be tuned from real lifts.
//   node tools/analyze-log.mjs [file] [--trace]
import fs from 'node:fs';

const args = process.argv.slice(2);
const file = args.find((a) => !a.startsWith('--')) ?? 'tmp/session-log.jsonl';
const trace = args.includes('--trace');

const rows = fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).flatMap((l) => {
  try { return [JSON.parse(l)]; } catch { return []; }
});
const frames = rows.filter((r) => r.k === 'frame');
const events = rows.filter((r) => r.k === 'event');
const count = (list, key) => list.reduce((acc, r) => ({ ...acc, [key(r)]: (acc[key(r)] ?? 0) + 1 }), {});
const range = (list, f) => {
  const v = list.map(f).filter(Number.isFinite);
  return v.length ? `${Math.min(...v).toFixed(0)}–${Math.max(...v).toFixed(0)}` : '—';
};

console.log(`${frames.length} frames, ${events.length} events`);
console.log('screens:', count(frames, (r) => r.screen));
console.log('positioning status while on camera:', count(frames, (r) => r.pos));
console.log('side seen:', count(frames.filter((r) => r.side), (r) => r.side));

const lifting = frames.filter((r) => r.screen === 'lifting');
const usable = lifting.filter((r) => r.pos === 'ok');
console.log(`\nlifting screen: ${lifting.length} frames, ${usable.length} usable (${lifting.length ? Math.round(100 * usable.length / lifting.length) : 0}%)`);
console.log(`  trunk ${range(usable, (r) => r.trunk)}°  knee ${range(usable, (r) => r.knee)}°  reach ${range(usable, (r) => r.reach * 100)}% of torso`);
console.log('  not usable because:', count(lifting.filter((r) => r.pos !== 'ok'), (r) => r.pos));

console.log('\nlifts:');
for (const e of events) {
  if (e.type === 'lift') {
    const l = e.lift;
    console.log(`  #${e.n}  score ${String(e.result.score).padStart(3)}  ${(l.durationMs / 1000).toFixed(1)}s  maxTrunk ${l.maxTrunk.toFixed(0)}°  kneeAtMaxTrunk ${l.kneeAtMaxTrunk.toFixed(0)}°  minKnee ${l.minKnee.toFixed(0)}°  maxReach ${l.maxReach.toFixed(2)}  faults [${e.result.faults.join(', ')}]`);
  } else if (e.type === 'lift-dropped') console.log('  DROPPED lift (too short, or usable frames stopped mid-lift)');
  else if (e.type === 'paused') console.log(`  paused: ${e.pos}`);
  else if (e.type === 'session') console.log(`  session → ${JSON.stringify(e.summary)}`);
  else if (e.type === 'screen') console.log(`  [screen: ${e.screen}]`);
}

if (trace) {
  console.log('\ntrace (lifting screen):  t(s)  phase     pos            trunk  knee  reach  faults');
  const t0 = lifting[0]?.t ?? 0;
  for (const r of lifting) {
    console.log(`  ${((r.t - t0) / 1000).toFixed(1).padStart(5)}  ${String(r.phase).padEnd(9)} ${r.pos.padEnd(14)} ${String(r.trunk ?? '—').padStart(5)} ${String(r.knee ?? '—').padStart(5)} ${String(r.reach ?? '—').padStart(6)}  ${r.faults.join(',')}`);
  }
}
