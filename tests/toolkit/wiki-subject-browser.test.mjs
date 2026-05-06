import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import MarkdownWorkbench from '../../packages/toolkit/components/markdown-workbench/index.js';
import WikiSubjectBrowser from '../../packages/toolkit/components/wiki-subject-browser/index.js';
import {
  applySubjectIndexFilter,
  applySubjectIndexFocus,
  applySubjectNavigationQuery,
  applySubjectCatalogLoad,
  applySubjectOpenRequested,
  applyWikiSubjectOpenRequested,
  applyWikiSubjectSelection,
  createSubjectIndexNavigationEntries,
  deriveFocusedSubjectDetails,
  deriveSubjectIndexFilterOptions,
  resetSubjectIndexFilters,
  createWikiSubjectBrowserOpenRequestFromCatalogEntry,
  createWikiSubjectBrowserOpenRequestFromSelection,
  createWikiSubjectBrowserState,
  SUBJECT_BROWSER_FOCUSED_DETAILS_TYPE,
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
  createSubjectCatalogEntry,
  createWorkRecordSubjectCatalogEntry,
} from '../../packages/toolkit/workbench/subject-catalog.js';
import {
  WIKI_SUBJECT_OPEN_REQUEST_TYPE,
  WIKI_SUBJECT_SELECTION_TYPE,
  createWikiSubjectSelectionPayload,
} from '../../packages/toolkit/workbench/wiki-subject-opening.js';
import { createWorkbenchSubject } from '../../packages/toolkit/workbench/subject.js';
import { createWikiPageSubject } from '../../packages/toolkit/workbench/wiki-subject.js';

const repo = new URL('../../', import.meta.url);

async function repoText(path) {
  return readFile(new URL(path, repo), 'utf8');
}

async function repoJson(path) {
  return JSON.parse(await repoText(path));
}

async function subjectBrowserFixtureState() {
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
  return {
    record,
    wikiSubject,
    catalogEntry,
    state: createWikiSubjectBrowserState({
      selected_subject: wikiSubject,
      catalog_entries: [catalogEntry],
    }),
  };
}

