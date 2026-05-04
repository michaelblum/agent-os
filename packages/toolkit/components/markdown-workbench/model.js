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
} = {}) {
  const current = String(content ?? '');
  return {
    path: normalizePath(path),
    content: current,
    savedContent: String(savedContent ?? current),
    dirty: !!dirty,
    lastResult: null,
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
    path: state.path,
    content: state.content,
    dirty: state.dirty,
    diagnostics: markdownDiagnostics(state.content),
    last_result: state.lastResult,
  };
}
