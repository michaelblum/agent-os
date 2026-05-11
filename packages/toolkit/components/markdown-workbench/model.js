import { createWorkbenchSubject } from '../../workbench/subject.js';
import { createWikiPageSubject } from '../../workbench/wiki-subject.js';

export const MARKDOWN_WORKBENCH_SCHEMA_VERSION = '2026-05-03';
const MARKDOWN_WORKBENCH_URL = 'aos://toolkit/components/markdown-workbench/index.html';
const ANNOTATION_KINDS = new Set([
  'point_comment',
  'region_comment',
  'element_selection',
  'selection_comment',
]);
const VISIBLE_ANNOTATION_STATUSES = new Set(['committed', 'open', 'resolved', 'rejected']);

function text(value, fallback = '') {
  const normalized = String(value ?? '').trim();
  return normalized || fallback;
}

function normalizePath(value) {
  return text(value, 'untitled.md');
}

export function createMarkdownWorkbenchState({
  path = 'untitled.md',
  content = '',
  savedContent = content,
  dirty = false,
  source = null,
  annotations = [],
} = {}) {
  const current = String(content ?? '');
  return {
    path: normalizePath(path),
    source: normalizeSource(source, normalizePath(path)),
    content: current,
    savedContent: String(savedContent ?? current),
    dirty: !!dirty,
    annotations: normalizeMarkdownWorkbenchAnnotations(annotations, { path: normalizePath(path) }),
    lastResult: null,
  };
}

function normalizeSource(source = null, path = 'untitled.md') {
  if (source && typeof source === 'object' && source.kind === 'wiki') {
    return {
      kind: 'wiki',
      path: normalizePath(source.path || path),
      page: source.page && typeof source.page === 'object' ? source.page : null,
    };
  }
  return {
    kind: 'file',
    path: normalizePath(path),
  };
}

function uniqueTextList(values = []) {
  return [...new Set((Array.isArray(values) ? values : []).map((value) => text(value)).filter(Boolean))];
}

function uniqueObjects(values = [], keyFn = (value) => JSON.stringify(value)) {
  const seen = new Set();
  const out = [];
  for (const value of Array.isArray(values) ? values : []) {
    const key = keyFn(value);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(value);
  }
  return out;
}

function integer(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.floor(number)) : fallback;
}

