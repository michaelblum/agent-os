// sdk/aos-sdk.js
// AOS SDK Runtime — injected into script execution contexts.
// Zero npm dependencies. Communicates with gateway via Unix socket NDJSON.

const net = require('node:net');
let _conn = null;
let _reqId = 0;
const _pending = new Map();

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
        const resolve = _pending.get(resp.id);
        if (resolve) { _pending.delete(resp.id); resolve(resp.result); }
      } catch {}
    }
  });
  return _conn;
}

function call(domain, method, params) {
  return new Promise((resolve) => {
    const id = String(++_reqId);
    _pending.set(id, resolve);
    const conn = getConnection();
    conn.write(JSON.stringify({ id, domain, method, params }) + '\n');
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

  // --- Coordination ---
  coordination: {
    register: (name, role, harness, capabilities) =>
      call('coordination', 'register', { name, role, harness, capabilities }),
    whoIsOnline: () => call('coordination', 'whoIsOnline', {}),
    getState: (key) => call('coordination', 'getState', { key }),
    setState: (key, value, options) =>
      call('coordination', 'setState', { key, value, options }),
    postMessage: (channel, payload, from) =>
      call('coordination', 'postMessage', { channel, payload, from: from ?? globalThis.__aos_config?.sessionId }),
    readStream: (channel, options) =>
      call('coordination', 'readStream', { channel, options }),
  },
};

globalThis.aos = aos;
globalThis.__aos_call = call;
globalThis.__aos_cleanup = () => { if (_conn) _conn.destroy(); };
