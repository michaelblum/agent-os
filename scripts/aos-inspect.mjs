#!/usr/bin/env node

import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';

const INSPECTOR_CANVAS_ID = '__inspector__';
const INSPECTOR_URL = 'aos://toolkit/components/inspector-panel/index.html';

function error(message, code) {
  process.stderr.write(`{\n  "code" : ${JSON.stringify(code)},\n  "error" : ${JSON.stringify(message)}\n}\n`);
  process.exit(1);
}

function unknownArg(arg) {
  const text = String(arg);
  if (text.startsWith('-')) error(`Unknown flag: ${text}`, 'UNKNOWN_FLAG');
  error(`Unknown argument: ${text}`, 'UNKNOWN_ARG');
}

function stateRoot() {
  return path.resolve(process.env.AOS_STATE_ROOT || path.join(os.homedir(), '.config/aos'));
}

function runtimeMode() {
  return process.env.AOS_RUNTIME_MODE?.toLowerCase() === 'installed' ? 'installed' : 'repo';
}

function stateDir() {
  return path.join(stateRoot(), runtimeMode());
}

function socketPath() {
  return path.join(stateDir(), 'sock');
}

function daemonLogPath() {
  return path.join(stateDir(), 'daemon.log');
}

function aosPath() {
  return process.env.AOS_PATH || path.join(process.cwd(), 'aos');
}

function repoRoot() {
  return path.resolve(process.env.REPO_ROOT || process.cwd());
}

function autoStartDisabled() {
  return ['1', 'true', 'yes', 'on'].includes(process.env.AOS_DISABLE_DAEMON_AUTOSTART?.toLowerCase());
}

function parsePair(value, message) {
  const parts = String(value).split(',').map(Number);
  if (parts.length < 2 || parts.some((part) => !Number.isFinite(part))) error(message, 'INVALID_ARG');
  return parts;
}

function parseArgs(args) {
  const options = { width: 320, height: 250, x: null, y: null };
  for (let i = 0; i < args.length; i += 1) {
    switch (args[i]) {
      case '--at': {
        i += 1;
        if (i >= args.length || args[i].startsWith('--')) error('--at requires x,y[,w,h]', 'MISSING_ARG');
        const parts = parsePair(args[i], '--at requires x,y[,w,h]');
        options.x = parts[0];
        options.y = parts[1];
        if (parts.length >= 4) {
          options.width = parts[2];
          options.height = parts[3];
        }
        break;
      }
      case '--size': {
        i += 1;
        if (i >= args.length || args[i].startsWith('--')) error('--size requires w,h', 'MISSING_ARG');
        const parts = parsePair(args[i], '--size requires w,h');
        options.width = parts[0];
        options.height = parts[1];
        break;
      }
      default:
        unknownArg(args[i]);
    }
  }
  return options;
}

function checkPermissions() {
  if (process.env.AOS_BYPASS_PREFLIGHT === '1') return;
  if (process.env.AOS_BYPASS_PERMISSIONS_SETUP === '1') return;

  const result = spawnSync(aosPath(), ['permissions', 'check', '--json'], {
    cwd: repoRoot(),
    env: process.env,
    encoding: 'utf8',
  });
  if (result.status !== 0) {
    const detail = result.stderr.trim() || result.stdout.trim() || 'permissions check failed';
    error(detail, 'PERMISSIONS_CHECK_FAILED');
  }

  let parsed;
  try {
    parsed = JSON.parse(result.stdout);
  } catch {
    error('permissions check returned invalid JSON', 'PERMISSIONS_CHECK_FAILED');
  }

  if (!parsed?.setup?.setup_completed) {
    const missing = Array.isArray(parsed?.missing_permissions) ? parsed.missing_permissions : [];
    const details = missing.length === 0
      ? 'Permissions appear granted, but onboarding has not been completed for this runtime identity.'
      : `Missing permissions: ${missing.join(', ')}.`;
    const nextStep = parsed?.setup?.recommended_command || 'aos permissions setup --once';
    error(`aos inspect requires upfront permissions onboarding. ${details} Run '${nextStep}' before interactive testing.`, 'PERMISSIONS_SETUP_REQUIRED');
  }
}

function ensureContentRootConfigured(name, relativePath) {
  const result = spawnSync(aosPath(), ['set', `content.roots.${name}`, relativePath], {
    cwd: repoRoot(),
    env: process.env,
    encoding: 'utf8',
  });
  if (result.status !== 0) {
    const detail = result.stderr.trim() || result.stdout.trim() || `failed to configure content.roots.${name}`;
    error(detail, 'CONFIG_SET_FAILED');
  }
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

class SocketReader {
  constructor(socket) {
    this.socket = socket;
    this.buffer = '';
    this.waiters = [];
    socket.on('data', (chunk) => this.receive(chunk));
  }

  receive(chunk) {
    this.buffer += chunk.toString('utf8');
    while (true) {
      const newline = this.buffer.indexOf('\n');
      if (newline < 0) return;
      const line = this.buffer.slice(0, newline);
      this.buffer = this.buffer.slice(newline + 1);
      let parsed = null;
      try {
        parsed = JSON.parse(line);
      } catch {
        continue;
      }
      const waiter = this.waiters.shift();
      if (waiter) waiter(parsed);
      else this.onMessage?.(parsed);
    }
  }

  readOne(timeoutMs = 3000) {
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        const idx = this.waiters.indexOf(done);
        if (idx >= 0) this.waiters.splice(idx, 1);
        resolve(null);
      }, timeoutMs);
      const done = (message) => {
        clearTimeout(timer);
        resolve(message);
      };
      this.waiters.push(done);
    });
  }
}

