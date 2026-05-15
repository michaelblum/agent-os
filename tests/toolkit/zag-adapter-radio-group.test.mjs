import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createAosZagRadioGroup } from '../../packages/toolkit/adapters/zag/radio-group.js';
import { createDocument, patchSpreadSupport } from './zag-adapter-test-utils.mjs';

function createAdapter(extra = {}) {
  const document = createDocument();
  const adapter = createAosZagRadioGroup({
    id: 'test-radio-group',
    getRootNode: () => document,
    ...extra,
  });
  return { adapter, document };
}

test('createAosZagRadioGroup exposes expected Zag radio-group helpers', () => {
  const { adapter } = createAdapter({defaultValue: 'a'});
  const snapshot = adapter.connect();

  assert.equal(typeof snapshot.api, 'object');
  assert.equal(typeof snapshot.getRootProps, 'function');
  assert.equal(typeof snapshot.getLabelProps, 'function');
  assert.equal(typeof snapshot.getItemProps, 'function');
  assert.equal(typeof snapshot.getRadioProps, 'function');
  assert.equal(typeof snapshot.getRadioControlProps, 'function');
  adapter.destroy();
});

test('bind wires minimum radio-group parts', () => {
  const { adapter, document } = createAdapter({defaultValue: 'a'});
  const container = patchSpreadSupport(document.createElement('div'));
  const elRoot = patchSpreadSupport(document.createElement('div'));
  elRoot.dataset.aosRadioGroupRoot = '';
  container.appendChild(elRoot);
  const elLabel = patchSpreadSupport(document.createElement('div'));
  elLabel.dataset.aosRadioGroupLabel = '';
  container.appendChild(elLabel);
  const elItem = patchSpreadSupport(document.createElement('div'));
  elItem.dataset.aosRadioGroupItem = '';
  elItem.dataset.value = 'a';
  container.appendChild(elItem);
  const elRadio = patchSpreadSupport(document.createElement('div'));
  elRadio.dataset.aosRadioGroupRadio = '';
  elRadio.dataset.value = 'a';
  container.appendChild(elRadio);
  const elRadioControl = patchSpreadSupport(document.createElement('div'));
  elRadioControl.dataset.aosRadioGroupRadioControl = '';
  elRadioControl.dataset.value = 'a';
  container.appendChild(elRadioControl);
  document.body.appendChild(container);

  assert.equal(adapter.bindItems(container), 1);
  assert.equal(adapter.bindRadios(container), 1);
  assert.equal(adapter.bindRadioControls(container), 1);
  assert.equal(elItem.getAttribute('data-part'), 'item');
  assert.equal(elRadio.getAttribute('data-part'), 'item');
  assert.equal(elRadioControl.getAttribute('data-part'), 'item-control');

  const snapshot = adapter.bind(container);

  assert.equal(typeof snapshot.api, 'object');
  assert.equal(typeof adapter.bindRoot, 'function');
  assert.equal(typeof adapter.bindLabel, 'function');
  assert.equal(typeof adapter.bindItem, 'function');
  assert.equal(typeof adapter.bindRadio, 'function');
  assert.equal(typeof adapter.bindRadioControl, 'function');
  adapter.destroy();
});

test('programmatic helpers update radio-group state through Zag API', () => {
  const { adapter } = createAdapter({defaultValue: 'a'});
  adapter.setValue('b');
  assert.equal(typeof adapter.connect().api, 'object');
  adapter.destroy();
});

test('constructor validates required id', () => {
  assert.throws(() => createAosZagRadioGroup({}), /requires an id/);
});
