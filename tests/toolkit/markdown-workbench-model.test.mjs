import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  annotationAnchorSummary,
  applyMarkdownAnnotations,
  applyMarkdownSaveResult,
  applyMarkdownTextPatch,
  buildMarkdownWorkbenchSubject,
  buildMarkdownSaveRequest,
  clearMarkdownAnnotations,
  createMarkdownWorkbenchState,
  markdownWorkbenchAnnotationViewModels,
  markdownDiagnostics,
  openMarkdownDocument,
} from '../../packages/toolkit/components/markdown-workbench/model.js';
import {
  subjectCapabilities,
  subjectContracts,
  subjectFacets,
} from '../../packages/toolkit/workbench/subject.js';

test('markdownDiagnostics builds outline and mermaid counts', () => {
  const diagnostics = markdownDiagnostics('# One\n\n## Two\n\n```mermaid\na-->b\n```\n');
  assert.equal(diagnostics.line_count, 8);
  assert.equal(diagnostics.word_count, 7);
  assert.deepEqual(diagnostics.headings, [
    { depth: 1, text: 'One', line: 1 },
    { depth: 2, text: 'Two', line: 3 },
  ]);
  assert.deepEqual(diagnostics.mermaid_blocks, [{ start_line: 5, end_line: 7, preview: 'diagram_container' }]);
  assert.equal(diagnostics.mermaid_preview, 'diagram_container');
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

test('markdown workbench accepts structured annotations without mutating content', () => {
  const state = createMarkdownWorkbenchState({
    path: 'docs/example.md',
    content: '# Example\n\nInitial text.\n',
  });
  const before = state.content;
  const result = applyMarkdownAnnotations(state, {
    type: 'markdown_workbench.annotations.replace',
    payload: {
      annotations: [
        {
          id: 'ann-line-2',
          ordinal: 2,
          kind: 'selection_comment',
          surface_id: 'markdown-workbench-test',
          source_path: 'docs/example.md',
          coordinate_space: 'document',
          text_range: { start_line: 3, end_line: 3 },
          text_excerpt: 'Initial text.',
          note: 'Tighten this sentence.',
          actor: { role: 'human', id: 'operator' },
          status: 'committed',
        },
        { bounds: { x: 1, y: 2, width: 3, height: 4 }, label: 'Legacy region' },
      ],
    },
  });

  assert.equal(result.annotation_count, 1);
  assert.equal(state.content, before);
  assert.equal(state.dirty, false);
  assert.equal(state.annotations[0].ordinal, 2);
  assert.equal(state.annotations[0].note, 'Tighten this sentence.');
  assert.match(annotationAnchorSummary(state.annotations[0]), /docs\/example\.md line 3/);
  assert.match(annotationAnchorSummary(state.annotations[0]), /Initial text\./);
});

test('markdown workbench annotation view models preserve status and overlay mapping', () => {
  const views = markdownWorkbenchAnnotationViewModels([
    {
      id: 'ann-point-1',
      ordinal: 1,
      kind: 'point_comment',
      surface_id: 'markdown-workbench-test',
      source_path: 'docs/example.md',
      coordinate_space: 'viewport',
      point: { x: 120, y: 80 },
      note: 'Check this spot.',
      actor: { role: 'agent', id: 'gdi' },
      status: 'committed',
    },
    {
      id: 'ann-resolved-3',
      ordinal: 3,
      kind: 'selection_comment',
      surface_id: 'markdown-workbench-test',
      source_path: 'docs/example.md',
      coordinate_space: 'document',
      text_range: { start_line: 4, end_line: 6 },
      note: 'Already handled.',
      actor: { role: 'human', id: 'operator' },
      status: 'resolved',
    },
    {
      id: 'ann-draft-4',
      ordinal: 4,
      kind: 'point_comment',
      surface_id: 'markdown-workbench-test',
      source_path: 'docs/example.md',
      coordinate_space: 'viewport',
      point: { x: 1, y: 2 },
      note: 'Draft.',
      actor: { role: 'human', id: 'operator' },
      status: 'draft',
    },
  ]);

  assert.equal(views.length, 2);
  assert.equal(views[0].ordinal, 1);
  assert.equal(views[0].active, true);
  assert.equal(views[0].overlay, true);
  assert.equal(views[1].secondary, true);
  assert.equal(views[1].anchor_summary, 'docs/example.md lines 4-6');
});

test('markdown workbench clears annotation layer without losing markdown content', () => {
  const state = createMarkdownWorkbenchState({
    path: 'docs/example.md',
    content: '# Example',
    annotations: [{
      id: 'ann-1',
      ordinal: 1,
      kind: 'point_comment',
      source_path: 'docs/example.md',
      note: 'Visible note.',
      actor: { role: 'agent', id: 'gdi' },
      status: 'committed',
    }],
  });
  assert.equal(state.annotations.length, 1);
  openMarkdownDocument(state, {
    type: 'markdown_document.open',
    path: 'docs/next.md',
    content: '# Next',
  });
  assert.equal(state.annotations.length, 0);
  assert.equal(state.content, '# Next');
  applyMarkdownAnnotations(state, {
    type: 'markdown_workbench.annotations.replace',
    payload: {
      annotations: [{
        id: 'ann-2',
        ordinal: 2,
        kind: 'point_comment',
        source_path: 'docs/next.md',
        note: 'Reloaded note.',
        actor: { role: 'agent', id: 'gdi' },
        status: 'committed',
      }],
    },
  });
  assert.equal(state.annotations.length, 1);
  clearMarkdownAnnotations(state);
  assert.equal(state.annotations.length, 0);
  assert.equal(state.content, '# Next');
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
  assert.deepEqual(subjectCapabilities(subject), ['inspectable', 'editable']);
  assert.ok(subjectContracts(subject).includes('markdown_document.text.patch'));
  assert.ok(subjectContracts(subject).includes('markdown.mermaid.detect'));
  assert.ok(subjectContracts(subject).includes('markdown.mermaid.preview'));
  assert.ok(subjectFacets(subject).find((facet) => facet.key === 'markdown-source').contracts.includes('markdown_document.save.requested'));
  assert.equal('views' in subject, false);
  assert.equal('controls' in subject, false);
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
  assert.ok(subjectContracts(save.subject).includes('markdown_document.save.requested'));
  assert.equal('views' in save.subject, false);
  assert.equal('controls' in save.subject, false);

  applyMarkdownTextPatch(state, {
    type: 'markdown_document.text.patch',
    patch: { content: '# Runtime Modes\n\nChanged.' },
  });
  assert.equal(buildMarkdownWorkbenchSubject(state).state.dirty, true);
});
