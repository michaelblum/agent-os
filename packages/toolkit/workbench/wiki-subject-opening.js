import { createWikiPageSubject } from './wiki-subject.js';
import {
  formatSubjectEntryHandle,
  parseSubjectEntryHandle,
} from './subject-entry-handle.js';
import {
  subjectReferences,
} from './subject.js';
import {
  deriveWorkbenchSubjectControls,
  findWorkbenchSubjectControl,
} from './subject-controls.js';

export const WIKI_SUBJECT_SELECTION_TYPE = 'wiki.subject.selection';
export const WIKI_SUBJECT_OPEN_REQUEST_TYPE = 'wiki_subject.open.requested';
export const WIKI_SUBJECT_OPEN_SCHEMA_VERSION = '2026-05-06';
const MARKDOWN_WORKBENCH_URL = 'aos://toolkit/components/markdown-workbench/index.html';

function text(value, fallback = '') {
  const normalized = String(value ?? '').replace(/\s+/g, ' ').trim();
  return normalized || fallback;
}

function pathText(value) {
  return String(value ?? '').replace(/^\/+/, '').trim();
}

function normalizeTags(value = []) {
  if (Array.isArray(value)) return value.map((tag) => text(tag)).filter(Boolean);
  const raw = String(value ?? '').trim();
  if (!raw) return [];
  if (raw.startsWith('[') && raw.endsWith(']')) {
    return raw.slice(1, -1).split(',').map((tag) => text(tag)).filter(Boolean);
  }
  return raw.split(/\s*,\s*/).map((tag) => text(tag)).filter(Boolean);
}

function pathFromHandle(handle = '') {
  const parsed = parseSubjectEntryHandle(handle);
  return parsed?.facet_key === 'wiki' ? pathText(parsed.subject_id) : '';
}

function wikiHandleForPath(path = '') {
  return formatSubjectEntryHandle({
    facet_key: 'wiki',
    subject_id: pathText(path),
  });
}

function graphNodePage(node = {}) {
  const path = pathText(node.path || node.id);
  const nodeType = text(node.type);
  return {
    path,
    plugin: text(node.plugin) || null,
    frontmatter: {
      ...(nodeType ? { type: nodeType } : {}),
      ...(text(node.name) ? { name: text(node.name) } : {}),
      ...(normalizeTags(node.tags).length > 0 ? { tags: normalizeTags(node.tags) } : {}),
      ...(text(node.description) ? { description: text(node.description) } : {}),
      ...(text(node.plugin) ? { plugin: text(node.plugin) } : {}),
    },
  };
}

function controlFacets(control = null) {
  return Array.isArray(control?.facets) ? control.facets : [];
}

function controlFacetHosts(facet = {}) {
  return Array.isArray(facet.hosts) ? facet.hosts : [];
}

function controlFacetContracts(facet = {}) {
  return Array.isArray(facet.contracts) ? facet.contracts : [];
}

function controlFacetHasMarkdownWorkbenchHost(facet = {}) {
  return controlFacetHosts(facet).some((host) => {
    const entry = host?.entry && typeof host.entry === 'object' ? host.entry : {};
    return entry.value === MARKDOWN_WORKBENCH_URL;
  });
}

function controlFacetCanOpenMarkdownWorkbench(facet = {}) {
  const contracts = controlFacetContracts(facet);
  return facet.layer === 'narrative'
    && (contracts.includes('markdown_document.text.patch')
      || contracts.includes('markdown_document.save.requested'))
    && controlFacetHasMarkdownWorkbenchHost(facet);
}

export function wikiPathFromSubject(subject = {}) {
  const sourcePath = subject?.source?.kind === 'wiki' ? pathText(subject.source.path) : '';
  if (sourcePath) return sourcePath;

  const subjectPath = pathFromHandle(subject?.id);
  if (subjectPath) return subjectPath;

  for (const reference of subjectReferences(subject)) {
    const referencePath = pathFromHandle(reference.handle || reference.subject_id);
    if (referencePath) return referencePath;
  }
  return '';
}

