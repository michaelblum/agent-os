import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createUndoBuffer } from '../../apps/sigil/studio/js/undo-buffer.js';

test('record then undo returns the snapshot', () => {
  const u = createUndoBuffer({ capacity: 20 });
  u.record('alice', { shape: 6 });
  const popped = u.undo('alice');
  assert.deepEqual(popped.appearance, { shape: 6 });
});

test('per-agent isolation', () => {
  const u = createUndoBuffer();
  u.record('alice', { shape: 6 });
  u.record('bob', { shape: 8 });
  assert.equal(u.undo('alice').appearance.shape, 6);
  assert.equal(u.undo('bob').appearance.shape, 8);
});

test('capacity cap drops oldest', () => {
  const u = createUndoBuffer({ capacity: 3 });
  for (let i = 0; i < 5; i++) u.record('alice', { shape: i });
  assert.equal(u.undo('alice').appearance.shape, 4);
  assert.equal(u.undo('alice').appearance.shape, 3);
  assert.equal(u.undo('alice').appearance.shape, 2);
  assert.equal(u.undo('alice'), null);
});

test('canUndo reflects state', () => {
  const u = createUndoBuffer();
  assert.equal(u.canUndo('alice'), false);
  u.record('alice', { shape: 6 });
  assert.equal(u.canUndo('alice'), true);
  u.undo('alice');
  assert.equal(u.canUndo('alice'), false);
});

test('meta roundtrips', () => {
  const u = createUndoBuffer();
  u.record('alice', { shape: 6 }, { seed: 42, scope: 'shape' });
  const e = u.undo('alice');
  assert.equal(e.meta.seed, 42);
  assert.equal(e.meta.scope, 'shape');
});
