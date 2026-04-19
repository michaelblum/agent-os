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

test('normalizeMarks applies defaults (size=20, name=id) and clamps size', () => {
  const out = normalizeMarks('cv', [
    { id: 'a', x: 1, y: 2 },
    { id: 'b', x: 3, y: 4, size: 0.1 },
    { id: 'c', x: 5, y: 6, size: 500, name: 'See' },
  ]);
  assert.equal(out[0].size, 20);
  assert.equal(out[0].name, 'a');
  assert.equal(out[1].size, 4);   // clamped to min
  assert.equal(out[2].size, 128); // clamped to max
  assert.equal(out[2].name, 'See');
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

import { sanitizeSvg } from '../../packages/toolkit/components/canvas-inspector/marks/normalize.js';

test('sanitizeSvg strips <script> tags', () => {
  const out = sanitizeSvg('<svg><script>alert(1)</script><rect/></svg>');
  assert.doesNotMatch(out, /<script/i);
  assert.match(out, /<rect/);
});

test('sanitizeSvg strips on* event handlers', () => {
  const out = sanitizeSvg('<svg><rect onload="x()" onclick="y()" fill="red"/></svg>');
  assert.doesNotMatch(out, /onload/i);
  assert.doesNotMatch(out, /onclick/i);
  assert.match(out, /fill="red"/);
});

test('sanitizeSvg strips non-data xlink:href and href', () => {
  const ok = sanitizeSvg('<svg><image href="data:image/png;base64,iVB"/></svg>');
  assert.match(ok, /href="data:image/);
  const bad = sanitizeSvg('<svg><image href="https://evil/x.png"/></svg>');
  assert.doesNotMatch(bad, /https:\/\/evil/);
});

test('sanitizeSvg returns null for non-svg input', () => {
  assert.equal(sanitizeSvg('<div>hi</div>'), null);
});
