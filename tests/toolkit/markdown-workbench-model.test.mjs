import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  applyMarkdownSaveResult,
  applyMarkdownTextPatch,
  buildMarkdownSaveRequest,
  createMarkdownWorkbenchState,
  markdownDiagnostics,
  openMarkdownDocument,
} from '../../packages/toolkit/components/markdown-workbench/model.js';

test('markdownDiagnostics builds outline and mermaid counts', () => {
  const diagnostics = markdownDiagnostics('# One\n\n## Two\n\n```mermaid\na-->b\n```\n');
  assert.equal(diagnostics.line_count, 8);
  assert.equal(diagnostics.word_count, 7);
  assert.deepEqual(diagnostics.headings, [
    { depth: 1, text: 'One', line: 1 },
    { depth: 2, text: 'Two', line: 3 },
  ]);
  assert.deepEqual(diagnostics.mermaid_blocks, [{ start_line: 5, end_line: 7 }]);
  assert.equal(diagnostics.unclosed_fence, false);
});

test('markdown workbench state opens, patches, and builds save requests', () => {
  const state = createMarkdownWorkbenchState();
  const opened = openMarkdownDocument(state, {
    type: 'markdown_document.open',
    path: 'docs/example.md',
    content: '# Example',
  });
  assert.equal(opened.status, 'opened');
  assert.equal(state.dirty, false);

  const patched = applyMarkdownTextPatch(state, {
    type: 'markdown_document.text.patch',
    patch: { content: '# Example\n\nChanged.' },
  });
  assert.equal(patched.status, 'applied');
  assert.equal(state.dirty, true);

  const save = buildMarkdownSaveRequest(state, { requestId: 'req-1' });
  assert.equal(save.request_id, 'req-1');
  assert.equal(save.path, 'docs/example.md');
  assert.equal(save.content, '# Example\n\nChanged.');

  const saved = applyMarkdownSaveResult(state, {
    type: 'markdown_document.save.result',
    status: 'saved',
  });
  assert.equal(saved.status, 'saved');
  assert.equal(state.dirty, false);
});
