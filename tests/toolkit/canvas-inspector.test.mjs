import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  computeMinimapLayout,
  normalizeDisplays,
  projectPointToMinimap,
  resolveCanvasFrames,
} from '../../packages/toolkit/components/canvas-inspector/index.js';

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
  assert.deepEqual(
    { x: other.x, y: other.y, w: other.w, h: other.h },
    { x: 2, y: 152, w: 294, h: 165 }
  );
});

test('projectPointToMinimap maps the cursor into minimap coordinates', () => {
  const canvases = [
    { id: 'avatar-main', at: [-207, 0, 1920, 2062] },
    { id: 'sigil-hit', parent: 'avatar-main', at: [1093, 240, 80, 80] },
    { id: 'canvas-inspector', at: [1172, 442, 320, 480] },
  ];
  const layout = computeMinimapLayout(displays, canvases, 300);
  assert.ok(layout);

  const cursor = projectPointToMinimap(layout, { x: 1340, y: 280 });
  assert.ok(cursor);
  assert.ok(cursor.x >= 0 && cursor.x <= layout.mapW);
  assert.ok(cursor.y >= 0 && cursor.y <= layout.mapH);

  const avatarHit = layout.canvases.find((entry) => entry.canvas.id === 'sigil-hit');
  assert.ok(avatarHit);
  assert.ok(cursor.x >= avatarHit.x);
  assert.ok(cursor.x <= avatarHit.x + avatarHit.w);
  assert.ok(cursor.y >= avatarHit.y);
  assert.ok(cursor.y <= avatarHit.y + avatarHit.h);
});

test('resolveCanvasFrames keeps daemon global child canvas rects intact', () => {
  const resolved = resolveCanvasFrames([
    { id: 'avatar-main', at: [-96, -540, 3520, 2068] },
    { id: 'sigil-hit', parent: 'avatar-main', at: [974, -286, 80, 80] },
  ]);
  assert.deepEqual(
    resolved.map(({ id, atResolved }) => ({ id, atResolved })),
    [
      { id: 'avatar-main', atResolved: [-96, -540, 3520, 2068] },
      { id: 'sigil-hit', atResolved: [974, -286, 80, 80] },
    ]
  );
});

test('computeMinimapLayout aligns global native child canvas frames with DesktopWorld marks', () => {
  const liveDisplays = [
    {
      id: 3,
      width: 1920,
      height: 1080,
      is_main: false,
      bounds: { x: -185, y: 982, w: 1920, h: 1080 },
    },
    {
      id: 1,
      width: 1512,
      height: 982,
      is_main: true,
      bounds: { x: 0, y: 0, w: 1512, h: 982 },
    },
  ];
  const layout = computeMinimapLayout(liveDisplays, [
    { id: 'avatar-main', at: [-185, 0, 1920, 2062] },
    { id: 'sigil-hit', parent: 'avatar-main', at: [895, 1460, 80, 80] },
  ], 300);
  assert.ok(layout);

  const avatarMark = projectPointToMinimap(layout, { x: 1120, y: 1500 });
  const avatarHit = layout.canvases.find((entry) => entry.canvas.id === 'sigil-hit');
  assert.ok(avatarMark);
  assert.ok(avatarHit);
  assert.ok(avatarMark.x >= avatarHit.x);
  assert.ok(avatarMark.x <= avatarHit.x + avatarHit.w);
  assert.ok(avatarMark.y >= avatarHit.y);
  assert.ok(avatarMark.y <= avatarHit.y + avatarHit.h);
});

test('projectPointToMinimap rejects invalid cursor payloads', () => {
  const layout = computeMinimapLayout(displays, [], 300);
  assert.equal(projectPointToMinimap(layout, null), null);
  assert.equal(projectPointToMinimap(layout, { x: Number.NaN, y: 0 }), null);
  assert.equal(projectPointToMinimap(layout, { x: 0, y: Infinity }), null);
});

test('computeMinimapLayout honors daemon-provided desktop_world_bounds verbatim', () => {
  // Daemon payload carries both native_bounds and desktop_world_bounds. If the
  // daemon claims a DesktopWorld origin that differs from a naive re-anchor,
  // the inspector must honor the daemon value (we trust the producer).
  const payload = [
    {
      id: 1, cgID: 1, is_main: true, width: 1512, height: 982,
      bounds: { x: -200, y: 0, w: 1512, h: 982 },
      native_bounds: { x: -200, y: 0, w: 1512, h: 982 },
      desktop_world_bounds: { x: 100, y: 0, w: 1512, h: 982 },
      visible_desktop_world_bounds: { x: 100, y: 25, w: 1512, h: 919 },
    },
  ];
  const layout = computeMinimapLayout(payload, [], 300);
  assert.ok(layout);
  // Union derived from daemon-provided rect, not re-anchored to x=0.
  assert.equal(layout.minX, 100);
});

test('normalizeDisplays accepts display_geometry payloads', () => {
  const normalized = normalizeDisplays([
    {
      display_id: 3,
      is_main: false,
      bounds: { x: -207, y: 982, w: 1920, h: 1080 },
      scale_factor: 1,
    },
    {
      display_id: 1,
      is_main: true,
      bounds: { x: 0, y: 0, w: 1512, h: 982 },
      scale_factor: 2,
    },
  ]);

  assert.deepEqual(normalized, [
    {
      display_id: 3,
      id: 3,
      is_main: false,
      bounds: { x: 0, y: 982, w: 1920, h: 1080 },
      nativeBounds: { x: -207, y: 982, w: 1920, h: 1080 },
      nativeVisibleBounds: { x: -207, y: 982, w: 1920, h: 1080 },
      desktopWorldBounds: null,
      visibleDesktopWorldBounds: null,
      native_bounds: { x: -207, y: 982, w: 1920, h: 1080 },
      native_visible_bounds: { x: -207, y: 982, w: 1920, h: 1080 },
      visible_bounds: { x: 0, y: 982, w: 1920, h: 1080 },
      desktop_world_bounds: { x: 0, y: 982, w: 1920, h: 1080 },
      visible_desktop_world_bounds: { x: 0, y: 982, w: 1920, h: 1080 },
      scale_factor: 1,
      visibleBounds: { x: 0, y: 982, w: 1920, h: 1080 },
      width: 1920,
      height: 1080,
    },
    {
      display_id: 1,
      id: 1,
      is_main: true,
      bounds: { x: 207, y: 0, w: 1512, h: 982 },
      nativeBounds: { x: 0, y: 0, w: 1512, h: 982 },
      nativeVisibleBounds: { x: 0, y: 0, w: 1512, h: 982 },
      desktopWorldBounds: null,
      visibleDesktopWorldBounds: null,
      native_bounds: { x: 0, y: 0, w: 1512, h: 982 },
      native_visible_bounds: { x: 0, y: 0, w: 1512, h: 982 },
      visible_bounds: { x: 207, y: 0, w: 1512, h: 982 },
      desktop_world_bounds: { x: 207, y: 0, w: 1512, h: 982 },
      visible_desktop_world_bounds: { x: 207, y: 0, w: 1512, h: 982 },
      scale_factor: 2,
      visibleBounds: { x: 207, y: 0, w: 1512, h: 982 },
      width: 1512,
      height: 982,
    },
  ]);
});