function relatedNavigationFixtureState() {
  const runtimeSubject = createWikiPageSubject({
    path: 'aos/concepts/runtime-modes.md',
    frontmatter: {
      type: 'concept',
      name: 'Runtime Modes',
    },
  });
  const sourceSubject = createWorkbenchSubject({
    id: 'demo:related-source',
    type: 'aos.demo_subject',
    label: 'Related Source',
    owner: 'test',
    capabilities: ['inspectable'],
    contracts: ['demo.inspect'],
    subject_references: [
      {
        id: 'runtime-reference',
        relationship: 'guided_by',
        handle: runtimeSubject.id,
        subject_id: runtimeSubject.id,
        subject_type: runtimeSubject.subject_type,
        layer: 'narrative',
        role: 'guide',
      },
      {
        id: 'missing-playbook',
        relationship: 'origin_subject',
        handle: 'playbook:missing-flow',
        subject_type: 'aos.playbook',
        layer: 'execution_map',
        role: 'origin',
      },
    ],
    facets: [
      {
        key: 'demo-narrative',
        layer: 'narrative',
        label: 'Demo Narrative',
        source_ref: 'runtime-reference',
        capabilities: ['inspectable'],
        contracts: ['demo.inspect'],
        hosts: [
          {
            kind: 'canvas',
            target_dialect: 'canvas',
            entry: {
              kind: 'aos-url',
              value: 'aos://toolkit/components/wiki-subject-browser/index.html',
            },
            preferred: true,
          },
        ],
      },
      {
        key: 'demo-health',
        layer: 'health',
        label: 'Demo Health',
        capabilities: ['inspectable'],
        contracts: ['demo.health.view'],
        hosts: [
          {
            kind: 'canvas',
            target_dialect: 'canvas',
            entry: {
              kind: 'aos-url',
              value: 'aos://toolkit/components/canvas-inspector/index.html',
            },
          },
        ],
      },
    ],
  });
  const sourceEntry = createSubjectCatalogEntry({
    subject: sourceSubject,
    open_payload: {
      type: 'demo.inspect',
      subject_id: sourceSubject.id,
    },
  });
  return createWikiSubjectBrowserState({
    selected_subject: runtimeSubject,
    catalog_entries: [sourceEntry],
  });
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
  assert.deepEqual(state.subject_index_filters, {
    subject_type: '',
    relationship_type: '',
    layer: '',
    capability: '',
    health: '',
  });
  assert.deepEqual(state.subject_index_filter_options, {
    subject_types: [],
    relationship_types: [],
    layers: [],
    capabilities: [],
    health: [],
  });
  assert.equal(state.subject_index_filter_count, 0);
  assert.equal(state.subject_index_filters_active, false);
  assert.deepEqual(state.subject_index_entries, []);
  assert.equal(state.subject_index_result_count, 0);
  assert.equal(state.focused_subject_id, '');
  assert.equal(state.focused_subject_found, false);
  assert.equal(state.focused_subject_details, null);
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
  const { catalogEntry, state } = await subjectBrowserFixtureState();

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

test('wiki subject browser derives graph-index filter options from canonical fields', async () => {
  const { state } = await subjectBrowserFixtureState();
  const snapshot = wikiSubjectBrowserSnapshot(state);
  const options = deriveSubjectIndexFilterOptions(snapshot.subject_graph_index);

  assert.deepEqual(snapshot.subject_index_filter_options, options);
  assert.deepEqual(
    options.subject_types.map((option) => [option.value, option.count]),
    [
      ['aos.work_record', 1],
      ['wiki.concept', 1],
    ],
  );
  assert.ok(options.relationship_types.some((option) => (
    option.value === 'origin_subject'
      && option.count === 1
      && option.semantic_ref === 'wiki-subject-browser-v0:subject-filters:relationship_type:origin-subject'
  )));
  assert.ok(options.layers.some((option) => option.value === 'descriptor' && option.count === 2));
  assert.ok(options.capabilities.some((option) => option.value === 'inspectable' && option.count === 2));
  assert.deepEqual(options.health.map((option) => [option.value, option.count]), [['valid', 1]]);
  assert.equal(snapshot.subject_index_filter_count, 0);
  assert.equal(snapshot.subject_index_filters_active, false);
});

test('wiki subject browser composes search and graph-index filters deterministically', async () => {
  const { state } = await subjectBrowserFixtureState();
  const index = state.subject_graph_index;

  assert.deepEqual(
    createSubjectIndexNavigationEntries(index, {
      filters: { subject_type: 'wiki.concept' },
    }).map((entry) => entry.subject_id),
    ['wiki:aos/concepts/runtime-modes.md'],
  );
  assert.deepEqual(
    createSubjectIndexNavigationEntries(index, {
      filters: { relationship_type: 'origin_subject' },
    }).map((entry) => entry.subject_id),
    ['work-record:aos-browser-click-status-2026-05-06'],
  );
  assert.deepEqual(
    createSubjectIndexNavigationEntries(index, {
      query: 'browser',
      filters: { health: 'valid' },
    }).map((entry) => entry.subject_id),
    ['work-record:aos-browser-click-status-2026-05-06'],
  );
  assert.deepEqual(
    createSubjectIndexNavigationEntries(index, {
      query: 'runtime',
      filters: { health: 'valid' },
    }),
    [],
  );
  assert.deepEqual(
    createSubjectIndexNavigationEntries(index, {
      filters: { capability: 'exportable', subject_type: 'wiki.concept' },
    }),
    [],
  );
});

test('wiki subject browser resets filters and keeps stable no-match state', async () => {
  const { state } = await subjectBrowserFixtureState();

  applySubjectIndexFilter(state, 'health', 'valid');
  assert.equal(wikiSubjectBrowserSnapshot(state).subject_index_result_count, 1);

  applySubjectIndexFilter(state, 'subject_type', 'wiki.concept');
  let snapshot = wikiSubjectBrowserSnapshot(state);
  assert.equal(snapshot.subject_index_filter_count, 2);
  assert.equal(snapshot.subject_index_filters_active, true);
  assert.deepEqual(snapshot.subject_index_entries, []);

  resetSubjectIndexFilters(state);
  snapshot = wikiSubjectBrowserSnapshot(state);
  assert.deepEqual(snapshot.subject_index_filters, {
    subject_type: '',
    relationship_type: '',
    layer: '',
    capability: '',
    health: '',
  });
  assert.equal(snapshot.subject_index_filter_count, 0);
  assert.equal(snapshot.subject_index_filters_active, false);
  assert.equal(snapshot.subject_index_result_count, 2);

  applySubjectIndexFilter(state, 'relationship', 'does_not_exist');
  snapshot = wikiSubjectBrowserSnapshot(state);
  assert.equal(snapshot.subject_index_filter_count, 1);
  assert.deepEqual(snapshot.subject_index_entries, []);
});

test('wiki subject browser derives focused details deterministically from subject graph index', () => {
  const state = relatedNavigationFixtureState();
  const sourceEntry = state.subject_index_entries.find((entry) => entry.subject_id === 'demo:related-source');

  applySubjectIndexFocus(state, sourceEntry);
  const snapshot = wikiSubjectBrowserSnapshot(state);
  const details = snapshot.focused_subject_details;

  assert.deepEqual(
    details,
    deriveFocusedSubjectDetails(snapshot.subject_graph_index, sourceEntry),
  );
  assert.equal(details.type, SUBJECT_BROWSER_FOCUSED_DETAILS_TYPE);
  assert.equal(details.subject_id, 'demo:related-source');
  assert.equal(details.entry_handle, 'demo:related-source');
  assert.equal(details.semantic_ref, 'wiki-subject-browser-v0:subject-details:subject:demo-related-source');
  assert.equal(sourceEntry.inspect_ref, 'wiki-subject-browser-v0:subject-list:inspect:demo-related-source');
  assert.deepEqual(details.facets.map((facet) => [facet.key, facet.layer, facet.host_count]), [
    ['demo-health', 'health', 1],
    ['demo-narrative', 'narrative', 1],
  ]);
  assert.ok(details.facets.every((facet) => (
    facet.semantic_ref.startsWith('wiki-subject-browser-v0:subject-details:facet:demo-related-source:')
  )));
  assert.equal(details.hosts.length, 2);
  assert.ok(details.hosts.some((host) => (
    host.facet_key === 'demo-narrative'
      && host.entry.value === 'aos://toolkit/components/wiki-subject-browser/index.html'
  )));
  assert.equal(details.summary.outgoing_reference_count, 3);
  assert.equal(details.summary.incoming_reference_count, 0);
  assert.equal(details.summary.resolved_reference_count, 2);
  assert.equal(details.summary.unresolved_reference_count, 1);
});

test('wiki subject browser focused details preserve resolvable unresolved and incoming related targets', () => {
  const state = relatedNavigationFixtureState();
  const sourceEntry = state.subject_index_entries.find((entry) => entry.subject_id === 'demo:related-source');

  applySubjectIndexFocus(state, sourceEntry);
  let details = wikiSubjectBrowserSnapshot(state).focused_subject_details;
  const resolvedTargets = details.outgoing_references
    .map((reference) => reference.related_subject)
    .filter((target) => target.resolved);
  const unresolvedTargets = details.outgoing_references
    .map((reference) => reference.related_subject)
    .filter((target) => !target.resolved);

  assert.ok(resolvedTargets.every((target) => target.subject_id === 'wiki:aos/concepts/runtime-modes.md'));
  assert.ok(resolvedTargets.every((target) => (
    target.open_ref === 'wiki-subject-browser-v0:subject-details:related:open:wiki-aos-concepts-runtime-modes-md'
      && target.index_entry.open_ref === 'wiki-subject-browser-v0:subject-list:open:wiki-aos-concepts-runtime-modes-md'
  )));
  assert.deepEqual(unresolvedTargets.map((target) => [
    target.entry_handle,
    target.subject_type,
    target.open_ref,
    target.index_entry,
  ]), [
    ['playbook:missing-flow', 'aos.playbook', null, null],
  ]);

  const targetEntry = state.subject_index_entries.find((entry) => (
    entry.subject_id === 'wiki:aos/concepts/runtime-modes.md'
  ));
  applySubjectIndexFocus(state, targetEntry);
  details = wikiSubjectBrowserSnapshot(state).focused_subject_details;

  assert.equal(details.subject_id, 'wiki:aos/concepts/runtime-modes.md');
  assert.equal(details.summary.incoming_reference_count, 2);
  assert.deepEqual(
    details.incoming_references.map((reference) => [
      reference.direction,
      reference.kind,
      reference.relationship,
      reference.related_subject.subject_id,
      reference.related_subject.resolved,
    ]),
    [
      ['incoming', 'facet_source_reference', 'facet_source_reference', 'demo:related-source', true],
      ['incoming', 'subject_reference', 'guided_by', 'demo:related-source', true],
    ],
  );
  assert.ok(details.incoming_references.every((reference) => (
    reference.semantic_ref.startsWith('wiki-subject-browser-v0:subject-details:incoming:reference:')
  )));
});

test('wiki subject browser focus preserves index filters trail and catalog opening state', async () => {
  const { state } = await subjectBrowserFixtureState();
  applySubjectIndexFilter(state, 'health', 'valid');
  applySubjectNavigationQuery(state, 'browser');
  const entry = state.subject_index_entries.find((candidate) => (
    candidate.subject_id === 'work-record:aos-browser-click-status-2026-05-06'
  ));
  const request = createWikiSubjectBrowserOpenRequestFromCatalogEntry(state.catalog_entries[0]);
  applySubjectOpenRequested(state, request);

  applySubjectIndexFocus(state, entry);
  const snapshot = wikiSubjectBrowserSnapshot(state);

  assert.deepEqual(snapshot.subject_index_filters, {
    subject_type: '',
    relationship_type: '',
    layer: '',
    capability: '',
    health: 'valid',
  });
  assert.equal(snapshot.subject_search_query, 'browser');
  assert.equal(snapshot.subject_index_result_count, 1);
  assert.equal(snapshot.focused_subject_details.subject_id, entry.subject_id);
  assert.equal(snapshot.navigation_history.length, 1);
  assert.equal(snapshot.navigation_trail[0].entry_handle, 'work-record:aos-browser-click-status-2026-05-06');
  assert.equal(snapshot.last_subject_open_request.opener.id, 'work-record-workbench');
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
  applySubjectIndexFilter(state, 'health', 'valid');
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
  assert.equal(snapshot.subject_index_filter_count, 1);
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
  assert.match(indexHtml, /index\.js\?subject-browser-related-nav-v0-state/);
  assert.match(indexJs, /loadGraphOnStart:\s*true/);
  assert.match(indexJs, /applyWikiSubjectBrowserSemanticTarget/);
  assert.match(indexJs, /wikiSubjectBrowserAosRef\('root'\)/);
  assert.match(indexJs, /subject-index-status/);
  assert.match(indexJs, /subjectIndexMarkup/);
  assert.match(indexJs, /subject-search/);
  assert.match(indexJs, /subject-filters/);
  assert.match(indexJs, /subject-filter-subject-type/);
  assert.match(indexJs, /subject-filter-relationship-type/);
  assert.match(indexJs, /subject-filters-reset/);
  assert.match(indexJs, /subjectFiltersMarkup/);
  assert.match(indexJs, /subject-list/);
  assert.match(indexJs, /subject-details/);
  assert.match(indexJs, /subject-index-inspect/);
  assert.match(indexJs, /subject-details-related-open/);
  assert.match(indexJs, /navigation-trail/);
  assert.match(indexJs, /subject-catalog-open/);
  assert.match(indexJs, /subject-index-open/);
  assert.match(indexJs, /work-record-workbench/);
  assert.match(indexJs, /subject_graph_summary/);
  assert.match(indexJs, /subject_index_entries/);
  assert.match(indexJs, /subject_index_filter_options/);
  assert.match(indexJs, /wikiSubjectBrowserAosRef\('subject-filter', role\)/);
  assert.match(launch, /--manifest wiki-subject-browser-v0/);
  assert.match(launch, /SUBJECT_CATALOG_LOAD_TYPE/);
  assert.match(launch, /wiki-subject-browser-v0:subject-search/);
  assert.match(launch, /wiki-subject-browser-v0:subject-filters/);
  assert.match(launch, /wiki-subject-browser-v0:subject-filter:health/);
  assert.match(launch, /wiki-subject-browser-v0:subject-details/);
  assert.match(launch, /wiki-subject-browser-v0:subject-list:inspect:work-record-aos-browser-click-status-2026-05-06/);
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
