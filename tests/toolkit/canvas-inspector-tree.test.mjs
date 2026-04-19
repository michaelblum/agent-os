import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeInspectorTree } from '../../packages/toolkit/components/canvas-inspector/tree.js';

const display = (id, { x = 0, y = 0, w = 1920, h = 1080, is_main = false } = {}) => ({
  id,
  is_main,
  bounds: { x, y, w, h },
});

const canvas = (id, at, extra = {}) => ({ id, at, ...extra });

const mark = (id, name = id) => ({
  id, name, x: 0, y: 0, w: 20, h: 20,
  color: '#fff', rect: true, ellipse: true, cross: true,
});

test('empty displays yields an empty tree', () => {
  const tree = computeInspectorTree({ displays: [], canvases: [] });
  assert.equal(tree.type, 'empty');
  assert.deepEqual(tree.children, []);
});

test('single display becomes the top-level node (no union wrapper)', () => {
  const tree = computeInspectorTree({
    displays: [display('d1', { is_main: true })],
    canvases: [],
  });
  assert.equal(tree.type, 'display');
  assert.equal(tree.label, 'main');
  assert.deepEqual(tree.children, []);
});

test('multi-display synthesizes a union root with main + extended [n]', () => {
  const tree = computeInspectorTree({
    displays: [
      display('d1', { is_main: true }),
      display('d2', { x: 1920 }),
      display('d3', { x: 3840 }),
    ],
    canvases: [],
  });
  assert.equal(tree.type, 'union');
  assert.equal(tree.label, 'union');
  assert.equal(tree.children.length, 3);
  assert.deepEqual(tree.children.map(c => c.label), ['main', 'extended [1]', 'extended [2]']);
});

test('multi-display with no main display labels all as extended', () => {
  const tree = computeInspectorTree({
    displays: [display('d1'), display('d2', { x: 1920 })],
    canvases: [],
  });
  assert.deepEqual(tree.children.map(c => c.label), ['extended [1]', 'extended [2]']);
});

test('canvas fully contained in a display nests under that display', () => {
  const tree = computeInspectorTree({
    displays: [
      display('d1', { is_main: true }),
      display('d2', { x: 1920 }),
    ],
    canvases: [canvas('cv-a', [100, 100, 200, 200])],
  });
  const main = tree.children.find(c => c.label === 'main');
  assert.equal(main.children.length, 1);
  assert.equal(main.children[0].id, 'cv-a');
});

test('canvas with track:union nests directly under union even if contained in a display', () => {
  const tree = computeInspectorTree({
    displays: [
      display('d1', { is_main: true }),
      display('d2', { x: 1920 }),
    ],
    canvases: [canvas('avatar-main', [100, 100, 20, 20], { track: 'union' })],
  });
  const main = tree.children.find(c => c.label === 'main');
  assert.equal(main.children.length, 0);
  const unionChild = tree.children.find(c => c.type === 'canvas' && c.id === 'avatar-main');
  assert.ok(unionChild, 'avatar-main should be a direct child of union');
});

test('canvas spanning multiple displays nests under union', () => {
  const tree = computeInspectorTree({
    displays: [
      display('d1', { is_main: true }),
      display('d2', { x: 1920 }),
    ],
    canvases: [canvas('wide', [1800, 100, 300, 300])], // crosses the boundary
  });
  const main = tree.children.find(c => c.label === 'main');
  assert.equal(main.children.length, 0);
  const unionChild = tree.children.find(c => c.type === 'canvas' && c.id === 'wide');
  assert.ok(unionChild, 'spanning canvas should land under union');
});

test('canvas with no rect nests under union (multi-display)', () => {
  const tree = computeInspectorTree({
    displays: [
      display('d1', { is_main: true }),
      display('d2', { x: 1920 }),
    ],
    canvases: [canvas('stray', null)],
  });
  const unionChild = tree.children.find(c => c.type === 'canvas' && c.id === 'stray');
  assert.ok(unionChild);
});

test('single-display mode: union-tracked canvas still nests under the display', () => {
  const tree = computeInspectorTree({
    displays: [display('d1', { is_main: true })],
    canvases: [canvas('x', [10, 10, 10, 10], { track: 'union' })],
  });
  assert.equal(tree.type, 'display');
  assert.equal(tree.children.length, 1);
  assert.equal(tree.children[0].id, 'x');
});

test('marks nest under their parent canvas node (Map API)', () => {
  const marks = new Map([
    ['cv-a', { marks: [mark('m1', 'Obj 1'), mark('m2', 'Obj 2')] }],
  ]);
  const tree = computeInspectorTree({
    displays: [display('d1', { is_main: true })],
    canvases: [canvas('cv-a', [0, 0, 100, 100])],
    marksByCanvas: marks,
  });
  const cv = tree.children[0];
  assert.equal(cv.children.length, 2);
  assert.deepEqual(cv.children.map(c => c.label), ['Obj 1', 'Obj 2']);
  assert.equal(cv.children[0].type, 'mark');
});

test('marks nest under their parent canvas node (plain-object API)', () => {
  const tree = computeInspectorTree({
    displays: [display('d1', { is_main: true })],
    canvases: [canvas('cv-a', [0, 0, 100, 100])],
    marksByCanvas: { 'cv-a': { marks: [mark('m1')] } },
  });
  assert.equal(tree.children[0].children[0].id, 'm1');
});

test('canvas not matching any display falls back under first display in single-display mode', () => {
  const tree = computeInspectorTree({
    displays: [display('d1', { is_main: true })],
    canvases: [canvas('stray', [5000, 5000, 10, 10])], // well outside bounds
  });
  // single-display mode routes everything under the one display
  assert.equal(tree.children.length, 1);
  assert.equal(tree.children[0].id, 'stray');
});

test('matches pivot example: multi-display with union-tracked canvas + its mark', () => {
  const tree = computeInspectorTree({
    displays: [
      display('d1', { is_main: true }),
      display('d2', { x: 1920 }),
    ],
    canvases: [
      canvas('canvas-inspector', [100, 100, 400, 600]),
      canvas('other-main-canvas', [600, 100, 200, 200]),
      canvas('sidecar-canvas', [2000, 100, 300, 300]),
      canvas('avatar-main', [0, 0, 20, 20], { track: 'union' }),
    ],
    marksByCanvas: new Map([['avatar-main', { marks: [mark('avatar', 'Avatar')] }]]),
  });

  assert.equal(tree.type, 'union');
  const main = tree.children.find(c => c.label === 'main');
  assert.deepEqual(main.children.map(c => c.id), ['canvas-inspector', 'other-main-canvas']);
  const ext = tree.children.find(c => c.label === 'extended [1]');
  assert.deepEqual(ext.children.map(c => c.id), ['sidecar-canvas']);
  const avatar = tree.children.find(c => c.id === 'avatar-main');
  assert.ok(avatar);
  assert.equal(avatar.children.length, 1);
  assert.equal(avatar.children[0].label, 'Avatar');
});
