import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createDragDropController,
  createDragController,
  createMaximizeController,
  createMinimizeController,
  createPanelWindowController,
  createSplitPane,
  createStageAffordance,
  stageAffordanceRegionId,
  syncMaximizeButton,
  wireDrag,
  wireResize,
} from '../../packages/toolkit/panel/index.js';

test('panel public entrypoint exports workbench chrome primitives', () => {
  assert.equal(typeof createDragDropController, 'function');
  assert.equal(typeof createDragController, 'function');
  assert.equal(typeof createMaximizeController, 'function');
  assert.equal(typeof createMinimizeController, 'function');
  assert.equal(typeof createPanelWindowController, 'function');
  assert.equal(typeof createSplitPane, 'function');
  assert.equal(typeof createStageAffordance, 'function');
  assert.equal(typeof stageAffordanceRegionId, 'function');
  assert.equal(typeof syncMaximizeButton, 'function');
  assert.equal(typeof wireDrag, 'function');
  assert.equal(typeof wireResize, 'function');
});
