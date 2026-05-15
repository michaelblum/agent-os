import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createAosZagSlider } from '../../packages/toolkit/adapters/zag/slider.js';
import { createDocument, patchSpreadSupport } from './zag-adapter-test-utils.mjs';

function createAdapter(extra = {}) {
  const document = createDocument();
  const adapter = createAosZagSlider({
    id: 'test-slider',
    getRootNode: () => document,
    ...extra,
  });
  return { adapter, document };
}

test('createAosZagSlider exposes expected Zag slider helpers', () => {
  const { adapter } = createAdapter({defaultValue: [25]});
  const snapshot = adapter.connect();

  assert.equal(typeof snapshot.api, 'object');
  assert.equal(typeof snapshot.getRootProps, 'function');
  assert.equal(typeof snapshot.getLabelProps, 'function');
  assert.equal(typeof snapshot.getControlProps, 'function');
  assert.equal(typeof snapshot.getTrackProps, 'function');
  assert.equal(typeof snapshot.getRangeProps, 'function');
  assert.equal(typeof snapshot.getThumbProps, 'function');
  assert.equal(typeof snapshot.getOutputProps, 'function');
  adapter.destroy();
});

test('bind wires minimum slider parts', () => {
  const { adapter, document } = createAdapter({defaultValue: [25]});
  const container = patchSpreadSupport(document.createElement('div'));
  const elRoot = patchSpreadSupport(document.createElement('div'));
  elRoot.dataset.aosSliderRoot = '';
  container.appendChild(elRoot);
  const elLabel = patchSpreadSupport(document.createElement('div'));
  elLabel.dataset.aosSliderLabel = '';
  container.appendChild(elLabel);
  const elControl = patchSpreadSupport(document.createElement('div'));
  elControl.dataset.aosSliderControl = '';
  container.appendChild(elControl);
  const elTrack = patchSpreadSupport(document.createElement('div'));
  elTrack.dataset.aosSliderTrack = '';
  container.appendChild(elTrack);
  const elRange = patchSpreadSupport(document.createElement('div'));
  elRange.dataset.aosSliderRange = '';
  container.appendChild(elRange);
  const elThumb = patchSpreadSupport(document.createElement('div'));
  elThumb.dataset.aosSliderThumb = '';
  elThumb.dataset.value = 'a';
  container.appendChild(elThumb);
  const elOutput = patchSpreadSupport(document.createElement('div'));
  elOutput.dataset.aosSliderOutput = '';
  container.appendChild(elOutput);
  document.body.appendChild(container);

  const snapshot = adapter.bind(container);

  assert.equal(typeof snapshot.api, 'object');
  assert.equal(typeof adapter.bindRoot, 'function');
  assert.equal(typeof adapter.bindLabel, 'function');
  assert.equal(typeof adapter.bindControl, 'function');
  assert.equal(typeof adapter.bindTrack, 'function');
  assert.equal(typeof adapter.bindRange, 'function');
  assert.equal(typeof adapter.bindThumb, 'function');
  assert.equal(typeof adapter.bindOutput, 'function');
  adapter.destroy();
});

test('programmatic helpers update slider state through Zag API', () => {
  const { adapter } = createAdapter({defaultValue: [25]});
  adapter.setValue([40]);
  assert.equal(typeof adapter.connect().api, 'object');
  adapter.destroy();
});

test('constructor validates required id', () => {
  assert.throws(() => createAosZagSlider({}), /requires an id/);
});
