import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSeedHistory } from '../../apps/sigil/studio/js/seed-history.js';

test('push adds entries in temporal order (newest first)', () => {
  const h = createSeedHistory({ capacity: 4 });
  h.push({ seed: 1, scope: 'all' });
  h.push({ seed: 2, scope: 'shape' });
  const entries = h.entries();
  assert.equal(entries.length, 2);
  assert.equal(entries[0].seed, 2);
  assert.equal(entries[1].seed, 1);
  assert.ok(entries[0].timestamp >= entries[1].timestamp);
});

test('capacity is enforced; oldest drops', () => {
  const h = createSeedHistory({ capacity: 3 });
  for (let i = 0; i < 5; i++) h.push({ seed: i, scope: 'all' });
  const seeds = h.entries().map(e => e.seed);
  assert.deepEqual(seeds, [4, 3, 2]);
});

test('duplicate consecutive seeds collapse', () => {
  const h = createSeedHistory({ capacity: 4 });
  h.push({ seed: 1, scope: 'all' });
  h.push({ seed: 1, scope: 'all' });
  h.push({ seed: 2, scope: 'all' });
  assert.deepEqual(h.entries().map(e => e.seed), [2, 1]);
});

test('clear empties the buffer', () => {
  const h = createSeedHistory({ capacity: 4 });
  h.push({ seed: 1, scope: 'all' });
  h.clear();
  assert.equal(h.entries().length, 0);
});
