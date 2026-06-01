import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createForm } from '../../packages/toolkit/panel/form.js';
import { FakeEvent, createFakeDocument } from './dom-fixture.mjs';
import { createDocument, patchSpreadSupport } from './zag-adapter-test-utils.mjs';

const gateFields = [
  {
    id: 'decision',
    kind: 'exclusive_choice',
    style: 'buttons',
    required: true,
    options: [
      { value: 'yes', label: 'Yes' },
      { value: 'no', label: 'No' },
      { value: 'other', label: 'Something else' },
    ],
  },
  {
    id: 'other_text',
    kind: 'text',
    required: true,
    placeholder: 'Something else...',
    visible_when: { field: 'decision', equals: 'other' },
  },
  {
    id: 'notes',
    kind: 'text',
    required: false,
    placeholder: 'Optional notes',
  },
];

function createPatchedDocument() {
  const document = createDocument();
  const createElement = document.createElement.bind(document);
  document.createElement = (tagName) => patchSpreadSupport(createElement(tagName));
  return document;
}

function mount(fields = gateFields, options = {}) {
  const document = options.zag ? createPatchedDocument() : createFakeDocument();
  const container = document.createElement('section');
  document.body.appendChild(container);
  const form = createForm(container, fields);
  return { document, container, form };
}

function setRect(element, rect) {
  element.getBoundingClientRect = () => ({
    left: rect.left,
    top: rect.top,
    width: rect.width,
    height: rect.height,
    right: rect.left + rect.width,
    bottom: rect.top + rect.height,
  });
}

test('createForm renders gate fields through toolkit controls', () => {
  const { form } = mount([
    {
      id: 'decision',
      kind: 'exclusive_choice',
      options: [
        { value: 'yes', label: 'Yes' },
        { value: 'no', label: 'No' },
      ],
    },
    {
      id: 'flags',
      kind: 'multi_choice',
      options: [
        { value: 'a', label: 'A' },
        { value: 'b', label: 'B' },
      ],
    },
    { id: 'enabled', kind: 'boolean', value: true },
    { id: 'name', kind: 'text', value: 'Run' },
    { id: 'count', kind: 'number', value: 2 },
  ], { zag: true });

  assert.equal(form.el.querySelectorAll('.aos-form-field').length, 5);
  assert.equal(form.el.querySelectorAll('.aos-segmented button').length, 2);
  assert.equal(form.el.querySelectorAll('input[type="checkbox"]').length, 3);
  assert.equal(form.el.querySelectorAll('.aos-text-input').length, 1);
  assert.equal(form.el.querySelectorAll('.aos-number-field').length, 1);
});

test('getValues returns current visible form state as a plain object', () => {
  const { form } = mount();

  assert.deepEqual(form.getValues(), { decision: null, notes: '' });

  form.setValues({ decision: 'yes', notes: 'ship' });
  assert.deepEqual(form.getValues(), { decision: 'yes', notes: 'ship' });
});

test('visible_when fields are revealed reactively and hidden values are omitted', () => {
  const { form } = mount();
  const fieldEls = form.el.querySelectorAll('.aos-form-field');
  const buttons = form.el.querySelectorAll('button');

  assert.equal(fieldEls[1].classList.contains('hidden'), true);
  buttons[2].dispatchEvent(new FakeEvent('click', { bubbles: true }));

  assert.equal(fieldEls[1].classList.contains('hidden'), false);
  assert.deepEqual(form.getValues(), { decision: 'other', other_text: '', notes: '' });
});

test('visible_when matches numeric select values without string coercion leaks', () => {
  const { form } = mount([
    {
      id: 'shape',
      kind: 'select',
      value: 12,
      options: [
        { value: 12, label: 'Dodecahedron' },
        { value: 93, label: 'Prism' },
      ],
    },
    {
      id: 'prism_sides',
      kind: 'slider',
      value: 32,
      min: 3,
      max: 64,
      step: 1,
      visible_when: { field: 'shape', equals: 93 },
    },
  ], { zag: true });

  assert.equal(form.getField('prism_sides').hidden, true);

  form.setValues({ shape: '93' });

  assert.equal(form.getField('prism_sides').hidden, false);
  assert.deepEqual(form.getValues(), { shape: 93, prism_sides: 32 });
});

