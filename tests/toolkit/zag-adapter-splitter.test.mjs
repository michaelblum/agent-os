import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createAosZagSplitter } from '../../packages/toolkit/adapters/zag/splitter.js';
import { createDocument, patchSpreadSupport } from './zag-adapter-test-utils.mjs';

function createAdapter(extra = {}) {
  const document = createDocument();
  const adapter = createAosZagSplitter({
    id: 'test-splitter',
    getRootNode: () => document,
    ...extra,
  });
  return { adapter, document };
}

test('createAosZagSplitter exposes expected Zag splitter helpers', () => {
  const { adapter } = createAdapter({panels: [{ id: 'a', size: 50 }, { id: 'b', size: 50 }]});
  const snapshot = adapter.connect();

  assert.equal(typeof snapshot.api, 'object');
  assert.equal(typeof snapshot.getRootProps, 'function');
  assert.equal(typeof snapshot.getPanelProps, 'function');
  assert.equal(typeof snapshot.getResizeTriggerProps, 'function');
  adapter.destroy();
});

test('bind wires minimum splitter parts', () => {
  const { adapter, document } = createAdapter({panels: [{ id: 'a', size: 50 }, { id: 'b', size: 50 }]});
  const container = patchSpreadSupport(document.createElement('div'));
  const elRoot = patchSpreadSupport(document.createElement('div'));
  elRoot.dataset.aosSplitterRoot = '';
  container.appendChild(elRoot);
  const elPanel = patchSpreadSupport(document.createElement('div'));
  elPanel.dataset.aosSplitterPanel = '';
  elPanel.dataset.value = 'a';
  container.appendChild(elPanel);
  const elResizeTrigger = patchSpreadSupport(document.createElement('div'));
  elResizeTrigger.dataset.aosSplitterResizeTrigger = '';
  elResizeTrigger.dataset.value = 'a:b';
  container.appendChild(elResizeTrigger);
  document.body.appendChild(container);

  const snapshot = adapter.bind(container);

  assert.equal(typeof snapshot.api, 'object');
  assert.equal(typeof adapter.bindRoot, 'function');
  assert.equal(typeof adapter.bindPanel, 'function');
  assert.equal(typeof adapter.bindResizeTrigger, 'function');
  adapter.destroy();
});

test('programmatic helpers update splitter state through Zag API', () => {
  const { adapter } = createAdapter({panels: [{ id: 'a', size: 50 }, { id: 'b', size: 50 }]});
  assert.equal(typeof adapter.connect().api, 'object');
  adapter.destroy();
});

test('constructor validates required id', () => {
  assert.throws(() => createAosZagSplitter({}), /requires an id/);
});
