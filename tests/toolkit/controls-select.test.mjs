import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSelect } from '../../packages/toolkit/controls/select.js';
import { FakeEvent, createFakeDocument } from './dom-fixture.mjs';

test('createSelect returns shape and tracks value changes', () => {
  const document = createFakeDocument();
  const select = createSelect({
    document,
    value: 'b',
    options: [
      { value: 'a', label: 'A' },
      { value: 'b', label: 'B' },
    ],
  });
  const input = select.el.querySelector('select');
  const changes = [];
  select.on('change', (value) => changes.push(value));

  assert.equal(typeof select.getValue, 'function');
  assert.equal(typeof select.setValue, 'function');
  assert.equal(typeof select.on, 'function');
  assert.equal(typeof select.destroy, 'function');
  assert.equal(select.getValue(), 'b');

  input.value = 'a';
  input.dispatchEvent(new FakeEvent('change', { bubbles: true }));
  assert.deepEqual(changes, ['a']);
});
