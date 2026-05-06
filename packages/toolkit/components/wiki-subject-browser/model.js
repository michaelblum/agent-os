import {
  createWikiSubjectOpenRequest,
  wikiPathFromSubject,
  wikiSubjectSelectionCanOpenInMarkdownWorkbench,
  WIKI_SUBJECT_OPEN_REQUEST_TYPE,
  WIKI_SUBJECT_OPEN_SCHEMA_VERSION,
  WIKI_SUBJECT_SELECTION_TYPE,
} from '../../workbench/wiki-subject-opening.js';
import {
  createSubjectCatalogEntries,
  createSubjectOpenRequestFromCatalogEntry,
  SUBJECT_CATALOG_LOAD_TYPE,
  SUBJECT_CATALOG_SCHEMA_VERSION,
  SUBJECT_OPEN_REQUEST_TYPE,
} from '../../workbench/subject-catalog.js';
import {
  deriveSubjectGraphIndex,
  summarizeSubjectGraphIndex,
} from '../../workbench/subject-graph.js';

export const WIKI_SUBJECT_BROWSER_SURFACE = 'wiki-subject-browser-v0';
export const WIKI_SUBJECT_BROWSER_URL = 'aos://toolkit/components/wiki-subject-browser/index.html';
export const WIKI_SUBJECT_BROWSER_SCHEMA_VERSION = '2026-05-06';
export const WIKI_SUBJECT_BROWSER_WORK_RECORD_CANVAS_ID = 'wiki-subject-browser-v0-work-record';
export const SUBJECT_BROWSER_INDEX_ENTRY_TYPE = 'aos.subject_browser.index_entry';
export const SUBJECT_BROWSER_NAVIGATION_ENTRY_TYPE = 'aos.subject_browser.navigation_entry';
export const SUBJECT_BROWSER_NAVIGATION_HISTORY_LIMIT = 8;
export const SUBJECT_BROWSER_NAVIGATION_TRAIL_LIMIT = 5;

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

function textList(values = []) {
  return arrayValue(values).map((value) => text(value)).filter(Boolean);
}

function uniqueTextList(values = []) {
  return [...new Set(textList(values))];
}

function cloneJson(value) {
  if (value === undefined) return undefined;
  return JSON.parse(JSON.stringify(value));
}

function navKey(value = '', fallback = 'subject') {
  const normalized = text(value, fallback)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return normalized || fallback;
}

function ref(...parts) {
  return [WIKI_SUBJECT_BROWSER_SURFACE, ...parts].map((part) => text(part, 'unknown')).join(':');
}

function wikiPathFromHandle(handle = '') {
  const value = text(handle);
  return value.startsWith('wiki:') ? value.slice(5).replace(/^\/+/, '').trim() : '';
}

function wikiPathFromNode(node = {}) {
  const source = objectValue(node.source);
  if (source.kind === 'wiki' && text(source.path)) return text(source.path).replace(/^\/+/, '');
  return wikiPathFromHandle(node.entry_handle) || wikiPathFromHandle(node.subject_id);
}

function sourceRecord(node = {}) {
  return objectValue(node.source_record);
}

function createSubjectIndexEntry(node = {}) {
  const record = sourceRecord(node);
  const subjectId = text(node.subject_id);
  const entryHandle = text(node.entry_handle, subjectId);
  const key = navKey(record.key || entryHandle || subjectId || node.id);
  const sourceKind = text(record.kind, 'descriptor');
  const catalogEntryId = text(record.entry_id);
  const wikiPath = wikiPathFromNode(node);

  return {
    type: SUBJECT_BROWSER_INDEX_ENTRY_TYPE,
    schema_version: WIKI_SUBJECT_BROWSER_SCHEMA_VERSION,
    key,
    subject_node_id: text(node.id),
    subject_id: subjectId,
    subject_type: text(node.subject_type),
    label: text(node.label, subjectId || entryHandle),
    owner: text(node.owner),
    entry_handle: entryHandle,
    source_kind: sourceKind,
    catalog_entry_id: catalogEntryId || null,
    wiki_path: wikiPath || null,
    capabilities: uniqueTextList(node.capabilities),
    contracts: uniqueTextList(node.contracts),
    facet_count: Number(node.facet_count || 0),
    host_count: Number(node.host_count || 0),
    reference_count: Number(node.reference_count || 0),
    health: node.health ? cloneJson(node.health) : null,
    source_record: cloneJson(record),
    semantic_ref: ref('subject-list', 'entry', key),
    open_ref: ref('subject-list', 'open', key),
  };
}

