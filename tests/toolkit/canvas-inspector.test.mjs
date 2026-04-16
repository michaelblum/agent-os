import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeMinimapLayout } from '../../packages/toolkit/components/canvas-inspector/index.js';

const displays = [
  {
    id: 2,
    cgID: 3,
    width: 1920,
    height: 1080,
    is_main: false,
    bounds: { x: -207, y: 982, w: 1920, h: 1080 },
  },
  {
    id: 1,
    cgID: 1,
    width: 1512,
    height: 982,
    is_main: true,
    bounds: { x: 0, y: 0, w: 1512, h: 982 },
  },
];

test('computeMinimapLayout preserves a visible inset for displays at the union edge', () => {
  const layout = computeMinimapLayout(displays, [], 300);
  assert.ok(layout);
  assert.equal(layout.mapW, 300);
  assert.equal(layout.mapH, 322);

  const lowerDisplay = layout.displays.find((entry) => !entry.display.is_main);
  assert.ok(lowerDisplay);
  assert.deepEqual(
    { x: lowerDisplay.x, y: lowerDisplay.y, w: lowerDisplay.w, h: lowerDisplay.h },
    { x: 2, y: 152, w: 294, h: 165 }
  );
  assert.ok(lowerDisplay.x > 0);
  assert.ok(lowerDisplay.y > 0);
  assert.ok(lowerDisplay.x + lowerDisplay.w < layout.mapW);
  assert.ok(lowerDisplay.y + lowerDisplay.h < layout.mapH);
});

test('computeMinimapLayout keeps self canvases marked and scaled into the same box', () => {
  const canvases = [
    { id: 'canvas-inspector', at: [1172, 442, 320, 480] },
    { id: 'other-canvas', at: [-207, 982, 1920, 1080] },
  ];
  const layout = computeMinimapLayout(displays, canvases, 300);
  assert.ok(layout);
  assert.equal(layout.canvases.length, 2);

  const self = layout.canvases.find((entry) => entry.canvas.id === 'canvas-inspector');
  const other = layout.canvases.find((entry) => entry.canvas.id === 'other-canvas');
  assert.ok(self);
  assert.ok(other);
  assert.equal(self.isSelf, true);
  assert.equal(other.isSelf, false);
  assert.ok(self.x >= 2 && self.y >= 2);
  assert.ok(self.x + self.w < layout.mapW);
  assert.ok(self.y + self.h < layout.mapH);
});
