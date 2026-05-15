import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTextField, renderTextFieldHtml } from '../../packages/toolkit/controls/text-field.js';
import { FakeEvent, createFakeDocument } from './dom-fixture.mjs';

test('createTextField returns shape and updates value', () => {
  const document = createFakeDocument();
  const field = createTextField({ document, value: 'start', placeholder: 'Name' });

  assert.equal(typeof field.getValue, 'function');
  assert.equal(typeof field.setValue, 'function');
  assert.equal(typeof field.setError, 'function');
  assert.equal(typeof field.on, 'function');
  assert.equal(typeof field.destroy, 'function');
  assert.equal(field.getValue(), 'start');
  field.setValue('foo');
  assert.equal(field.getValue(), 'foo');
});

test('text field renders and clears error state', () => {
  const document = createFakeDocument();
  const field = createTextField({ document });
  const input = field.el.querySelector('input');
  const error = field.el.querySelector('.aos-field-error');

  field.setError('bad');
  assert.equal(input.classList.contains('error'), true);
  assert.equal(error.textContent, 'bad');
  field.setError(null);
  assert.equal(input.classList.contains('error'), false);
  assert.equal(error.hidden, true);
});

test('text field commits on Enter and blur', () => {
  const document = createFakeDocument();
  const commits = [];
  const field = createTextField({ document, value: 'x', onCommit: (value) => commits.push(value) });
  const input = field.el.querySelector('input');

  input.dispatchEvent(new FakeEvent('keydown', { key: 'Enter' }));
  input.dispatchEvent(new FakeEvent('blur'));

  assert.deepEqual(commits, ['x', 'x']);
});

test('renderTextFieldHtml escapes attributes and value', () => {
  const html = renderTextFieldHtml({
    type: 'search',
    className: 'query-input',
    value: '<term>',
    placeholder: 'Find "subject"',
    spellcheck: false,
    dataset: { role: 'subject-search' },
    attributes: { autocomplete: 'off' },
  });

  assert.match(html, /^<input /);
  assert.match(html, /type="search"/);
  assert.match(html, /class="aos-text-input query-input"/);
  assert.match(html, /value="&lt;term&gt;"/);
  assert.match(html, /placeholder="Find &quot;subject&quot;"/);
  assert.match(html, /spellcheck="false"/);
  assert.match(html, /data-role="subject-search"/);
  assert.match(html, /autocomplete="off"/);
});
