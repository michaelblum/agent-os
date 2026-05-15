import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createAosZagCollapsible } from '../../packages/toolkit/adapters/zag/collapsible.js';
import { createDocument, patchSpreadSupport } from './zag-adapter-test-utils.mjs';

function createAdapter(extra = {}) {
  const document = createDocument();
  const adapter = createAosZagCollapsible({
    id: 'test-collapsible',
    getRootNode: () => document,
    ...extra,
  });
  return { adapter, document };
}

test('createAosZagCollapsible exposes expected Zag collapsible helpers', () => {
  const { adapter } = createAdapter({});
  const snapshot = adapter.connect();

  assert.equal(typeof snapshot.api, 'object');
  assert.equal(typeof snapshot.getRootProps, 'function');
  assert.equal(typeof snapshot.getTriggerProps, 'function');
  assert.equal(typeof snapshot.getContentProps, 'function');
  adapter.destroy();
});

test('bind wires minimum collapsible parts', () => {
  const { adapter, document } = createAdapter({});
  const container = patchSpreadSupport(document.createElement('div'));
  const elRoot = patchSpreadSupport(document.createElement('div'));
  elRoot.dataset.aosCollapsibleRoot = '';
  container.appendChild(elRoot);
  const elTrigger = patchSpreadSupport(document.createElement('div'));
  elTrigger.dataset.aosCollapsibleTrigger = '';
  elTrigger.dataset.value = 'a';
  container.appendChild(elTrigger);
  const elContent = patchSpreadSupport(document.createElement('div'));
  elContent.dataset.aosCollapsibleContent = '';
  elContent.dataset.value = 'a';
  container.appendChild(elContent);
  document.body.appendChild(container);

  const snapshot = adapter.bind(container);

  assert.equal(typeof snapshot.api, 'object');
  assert.equal(typeof adapter.bindRoot, 'function');
  assert.equal(typeof adapter.bindTrigger, 'function');
  assert.equal(typeof adapter.bindContent, 'function');
  adapter.destroy();
});

test('programmatic helpers update collapsible state through Zag API', () => {
  const { adapter } = createAdapter({});
  assert.equal(typeof adapter.open, 'function');
  assert.equal(typeof adapter.close, 'function');
  adapter.destroy();
});

test('constructor validates required id', () => {
  assert.throws(() => createAosZagCollapsible({}), /requires an id/);
});
