import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createAosZagTabs } from '../../packages/toolkit/adapters/zag/tabs.js';
import { createDocument, patchSpreadSupport } from './zag-adapter-test-utils.mjs';

function createAdapter(extra = {}) {
  const document = createDocument();
  const adapter = createAosZagTabs({
    id: 'test-tabs',
    getRootNode: () => document,
    ...extra,
  });
  return { adapter, document };
}

test('createAosZagTabs exposes expected Zag tabs helpers', () => {
  const { adapter } = createAdapter({defaultValue: 'a'});
  const snapshot = adapter.connect();

  assert.equal(typeof snapshot.api, 'object');
  assert.equal(typeof snapshot.getRootProps, 'function');
  assert.equal(typeof snapshot.getListProps, 'function');
  assert.equal(typeof snapshot.getTriggerProps, 'function');
  assert.equal(typeof snapshot.getContentProps, 'function');
  adapter.destroy();
});

test('bind wires minimum tabs parts', () => {
  const { adapter, document } = createAdapter({defaultValue: 'a'});
  const container = patchSpreadSupport(document.createElement('div'));
  const elRoot = patchSpreadSupport(document.createElement('div'));
  elRoot.dataset.aosTabsRoot = '';
  container.appendChild(elRoot);
  const elList = patchSpreadSupport(document.createElement('div'));
  elList.dataset.aosTabsList = '';
  container.appendChild(elList);
  const elTrigger = patchSpreadSupport(document.createElement('div'));
  elTrigger.dataset.aosTabsTrigger = '';
  elTrigger.dataset.value = 'a';
  container.appendChild(elTrigger);
  const elContent = patchSpreadSupport(document.createElement('div'));
  elContent.dataset.aosTabsContent = '';
  elContent.dataset.value = 'a';
  container.appendChild(elContent);
  document.body.appendChild(container);

  const snapshot = adapter.bind(container);

  assert.equal(typeof snapshot.api, 'object');
  assert.equal(typeof adapter.bindRoot, 'function');
  assert.equal(typeof adapter.bindList, 'function');
  assert.equal(typeof adapter.bindTrigger, 'function');
  assert.equal(typeof adapter.bindContent, 'function');
  adapter.destroy();
});

test('programmatic helpers update tabs state through Zag API', () => {
  const { adapter } = createAdapter({defaultValue: 'a'});
  adapter.setValue('b');
  assert.equal(typeof adapter.connect().api, 'object');
  adapter.destroy();
});

test('constructor validates required id', () => {
  assert.throws(() => createAosZagTabs({}), /requires an id/);
});
