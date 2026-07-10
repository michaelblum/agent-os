import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createMarkdownOpenDocumentFromWikiPage,
  createMarkdownOpenRequestFromWikiSelection,
  createWikiSubjectOpenRequest,
  createWikiSubjectSelectionPayload,
  wikiPathFromSubject,
  wikiSubjectSelectionCanOpenInMarkdownWorkbench,
  WIKI_SUBJECT_OPEN_REQUEST_TYPE,
  WIKI_SUBJECT_SELECTION_TYPE,
} from '../../packages/toolkit/workbench/wiki-subject-opening.js';
import { createWorkbenchSubject } from '../../packages/toolkit/workbench/subject.js';

test('wiki graph selection emits a subject entry handle and descriptor payload', () => {
  const payload = createWikiSubjectSelectionPayload({
    id: 'sigil/agents/default.md',
    path: '/sigil/agents/default.md',
    name: 'Default Agent',
    type: 'entity',
    tags: ['sigil', 'agent'],
    plugin: 'sigil',
  });

  assert.equal(payload.type, WIKI_SUBJECT_SELECTION_TYPE);
  assert.equal(payload.path, 'sigil/agents/default.md');
  assert.equal(payload.entry_handle, 'wiki:sigil/agents/default.md');
  assert.equal(payload.subject.type, 'aos.workbench.subject');
  assert.equal(payload.subject.id, 'wiki:sigil/agents/default.md');
  assert.equal(payload.subject.subject_type, 'wiki.entity');
  assert.equal(payload.subject.source.kind, 'wiki');
});

test('wiki subject open request maps selection to markdown workbench open state', () => {
  const selection = createWikiSubjectSelectionPayload({
    id: 'aos/concepts/runtime-modes.md',
    name: 'Runtime Modes',
    type: 'concept',
  });

  assert.equal(wikiSubjectSelectionCanOpenInMarkdownWorkbench(selection), true);

  const request = createWikiSubjectOpenRequest(selection);
  assert.equal(request.type, WIKI_SUBJECT_OPEN_REQUEST_TYPE);
  assert.equal(request.path, 'aos/concepts/runtime-modes.md');
  assert.equal(request.entry_handle, 'wiki:aos/concepts/runtime-modes.md');
  assert.equal(request.source.kind, 'wiki');

  const markdown = createMarkdownOpenRequestFromWikiSelection(selection);
  assert.equal(markdown.markdown_document.type, 'markdown_document.open');
  assert.equal(markdown.markdown_document.path, 'aos/concepts/runtime-modes.md');
  assert.deepEqual(markdown.markdown_document.source, {
    kind: 'wiki',
    path: 'aos/concepts/runtime-modes.md',
    page: {
      path: 'aos/concepts/runtime-modes.md',
    },
  });
});

test('wiki subject opener preserves existing wiki handle opening behavior', () => {
  const selection = createWikiSubjectSelectionPayload({
    id: 'aos/concepts/runtime-modes.md',
    path: '/aos/concepts/runtime-modes.md',
    entry_handle: 'wiki:/aos/concepts/runtime-modes.md',
    name: 'Runtime Modes',
    type: 'concept',
  });

  assert.equal(selection.path, 'aos/concepts/runtime-modes.md');
  assert.equal(selection.entry_handle, 'wiki:/aos/concepts/runtime-modes.md');
  assert.equal(wikiSubjectSelectionCanOpenInMarkdownWorkbench(selection), true);

  const request = createWikiSubjectOpenRequest(selection);
  assert.equal(request.path, 'aos/concepts/runtime-modes.md');
  assert.equal(request.entry_handle, 'wiki:/aos/concepts/runtime-modes.md');

  const markdown = createMarkdownOpenRequestFromWikiSelection(selection);
  assert.equal(markdown.markdown_document.path, 'aos/concepts/runtime-modes.md');
});

test('wiki markdown page builder emits canonical markdown document open messages', () => {
  assert.deepEqual(
    createMarkdownOpenDocumentFromWikiPage({
      path: '/aos/concepts/runtime-modes.md',
      content: '# Runtime Modes',
    }),
    {
      type: 'markdown_document.open',
      path: 'aos/concepts/runtime-modes.md',
      source: {
        kind: 'wiki',
        path: 'aos/concepts/runtime-modes.md',
        page: {
          path: 'aos/concepts/runtime-modes.md',
          frontmatter: {},
        },
      },
      content: '# Runtime Modes',
    },
  );
  assert.equal(createMarkdownOpenDocumentFromWikiPage({ path: '' }), null);
});

test('wiki subject opener does not depend on legacy graph descriptor summaries', () => {
  const legacySubject = {
    type: 'aos.workbench.subject',
    schema_version: '2026-05-03',
    id: 'wiki:aos/concepts/legacy.md',
    subject_type: 'wiki.concept',
    label: 'Legacy',
    owner: 'aos',
    capabilities: ['wiki.read', 'markdown_document.text.patch'],
    views: ['wiki.graph', 'markdown.source'],
    controls: ['open', 'edit', 'save'],
  };
  const selection = {
    type: WIKI_SUBJECT_SELECTION_TYPE,
    path: 'aos/concepts/legacy.md',
    entry_handle: 'wiki:aos/concepts/legacy.md',
    subject: legacySubject,
  };

  assert.equal(wikiSubjectSelectionCanOpenInMarkdownWorkbench(selection), false);
  assert.equal(createMarkdownOpenRequestFromWikiSelection(selection), null);
});

test('wiki path resolver can derive paths from subject references', () => {
  const subject = createWorkbenchSubject({
    id: 'sigil.agent:default',
    type: 'sigil.agent',
    label: 'Default Agent',
    owner: 'sigil',
    capabilities: ['inspectable'],
    subject_references: [
      {
        id: 'wiki-doc',
        relationship: 'narrative_source',
        handle: 'wiki:sigil/agents/default.md',
      },
    ],
  });

  assert.equal(wikiPathFromSubject(subject), 'sigil/agents/default.md');
});

test('wiki subject opener rejects descriptors without markdown workbench support', () => {
  const subject = createWorkbenchSubject({
    id: 'wiki:aos/concepts/read-only.md',
    type: 'wiki.concept',
    label: 'Read Only',
    owner: 'aos',
    source: {
      kind: 'wiki',
      path: 'aos/concepts/read-only.md',
    },
    capabilities: ['inspectable'],
    contracts: ['wiki.read'],
    facets: [
      {
        key: 'wiki-graph',
        layer: 'descriptor',
        label: 'Wiki Graph',
        contracts: ['wiki.read'],
      },
    ],
  });

  assert.equal(wikiSubjectSelectionCanOpenInMarkdownWorkbench({
    type: WIKI_SUBJECT_SELECTION_TYPE,
    path: 'aos/concepts/read-only.md',
    entry_handle: 'wiki:aos/concepts/read-only.md',
    subject,
  }), false);
});
