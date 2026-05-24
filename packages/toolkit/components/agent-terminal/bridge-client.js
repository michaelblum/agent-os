export function createBridgeUrl({ port, protocol = 'http:', host = '127.0.0.1' } = {}) {
  const cleanPort = String(port || '17761').trim() || '17761';
  return `${protocol}//${host}:${cleanPort}`;
}

export function createTerminalWebSocketUrl({ port, session, protocol = 'ws:', host = '127.0.0.1' } = {}) {
  const base = createBridgeUrl({ port, protocol, host });
  const query = new URLSearchParams();
  query.set('session', session || 'aos-agent-terminal-agent-os');
  return `${base}/terminal?${query.toString()}`;
}

export function formatResizeFrame({ cols, rows }) {
  return '\u0000' + JSON.stringify({ type: 'resize', cols, rows });
}

export function createAgentTerminalBridgeClient({
  port = '17761',
  host = '127.0.0.1',
  fetchImpl = globalThis.fetch?.bind(globalThis),
  WebSocketImpl = globalThis.WebSocket,
} = {}) {
  const bridgeBase = createBridgeUrl({ port, host });

  function requireFetch() {
    if (typeof fetchImpl !== 'function') {
      throw new Error('Agent Terminal bridge client requires fetch');
    }
    return fetchImpl;
  }

  async function readJson(response) {
    if (!response.ok) {
      const message = typeof response.text === 'function' ? await response.text() : response.statusText;
      throw new Error(message || `Bridge request failed: ${response.status}`);
    }
    return response.json();
  }

  function url(path) {
    return `${bridgeBase}${path}`;
  }

  async function loadSessions({ cwd, provider } = {}) {
    const query = new URLSearchParams();
    if (cwd) query.set('cwd', cwd);
    if (provider && provider !== 'all') query.append('provider', provider);
    return readJson(await requireFetch()(url(`/sessions?${query.toString()}`)));
  }

  async function loadInspector({ cwd, provider, sessionId }) {
    const query = new URLSearchParams();
    query.set('provider', provider);
    query.set('session_id', sessionId);
    if (cwd) query.set('cwd', cwd);
    return readJson(await requireFetch()(url(`/session-inspector?${query.toString()}`)));
  }

  async function ensureSession({ session, cwd, command, force = true }) {
    return readJson(await requireFetch()(url('/ensure'), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ session, cwd, command, force }),
    }));
  }

  function openTerminalSocket({ session }) {
    if (typeof WebSocketImpl !== 'function') {
      throw new Error('Agent Terminal bridge client requires WebSocket');
    }
    return new WebSocketImpl(createTerminalWebSocketUrl({ port, host, session }));
  }

  return {
    bridgeBase,
    url,
    loadSessions,
    loadInspector,
    ensureSession,
    openTerminalSocket,
    formatResizeFrame,
  };
}
