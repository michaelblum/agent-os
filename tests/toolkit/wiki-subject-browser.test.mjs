import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import MarkdownWorkbench from '../../packages/toolkit/components/markdown-workbench/index.js';
import WikiSubjectBrowser from '../../packages/toolkit/components/wiki-subject-browser/index.js';
import {
  applyWikiSubjectOpenRequested,
  applyWikiSubjectSelection,
  createWikiSubjectBrowserOpenRequestFromSelection,
  createWikiSubjectBrowserState,
  WIKI_SUBJECT_BROWSER_SURFACE,
  WIKI_SUBJECT_BROWSER_URL,
  wikiSubjectBrowserSnapshot,
} from '../../packages/toolkit/components/wiki-subject-browser/model.js';
import {
  WIKI_SUBJECT_OPEN_REQUEST_TYPE,
  WIKI_SUBJECT_SELECTION_TYPE,
  createWikiSubjectSelectionPayload,
} from '../../packages/toolkit/workbench/wiki-subject-opening.js';

const repo = new URL('../../', import.meta.url);

async function repoText(path) {
  return readFile(new URL(path, repo), 'utf8');
}

test('wiki subject browser state starts graph-first with no content pane open', () => {
  const state = createWikiSubjectBrowserState();

  assert.equal(state.surface, WIKI_SUBJECT_BROWSER_SURFACE);
  assert.equal(state.graph_first, true);
  assert.equal(state.content_open, false);
  assert.equal(state.selected_path, '');
  assert.equal(state.selected_subject, null);
});

test('wiki subject browser bridges wiki selection to open-request payloads', () => {
  const selection = createWikiSubjectSelectionPayload({
    id: 'aos/concepts/runtime-modes.md',
    path: 'aos/concepts/runtime-modes.md',
    name: 'Runtime Modes',
    type: 'concept',
  });
  const state = createWikiSubjectBrowserState();

  applyWikiSubjectSelection(state, selection);
  const request = createWikiSubjectBrowserOpenRequestFromSelection(selection);
  applyWikiSubjectOpenRequested(state, request);
  const snapshot = wikiSubjectBrowserSnapshot(state);

  assert.equal(request.type, WIKI_SUBJECT_OPEN_REQUEST_TYPE);
  assert.equal(request.path, 'aos/concepts/runtime-modes.md');
  assert.equal(request.entry_handle, 'wiki:aos/concepts/runtime-modes.md');
  assert.equal(request.subject.type, 'aos.workbench.subject');
  assert.equal(snapshot.content_open, true);
  assert.equal(snapshot.selected_path, 'aos/concepts/runtime-modes.md');
  assert.equal(snapshot.last_open_request.type, WIKI_SUBJECT_OPEN_REQUEST_TYPE);
});

test('wiki subject browser exposes named shell manifest and semantic launch refs', async () => {
  const shell = WikiSubjectBrowser();
  const indexHtml = await repoText('packages/toolkit/components/wiki-subject-browser/index.html');
  const indexJs = await repoText('packages/toolkit/components/wiki-subject-browser/index.js');
  const launch = await repoText('packages/toolkit/components/wiki-subject-browser/launch.sh');
  const markdownJs = await repoText('packages/toolkit/components/markdown-workbench/index.js');

  assert.equal(shell.manifest.name, WIKI_SUBJECT_BROWSER_SURFACE);
  assert.equal(WIKI_SUBJECT_BROWSER_URL, 'aos://toolkit/components/wiki-subject-browser/index.html');
  assert.ok(shell.manifest.accepts.includes(WIKI_SUBJECT_SELECTION_TYPE));
  assert.ok(shell.manifest.emits.includes(WIKI_SUBJECT_OPEN_REQUEST_TYPE));
  assert.match(indexHtml, /Wiki Subject Browser V0/);
  assert.match(indexJs, /loadGraphOnStart:\s*true/);
  assert.match(indexJs, /applyWikiSubjectBrowserSemanticTarget/);
  assert.match(indexJs, /wikiSubjectBrowserAosRef\('root'\)/);
  assert.match(launch, /--manifest wiki-subject-browser-v0/);
  assert.match(markdownJs, /data-aos-ref="markdown-workbench:wiki-graph"/);
  assert.match(markdownJs, /data-aos-ref="markdown-workbench:content-pane"/);
  assert.match(markdownJs, /data-aos-ref="markdown-workbench:content-close"/);
  assert.match(markdownJs, /data-aos-ref="markdown-workbench:source-editor"/);
  assert.match(markdownJs, /type\.startsWith\('wiki-kb\/'\)/);
});

test('wiki subject browser keeps legacy markdown workbench surface available', () => {
  const workbench = MarkdownWorkbench();

  assert.equal(workbench.manifest.name, 'markdown-workbench');
  assert.ok(workbench.manifest.accepts.includes('markdown_document.open'));
  assert.ok(workbench.manifest.emits.includes('markdown-workbench/save.requested'));
});
