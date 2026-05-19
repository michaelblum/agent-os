import {
  SUBJECT_CATALOG_LOAD_TYPE,
  SUBJECT_OPEN_REQUEST_TYPE,
  SUBJECT_OPEN_RESULT_TYPE,
} from '../../workbench/subject-catalog.js';
import {
  createWikiSubjectSelectionPayload,
  WIKI_SUBJECT_OPEN_REQUEST_TYPE,
  WIKI_SUBJECT_SELECTION_TYPE,
} from '../../workbench/wiki-subject-opening.js';
import MarkdownWorkbench from '../markdown-workbench/index.js';
import {
  createButton,
} from '../../controls/button.js';
import { createSelect } from '../../controls/select.js';
import { createTextField } from '../../controls/text-field.js';
import {
  SUBJECT_BROWSER_INDEX_FILTER_KEYS,
  applySubjectIndexFilter,
  applySubjectIndexFocus,
  applySubjectNavigationQuery,
  applySubjectCatalogLoad,
  applySubjectOpenRequested,
  applySubjectOpenResult,
  clearSubjectIndexFocus,
  resetSubjectIndexFilters,
  applyWikiSubjectOpenRequested,
  applyWikiSubjectSelection,
  createWikiSubjectBrowserOpenRequestFromSelection,
  createWikiSubjectBrowserOpenRequestFromCatalogEntry,
  createWikiSubjectBrowserState,
  WIKI_SUBJECT_BROWSER_WORK_RECORD_CANVAS_ID,
  WIKI_SUBJECT_BROWSER_ARTIFACT_BUNDLE_CANVAS_ID,
  WIKI_SUBJECT_BROWSER_SURFACE,
  wikiSubjectBrowserSnapshot,
} from './model.js';
import {
  applyWikiSubjectBrowserSemanticTarget,
  wikiSubjectBrowserAosRef,
} from './semantics.js';

const GRAPH_SELECTION_EVENT = `graph.${WIKI_SUBJECT_SELECTION_TYPE}`;
const WORK_RECORD_WORKBENCH_SURFACE = 'work-record-workbench';
const ARTIFACT_BUNDLE_WORKBENCH_SURFACE = 'artifact-bundle-workbench';

function messageType(message = {}) {
  return message.type || message.payload?.type || '';
}

function text(value, fallback = '') {
  const normalized = String(value ?? '').replace(/\s+/g, ' ').trim();
  return normalized || fallback;
}

