import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  applyMarkdownSaveResult,
  applyMarkdownTextPatch,
  buildMarkdownWorkbenchSubject,
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
  assert.equal(save.subject.id, 'file:docs/example.md');
  assert.equal(save.subject.subject_type, 'markdown.document');
  assert.equal(save.path, 'docs/example.md');
  assert.equal(save.content, '# Example\n\nChanged.');

  const saved = applyMarkdownSaveResult(state, {
    type: 'markdown_document.save.result',
    status: 'saved',
  });
  assert.equal(saved.status, 'saved');
  assert.equal(state.dirty, false);
});

test('markdown workbench exposes an AOS workbench subject descriptor', () => {
  const state = createMarkdownWorkbenchState({
    path: 'docs/example.md',
    content: '# Example\n\n```mermaid\na-->b\n```\n',
    dirty: true,
  });
  const subject = buildMarkdownWorkbenchSubject(state);

  assert.equal(subject.type, 'aos.workbench.subject');
  assert.equal(subject.id, 'file:docs/example.md');
  assert.equal(subject.subject_type, 'markdown.document');
  assert.equal(subject.owner, 'markdown-workbench');
  assert.deepEqual(subject.source, { kind: 'file', path: 'docs/example.md' });
  assert.equal(subject.state.dirty, true);
  assert.equal(subject.state.mermaid_block_count, 1);
  assert.ok(subject.capabilities.includes('markdown_document.text.patch'));
  assert.ok(subject.capabilities.includes('markdown.mermaid.detect'));
});

test('markdown workbench exposes wiki-backed subjects when opened from wiki', () => {
  const state = createMarkdownWorkbenchState();
  openMarkdownDocument(state, {
    type: 'markdown_document.open',
    path: 'aos/concepts/runtime-modes.md',
    source: {
      kind: 'wiki',
      path: 'aos/concepts/runtime-modes.md',
      page: {
        path: 'aos/concepts/runtime-modes.md',
        frontmatter: {
          type: 'concept',
          name: 'Runtime Modes',
          tags: '[infrastructure, runtime]',
        },
      },
    },
    content: '# Runtime Modes',
  });

  const save = buildMarkdownSaveRequest(state, { requestId: 'wiki-save-1' });
  assert.equal(save.subject.id, 'wiki:aos/concepts/runtime-modes.md');
  assert.equal(save.subject.subject_type, 'wiki.concept');
  assert.equal(save.subject.source.kind, 'wiki');
  assert.equal(save.source.kind, 'wiki');
  assert.equal(save.path, 'aos/concepts/runtime-modes.md');
  assert.equal(save.subject.state.dirty, false);

  applyMarkdownTextPatch(state, {
    type: 'markdown_document.text.patch',
    patch: { content: '# Runtime Modes\n\nChanged.' },
  });
  assert.equal(buildMarkdownWorkbenchSubject(state).state.dirty, true);
});
