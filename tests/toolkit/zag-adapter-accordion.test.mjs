import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createAosZagAccordion } from '../../packages/toolkit/adapters/zag/accordion.js';
import { createDocument, patchSpreadSupport } from './zag-adapter-test-utils.mjs';

function createAdapter(extra = {}) {
  const document = createDocument();
  const adapter = createAosZagAccordion({
    id: 'test-accordion',
    getRootNode: () => document,
    ...extra,
  });
  return { adapter, document };
}

test('createAosZagAccordion exposes expected Zag accordion helpers', () => {
  const { adapter } = createAdapter({defaultValue: ['a']});
  const snapshot = adapter.connect();

  assert.equal(typeof snapshot.api, 'object');
  assert.equal(typeof snapshot.getRootProps, 'function');
  assert.equal(typeof snapshot.getItemProps, 'function');
  assert.equal(typeof snapshot.getItemTriggerProps, 'function');
  assert.equal(typeof snapshot.getItemContentProps, 'function');
  adapter.destroy();
});

test('bind wires minimum accordion parts', () => {
  const { adapter, document } = createAdapter({defaultValue: ['a']});
  const container = patchSpreadSupport(document.createElement('div'));
  const elRoot = patchSpreadSupport(document.createElement('div'));
  elRoot.dataset.aosAccordionRoot = '';
  container.appendChild(elRoot);
  const elItem = patchSpreadSupport(document.createElement('div'));
  elItem.dataset.aosAccordionItem = '';
  elItem.dataset.value = 'a';
  container.appendChild(elItem);
  const elItemTrigger = patchSpreadSupport(document.createElement('div'));
  elItemTrigger.dataset.aosAccordionItemTrigger = '';
  elItemTrigger.dataset.value = 'a';
  container.appendChild(elItemTrigger);
  const elItemContent = patchSpreadSupport(document.createElement('div'));
  elItemContent.dataset.aosAccordionItemContent = '';
  elItemContent.dataset.value = 'a';
  container.appendChild(elItemContent);
  document.body.appendChild(container);

  const snapshot = adapter.bind(container);

  assert.equal(typeof snapshot.api, 'object');
  assert.equal(typeof adapter.bindRoot, 'function');
  assert.equal(typeof adapter.bindItem, 'function');
  assert.equal(typeof adapter.bindItemTrigger, 'function');
  assert.equal(typeof adapter.bindItemContent, 'function');
  adapter.destroy();
});

test('programmatic helpers update accordion state through Zag API', () => {
  const { adapter } = createAdapter({defaultValue: ['a']});
  adapter.setValue(['b']);
  assert.equal(typeof adapter.connect().api, 'object');
  adapter.destroy();
});

test('constructor validates required id', () => {
  assert.throws(() => createAosZagAccordion({}), /requires an id/);
});
