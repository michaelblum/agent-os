import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  indentMarkdownSelection,
  outdentMarkdownSelection,
} from '../../packages/toolkit/components/markdown-workbench/editor-commands.js';

test('indentMarkdownSelection indents the current line and preserves cursor intent', () => {
  const result = indentMarkdownSelection({
    value: 'alpha\nbeta',
    selectionStart: 8,
    selectionEnd: 8,
  });

  assert.equal(result.value, 'alpha\n  beta');
  assert.equal(result.selectionStart, 10);
  assert.equal(result.selectionEnd, 10);
});

test('indentMarkdownSelection indents all selected lines', () => {
  const result = indentMarkdownSelection({
    value: 'alpha\nbeta\ngamma',
    selectionStart: 1,
    selectionEnd: 12,
  });

  assert.equal(result.value, '  alpha\n  beta\n  gamma');
  assert.equal(result.selectionStart, 3);
  assert.equal(result.selectionEnd, 18);
});

test('outdentMarkdownSelection removes spaces from selected lines', () => {
  const result = outdentMarkdownSelection({
    value: '  alpha\n  beta\nplain',
    selectionStart: 4,
    selectionEnd: 14,
  });

  assert.equal(result.value, 'alpha\nbeta\nplain');
  assert.equal(result.selectionStart, 2);
  assert.equal(result.selectionEnd, 10);
});

test('outdentMarkdownSelection handles tabs and single spaces', () => {
  const result = outdentMarkdownSelection({
    value: '\tone\n two\nthree',
    selectionStart: 0,
    selectionEnd: 10,
  });

  assert.equal(result.value, 'one\ntwo\nthree');
  assert.equal(result.selectionStart, 0);
  assert.equal(result.selectionEnd, 8);
});
