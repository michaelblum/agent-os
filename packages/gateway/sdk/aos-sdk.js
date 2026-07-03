// sdk/aos-sdk.js
// AOS SDK Runtime — injected into script execution contexts.
// Zero npm dependencies. Communicates with gateway via Unix socket NDJSON.

const net = require('node:net');
const DEFAULT_CALL_TIMEOUT_MS = 10000;
let _conn = null;
let _reqId = 0;
const _pending = new Map();

function callTimeoutMs() {
  const raw = globalThis.__aos_config?.sdkCallTimeoutMs ?? globalThis.__aos_config?.callTimeoutMs;
  const timeoutMs = Number(raw);
  return Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : DEFAULT_CALL_TIMEOUT_MS;
}

function settlePending(id, type, value) {
  const pending = _pending.get(id);
  if (!pending) return false;
  _pending.delete(id);
  clearTimeout(pending.timeout);
  pending[type](value);
  return true;
}

function rejectPending(error) {
  for (const pending of _pending.values()) {
    clearTimeout(pending.timeout);
    pending.reject(error);
  }
  _pending.clear();
}

function getConnection() {
  if (_conn) return _conn;
  const sockPath = globalThis.__aos_config?.gatewaySocket;
  if (!sockPath) throw new Error('__aos_config.gatewaySocket not set');
  _conn = net.createConnection(sockPath);
  let buffer = '';
  _conn.on('data', (chunk) => {
    buffer += chunk.toString();
    let idx;
    while ((idx = buffer.indexOf('\n')) !== -1) {
      const line = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 1);
      try {
        const resp = JSON.parse(line);
        settlePending(resp.id, 'resolve', resp.result);
      } catch {}
    }
  });
  _conn.on('error', (error) => {
    rejectPending(error);
  });
  _conn.on('close', () => {
    rejectPending(new Error('AOS SDK socket closed'));
    _conn = null;
  });
  return _conn;
}

function call(domain, method, params) {
  return new Promise((resolve, reject) => {
    const id = String(++_reqId);
    let conn;
    try {
      conn = getConnection();
    } catch (error) {
      reject(error);
      return;
    }
    const timeoutMs = callTimeoutMs();
    const timeout = setTimeout(() => {
      settlePending(id, 'reject', new Error(`AOS SDK call timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    _pending.set(id, { resolve, reject, timeout });
    conn.write(JSON.stringify({ id, domain, method, params }) + '\n', (error) => {
      if (!error) return;
      settlePending(id, 'reject', error);
    });
  });
}

const aos = {
  // --- Perception ---
  getWindows: (filter) => call('system', 'getWindows', { filter }),
  getCursor: () => call('system', 'getCursor', {}),
  capture: (opts) => call('system', 'capture', opts ?? {}),
  getDisplays: () => call('system', 'getDisplays', {}),

  // --- Action ---
  click: (target) => call('system', 'click', { target }),
  type: (text) => call('system', 'type', { text }),
  say: (text) => call('system', 'say', { text }),

  // --- Display ---
  createCanvas: (opts) => call('system', 'createCanvas', opts),
  removeCanvas: (id) => call('system', 'removeCanvas', { id }),
  evalCanvas: (id, js) => call('system', 'evalCanvas', { id, js }),
  updateCanvas: (id, opts) => call('system', 'updateCanvas', { id, ...opts }),
  listCanvases: () => call('system', 'listCanvases', {}),

  // --- Config & Health ---
  doctor: () => call('system', 'doctor', {}),
  getConfig: () => call('system', 'getConfig', {}),
  setConfig: (key, value) => call('system', 'setConfig', { key, value }),

  // --- Layer 2: Smart Operations ---
  perceive: () => call('system', 'perceive', {}),
  findWindow: (query) => call('system', 'findWindow', query),
  clickElement: (label, opts) => call('system', 'clickElement', { label, ...opts }),
  waitFor: (pattern, opts) => call('system', 'waitFor', { pattern, ...opts }),
  showOverlay: (opts) => call('system', 'showOverlay', opts),
  updateOverlay: (id, opts) => call('system', 'updateOverlay', { id, ...opts }),
};

globalThis.aos = aos;
globalThis.__aos_call = call;
globalThis.__aos_cleanup = () => {
  rejectPending(new Error('AOS SDK cleanup'));
  if (_conn) _conn.destroy();
  _conn = null;
};
