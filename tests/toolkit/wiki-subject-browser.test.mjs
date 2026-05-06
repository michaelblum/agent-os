import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import MarkdownWorkbench from '../../packages/toolkit/components/markdown-workbench/index.js';
import WikiSubjectBrowser from '../../packages/toolkit/components/wiki-subject-browser/index.js';
import {
  applySubjectNavigationQuery,
  applySubjectCatalogLoad,
  applySubjectOpenRequested,
  applyWikiSubjectOpenRequested,
  applyWikiSubjectSelection,
  createSubjectIndexNavigationEntries,
  createWikiSubjectBrowserOpenRequestFromCatalogEntry,
  createWikiSubjectBrowserOpenRequestFromSelection,
  createWikiSubjectBrowserState,
  SUBJECT_BROWSER_INDEX_ENTRY_TYPE,
  SUBJECT_BROWSER_NAVIGATION_ENTRY_TYPE,
  WIKI_SUBJECT_BROWSER_SURFACE,
  WIKI_SUBJECT_BROWSER_URL,
  WIKI_SUBJECT_BROWSER_WORK_RECORD_CANVAS_ID,
  wikiSubjectBrowserSnapshot,
} from '../../packages/toolkit/components/wiki-subject-browser/model.js';
import {
  SUBJECT_CATALOG_LOAD_TYPE,
  SUBJECT_OPEN_REQUEST_TYPE,
  WORK_RECORD_WORKBENCH_URL,
  createWorkRecordSubjectCatalogEntry,
} from '../../packages/toolkit/workbench/subject-catalog.js';
import {
  WIKI_SUBJECT_OPEN_REQUEST_TYPE,
  WIKI_SUBJECT_SELECTION_TYPE,
  createWikiSubjectSelectionPayload,
} from '../../packages/toolkit/workbench/wiki-subject-opening.js';
import { createWikiPageSubject } from '../../packages/toolkit/workbench/wiki-subject.js';

const repo = new URL('../../', import.meta.url);

async function repoText(path) {
  return readFile(new URL(path, repo), 'utf8');
}

async function repoJson(path) {
  return JSON.parse(await repoText(path));
}

test('wiki subject browser state starts graph-first with no content pane open', () => {
  const state = createWikiSubjectBrowserState();

  assert.equal(state.surface, WIKI_SUBJECT_BROWSER_SURFACE);
  assert.equal(state.graph_first, true);
  assert.equal(state.content_open, false);
  assert.equal(state.selected_path, '');
  assert.equal(state.selected_subject, null);
  assert.equal(state.subject_graph_index.type, 'aos.subject_graph.index');
  assert.equal(state.subject_search_query, '');
  assert.deepEqual(state.subject_index_entries, []);
  assert.equal(state.subject_index_result_count, 0);
  assert.deepEqual(state.navigation_history, []);
  assert.deepEqual(state.navigation_trail, []);
  assert.deepEqual(state.subject_graph_summary, {
    subject_count: 0,
    facet_count: 0,
    host_count: 0,
    edge_count: 0,
    relationship_types: [],
    subject_types: [],
    health: {},
  });
});