function subjectIndexSearchText(entry = {}) {
  return [
    entry.label,
    entry.subject_id,
    entry.subject_type,
    entry.owner,
    entry.entry_handle,
    entry.source_kind,
    entry.catalog_entry_id,
    entry.wiki_path,
    ...arrayValue(entry.capabilities),
    ...arrayValue(entry.contracts),
  ].map((value) => text(value).toLowerCase()).filter(Boolean).join(' ');
}

function compareIndexEntries(left = {}, right = {}) {
  return text(left.label).localeCompare(text(right.label))
    || text(left.subject_type).localeCompare(text(right.subject_type))
    || text(left.subject_id).localeCompare(text(right.subject_id));
}

export function createSubjectIndexNavigationEntries(subjectGraphIndex = {}, {
  query = '',
} = {}) {
  const normalizedQuery = text(query).toLowerCase();
  const entries = arrayValue(subjectGraphIndex.nodes)
    .filter((node) => text(node.kind) === 'subject')
    .map((node) => createSubjectIndexEntry(node));
  const filtered = normalizedQuery
    ? entries.filter((entry) => subjectIndexSearchText(entry).includes(normalizedQuery))
    : entries;
  return filtered.sort(compareIndexEntries);
}

function sequenceNumber(value = 0) {
  const normalized = Number(value);
  return Number.isFinite(normalized) ? normalized : 0;
}

function navigationEntryFromParts({
  key = '',
  label = '',
  subject_id = '',
  subject_type = '',
  entry_handle = '',
  source_kind = '',
  wiki_path = '',
  catalog_entry_id = '',
  opener_id = '',
  opened_at_sequence = 0,
} = {}) {
  const handle = text(entry_handle, subject_id);
  if (!handle) return null;
  const normalizedKey = navKey(key || handle || subject_id);
  return {
    type: SUBJECT_BROWSER_NAVIGATION_ENTRY_TYPE,
    schema_version: WIKI_SUBJECT_BROWSER_SCHEMA_VERSION,
    key: normalizedKey,
    label: text(label, handle),
    subject_id: text(subject_id, handle),
    subject_type: text(subject_type),
    entry_handle: handle,
    source_kind: text(source_kind, 'subject'),
    wiki_path: text(wiki_path) || null,
    catalog_entry_id: text(catalog_entry_id) || null,
    opener_id: text(opener_id) || null,
    opened_at_sequence: sequenceNumber(opened_at_sequence),
    semantic_ref: ref('navigation-trail', 'entry', normalizedKey),
    open_ref: ref('navigation-trail', 'open', normalizedKey),
  };
}

export function createSubjectNavigationTrailEntryFromWikiOpenRequest(request = {}, {
  openedAtSequence = 0,
} = {}) {
  const subject = objectValue(request.subject);
  const wikiPath = text(request.path) || wikiPathFromSubject(subject);
  const entryHandle = text(request.entry_handle, wikiPath ? `wiki:${wikiPath}` : text(subject.id));
  return navigationEntryFromParts({
    label: text(subject.label, wikiPath || entryHandle),
    subject_id: text(subject.id, entryHandle),
    subject_type: text(subject.subject_type, 'wiki.page'),
    entry_handle: entryHandle,
    source_kind: 'wiki',
    wiki_path: wikiPath,
    opened_at_sequence: openedAtSequence,
  });
}

export function createSubjectNavigationTrailEntryFromSubjectOpenRequest(request = {}, {
  openedAtSequence = 0,
} = {}) {
  const subject = objectValue(request.subject);
  return navigationEntryFromParts({
    label: text(subject.label, request.entry_handle),
    subject_id: text(subject.id, request.entry_handle),
    subject_type: text(subject.subject_type),
    entry_handle: text(request.entry_handle, subject.id),
    source_kind: 'catalog',
    catalog_entry_id: text(request.entry_id),
    opener_id: text(request.opener?.id),
    opened_at_sequence: openedAtSequence,
  });
}

