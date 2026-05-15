import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createAosZagTagsInput } from '../../packages/toolkit/adapters/zag/tags-input.js';
import { createDocument, patchSpreadSupport } from './zag-adapter-test-utils.mjs';

function createAdapter(extra = {}) {
  const document = createDocument();
  const adapter = createAosZagTagsInput({
    id: 'test-tags-input',
    getRootNode: () => document,
    ...extra,
  });
  return { adapter, document };
}

test('createAosZagTagsInput exposes expected Zag tags-input helpers', () => {
  const { adapter } = createAdapter({defaultValue: ['a']});
  const snapshot = adapter.connect();

  assert.equal(typeof snapshot.api, 'object');
  assert.equal(typeof snapshot.getRootProps, 'function');
  assert.equal(typeof snapshot.getLabelProps, 'function');
  assert.equal(typeof snapshot.getControlProps, 'function');
  assert.equal(typeof snapshot.getInputProps, 'function');
  assert.equal(typeof snapshot.getItemProps, 'function');
  adapter.destroy();
});

test('bind wires minimum tags-input parts', () => {
  const { adapter, document } = createAdapter({defaultValue: ['a']});
  const container = patchSpreadSupport(document.createElement('div'));
  const elRoot = patchSpreadSupport(document.createElement('div'));
  elRoot.dataset.aosTagsInputRoot = '';
  container.appendChild(elRoot);
  const elLabel = patchSpreadSupport(document.createElement('div'));
  elLabel.dataset.aosTagsInputLabel = '';
  container.appendChild(elLabel);
  const elControl = patchSpreadSupport(document.createElement('div'));
  elControl.dataset.aosTagsInputControl = '';
  container.appendChild(elControl);
  const elInput = patchSpreadSupport(document.createElement('input'));
  elInput.dataset.aosTagsInputInput = '';
  container.appendChild(elInput);
  const elItem = patchSpreadSupport(document.createElement('div'));
  elItem.dataset.aosTagsInputItem = '';
  elItem.dataset.value = 'a';
  container.appendChild(elItem);
  const elValueOnly = patchSpreadSupport(document.createElement('div'));
  elValueOnly.dataset.value = 'a';
  container.appendChild(elValueOnly);
  document.body.appendChild(container);

  assert.equal(adapter.bindItems(container), 1);
  assert.equal(elItem.getAttribute('data-part'), 'item');
  assert.equal(elItem.getAttribute('data-value'), 'a');
  assert.equal(elValueOnly.getAttribute('data-part'), null);

  const snapshot = adapter.bind(container);

  assert.equal(typeof snapshot.api, 'object');
  assert.equal(typeof adapter.bindRoot, 'function');
  assert.equal(typeof adapter.bindLabel, 'function');
  assert.equal(typeof adapter.bindControl, 'function');
  assert.equal(typeof adapter.bindInput, 'function');
  assert.equal(typeof adapter.bindItem, 'function');
  adapter.destroy();
});

test('programmatic helpers update tags-input state through Zag API', () => {
  const { adapter } = createAdapter({defaultValue: ['a']});
  adapter.setValue(['b']);
  assert.equal(typeof adapter.connect().api, 'object');
  adapter.setInputValue('new');
  assert.equal(typeof adapter.connect().api, 'object');
  adapter.destroy();
});

test('constructor validates required id', () => {
  assert.throws(() => createAosZagTagsInput({}), /requires an id/);
});
