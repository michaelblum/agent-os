import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createColorField, createSlider, renderColorFieldHtml, renderSliderHtml } from '../../packages/toolkit/controls/index.js';
import {
  createToolkitSliderVisualObjectDescriptor,
} from '../../packages/toolkit/workbench/visual-object-contract.js';
import { applyVisualObjectControllerUpdate } from '../../packages/toolkit/workbench/visual-object-controller.js';
import {
  createVisualObjectResourceLifecycleEvidence,
  validateVisualObjectResourceLifecycleEvidence,
} from '../../packages/toolkit/workbench/visual-object-resource-lifecycle.js';
import { FakeEvent, createFakeDocument } from './dom-fixture.mjs';
import { createDocument, patchSpreadSupport } from './zag-adapter-test-utils.mjs';

function createPatchedDocument() {
  const document = createDocument();
  const createElement = document.createElement.bind(document);
  document.createElement = (tagName) => patchSpreadSupport(createElement(tagName));
  return document;
}

test('createSlider exposes single-thumb value through Zag slider semantics', () => {
  const document = createPatchedDocument();
  const slider = createSlider({
    document,
    label: 'Opacity',
    value: 0.45,
    min: 0,
    max: 1,
    step: 0.05,
    unit: 'x',
  });
  const thumb = slider.el.querySelector('[data-aos-slider-thumb]');
  const output = slider.el.querySelector('[data-aos-slider-output]');
  const changes = [];

  slider.on('change', (value) => changes.push(value));
  assert.equal(slider.getValue(), 0.45);
  assert.deepEqual(slider.getValues(), [0.45]);
  assert.equal(thumb.getAttribute('role'), 'slider');
  assert.equal(thumb.getAttribute('aria-valuenow'), '0.45');
  assert.equal(output.textContent, '0.45 x');

  slider.setValue(0.75, { emit: true });

  assert.equal(slider.getValue(), 0.75);
  assert.deepEqual(changes, [0.75]);
  assert.equal(output.textContent, '0.75 x');
});

test('slider descriptor mutation syncs through setValue without replacing the root element', () => {
  const document = createPatchedDocument();
  const slider = createSlider({
    document,
    id: 'opacity-control',
    label: 'Opacity',
    value: 0.2,
    min: 0,
    max: 1,
    step: 0.05,
  });
  const descriptor = createToolkitSliderVisualObjectDescriptor({
    id: 'toolkit-slider-opacity',
    label: 'Opacity',
    state_path: 'toolkit.controls.opacity.value',
    min: 0,
    max: 1,
    step: 0.05,
    object_ids: ['dom.aos-slider.opacity'],
  });
  const state = { toolkit: { controls: { opacity: { value: 0.2 } } } };
  const root = slider.el;

  let result;
  const editValues = ['0.35', '0.5', '0.65', '0.8', '0.65'];
  for (const value of editValues) {
    result = applyVisualObjectControllerUpdate(descriptor, value, state, {
      routeHandlers: {
        'dom_toolkit.control.value.patch': ({ mutation }) => mutation.state_path,
      },
      rendererSyncHandlers: {
        syncDomControlValue: ({ mutation }) => slider.setValue(mutation.value),
      },
    });
  }

  assert.equal(result.route, 'dom_toolkit.control.value.patch');
  assert.equal(result.route_outcome.status, 'called');
  assert.deepEqual(result.sync_outcomes, [{ label: 'syncDomControlValue', status: 'called', value: undefined }]);
  assert.equal(state.toolkit.controls.opacity.value, 0.65);
  assert.equal(slider.el, root);
  assert.equal(slider.getValue(), 0.65);
  assert.equal(slider.el.querySelector('[data-aos-slider-output]').textContent, '0.65');
  const evidence = createVisualObjectResourceLifecycleEvidence({
    descriptor,
    updateResult: result,
    rendererSync: ['syncDomControlValue'],
    editCount: editValues.length,
    retainedResources: [root],
    retainedResourceLimit: 1,
    identityStable: slider.el === root,
    poolingBoundary: {
      owner: 'toolkit-dom-control',
      decision: 'not-applicable',
      rationale: 'The DOM slider proof retains a root element and serializable state; material and geometry pools are renderer-local concerns.',
    },
    jsonSerializableState: state,
  });
  assert.equal(evidence.identity_stable, true);
  assert.equal(validateVisualObjectResourceLifecycleEvidence(evidence).ok, true);
  assert.deepEqual(JSON.parse(JSON.stringify(state)), state);
});

test('createSlider preserves array value shape for two-thumb sliders', () => {
  const document = createPatchedDocument();
  const slider = createSlider({
    document,
    value: [0.2, 0.8],
    min: 0,
    max: 1,
    step: 0.05,
  });

  assert.deepEqual(slider.getValue(), [0.2, 0.8]);
  assert.deepEqual(slider.getValues(), [0.2, 0.8]);
  assert.equal(slider.el.querySelectorAll('[data-aos-slider-thumb]').length, 2);

  slider.setValue([0.3, 0.7]);

  assert.deepEqual(slider.getValue(), [0.3, 0.7]);
  assert.equal(slider.el.querySelectorAll('[data-aos-slider-thumb]').length, 2);
});

test('createColorField exposes hex value and falls back for invalid colors', () => {
  const document = createFakeDocument();
  const color = createColorField({ document, label: 'Face', value: '#112233' });
  const input = color.el.querySelector('input[type="color"]');
  const changes = [];

  color.on('change', (value) => changes.push(value));
  assert.equal(color.getValue(), '#112233');

  input.value = '#445566';
  input.dispatchEvent(new FakeEvent('change', { bubbles: true }));

  assert.deepEqual(changes, ['#445566']);
  color.setValue('not-a-color');
  assert.equal(color.getValue(), '#000000');
});

test('slider and color render helpers emit semantic markup', () => {
  assert.match(renderSliderHtml({ label: 'Scale', value: 2, min: 0, max: 4, step: 0.25 }), /data-aos-slider-root/);
  assert.match(renderSliderHtml({ label: 'Scale', value: [1, 3] }), /data-index="1"/);
  assert.match(renderColorFieldHtml({ label: 'Face', value: '#abcdef' }), /type="color"/);
  assert.match(renderColorFieldHtml({ label: 'Face', value: 'bad' }), /value="#000000"/);
});
