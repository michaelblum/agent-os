import { test } from 'node:test';
import assert from 'node:assert/strict';

import { desktopPointToStageLocal } from '../../apps/sigil/renderer/live-modules/display-utils.js';

test('desktopPointToStageLocal preserves points when stage origin is 0,0', () => {
  assert.deepEqual(
    desktopPointToStageLocal({ x: 0, y: 0, w: 100, h: 100 }, { x: 42, y: 77 }),
    { x: 42, y: 77 },
  );
});

test('desktopPointToStageLocal subtracts the union origin from desktop-global points', () => {
  assert.deepEqual(
    desktopPointToStageLocal(
      { x: -191, y: 0, w: 1920, h: 2062, minX: -191, minY: 0 },
      { x: 100, y: 540 },
    ),
    { x: 291, y: 540 },
  );
});

test('desktopPointToStageLocal returns null for invalid points', () => {
  assert.equal(desktopPointToStageLocal({ minX: 10, minY: 20 }, { x: NaN, y: 5 }), null);
  assert.equal(desktopPointToStageLocal({ minX: 10, minY: 20 }, null), null);
});