function numberOrNull(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function normalizePoint(point = null) {
  if (!point || typeof point !== 'object') return null;
  const x = numberOrNull(point.x);
  const y = numberOrNull(point.y);
  return x === null || y === null ? null : { x, y };
}

function normalizeBounds(bounds = null) {
  if (!bounds || typeof bounds !== 'object') return null;
  const x = numberOrNull(bounds.x);
  const y = numberOrNull(bounds.y);
  const width = numberOrNull(bounds.width);
  const height = numberOrNull(bounds.height);
  return [x, y, width, height].some((value) => value === null)
    ? null
    : { x, y, width, height };
}

function cloneJson(value) {
  if (value === undefined) return undefined;
  return JSON.parse(JSON.stringify(value));
}

function normalizeActor(actor = {}) {
  return {
    role: text(actor?.role || actor?.type || actor?.author_role, 'agent'),
    id: text(actor?.id || actor?.author_id, 'unknown'),
  };
}

function normalizeTextRange(range = null) {
  if (!range || typeof range !== 'object') return null;
  const startLine = integer(range.start_line ?? range.startLine ?? range.line, 0);
  const endLine = integer(range.end_line ?? range.endLine ?? range.line ?? startLine, startLine);
  const normalized = { ...cloneJson(range) };
  if (startLine > 0) normalized.start_line = startLine;
  if (endLine > 0) normalized.end_line = Math.max(startLine || endLine, endLine);
  return normalized;
}

function isStructuredAnnotationIntent(annotation = {}) {
  if (!annotation || typeof annotation !== 'object') return false;
  if (!ANNOTATION_KINDS.has(annotation.kind)) return false;
  if (integer(annotation.ordinal, 0) < 1) return false;
  if (!text(annotation.id)) return false;
  return Boolean(text(annotation.note || annotation.label));
}

export function normalizeMarkdownWorkbenchAnnotations(annotations = [], { path = '' } = {}) {
  return (Array.isArray(annotations) ? annotations : [])
    .filter(isStructuredAnnotationIntent)
    .map((annotation) => ({
      id: text(annotation.id),
      ordinal: integer(annotation.ordinal, 1),
      kind: annotation.kind,
      surface_id: text(annotation.surface_id, 'markdown-workbench'),
      source_url: text(annotation.source_url) || null,
      source_path: text(annotation.source_path || annotation.path, path) || null,
      coordinate_space: text(annotation.coordinate_space, 'unknown'),
      point: normalizePoint(annotation.point),
      bounds: normalizeBounds(annotation.bounds),
      viewport_bounds: normalizeBounds(annotation.viewport_bounds),
      page_bounds: normalizeBounds(annotation.page_bounds),
      selector_candidates: uniqueTextList(annotation.selector_candidates),
      text_excerpt: text(annotation.text_excerpt || annotation.excerpt),
      text_range: normalizeTextRange(annotation.text_range),
      role: text(annotation.role),
      label: text(annotation.label),
      ancestor_chain: uniqueTextList(annotation.ancestor_chain),
      note: text(annotation.note || annotation.label),
      actor: normalizeActor(annotation.actor),
      status: text(annotation.status, 'committed'),
      lifecycle: annotation.lifecycle && typeof annotation.lifecycle === 'object' ? cloneJson(annotation.lifecycle) : {},
      capture: annotation.capture && typeof annotation.capture === 'object' ? cloneJson(annotation.capture) : {},
      created_at: text(annotation.created_at),
      updated_at: text(annotation.updated_at),
      metadata: annotation.metadata && typeof annotation.metadata === 'object' ? cloneJson(annotation.metadata) : {},
    }))
    .filter((annotation) => VISIBLE_ANNOTATION_STATUSES.has(annotation.status))
    .sort((a, b) => a.ordinal - b.ordinal || a.id.localeCompare(b.id));
}

export function annotationAnchorSummary(annotation = {}) {
  const source = text(annotation.source_path || annotation.source_url, 'unknown source');
  const range = annotation.text_range && typeof annotation.text_range === 'object'
    ? annotation.text_range
    : null;
  const startLine = integer(range?.start_line ?? range?.line, 0);
  const endLine = integer(range?.end_line ?? range?.line ?? startLine, startLine);
  if (startLine > 0 && endLine > 0) {
    const lineText = startLine === endLine ? `line ${startLine}` : `lines ${startLine}-${endLine}`;
    return annotation.text_excerpt
      ? `${source} ${lineText}: "${annotation.text_excerpt}"`
      : `${source} ${lineText}`;
  }
  if (annotation.selector_candidates?.length) {
    return `${source} element ${annotation.selector_candidates[0]}`;
  }
  const bounds = annotation.bounds || annotation.viewport_bounds || annotation.page_bounds;
  if (bounds) {
    return `${source} ${annotation.coordinate_space} region ${bounds.x},${bounds.y} ${bounds.width}x${bounds.height}`;
  }
  if (annotation.point) {
    return `${source} ${annotation.coordinate_space} point ${annotation.point.x},${annotation.point.y}`;
  }
  return source;
}

export function annotationCanRenderOverlay(annotation = {}) {
  if (!['viewport', 'page', 'document'].includes(annotation.coordinate_space)) return false;
  return Boolean(annotation.point || annotation.bounds || annotation.viewport_bounds || annotation.page_bounds);
}

export function markdownWorkbenchAnnotationViewModels(annotations = []) {
  return normalizeMarkdownWorkbenchAnnotations(annotations).map((annotation) => ({
    annotation,
    ordinal: annotation.ordinal,
    active: annotation.status === 'committed' || annotation.status === 'open',
    secondary: annotation.status === 'resolved' || annotation.status === 'rejected',
    anchor_summary: annotationAnchorSummary(annotation),
    overlay: annotationCanRenderOverlay(annotation),
  }));
}

export function applyMarkdownAnnotations(state, message = {}) {
  const payload = message.payload || message;
  const annotations = Array.isArray(payload)
    ? payload
    : Array.isArray(payload.annotations)
      ? payload.annotations
      : Array.isArray(payload.resume?.annotations)
        ? payload.resume.annotations
        : [];
  state.annotations = normalizeMarkdownWorkbenchAnnotations(annotations, { path: state.path });
  state.lastResult = {
    type: 'markdown_workbench.annotations.replace.result',
    schema_version: MARKDOWN_WORKBENCH_SCHEMA_VERSION,
    status: 'applied',
    path: state.path,
    annotation_count: state.annotations.length,
  };
  return state.lastResult;
}

export function clearMarkdownAnnotations(state) {
  state.annotations = [];
  state.lastResult = {
    type: 'markdown_workbench.annotations.clear.result',
    schema_version: MARKDOWN_WORKBENCH_SCHEMA_VERSION,
    status: 'cleared',
    path: state.path,
    annotation_count: 0,
  };
  return state.lastResult;
}

function markdownWorkbenchHost(facet = '', preferred = false) {
  return {
    kind: 'canvas',
    target_dialect: 'canvas',
    entry: {
      kind: 'aos-url',
      value: MARKDOWN_WORKBENCH_URL,
      ...(facet ? { facet } : {}),
    },
    ...(preferred ? { preferred: true } : {}),
  };
}

function markdownWorkbenchFacets() {
  return [
    {
      key: 'markdown-source',
      layer: 'narrative',
      label: 'Markdown Source',
      capabilities: ['inspectable', 'editable'],
      contracts: ['markdown_document.text.patch', 'markdown_document.save.requested'],
      hosts: [markdownWorkbenchHost('source', true)],
    },
    {
      key: 'markdown-preview',
      layer: 'narrative',
      label: 'Rendered Markdown Preview',
      capabilities: ['inspectable'],
      contracts: ['markdown.render', 'markdown.mermaid.preview'],
      hosts: [markdownWorkbenchHost('preview')],
    },
    {
      key: 'markdown-diagnostics',
      layer: 'descriptor',
      label: 'Markdown Diagnostics',
      capabilities: ['inspectable'],
      contracts: ['markdown.diagnostics', 'markdown.outline'],
      hosts: [markdownWorkbenchHost('diagnostics')],
    },
  ];
}

function mergeFacets(existing = [], next = []) {
  const byKey = new Map();
  for (const facet of [...(Array.isArray(existing) ? existing : []), ...next]) {
    if (!facet?.key) continue;
    const current = byKey.get(facet.key);
    if (!current) {
      byKey.set(facet.key, { ...facet });
      continue;
    }
    byKey.set(facet.key, {
      ...current,
      ...facet,
      capabilities: uniqueTextList([
        ...(Array.isArray(current.capabilities) ? current.capabilities : []),
        ...(Array.isArray(facet.capabilities) ? facet.capabilities : []),
      ]),
      contracts: uniqueTextList([
        ...(Array.isArray(current.contracts) ? current.contracts : []),
        ...(Array.isArray(facet.contracts) ? facet.contracts : []),
      ]),
      hosts: uniqueObjects([
        ...(Array.isArray(current.hosts) ? current.hosts : []),
        ...(Array.isArray(facet.hosts) ? facet.hosts : []),
      ]),
    });
  }
  return [...byKey.values()];
}

export function markdownDiagnostics(content = '') {
  const source = String(content ?? '');
  const lines = source.split('\n');
  const words = source.trim() ? source.trim().split(/\s+/).length : 0;
  const headings = [];
  const mermaidBlocks = [];
  let inFence = false;
  let fenceLang = '';
  let fenceStart = 0;

  lines.forEach((line, index) => {
    const fence = line.match(/^```\s*([a-zA-Z0-9_-]+)?\s*$/);
    if (fence) {
      if (!inFence) {
        inFence = true;
        fenceLang = (fence[1] || '').toLowerCase();
        fenceStart = index + 1;
      } else {
        if (fenceLang === 'mermaid') {
          mermaidBlocks.push({ start_line: fenceStart, end_line: index + 1, preview: 'diagram_container' });
        }
        inFence = false;
        fenceLang = '';
      }
      return;
    }

    if (inFence) return;
    const heading = line.match(/^(#{1,6})\s+(.+)$/);
    if (heading) {
      headings.push({
        depth: heading[1].length,
        text: heading[2].trim(),
        line: index + 1,
      });
    }
  });

  return {
    line_count: source ? lines.length : 0,
    word_count: words,
    heading_count: headings.length,
    headings,
    mermaid_blocks: mermaidBlocks,
    mermaid_preview: mermaidBlocks.length > 0 ? 'diagram_container' : 'none',
    unclosed_fence: inFence,
  };
}

export function openMarkdownDocument(state, message = {}) {
  const payload = message.payload || message;
  const content = String(payload.content ?? payload.markdown ?? '');
  state.path = normalizePath(payload.path);
  state.source = normalizeSource(payload.source, state.path);
  state.content = content;
  state.savedContent = content;
  state.dirty = false;
  state.annotations = Array.isArray(payload.annotations)
    ? normalizeMarkdownWorkbenchAnnotations(payload.annotations, { path: state.path })
    : [];
  state.lastResult = {
    type: 'markdown_document.open.result',
    schema_version: MARKDOWN_WORKBENCH_SCHEMA_VERSION,
    status: 'opened',
    path: state.path,
    diagnostics: markdownDiagnostics(content),
  };
  return state.lastResult;
}

export function applyMarkdownTextPatch(state, message = {}) {
  const payload = message.payload || message;
  const patch = payload.patch || payload;
  if (typeof patch.content !== 'string') {
    state.lastResult = {
      type: 'markdown_document.patch.result',
      schema_version: MARKDOWN_WORKBENCH_SCHEMA_VERSION,
      status: 'rejected',
      reason: 'missing_content',
      path: state.path,
    };
    return state.lastResult;
  }

  state.content = patch.content;
  state.dirty = state.content !== state.savedContent;
  state.lastResult = {
    type: 'markdown_document.patch.result',
    schema_version: MARKDOWN_WORKBENCH_SCHEMA_VERSION,
    status: 'applied',
    path: state.path,
    dirty: state.dirty,
    diagnostics: markdownDiagnostics(state.content),
  };
  return state.lastResult;
}

export function buildMarkdownSaveRequest(state, {
  requestId = `markdown-save-${Date.now().toString(36)}`,
} = {}) {
  return {
    type: 'markdown_document.save.requested',
    schema_version: MARKDOWN_WORKBENCH_SCHEMA_VERSION,
    request_id: requestId,
    subject: buildMarkdownWorkbenchSubject(state),
    source: state.source,
    path: state.path,
    content: state.content,
    diagnostics: markdownDiagnostics(state.content),
  };
}

export function applyMarkdownSaveResult(state, message = {}) {
  const payload = message.payload || message;
  const status = payload.status === 'saved' ? 'saved' : 'rejected';
  if (status === 'saved') {
    state.savedContent = state.content;
    state.dirty = false;
  }
  state.lastResult = {
    type: 'markdown_document.save.result',
    schema_version: MARKDOWN_WORKBENCH_SCHEMA_VERSION,
    status,
    path: state.path,
    message: text(payload.message),
  };
  return state.lastResult;
}

export function markdownWorkbenchSnapshot(state) {
  return {
    type: 'markdown_document.snapshot',
    schema_version: MARKDOWN_WORKBENCH_SCHEMA_VERSION,
    subject: buildMarkdownWorkbenchSubject(state),
    source: state.source,
    path: state.path,
    content: state.content,
    dirty: state.dirty,
    annotations: normalizeMarkdownWorkbenchAnnotations(state.annotations, { path: state.path }),
    diagnostics: markdownDiagnostics(state.content),
    last_result: state.lastResult,
  };
}

export function buildMarkdownWorkbenchSubject(state = {}) {
  const diagnostics = markdownDiagnostics(state.content);
  const contracts = [
    'markdown.render',
    'markdown.diagnostics',
    'markdown.outline',
    'markdown.mermaid.detect',
    'markdown.mermaid.preview',
    'markdown_document.text.patch',
    'markdown_document.save.requested',
  ];
  if (state.source?.kind === 'wiki') {
    const subject = createWikiPageSubject({
      ...(state.source.page || {}),
      path: state.source.path || state.path,
    });
    subject.contracts = [...new Set([
      ...(Array.isArray(subject.contracts) ? subject.contracts : []),
      ...contracts,
    ])];
    subject.facets = mergeFacets(subject.facets, markdownWorkbenchFacets());
    subject.state = {
      ...subject.state,
      dirty: !!state.dirty,
      line_count: diagnostics.line_count,
      word_count: diagnostics.word_count,
      heading_count: diagnostics.heading_count,
      mermaid_block_count: diagnostics.mermaid_blocks.length,
      unclosed_fence: diagnostics.unclosed_fence,
    };
    return subject;
  }
  return createWorkbenchSubject({
    id: `file:${normalizePath(state.path)}`,
    type: 'markdown.document',
    label: normalizePath(state.path).split('/').pop(),
    owner: 'markdown-workbench',
    source: {
      kind: 'file',
      path: normalizePath(state.path),
    },
    capabilities: [
      'inspectable',
      'editable',
    ],
    contracts,
    facets: markdownWorkbenchFacets(),
    persistence: {
      kind: 'agent_handoff',
      request: 'markdown_document.save.requested',
      result: 'markdown_document.save.result',
    },
    state: {
      dirty: !!state.dirty,
      line_count: diagnostics.line_count,
      word_count: diagnostics.word_count,
      heading_count: diagnostics.heading_count,
      mermaid_block_count: diagnostics.mermaid_blocks.length,
      unclosed_fence: diagnostics.unclosed_fence,
    },
  });
}
