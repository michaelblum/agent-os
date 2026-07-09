import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTextarea, renderTextareaHtml } from '../../packages/toolkit/controls/textarea.js';
import { FakeEvent, createFakeDocument } from './dom-fixture.mjs';

test('createTextarea returns shape and updates value', () => {
  const document = createFakeDocument();
  const field = createTextarea({
    document,
    value: 'start',
    placeholder: 'Notes',
    rows: 4,
    spellcheck: false,
    ariaLabel: 'Notes field',
  });

  assert.equal(typeof field.getValue, 'function');
  assert.equal(typeof field.setValue, 'function');
  assert.equal(typeof field.setReadOnly, 'function');
  assert.equal(typeof field.applyDictationTranscript, 'function');
  assert.equal(typeof field.on, 'function');
  assert.equal(typeof field.destroy, 'function');
  assert.equal(field.el.tagName, 'TEXTAREA');
  assert.equal(field.el.classList.contains('aos-textarea'), true);
  assert.equal(field.el.getAttribute('aria-label'), 'Notes field');
  assert.equal(field.getValue(), 'start');
  field.setValue('next');
  assert.equal(field.getValue(), 'next');
});

test('textarea applies dictation transcripts through the shared text hook', () => {
  const document = createFakeDocument();
  const changes = [];
  const field = createTextarea({
    document,
    value: 'open',
    onChange: (value) => changes.push(value),
  });

  const result = field.applyDictationTranscript('terminal', { mode: 'append' });

  assert.equal(result.value, 'open terminal');
  assert.equal(field.getValue(), 'open terminal');
  assert.deepEqual(changes, ['open terminal']);
});

test('textarea emits change on input and commit on blur', () => {
  const document = createFakeDocument();
  const changes = [];
  const commits = [];
  const field = createTextarea({
    document,
    value: 'x',
    onChange: (value) => changes.push(value),
    onCommit: (value) => commits.push(value),
  });
  field.on('change', (value) => changes.push(`hub:${value}`));
  field.on('commit', (value) => commits.push(`hub:${value}`));

  field.el.value = 'typed';
  field.el.dispatchEvent(new FakeEvent('input', { bubbles: true }));
  field.el.dispatchEvent(new FakeEvent('blur'));

  assert.deepEqual(changes, ['typed', 'hub:typed']);
  assert.deepEqual(commits, ['typed', 'hub:typed']);
});

test('renderTextareaHtml escapes attributes and value', () => {
  const html = renderTextareaHtml({
    id: 'note',
    value: '<hello>',
    placeholder: '"note"',
    rows: 3,
    dataset: { aosRef: 'surface:note' },
  });

  assert.match(html, /^<textarea /);
  assert.match(html, /class="aos-textarea"/);
  assert.match(html, /id="note"/);
  assert.match(html, /placeholder="&quot;note&quot;"/);
  assert.match(html, /rows="3"/);
  assert.match(html, /data-aos-ref="surface:note"/);
  assert.match(html, />&lt;hello&gt;<\/textarea>$/);
});