function objectValue(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function arrayValue(value) {
  return Array.isArray(value) ? value : [];
}

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function catalogStatusText(snapshot = {}) {
  const entries = Array.isArray(snapshot.catalog_entries) ? snapshot.catalog_entries : [];
  const result = objectValue(snapshot.subject_open_result);
  if (result.status) return `${result.status}: ${result.record_id || result.reason || result.type}`;
  if (entries.length === 0) return 'No catalog entries loaded';
  return `${entries.length} catalog entr${entries.length === 1 ? 'y' : 'ies'} loaded`;
}

function catalogEntryRef(entry = {}, suffix = 'entry') {
  return wikiSubjectBrowserAosRef('subject-catalog', suffix, entry.key || entry.id);
}

function subjectIndexStatusText(snapshot = {}) {
  const summary = objectValue(snapshot.subject_graph_summary);
  const subjects = Number(summary.subject_count || 0);
  const edges = Number(summary.edge_count || 0);
  return `${subjects} subject${subjects === 1 ? '' : 's'} · ${edges} edge${edges === 1 ? '' : 's'}`;
}

function subjectIndexSummaryText(snapshot = {}) {
  const summary = objectValue(snapshot.subject_graph_summary);
  const facets = Number(summary.facet_count || 0);
  const hosts = Number(summary.host_count || 0);
  const relationships = Array.isArray(summary.relationship_types) && summary.relationship_types.length > 0
    ? summary.relationship_types.join(', ')
    : 'none';
  return `${facets} facets · ${hosts} hosts · ${relationships}`;
}

function subjectListStatusText(snapshot = {}) {
  const query = text(snapshot.subject_search_query);
  const filterCount = Number(snapshot.subject_index_filter_count || 0);
  const total = Number(snapshot.subject_graph_summary?.subject_count || 0);
  const shown = Array.isArray(snapshot.subject_index_entries) ? snapshot.subject_index_entries.length : 0;
  if (query || filterCount > 0) {
    const suffix = filterCount > 0 ? ` · ${filterCount} filter${filterCount === 1 ? '' : 's'}` : '';
    return `${shown} of ${total} indexed${suffix}`;
  }
  return `${shown} indexed`;
}

function subjectEntryMetaText(entry = {}) {
  const facets = Number(entry.facet_count || 0);
  const hosts = Number(entry.host_count || 0);
  const refs = Number(entry.reference_count || 0);
  return `${entry.subject_type || 'subject'} · ${facets} facets · ${hosts} hosts · ${refs} refs`;
}

function subjectDetailsStatusText(details = null) {
  if (!details) return 'No focus';
  const summary = objectValue(details.summary);
  const references = Number(summary.reference_count || 0);
  const facets = Number(summary.facet_count || 0);
  const hosts = Number(summary.host_count || 0);
  return `${references} refs · ${facets} facets · ${hosts} hosts`;
}

function referenceMetaText(reference = {}) {
  const target = objectValue(reference.related_subject);
  const role = text(reference.role);
  const facet = text(reference.source_facet_key || reference.target_facet_key);
  const bits = [
    text(reference.relationship, 'references'),
    role ? `role ${role}` : '',
    facet ? `facet ${facet}` : '',
    target.resolved ? 'resolved' : 'unresolved',
  ].filter(Boolean);
  return bits.join(' · ');
}

function relatedSubjectMetaText(target = {}) {
  const bits = [
    text(target.subject_type, 'subject'),
    text(target.entry_handle || target.subject_id),
    text(target.layer) ? `layer ${target.layer}` : '',
    text(target.facet_key) ? `facet ${target.facet_key}` : '',
  ].filter(Boolean);
  return bits.join(' · ');
}

function hostReferenceMetaText(host = {}) {
  const entry = objectValue(host.entry);
  const bits = [
    text(host.facet_key, 'facet'),
    text(host.kind, 'host'),
    text(host.target_dialect),
    text(entry.kind),
    text(entry.value),
  ].filter(Boolean);
  return bits.join(' · ');
}

function subjectFilterOptions(snapshot = {}, filterKey = '') {
  const options = objectValue(snapshot.subject_index_filter_options);
  if (filterKey === 'subject_type') return Array.isArray(options.subject_types) ? options.subject_types : [];
  if (filterKey === 'relationship_type') return Array.isArray(options.relationship_types) ? options.relationship_types : [];
  if (filterKey === 'layer') return Array.isArray(options.layers) ? options.layers : [];
  if (filterKey === 'capability') return Array.isArray(options.capabilities) ? options.capabilities : [];
  if (filterKey === 'health') return Array.isArray(options.health) ? options.health : [];
  return [];
}

function subjectFilterAllLabel(filterKey = '') {
  if (filterKey === 'subject_type') return 'All types';
  if (filterKey === 'relationship_type') return 'All relations';
  if (filterKey === 'layer') return 'All layers';
  if (filterKey === 'capability') return 'All capabilities';
  if (filterKey === 'health') return 'All health';
  return 'All';
}

function subjectFilterName(filterKey = '') {
  if (filterKey === 'subject_type') return 'Type';
  if (filterKey === 'relationship_type') return 'Relation';
  if (filterKey === 'layer') return 'Layer';
  if (filterKey === 'capability') return 'Capability';
  if (filterKey === 'health') return 'Health';
  return 'Filter';
}

function addClassNames(el, className = '') {
  for (const name of String(className || '').split(/\s+/).filter(Boolean)) {
    el.classList.add(name);
  }
}

function createSharedButton({
  label = '',
  className = '',
  disabled = false,
  dataset = {},
  semantic = null,
  onClick = null,
} = {}) {
  const control = createButton({ label, disabled });
  addClassNames(control.el, className);
  for (const [key, value] of Object.entries(dataset)) {
    if (value !== undefined && value !== null) control.el.dataset[key] = String(value);
  }
  if (semantic) applyWikiSubjectBrowserSemanticTarget(control.el, semantic);
  if (label && !control.el.textContent.trim()) control.el.textContent = label;
  if (onClick) control.el.addEventListener('click', onClick);
  return control.el;
}

export default function WikiSubjectBrowser(options = {}) {
  let host = null;
  let rootEl = null;
  let catalogEl = null;
  let catalogStatusEl = null;
  let subjectIndexStatusEl = null;
  let subjectIndexSummaryEl = null;
  let subjectSearchEl = null;
  let subjectFiltersEl = null;
  const subjectFilterEls = new Map();
  let subjectFiltersResetEl = null;
  let subjectListEl = null;
  let subjectListStatusEl = null;
  let subjectDetailsSectionEl = null;
  let subjectDetailsStatusEl = null;
  let subjectDetailsEl = null;
  let navigationTrailEl = null;
  let navigationTrailStatusEl = null;
  let workbenchRegionEl = null;
  let shellSplitter = null;
  let contextSwitcherEl = null;
  let pathCrumbsEl = null;
  let pathStatusEl = null;
  let rootClearEl = null;
  let catalogAccordion = null;
  let subjectListAccordion = null;
  let activeWorkbenchContext = 'catalog';
  let detailDrilldownPath = [];
  const workbenchContextEls = new Map();
  let workbench = null;
  let workbenchHost = null;
  const state = createWikiSubjectBrowserState();

  function mountSemanticPrimitive(root) {
    return {
      mount() {
        return this;
      },
      update() {
        return this;
      },
      destroy() {},
      el: root,
    };
  }

  function syncSnapshot() {
    const snapshot = wikiSubjectBrowserSnapshot(state);
    if (rootEl) {
      rootEl.dataset.contentOpen = String(snapshot.content_open);
      rootEl.dataset.selectedPath = snapshot.selected_path;
      rootEl.dataset.focusedSubjectId = snapshot.focused_subject_id || '';
    }
    renderPathToolbar(snapshot);
    syncWorkbenchContext(snapshot);
    renderCatalog(snapshot);
    renderSubjectIndex(snapshot);
    window.__wikiSubjectBrowserState = snapshot;
    return snapshot;
  }

  function emit(type, payload) {
    host?.emit?.(type, payload);
  }

  function handleWorkbenchEmit(type, payload) {
    if (type === GRAPH_SELECTION_EVENT) {
      applyWikiSubjectSelection(state, payload);
      emit(WIKI_SUBJECT_SELECTION_TYPE, payload);
    } else if (type === WIKI_SUBJECT_OPEN_REQUEST_TYPE) {
      applyWikiSubjectOpenRequested(state, payload);
    }

    emit(type, payload);
    syncSnapshot();
  }

  function makeWorkbenchHost() {
    return {
      contentEl: workbenchRegionEl || rootEl,
      setTitle() {
        host?.setTitle?.('Wiki Subject Browser V0');
      },
      emit: handleWorkbenchEmit,
      subscribe(events, subscribeOptions) {
        return host?.subscribe?.(events, subscribeOptions);
      },
      spawnChild(opts) {
        return host?.spawnChild?.(opts);
      },
      evalCanvas(id, js, evalOptions) {
        return host?.evalCanvas?.(id, js, evalOptions);
      },
    };
  }

  function openerChildCanvasId(opener = {}) {
    if (opener.id === WORK_RECORD_WORKBENCH_SURFACE) return WIKI_SUBJECT_BROWSER_WORK_RECORD_CANVAS_ID;
    if (opener.id === ARTIFACT_BUNDLE_WORKBENCH_SURFACE) return WIKI_SUBJECT_BROWSER_ARTIFACT_BUNDLE_CANVAS_ID;
    return '';
  }

  function openerExpectedState(openMessage = {}, opener = {}) {
    if (opener.id === WORK_RECORD_WORKBENCH_SURFACE) {
      return {
        expected: text(openMessage?.record?.id),
        expression: 'window.__workRecordWorkbenchState?.record?.id',
      };
    }
    if (opener.id === ARTIFACT_BUNDLE_WORKBENCH_SURFACE) {
      return {
        expected: text(openMessage?.subject?.id),
        expression: 'window.__artifactBundleWorkbenchState?.subject?.id',
      };
    }
    return {
      expected: '',
      expression: '""',
    };
  }

  async function postOpenMessageToChild(childId, openMessage, opener = {}) {
    if (!host?.evalCanvas) return false;
    const encoded = btoa(JSON.stringify(openMessage));
    const { expected, expression } = openerExpectedState(openMessage, opener);
    if (!expected) return false;
    const script = `
(function () {
  if (!window.headsup || typeof window.headsup.receive !== "function") return "";
  window.headsup.receive(${JSON.stringify(encoded)});
  return ${expression} === ${JSON.stringify(expected)}
    ? ${JSON.stringify(expected)}
    : "";
})()
`;
    for (let attempt = 0; attempt < 12; attempt += 1) {
      try {
        const result = await host.evalCanvas(childId, script, { timeoutMs: 3000 });
        if (result === expected) return true;
      } catch {}
      await sleep(150);
    }
    return false;
  }

  function catalogEntryForIndexEntry(entry = {}) {
    const entryId = text(entry.catalog_entry_id);
    if (!entryId) return null;
    return state.catalog_entries.find((candidate) => candidate.id === entryId) || null;
  }

  function indexEntryCanOpen(entry = {}) {
    if (entry.source_kind === 'catalog_entry') {
      return catalogEntryForIndexEntry(entry)?.affordances?.openable === true;
    }
    return !!entry.wiki_path;
  }

  function wikiSelectionForNavigationEntry(entry = {}) {
    const wikiPath = text(entry.wiki_path);
    if (!wikiPath) return null;
    const selectedSubject = state.selected_subject?.id === entry.subject_id
      ? state.selected_subject
      : null;
    return createWikiSubjectSelectionPayload({
      id: wikiPath,
      path: wikiPath,
      name: entry.label,
      type: text(entry.subject_type).replace(/^wiki\./, '') || 'page',
      entry_handle: entry.entry_handle,
    }, selectedSubject ? { subject: selectedSubject } : {});
  }

  function openWikiNavigationEntry(entry = {}) {
    const selection = wikiSelectionForNavigationEntry(entry);
    const request = selection ? createWikiSubjectBrowserOpenRequestFromSelection(selection) : null;
    if (!selection || !request) return null;
    applyWikiSubjectSelection(state, selection);
    emit(WIKI_SUBJECT_SELECTION_TYPE, selection);
    workbench?.onMessage?.(selection, workbenchHost);
    if (
      state.last_open_request?.entry_handle !== request.entry_handle
      || state.content_open !== true
    ) {
      applyWikiSubjectOpenRequested(state, request);
    }
    syncSnapshot();
    return request;
  }

  async function openSubjectIndexEntry(entryKey = '') {
    const snapshot = wikiSubjectBrowserSnapshot(state);
    const entry = (snapshot.subject_index_entries || []).find((candidate) => candidate.key === entryKey);
    return openSubjectEntry(entry);
  }

  async function openSubjectEntry(entry = null) {
    if (!entry) return null;
    if (entry.source_kind === 'catalog_entry' && entry.catalog_entry_id) {
      return openCatalogEntry(entry.catalog_entry_id);
    }
    return openWikiNavigationEntry(entry);
  }

  function relatedSubjectCanOpen(target = {}) {
    const entry = objectValue(target.index_entry);
    return target.resolved === true && indexEntryCanOpen(entry);
  }

  async function openRelatedSubject(target = {}) {
    if (!relatedSubjectCanOpen(target)) return null;
    return openSubjectEntry(objectValue(target.index_entry));
  }

  function inspectSubjectIndexEntry(entry = {}) {
    applySubjectIndexFocus(state, entry);
    detailDrilldownPath = [{
      kind: 'subject',
      label: entry.label || entry.entry_handle || entry.subject_id,
      ref: entry.semantic_ref,
    }];
    setWorkbenchContext('details');
    syncSnapshot();
  }

  function clearBrowserFocus() {
    applyWikiSubjectSelection(state, null);
    clearSubjectIndexFocus(state);
    resetSubjectIndexFilters(state);
    detailDrilldownPath = [];
    workbench?.onMessage?.({ type: 'clear-selection' }, workbenchHost);
    setWorkbenchContext('catalog', { sync: false });
    syncSnapshot();
  }

  function pathSegments(snapshot = wikiSubjectBrowserSnapshot(state)) {
    const path = text(snapshot.selected_path);
    if (path) {
      const parts = path.split('/').filter(Boolean);
      return [
        { label: 'Graph Root', index: 0, path: '' },
        ...parts.map((part, index) => ({
          label: part,
          index: index + 1,
          path: parts.slice(0, index + 1).join('/'),
        })),
      ];
    }
    if (detailDrilldownPath.length > 0) {
      return [
        { label: 'Graph Root', index: 0, path: '' },
        ...detailDrilldownPath.map((segment, index) => ({
          label: segment.label,
          index: index + 1,
          path: '',
          detailIndex: index,
        })),
      ];
    }
    const focused = text(snapshot.focused_subject_details?.label || snapshot.focused_subject_id);
    return [
      { label: 'Graph Root', index: 0, path: '' },
      ...(focused ? [{ label: focused, index: 1, path: '' }] : []),
    ];
  }

  function renderPathToolbar(snapshot = wikiSubjectBrowserSnapshot(state)) {
    if (!pathCrumbsEl || !pathStatusEl || !rootClearEl) return;
    const segments = pathSegments(snapshot);
    pathStatusEl.textContent = segments.length > 1 ? 'Drilldown path' : 'Graph root';
    rootClearEl.disabled = !snapshot.selected_path && !snapshot.focused_subject_id && !snapshot.content_open;
    pathCrumbsEl.replaceChildren();
    segments.forEach((segment, index) => {
      if (index > 0) {
        const separator = document.createElement('span');
        separator.className = 'wiki-subject-browser-path-separator';
        separator.textContent = '/';
        pathCrumbsEl.appendChild(separator);
      }
      const isCurrent = index === segments.length - 1;
      const crumb = document.createElement(isCurrent ? 'span' : 'button');
      crumb.className = 'wiki-subject-browser-path-crumb';
      crumb.textContent = segment.label;
      crumb.dataset.pathIndex = String(segment.index);
      if (isCurrent) {
        crumb.setAttribute('aria-current', 'page');
      } else {
        crumb.type = 'button';
        crumb.addEventListener('click', () => {
          if (segment.index === 0) {
            clearBrowserFocus();
            return;
          }
          if (Number.isInteger(segment.detailIndex)) {
            detailDrilldownPath = detailDrilldownPath.slice(0, segment.detailIndex + 1);
            syncSnapshot();
            return;
          }
          const selection = createWikiSubjectSelectionPayload({
            id: segment.path,
            path: segment.path,
            name: segment.label,
            type: 'page',
          });
          applyWikiSubjectSelection(state, selection);
          workbench?.onMessage?.(selection, workbenchHost);
          syncSnapshot();
        });
      }
      pathCrumbsEl.appendChild(crumb);
    });
  }

  function setWorkbenchContext(context = 'catalog', { sync = true } = {}) {
    activeWorkbenchContext = ['catalog', 'index', 'details', 'trail'].includes(context) ? context : 'catalog';
    syncWorkbenchContext();
    if (sync) syncSnapshot();
  }

  function setDetailDrilldownPath(segments = []) {
    detailDrilldownPath = segments.map((segment) => ({
      kind: text(segment.kind, 'detail'),
      label: text(segment.label, 'Detail'),
      ref: text(segment.ref),
    }));
    setWorkbenchContext('details');
    syncSnapshot();
  }

  function syncWorkbenchContext(snapshot = wikiSubjectBrowserSnapshot(state)) {
    for (const [context, element] of workbenchContextEls.entries()) {
      const active = context === activeWorkbenchContext;
      element.hidden = !active;
      element.dataset.active = String(active);
    }
    contextSwitcherEl?.querySelectorAll('[data-workbench-context]')?.forEach((button) => {
      const active = button.dataset.workbenchContext === activeWorkbenchContext;
      button.setAttribute('aria-pressed', String(active));
      button.dataset.active = String(active);
    });
    const detailsButton = contextSwitcherEl?.querySelector('[data-workbench-context="details"]');
    if (detailsButton) detailsButton.dataset.hasFocus = String(!!snapshot.focused_subject_id);
  }

  async function openNavigationTrailEntry(entryKey = '') {
    const snapshot = wikiSubjectBrowserSnapshot(state);
    const entry = (snapshot.navigation_history || []).find((candidate) => candidate.key === entryKey)
      || (snapshot.navigation_trail || []).find((candidate) => candidate.key === entryKey);
    if (!entry) return null;
    if (entry.source_kind === 'catalog' && entry.catalog_entry_id) {
      return openCatalogEntry(entry.catalog_entry_id);
    }
    return openWikiNavigationEntry(entry);
  }

  async function openCatalogEntry(entryId = '') {
    const entry = state.catalog_entries.find((candidate) => (
      candidate.id === entryId || candidate.key === entryId
    ));
    const request = entry ? createWikiSubjectBrowserOpenRequestFromCatalogEntry(entry) : null;
    if (!request) {
      const result = {
        type: SUBJECT_OPEN_RESULT_TYPE,
        schema_version: state.schema_version,
        status: 'rejected',
        reason: entry ? 'no_canonical_opener' : 'catalog_entry_not_found',
        entry_id: entryId,
      };
      applySubjectOpenResult(state, result);
      emit(SUBJECT_OPEN_RESULT_TYPE, result);
      syncSnapshot();
      return result;
    }

    applySubjectOpenRequested(state, request);
    emit(SUBJECT_OPEN_REQUEST_TYPE, request);
    syncSnapshot();

    const childId = openerChildCanvasId(request.opener || {});
    if (!childId) {
      const result = {
        type: SUBJECT_OPEN_RESULT_TYPE,
        schema_version: request.schema_version,
        status: 'rejected',
        reason: 'unsupported_v0_opener',
        entry_id: request.entry_id,
        opener: request.opener,
      };
      applySubjectOpenResult(state, result);
      emit(SUBJECT_OPEN_RESULT_TYPE, result);
      syncSnapshot();
      return result;
    }

    let childError = '';
    try {
      await host?.spawnChild?.({
        id: childId,
        url: request.opener.component_url,
        frame: [96, 104, 1180, 720],
        interactive: true,
      });
    } catch (error) {
      const message = String(error?.message || error);
      if (!/ID_COLLISION|DUPLICATE/i.test(message)) childError = message;
    }

    const childPosted = await postOpenMessageToChild(childId, request.open_message, request.opener);
    const result = {
      type: SUBJECT_OPEN_RESULT_TYPE,
      schema_version: request.schema_version,
      status: childPosted ? 'opened' : 'posted_pending',
      entry_id: request.entry_id,
      entry_handle: request.entry_handle,
      record_id: text(request.open_message?.record?.id) || null,
      artifact_bundle_id: text(request.open_message?.subject?.id) || null,
      subject_type: text(request.subject?.subject_type),
      child_canvas_id: childId,
      ...(request.opener?.id === WORK_RECORD_WORKBENCH_SURFACE ? { work_record_canvas_id: childId } : {}),
      ...(request.opener?.id === ARTIFACT_BUNDLE_WORKBENCH_SURFACE ? { artifact_bundle_canvas_id: childId } : {}),
      child_posted: childPosted,
      ...(childError ? { child_error: childError } : {}),
    };
    applySubjectOpenResult(state, result);
    emit(SUBJECT_OPEN_RESULT_TYPE, result);
    syncSnapshot();
    return result;
  }

  function renderCatalog(snapshot = wikiSubjectBrowserSnapshot(state)) {
    if (!catalogEl || !catalogStatusEl) return;
    const entries = Array.isArray(snapshot.catalog_entries) ? snapshot.catalog_entries : [];
    catalogEl.replaceChildren();
    if (entries.length === 0) {
      const empty = document.createElement('p');
      empty.className = 'wiki-subject-browser-catalog-empty';
      empty.textContent = 'Catalog accepts Workbench Subject descriptors';
      catalogEl.appendChild(empty);
    } else {
      for (const entry of entries) {
        const item = document.createElement('article');
        item.className = 'wiki-subject-browser-catalog-entry';
        item.dataset.aosAccordionItem = '';
        item.dataset.value = entry.key;
        item.dataset.entryId = entry.id;
        applyWikiSubjectBrowserSemanticTarget(item, {
          id: `subject-catalog-entry-${entry.key}`,
          name: entry.label,
          aosRef: catalogEntryRef(entry),
        });

        const title = document.createElement('div');
        title.className = 'wiki-subject-browser-catalog-title';
        title.dataset.aosAccordionItemTrigger = '';
        title.dataset.value = entry.key;
        title.tabIndex = 0;
        title.innerHTML = '<strong></strong><span></span>';
        title.querySelector('strong').textContent = entry.label;
        title.querySelector('span').textContent = entry.subject?.subject_type || 'subject';

        const meta = document.createElement('div');
        meta.className = 'wiki-subject-browser-catalog-meta';
        meta.dataset.aosAccordionItemContent = '';
        meta.dataset.value = entry.key;
        const contracts = Array.isArray(entry.contracts) ? entry.contracts.length : 0;
        const refs = entry.affordances?.reference_count || 0;
        meta.textContent = `${contracts} contracts · ${refs} refs`;

        const button = createSharedButton({
          label: 'Open',
          disabled: entry.affordances?.openable !== true,
          dataset: { subjectOpen: entry.id },
          semantic: {
            id: `subject-catalog-open-${entry.key}`,
            name: `Open ${entry.label}`,
            role: 'AXButton',
            action: 'open_subject',
            enabled: entry.affordances?.openable === true,
            aosRef: catalogEntryRef(entry, 'open'),
          },
          onClick: () => {
          openCatalogEntry(entry.id).catch((error) => {
            const result = {
              type: SUBJECT_OPEN_RESULT_TYPE,
              schema_version: snapshot.schema_version,
              status: 'rejected',
              reason: String(error?.message || error),
              entry_id: entry.id,
            };
            applySubjectOpenResult(state, result);
            syncSnapshot();
          });
          },
        });

        item.append(title, meta, button);
        catalogEl.appendChild(item);
      }
    }
    catalogStatusEl.textContent = catalogStatusText(snapshot);
    catalogAccordion?.update?.();
  }

  function renderSubjectIndex(snapshot = wikiSubjectBrowserSnapshot(state)) {
    if (!subjectIndexStatusEl || !subjectIndexSummaryEl) return;
    subjectIndexStatusEl.textContent = subjectIndexStatusText(snapshot);
    subjectIndexSummaryEl.textContent = subjectIndexSummaryText(snapshot);
    if (subjectSearchEl && subjectSearchEl.value !== snapshot.subject_search_query) {
      subjectSearchEl.value = snapshot.subject_search_query || '';
    }
    renderSubjectFilters(snapshot);
    if (subjectListStatusEl) subjectListStatusEl.textContent = subjectListStatusText(snapshot);
    if (subjectListEl) {
      const entries = Array.isArray(snapshot.subject_index_entries) ? snapshot.subject_index_entries : [];
      subjectListEl.replaceChildren();
      if (entries.length === 0) {
        const empty = document.createElement('p');
        empty.className = 'wiki-subject-browser-empty';
        empty.textContent = snapshot.subject_search_query || snapshot.subject_index_filters_active
          ? 'No indexed Subjects match search and filters'
          : 'No indexed Subjects loaded';
        subjectListEl.appendChild(empty);
      } else {
        for (const entry of entries) {
          const focused = snapshot.focused_subject_id === entry.subject_id
            || snapshot.focused_entry_handle === entry.entry_handle;
          const item = document.createElement('article');
          item.className = 'wiki-subject-browser-subject-entry';
          item.dataset.aosAccordionItem = '';
          item.dataset.value = entry.key;
          item.dataset.subjectId = entry.subject_id;
          item.dataset.entryHandle = entry.entry_handle;
          item.dataset.focused = String(focused);
          applyWikiSubjectBrowserSemanticTarget(item, {
            id: `subject-index-entry-${entry.key}`,
            name: entry.label,
            selected: focused,
            aosRef: entry.semantic_ref,
          });

          const title = document.createElement('div');
          title.className = 'wiki-subject-browser-subject-title';
          title.dataset.aosAccordionItemTrigger = '';
          title.dataset.value = entry.key;
          title.tabIndex = 0;
          title.innerHTML = '<strong></strong><span></span>';
          title.querySelector('strong').textContent = entry.label;
          title.querySelector('span').textContent = entry.entry_handle;

          const meta = document.createElement('div');
          meta.className = 'wiki-subject-browser-subject-meta';
          meta.dataset.aosAccordionItemContent = '';
          meta.dataset.value = entry.key;
          meta.textContent = subjectEntryMetaText(entry);

          const actions = document.createElement('div');
          actions.className = 'wiki-subject-browser-subject-actions';

          const inspectButton = createSharedButton({
            label: 'Inspect',
            dataset: { subjectIndexInspect: entry.key },
            semantic: {
              id: `subject-index-inspect-${entry.key}`,
              name: `Inspect ${entry.label}`,
              role: 'AXButton',
              action: 'inspect_subject',
              current: focused ? 'true' : null,
              aosRef: entry.inspect_ref,
            },
            onClick: () => {
            inspectSubjectIndexEntry(entry);
            },
          });

          const canOpen = indexEntryCanOpen(entry);
          const openButton = createSharedButton({
            label: 'Open',
            disabled: !canOpen,
            dataset: { subjectIndexOpen: entry.key },
            semantic: {
              id: `subject-index-open-${entry.key}`,
              name: `Open ${entry.label}`,
              role: 'AXButton',
              action: 'open_subject',
              enabled: canOpen,
              aosRef: entry.open_ref,
            },
            onClick: () => {
            openSubjectIndexEntry(entry.key).catch((error) => {
              const result = {
                type: SUBJECT_OPEN_RESULT_TYPE,
                schema_version: snapshot.schema_version,
                status: 'rejected',
                reason: String(error?.message || error),
                entry_id: entry.catalog_entry_id,
                entry_handle: entry.entry_handle,
              };
              applySubjectOpenResult(state, result);
              syncSnapshot();
            });
            },
          });

          actions.append(inspectButton, openButton);
          item.append(title, meta, actions);
          subjectListEl.appendChild(item);
        }
      }
      subjectListAccordion?.update?.();
    }
    renderSubjectDetails(snapshot);
    renderNavigationTrail(snapshot);
  }

  function renderSubjectFilters(snapshot = wikiSubjectBrowserSnapshot(state)) {
    if (!subjectFiltersEl) return;
    const activeFilters = objectValue(snapshot.subject_index_filters);
    for (const filterKey of SUBJECT_BROWSER_INDEX_FILTER_KEYS) {
      const select = subjectFilterEls.get(filterKey);
      if (!select) continue;
      const selected = text(activeFilters[filterKey]);
      const options = subjectFilterOptions(snapshot, filterKey);
      select.replaceChildren();
      const all = document.createElement('option');
      all.value = '';
      all.textContent = subjectFilterAllLabel(filterKey);
      select.appendChild(all);
      for (const option of options) {
        const item = document.createElement('option');
        item.value = option.value;
        item.textContent = `${option.label} (${option.count})`;
        item.dataset.aosRef = option.semantic_ref;
        select.appendChild(item);
      }
      select.value = options.some((option) => option.value === selected) ? selected : '';
    }
    if (subjectFiltersResetEl) {
      subjectFiltersResetEl.disabled = snapshot.subject_index_filters_active !== true;
    }
  }

  function renderSubjectDetails(snapshot = wikiSubjectBrowserSnapshot(state)) {
    if (!subjectDetailsEl || !subjectDetailsStatusEl) return;
    const details = snapshot.focused_subject_found ? objectValue(snapshot.focused_subject_details) : null;
    subjectDetailsStatusEl.textContent = subjectDetailsStatusText(details);
    subjectDetailsEl.replaceChildren();

    if (!details) {
      const empty = document.createElement('p');
      empty.className = 'wiki-subject-browser-empty';
      empty.textContent = 'Inspect a Subject from the index';
      subjectDetailsEl.appendChild(empty);
      return;
    }

    const subject = document.createElement('article');
    subject.className = 'wiki-subject-browser-details-subject';
    applyWikiSubjectBrowserSemanticTarget(subject, {
      id: `subject-details-subject-${details.key}`,
      name: `Focused Subject ${details.label}`,
      selected: true,
      aosRef: details.semantic_ref,
    });
    const title = document.createElement('div');
    title.className = 'wiki-subject-browser-details-title';
    title.innerHTML = '<strong></strong><span></span>';
    title.querySelector('strong').textContent = details.label;
    title.querySelector('span').textContent = details.entry_handle || details.subject_id;
    const meta = document.createElement('div');
    meta.className = 'wiki-subject-browser-details-meta';
    meta.textContent = subjectDetailsStatusText(details);
    subject.append(title, meta);
    if (details.health) {
      const health = document.createElement('div');
      health.className = 'wiki-subject-browser-health aos-collapsible';
      health.dataset.aosCollapsibleRoot = '';
      health.innerHTML = `
        <button type="button" data-aos-collapsible-trigger>Health JSON</button>
        <pre data-aos-collapsible-content></pre>
      `;
      health.querySelector('pre').textContent = JSON.stringify(details.health, null, 2);
      mountSemanticPrimitive(health).mount();
      subject.appendChild(health);
    }

    const controls = document.createElement('div');
    controls.className = 'wiki-subject-browser-details-actions';
    const clear = createSharedButton({
      label: 'Clear',
      semantic: {
        id: 'subject-details-clear',
        name: 'Clear focused Subject details',
        role: 'AXButton',
        action: 'clear_subject_focus',
        aosRef: details.clear_ref,
      },
      onClick: () => {
      clearSubjectIndexFocus(state);
      syncSnapshot();
      },
    });
    controls.appendChild(clear);
    subject.appendChild(controls);
    subjectDetailsEl.appendChild(subject);

    renderReferenceGroup('Outgoing', arrayValue(details.outgoing_references));
    renderReferenceGroup('Incoming', arrayValue(details.incoming_references));
    renderFacetGroup(arrayValue(details.facets));
    renderHostGroup(arrayValue(details.hosts));
  }

  function renderReferenceGroup(labelText, references = []) {
    const group = document.createElement('section');
    group.className = 'wiki-subject-browser-details-group';
    const heading = document.createElement('h3');
    heading.textContent = `${labelText} refs`;
    group.appendChild(heading);
    if (references.length === 0) {
      const empty = document.createElement('p');
      empty.className = 'wiki-subject-browser-empty';
      empty.textContent = `No ${labelText.toLowerCase()} Subject References`;
      group.appendChild(empty);
      subjectDetailsEl.appendChild(group);
      return;
    }

    for (const reference of references) {
      const target = objectValue(reference.related_subject);
      const item = document.createElement('article');
      item.className = 'wiki-subject-browser-related-reference';
      applyWikiSubjectBrowserSemanticTarget(item, {
        id: `subject-details-${reference.direction}-reference-${reference.id}`,
        name: `${labelText} ${reference.relationship}`,
        aosRef: reference.semantic_ref,
      });

      const title = document.createElement('div');
      title.className = 'wiki-subject-browser-related-title';
      title.innerHTML = '<strong></strong><span></span>';
      title.querySelector('strong').textContent = target.label || target.entry_handle || 'Unresolved Subject';
      title.querySelector('span').textContent = referenceMetaText(reference);

      const meta = document.createElement('div');
      meta.className = 'wiki-subject-browser-details-meta';
      meta.textContent = relatedSubjectMetaText(target);

      const canOpen = relatedSubjectCanOpen(target);
      const openButton = createSharedButton({
        label: target.resolved ? 'Open' : 'Unresolved',
        disabled: !canOpen,
        semantic: {
          id: `subject-details-related-open-${target.key || reference.id}`,
          name: target.resolved ? `Open ${target.label}` : `Unresolved ${target.label}`,
          role: 'AXButton',
          action: 'open_subject',
          enabled: canOpen,
          aosRef: target.open_ref || wikiSubjectBrowserAosRef('subject-details', 'related', 'unresolved', target.key || reference.id),
        },
        onClick: () => {
        openRelatedSubject(target).catch((error) => {
          const result = {
            type: SUBJECT_OPEN_RESULT_TYPE,
            schema_version: wikiSubjectBrowserSnapshot(state).schema_version,
            status: 'rejected',
            reason: String(error?.message || error),
            entry_handle: target.entry_handle,
          };
          applySubjectOpenResult(state, result);
          syncSnapshot();
        });
        },
      });

      item.append(title, meta, openButton);
      group.appendChild(item);
    }
    subjectDetailsEl.appendChild(group);
  }

  function renderFacetGroup(facets = []) {
    const group = document.createElement('section');
    group.className = 'wiki-subject-browser-details-group';
    const heading = document.createElement('h3');
    heading.textContent = 'Facets';
    group.appendChild(heading);
    if (facets.length === 0) {
      const empty = document.createElement('p');
      empty.className = 'wiki-subject-browser-empty';
      empty.textContent = 'No Facets indexed';
      group.appendChild(empty);
      subjectDetailsEl.appendChild(group);
      return;
    }
    for (const facet of facets) {
      const item = document.createElement('div');
      item.className = 'wiki-subject-browser-detail-row';
      applyWikiSubjectBrowserSemanticTarget(item, {
        id: `subject-details-facet-${facet.key}`,
        name: facet.label || facet.key,
        aosRef: facet.semantic_ref,
      });
      item.innerHTML = '<strong></strong><span></span>';
      item.querySelector('strong').textContent = facet.label || facet.key;
      item.querySelector('span').textContent = `${facet.layer || 'layer'} · ${facet.host_count || 0} hosts`;
      item.tabIndex = 0;
      item.dataset.detailFacetKey = facet.key || '';
      item.addEventListener('click', () => {
        const details = objectValue(wikiSubjectBrowserSnapshot(state).focused_subject_details);
        setDetailDrilldownPath([
          { kind: 'subject', label: details.label || details.entry_handle || 'Subject' },
          { kind: 'facet', label: facet.label || facet.key, ref: facet.semantic_ref },
        ]);
      });
      group.appendChild(item);
    }
    subjectDetailsEl.appendChild(group);
  }

  function renderHostGroup(hosts = []) {
    const group = document.createElement('section');
    group.className = 'wiki-subject-browser-details-group';
    const heading = document.createElement('h3');
    heading.textContent = 'Hosts';
    group.appendChild(heading);
    if (hosts.length === 0) {
      const empty = document.createElement('p');
      empty.className = 'wiki-subject-browser-empty';
      empty.textContent = 'No Host references indexed';
      group.appendChild(empty);
      subjectDetailsEl.appendChild(group);
      return;
    }
    for (const hostReference of hosts) {
      const item = document.createElement('div');
      item.className = 'wiki-subject-browser-detail-row';
      applyWikiSubjectBrowserSemanticTarget(item, {
        id: `subject-details-host-${hostReference.id}`,
        name: `${hostReference.facet_key} ${hostReference.kind} host`,
        aosRef: hostReference.semantic_ref,
      });
      item.innerHTML = '<strong></strong><span></span>';
      item.querySelector('strong').textContent = `${hostReference.facet_key || 'facet'} host`;
      item.querySelector('span').textContent = hostReferenceMetaText(hostReference);
      item.tabIndex = 0;
      item.dataset.detailHostId = hostReference.id || '';
      item.addEventListener('click', () => {
        const details = objectValue(wikiSubjectBrowserSnapshot(state).focused_subject_details);
        setDetailDrilldownPath([
          { kind: 'subject', label: details.label || details.entry_handle || 'Subject' },
          { kind: 'facet', label: hostReference.facet_key || 'facet' },
          {
            kind: 'host',
            label: hostReference.entry?.facet || hostReference.entry?.value || hostReference.kind || 'Host',
            ref: hostReference.semantic_ref,
          },
        ]);
      });
      group.appendChild(item);
    }
    subjectDetailsEl.appendChild(group);
  }

  function renderNavigationTrail(snapshot = wikiSubjectBrowserSnapshot(state)) {
    if (!navigationTrailEl || !navigationTrailStatusEl) return;
    const trail = Array.isArray(snapshot.navigation_trail) ? snapshot.navigation_trail : [];
    navigationTrailStatusEl.textContent = `${trail.length} recent`;
    navigationTrailEl.replaceChildren();
    if (trail.length === 0) {
      const empty = document.createElement('p');
      empty.className = 'wiki-subject-browser-empty';
      empty.textContent = 'No Subjects opened yet';
      navigationTrailEl.appendChild(empty);
      return;
    }

    const latest = trail[trail.length - 1]?.entry_handle || '';
    for (const entry of [...trail].reverse()) {
      const button = createSharedButton({
        className: 'wiki-subject-browser-trail-entry',
        dataset: { entryHandle: entry.entry_handle },
        semantic: {
          id: `navigation-trail-open-${entry.key}`,
          name: `Open ${entry.label}`,
          role: 'AXButton',
          action: 'open_subject',
          current: entry.entry_handle === latest ? 'page' : null,
          aosRef: entry.open_ref,
        },
      });
      const label = document.createElement('span');
      label.textContent = entry.label;
      const meta = document.createElement('small');
      meta.textContent = entry.subject_type || entry.source_kind;
      button.append(label, meta);
      button.addEventListener('click', () => {
        openNavigationTrailEntry(entry.key).catch((error) => {
          const result = {
            type: SUBJECT_OPEN_RESULT_TYPE,
            schema_version: snapshot.schema_version,
            status: 'rejected',
            reason: String(error?.message || error),
            entry_handle: entry.entry_handle,
          };
          applySubjectOpenResult(state, result);
          syncSnapshot();
        });
      });
      navigationTrailEl.appendChild(button);
    }
  }

  function handleSelectionMessage(message = {}) {
    const selection = Object.prototype.hasOwnProperty.call(message, 'payload')
      ? message.payload
      : message;
    applyWikiSubjectSelection(state, selection);
    syncSnapshot();
  }

  return {
    manifest: {
      name: WIKI_SUBJECT_BROWSER_SURFACE,
      title: 'Wiki Subject Browser V0',
      accepts: [
        WIKI_SUBJECT_SELECTION_TYPE,
        'markdown_document.open',
        'markdown_document.text.patch',
        'markdown_document.save.result',
        'wiki_page_changed',
        SUBJECT_CATALOG_LOAD_TYPE,
        SUBJECT_OPEN_REQUEST_TYPE,
        'graph',
        'graph/update',
        'wiki-kb/graph',
        'wiki-kb/graph/update',
        'wiki-kb/reveal',
        'wiki-kb/clear-selection',
        'wiki-kb/set-view',
        'wiki-kb/fit-view',
        'set-view',
        'fit-view',
      ],
      emits: [
        WIKI_SUBJECT_SELECTION_TYPE,
        WIKI_SUBJECT_OPEN_REQUEST_TYPE,
        SUBJECT_OPEN_REQUEST_TYPE,
        SUBJECT_OPEN_RESULT_TYPE,
        'graph.selection',
        GRAPH_SELECTION_EVENT,
        'markdown-workbench/save.requested',
        'markdown-workbench/save.result',
      ],
      channelPrefix: WIKI_SUBJECT_BROWSER_SURFACE,
      defaultSize: { w: 1220, h: 760 },
      requires: ['wiki_page_changed'],
    },

    render(host_) {
      host = host_;
      rootEl = document.createElement('div');
      rootEl.className = 'wiki-subject-browser-root';
      applyWikiSubjectBrowserSemanticTarget(rootEl, {
        id: 'root',
        name: 'Wiki Subject Browser V0',
        aosRef: wikiSubjectBrowserAosRef('root'),
      });
      rootEl.innerHTML = `
        <header class="wiki-subject-browser-pathbar" aria-label="Subject path">
          <div class="wiki-subject-browser-pathbar-label">
            <strong>Path</strong>
            <span data-role="path-status"></span>
          </div>
          <nav class="wiki-subject-browser-path" data-role="path-crumbs" aria-label="Active drilldown path"></nav>
          <button type="button" class="wiki-subject-browser-root-clear" data-role="root-clear">Clear</button>
        </header>
        <div class="wiki-subject-browser-shell aos-splitter" data-role="browser-shell" data-aos-splitter-root>
          <section class="wiki-subject-browser-workbench-region aos-splitter__panel" data-role="workbench-region" data-aos-splitter-panel data-value="graph"></section>
          <button type="button" class="wiki-subject-browser-resize aos-splitter__resize-trigger" data-aos-splitter-resize-trigger data-value="graph:workbench" aria-label="Resize browser workbench"></button>
          <aside class="wiki-subject-browser-catalog aos-splitter__panel" aria-label="Subject browser workbench" data-aos-splitter-panel data-value="workbench">
            <header>
              <strong>Workbench</strong>
              <span data-role="catalog-status"></span>
            </header>
            <div class="wiki-subject-browser-context-switcher" data-role="context-switcher" aria-label="Workbench contexts">
              <button type="button" data-workbench-context="catalog">Catalog</button>
              <button type="button" data-workbench-context="index">Index</button>
              <button type="button" data-workbench-context="details">Details</button>
              <button type="button" data-workbench-context="trail">Trail</button>
            </div>
            <section class="wiki-subject-browser-context wiki-subject-browser-catalog-context" aria-label="Subject catalog" data-role="catalog-context" data-workbench-context-panel="catalog">
              <header>
                <strong>Catalog</strong>
                <span data-role="catalog-context-status"></span>
              </header>
              <div class="wiki-subject-browser-accordion aos-accordion" data-role="catalog-list" data-aos-accordion-root></div>
            </section>
            <section class="wiki-subject-browser-context wiki-subject-browser-index" aria-label="Subject graph index" data-role="subject-index" data-workbench-context-panel="index">
            <header>
              <strong>Subject Index</strong>
              <span data-role="subject-index-status"></span>
            </header>
            <div data-role="subject-index-summary"></div>
            <label class="wiki-subject-browser-search">
              <span>Search</span>
              <input data-role="subject-search" type="search" autocomplete="off" spellcheck="false">
            </label>
            <div class="wiki-subject-browser-filters" data-role="subject-filters" aria-label="Subject index filters">
              <label>
                <span>Type</span>
                <select data-role="subject-filter-subject-type"></select>
              </label>
              <label>
                <span>Relation</span>
                <select data-role="subject-filter-relationship-type"></select>
              </label>
              <label>
                <span>Layer</span>
                <select data-role="subject-filter-layer"></select>
              </label>
              <label>
                <span>Capability</span>
                <select data-role="subject-filter-capability"></select>
              </label>
              <label>
                <span>Health</span>
                <select data-role="subject-filter-health"></select>
              </label>
              <button type="button" data-role="subject-filters-reset">Reset</button>
            </div>
            <div class="wiki-subject-browser-list-status" data-role="subject-list-status"></div>
            <div class="wiki-subject-browser-subject-list aos-accordion" data-role="subject-list" data-aos-accordion-root></div>
          </section>
          <section class="wiki-subject-browser-context wiki-subject-browser-details" aria-label="Focused Subject details" data-role="subject-details-section" data-workbench-context-panel="details">
            <header>
              <strong>Details</strong>
              <span data-role="subject-details-status"></span>
            </header>
            <div data-role="subject-details"></div>
          </section>
          <section class="wiki-subject-browser-context wiki-subject-browser-trail" aria-label="Navigation trail" data-role="navigation-trail-section" data-workbench-context-panel="trail">
            <header>
              <strong>Trail</strong>
              <span data-role="navigation-trail-status"></span>
            </header>
            <div data-role="navigation-trail"></div>
          </section>
          </aside>
        </div>
      `;
      pathStatusEl = rootEl.querySelector('[data-role="path-status"]');
      pathCrumbsEl = rootEl.querySelector('[data-role="path-crumbs"]');
      rootClearEl = rootEl.querySelector('[data-role="root-clear"]');
      applyWikiSubjectBrowserSemanticTarget(pathCrumbsEl, {
        id: 'active-path',
        name: 'Active drilldown path',
        aosRef: wikiSubjectBrowserAosRef('path'),
      });
      applyWikiSubjectBrowserSemanticTarget(rootClearEl, {
        id: 'root-clear',
        name: 'Clear Subject Browser focus',
        role: 'AXButton',
        action: 'clear_subject_browser',
        aosRef: wikiSubjectBrowserAosRef('path', 'clear'),
      });
      rootClearEl.textContent = 'Clear';
      rootClearEl?.addEventListener('click', clearBrowserFocus);
      shellSplitter = mountSemanticPrimitive(rootEl.querySelector('[data-role="browser-shell"]'));
      shellSplitter.mount();
      workbenchRegionEl = rootEl.querySelector('[data-role="workbench-region"]');
      const catalogAside = rootEl.querySelector('.wiki-subject-browser-catalog');
      const catalogMarkup = catalogAside.innerHTML;
      applyWikiSubjectBrowserSemanticTarget(catalogAside, {
        id: 'subject-catalog',
        name: 'Subject catalog',
        aosRef: wikiSubjectBrowserAosRef('subject-catalog'),
      });
      catalogAside.innerHTML = catalogMarkup;
      catalogStatusEl = catalogAside.querySelector('[data-role="catalog-status"]');
      contextSwitcherEl = catalogAside.querySelector('[data-role="context-switcher"]');
      contextSwitcherEl?.querySelectorAll('[data-workbench-context]')?.forEach((button) => {
        button.addEventListener('click', () => setWorkbenchContext(button.dataset.workbenchContext));
      });
      for (const panel of catalogAside.querySelectorAll('[data-workbench-context-panel]')) {
        workbenchContextEls.set(panel.dataset.workbenchContextPanel, panel);
      }
      const catalogContextEl = catalogAside.querySelector('[data-role="catalog-context"]');
      const catalogContextMarkup = catalogContextEl.innerHTML;
      applyWikiSubjectBrowserSemanticTarget(catalogContextEl, {
        id: 'subject-catalog-context',
        name: 'Subject catalog context',
        aosRef: wikiSubjectBrowserAosRef('subject-catalog', 'context'),
      });
      catalogContextEl.innerHTML = catalogContextMarkup;
      catalogEl = catalogContextEl.querySelector('[data-role="catalog-list"]');
      catalogAccordion = mountSemanticPrimitive(catalogEl);
      catalogAccordion.mount();
      const subjectIndexEl = catalogAside.querySelector('[data-role="subject-index"]');
      const subjectIndexMarkup = subjectIndexEl.innerHTML;
      applyWikiSubjectBrowserSemanticTarget(catalogStatusEl, {
        id: 'subject-catalog-status',
        name: 'Subject catalog status',
        aosRef: wikiSubjectBrowserAosRef('subject-catalog-status'),
      });
      applyWikiSubjectBrowserSemanticTarget(subjectIndexEl, {
        id: 'subject-index',
        name: 'Subject graph index',
        aosRef: wikiSubjectBrowserAosRef('subject-index'),
      });
      subjectIndexEl.innerHTML = subjectIndexMarkup;
      subjectIndexStatusEl = subjectIndexEl.querySelector('[data-role="subject-index-status"]');
      subjectIndexSummaryEl = subjectIndexEl.querySelector('[data-role="subject-index-summary"]');
      subjectSearchEl = subjectIndexEl.querySelector('[data-role="subject-search"]');
      if (subjectSearchEl) {
        const searchControl = createTextField();
        const searchInput = searchControl.el.querySelector('input');
        searchInput.type = 'search';
        searchInput.autocomplete = 'off';
        searchInput.spellcheck = false;
        searchInput.dataset.role = 'subject-search';
        subjectSearchEl.replaceWith(searchControl.el);
        subjectSearchEl = searchInput;
      }
      subjectFiltersEl = subjectIndexEl.querySelector('[data-role="subject-filters"]');
      subjectListStatusEl = subjectIndexEl.querySelector('[data-role="subject-list-status"]');
      subjectListEl = subjectIndexEl.querySelector('[data-role="subject-list"]');
      subjectListAccordion = mountSemanticPrimitive(subjectListEl);
      subjectListAccordion.mount();
      applyWikiSubjectBrowserSemanticTarget(subjectIndexStatusEl, {
        id: 'subject-index-status',
        name: 'Subject graph index status',
        aosRef: wikiSubjectBrowserAosRef('subject-index-status'),
      });
      applyWikiSubjectBrowserSemanticTarget(subjectIndexSummaryEl, {
        id: 'subject-index-summary',
        name: 'Subject graph index summary',
        aosRef: wikiSubjectBrowserAosRef('subject-index-summary'),
      });
      applyWikiSubjectBrowserSemanticTarget(subjectSearchEl, {
        id: 'subject-search',
        name: 'Search indexed Subjects',
        role: 'AXSearchField',
        action: 'filter_subjects',
        aosRef: wikiSubjectBrowserAosRef('subject-search'),
      });
      const subjectFiltersMarkup = subjectFiltersEl.innerHTML;
      applyWikiSubjectBrowserSemanticTarget(subjectFiltersEl, {
        id: 'subject-filters',
        name: 'Subject index filters',
        aosRef: wikiSubjectBrowserAosRef('subject-filters'),
      });
      subjectFiltersEl.innerHTML = subjectFiltersMarkup;
      for (const filterKey of SUBJECT_BROWSER_INDEX_FILTER_KEYS) {
        const role = filterKey.replaceAll('_', '-');
        const select = subjectIndexEl.querySelector(`[data-role="subject-filter-${role}"]`);
        const selectControl = createSelect();
        const sharedSelect = selectControl.el.querySelector('select');
        sharedSelect.dataset.role = `subject-filter-${role}`;
        select?.replaceWith(selectControl.el);
        subjectFilterEls.set(filterKey, sharedSelect);
        applyWikiSubjectBrowserSemanticTarget(sharedSelect, {
          id: `subject-filter-${role}`,
          name: `${subjectFilterName(filterKey)} filter`,
          role: 'AXPopUpButton',
          action: 'filter_subjects',
          aosRef: wikiSubjectBrowserAosRef('subject-filter', role),
        });
        sharedSelect?.addEventListener('change', () => {
          applySubjectIndexFilter(state, filterKey, sharedSelect.value);
          syncSnapshot();
        });
      }
      subjectFiltersResetEl = subjectIndexEl.querySelector('[data-role="subject-filters-reset"]');
      if (subjectFiltersResetEl) {
        const resetControl = createButton({ label: 'Reset' });
        resetControl.el.dataset.role = 'subject-filters-reset';
        subjectFiltersResetEl.replaceWith(resetControl.el);
        subjectFiltersResetEl = resetControl.el;
      }
      applyWikiSubjectBrowserSemanticTarget(subjectFiltersResetEl, {
        id: 'subject-filters-reset',
        name: 'Reset Subject index filters',
        role: 'AXButton',
        action: 'reset_subject_filters',
        aosRef: wikiSubjectBrowserAosRef('subject-filters', 'reset'),
      });
      subjectFiltersResetEl?.addEventListener('click', () => {
        resetSubjectIndexFilters(state);
        syncSnapshot();
      });
      applyWikiSubjectBrowserSemanticTarget(subjectListStatusEl, {
        id: 'subject-list-status',
        name: 'Subject list status',
        aosRef: wikiSubjectBrowserAosRef('subject-list-status'),
      });
      applyWikiSubjectBrowserSemanticTarget(subjectListEl, {
        id: 'subject-list',
        name: 'Indexed Subject list',
        aosRef: wikiSubjectBrowserAosRef('subject-list'),
      });
      subjectSearchEl?.addEventListener('input', () => {
        applySubjectNavigationQuery(state, subjectSearchEl.value);
        syncSnapshot();
      });

      subjectDetailsSectionEl = catalogAside.querySelector('[data-role="subject-details-section"]');
      const subjectDetailsMarkup = subjectDetailsSectionEl.innerHTML;
      applyWikiSubjectBrowserSemanticTarget(subjectDetailsSectionEl, {
        id: 'subject-details',
        name: 'Focused Subject details',
        aosRef: wikiSubjectBrowserAosRef('subject-details'),
      });
      subjectDetailsSectionEl.innerHTML = subjectDetailsMarkup;
      subjectDetailsStatusEl = subjectDetailsSectionEl.querySelector('[data-role="subject-details-status"]');
      subjectDetailsEl = subjectDetailsSectionEl.querySelector('[data-role="subject-details"]');
      applyWikiSubjectBrowserSemanticTarget(subjectDetailsStatusEl, {
        id: 'subject-details-status',
        name: 'Focused Subject details status',
        aosRef: wikiSubjectBrowserAosRef('subject-details-status'),
      });
      applyWikiSubjectBrowserSemanticTarget(subjectDetailsEl, {
        id: 'subject-details-body',
        name: 'Focused Subject details body',
        aosRef: wikiSubjectBrowserAosRef('subject-details-body'),
      });

      const navigationTrailSectionEl = catalogAside.querySelector('[data-role="navigation-trail-section"]');
      const navigationTrailMarkup = navigationTrailSectionEl.innerHTML;
      applyWikiSubjectBrowserSemanticTarget(navigationTrailSectionEl, {
        id: 'navigation-trail',
        name: 'Navigation trail',
        aosRef: wikiSubjectBrowserAosRef('navigation-trail'),
      });
      navigationTrailSectionEl.innerHTML = navigationTrailMarkup;
      navigationTrailStatusEl = navigationTrailSectionEl.querySelector('[data-role="navigation-trail-status"]');
      navigationTrailEl = navigationTrailSectionEl.querySelector('[data-role="navigation-trail"]');
      applyWikiSubjectBrowserSemanticTarget(navigationTrailStatusEl, {
        id: 'navigation-trail-status',
        name: 'Navigation trail status',
        aosRef: wikiSubjectBrowserAosRef('navigation-trail-status'),
      });
      applyWikiSubjectBrowserSemanticTarget(navigationTrailEl, {
        id: 'navigation-trail-list',
        name: 'Navigation trail list',
        aosRef: wikiSubjectBrowserAosRef('navigation-trail-list'),
      });

      workbench = MarkdownWorkbench({
        ...options,
        openContent: false,
        loadGraphOnStart: true,
      });
      workbenchHost = makeWorkbenchHost();
      const rendered = workbench.render(workbenchHost);
      if (rendered instanceof Node) workbenchRegionEl.appendChild(rendered);
      else if (typeof rendered === 'string') workbenchRegionEl.innerHTML = rendered;
      syncSnapshot();
      return rootEl;
    },

    onMessage(message = {}) {
      const type = messageType(message);
      if (type === WIKI_SUBJECT_SELECTION_TYPE) {
        handleSelectionMessage(message);
      } else if (type === SUBJECT_CATALOG_LOAD_TYPE) {
        applySubjectCatalogLoad(state, message);
      } else if (type === SUBJECT_OPEN_REQUEST_TYPE) {
        applySubjectOpenRequested(state, message.payload || message);
      }
      workbench?.onMessage?.(message, workbenchHost);
      syncSnapshot();
    },

    serialize() {
      return {
        ...wikiSubjectBrowserSnapshot(state),
        workbench: workbench?.serialize?.() || null,
      };
    },
  };
}
