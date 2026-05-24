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

function eventHasPasteShortcut(event) {
  if (event.altKey || event.shiftKey) return false;
  if (!event.metaKey && !event.ctrlKey) return false;
  const key = String(event?.key || '').toLowerCase();
  const code = String(event?.code || '').toLowerCase();
  return key === 'v'
    || code === 'keyv'
    || event?.keyCode === 86
    || event?.which === 86;
}

function readPasteEventText(event) {
  return event?.clipboardData?.getData?.('text/plain')
    || event?.clipboardData?.getData?.('text')
    || '';
}

function isTerminalMouseTrackingActive(terminal) {
  return terminal?.modes?.mouseTrackingMode
    && terminal.modes.mouseTrackingMode !== 'none';
}

export function createTerminalInputPolicy({
  terminal,
  forwardInput = () => {},
  readClipboardText = () => '',
  now = () => Date.now(),
  pasteDedupeMs = 750,
} = {}) {
  if (!terminal) throw new Error('Agent Terminal input policy requires terminal');

  let lastPaste = { text: '', at: 0 };

  function dispatchPaste(text) {
    if (typeof text !== 'string' || text.length === 0) return false;
    const at = now();
    if (text === lastPaste.text && at - lastPaste.at < pasteDedupeMs) return false;
    lastPaste = { text, at };
    if (typeof terminal.paste === 'function') {
      terminal.paste(text);
    } else {
      forwardInput(text);
    }
    return true;
  }

  async function pasteFromClipboard() {
    try {
      const text = await readClipboardText();
      dispatchPaste(text);
    } catch (_) {}
  }

  function handleKeyEvent(event) {
    if (!eventHasPasteShortcut(event)) return true;
    event.preventDefault?.();
    event.stopPropagation?.();
    void pasteFromClipboard();
    return false;
  }

  function handlePasteEvent(event) {
    const text = readPasteEventText(event);
    if (!text) return;
    event.preventDefault?.();
    event.stopPropagation?.();
    dispatchPaste(text);
  }

  function handleWheelEvent(event) {
    if (isTerminalMouseTrackingActive(terminal)) return true;
    event.preventDefault?.();
    event.stopPropagation?.();
    const delta = Number(event?.deltaY || 0);
    const direction = delta < 0 ? -1 : 1;
    const lines = Math.max(1, Math.ceil(Math.abs(delta) / 40));
    terminal.scrollLines?.(direction * lines);
    return false;
  }

  function attach({ element } = {}) {
    function prepareNativePaste(event) {
      if (!eventHasPasteShortcut(event) || !event.metaKey) return;
      event.stopImmediatePropagation?.();
      event.stopPropagation?.();
    }
    element?.addEventListener?.('keydown', prepareNativePaste, true);
    terminal.attachCustomKeyEventHandler?.(handleKeyEvent);
    terminal.attachCustomWheelEventHandler?.(handleWheelEvent);
    element?.addEventListener?.('paste', handlePasteEvent);
    return {
      dispose() {
        element?.removeEventListener?.('keydown', prepareNativePaste, true);
        element?.removeEventListener?.('paste', handlePasteEvent);
      },
    };
  }

  return {
    attach,
    dispatchPaste,
    handleKeyEvent,
    handlePasteEvent,
    handleWheelEvent,
    pasteFromClipboard,
  };
}

export function mountTerminalContextMenu({
  element,
  menu,
  pasteButton,
  inputPolicy,
  readClipboardText = () => '',
  documentRef = globalThis.document,
} = {}) {
  if (!element || !menu || !pasteButton || !inputPolicy) {
    return { dispose() {} };
  }

  function hide() {
    menu.hidden = true;
  }

  function show(event) {
    event.preventDefault?.();
    event.stopPropagation?.();
    const bounds = element.getBoundingClientRect?.() || { left: 0, top: 0 };
    menu.style.left = `${Math.max(0, event.clientX - bounds.left)}px`;
    menu.style.top = `${Math.max(0, event.clientY - bounds.top)}px`;
    menu.hidden = false;
    pasteButton.focus?.();
  }

  async function pasteFromMenu(event) {
    event.preventDefault?.();
    event.stopPropagation?.();
    hide();
    try {
      inputPolicy.dispatchPaste(await readClipboardText());
    } catch (_) {}
  }

  element.addEventListener('contextmenu', show);
  pasteButton.addEventListener('click', pasteFromMenu);
  documentRef?.addEventListener?.('click', hide);
  documentRef?.addEventListener?.('keydown', hide);

  return {
    dispose() {
      element.removeEventListener('contextmenu', show);
      pasteButton.removeEventListener('click', pasteFromMenu);
      documentRef?.removeEventListener?.('click', hide);
      documentRef?.removeEventListener?.('keydown', hide);
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
  readClipboardText = () => globalThis.navigator?.clipboard?.readText?.() || '',
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
  const inputPolicy = createTerminalInputPolicy({
    terminal,
    forwardInput,
    readClipboardText,
  });

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

  function attachInputHandlers({ element } = {}) {
    return inputPolicy.attach({ element });
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
    attachInputHandlers,
    forwardInput,
    inputPolicy,
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
