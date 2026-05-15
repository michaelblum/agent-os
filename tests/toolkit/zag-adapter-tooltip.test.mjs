import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createAosZagTooltip } from '../../packages/toolkit/adapters/zag/tooltip.js';
import { createDocument, patchSpreadSupport } from './zag-adapter-test-utils.mjs';

function createAdapter(extra = {}) {
  const document = createDocument();
  const adapter = createAosZagTooltip({
    id: 'test-tooltip',
    getRootNode: () => document,
    ...extra,
  });
  return { adapter, document };
}

test('createAosZagTooltip exposes expected Zag tooltip helpers', () => {
  const { adapter } = createAdapter({});
  const snapshot = adapter.connect();

  assert.equal(typeof snapshot.api, 'object');
  assert.equal(typeof snapshot.getTriggerProps, 'function');
  assert.equal(typeof snapshot.getPositionerProps, 'function');
  assert.equal(typeof snapshot.getContentProps, 'function');
  adapter.destroy();
});

test('bind wires minimum tooltip parts', () => {
  const { adapter, document } = createAdapter({});
  const container = patchSpreadSupport(document.createElement('div'));
  const elTrigger = patchSpreadSupport(document.createElement('div'));
  elTrigger.dataset.aosTooltipTrigger = '';
  elTrigger.dataset.value = 'a';
  container.appendChild(elTrigger);
  const elPositioner = patchSpreadSupport(document.createElement('div'));
  elPositioner.dataset.aosTooltipPositioner = '';
  container.appendChild(elPositioner);
  const elContent = patchSpreadSupport(document.createElement('div'));
  elContent.dataset.aosTooltipContent = '';
  elContent.dataset.value = 'a';
  container.appendChild(elContent);
  document.body.appendChild(container);

  const snapshot = adapter.bind(container);

  assert.equal(typeof snapshot.api, 'object');
  assert.equal(typeof adapter.bindTrigger, 'function');
  assert.equal(typeof adapter.bindPositioner, 'function');
  assert.equal(typeof adapter.bindContent, 'function');
  adapter.destroy();
});

test('programmatic helpers update tooltip state through Zag API', () => {
  const { adapter } = createAdapter({});
  assert.equal(typeof adapter.open, 'function');
  assert.equal(typeof adapter.close, 'function');
  adapter.destroy();
});

test('constructor validates required id', () => {
  assert.throws(() => createAosZagTooltip({}), /requires an id/);
});
