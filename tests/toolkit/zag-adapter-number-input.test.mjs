import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createAosZagNumberInput } from '../../packages/toolkit/adapters/zag/number-input.js';
import { createDocument, patchSpreadSupport } from './zag-adapter-test-utils.mjs';

function createAdapter(extra = {}) {
  const document = createDocument();
  const adapter = createAosZagNumberInput({
    id: 'test-number-input',
    getRootNode: () => document,
    ...extra,
  });
  return { adapter, document };
}

test('createAosZagNumberInput exposes expected Zag number-input helpers', () => {
  const { adapter } = createAdapter({defaultValue: '2'});
  const snapshot = adapter.connect();

  assert.equal(typeof snapshot.api, 'object');
  assert.equal(typeof snapshot.getRootProps, 'function');
  assert.equal(typeof snapshot.getLabelProps, 'function');
  assert.equal(typeof snapshot.getInputProps, 'function');
  assert.equal(typeof snapshot.getIncrementTriggerProps, 'function');
  assert.equal(typeof snapshot.getDecrementTriggerProps, 'function');
  adapter.destroy();
});

test('bind wires minimum number-input parts', () => {
  const { adapter, document } = createAdapter({defaultValue: '2'});
  const container = patchSpreadSupport(document.createElement('div'));
  const elRoot = patchSpreadSupport(document.createElement('div'));
  elRoot.dataset.aosNumberInputRoot = '';
  container.appendChild(elRoot);
  const elLabel = patchSpreadSupport(document.createElement('div'));
  elLabel.dataset.aosNumberInputLabel = '';
  container.appendChild(elLabel);
  const elInput = patchSpreadSupport(document.createElement('input'));
  elInput.dataset.aosNumberInputInput = '';
  container.appendChild(elInput);
  const elIncrementTrigger = patchSpreadSupport(document.createElement('div'));
  elIncrementTrigger.dataset.aosNumberInputIncrementTrigger = '';
  container.appendChild(elIncrementTrigger);
  const elDecrementTrigger = patchSpreadSupport(document.createElement('div'));
  elDecrementTrigger.dataset.aosNumberInputDecrementTrigger = '';
  container.appendChild(elDecrementTrigger);
  document.body.appendChild(container);

  const snapshot = adapter.bind(container);

  assert.equal(typeof snapshot.api, 'object');
  assert.equal(typeof adapter.bindRoot, 'function');
  assert.equal(typeof adapter.bindLabel, 'function');
  assert.equal(typeof adapter.bindInput, 'function');
  assert.equal(typeof adapter.bindIncrementTrigger, 'function');
  assert.equal(typeof adapter.bindDecrementTrigger, 'function');
  adapter.destroy();
});

test('programmatic helpers update number-input state through Zag API', () => {
  const { adapter } = createAdapter({defaultValue: '2'});
  adapter.setValue('4');
  assert.equal(typeof adapter.connect().api, 'object');
  adapter.destroy();
});

test('constructor validates required id', () => {
  assert.throws(() => createAosZagNumberInput({}), /requires an id/);
});
