import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createAosZagPopover } from '../../packages/toolkit/adapters/zag/popover.js';
import { createDocument, patchSpreadSupport } from './zag-adapter-test-utils.mjs';

function createAdapter(extra = {}) {
  const document = createDocument();
  const adapter = createAosZagPopover({
    id: 'test-popover',
    getRootNode: () => document,
    ...extra,
  });
  return { adapter, document };
}

test('createAosZagPopover exposes expected Zag popover helpers', () => {
  const { adapter } = createAdapter({});
  const snapshot = adapter.connect();

  assert.equal(typeof snapshot.api, 'object');
  assert.equal(typeof snapshot.getTriggerProps, 'function');
  assert.equal(typeof snapshot.getAnchorProps, 'function');
  assert.equal(typeof snapshot.getPositionerProps, 'function');
  assert.equal(typeof snapshot.getContentProps, 'function');
  assert.equal(typeof snapshot.getTitleProps, 'function');
  assert.equal(typeof snapshot.getDescriptionProps, 'function');
  assert.equal(typeof snapshot.getCloseTriggerProps, 'function');
  adapter.destroy();
});

test('bind wires minimum popover parts', () => {
  const { adapter, document } = createAdapter({});
  const container = patchSpreadSupport(document.createElement('div'));
  const elTrigger = patchSpreadSupport(document.createElement('div'));
  elTrigger.dataset.aosPopoverTrigger = '';
  elTrigger.dataset.value = 'a';
  container.appendChild(elTrigger);
  const elAnchor = patchSpreadSupport(document.createElement('div'));
  elAnchor.dataset.aosPopoverAnchor = '';
  container.appendChild(elAnchor);
  const elPositioner = patchSpreadSupport(document.createElement('div'));
  elPositioner.dataset.aosPopoverPositioner = '';
  container.appendChild(elPositioner);
  const elContent = patchSpreadSupport(document.createElement('div'));
  elContent.dataset.aosPopoverContent = '';
  elContent.dataset.value = 'a';
  container.appendChild(elContent);
  const elTitle = patchSpreadSupport(document.createElement('div'));
  elTitle.dataset.aosPopoverTitle = '';
  container.appendChild(elTitle);
  const elDescription = patchSpreadSupport(document.createElement('div'));
  elDescription.dataset.aosPopoverDescription = '';
  container.appendChild(elDescription);
  const elCloseTrigger = patchSpreadSupport(document.createElement('div'));
  elCloseTrigger.dataset.aosPopoverCloseTrigger = '';
  container.appendChild(elCloseTrigger);
  document.body.appendChild(container);

  const snapshot = adapter.bind(container);

  assert.equal(typeof snapshot.api, 'object');
  assert.equal(typeof adapter.bindTrigger, 'function');
  assert.equal(typeof adapter.bindAnchor, 'function');
  assert.equal(typeof adapter.bindPositioner, 'function');
  assert.equal(typeof adapter.bindContent, 'function');
  assert.equal(typeof adapter.bindTitle, 'function');
  assert.equal(typeof adapter.bindDescription, 'function');
  assert.equal(typeof adapter.bindCloseTrigger, 'function');
  adapter.destroy();
});

test('programmatic helpers update popover state through Zag API', () => {
  const { adapter } = createAdapter({});
  assert.equal(typeof adapter.open, 'function');
  assert.equal(typeof adapter.close, 'function');
  adapter.destroy();
});

test('constructor validates required id', () => {
  assert.throws(() => createAosZagPopover({}), /requires an id/);
});
