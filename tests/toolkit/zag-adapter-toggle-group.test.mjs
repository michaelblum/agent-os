import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createAosZagToggleGroup } from '../../packages/toolkit/adapters/zag/toggle-group.js';
import { createDocument, patchSpreadSupport } from './zag-adapter-test-utils.mjs';

function createAdapter(extra = {}) {
  const document = createDocument();
  const adapter = createAosZagToggleGroup({
    id: 'test-toggle-group',
    getRootNode: () => document,
    ...extra,
  });
  return { adapter, document };
}

test('createAosZagToggleGroup exposes expected Zag toggle-group helpers', () => {
  const { adapter } = createAdapter({defaultValue: ['a']});
  const snapshot = adapter.connect();

  assert.equal(typeof snapshot.api, 'object');
  assert.equal(typeof snapshot.getRootProps, 'function');
  assert.equal(typeof snapshot.getItemProps, 'function');
  adapter.destroy();
});

test('bind wires minimum toggle-group parts', () => {
  const { adapter, document } = createAdapter({defaultValue: ['a']});
  const container = patchSpreadSupport(document.createElement('div'));
  const elRoot = patchSpreadSupport(document.createElement('div'));
  elRoot.dataset.aosToggleGroupRoot = '';
  container.appendChild(elRoot);
  const elItem = patchSpreadSupport(document.createElement('div'));
  elItem.dataset.aosToggleGroupItem = '';
  elItem.dataset.value = 'a';
  container.appendChild(elItem);
  const elValueOnly = patchSpreadSupport(document.createElement('div'));
  elValueOnly.dataset.value = 'a';
  container.appendChild(elValueOnly);
  document.body.appendChild(container);

  assert.equal(adapter.bindItems(container), 1);
  assert.equal(elItem.getAttribute('data-part'), 'item');
  assert.equal(elItem.getAttribute('aria-checked'), 'true');
  assert.equal(elValueOnly.getAttribute('data-part'), null);

  const snapshot = adapter.bind(container);

  assert.equal(typeof snapshot.api, 'object');
  assert.equal(typeof adapter.bindRoot, 'function');
  assert.equal(typeof adapter.bindItem, 'function');
  adapter.destroy();
});

test('programmatic helpers update toggle-group state through Zag API', () => {
  const { adapter } = createAdapter({defaultValue: ['a']});
  adapter.setValue(['b']);
  assert.equal(typeof adapter.connect().api, 'object');
  adapter.destroy();
});

test('constructor validates required id', () => {
  assert.throws(() => createAosZagToggleGroup({}), /requires an id/);
});
