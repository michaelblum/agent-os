import crypto from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { appendFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';

function commandExists(command) {
  const result = spawnSync('sh', ['-lc', `command -v ${JSON.stringify(command)} >/dev/null 2>&1`]);
  return result.status === 0;
}

function run(cmd, args, options = {}) {
  const result = spawnSync(cmd, args, {
    encoding: 'utf8',
    timeout: options.timeout ?? 5000,
    cwd: options.cwd,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    const message = (result.stderr || result.stdout || `${cmd} exited ${result.status}`).trim();
    const error = new Error(message);
    error.status = result.status;
    throw error;
  }
  return result.stdout || '';
}

function shellQuote(value) {
  const textValue = String(value);
  if (/^[A-Za-z0-9_./:=@%+-]+$/.test(textValue)) return textValue;
  return `'${textValue.replace(/'/g, `'\\''`)}'`;
}

function boundedInt(value, fallback, min, max) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, Math.trunc(parsed)));
}

function ptyInputTelemetryPath(env = process.env) {
  if (env.AOS_AGENT_TERMINAL_PTY_INPUT_LOG) return env.AOS_AGENT_TERMINAL_PTY_INPUT_LOG;
  const stateRoot = env.AOS_STATE_ROOT || path.join(env.HOME || process.cwd(), '.config', 'aos');
  const mode = env.AOS_RUNTIME_MODE || 'repo';
  return path.join(stateRoot, mode, 'agent-terminal', 'pty-input.jsonl');
}

function appendPtyInputTelemetry(record, env = process.env) {
  try {
    const logPath = ptyInputTelemetryPath(env);
    mkdirSync(path.dirname(logPath), { recursive: true, mode: 0o700 });
    appendFileSync(logPath, `${JSON.stringify({
      schema: 'aos.agent_terminal.pty_input.v1',
      timestamp: new Date().toISOString(),
      ...record,
    })}\n`, { encoding: 'utf8', mode: 0o600 });
  } catch {
    // Input delivery should not fail because local telemetry is unavailable.
  }
}

function appendProcessOutput(record, chunk) {
  const textChunk = chunk.toString('utf8');
  record.buffer += textChunk;
  if (record.buffer.length > 240000) {
    record.buffer = record.buffer.slice(-200000);
  }
  for (const client of record.clients) {
    if (!client.destroyed) client.write(wsFrame(textChunk));
  }
}

function appendProcessStderr(record, chunk) {
  const textChunk = chunk.toString('utf8');
  const remaining = textChunk.split('\n').filter((line) => {
    const match = line.match(/^AGENT_TERMINAL_PTY_CHILD_PID=(\d+)$/);
    if (match) {
      if (record.commandPid == null) {
        record.commandPid = Number(match[1]);
        return false;
      }
      return true;
    }
    return line.length > 0;
  }).join('\n');
  if (remaining) appendProcessOutput(record, `${remaining}\n`);
}

function childStdinOpen(child) {
  return child?.stdin
    && !child.stdin.destroyed
    && !child.stdin.writableEnded
    && !child.stdin.closed
    && child.exitCode == null
    && child.signalCode == null;
}

function writeChildStdin(child, data) {
  const payload = Buffer.isBuffer(data) ? data : Buffer.from(String(data), 'utf8');
  if (!childStdinOpen(child)) {
    return { bytes: payload.length, accepted: false };
  }
  try {
    return {
      bytes: payload.length,
      accepted: child.stdin.write(payload),
    };
  } catch {
    return { bytes: payload.length, accepted: false };
  }
}

function wsFrame(data, opcode = 1) {
  const payload = Buffer.isBuffer(data) ? data : Buffer.from(String(data), 'utf8');
  const header = [];
  header.push(0x80 | opcode);
  if (payload.length < 126) {
    header.push(payload.length);
  } else if (payload.length < 65536) {
    header.push(126, (payload.length >> 8) & 0xff, payload.length & 0xff);
  } else {
    header.push(127, 0, 0, 0, 0);
    const len = BigInt(payload.length);
    header.push(
      Number((len >> 24n) & 0xffn),
      Number((len >> 16n) & 0xffn),
      Number((len >> 8n) & 0xffn),
      Number(len & 0xffn),
    );
  }
  return Buffer.concat([Buffer.from(header), payload]);
}

function decodeWsFrames(buffer) {
  const frames = [];
  let offset = 0;
  while (buffer.length - offset >= 2) {
    const first = buffer[offset];
    const second = buffer[offset + 1];
    const opcode = first & 0x0f;
    const masked = (second & 0x80) !== 0;
    let length = second & 0x7f;
    let headerLength = 2;
    if (length === 126) {
      if (buffer.length - offset < 4) break;
      length = buffer.readUInt16BE(offset + 2);
      headerLength = 4;
    } else if (length === 127) {
      if (buffer.length - offset < 10) break;
      const high = buffer.readUInt32BE(offset + 2);
      const low = buffer.readUInt32BE(offset + 6);
      length = high * 2 ** 32 + low;
      headerLength = 10;
    }
    const maskLength = masked ? 4 : 0;
    const total = headerLength + maskLength + length;
    if (buffer.length - offset < total) break;
    let payload = buffer.subarray(offset + headerLength + maskLength, offset + total);
    if (masked) {
      const mask = buffer.subarray(offset + headerLength, offset + headerLength + 4);
      payload = Buffer.from(payload);
      for (let i = 0; i < payload.length; i += 1) {
        payload[i] = payload[i] ^ mask[i % 4];
      }
    }
    frames.push({ opcode, payload });
    offset += total;
  }
  return { frames, rest: buffer.subarray(offset) };
}

function commandText(value, fallback) {
  if (Array.isArray(value)) {
    const parts = value.map((part) => String(part)).filter(Boolean);
    if (!parts.length) return fallback;
    return parts.map(shellQuote).join(' ');
  }
  if (typeof value === 'string' && value.trim()) return value.trim();
  return fallback;
}

function createTerminalSessionManager(options = {}) {
  const {
    defaultSession,
    defaultCwd,
    defaultCommand,
    requestedDriver = 'auto',
    ptyProxyPath,
    defaultTerminalSize = { cols: 80, rows: 24 },
  } = options;
  const processSessions = new Map();
  const ownedTmuxSessions = new Set();
  const sessionCommands = new Map();
  const terminalClients = new Set();
  const tmuxAvailable = commandExists('tmux');
  const scriptAvailable = commandExists('script');
  const pythonAvailable = commandExists('python3');

  function activeDriver() {
    if (requestedDriver === 'tmux') return 'tmux';
    if (requestedDriver === 'process') return 'process';
    return tmuxAvailable ? 'tmux' : 'process';
  }

  function cleanSession(value) {
    const session = String(value || defaultSession).trim();
    if (!/^[A-Za-z0-9_.:-]+$/.test(session)) {
      throw new Error('Invalid tmux session name');
    }
    return session;
  }

  function hasSession(session) {
    const existing = processSessions.get(session);
    if (existing && !existing.exited) return true;
    if (!tmuxAvailable) return false;
    const result = spawnSync('tmux', ['has-session', '-t', session], { encoding: 'utf8' });
    return result.status === 0;
  }

  function canCapture(session) {
    return processSessions.has(session) || hasSession(session);
  }

  function ensureProcessSession(session, cwd, command, force = false) {
    const existing = processSessions.get(session);
    if (existing && !existing.exited && !force) return { created: false, driver: 'process' };
    if (existing && !existing.exited) {
      existing.child.kill('SIGTERM');
    }
    const shellCommand = command || defaultCommand;
    const args = pythonAvailable
      ? [ptyProxyPath, shellCommand]
      : ['-lc', shellCommand];
    const child = spawn(pythonAvailable ? 'python3' : 'sh', args, {
      cwd: cwd || defaultCwd,
      stdio: 'pipe',
      env: {
        ...process.env,
        TERM: process.env.TERM || 'xterm-256color',
        AGENT_TERMINAL_COLS: String(defaultTerminalSize.cols),
        AGENT_TERMINAL_ROWS: String(defaultTerminalSize.rows),
      },
    });
    const record = {
      child,
      command: shellCommand,
      cwd: cwd || defaultCwd,
      terminalSize: { ...defaultTerminalSize },
      buffer: `$ ${shellCommand}\n`,
      clients: new Set(),
      exited: false,
      commandPid: null,
    };
    processSessions.set(session, record);
    sessionCommands.set(session, { command: shellCommand, cwd: cwd || defaultCwd });
    child.stdout.on('data', chunk => appendProcessOutput(record, chunk));
    child.stderr.on('data', chunk => appendProcessStderr(record, chunk));
    child.stdin.on('error', () => {});
    child.on('exit', (code, signal) => {
      record.exited = true;
      const message = `\n[process exited: ${signal || (code ?? 0)}]\n`;
      record.buffer += message;
      for (const client of record.clients) {
        if (!client.destroyed) {
          client.write(wsFrame(message));
          client.end();
        }
      }
    });
    child.on('error', error => {
      record.exited = true;
      const message = `\n[process error: ${error.message}]\n`;
      record.buffer += message;
      for (const client of record.clients) {
        if (!client.destroyed) {
          client.write(wsFrame(message));
          client.end();
        }
      }
    });
    return { created: true, driver: 'process', child_pid: child.pid };
  }

  function ensureTmuxSession(session, cwd, command, force = false) {
    if (!tmuxAvailable) {
      throw new Error('tmux is not installed');
    }
    if (force && hasSession(session)) {
      run('tmux', ['kill-session', '-t', session]);
    }
    if (hasSession(session)) return { created: false, driver: 'tmux' };
    const args = ['new-session', '-d', '-s', session];
    if (cwd) args.push('-c', cwd);
    args.push(command || defaultCommand);
    run('tmux', args);
    sessionCommands.set(session, { command: command || defaultCommand, cwd: cwd || defaultCwd });
    ownedTmuxSessions.add(session);
    return { created: true, driver: 'tmux' };
  }

  function terminateProcessSession(session, record, signal = 'SIGTERM') {
    if (!record || record.exited) return Promise.resolve({ session, exited: true, signal: null });
    return new Promise((resolve) => {
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        clearTimeout(killTimer);
        resolve({ session, exited: record.exited, signal: record.child.signalCode ?? null });
      };
      const killTimer = setTimeout(() => {
        if (!record.exited) record.child.kill('SIGKILL');
        setTimeout(finish, 100);
      }, 1000);
      record.child.once('exit', finish);
      record.child.kill(signal);
    });
  }

  async function terminateOwnedSessions() {
    const processStops = [...processSessions.entries()]
      .map(([session, record]) => terminateProcessSession(session, record));
    const tmuxStops = [];
    if (tmuxAvailable) {
      for (const session of ownedTmuxSessions) {
        tmuxStops.push(Promise.resolve().then(() => {
          if (hasSession(session)) run('tmux', ['kill-session', '-t', session]);
          return { session, exited: !hasSession(session), driver: 'tmux' };
        }));
      }
    }
    return Promise.all([...processStops, ...tmuxStops]);
  }

  function ensureSession(session, cwd, command, force = false) {
    if (activeDriver() === 'tmux') {
      return ensureTmuxSession(session, cwd, command, force);
    }
    return ensureProcessSession(session, cwd, command, force);
  }

  function capture(session, lines) {
    const existing = processSessions.get(session);
    if (existing) {
      const safeLines = Math.min(1000, Math.max(40, Number(lines) || 260));
      const textOutput = existing.buffer.split('\n').slice(-safeLines).join('\n');
      return {
        session,
        command: existing.exited ? 'exited' : 'process',
        driver: 'process',
        process_child_pid: existing.child.pid,
        command_child_pid: existing.commandPid,
        terminal: {
          cols: existing.terminalSize.cols,
          rows: existing.terminalSize.rows,
        },
        text: textOutput.replace(/\s+$/g, ''),
      };
    }
    if (!tmuxAvailable) {
      throw new Error(`session is not running: ${session}`);
    }
    const safeLines = Math.min(1000, Math.max(40, Number(lines) || 260));
    const textOutput = run('tmux', ['capture-pane', '-p', '-t', session, '-S', `-${safeLines}`]);
    const command = run('tmux', ['display-message', '-p', '-t', session, '#{pane_current_command}']).trim();
    return { session, command, driver: 'tmux', text: textOutput.replace(/\s+$/g, '') };
  }

  function writeProcessStdin(record, data) {
    if (!record || record.exited) {
      const payload = Buffer.isBuffer(data) ? data : Buffer.from(String(data), 'utf8');
      return { bytes: payload.length, accepted: false };
    }
    return writeChildStdin(record.child, data);
  }

  function writeProcessControl(record, message) {
    return writeProcessStdin(record, `\0${JSON.stringify(message)}`);
  }

  function writeInput(session, textValue, enter = true) {
    const existing = processSessions.get(session);
    if (existing) {
      if (existing.exited) throw new Error(`session is not running: ${session}`);
      const textWrite = writeProcessStdin(existing, textValue);
      const enterWrite = enter ? writeProcessStdin(existing, '\r') : null;
      appendPtyInputTelemetry({
        action: 'send',
        target: session,
        driver: 'process-stdin',
        text: textValue,
        utf8_hex: Buffer.from(textValue, 'utf8').toString('hex'),
        clear_sent: false,
        submit_sent: enter,
      });
      return {
        ok: true,
        driver: 'process',
        session_exists: true,
        text_bytes: textWrite.bytes,
        text_accepted: textWrite.accepted,
        enter_sent: enter,
        enter_bytes: enterWrite?.bytes ?? 0,
        enter_accepted: enterWrite?.accepted ?? null,
      };
    }
    const bufferName = `aos-agent-terminal-input-${crypto.randomUUID()}`;
    const load = spawnSync('tmux', ['load-buffer', '-b', bufferName, '-'], {
      input: textValue,
      encoding: 'utf8',
      timeout: 5000,
    });
    if (load.error) throw load.error;
    if (load.status !== 0) {
      const message = (load.stderr || load.stdout || `tmux load-buffer exited ${load.status}`).trim();
      const error = new Error(message);
      error.status = load.status;
      throw error;
    }
    run('tmux', ['paste-buffer', '-d', '-b', bufferName, '-t', session]);
    if (enter !== false) run('tmux', ['send-keys', '-t', session, 'Enter']);
    appendPtyInputTelemetry({
      action: 'send',
      target: session,
      driver: 'tmux',
      paste_buffer: bufferName,
      text: textValue,
      utf8_hex: Buffer.from(textValue, 'utf8').toString('hex'),
      clear_sent: false,
      submit_sent: enter !== false,
    });
    return { ok: true, driver: 'tmux', paste_buffer: true, enter_sent: enter !== false };
  }

  function writeKey(session, key) {
    const existing = processSessions.get(session);
    if (existing) {
      if (existing.exited) throw new Error(`session is not running: ${session}`);
      const sequence = {
        Enter: '\r',
        'C-c': '\x03',
        'C-d': '\x04',
        Up: '\x1b[A',
        Down: '\x1b[B',
        Right: '\x1b[C',
        Left: '\x1b[D',
        Tab: '\t',
        Escape: '\x1b',
        Backspace: '\x7f',
      }[key];
      const write = writeProcessStdin(existing, sequence);
      appendPtyInputTelemetry({
        action: 'key',
        target: session,
        driver: 'process-stdin',
        key,
      });
      return {
        ok: true,
        driver: 'process',
        session_exists: true,
        key,
        key_bytes: write.bytes,
        key_accepted: write.accepted,
      };
    }
    if (!tmuxAvailable) throw new Error(`session is not running: ${session}`);
    const tmuxKey = key === 'Enter' ? 'Enter' : key;
    run('tmux', ['send-keys', '-t', session, tmuxKey]);
    appendPtyInputTelemetry({
      action: 'key',
      target: session,
      driver: 'tmux',
      key: tmuxKey,
    });
    return { ok: true, driver: 'tmux' };
  }

  function resize(session, colsValue, rowsValue) {
    const existing = processSessions.get(session);
    if (existing) {
      if (existing.exited) throw new Error(`session is not running: ${session}`);
      const cols = boundedInt(colsValue, existing.terminalSize.cols, 20, 300);
      const rows = boundedInt(rowsValue, existing.terminalSize.rows, 8, 120);
      const write = writeProcessControl(existing, { type: 'resize', cols, rows });
      existing.terminalSize = { cols, rows };
      return {
        ok: true,
        driver: 'process',
        session_exists: true,
        cols,
        rows,
        resize_bytes: write.bytes,
        resize_accepted: write.accepted,
      };
    }
    if (!tmuxAvailable) throw new Error(`session is not running: ${session}`);
    const cols = boundedInt(colsValue, 80, 20, 300);
    const rows = boundedInt(rowsValue, 24, 8, 120);
    run('tmux', ['resize-window', '-t', session, '-x', String(cols), '-y', String(rows)]);
    return { ok: true, driver: 'tmux', cols, rows };
  }

  function terminalCommandForSession(session) {
    if (tmuxAvailable && hasSession(session)) {
      return `tmux attach-session -t ${JSON.stringify(session)}`;
    }
    return processSessions.get(session)?.command || sessionCommands.get(session)?.command || defaultCommand;
  }

  function terminalCwdForSession(session) {
    return processSessions.get(session)?.cwd || sessionCommands.get(session)?.cwd || defaultCwd;
  }

  function terminalGeometryForSession(session) {
    return processSessions.get(session)?.terminalSize ?? defaultTerminalSize;
  }

  function attachExistingProcessSocket(socket, session, record) {
    terminalClients.add(socket);
    record.clients.add(socket);
    if (record.buffer) socket.write(wsFrame(record.buffer));
    let incoming = Buffer.alloc(0);

    function detach() {
      terminalClients.delete(socket);
      record.clients.delete(socket);
    }

    socket.on('data', chunk => {
      incoming = Buffer.concat([incoming, chunk]);
      const decoded = decodeWsFrames(incoming);
      incoming = decoded.rest;
      for (const frame of decoded.frames) {
        if (frame.opcode === 8) {
          socket.end();
          return;
        }
        if (frame.opcode === 9) {
          socket.write(wsFrame(frame.payload, 10));
          continue;
        }
        if (frame.opcode === 1 || frame.opcode === 2) {
          const payload = frame.payload.toString('utf8');
          if (frame.opcode === 1 && payload.charCodeAt(0) === 0) {
            let message = null;
            try {
              message = JSON.parse(payload.slice(1));
            } catch {
              continue;
            }
            if (message?.type === 'resize') {
              resize(session, message.cols, message.rows);
            }
            continue;
          }
          if (record.exited) {
            socket.end();
            return;
          }
          writeProcessStdin(record, frame.payload);
        }
      }
    });
    socket.on('close', detach);
    socket.on('error', detach);
  }

  function attachTerminalSocket(socket, req) {
    const key = req.headers['sec-websocket-key'];
    if (!key) {
      socket.end('HTTP/1.1 400 Bad Request\r\n\r\n');
      return;
    }
    const url = new URL(req.url || '/', `http://${req.headers.host || '127.0.0.1'}`);
    const session = cleanSession(url.searchParams.get('session'));
    const acceptKey = crypto
      .createHash('sha1')
      .update(`${key}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`)
      .digest('base64');
    socket.write([
      'HTTP/1.1 101 Switching Protocols',
      'Upgrade: websocket',
      'Connection: Upgrade',
      `Sec-WebSocket-Accept: ${acceptKey}`,
      '\r\n',
    ].join('\r\n'));

    const existing = processSessions.get(session);
    if (activeDriver() === 'process' && existing && !existing.exited) {
      attachExistingProcessSocket(socket, session, existing);
      return;
    }

    const command = terminalCommandForSession(session);
    const child = spawn(pythonAvailable ? 'python3' : 'sh', pythonAvailable ? [ptyProxyPath, command] : ['-lc', command], {
      cwd: terminalCwdForSession(session),
      stdio: 'pipe',
      env: { ...process.env, TERM: 'xterm-256color' },
    });
    terminalClients.add(socket);
    let incoming = Buffer.alloc(0);

    function handleControlFrame(payload) {
      if (typeof payload !== 'string' || payload.charCodeAt(0) !== 0) return false;
      let message = null;
      try {
        message = JSON.parse(payload.slice(1));
      } catch {
        return false;
      }
      if (message?.type !== 'resize') return false;
      const cols = Math.max(20, Math.min(300, Number(message.cols) || 0));
      const rows = Math.max(8, Math.min(120, Number(message.rows) || 0));
      if (!cols || !rows || !tmuxAvailable) return true;
      spawn('tmux', ['resize-window', '-t', session, '-x', String(cols), '-y', String(rows)], {
        stdio: 'ignore',
        detached: true,
      }).unref();
      return true;
    }

    child.stdout.on('data', chunk => {
      if (!socket.destroyed) socket.write(wsFrame(chunk.toString('utf8')));
    });
    child.stderr.on('data', chunk => {
      if (!socket.destroyed) socket.write(wsFrame(chunk.toString('utf8')));
    });
    child.on('exit', (code, signal) => {
      if (!socket.destroyed) {
        socket.write(wsFrame(`\r\n[terminal detached: ${signal || (code ?? 0)}]\r\n`));
        socket.end();
      }
    });
    child.stdin.on('error', () => {});

    socket.on('data', chunk => {
      incoming = Buffer.concat([incoming, chunk]);
      const decoded = decodeWsFrames(incoming);
      incoming = decoded.rest;
      for (const frame of decoded.frames) {
        if (frame.opcode === 8) {
          socket.end();
          return;
        }
        if (frame.opcode === 9) {
          socket.write(wsFrame(frame.payload, 10));
          continue;
        }
        if (frame.opcode === 1 || frame.opcode === 2) {
          if (frame.opcode === 1 && handleControlFrame(frame.payload.toString('utf8'))) continue;
          writeChildStdin(child, frame.payload);
        }
      }
    });
    socket.on('close', () => {
      terminalClients.delete(socket);
      child.kill('SIGTERM');
    });
    socket.on('error', () => {
      terminalClients.delete(socket);
      child.kill('SIGTERM');
    });
  }

  return {
    activeDriver,
    cleanSession,
    commandText: (value) => commandText(value, defaultCommand),
    ensureSession,
    capture,
    resize,
    writeInput,
    writeKey,
    hasSession,
    canCapture,
    terminalCommandForSession,
    terminalCwdForSession,
    terminalGeometryForSession,
    attachTerminalSocket,
    terminateOwnedSessions,
    tmuxAvailable,
    scriptAvailable,
    pythonAvailable,
  };
}

export {
  appendProcessStderr,
  boundedInt,
  createTerminalSessionManager,
  childStdinOpen,
  writeChildStdin,
};
