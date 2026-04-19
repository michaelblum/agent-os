import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildSpatialTelemetrySnapshot,
  computeDesktopWorldBounds,
  computeVisibleDesktopWorldBounds,
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

test('computeDesktopWorldBounds returns the canonical DesktopWorld union', () => {
  const labeled = labelDisplays([
    display('main', { is_main: true, x: 0, y: 0, w: 1512, h: 982 }),
    display('ext', { x: -191, y: 982, w: 1920, h: 1080 }),
  ]);
  assert.deepEqual(
    computeDesktopWorldBounds(labeled),
    { x: 0, y: 0, w: 1920, h: 2062, minX: 0, minY: 0, maxX: 1920, maxY: 2062 },
  );
  assert.deepEqual(
    computeVisibleDesktopWorldBounds(labeled),
    { x: 0, y: 0, w: 1920, h: 2062, minX: 0, minY: 0, maxX: 1920, maxY: 2062 },
  );
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

  assert.deepEqual(snapshot.desktopWorld, { x: 0, y: 0, w: 1920, h: 2062, minX: 0, minY: 0, maxX: 1920, maxY: 2062 });
  assert.deepEqual(snapshot.visibleDesktopWorld, { x: 0, y: 0, w: 1920, h: 2062, minX: 0, minY: 0, maxX: 1920, maxY: 2062 });
  assert.deepEqual(snapshot.nativeDesktopBounds, { x: -191, y: 0, w: 1920, h: 2062, minX: -191, minY: 0, maxX: 1729, maxY: 2062 });
  assert.equal(snapshot.canvasRows[0].owner, 'union');
  assert.deepEqual(snapshot.canvasRows[1].worldRect, { x: 1602, y: 784, w: 80, h: 80 });
  assert.deepEqual(snapshot.canvasRows[1].parentLocal, { x: 1602, y: 784, w: 80, h: 80 });
  assert.equal(snapshot.markRows[0].owner, 'main');
  assert.deepEqual(snapshot.markRows[0].worldPoint, { x: 1260, y: 824 });
  assert.deepEqual(snapshot.markRows[0].canvasLocal, { x: 1260, y: 824 });
  assert.equal(snapshot.cursorRow.owner, 'extended [1]');
  assert.deepEqual(snapshot.cursorRow.worldPoint, { x: 1296, y: 1864 });
});

test('buildSpatialTelemetrySnapshot honors daemon-provided DesktopWorld bounds', () => {
  // Daemon payload supplies desktop_world_bounds that diverge from the naive
  // re-anchor (here daemon pins the union at x=50 rather than x=0). The
  // snapshot must reflect the daemon's value for the display row.
  const snapshot = buildSpatialTelemetrySnapshot({
    displays: [
      {
        id: 'main',
        is_main: true,
        scale_factor: 2,
        bounds: { x: -200, y: 0, w: 1512, h: 982 },
        visible_bounds: { x: -200, y: 25, w: 1512, h: 957 },
        native_bounds: { x: -200, y: 0, w: 1512, h: 982 },
        native_visible_bounds: { x: -200, y: 25, w: 1512, h: 957 },
        desktop_world_bounds: { x: 50, y: 0, w: 1512, h: 982 },
        visible_desktop_world_bounds: { x: 50, y: 25, w: 1512, h: 957 },
      },
    ],
    cursor: { valid: false },
  });
  assert.deepEqual(snapshot.displayRows[0].bounds, { x: 50, y: 0, w: 1512, h: 982 });
  assert.deepEqual(snapshot.displayRows[0].visibleBounds, { x: 50, y: 25, w: 1512, h: 957 });
  assert.deepEqual(snapshot.displayRows[0].nativeBounds, { x: -200, y: 0, w: 1512, h: 982 });
});
