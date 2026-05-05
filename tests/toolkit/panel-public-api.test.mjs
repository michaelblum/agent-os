import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createDragController,
  createMaximizeController,
  createSplitPane,
  syncMaximizeButton,
  wireDrag,
  wireResize,
} from '../../packages/toolkit/panel/index.js';

test('panel public entrypoint exports workbench chrome primitives', () => {
  assert.equal(typeof createDragController, 'function');
  assert.equal(typeof createMaximizeController, 'function');
  assert.equal(typeof createSplitPane, 'function');
  assert.equal(typeof syncMaximizeButton, 'function');
  assert.equal(typeof wireDrag, 'function');
  assert.equal(typeof wireResize, 'function');
});
