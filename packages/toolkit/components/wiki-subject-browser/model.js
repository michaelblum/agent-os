import {
  createWikiSubjectOpenRequest,
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

export const WIKI_SUBJECT_BROWSER_SURFACE = 'wiki-subject-browser-v0';
export const WIKI_SUBJECT_BROWSER_URL = 'aos://toolkit/components/wiki-subject-browser/index.html';
export const WIKI_SUBJECT_BROWSER_SCHEMA_VERSION = '2026-05-06';
export const WIKI_SUBJECT_BROWSER_WORK_RECORD_CANVAS_ID = 'wiki-subject-browser-v0-work-record';

function text(value, fallback = '') {
  const normalized = String(value ?? '').replace(/\s+/g, ' ').trim();
  return normalized || fallback;
}

function cloneJson(value) {
  if (value === undefined) return undefined;
  return JSON.parse(JSON.stringify(value));
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
  lastEvent = null,
  last_event = lastEvent,
} = {}) {
  return {
    type: 'wiki_subject_browser.snapshot',
    schema_version: WIKI_SUBJECT_BROWSER_SCHEMA_VERSION,
    surface: WIKI_SUBJECT_BROWSER_SURFACE,
    graph_first: true,
    content_open: Boolean(content_open),
    selected_path: text(selected_path),
    selected_subject: selected_subject ? cloneJson(selected_subject) : null,
    catalog_entries: createSubjectCatalogEntries(catalog_entries),
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