test('wiki subject browser derives deterministic search entries from subject graph index', async () => {
  const record = await repoJson(
    'shared/schemas/fixtures/aos-work-record-v0/valid/playbook-browser-click-status.json',
  );
  const wikiSubject = createWikiPageSubject({
    path: 'aos/concepts/runtime-modes.md',
    frontmatter: {
      type: 'concept',
      name: 'Runtime Modes',
    },
  });
  const catalogEntry = createWorkRecordSubjectCatalogEntry(record);
  const state = createWikiSubjectBrowserState({
    selected_subject: wikiSubject,
    catalog_entries: [catalogEntry],
  });

  assert.deepEqual(state.subject_index_entries.map((entry) => entry.subject_id), [
    'work-record:aos-browser-click-status-2026-05-06',
    'wiki:aos/concepts/runtime-modes.md',
  ]);
  assert.ok(state.subject_index_entries.every((entry) => entry.type === SUBJECT_BROWSER_INDEX_ENTRY_TYPE));

  const wikiEntry = state.subject_index_entries.find((entry) => entry.subject_type === 'wiki.concept');
  assert.equal(wikiEntry.label, 'Runtime Modes');
  assert.equal(wikiEntry.entry_handle, 'wiki:aos/concepts/runtime-modes.md');
  assert.equal(wikiEntry.wiki_path, 'aos/concepts/runtime-modes.md');
  assert.equal(
    wikiEntry.semantic_ref,
    'wiki-subject-browser-v0:subject-list:entry:wiki-aos-concepts-runtime-modes-md',
  );
  assert.equal(
    wikiEntry.open_ref,
    'wiki-subject-browser-v0:subject-list:open:wiki-aos-concepts-runtime-modes-md',
  );

  const workRecordEntry = state.subject_index_entries.find((entry) => entry.subject_type === 'aos.work_record');
  assert.equal(workRecordEntry.catalog_entry_id, catalogEntry.id);
  assert.equal(workRecordEntry.source_kind, 'catalog_entry');
  assert.ok(workRecordEntry.contracts.includes('work_record.execution_map.view'));

  applySubjectNavigationQuery(state, 'runtime');
  const runtimeSnapshot = wikiSubjectBrowserSnapshot(state);
  assert.deepEqual(
    runtimeSnapshot.subject_index_entries,
    createSubjectIndexNavigationEntries(runtimeSnapshot.subject_graph_index, { query: 'runtime' }),
  );
  assert.deepEqual(runtimeSnapshot.subject_index_entries.map((entry) => entry.subject_id), [
    'wiki:aos/concepts/runtime-modes.md',
  ]);

  applySubjectNavigationQuery(state, 'work_record.execution_map.view');
  const workRecordSnapshot = wikiSubjectBrowserSnapshot(state);
  assert.deepEqual(workRecordSnapshot.subject_index_entries.map((entry) => entry.subject_id), [
    'work-record:aos-browser-click-status-2026-05-06',
  ]);

  const legacyRawCapabilitySubject = {
    type: 'aos.workbench.subject',
    schema_version: '2026-05-03',
    id: 'legacy:canonical-only',
    subject_type: 'aos.work_record',
    label: 'Canonical Only',
    owner: 'test',
    capabilities: ['inspectable', 'legacy.hidden.match'],
    contracts: [],
    views: ['hidden.view'],
    controls: ['hidden-control'],
    facets: [],
  };
  const legacySnapshot = createWikiSubjectBrowserState({
    selected_subject: legacyRawCapabilitySubject,
    subject_search_query: 'hidden',
  });
  assert.equal(legacySnapshot.subject_index_result_count, 0);
  assert.doesNotMatch(JSON.stringify(legacySnapshot.subject_graph_index), /legacy\.hidden\.match|hidden\.view|hidden-control/);
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
  assert.equal(snapshot.navigation_history.length, 1);
  assert.equal(snapshot.navigation_trail[0].type, SUBJECT_BROWSER_NAVIGATION_ENTRY_TYPE);
  assert.equal(snapshot.navigation_trail[0].source_kind, 'wiki');
  assert.equal(snapshot.navigation_trail[0].entry_handle, 'wiki:aos/concepts/runtime-modes.md');
  assert.equal(
    snapshot.navigation_trail[0].open_ref,
    'wiki-subject-browser-v0:navigation-trail:open:wiki-aos-concepts-runtime-modes-md',
  );
});

