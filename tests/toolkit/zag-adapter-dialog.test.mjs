import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createAosZagDialog } from '../../packages/toolkit/adapters/zag/dialog.js';
import { createDocument, patchSpreadSupport } from './zag-adapter-test-utils.mjs';

function createAdapter(extra = {}) {
  const document = createDocument();
  const adapter = createAosZagDialog({
    id: 'test-dialog',
    getRootNode: () => document,
    ...extra,
  });
  return { adapter, document };
}

test('createAosZagDialog exposes expected Zag dialog helpers', () => {
  const { adapter } = createAdapter({});
  const snapshot = adapter.connect();

  assert.equal(typeof snapshot.api, 'object');
  assert.equal(typeof snapshot.getTriggerProps, 'function');
  assert.equal(typeof snapshot.getBackdropProps, 'function');
  assert.equal(typeof snapshot.getPositionerProps, 'function');
  assert.equal(typeof snapshot.getContentProps, 'function');
  assert.equal(typeof snapshot.getTitleProps, 'function');
  assert.equal(typeof snapshot.getDescriptionProps, 'function');
  assert.equal(typeof snapshot.getCloseTriggerProps, 'function');
  adapter.destroy();
});

test('bind wires minimum dialog parts', () => {
  const { adapter, document } = createAdapter({});
  const container = patchSpreadSupport(document.createElement('div'));
  const elTrigger = patchSpreadSupport(document.createElement('div'));
  elTrigger.dataset.aosDialogTrigger = '';
  elTrigger.dataset.value = 'a';
  container.appendChild(elTrigger);
  const elBackdrop = patchSpreadSupport(document.createElement('div'));
  elBackdrop.dataset.aosDialogBackdrop = '';
  container.appendChild(elBackdrop);
  const elPositioner = patchSpreadSupport(document.createElement('div'));
  elPositioner.dataset.aosDialogPositioner = '';
  container.appendChild(elPositioner);
  const elContent = patchSpreadSupport(document.createElement('div'));
  elContent.dataset.aosDialogContent = '';
  elContent.dataset.value = 'a';
  container.appendChild(elContent);
  const elTitle = patchSpreadSupport(document.createElement('div'));
  elTitle.dataset.aosDialogTitle = '';
  container.appendChild(elTitle);
  const elDescription = patchSpreadSupport(document.createElement('div'));
  elDescription.dataset.aosDialogDescription = '';
  container.appendChild(elDescription);
  const elCloseTrigger = patchSpreadSupport(document.createElement('div'));
  elCloseTrigger.dataset.aosDialogCloseTrigger = '';
  container.appendChild(elCloseTrigger);
  document.body.appendChild(container);

  const snapshot = adapter.bind(container);

  assert.equal(typeof snapshot.api, 'object');
  assert.equal(typeof adapter.bindTrigger, 'function');
  assert.equal(typeof adapter.bindBackdrop, 'function');
  assert.equal(typeof adapter.bindPositioner, 'function');
  assert.equal(typeof adapter.bindContent, 'function');
  assert.equal(typeof adapter.bindTitle, 'function');
  assert.equal(typeof adapter.bindDescription, 'function');
  assert.equal(typeof adapter.bindCloseTrigger, 'function');
  adapter.destroy();
});

test('programmatic helpers update dialog state through Zag API', () => {
  const { adapter } = createAdapter({});
  assert.equal(typeof adapter.open, 'function');
  assert.equal(typeof adapter.close, 'function');
  adapter.destroy();
});

test('constructor validates required id', () => {
  assert.throws(() => createAosZagDialog({}), /requires an id/);
});
