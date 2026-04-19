import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createMarksState,
  applySnapshot,
  evictCanvas,
  sweepExpired,
} from '../../packages/toolkit/components/canvas-inspector/marks/reconcile.js';

const mark = (id, extra = {}) => ({ id, x: 0, y: 0, w: 20, h: 20, color: '#fff', name: id, rect: true, ellipse: true, cross: true, ...extra });

test('applySnapshot stores normalized marks keyed by canvas id', () => {
  const s = createMarksState();
  applySnapshot(s, 'cv-1', [mark('a'), mark('b')], 1000);
  const entry = s.marksByCanvas.get('cv-1');
  assert.equal(entry.marks.length, 2);
  assert.equal(entry.lastSeenAt, 1000);
});

test('applySnapshot with empty list deletes the canvas entry', () => {
  const s = createMarksState();
  applySnapshot(s, 'cv-1', [mark('a')], 1000);
  applySnapshot(s, 'cv-1', [], 2000);
  assert.equal(s.marksByCanvas.has('cv-1'), false);
});

test('applySnapshot replaces prior marks (no accumulation)', () => {
  const s = createMarksState();
  applySnapshot(s, 'cv-1', [mark('a'), mark('b')], 1000);
  applySnapshot(s, 'cv-1', [mark('c')], 2000);
  const entry = s.marksByCanvas.get('cv-1');
  assert.equal(entry.marks.length, 1);
  assert.equal(entry.marks[0].id, 'c');
  assert.equal(entry.lastSeenAt, 2000);
});

test('evictCanvas drops the entry', () => {
  const s = createMarksState();
  applySnapshot(s, 'cv-1', [mark('a')], 1000);
  applySnapshot(s, 'cv-2', [mark('b')], 1000);
  evictCanvas(s, 'cv-1');
  assert.equal(s.marksByCanvas.has('cv-1'), false);
  assert.equal(s.marksByCanvas.has('cv-2'), true);
});

test('sweepExpired evicts stale entries past ttlMs', () => {
  const s = createMarksState();
  applySnapshot(s, 'old', [mark('a')], 1000);
  applySnapshot(s, 'fresh', [mark('b')], 9500);
  const evicted = sweepExpired(s, 12000, 10000); // ttl 10s; old is 11s stale
  assert.deepEqual(evicted, ['old']);
  assert.equal(s.marksByCanvas.has('old'), false);
  assert.equal(s.marksByCanvas.has('fresh'), true);
});

test('sweepExpired is a no-op when nothing has expired', () => {
  const s = createMarksState();
  applySnapshot(s, 'cv-1', [mark('a')], 1000);
  const evicted = sweepExpired(s, 2000, 10000);
  assert.deepEqual(evicted, []);
  assert.equal(s.marksByCanvas.has('cv-1'), true);
});