test('wiki subject browser loads and opens non-wiki catalog entries through canonical descriptors', async () => {
  const record = await repoJson(
    'shared/schemas/fixtures/aos-work-record-v0/valid/playbook-browser-click-status.json',
  );
  const entry = createWorkRecordSubjectCatalogEntry(record);
  const state = createWikiSubjectBrowserState();

  const load = applySubjectCatalogLoad(state, {
    type: SUBJECT_CATALOG_LOAD_TYPE,
    entries: [entry],
  });
  const request = createWikiSubjectBrowserOpenRequestFromCatalogEntry(state.catalog_entries[0]);
  applySubjectOpenRequested(state, request);
  const snapshot = wikiSubjectBrowserSnapshot(state);

  assert.equal(load.type, SUBJECT_CATALOG_LOAD_TYPE);
  assert.equal(load.entry_count, 1);
  assert.equal(snapshot.catalog_entries[0].subject.subject_type, 'aos.work_record');
  assert.equal(snapshot.catalog_entries[0].affordances.openable, true);
  assert.equal(snapshot.subject_graph_summary.subject_count, 1);
  assert.equal(snapshot.subject_graph_summary.subject_types[0], 'aos.work_record');
  assert.ok(snapshot.subject_graph_summary.relationship_types.includes('origin_subject'));
  assert.ok(snapshot.subject_graph_index.host_references.some((host) => (
    host.entry.value === WORK_RECORD_WORKBENCH_URL
  )));
  assert.equal(request.type, SUBJECT_OPEN_REQUEST_TYPE);
  assert.equal(request.entry_handle, 'work-record:aos-browser-click-status-2026-05-06');
  assert.equal(request.host.entry.value, WORK_RECORD_WORKBENCH_URL);
  assert.equal(request.open_message.type, 'work_record.open');
  assert.equal(request.open_message.record.id, 'work-record:aos-browser-click-status-2026-05-06');
  assert.equal(snapshot.last_subject_open_request.opener.id, 'work-record-workbench');
  assert.equal(snapshot.navigation_history.length, 1);
  assert.equal(snapshot.navigation_trail[0].source_kind, 'catalog');
  assert.equal(snapshot.navigation_trail[0].catalog_entry_id, entry.id);
  assert.equal(snapshot.navigation_trail[0].entry_handle, 'work-record:aos-browser-click-status-2026-05-06');
  assert.equal(
    snapshot.navigation_trail[0].open_ref,
    'wiki-subject-browser-v0:navigation-trail:open:work-record-aos-browser-click-status-2026-05-06',
  );
  assert.equal(WIKI_SUBJECT_BROWSER_WORK_RECORD_CANVAS_ID, 'wiki-subject-browser-v0-work-record');
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
  assert.ok(shell.manifest.accepts.includes(SUBJECT_CATALOG_LOAD_TYPE));
  assert.ok(shell.manifest.emits.includes(WIKI_SUBJECT_OPEN_REQUEST_TYPE));
  assert.ok(shell.manifest.emits.includes(SUBJECT_OPEN_REQUEST_TYPE));
  assert.match(indexHtml, /Wiki Subject Browser V0/);
  assert.match(indexJs, /loadGraphOnStart:\s*true/);
  assert.match(indexJs, /applyWikiSubjectBrowserSemanticTarget/);
  assert.match(indexJs, /wikiSubjectBrowserAosRef\('root'\)/);
  assert.match(indexJs, /subject-index-status/);
  assert.match(indexJs, /subjectIndexMarkup/);
  assert.match(indexJs, /subject-search/);
  assert.match(indexJs, /subject-list/);
  assert.match(indexJs, /navigation-trail/);
  assert.match(indexJs, /subject-catalog-open/);
  assert.match(indexJs, /subject-index-open/);
  assert.match(indexJs, /work-record-workbench/);
  assert.match(indexJs, /subject_graph_summary/);
  assert.match(indexJs, /subject_index_entries/);
  assert.match(launch, /--manifest wiki-subject-browser-v0/);
  assert.match(launch, /SUBJECT_CATALOG_LOAD_TYPE/);
  assert.match(launch, /wiki-subject-browser-v0:subject-search/);
  assert.match(launch, /wiki-subject-browser-v0:subject-list:open:work-record-aos-browser-click-status-2026-05-06/);
  assert.match(launch, /wiki-subject-browser-v0:subject-catalog:open:work-record-aos-browser-click-status-2026-05-06/);
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