test('refreshVisibility reevaluates hidden fields after silent control changes', () => {
  const { form } = mount([
    {
      id: 'shape',
      kind: 'select',
      value: 12,
      options: [
        { value: 12, label: 'Dodecahedron' },
        { value: 90, label: 'Tetartoid' },
      ],
    },
    {
      id: 'tetartoid_a',
      kind: 'slider',
      value: 1,
      min: 0.01,
      max: 2,
      step: 0.01,
      visible_when: { field: 'shape', equals: 90 },
    },
  ], { zag: true });

  form.getField('shape').control.setValue(90, { emit: false });
  assert.equal(form.getField('tetartoid_a').hidden, true);

  form.refreshVisibility();

  assert.equal(form.getField('tetartoid_a').hidden, false);
});

test('isValid is true only when visible required fields are satisfied', () => {
  const { form } = mount();

  assert.equal(form.isValid(), false);

  form.setValues({ decision: 'yes' });
  assert.equal(form.isValid(), true);

  form.setValues({ decision: 'other', other_text: '' });
  assert.equal(form.isValid(), false);

  form.setValues({ other_text: 'use a different route' });
  assert.equal(form.isValid(), true);
});

test('onChange callback receives current values on field change', () => {
  const { form } = mount();
  const changes = [];
  const unsubscribe = form.onChange((values) => changes.push(values));
  const buttons = form.el.querySelectorAll('button');

  buttons[0].dispatchEvent(new FakeEvent('click', { bubbles: true }));

  assert.deepEqual(changes, [{ decision: 'yes', notes: '' }]);
  unsubscribe();

  buttons[1].dispatchEvent(new FakeEvent('click', { bubbles: true }));
  assert.equal(changes.length, 1);
});

test('onFieldChange callback receives field-level binding payloads without changing onChange values', () => {
  const valueChanges = [];
  const fieldChanges = [];
  const document = createPatchedDocument();
  const container = document.createElement('section');
  document.body.appendChild(container);
  const form = createForm(container, [{
    id: 'opacity',
    descriptor_id: 'toolkit-slider-opacity',
    kind: 'slider',
    value: 0.25,
    min: 0,
    max: 1,
    step: 0.05,
    binding: {
      state_path: 'toolkit.controls.opacity.value',
      route: 'dom_toolkit.control.value.patch',
    },
  }], {
    onChange: (values) => valueChanges.push(values),
    onFieldChange: (change) => fieldChanges.push(change),
  });

  form.getField('opacity').control.setValue(0.5, { emit: true });

  assert.deepEqual(valueChanges, [{ opacity: 0.5 }]);
  assert.equal(fieldChanges.length, 1);
  assert.equal(fieldChanges[0].field_id, 'opacity');
  assert.equal(fieldChanges[0].value, 0.5);
  assert.equal(fieldChanges[0].field.descriptor_id, 'toolkit-slider-opacity');
  assert.equal(fieldChanges[0].binding.state_path, 'toolkit.controls.opacity.value');
  assert.equal(fieldChanges[0].metadata.descriptorId, 'toolkit-slider-opacity');
});

test('getControlRecords exposes normalized AOS control targets for agent operation', () => {
  const { form } = mount([
    {
      id: 'mode',
      descriptor_id: 'avatar-mode',
      kind: 'radio_group',
      label: 'Mode',
      value: 'alpha',
      options: [
        { value: 'alpha', label: 'Alpha' },
        { value: 'omega', label: 'Omega' },
      ],
    },
    {
      id: 'opacity',
      descriptor_id: 'avatar-opacity',
      kind: 'slider',
      label: 'Opacity',
      value: 0.55,
      min: 0,
      max: 1,
      step: 0.05,
    },
  ], { zag: true });
  const [alphaButton, omegaButton] = form.getField('mode').control.el.querySelectorAll('button');
  const sliderControl = form.getField('opacity').control.el.querySelector('[data-aos-slider-control]');

  setRect(alphaButton, { left: 10, top: 20, width: 50, height: 24 });
  setRect(omegaButton, { left: 64, top: 20, width: 60, height: 24 });
  setRect(sliderControl, { left: 10, top: 72, width: 160, height: 28 });

  const records = form.getControlRecords();
  const mode = records.find((record) => record.descriptor_id === 'avatar-mode');
  const opacity = form.getControlRecord('opacity');

  assert.equal(mode.id, 'avatar-mode');
  assert.equal(mode.field_id, 'mode');
  assert.equal(mode.ref, 'toolkit.panel.form:avatar-mode');
  assert.equal(mode.aosRef, 'toolkit.panel.form:avatar-mode');
  assert.equal(mode.ref, `${mode.surface}:${mode.id}`);
  assert.equal(mode.role, 'radiogroup');
  assert.equal(mode.name, 'Mode');
  assert.equal(mode.value, 'alpha');
  assert.deepEqual(mode.actions, ['select']);
  assert.deepEqual(mode.options.map(({ value, label, selected, frame }) => ({
    value,
    label,
    selected,
    frame,
  })), [
    { value: 'alpha', label: 'Alpha', selected: true, frame: { x: 10, y: 20, width: 50, height: 24 } },
    { value: 'omega', label: 'Omega', selected: false, frame: { x: 64, y: 20, width: 60, height: 24 } },
  ]);
  assert.equal(opacity.id, 'avatar-opacity');
  assert.equal(opacity.field_id, 'opacity');
  assert.equal(opacity.ref, 'toolkit.panel.form:avatar-opacity');
  assert.equal(opacity.aosRef, 'toolkit.panel.form:avatar-opacity');
  assert.equal(opacity.ref, `${opacity.surface}:${opacity.id}`);
  assert.equal(opacity.role, 'slider');
  assert.equal(opacity.name, 'Opacity');
  assert.equal(opacity.value, 0.55);
  assert.deepEqual(opacity.frame, { x: 10, y: 72, width: 160, height: 28 });
  assert.deepEqual(opacity.actions, ['drag', 'set-value']);
});

