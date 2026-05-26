#!/usr/bin/env node

import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';

const LOG_CANVAS_ID = '__log__';
const LOG_URL = 'aos://toolkit/components/log-console/index.html';

function error(message, code) {
  process.stderr.write(`${JSON.stringify({ code, error: message })}\n`);
  process.exit(1);
}

function unknownArg(arg) {
  error(`Unknown ${String(arg).startsWith('--') ? 'flag' : 'argument'}: ${arg}`, String(arg).startsWith('--') ? 'UNKNOWN_FLAG' : 'UNKNOWN_ARG');
}

function stateRoot() {
  return path.resolve(process.env.AOS_STATE_ROOT || path.join(os.homedir(), '.config/aos'));
}

function runtimeMode() {
  return process.env.AOS_RUNTIME_MODE?.toLowerCase() === 'installed' ? 'installed' : 'repo';
}

function socketPath() {
  return path.join(stateRoot(), runtimeMode(), 'sock');
}

function daemonLogPath() {
  return path.join(stateRoot(), runtimeMode(), 'daemon.log');
}

function aosPath() {
  return process.env.AOS_PATH || path.join(process.cwd(), 'aos');
}

function autoStartDisabled() {
  return ['1', 'true', 'yes', 'on'].includes(process.env.AOS_DISABLE_DAEMON_AUTOSTART?.toLowerCase());
}

function configureToolkitRoot() {
  spawnSync(aosPath(), ['set', 'content.roots.toolkit', 'packages/toolkit'], {
    encoding: 'utf8',
    env: process.env,
  });
}

function parseOptions(args) {
  const options = { level: 'info', at: null, message: [] };
  for (let i = 0; i < args.length; i += 1) {
    switch (args[i]) {
      case '--at':
        i += 1;
        if (i >= args.length) error('--at requires x,y,w,h', 'MISSING_ARG');
        options.at = parseAt(args[i]);
        break;
      case '--level':
        i += 1;
        if (i >= args.length) error('--level requires a value', 'MISSING_ARG');
        options.level = args[i];
        break;
      default:
        if (args[i].startsWith('--')) unknownArg(args[i]);
        options.message.push(args[i]);
    }
  }
  return options;
}

function parseAt(value) {
  const parts = value.split(',').map((part) => Number(part));
  if (parts.length < 4 || parts.slice(0, 4).some((part) => !Number.isFinite(part))) {
    error('--at must be x,y,w,h (comma-separated)', 'INVALID_ARG');
  }
  return parts.slice(0, 4);
}

function defaultAt() {
  const width = 450;
  const height = 300;
  const result = spawnSync(aosPath(), ['runtime', 'display-union'], {
    encoding: 'utf8',
    env: process.env,
  });
  const parts = (result.stdout || '').trim().split(',').map((part) => Number(part));
  if (result.status === 0 && parts.length === 4 && parts.every((part) => Number.isFinite(part))) {
    return [20, parts[1] + parts[3] - height - 20, width, height];
  }
  return [20, 20, width, height];
}

function connectOnce(timeoutMs = 1000) {
  return new Promise((resolve) => {
    const socket = net.createConnection(socketPath());
    const timer = setTimeout(() => {
      socket.destroy();
      resolve(null);
    }, timeoutMs);
    socket.once('connect', () => {
      clearTimeout(timer);
      resolve(socket);
    });
    socket.once('error', () => {
      clearTimeout(timer);
      socket.destroy();
      resolve(null);
    });
  });
}

function startDaemon() {
  if (process.env.AOS_STATE_ROOT) {
    process.stderr.write('ipc: starting isolated daemon with explicit AOS_STATE_ROOT...\n');
    fs.mkdirSync(path.dirname(daemonLogPath()), { recursive: true });
    const log = fs.openSync(daemonLogPath(), 'a');
    const child = spawn(aosPath(), ['serve', '--idle-timeout', '5m'], {
      detached: true,
      stdio: ['ignore', 'ignore', log],
      env: process.env,
    });
    child.unref();
    return;
  }

  process.stderr.write(`ipc: starting ${runtimeMode()} daemon via launchd service...\n`);
  const child = spawn(aosPath(), ['service', 'start', '--mode', runtimeMode(), '--json'], {
    detached: true,
    stdio: ['ignore', 'ignore', 'ignore'],
    env: process.env,
  });
  child.unref();
}

async function connectWithAutoStart() {
  let socket = await connectOnce();
  if (socket) return socket;
  if (autoStartDisabled()) {
    process.stderr.write('ipc: daemon auto-start disabled by AOS_DISABLE_DAEMON_AUTOSTART\n');
    return null;
  }
  startDaemon();
  for (let i = 0; i < 30; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 100));
    socket = await connectOnce();
    if (socket) return socket;
  }
  return null;
}

