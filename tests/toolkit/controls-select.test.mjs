import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSelect, renderSelectHtml } from '../../packages/toolkit/controls/select.js';
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

test('renderSelectHtml renders escaped options and raw attributes', () => {
  const html = renderSelectHtml({
    label: 'Mode',
    value: 'b',
    wrapperTag: 'label',
    wrapperClassName: 'aos-control-row',
    dataset: { action: 'changeMode' },
    rawAttributes: ['data-safe-fragment="ok"'],
    options: [
      { value: 'a', label: 'A <one>' },
      { value: 'b', label: 'B & two', attributes: { 'data-kind': 'chosen' } },
    ],
  });

  assert.match(html, /^<label class="aos-control-row">/);
  assert.match(html, /<span class="aos-control-label">Mode<\/span>/);
  assert.match(html, /<select class="aos-select" data-action="changeMode" data-safe-fragment="ok">/);
  assert.match(html, /<option value="a">A &lt;one&gt;<\/option>/);
  assert.match(html, /<option value="b" selected data-kind="chosen">B &amp; two<\/option>/);
});
