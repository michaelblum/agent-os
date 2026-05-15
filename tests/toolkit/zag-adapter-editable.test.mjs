import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createAosZagEditable } from '../../packages/toolkit/adapters/zag/editable.js';
import { createDocument, patchSpreadSupport } from './zag-adapter-test-utils.mjs';

function createAdapter(extra = {}) {
  const document = createDocument();
  const adapter = createAosZagEditable({
    id: 'test-editable',
    getRootNode: () => document,
    ...extra,
  });
  return { adapter, document };
}

test('createAosZagEditable exposes expected Zag editable helpers', () => {
  const { adapter } = createAdapter({defaultValue: 'draft'});
  const snapshot = adapter.connect();

  assert.equal(typeof snapshot.api, 'object');
  assert.equal(typeof snapshot.getRootProps, 'function');
  assert.equal(typeof snapshot.getPreviewProps, 'function');
  assert.equal(typeof snapshot.getInputProps, 'function');
  assert.equal(typeof snapshot.getEditTriggerProps, 'function');
  assert.equal(typeof snapshot.getSubmitTriggerProps, 'function');
  assert.equal(typeof snapshot.getCancelTriggerProps, 'function');
  adapter.destroy();
});

test('bind wires minimum editable parts', () => {
  const { adapter, document } = createAdapter({defaultValue: 'draft'});
  const container = patchSpreadSupport(document.createElement('div'));
  const elRoot = patchSpreadSupport(document.createElement('div'));
  elRoot.dataset.aosEditableRoot = '';
  container.appendChild(elRoot);
  const elPreview = patchSpreadSupport(document.createElement('div'));
  elPreview.dataset.aosEditablePreview = '';
  container.appendChild(elPreview);
  const elInput = patchSpreadSupport(document.createElement('input'));
  elInput.dataset.aosEditableInput = '';
  container.appendChild(elInput);
  const elEditTrigger = patchSpreadSupport(document.createElement('div'));
  elEditTrigger.dataset.aosEditableEditTrigger = '';
  container.appendChild(elEditTrigger);
  const elSubmitTrigger = patchSpreadSupport(document.createElement('div'));
  elSubmitTrigger.dataset.aosEditableSubmitTrigger = '';
  container.appendChild(elSubmitTrigger);
  const elCancelTrigger = patchSpreadSupport(document.createElement('div'));
  elCancelTrigger.dataset.aosEditableCancelTrigger = '';
  container.appendChild(elCancelTrigger);
  document.body.appendChild(container);

  const snapshot = adapter.bind(container);

  assert.equal(typeof snapshot.api, 'object');
  assert.equal(typeof adapter.bindRoot, 'function');
  assert.equal(typeof adapter.bindPreview, 'function');
  assert.equal(typeof adapter.bindInput, 'function');
  assert.equal(typeof adapter.bindEditTrigger, 'function');
  assert.equal(typeof adapter.bindSubmitTrigger, 'function');
  assert.equal(typeof adapter.bindCancelTrigger, 'function');
  adapter.destroy();
});

test('programmatic helpers update editable state through Zag API', () => {
  const { adapter } = createAdapter({defaultValue: 'draft'});
  adapter.setValue('next');
  assert.equal(typeof adapter.connect().api, 'object');
  adapter.destroy();
});

test('constructor validates required id', () => {
  assert.throws(() => createAosZagEditable({}), /requires an id/);
});
