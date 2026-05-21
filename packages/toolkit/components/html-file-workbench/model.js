export const HTML_FILE_WORKBENCH_SCHEMA_VERSION = '2026-05-21';
export const HTML_FILE_WORKBENCH_SURFACE = 'html-file-workbench';
export const HTML_FILE_OPEN_TYPE = 'html_file.open';
export const HTML_FILE_SAVE_RESULT_TYPE = 'html_file.save.result';
export const HTML_FILE_TEXT_PATCH_TYPE = 'html_file.text.patch';

function text(value, fallback = '') {
  const normalized = String(value ?? '').trim();
  return normalized || fallback;
}

function cloneJson(value) {
  if (value === undefined) return undefined;
  return JSON.parse(JSON.stringify(value));
}

function payloadFromMessage(message = {}) {
  return message.payload && typeof message.payload === 'object' ? message.payload : message;
}

function requestId(prefix = 'html-file-save') {
  const random = Math.random().toString(36).slice(2, 10);
  return `${prefix}-${Date.now().toString(36)}-${random}`;
}

export async function sha256Hex(value) {
  const input = String(value ?? '');
  const subtle = globalThis.crypto?.subtle;
  if (!subtle || typeof TextEncoder === 'undefined') {
    let hash = 0;
    for (let index = 0; index < input.length; index += 1) {
      hash = ((hash << 5) - hash + input.charCodeAt(index)) | 0;
    }
    return `fallback:${(hash >>> 0).toString(16).padStart(8, '0')}`;
  }
  const bytes = new TextEncoder().encode(input);
  const digest = await subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

export function createHtmlFileWorkbenchState({
  path = 'untitled.html',
  content = '',
  savedContent = content,
  dirty = false,
  previewContent = content,
  previewMode = 'srcdoc',
} = {}) {
  const current = String(content ?? '');
  return {
    path: text(path, 'untitled.html'),
    content: current,
    savedContent: String(savedContent ?? current),
    dirty: !!dirty,
    previewContent: String(previewContent ?? current),
    previewMode: previewMode === 'blocked' ? 'blocked' : 'srcdoc',
    previewRevision: 0,
    contentHash: '',
    lastResult: null,
  };
}

export function openHtmlFile(state, message = {}) {
  const payload = payloadFromMessage(message);
  const path = text(payload.path, 'untitled.html');
  const content = String(payload.content ?? '');
  state.path = path;
  state.content = content;
  state.savedContent = String(payload.savedContent ?? content);
  state.dirty = state.content !== state.savedContent;
  state.previewContent = content;
  state.previewMode = 'srcdoc';
  state.previewRevision += 1;
  state.lastResult = {
    type: 'html_file.open.result',
    schema_version: HTML_FILE_WORKBENCH_SCHEMA_VERSION,
    status: 'opened',
    path,
    bytes: new TextEncoder().encode(content).byteLength,
  };
  return state.lastResult;
}

export function setHtmlFileContent(state, content) {
  state.content = String(content ?? '');
  state.dirty = state.content !== state.savedContent;
  return state;
}

export function reloadHtmlFilePreview(state) {
  state.previewContent = state.content;
  state.previewMode = 'srcdoc';
  state.previewRevision += 1;
  state.lastResult = {
    type: 'html_file.preview.reload.result',
    schema_version: HTML_FILE_WORKBENCH_SCHEMA_VERSION,
    status: 'reloaded',
    path: state.path,
    preview_revision: state.previewRevision,
  };
  return state.lastResult;
}

export function revertHtmlFile(state) {
  state.content = state.savedContent;
  state.dirty = false;
  state.previewContent = state.savedContent;
  state.previewMode = 'srcdoc';
  state.previewRevision += 1;
  state.lastResult = {
    type: 'html_file.revert.result',
    schema_version: HTML_FILE_WORKBENCH_SCHEMA_VERSION,
    status: 'reverted',
    path: state.path,
  };
  return state.lastResult;
}

export function buildHtmlFileSaveRequest(state) {
  const request = {
    type: 'html_file.save.request',
    schema_version: HTML_FILE_WORKBENCH_SCHEMA_VERSION,
    request_id: requestId(),
    path: state.path,
    content: state.content,
    content_length: state.content.length,
  };
  state.lastResult = request;
  return request;
}

export function applyHtmlFileSaveResult(state, message = {}) {
  const payload = payloadFromMessage(message);
  const status = text(payload.status, 'unknown');
  if (status === 'saved') {
    const content = Object.prototype.hasOwnProperty.call(payload, 'content')
      ? String(payload.content ?? '')
      : state.content;
    state.content = content;
    state.savedContent = content;
    state.dirty = false;
  }
  state.lastResult = {
    type: HTML_FILE_SAVE_RESULT_TYPE,
    schema_version: HTML_FILE_WORKBENCH_SCHEMA_VERSION,
    request_id: payload.request_id || null,
    status,
    path: text(payload.path, state.path),
    message: text(payload.message),
  };
  return state.lastResult;
}

export function applyHtmlFileTextPatch(state, message = {}) {
  const payload = payloadFromMessage(message);
  if (Object.prototype.hasOwnProperty.call(payload, 'content')) {
    setHtmlFileContent(state, payload.content);
  }
  state.lastResult = {
    type: 'html_file.text.patch.result',
    schema_version: HTML_FILE_WORKBENCH_SCHEMA_VERSION,
    status: 'applied',
    path: state.path,
  };
  return state.lastResult;
}

export function htmlFileWorkbenchSnapshot(state) {
  return {
    surface: HTML_FILE_WORKBENCH_SURFACE,
    schema_version: HTML_FILE_WORKBENCH_SCHEMA_VERSION,
    path: state.path,
    dirty: state.dirty,
    content: state.content,
    content_length: state.content.length,
    content_hash: state.contentHash || '',
    preview_mode: state.previewMode,
    preview_revision: state.previewRevision,
    preview_content_length: state.previewContent.length,
    last_result: state.lastResult ? cloneJson(state.lastResult) : null,
  };
}
