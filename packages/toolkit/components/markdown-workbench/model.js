import { createWorkbenchSubject } from '../../workbench/subject.js';
import { createWikiPageSubject } from '../../workbench/wiki-subject.js';

export const MARKDOWN_WORKBENCH_SCHEMA_VERSION = '2026-05-03';

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
} = {}) {
  const current = String(content ?? '');
  return {
    path: normalizePath(path),
    source: normalizeSource(source, normalizePath(path)),
    content: current,
    savedContent: String(savedContent ?? current),
    dirty: !!dirty,
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
          mermaidBlocks.push({ start_line: fenceStart, end_line: index + 1 });
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
    diagnostics: markdownDiagnostics(state.content),
    last_result: state.lastResult,
  };
}

export function buildMarkdownWorkbenchSubject(state = {}) {
  const diagnostics = markdownDiagnostics(state.content);
  if (state.source?.kind === 'wiki') {
    const subject = createWikiPageSubject({
      ...(state.source.page || {}),
      path: state.source.path || state.path,
    });
    subject.capabilities = [...new Set([
      ...subject.capabilities,
      'markdown.render',
      'markdown.diagnostics',
      'markdown.outline',
      'markdown_document.text.patch',
      'markdown_document.save.requested',
    ])];
    subject.views = [...new Set([...subject.views, 'source', 'markdown.preview', 'outline', 'diagnostics'])];
    subject.controls = [...new Set([...subject.controls, 'text.editor', 'save', 'revert'])];
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
      'markdown.render',
      'markdown.diagnostics',
      'markdown.outline',
      'markdown.mermaid.detect',
      'markdown_document.text.patch',
      'markdown_document.save.requested',
    ],
    views: ['source', 'markdown.preview', 'outline', 'diagnostics'],
    controls: ['text.editor', 'save', 'revert'],
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
