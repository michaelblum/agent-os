#!/usr/bin/env node
import http from 'node:http';
import crypto from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { listProviderSessions } from '../../../packages/host/src/session-catalog.ts';
import { buildSessionInspector } from './session-inspector.mjs';

const port = Number(process.env.SIGIL_AGENT_TERMINAL_PORT || process.env.SIGIL_CODEX_TERMINAL_PORT || process.env.PORT || 17761);
const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const ptyProxyPath = path.join(scriptDir, 'pty-proxy.py');
const defaultSession = process.env.SIGIL_AGENT_TMUX_SESSION || process.env.SIGIL_CODEX_TMUX_SESSION || 'sigil-agent-terminal-agent-os';
const defaultCwd = process.env.SIGIL_AGENT_CWD || process.env.SIGIL_CODEX_CWD || process.cwd();
const defaultCommand = process.env.SIGIL_AGENT_COMMAND || process.env.SIGIL_CODEX_COMMAND || 'codex --no-alt-screen';
const requestedDriver = process.env.SIGIL_AGENT_TERMINAL_DRIVER || process.env.SIGIL_CODEX_TERMINAL_DRIVER || 'auto';
const processSessions = new Map();
const sessionCommands = new Map();
const allowedKeys = new Set([
  'Enter',
  'C-c',
  'C-d',
  'Up',
  'Down',
  'Left',
  'Right',
  'Tab',
  'Escape',
  'Backspace',
]);

function json(res, status, body) {
  const data = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(data),
    'access-control-allow-origin': '*',
    'access-control-allow-methods': 'GET,POST,OPTIONS',
    'access-control-allow-headers': 'content-type',
  });
  res.end(data);
}

function text(res, status, body) {
  res.writeHead(status, {
    'content-type': 'text/plain; charset=utf-8',
    'access-control-allow-origin': '*',
    'access-control-allow-methods': 'GET,POST,OPTIONS',
    'access-control-allow-headers': 'content-type',
  });
  res.end(body);
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

function commandText(value) {
  if (Array.isArray(value)) {
    const parts = value.map((part) => String(part)).filter(Boolean);
    if (!parts.length) return defaultCommand;
    return parts.map(shellQuote).join(' ');
  }
  if (typeof value === 'string' && value.trim()) return value.trim();
  return defaultCommand;
}

function commandExists(command) {
  const result = spawnSync('sh', ['-lc', `command -v ${JSON.stringify(command)} >/dev/null 2>&1`]);
  return result.status === 0;
}

const tmuxAvailable = commandExists('tmux');
const scriptAvailable = commandExists('script');
const pythonAvailable = commandExists('python3');
const terminalClients = new Set();

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

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.setEncoding('utf8');
    req.on('data', chunk => {
      body += chunk;
      if (body.length > 1024 * 1024) {
        reject(new Error('Request body too large'));
        req.destroy();
      }
    });
    req.on('end', () => {
      if (!body.trim()) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(body));
      } catch {
        reject(new Error('Invalid JSON body'));
      }
    });
    req.on('error', reject);
  });
}

function hasSession(session) {
  const existing = processSessions.get(session);
  if (existing && !existing.exited) return true;
  if (!tmuxAvailable) return false;
  const result = spawnSync('tmux', ['has-session', '-t', session], { encoding: 'utf8' });
  return result.status === 0;
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
    env: { ...process.env, TERM: process.env.TERM || 'xterm-256color' },
  });
  const record = {
    child,
    command: shellCommand,
    cwd: cwd || defaultCwd,
    buffer: `$ ${shellCommand}\n`,
    clients: new Set(),
    exited: false,
  };
  processSessions.set(session, record);
  sessionCommands.set(session, { command: shellCommand, cwd: cwd || defaultCwd });
  child.stdout.on('data', chunk => appendProcessOutput(record, chunk));
  child.stderr.on('data', chunk => appendProcessOutput(record, chunk));
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
  return { created: true, driver: 'process' };
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
  return { created: true, driver: 'tmux' };
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

function writeProcessInput(session, textValue, enter = true) {
  const existing = processSessions.get(session);
  if (!existing || existing.exited) throw new Error(`session is not running: ${session}`);
  existing.child.stdin.write(textValue);
  if (enter) existing.child.stdin.write('\n');
}

