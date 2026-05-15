import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createButton, renderButtonHtml } from '../../packages/toolkit/controls/button.js';
import { FakeEvent, createFakeDocument } from './dom-fixture.mjs';

test('createButton returns shape and button element with variant class', () => {
  const document = createFakeDocument();
  const button = createButton({ document, label: 'Go', variant: 'primary' });

  assert.equal(button.el.tagName, 'BUTTON');
  assert.equal(typeof button.setLabel, 'function');
  assert.equal(typeof button.setDisabled, 'function');
  assert.equal(typeof button.on, 'function');
  assert.equal(typeof button.destroy, 'function');
  assert.equal(button.el.classList.contains('aos-button'), true);
  assert.equal(button.el.classList.contains('primary'), true);
});

test('createButton toggles disabled attribute and click listeners', () => {
  const document = createFakeDocument();
  const button = createButton({ document, label: 'Go', variant: 'danger' });
  let clicks = 0;
  button.on('click', () => { clicks += 1; });

  button.setDisabled(true);
  assert.equal(button.el.disabled, true);
  button.setDisabled(false);
  assert.equal(button.el.disabled, false);
  button.el.dispatchEvent(new FakeEvent('click'));
  assert.equal(clicks, 1);

  button.destroy();
  button.el.dispatchEvent(new FakeEvent('click'));
  assert.equal(clicks, 1);
  button.destroy();
});

test('renderButtonHtml escapes labels and supports raw attributes', () => {
  const html = renderButtonHtml({
    label: 'Run <now>',
    variant: 'primary',
    className: 'wide',
    disabled: true,
    pressed: true,
    dataset: { action: 'runNow' },
    attributes: { title: 'ignored?', 'aria-controls': 'panel-1' },
    rawAttributes: ['data-safe-fragment="ok"'],
  });

  assert.match(html, /^<button /);
  assert.match(html, /class="aos-button primary wide"/);
  assert.match(html, /type="button"/);
  assert.match(html, /disabled/);
  assert.match(html, /aria-disabled="true"/);
  assert.match(html, /aria-pressed="true"/);
  assert.match(html, /data-action="runNow"/);
  assert.match(html, /aria-controls="panel-1"/);
  assert.match(html, /data-safe-fragment="ok"/);
  assert.match(html, />Run &lt;now&gt;<\/button>$/);
});