export function createWikiSubjectSelectionPayload(nodeOrPage = {}, { subject = null } = {}) {
  const page = graphNodePage(nodeOrPage);
  if (!page.path) return null;
  const descriptor = subject || createWikiPageSubject(page);
  const path = wikiPathFromSubject(descriptor) || page.path;
  const entryHandle = pathFromHandle(nodeOrPage.entry_handle) ? nodeOrPage.entry_handle : wikiHandleForPath(path);

  return {
    type: WIKI_SUBJECT_SELECTION_TYPE,
    schema_version: WIKI_SUBJECT_OPEN_SCHEMA_VERSION,
    id: text(nodeOrPage.id, path),
    path,
    entry_handle: entryHandle,
    name: text(nodeOrPage.name, descriptor.label || path),
    subject: descriptor,
  };
}

export function wikiSubjectSelectionCanOpenInMarkdownWorkbench(selection = {}) {
  const subject = selection.subject && typeof selection.subject === 'object' ? selection.subject : null;
  const path = pathText(selection.path) || (subject ? wikiPathFromSubject(subject) : '');
  if (!path || !subject) return false;

  const controls = deriveWorkbenchSubjectControls(subject);
  const openControl = findWorkbenchSubjectControl(controls, 'open');
  const editControl = findWorkbenchSubjectControl(controls, 'edit');
  const facets = [
    ...controlFacets(openControl),
    ...controlFacets(editControl),
  ];
  const hasWikiRead = facets.some((facet) => controlFacetContracts(facet).includes('wiki.read'));
  const hasMarkdownOpenFacet = facets.some(controlFacetCanOpenMarkdownWorkbench);

  return hasWikiRead && hasMarkdownOpenFacet;
}

export function createWikiSubjectOpenRequest(selection = {}) {
  const subject = selection.subject && typeof selection.subject === 'object' ? selection.subject : null;
  const path = pathText(selection.path) || (subject ? wikiPathFromSubject(subject) : '');
  if (!path) return null;
  const entryHandle = text(selection.entry_handle) || wikiHandleForPath(path);
  return {
    type: WIKI_SUBJECT_OPEN_REQUEST_TYPE,
    schema_version: WIKI_SUBJECT_OPEN_SCHEMA_VERSION,
    path,
    entry_handle: entryHandle,
    subject,
    source: {
      kind: 'wiki',
      path,
      page: {
        path,
      },
    },
  };
}

export function createMarkdownOpenRequestFromWikiSelection(selection = {}) {
  if (!wikiSubjectSelectionCanOpenInMarkdownWorkbench(selection)) return null;
  const request = createWikiSubjectOpenRequest(selection);
  if (!request) return null;
  return {
    ...request,
    markdown_document: {
      type: 'markdown_document.open',
      path: request.path,
      source: request.source,
    },
  };
}

export function createMarkdownOpenDocumentFromWikiPage({
  path = '',
  content = '',
  page = null,
  frontmatter = null,
  source = null,
} = {}) {
  const wikiPath = pathText(path);
  if (!wikiPath) return null;
  const pageShape = page && typeof page === 'object'
    ? { ...page, path: pathText(page.path) || wikiPath }
    : {
      path: wikiPath,
      frontmatter: frontmatter && typeof frontmatter === 'object' ? { ...frontmatter } : {},
    };
  const sourceShape = source && typeof source === 'object'
    ? { ...source, kind: source.kind || 'wiki', path: pathText(source.path) || wikiPath, page: pageShape }
    : {
      kind: 'wiki',
      path: wikiPath,
      page: pageShape,
    };
  return {
    type: 'markdown_document.open',
    path: wikiPath,
    source: sourceShape,
    content: String(content ?? ''),
  };
}
