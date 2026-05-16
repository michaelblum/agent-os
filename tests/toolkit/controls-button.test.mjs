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

test('createButton stamps DOM metadata used by component render paths', () => {
  const document = createFakeDocument();
  const button = createButton({
    document,
    id: 'save-button',
    title: 'Save changes',
    ariaLabel: 'Save work record',
    className: 'wide compact',
    variant: 'primary',
    dataset: { action: 'save', semanticTargetId: 'work-record-save' },
    attributes: { 'aria-controls': 'work-record-json', 'data-extra': 'ok' },
    disabled: true,
  });

  assert.equal(button.el.id, 'save-button');
  assert.equal(button.el.getAttribute('title'), 'Save changes');
  assert.equal(button.el.getAttribute('aria-label'), 'Save work record');
  assert.equal(button.el.classList.contains('aos-button'), true);
  assert.equal(button.el.classList.contains('primary'), true);
  assert.equal(button.el.classList.contains('wide'), true);
  assert.equal(button.el.classList.contains('compact'), true);
  assert.equal(button.el.dataset.action, 'save');
  assert.equal(button.el.dataset.semanticTargetId, 'work-record-save');
  assert.equal(button.el.getAttribute('aria-controls'), 'work-record-json');
  assert.equal(button.el.getAttribute('data-extra'), 'ok');
  assert.equal(button.el.disabled, true);
  assert.equal(button.el.getAttribute('aria-disabled'), 'true');

  button.setDisabled(false);
  assert.equal(button.el.disabled, false);
  assert.equal(button.el.getAttribute('aria-disabled'), null);
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

test('renderButtonHtml escapes labels and stamps semantic attrs', () => {
  const html = renderButtonHtml({
    label: 'Save <now>',
    variant: 'primary',
    dataset: { aosRef: 'demo:save', semanticTargetId: 'save' },
    attributes: { 'aria-label': 'Save now' },
  });

  assert.match(html, /class="aos-button primary"/);
  assert.match(html, /data-aos-ref="demo:save"/);
  assert.match(html, /data-semantic-target-id="save"/);
  assert.match(html, /aria-label="Save now"/);
  assert.match(html, />Save &lt;now&gt;<\/button>/);
});
