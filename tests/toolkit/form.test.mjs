import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createForm } from '../../packages/toolkit/panel/form.js';
import { FakeEvent, createFakeDocument } from './dom-fixture.mjs';

const fields = [
  {
    id: 'decision',
    kind: 'exclusive_choice',
    style: 'buttons',
    options: [
      { value: 'yes', label: 'Yes' },
      { value: 'other', label: 'Other' },
    ],
  },
  {
    id: 'other_text',
    kind: 'text',
    placeholder: 'Something else...',
    visible_when: { field: 'decision', equals: 'other' },
  },
];

test('createForm renders fields and tracks visible values', () => {
  const document = createFakeDocument();
  const container = document.createElement('section');
  const form = createForm(container, fields);

  const fieldEls = form.el.querySelectorAll('.aos-form-field');
  assert.equal(fieldEls.length, 2);
  assert.deepEqual(form.getValues(), { decision: null });
  assert.equal(fieldEls[1].classList.contains('hidden'), true);
});

test('form visible_when reacts to changes and excludes hidden values', () => {
  const document = createFakeDocument();
  const container = document.createElement('section');
  const form = createForm(container, fields);
  const fieldEls = form.el.querySelectorAll('.aos-form-field');
  const buttons = form.el.querySelectorAll('button');

  buttons[1].dispatchEvent(new FakeEvent('click', { bubbles: true }));
  assert.equal(fieldEls[1].classList.contains('hidden'), false);
  assert.deepEqual(form.getValues(), { decision: 'other', other_text: '' });
});

test('form validates visible required fields and emits change values', () => {
  const document = createFakeDocument();
  const container = document.createElement('section');
  const form = createForm(container, fields);
  const changes = [];
  form.on('change', (values) => changes.push(values));

  assert.equal(form.isValid(), false);
  form.setValues({ decision: 'yes' });
  assert.equal(form.isValid(), true);
  assert.deepEqual(changes.at(-1), { decision: 'yes' });
});

test('form destroy cleans up without throwing', () => {
  const document = createFakeDocument();
  const container = document.createElement('section');
  const form = createForm(container, fields);
  form.destroy();
  form.destroy();
});

test('form maps boolean, multi choice, select, and number fields', () => {
  const document = createFakeDocument();
  const container = document.createElement('section');
  const form = createForm(container, [
    { id: 'enabled', kind: 'boolean', value: true },
    { id: 'tags', kind: 'multi_choice', value: ['a'], options: [{ value: 'a', label: 'A' }, { value: 'b', label: 'B' }] },
    { id: 'mode', kind: 'select', value: 'fast', options: [{ value: 'fast', label: 'Fast' }, { value: 'slow', label: 'Slow' }] },
    { id: 'count', kind: 'number', value: 2, step: 1 },
  ]);

  assert.deepEqual(form.getValues(), {
    enabled: true,
    tags: ['a'],
    mode: 'fast',
    count: 2,
  });

  form.setValues({ enabled: false, tags: ['b'], mode: 'slow', count: 4 });
  assert.deepEqual(form.getValues(), {
    enabled: false,
    tags: ['b'],
    mode: 'slow',
    count: 4,
  });
});
