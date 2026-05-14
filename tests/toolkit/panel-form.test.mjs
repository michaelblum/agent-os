import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createForm } from '../../packages/toolkit/panel/form.js';
import { FakeEvent, createFakeDocument } from './dom-fixture.mjs';

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

function mount(fields = gateFields) {
  const document = createFakeDocument();
  const container = document.createElement('section');
  document.body.appendChild(container);
  const form = createForm(container, fields);
  return { document, container, form };
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
  ]);

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
