import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createToggle } from '../../packages/toolkit/controls/toggle.js';
import { FakeEvent, createFakeDocument } from './dom-fixture.mjs';

test('createToggle returns shape and tracks value', () => {
  const document = createFakeDocument();
  const toggle = createToggle({ document, label: 'Enabled', checked: true });

  assert.equal(typeof toggle.getValue, 'function');
  assert.equal(typeof toggle.setValue, 'function');
  assert.equal(typeof toggle.on, 'function');
  assert.equal(typeof toggle.destroy, 'function');
  assert.equal(toggle.getValue(), true);
  toggle.setValue(false);
  assert.equal(toggle.getValue(), false);
  toggle.setValue(true);
  assert.equal(toggle.getValue(), true);
});

test('toggle change fires from underlying input', () => {
  const document = createFakeDocument();
  const toggle = createToggle({ document, checked: false });
  const input = toggle.el.querySelector('input');
  let value = null;
  toggle.on('change', (next) => { value = next; });

  input.checked = true;
  input.dispatchEvent(new FakeEvent('change', { bubbles: true }));

  assert.equal(value, true);
});
