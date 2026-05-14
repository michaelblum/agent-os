import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createButton } from '../../packages/toolkit/controls/button.js';
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
