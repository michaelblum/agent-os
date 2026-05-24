export function createDefaultTerminalOptions() {
  return {
    cursorBlink: true,
    convertEol: false,
    fontFamily: 'SF Mono, Menlo, Consolas, monospace',
    fontSize: 12,
    lineHeight: 1.15,
    scrollback: 5000,
    theme: {
      background: '#050708',
      foreground: '#d8e6df',
      cursor: '#86ddff',
      selectionBackground: '#264d62',
    },
  };
}

export function createAgentTerminalController({
  bridgeClient,
  terminal,
  fitAddon,
  session = 'aos-agent-terminal-agent-os',
  setStatus = () => {},
  setAttached = () => {},
  renderInspectorEmpty = () => {},
  loadSessions = () => {},
  requestAnimationFrameImpl = globalThis.requestAnimationFrame?.bind(globalThis),
  cancelAnimationFrameImpl = globalThis.cancelAnimationFrame?.bind(globalThis),
  setTimeoutImpl = globalThis.setTimeout?.bind(globalThis),
  WebSocketImpl = globalThis.WebSocket,
} = {}) {
  if (!bridgeClient) throw new Error('Agent Terminal controller requires bridgeClient');
  if (!terminal) throw new Error('Agent Terminal controller requires terminal');
  if (!fitAddon) throw new Error('Agent Terminal controller requires fitAddon');

  const requestFrame = typeof requestAnimationFrameImpl === 'function'
    ? requestAnimationFrameImpl
    : (callback) => setTimeoutImpl(callback, 0);
  const cancelFrame = typeof cancelAnimationFrameImpl === 'function'
    ? cancelAnimationFrameImpl
    : () => {};

  let socket = null;
  let resizeRaf = 0;
  let lastFit = { cols: 0, rows: 0 };
  let activeLabel = 'Agent terminal';
  let currentCwd = '';

  function isOpenSocket(value) {
    return value?.readyState === WebSocketImpl?.OPEN;
  }

  function resizeTerminal() {
    if (!fitAddon || !terminal) return;
    cancelFrame(resizeRaf);
    resizeRaf = requestFrame(() => {
      try {
        fitAddon.fit();
        const cols = terminal.cols;
        const rows = terminal.rows;
        if (cols !== lastFit.cols || rows !== lastFit.rows) {
          lastFit = { cols, rows };
          if (isOpenSocket(socket)) {
            socket.send(bridgeClient.formatResizeFrame({ cols, rows }));
          }
        }
      } catch (_) {}
    });
  }

  function scheduleRefit() {
    resizeTerminal();
    setTimeoutImpl(resizeTerminal, 40);
    setTimeoutImpl(resizeTerminal, 160);
  }

  async function eventDataToText(data) {
    if (data && typeof data.text === 'function') return data.text();
    return String(data);
  }

  function connectTerminal(label = activeLabel) {
    const previous = socket;
    socket = null;
    if (previous && previous.readyState !== WebSocketImpl?.CLOSED) previous.close();

    const ws = bridgeClient.openTerminalSocket({ session });
    socket = ws;
    ws.addEventListener('open', () => {
      if (socket !== ws) return;
      setStatus('ready', `${label} - attached`);
      setAttached(true);
      terminal.clear();
      scheduleRefit();
      terminal.focus();
    });
    ws.addEventListener('message', async (event) => {
      if (socket !== ws) return;
      terminal.write(await eventDataToText(event.data));
    });
    ws.addEventListener('close', () => {
      if (socket !== ws) return;
      setAttached(false);
      setStatus('error', `${label} - detached`);
    });
    ws.addEventListener('error', () => {
      if (socket !== ws) return;
      setStatus('error', 'terminal bridge error');
    });
    return ws;
  }

  async function runAgentCommand({ command, cwd, label, hasSelectedSession = true } = {}) {
    activeLabel = label;
    currentCwd = cwd || currentCwd;
    if (!hasSelectedSession) renderInspectorEmpty('Telemetry pending');
    setStatus('', `Starting ${label}`);
    terminal.clear();
    terminal.writeln(`Starting ${label}...`);
    try {
      await bridgeClient.ensureSession({
        session,
        cwd: currentCwd,
        command,
        force: true,
      });
      connectTerminal(label);
      void loadSessions();
    } catch (error) {
      setStatus('error', 'launch failed');
      terminal.writeln(`\r\n${error.message || String(error)}`);
    }
  }

  function forwardInput(data) {
    if (isOpenSocket(socket)) socket.send(data);
  }

  function dispose() {
    const previous = socket;
    socket = null;
    cancelFrame(resizeRaf);
    if (previous && previous.readyState !== WebSocketImpl?.CLOSED) previous.close();
  }

  return {
    connectTerminal,
    dispose,
    forwardInput,
    get activeLabel() {
      return activeLabel;
    },
    get currentCwd() {
      return currentCwd;
    },
    get socket() {
      return socket;
    },
    resizeTerminal,
    runAgentCommand,
    scheduleRefit,
    setCurrentCwd(value) {
      currentCwd = value || '';
    },
  };
}