async function sendEnvelope(socket, reader, service, action, data = {}, timeoutMs = 3000) {
  socket.write(`${JSON.stringify({ v: 1, service, action, data })}\n`);
  return reader.readOne(timeoutMs);
}

function body(response) {
  return response?.data && typeof response.data === 'object' ? response.data : response;
}

async function waitForCanvasBridge(socket, reader, canvasID, manifestName, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  const condition = `window.headsup && typeof window.headsup.receive === 'function' && window.headsup.manifest && window.headsup.manifest.name === ${JSON.stringify(manifestName)}`;
  const js = `(${condition}) ? 'ready' : 'wait'`;
  while (Date.now() < deadline) {
    const response = await sendEnvelope(socket, reader, 'show', 'eval', { id: canvasID, js }, 1500);
    if (body(response)?.result === 'ready') return true;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return false;
}

async function resolveDefaultPosition(width, height) {
  const result = spawnSync(aosPath(), ['graph', 'displays'], {
    cwd: repoRoot(),
    env: process.env,
    encoding: 'utf8',
  });
  if (result.status === 0) {
    try {
      const parsed = JSON.parse(result.stdout);
      const displays = body(parsed)?.displays || parsed.displays || [];
      const first = displays[0];
      const frame = first?.frame || first?.bounds || first;
      const displayWidth = Number(frame?.width ?? frame?.w);
      const displayHeight = Number(frame?.height ?? frame?.h);
      const displayX = Number(frame?.x ?? 0);
      const displayY = Number(frame?.y ?? 0);
      if (Number.isFinite(displayWidth) && Number.isFinite(displayHeight)) {
        return { x: displayX + displayWidth - width - 20, y: displayY + displayHeight - height - 20 };
      }
    } catch {
      // Fall through to a deterministic fallback.
    }
  }
  return { x: 960 - width - 20, y: 540 - height - 20 };
}

function postHeadsup(socket, canvasID, payload) {
  socket.write(`${JSON.stringify({
    v: 1,
    service: 'show',
    action: 'post',
    data: { id: canvasID, data: JSON.stringify(payload) },
  })}\n`);
}

const options = parseArgs(process.argv.slice(2));
checkPermissions();
ensureContentRootConfigured('toolkit', 'packages/toolkit');
if (options.x == null || options.y == null) {
  const position = await resolveDefaultPosition(options.width, options.height);
  options.x = position.x;
  options.y = position.y;
}

const socket = await connectWithAutoStart();
if (!socket) error("Cannot connect to daemon. Run 'aos serve' first.", 'CONNECT_ERROR');
const reader = new SocketReader(socket);
const close = () => {
  socket.end();
  process.exit(0);
};
process.once('SIGINT', close);
process.once('SIGTERM', close);
socket.once('close', () => process.exit(0));
socket.once('error', () => process.exit(0));

await sendEnvelope(socket, reader, 'show', 'create', {
  id: INSPECTOR_CANVAS_ID,
  at: [options.x, options.y, options.width, options.height],
  url: INSPECTOR_URL,
  scope: 'connection',
});

if (!await waitForCanvasBridge(socket, reader, INSPECTOR_CANVAS_ID, 'inspector-panel')) {
  error('Inspector panel did not finish mounting', 'CANVAS_LOAD_TIMEOUT');
}

await sendEnvelope(socket, reader, 'see', 'observe', { depth: 2, scope: 'cursor', rate: 'on-settle' });
process.stderr.write('Inspector active. Move cursor to inspect elements. Ctrl-C to stop.\n');

reader.onMessage = (message) => {
  if (message?.v !== 1 || typeof message.event !== 'string') return;
  if (message.event === 'element_focused') {
    postHeadsup(socket, INSPECTOR_CANVAS_ID, {
      type: 'inspector/element',
      payload: message.data || {},
    });
  } else if (message.event === 'cursor_moved' || message.event === 'cursor_settled') {
    const data = message.data || {};
    const x = Number(data.x);
    const y = Number(data.y);
    const display = Number(data.display);
    if (Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(display)) {
      postHeadsup(socket, INSPECTOR_CANVAS_ID, {
        type: 'inspector/cursor',
        payload: { x, y, display },
      });
    }
  }
};
