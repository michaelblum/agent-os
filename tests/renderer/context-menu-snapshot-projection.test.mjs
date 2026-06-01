import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildContextMenuSnapshot,
} from '../../apps/sigil/context-menu/snapshot-projection.js';

test('context menu snapshot projection clones bounds and reads compact surface state', () => {
  const bounds = { x: 24, y: 48, w: 292, h: 448 };
  const controls = [
    {
      id: 'sigil-menu-opacity',
      descriptor_id: 'sigil-menu-opacity',
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

  const snapshot = buildContextMenuSnapshot(
    { open: true, bounds },
    compactSurface,
  );

  assert.deepEqual(snapshot, {
    open: true,
    bounds,
    stack: null,
    activeTab: 'appearance',
    controls,
  });
  assert.notEqual(snapshot.bounds, bounds);
});

test('context menu snapshot projection preserves closed null surface shape', () => {
  assert.deepEqual(buildContextMenuSnapshot({ open: false, bounds: null }, null), {
    open: false,
    bounds: null,
    stack: null,
    activeTab: null,
    controls: [],
  });
});
