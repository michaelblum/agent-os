import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createColorField, createSlider, renderColorFieldHtml, renderSliderHtml } from '../../packages/toolkit/controls/index.js';
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
