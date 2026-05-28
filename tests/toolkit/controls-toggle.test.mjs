import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createToggle, renderToggleHtml } from '../../packages/toolkit/controls/toggle.js';
import { FakeEvent, createFakeDocument } from './dom-fixture.mjs';

test('createToggle returns shape and tracks value', () => {
  const document = createFakeDocument();
  const toggle = createToggle({ document, label: 'Enabled', checked: true });

  assert.equal(typeof toggle.getValue, 'function');
  assert.equal(typeof toggle.setValue, 'function');
  assert.equal(typeof toggle.getUxTreeFragment, 'function');
  assert.equal(typeof toggle.on, 'function');
  assert.equal(typeof toggle.destroy, 'function');
  assert.equal(toggle.getValue(), true);
  toggle.setValue(false);
  assert.equal(toggle.getValue(), false);
  toggle.setValue(true);
  assert.equal(toggle.getValue(), true);
});

test('createToggle exposes a UX tree fragment for current checked state', () => {
  const document = createFakeDocument();
  const toggle = createToggle({ document, id: 'snap-toggle', label: 'Snap', checked: false });

  toggle.setValue(true);

  const fragment = toggle.getUxTreeFragment();

  assert.equal(fragment.validation.ok, true);
  assert.equal(fragment.nodes[0].id, 'snap-toggle');
  assert.equal(fragment.nodes[0].label, 'Snap');
  assert.equal(fragment.nodes[0].metadata.state.checked, true);
  assert.equal(fragment.commands[0].handler_ref, 'toolkit.controls.toggle.change');
});

test('createToggle honors disabled config in DOM and UX tree state', () => {
  const document = createFakeDocument();
  const toggle = createToggle({ document, id: 'readonly-toggle', label: 'Read Only', disabled: true });
  const input = toggle.el.querySelector('input');

  const fragment = toggle.getUxTreeFragment();

  assert.equal(input.disabled, true);
  assert.equal(fragment.nodes[0].metadata.state.disabled, true);
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

test('renderToggleHtml renders checked input with raw attributes', () => {
  const html = renderToggleHtml({
    label: 'Overlay <on>',
    checked: true,
    disabled: true,
    dataset: { action: 'toggleOverlay' },
    rawAttributes: ['data-safe-fragment="ok"'],
  });

  assert.match(html, /^<label class="aos-toggle">/);
  assert.match(html, /<input type="checkbox" class="aos-toggle-input" checked disabled data-action="toggleOverlay" data-safe-fragment="ok">/);
  assert.match(html, /<span class="aos-toggle-switch"><span class="aos-toggle-thumb"><\/span><\/span>/);
  assert.match(html, /<span>Overlay &lt;on&gt;<\/span>/);
});
