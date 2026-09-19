import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PACKS, COMING_SOON, DEFAULT_PACK } from '../js/packs.js';
import { MOVEMENTS } from '../js/engine/movements.js';

test('every pack only uses movements that exist', () => {
  for (const pack of Object.values(PACKS)) {
    assert.ok(pack.name && pack.blurb);
    assert.ok(pack.warmup.length >= 2);
    for (const id of pack.warmup) assert.ok(MOVEMENTS[id], `unknown movement ${id}`);
  }
});

test('the default pack exists, and coming-soon modules are labelled', () => {
  assert.ok(PACKS[DEFAULT_PACK]);
  for (const m of COMING_SOON) assert.ok(m.name && m.blurb);
});
