import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSelect } from '../../packages/toolkit/controls/select.js';
import { FakeEvent, createFakeDocument } from './dom-fixture.mjs';

test('createSelect returns Zag-backed listbox shape and tracks value changes', () => {
  const document = createFakeDocument();
  const select = createSelect({
    document,
    value: 'b',
    options: [
      { value: 'a', label: 'A' },
      { value: 'b', label: 'B' },
    ],
  });
  const trigger = select.el.querySelector('[data-aos-select-trigger]');
  const indicator = select.el.querySelector('[data-aos-select-indicator]');
  const content = select.el.querySelector('[data-aos-select-content]');
  const items = select.el.querySelectorAll('[data-aos-select-item]');
  const changes = [];
  select.on('change', (value) => changes.push(value));

  assert.equal(typeof select.getValue, 'function');
  assert.equal(typeof select.setValue, 'function');
  assert.equal(typeof select.setOptions, 'function');
  assert.equal(typeof select.on, 'function');
  assert.equal(typeof select.destroy, 'function');
  assert.equal(select.getValue(), 'b');
  assert.equal(select.el.querySelector('select'), null);
  assert.equal(indicator.textContent, '');
  assert.equal(trigger.getAttribute('role'), 'combobox');
  assert.equal(content.getAttribute('role'), 'listbox');
  assert.equal(trigger.getAttribute('aria-expanded'), 'false');
  assert.equal(content.hidden, true);

  trigger.dispatchEvent(new FakeEvent('click', { bubbles: true }));
  assert.equal(trigger.getAttribute('aria-expanded'), 'true');
  assert.equal(content.hidden, false);

  items[0].dispatchEvent(new FakeEvent('click', { bubbles: true }));
  assert.deepEqual(changes, ['a']);
  assert.equal(select.getValue(), 'a');
  assert.equal(trigger.getAttribute('aria-expanded'), 'false');
  assert.equal(content.hidden, true);
});

test('createSelect updates options through the controller API', () => {
  const document = createFakeDocument();
  const select = createSelect({
    document,
    value: 'a',
    options: [
      { value: 'a', label: 'A' },
      { value: 'b', label: 'B' },
    ],
  });
  const changes = [];
  select.on('change', (value) => changes.push(value));

  select.setOptions([
    { value: 'x', label: 'X' },
    { value: 'y', label: 'Y' },
  ], { value: 'y', emit: true });

  assert.equal(select.getValue(), 'y');
  assert.deepEqual(changes, ['y']);
  assert.deepEqual(
    Array.from(select.el.querySelectorAll('[data-aos-select-item]')).map((item) => item.textContent),
    ['X', 'Y'],
  );
});
