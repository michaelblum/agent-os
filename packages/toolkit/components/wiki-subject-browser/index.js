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
  applySubjectNavigationQuery,
  applySubjectCatalogLoad,
  applySubjectOpenRequested,
  applySubjectOpenResult,
  applyWikiSubjectOpenRequested,
  applyWikiSubjectSelection,
  createWikiSubjectBrowserOpenRequestFromSelection,
  createWikiSubjectBrowserOpenRequestFromCatalogEntry,
  createWikiSubjectBrowserState,
  WIKI_SUBJECT_BROWSER_WORK_RECORD_CANVAS_ID,
  WIKI_SUBJECT_BROWSER_SURFACE,
  wikiSubjectBrowserSnapshot,
} from './model.js';
import {
  applyWikiSubjectBrowserSemanticTarget,
  wikiSubjectBrowserAosRef,
} from './semantics.js';

const GRAPH_SELECTION_EVENT = `graph.${WIKI_SUBJECT_SELECTION_TYPE}`;
const WORK_RECORD_WORKBENCH_SURFACE = 'work-record-workbench';

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
  const total = Number(snapshot.subject_graph_summary?.subject_count || 0);
  const shown = Array.isArray(snapshot.subject_index_entries) ? snapshot.subject_index_entries.length : 0;
  if (query) return `${shown} of ${total} indexed`;
  return `${shown} indexed`;
}

function subjectEntryMetaText(entry = {}) {
  const facets = Number(entry.facet_count || 0);
  const hosts = Number(entry.host_count || 0);
  const refs = Number(entry.reference_count || 0);
  return `${entry.subject_type || 'subject'} · ${facets} facets · ${hosts} hosts · ${refs} refs`;
}