function readOneJSON(socket, timeoutMs = 3000) {
  return new Promise((resolve) => {
    let buffer = '';
    const timer = setTimeout(() => {
      socket.destroy();
      resolve(null);
    }, timeoutMs);
    socket.on('data', (chunk) => {
      buffer += chunk.toString('utf8');
      const newline = buffer.indexOf('\n');
      if (newline < 0) return;
      clearTimeout(timer);
      try {
        resolve(JSON.parse(buffer.slice(0, newline)));
      } catch {
        resolve(null);
      }
    });
    socket.once('error', () => {
      clearTimeout(timer);
      resolve(null);
    });
  });
}

async function sendEnvelope(socket, service, action, data = {}, timeoutMs = 3000) {
  socket.write(`${JSON.stringify({ v: 1, service, action, data })}\n`);
  return readOneJSON(socket, timeoutMs);
}

function postPayload(message, level) {
  return {
    type: 'log/append',
    payload: { text: message, level },
  };
}

async function postLogEntry(socket, message, level) {
  const data = JSON.stringify(postPayload(message, level));
  return sendEnvelope(socket, 'show', 'post', { id: LOG_CANVAS_ID, data });
}

function sendLogEntry(socket, message, level) {
  const data = JSON.stringify({ v: 1, service: 'show', action: 'post', data: {
    id: LOG_CANVAS_ID,
    data: JSON.stringify(postPayload(message, level)),
  } });
  socket.write(`${data}\n`);
}

async function waitForBridge(socket, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  const js = "(window.headsup && typeof window.headsup.receive === 'function' && window.headsup.manifest && window.headsup.manifest.name === \"log-console\") ? 'ready' : 'wait'";
  while (Date.now() < deadline) {
    const response = await sendEnvelope(socket, 'show', 'eval', { id: LOG_CANVAS_ID, js }, 1500);
    const body = response?.data && typeof response.data === 'object' ? response.data : response;
    if (body?.result === 'ready') return true;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return false;
}

async function pushCommand(args) {
  const options = parseOptions(args);
  const message = options.message.join(' ').trim();
  if (!message) error('log push requires a message. Usage: aos log push "<message>" [--level <lvl>]', 'MISSING_ARG');
  const socket = await connectOnce();
  if (!socket) error('Daemon not running or no log console active', 'CONNECT_ERROR');
  await postLogEntry(socket, message, options.level);
  socket.end();
  process.stdout.write('{"status":"ok"}\n');
}

async function clearCommand(args) {
  const options = parseOptions(args);
  if (options.message.length > 0 || options.at) unknownArg(options.message[0] || '--at');
  const socket = await connectOnce();
  if (!socket) error('Daemon not running or no log console active', 'CONNECT_ERROR');
  await sendEnvelope(socket, 'show', 'post', { id: LOG_CANVAS_ID, data: JSON.stringify({ type: 'log/clear' }) });
  socket.end();
  process.stdout.write('{"status":"ok"}\n');
}

async function streamCommand(args) {
  const options = parseOptions(args);
  if (options.message.length > 0) unknownArg(options.message[0]);
  configureToolkitRoot();
  const socket = await connectWithAutoStart();
  if (!socket) error("Cannot connect to daemon. Run 'aos serve' first.", 'CONNECT_ERROR');
  const at = options.at || defaultAt();

  await sendEnvelope(socket, 'show', 'create', {
    id: LOG_CANVAS_ID,
    at,
    url: LOG_URL,
    scope: 'connection',
  });

  if (!await waitForBridge(socket)) {
    socket.end();
    error('Log console did not finish mounting', 'CANVAS_LOAD_TIMEOUT');
  }

  process.stderr.write('Log console active. Reading stdin. Ctrl-C to stop.\n');
  sendLogEntry(socket, 'Log console started', 'debug');

  const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
  for await (const line of rl) {
    if (!line) continue;
    if (line.startsWith('{')) {
      try {
        const parsed = JSON.parse(line);
        if (typeof parsed.message === 'string') {
          sendLogEntry(socket, parsed.message, parsed.level || options.level);
          continue;
        }
      } catch {
        // Fall through and log the original line.
      }
    }
    sendLogEntry(socket, line, options.level);
  }
  socket.end();
}

const [command, ...args] = process.argv.slice(2);
switch (command) {
  case 'push':
    await pushCommand(args);
    break;
  case 'clear':
    await clearCommand(args);
    break;
  case undefined:
    await streamCommand([]);
    break;
  default:
    await streamCommand([command, ...args]);
}