function normalizeNavigationEntry(entry = {}) {
  return navigationEntryFromParts(entry);
}

function normalizeNavigationHistory(entries = []) {
  const deduped = new Map();
  for (const entry of arrayValue(entries)) {
    const normalized = normalizeNavigationEntry(entry);
    if (!normalized) continue;
    deduped.delete(normalized.entry_handle);
    deduped.set(normalized.entry_handle, normalized);
  }
  return [...deduped.values()]
    .sort((left, right) => left.opened_at_sequence - right.opened_at_sequence)
    .slice(-SUBJECT_BROWSER_NAVIGATION_HISTORY_LIMIT);
}

export function rememberSubjectNavigationOpen(state, entry = null) {
  if (!state || typeof state !== 'object') {
    throw new TypeError('wiki subject browser state is required');
  }
  if (!entry) return null;
  const nextSequence = sequenceNumber(state.navigation_sequence) + 1;
  const normalized = normalizeNavigationEntry({
    ...entry,
    opened_at_sequence: nextSequence,
  });
  if (!normalized) return null;

  const existing = normalizeNavigationHistory(state.navigation_history || state.navigation_trail);
  const history = existing.filter((candidate) => candidate.entry_handle !== normalized.entry_handle);
  history.push(normalized);
  state.navigation_sequence = nextSequence;
  state.navigation_history = history.slice(-SUBJECT_BROWSER_NAVIGATION_HISTORY_LIMIT);
  state.navigation_trail = state.navigation_history.slice(-SUBJECT_BROWSER_NAVIGATION_TRAIL_LIMIT);
  return normalized;
}

export function applySubjectNavigationQuery(state, query = '') {
  if (!state || typeof state !== 'object') {
    throw new TypeError('wiki subject browser state is required');
  }
  state.subject_search_query = text(query);
  return state.subject_search_query;
}

export function createWikiSubjectBrowserState({
  selectedSubject = null,
  selected_subject = selectedSubject,
  selectedPath = '',
  selected_path = selectedPath,
  contentOpen = false,
  content_open = contentOpen,
  catalogEntries = [],
  catalog_entries = catalogEntries,
  lastOpenRequest = null,
  last_open_request = lastOpenRequest,
  lastSubjectOpenRequest = null,
  last_subject_open_request = lastSubjectOpenRequest,
  subjectOpenResult = null,
  subject_open_result = subjectOpenResult,
  subjectSearchQuery = '',
  subject_search_query = subjectSearchQuery,
  navigationHistory = [],
  navigation_history = navigationHistory,
  navigationTrail = [],
  navigation_trail = navigationTrail,
  navigationSequence = 0,
  navigation_sequence = navigationSequence,
  lastEvent = null,
  last_event = lastEvent,
} = {}) {
  const normalizedCatalogEntries = createSubjectCatalogEntries(catalog_entries);
  const subjectGraphIndex = deriveSubjectGraphIndex({
    subjects: selected_subject ? [selected_subject] : [],
    entries: normalizedCatalogEntries,
  });
  const normalizedHistory = normalizeNavigationHistory(
    arrayValue(navigation_history).length > 0 ? navigation_history : navigation_trail,
  );
  const maxHistorySequence = normalizedHistory.reduce((max, entry) => (
    Math.max(max, sequenceNumber(entry.opened_at_sequence))
  ), 0);
  const normalizedQuery = text(subject_search_query);
  const subjectIndexEntries = createSubjectIndexNavigationEntries(subjectGraphIndex, {
    query: normalizedQuery,
  });

  return {
    type: 'wiki_subject_browser.snapshot',
    schema_version: WIKI_SUBJECT_BROWSER_SCHEMA_VERSION,
    surface: WIKI_SUBJECT_BROWSER_SURFACE,
    graph_first: true,
    content_open: Boolean(content_open),
    selected_path: text(selected_path),
    selected_subject: selected_subject ? cloneJson(selected_subject) : null,
    catalog_entries: normalizedCatalogEntries,
    subject_graph_index: subjectGraphIndex,
    subject_graph_summary: summarizeSubjectGraphIndex(subjectGraphIndex),
    subject_search_query: normalizedQuery,
    subject_index_entries: subjectIndexEntries,
    subject_index_result_count: subjectIndexEntries.length,
    navigation_sequence: Math.max(sequenceNumber(navigation_sequence), maxHistorySequence),
    navigation_history: normalizedHistory,
    navigation_trail: normalizedHistory.slice(-SUBJECT_BROWSER_NAVIGATION_TRAIL_LIMIT),
    last_open_request: last_open_request ? cloneJson(last_open_request) : null,
    last_subject_open_request: last_subject_open_request ? cloneJson(last_subject_open_request) : null,
    subject_open_result: subject_open_result ? cloneJson(subject_open_result) : null,
    last_event: last_event ? cloneJson(last_event) : null,
  };
}

