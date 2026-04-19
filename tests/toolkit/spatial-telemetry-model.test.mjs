import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildSpatialTelemetrySnapshot,
  computeUnionBounds,
  labelDisplays,
  rectFromAt,
  translatePoint,
  translateRect,
} from '../../packages/toolkit/components/spatial-telemetry/model.js';

const display = (id, { x = 0, y = 0, w = 1920, h = 1080, is_main = false, scale_factor = 1 } = {}) => ({
  id,
  is_main,
  scale_factor,
  bounds: { x, y, w, h },
  visible_bounds: { x, y, w, h },
});

test('labelDisplays uses main + extended [n] naming in spatial order', () => {
  const labeled = labelDisplays([
    display('ext-low', { x: -200, y: 1000 }),
    display('main', { is_main: true, x: 0, y: 0, scale_factor: 2 }),
    display('ext-right', { x: 1512, y: 0 }),
  ]);
  assert.deepEqual(labeled.map((entry) => entry.label), ['main', 'extended [1]', 'extended [2]']);
});

test('computeUnionBounds returns the global display union', () => {
  const union = computeUnionBounds(labelDisplays([
    display('main', { is_main: true, x: 0, y: 0, w: 1512, h: 982 }),
    display('ext', { x: -191, y: 982, w: 1920, h: 1080 }),
  ]));
  assert.deepEqual(union, { x: -191, y: 0, w: 1920, h: 2062 });
});

test('translate helpers preserve size and shift origin only', () => {
  assert.deepEqual(translatePoint({ x: 125, y: 250 }, { x: 100, y: 200 }), { x: 25, y: 50 });
  assert.deepEqual(translateRect({ x: 125, y: 250, w: 80, h: 60 }, { x: 100, y: 200 }), { x: 25, y: 50, w: 80, h: 60 });
  assert.equal(rectFromAt([1, 2, 3, 4]).w, 3);
});

test('buildSpatialTelemetrySnapshot reports display/canvas/mark/cursor spaces', () => {
  const snapshot = buildSpatialTelemetrySnapshot({
    displays: [
      display('main', { is_main: true, x: 0, y: 0, w: 1512, h: 982, scale_factor: 2 }),
      display('ext', { x: -191, y: 982, w: 1920, h: 1080, scale_factor: 1 }),
    ],
    canvases: [
      { id: 'avatar-main', at: [-191, 0, 1920, 2062], track: 'union', scope: 'global', interactive: false },
      { id: 'sigil-hit', at: [1220, 784, 80, 80], parent: 'avatar-main', scope: 'global', interactive: false },
    ],
    cursor: { x: 1105, y: 1864, valid: true },
    marksByCanvas: new Map([
      ['avatar-main', {
        marks: [
          { id: 'avatar', name: 'Avatar', x: 1260, y: 824 },
        ],
      }],
    ]),
  });

  assert.deepEqual(snapshot.union, { x: -191, y: 0, w: 1920, h: 2062 });
  assert.equal(snapshot.canvasRows[0].owner, 'union');
  assert.deepEqual(snapshot.canvasRows[1].parentLocal, { x: 1411, y: 784, w: 80, h: 80 });
  assert.equal(snapshot.markRows[0].owner, 'main');
  assert.deepEqual(snapshot.markRows[0].canvasLocal, { x: 1451, y: 824 });
  assert.equal(snapshot.cursorRow.owner, 'extended [1]');
  assert.deepEqual(snapshot.cursorRow.unionLocal, { x: 1296, y: 1864 });
});
