import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createCheckboxGroup } from '../../packages/toolkit/controls/checkbox-group.js';
import { FakeEvent, createFakeDocument } from './dom-fixture.mjs';

const options = [
  { value: 'a', label: 'A' },
  { value: 'b', label: 'B' },
  { value: 'c', label: 'C' },
];

test('createCheckboxGroup returns shape and tracks arrays', () => {
  const document = createFakeDocument();
  const group = createCheckboxGroup({ document, options, value: ['a'] });

  assert.equal(typeof group.getValue, 'function');
  assert.equal(typeof group.setValue, 'function');
  assert.equal(typeof group.on, 'function');
  assert.equal(typeof group.destroy, 'function');
  assert.deepEqual(group.getValue(), ['a']);
  group.setValue(['a', 'b']);
  assert.deepEqual(group.getValue(), ['a', 'b']);
});

test('checkbox group emits change and select all toggles all options', () => {
  const document = createFakeDocument();
  const group = createCheckboxGroup({ document, options, value: [] });
  const changes = [];
  group.on('change', (value) => changes.push(value));
  const inputs = group.el.querySelectorAll('input');

  inputs[1].checked = true;
  inputs[1].dispatchEvent(new FakeEvent('change', { bubbles: true }));
  assert.deepEqual(changes.at(-1), ['a']);

  inputs[0].checked = true;
  inputs[0].dispatchEvent(new FakeEvent('change', { bubbles: true }));
  assert.deepEqual(group.getValue(), ['a', 'b', 'c']);
});