export function applyWikiSubjectSelection(state, selection = null) {
  if (!state || typeof state !== 'object') {
    throw new TypeError('wiki subject browser state is required');
  }
  state.last_event = {
    type: WIKI_SUBJECT_SELECTION_TYPE,
    schema_version: WIKI_SUBJECT_OPEN_SCHEMA_VERSION,
    payload: selection ? cloneJson(selection) : null,
  };
  if (!selection) {
    state.selected_path = '';
    state.selected_subject = null;
    state.content_open = false;
    return null;
  }

  state.selected_path = text(selection.path);
  state.selected_subject = selection.subject ? cloneJson(selection.subject) : null;
  return state.last_event;
}

export function applyWikiSubjectOpenRequested(state, request = null) {
  if (!state || typeof state !== 'object') {
    throw new TypeError('wiki subject browser state is required');
  }
  if (!request) return null;
  state.last_open_request = cloneJson(request);
  state.last_event = {
    type: WIKI_SUBJECT_OPEN_REQUEST_TYPE,
    schema_version: WIKI_SUBJECT_OPEN_SCHEMA_VERSION,
    payload: cloneJson(request),
  };
  state.selected_path = text(request.path, state.selected_path);
  state.selected_subject = request.subject ? cloneJson(request.subject) : state.selected_subject;
  state.content_open = true;
  rememberSubjectNavigationOpen(
    state,
    createSubjectNavigationTrailEntryFromWikiOpenRequest(request),
  );
  return state.last_event;
}

export function createWikiSubjectBrowserOpenRequestFromSelection(selection = {}) {
  if (!wikiSubjectSelectionCanOpenInMarkdownWorkbench(selection)) return null;
  return createWikiSubjectOpenRequest(selection);
}

export function applySubjectCatalogLoad(state, message = {}) {
  if (!state || typeof state !== 'object') {
    throw new TypeError('wiki subject browser state is required');
  }
  const payload = message?.payload && typeof message.payload === 'object' ? message.payload : message;
  const entries = Array.isArray(payload.entries) ? payload.entries : [];
  state.catalog_entries = createSubjectCatalogEntries(entries);
  state.last_event = {
    type: SUBJECT_CATALOG_LOAD_TYPE,
    schema_version: SUBJECT_CATALOG_SCHEMA_VERSION,
    entry_count: state.catalog_entries.length,
  };
  return state.last_event;
}

export function createWikiSubjectBrowserOpenRequestFromCatalogEntry(entry = {}) {
  return createSubjectOpenRequestFromCatalogEntry(entry);
}

export function applySubjectOpenRequested(state, request = null) {
  if (!state || typeof state !== 'object') {
    throw new TypeError('wiki subject browser state is required');
  }
  if (!request) return null;
  state.last_subject_open_request = cloneJson(request);
  state.last_event = {
    type: SUBJECT_OPEN_REQUEST_TYPE,
    schema_version: SUBJECT_CATALOG_SCHEMA_VERSION,
    payload: cloneJson(request),
  };
  rememberSubjectNavigationOpen(
    state,
    createSubjectNavigationTrailEntryFromSubjectOpenRequest(request),
  );
  return state.last_event;
}

export function applySubjectOpenResult(state, result = null) {
  if (!state || typeof state !== 'object') {
    throw new TypeError('wiki subject browser state is required');
  }
  if (!result) return null;
  state.subject_open_result = cloneJson(result);
  state.last_event = cloneJson(result);
  return state.subject_open_result;
}

export function wikiSubjectBrowserSnapshot(state = {}) {
  return createWikiSubjectBrowserState(state);
}
