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
  const elIndexOnly = patchSpreadSupport(document.createElement('div'));
  elIndexOnly.dataset.index = '0';
  container.appendChild(elIndexOnly);
  const elOutput = patchSpreadSupport(document.createElement('div'));
  elOutput.dataset.aosSliderOutput = '';
  container.appendChild(elOutput);
  document.body.appendChild(container);

  assert.equal(adapter.bindThumbs(container), 1);
  assert.equal(elThumb.getAttribute('role'), 'slider');
  assert.equal(elThumb.getAttribute('aria-valuenow'), '25');
  assert.equal(elIndexOnly.getAttribute('role'), null);

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

test('pointer drag emits shared gesture frames while preserving preview and commit', () => {
  const frames = [];
  const changes = [];
  const commits = [];
  const { adapter, document } = createAdapter({
    defaultValue: [0],
    min: 0,
    max: 100,
    step: 10,
    onGestureFrame(frame) {
      frames.push(frame);
    },
    onValueChange(details) {
      changes.push({ value: details.value, type: details.gestureFrame?.type });
    },
    onValueChangeEnd(details) {
      commits.push({ value: details.value, type: details.gestureFrame?.type });
    },
  });
  const control = patchSpreadSupport(document.createElement('div'));
  control.dataset.aosSliderControl = '';
  control.dataset.semanticTargetId = 'settings.opacity';
  control.dataset.aosRef = 'panel:settings.opacity';
  control.dataset.aosActions = 'drag set-value';
  control.getBoundingClientRect = () => ({ left: 10, top: 0, width: 200, height: 24 });
  document.body.appendChild(control);
  adapter.bindControl(control);

  control.dispatchEvent({ type: 'pointerdown', pointerId: 4, clientX: 10, clientY: 12, currentTarget: control, preventDefault() {} });
  document.dispatchEvent({ type: 'pointermove', pointerId: 4, clientX: 110, clientY: 12, preventDefault() {} });
  document.dispatchEvent({ type: 'pointerup', pointerId: 4, clientX: 150, clientY: 12, preventDefault() {} });

  assert.deepEqual(frames.map((frame) => frame.type), [
    'gesture.drag.start',
    'gesture.drag.move',
    'gesture.drag.end',
  ]);
  assert.equal(frames[0].semantic_target.id, 'settings.opacity');
  assert.equal(frames[0].semantic_action, 'set-value');
  assert.deepEqual(changes, [
    { value: [50], type: 'gesture.drag.move' },
    { value: [70], type: 'gesture.drag.end' },
  ]);
  assert.deepEqual(commits, [
    { value: [70], type: 'gesture.drag.end' },
  ]);
  adapter.destroy();
});

test('constructor validates required id', () => {
  assert.throws(() => createAosZagSlider({}), /requires an id/);
});