test('createForm renders sectioned data-editor fields with binding metadata', () => {
  const { form } = mount([
    {
      kind: 'section',
      id: 'shape',
      label: 'Shape',
      description: 'Canonical avatar shape controls',
      controls: [
        {
          id: 'geometry',
          kind: 'select',
          label: 'Geometry',
          value: '8',
          options: [
            { value: '8', label: 'Dodecahedron' },
            { value: '12', label: 'Icosahedron' },
          ],
          binding: {
            state_path: 'avatar.primary.shape.geometry',
            route: 'canvas_object.transform.patch',
            object_ids: ['avatar.primary.shape'],
          },
        },
        {
          id: 'opacity',
          kind: 'slider',
          label: 'Opacity',
          value: 0.55,
          min: 0,
          max: 1,
          step: 0.05,
          unit: 'alpha',
        },
        { id: 'face', kind: 'color', label: 'Face', value: '#112233' },
        { id: 'notes', kind: 'textarea', label: 'Notes', value: 'draft' },
      ],
    },
  ], { zag: true });

  assert.equal(form.el.querySelectorAll('.aos-form-section').length, 1);
  assert.equal(form.el.querySelectorAll('.aos-form-field').length, 4);
  assert.equal(form.el.querySelectorAll('[data-aos-slider-root]').length, 1);
  assert.equal(form.el.querySelectorAll('input[type="color"]').length, 1);
  assert.equal(form.el.querySelectorAll('textarea').length, 1);
  assert.deepEqual(form.getValues(), {
    geometry: '8',
    opacity: 0.55,
    face: '#112233',
    notes: 'draft',
  });

  const geometry = form.getField('geometry');
  assert.equal(geometry.el.dataset.statePath, 'avatar.primary.shape.geometry');
  assert.equal(geometry.el.dataset.route, 'canvas_object.transform.patch');
  assert.equal(geometry.el.dataset.objectIds, 'avatar.primary.shape');
});

test('createForm maps radio groups and single checkboxes for editor surfaces', () => {
  const { form } = mount([
    {
      id: 'mode',
      kind: 'radio_group',
      value: 'alpha',
      options: [
        { value: 'alpha', label: 'Alpha' },
        { value: 'omega', label: 'Omega' },
      ],
    },
    { id: 'enabled', kind: 'checkbox', value: true },
  ], { zag: true });

  assert.equal(form.el.querySelectorAll('.aos-segmented button').length, 2);
  assert.deepEqual(form.getValues(), { mode: 'alpha', enabled: true });

  form.setValues({ mode: 'omega', enabled: false });
  assert.deepEqual(form.getValues(), { mode: 'omega', enabled: false });
});

test('createForm setDisabled propagates through section controls', () => {
  const { form } = mount([
    {
      kind: 'section',
      label: 'Fields',
      fields: [
        { id: 'text', kind: 'text', value: 'x' },
        { id: 'slider', kind: 'slider', value: 1 },
        { id: 'color', kind: 'color', value: '#000000' },
      ],
    },
  ], { zag: true });

  form.setDisabled(true);

  for (const input of form.el.querySelectorAll('input')) {
    assert.equal(input.disabled, true);
  }
});