export default function WikiSubjectBrowser(options = {}) {
  let host = null;
  let rootEl = null;
  let catalogEl = null;
  let catalogStatusEl = null;
  let subjectIndexStatusEl = null;
  let subjectIndexSummaryEl = null;
  let subjectSearchEl = null;
  let subjectListEl = null;
  let subjectListStatusEl = null;
  let navigationTrailEl = null;
  let navigationTrailStatusEl = null;
  let workbenchRegionEl = null;
  let workbench = null;
  let workbenchHost = null;
  const state = createWikiSubjectBrowserState();

  function syncSnapshot() {
    const snapshot = wikiSubjectBrowserSnapshot(state);
    if (rootEl) {
      rootEl.dataset.contentOpen = String(snapshot.content_open);
      rootEl.dataset.selectedPath = snapshot.selected_path;
    }
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

  async function postWorkRecordOpenToChild(childId, openMessage) {
    if (!host?.evalCanvas) return false;
    const encoded = btoa(JSON.stringify(openMessage));
    const expectedRecordId = text(openMessage?.record?.id);
    const script = `
(function () {
  if (!window.headsup || typeof window.headsup.receive !== "function") return "";
  if (!window.__workRecordWorkbenchState || !document.querySelector("[data-role='record-id']")) return "";
  window.headsup.receive(${JSON.stringify(encoded)});
  return window.__workRecordWorkbenchState?.record?.id === ${JSON.stringify(expectedRecordId)}
    ? ${JSON.stringify(expectedRecordId)}
    : "";
})()
`;
    for (let attempt = 0; attempt < 12; attempt += 1) {
      try {
        const result = await host.evalCanvas(childId, script, { timeoutMs: 3000 });
        if (result === expectedRecordId) return true;
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
    if (!workbench) applyWikiSubjectOpenRequested(state, request);
    syncSnapshot();
    return request;
  }

  async function openSubjectIndexEntry(entryKey = '') {
    const snapshot = wikiSubjectBrowserSnapshot(state);
    const entry = (snapshot.subject_index_entries || []).find((candidate) => candidate.key === entryKey);
    if (!entry) return null;
    if (entry.source_kind === 'catalog_entry' && entry.catalog_entry_id) {
      return openCatalogEntry(entry.catalog_entry_id);
    }
    return openWikiNavigationEntry(entry);
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

    if (request.opener?.id !== WORK_RECORD_WORKBENCH_SURFACE) {
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

    const childId = WIKI_SUBJECT_BROWSER_WORK_RECORD_CANVAS_ID;
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

    const childPosted = await postWorkRecordOpenToChild(childId, request.open_message);
    const result = {
      type: SUBJECT_OPEN_RESULT_TYPE,
      schema_version: request.schema_version,
      status: childPosted ? 'opened' : 'posted_pending',
      entry_id: request.entry_id,
      entry_handle: request.entry_handle,
      record_id: text(request.open_message?.record?.id) || null,
      subject_type: text(request.subject?.subject_type),
      work_record_canvas_id: childId,
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
        item.dataset.entryId = entry.id;
        applyWikiSubjectBrowserSemanticTarget(item, {
          id: `subject-catalog-entry-${entry.key}`,
          name: entry.label,
          aosRef: catalogEntryRef(entry),
        });

        const title = document.createElement('div');
        title.className = 'wiki-subject-browser-catalog-title';
        title.innerHTML = '<strong></strong><span></span>';
        title.querySelector('strong').textContent = entry.label;
        title.querySelector('span').textContent = entry.subject?.subject_type || 'subject';

        const meta = document.createElement('div');
        meta.className = 'wiki-subject-browser-catalog-meta';
        const contracts = Array.isArray(entry.contracts) ? entry.contracts.length : 0;
        const refs = entry.affordances?.reference_count || 0;
        meta.textContent = `${contracts} contracts · ${refs} refs`;

        const button = document.createElement('button');
        button.type = 'button';
        button.disabled = entry.affordances?.openable !== true;
        button.dataset.subjectOpen = entry.id;
        applyWikiSubjectBrowserSemanticTarget(button, {
          id: `subject-catalog-open-${entry.key}`,
          name: `Open ${entry.label}`,
          role: 'AXButton',
          action: 'open_subject',
          enabled: !button.disabled,
          aosRef: catalogEntryRef(entry, 'open'),
        });
        button.textContent = 'Open';
        button.addEventListener('click', () => {
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
        });

        item.append(title, meta, button);
        catalogEl.appendChild(item);
      }
    }
    catalogStatusEl.textContent = catalogStatusText(snapshot);
  }

  function renderSubjectIndex(snapshot = wikiSubjectBrowserSnapshot(state)) {
    if (!subjectIndexStatusEl || !subjectIndexSummaryEl) return;
    subjectIndexStatusEl.textContent = subjectIndexStatusText(snapshot);
    subjectIndexSummaryEl.textContent = subjectIndexSummaryText(snapshot);
    if (subjectSearchEl && subjectSearchEl.value !== snapshot.subject_search_query) {
      subjectSearchEl.value = snapshot.subject_search_query || '';
    }
    if (subjectListStatusEl) subjectListStatusEl.textContent = subjectListStatusText(snapshot);
    if (subjectListEl) {
      const entries = Array.isArray(snapshot.subject_index_entries) ? snapshot.subject_index_entries : [];
      subjectListEl.replaceChildren();
      if (entries.length === 0) {
        const empty = document.createElement('p');
        empty.className = 'wiki-subject-browser-empty';
        empty.textContent = snapshot.subject_search_query ? 'No indexed Subjects match' : 'No indexed Subjects loaded';
        subjectListEl.appendChild(empty);
      } else {
        for (const entry of entries) {
          const item = document.createElement('article');
          item.className = 'wiki-subject-browser-subject-entry';
          item.dataset.subjectId = entry.subject_id;
          item.dataset.entryHandle = entry.entry_handle;
          applyWikiSubjectBrowserSemanticTarget(item, {
            id: `subject-index-entry-${entry.key}`,
            name: entry.label,
            aosRef: entry.semantic_ref,
          });

          const title = document.createElement('div');
          title.className = 'wiki-subject-browser-subject-title';
          title.innerHTML = '<strong></strong><span></span>';
          title.querySelector('strong').textContent = entry.label;
          title.querySelector('span').textContent = entry.entry_handle;

          const meta = document.createElement('div');
          meta.className = 'wiki-subject-browser-subject-meta';
          meta.textContent = subjectEntryMetaText(entry);

          const button = document.createElement('button');
          button.type = 'button';
          button.disabled = !indexEntryCanOpen(entry);
          button.dataset.subjectIndexOpen = entry.key;
          applyWikiSubjectBrowserSemanticTarget(button, {
            id: `subject-index-open-${entry.key}`,
            name: `Open ${entry.label}`,
            role: 'AXButton',
            action: 'open_subject',
            enabled: !button.disabled,
            aosRef: entry.open_ref,
          });
          button.textContent = 'Open';
          button.addEventListener('click', () => {
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
          });

          item.append(title, meta, button);
          subjectListEl.appendChild(item);
        }
      }
    }
    renderNavigationTrail(snapshot);
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
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'wiki-subject-browser-trail-entry';
      button.dataset.entryHandle = entry.entry_handle;
      applyWikiSubjectBrowserSemanticTarget(button, {
        id: `navigation-trail-open-${entry.key}`,
        name: `Open ${entry.label}`,
        role: 'AXButton',
        action: 'open_subject',
        current: entry.entry_handle === latest ? 'page' : null,
        aosRef: entry.open_ref,
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
        <section class="wiki-subject-browser-workbench-region" data-role="workbench-region"></section>
        <aside class="wiki-subject-browser-catalog" aria-label="Subject catalog">
          <header>
            <strong>Subject Catalog</strong>
            <span data-role="catalog-status"></span>
          </header>
          <div data-role="catalog-list"></div>
          <section class="wiki-subject-browser-index" aria-label="Subject graph index" data-role="subject-index">
            <header>
              <strong>Subject Index</strong>
              <span data-role="subject-index-status"></span>
            </header>
            <div data-role="subject-index-summary"></div>
            <label class="wiki-subject-browser-search">
              <span>Search</span>
              <input data-role="subject-search" type="search" autocomplete="off" spellcheck="false">
            </label>
            <div class="wiki-subject-browser-list-status" data-role="subject-list-status"></div>
            <div class="wiki-subject-browser-subject-list" data-role="subject-list"></div>
          </section>
          <section class="wiki-subject-browser-trail" aria-label="Navigation trail" data-role="navigation-trail-section">
            <header>
              <strong>Trail</strong>
              <span data-role="navigation-trail-status"></span>
            </header>
            <div data-role="navigation-trail"></div>
          </section>
        </aside>
      `;
      workbenchRegionEl = rootEl.querySelector('[data-role="workbench-region"]');
      const catalogAside = rootEl.querySelector('.wiki-subject-browser-catalog');
      const catalogMarkup = catalogAside.innerHTML;
      applyWikiSubjectBrowserSemanticTarget(catalogAside, {
        id: 'subject-catalog',
        name: 'Subject catalog',
        aosRef: wikiSubjectBrowserAosRef('subject-catalog'),
      });
      catalogAside.innerHTML = catalogMarkup;
      catalogEl = catalogAside.querySelector('[data-role="catalog-list"]');
      catalogStatusEl = catalogAside.querySelector('[data-role="catalog-status"]');
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
      subjectListStatusEl = subjectIndexEl.querySelector('[data-role="subject-list-status"]');
      subjectListEl = subjectIndexEl.querySelector('[data-role="subject-list"]');
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
