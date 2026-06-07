import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildAvatarControlsSnapshot,
} from '../../apps/sigil/avatar-controls/snapshot-projection.js';

test('avatar controls snapshot projection clones bounds and reads compact surface state', () => {
  const bounds = { x: 24, y: 48, w: 292, h: 448 };
  const controls = [
    {
      id: 'sigil-avatar-controls-opacity',
      descriptor_id: 'sigil-avatar-controls-opacity',
      role: 'slider',
      value: 0.8,
    },
  ];
  const compactSurface = {
    getActiveTab() {
      return 'appearance';
    },
    getControlRecords() {
      return controls;
    },
  };

  const snapshot = buildAvatarControlsSnapshot(
    { open: true, bounds },
    compactSurface,
  );

  assert.deepEqual(snapshot, {
    open: true,
    bounds,
    surface: 'embedded',
    panelId: null,
    stack: null,
    activeTab: 'appearance',
    controls,
  });
  assert.notEqual(snapshot.bounds, bounds);
});

test('avatar controls snapshot projection preserves closed null surface shape', () => {
  assert.deepEqual(buildAvatarControlsSnapshot({ open: false, bounds: null }, null), {
    open: false,
    bounds: null,
    surface: null,
    panelId: null,
    stack: null,
    activeTab: null,
    controls: [],
  });
});