function writeProcessKey(session, key) {
  const existing = processSessions.get(session);
  if (!existing || existing.exited) throw new Error(`session is not running: ${session}`);
  const sequence = {
    Enter: '\n',
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
  existing.child.stdin.write(sequence);
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

function terminalCommandForSession(session) {
  if (tmuxAvailable && hasSession(session)) {
    return `tmux attach-session -t ${JSON.stringify(session)}`;
  }
  return processSessions.get(session)?.command || sessionCommands.get(session)?.command || defaultCommand;
}

function terminalCwdForSession(session) {
  return processSessions.get(session)?.cwd || sessionCommands.get(session)?.cwd || defaultCwd;
}

function sessionCatalogForUrl(url) {
  const providerParams = url.searchParams.getAll('provider');
  const providers = providerParams.filter((provider) => provider === 'codex' || provider === 'claude-code');
  return listProviderSessions({
    homeDir: process.env.SIGIL_AGENT_CATALOG_HOME,
    codexRoot: process.env.SIGIL_AGENT_CODEX_ROOT,
    claudeRoot: process.env.SIGIL_AGENT_CLAUDE_ROOT,
    cwd: url.searchParams.get('cwd') || defaultCwd,
    providers: providers.length ? providers : undefined,
  });
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
        if (frame.opcode === 1 && payload.charCodeAt(0) === 0) continue;
        record.child.stdin.write(frame.payload);
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
        child.stdin.write(frame.payload);
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

async function handle(req, res) {
  res.setHeader('access-control-allow-origin', '*');
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'access-control-allow-origin': '*',
      'access-control-allow-methods': 'GET,POST,OPTIONS',
      'access-control-allow-headers': 'content-type',
    });
    res.end();
    return;
  }

  const url = new URL(req.url || '/', `http://${req.headers.host || '127.0.0.1'}`);
  try {
    if (req.method === 'GET' && url.pathname === '/health') {
      json(res, 200, {
        ok: true,
        defaultSession,
        defaultCwd,
        driver: activeDriver(),
        tmuxAvailable,
        scriptAvailable,
        pythonAvailable,
      });
      return;
    }

    if (req.method === 'GET' && url.pathname === '/sessions') {
      const sessions = sessionCatalogForUrl(url);
      json(res, 200, { sessions });
      return;
    }

    if (req.method === 'GET' && url.pathname === '/session-inspector') {
      const provider = url.searchParams.get('provider');
      const sessionId = url.searchParams.get('session_id');
      if (!provider || !sessionId) {
        text(res, 400, 'provider and session_id are required');
        return;
      }
      const sessions = sessionCatalogForUrl(url);
      const record = sessions.find((candidate) => (
        candidate.provider === provider && candidate.session_id === sessionId
      ));
      if (!record) {
        text(res, 404, `session not found: ${provider}:${sessionId}`);
        return;
      }
      json(res, 200, buildSessionInspector(record));
      return;
    }

    if (req.method === 'GET' && url.pathname === '/snapshot') {
      const session = cleanSession(url.searchParams.get('session'));
      if (!processSessions.has(session) && !hasSession(session)) {
        text(res, 404, `tmux session not found: ${session}`);
        return;
      }
      json(res, 200, capture(session, url.searchParams.get('lines')));
      return;
    }

    if (req.method === 'POST' && url.pathname === '/ensure') {
      const body = await readBody(req);
      const session = cleanSession(body.session);
      const result = ensureSession(
        session,
        typeof body.cwd === 'string' ? body.cwd : defaultCwd,
        commandText(body.command),
        body.force === true,
      );
      json(res, 200, { ok: true, session, ...result });
      return;
    }

    if (req.method === 'POST' && url.pathname === '/input') {
      const body = await readBody(req);
      const session = cleanSession(body.session);
      const textValue = String(body.text || '');
      if (processSessions.has(session)) {
        writeProcessInput(session, textValue, body.enter !== false);
        json(res, 200, { ok: true });
        return;
      }
      const parts = textValue.split('\n');
      for (let i = 0; i < parts.length; i += 1) {
        if (parts[i]) run('tmux', ['send-keys', '-t', session, '-l', parts[i]]);
        if (i < parts.length - 1) run('tmux', ['send-keys', '-t', session, 'Enter']);
      }
      if (body.enter !== false) run('tmux', ['send-keys', '-t', session, 'Enter']);
      json(res, 200, { ok: true });
      return;
    }

    if (req.method === 'POST' && url.pathname === '/key') {
      const body = await readBody(req);
      const session = cleanSession(body.session);
      const key = String(body.key || '');
      if (!allowedKeys.has(key)) {
        text(res, 400, `Unsupported key: ${key}`);
        return;
      }
      if (processSessions.has(session)) {
        writeProcessKey(session, key);
        json(res, 200, { ok: true });
        return;
      }
      if (!tmuxAvailable) throw new Error(`session is not running: ${session}`);
      const tmuxKey = key === 'Enter' ? 'Enter' : key;
      run('tmux', ['send-keys', '-t', session, tmuxKey]);
      json(res, 200, { ok: true });
      return;
    }

    text(res, 404, 'Not found');
  } catch (error) {
    text(res, 500, error.message || String(error));
  }
}

const server = http.createServer((req, res) => {
  handle(req, res).catch(error => text(res, 500, error.message || String(error)));
});

server.on('upgrade', (req, socket) => {
  try {
    const url = new URL(req.url || '/', `http://${req.headers.host || '127.0.0.1'}`);
    if (url.pathname !== '/terminal') {
      socket.end('HTTP/1.1 404 Not Found\r\n\r\n');
      return;
    }
    attachTerminalSocket(socket, req);
  } catch (error) {
    socket.end(`HTTP/1.1 500 Internal Server Error\r\n\r\n${error.message || error}`);
  }
});

server.listen(port, '127.0.0.1', () => {
  console.log(`sigil-agent-terminal bridge listening on http://127.0.0.1:${port} (${activeDriver()})`);
});
