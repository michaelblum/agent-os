import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildMarkLayers, renderMinimapMark } from '../../packages/toolkit/components/canvas-inspector/marks/render.js';

const mark = (extra = {}) => ({
  id: 'a',
  name: 'a',
  x: 100,
  y: 100,
  w: 20,
  h: 20,
  color: '#ff00aa',
  rect: true,
  ellipse: true,
  cross: true,
  ...extra,
});

test('buildMarkLayers with all primitives emits rect + ellipse + two cross lines', () => {
  const svg = buildMarkLayers(mark());
  assert.match(svg, /<rect /);
  assert.match(svg, /<ellipse /);
  const lineCount = (svg.match(/<line /g) || []).length;
  assert.equal(lineCount, 2);
});

test('buildMarkLayers rect-only omits ellipse and lines', () => {
  const svg = buildMarkLayers(mark({ ellipse: false, cross: false }));
  assert.match(svg, /<rect /);
  assert.doesNotMatch(svg, /<ellipse /);
  assert.doesNotMatch(svg, /<line /);
});

test('buildMarkLayers ellipse-only omits rect and lines', () => {
  const svg = buildMarkLayers(mark({ rect: false, cross: false }));
  assert.doesNotMatch(svg, /<rect /);
  assert.match(svg, /<ellipse /);
  assert.doesNotMatch(svg, /<line /);
});

test('buildMarkLayers cross-only omits rect and ellipse', () => {
  const svg = buildMarkLayers(mark({ rect: false, ellipse: false }));
  assert.doesNotMatch(svg, /<rect /);
  assert.doesNotMatch(svg, /<ellipse /);
  const lineCount = (svg.match(/<line /g) || []).length;
  assert.equal(lineCount, 2);
});

test('buildMarkLayers with all primitives off emits empty string', () => {
  const svg = buildMarkLayers(mark({ rect: false, ellipse: false, cross: false }));
  assert.equal(svg, '');
});

test('buildMarkLayers applies stroke color from mark.color', () => {
  const svg = buildMarkLayers(mark({ color: '#abcdef' }));
  const strokeCount = (svg.match(/stroke="#abcdef"/g) || []).length;
  // rect + ellipse + 2 lines = 4 stroke attributes
  assert.equal(strokeCount, 4);
});

test('buildMarkLayers escapes color in stroke attribute', () => {
  const svg = buildMarkLayers(mark({ color: '"><script>' }));
  assert.doesNotMatch(svg, /<script>/);
  assert.match(svg, /&quot;&gt;&lt;script&gt;/);
});

test('buildMarkLayers respects custom w and h', () => {
  const svg = buildMarkLayers(mark({ w: 40, h: 60 }));
  assert.match(svg, /width="39"/);    // 40 - stroke(1)
  assert.match(svg, /height="59"/);   // 60 - stroke(1)
  assert.match(svg, /x2="40"/);        // cross line terminates at w
  assert.match(svg, /y2="60"/);        // cross line terminates at h
});

test('renderMinimapMark centers mark on projected point and embeds metadata', () => {
  const svg = renderMinimapMark(mark({ id: 'avatar', name: 'Avatar' }), { x: 50, y: 60 });
  assert.match(svg, /left:40px/);  // 50 - 20/2
  assert.match(svg, /top:50px/);   // 60 - 20/2
  assert.match(svg, /data-mark-id="avatar"/);
  assert.match(svg, /<title>Avatar<\/title>/);
  assert.match(svg, /class="minimap-mark"/);
  assert.match(svg, /viewBox="0 0 20 20"/);
});

test('renderMinimapMark escapes id and name', () => {
  const svg = renderMinimapMark(mark({ id: 'x"<y', name: '<b>bold</b>' }), { x: 0, y: 0 });
  assert.match(svg, /data-mark-id="x&quot;&lt;y"/);
  assert.match(svg, /<title>&lt;b&gt;bold&lt;\/b&gt;<\/title>/);
});

test('renderMinimapMark rounds position to integers', () => {
  const svg = renderMinimapMark(mark({ w: 21 }), { x: 50.7, y: 60.3 });
  // left = 50.7 - 10.5 = 40.2 → round → 40
  assert.match(svg, /left:40px/);
  // top = 60.3 - 10.5 = 49.8 → round → 50
  assert.match(svg, /top:50px/);
});
