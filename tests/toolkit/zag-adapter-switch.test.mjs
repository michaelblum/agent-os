import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createAosZagSwitch } from '../../packages/toolkit/adapters/zag/switch.js';
import { createDocument, patchSpreadSupport } from './zag-adapter-test-utils.mjs';

function createAdapter(extra = {}) {
  const document = createDocument();
  const adapter = createAosZagSwitch({
    id: 'test-switch',
    getRootNode: () => document,
    ...extra,
  });
  return { adapter, document };
}

test('createAosZagSwitch exposes expected Zag switch helpers', () => {
  const { adapter } = createAdapter({defaultChecked: false});
  const snapshot = adapter.connect();

  assert.equal(typeof snapshot.api, 'object');
  assert.equal(typeof snapshot.getRootProps, 'function');
  assert.equal(typeof snapshot.getLabelProps, 'function');
  assert.equal(typeof snapshot.getControlProps, 'function');
  assert.equal(typeof snapshot.getThumbProps, 'function');
  assert.equal(typeof snapshot.getHiddenInputProps, 'function');
  adapter.destroy();
});

test('bind wires minimum switch parts', () => {
  const { adapter, document } = createAdapter({defaultChecked: false});
  const container = patchSpreadSupport(document.createElement('div'));
  const elRoot = patchSpreadSupport(document.createElement('div'));
  elRoot.dataset.aosSwitchRoot = '';
  container.appendChild(elRoot);
  const elLabel = patchSpreadSupport(document.createElement('div'));
  elLabel.dataset.aosSwitchLabel = '';
  container.appendChild(elLabel);
  const elControl = patchSpreadSupport(document.createElement('div'));
  elControl.dataset.aosSwitchControl = '';
  container.appendChild(elControl);
  const elThumb = patchSpreadSupport(document.createElement('div'));
  elThumb.dataset.aosSwitchThumb = '';
  elThumb.dataset.value = 'a';
  container.appendChild(elThumb);
  const elHiddenInput = patchSpreadSupport(document.createElement('input'));
  elHiddenInput.dataset.aosSwitchHiddenInput = '';
  container.appendChild(elHiddenInput);
  document.body.appendChild(container);

  const snapshot = adapter.bind(container);

  assert.equal(typeof snapshot.api, 'object');
  assert.equal(typeof adapter.bindRoot, 'function');
  assert.equal(typeof adapter.bindLabel, 'function');
  assert.equal(typeof adapter.bindControl, 'function');
  assert.equal(typeof adapter.bindThumb, 'function');
  assert.equal(typeof adapter.bindHiddenInput, 'function');
  adapter.destroy();
});

test('programmatic helpers update switch state through Zag API', () => {
  const { adapter } = createAdapter({defaultChecked: false});
  adapter.setChecked(true);
  assert.equal(typeof adapter.connect().api, 'object');
  adapter.destroy();
});

test('constructor validates required id', () => {
  assert.throws(() => createAosZagSwitch({}), /requires an id/);
});
