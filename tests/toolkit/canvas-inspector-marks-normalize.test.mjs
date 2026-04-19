import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeMarks,
  stableColorForId,
  __resetWarnMemo,
} from '../../packages/toolkit/components/canvas-inspector/marks/normalize.js';

test('normalizeMarks drops entries without id and warns once per canvas', () => {
  const warnings = [];
  const warn = (...args) => warnings.push(args.join(' '));
  const out = normalizeMarks('avatar-main', [
    { id: 'avatar', x: 1, y: 2 },
    { x: 3, y: 4 },
    { x: 5, y: 6 },
  ], { warn });
  assert.equal(out.length, 1);
  assert.equal(out[0].id, 'avatar');
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /avatar-main/);
});

test('normalizeMarks enforces id uniqueness within a snapshot (first-wins)', () => {
  const warnings = [];
  const out = normalizeMarks('cv', [
    { id: 'a', x: 1, y: 1 },
    { id: 'a', x: 99, y: 99 },
    { id: 'b', x: 2, y: 2 },
  ], { warn: (...a) => warnings.push(a.join(' ')) });
  assert.equal(out.length, 2);
  assert.deepEqual(out.map(o => [o.id, o.x]), [['a', 1], ['b', 2]]);
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /cv.*a/);
});

test('normalizeMarks applies primitive defaults (w=20, h=20, rect/ellipse/cross all true, name=id)', () => {
  const out = normalizeMarks('cv', [{ id: 'a', x: 1, y: 2 }]);
  assert.equal(out[0].w, 20);
  assert.equal(out[0].h, 20);
  assert.equal(out[0].rect, true);
  assert.equal(out[0].ellipse, true);
  assert.equal(out[0].cross, true);
  assert.equal(out[0].name, 'a');
});

test('normalizeMarks clamps w and h into [4, 128]', () => {
  const out = normalizeMarks('cv', [
    { id: 'a', x: 0, y: 0, w: 0.1, h: 0.1 },
    { id: 'b', x: 0, y: 0, w: 500, h: 500 },
    { id: 'c', x: 0, y: 0, w: 40, h: 60 },
  ]);
  assert.equal(out[0].w, 4);
  assert.equal(out[0].h, 4);
  assert.equal(out[1].w, 128);
  assert.equal(out[1].h, 128);
  assert.equal(out[2].w, 40);
  assert.equal(out[2].h, 60);
});

test('normalizeMarks preserves explicit primitive toggles', () => {
  const out = normalizeMarks('cv', [
    { id: 'a', x: 0, y: 0, rect: false },
    { id: 'b', x: 0, y: 0, ellipse: false },
    { id: 'c', x: 0, y: 0, cross: false },
    { id: 'd', x: 0, y: 0, rect: false, ellipse: false, cross: false },
  ]);
  assert.deepEqual([out[0].rect, out[0].ellipse, out[0].cross], [false, true, true]);
  assert.deepEqual([out[1].rect, out[1].ellipse, out[1].cross], [true, false, true]);
  assert.deepEqual([out[2].rect, out[2].ellipse, out[2].cross], [true, true, false]);
  assert.deepEqual([out[3].rect, out[3].ellipse, out[3].cross], [false, false, false]);
});

test('normalizeMarks uses explicit name when provided', () => {
  const out = normalizeMarks('cv', [{ id: 'x', x: 0, y: 0, name: 'Custom' }]);
  assert.equal(out[0].name, 'Custom');
});

test('stableColorForId returns the same color for the same id', () => {
  const a1 = stableColorForId('a');
  const a2 = stableColorForId('a');
  const b  = stableColorForId('b');
  assert.equal(a1, a2);
  assert.notEqual(a1, b);
  assert.match(a1, /^#[0-9a-f]{6}$/i);
});

test('normalizeMarks fills a stable color when none provided, respects explicit', () => {
  const out = normalizeMarks('cv', [
    { id: 'a', x: 1, y: 2 },
    { id: 'b', x: 3, y: 4, color: '#ff00aa' },
  ]);
  assert.equal(out[0].color, stableColorForId('a'));
  assert.equal(out[1].color, '#ff00aa');
});

test('normalizeMarks drops entries with non-finite x or y', () => {
  const out = normalizeMarks('cv', [
    { id: 'a', x: 1, y: 2 },
    { id: 'b', x: 'bogus', y: 4 },
    { id: 'c', x: 5, y: NaN },
    { id: 'd', x: Infinity, y: 6 },
  ]);
  assert.equal(out.length, 1);
  assert.equal(out[0].id, 'a');
});

test('normalizeMarks warns once across multiple snapshots for the same canvas', () => {
  __resetWarnMemo();
  const warnings = [];
  const warn = (...args) => warnings.push(args.join(' '));
  normalizeMarks('canvas-x', [{ x: 1, y: 2 }], { warn });
  normalizeMarks('canvas-x', [{ x: 3, y: 4 }, { x: 5, y: 6 }], { warn });
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /canvas-x/);
});

test('normalizeMarks warns once across calls per duplicate (canvas,id) pair', () => {
  __resetWarnMemo();
  const warnings = [];
  const warn = (...args) => warnings.push(args.join(' '));
  normalizeMarks('cv', [{ id: 'a', x: 1, y: 1 }, { id: 'a', x: 2, y: 2 }], { warn });
  normalizeMarks('cv', [{ id: 'a', x: 3, y: 3 }, { id: 'a', x: 4, y: 4 }], { warn });
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /cv.*a/);
});
