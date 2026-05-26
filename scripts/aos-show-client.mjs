#!/usr/bin/env node

import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';

const ORIGINAL_PARENT_PID = process.ppid;
const WINDOW_LEVELS = new Set(['automatic', 'floating', 'status_bar', 'screen_saver']);
const AUTO_PROJECT_MODES = new Set(['cursor_trail', 'highlight_focused', 'label_elements']);

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

function socketPath() {
  return path.join(stateRoot(), runtimeMode(), 'sock');
}

function daemonLogPath() {
  return path.join(stateRoot(), runtimeMode(), 'daemon.log');
}

function aosPath() {
  return process.env.AOS_PATH || path.join(process.cwd(), 'aos');
}

function sessionHarness() {
  if (process.env.AOS_SESSION_HARNESS) return process.env.AOS_SESSION_HARNESS;
  if (process.env.CODEX_THREAD_ID) return 'codex';
  if (process.env.CLAUDE_CODE_SSE_PORT) return 'claude-code';
  return 'unknown';
}

function sanitizeSessionComponent(value) {
  return String(value).replace(/[^A-Za-z0-9._-]/g, '_');
}

function sessionKey() {
  if (process.env.AOS_SESSION_KEY) return sanitizeSessionComponent(process.env.AOS_SESSION_KEY);
  if (process.env.AOS_SESSION_ID) return sanitizeSessionComponent(process.env.AOS_SESSION_ID);
  if (process.env.CODEX_THREAD_ID) return sanitizeSessionComponent(`codex-${process.env.CODEX_THREAD_ID}`);
  if (process.env.AOS_SESSION_NAME) return sanitizeSessionComponent(`name-${process.env.AOS_SESSION_NAME}`);
  if (process.env.CLAUDE_CODE_SSE_PORT) return sanitizeSessionComponent(`claude-port-${process.env.CLAUDE_CODE_SSE_PORT}`);
  return sanitizeSessionComponent(`pid-${process.pid}`);
}

function repoRootFrom(startDir) {
  try {
    const result = spawnSync('/usr/bin/git', ['rev-parse', '--show-toplevel'], {
      cwd: startDir,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    if (result.status === 0) {
      const root = result.stdout.trim();
      if (root) return root;
    }
  } catch {
    return null;
  }
  return null;
}

function currentOwner() {
  const cwd = process.cwd();
  return {
    consumer_id: sessionKey(),
    harness: sessionHarness(),
    pid: process.pid,
    cwd,
    worktree_root: repoRootFrom(cwd),
    runtime_mode: runtimeMode(),
  };
}

function autoStartDisabled() {
  return ['1', 'true', 'yes', 'on'].includes(process.env.AOS_DISABLE_DAEMON_AUTOSTART?.toLowerCase());
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

function startDaemon({ managed = false } = {}) {
  if (process.env.AOS_STATE_ROOT) {
    process.stderr.write('ipc: starting isolated daemon with explicit AOS_STATE_ROOT...\n');
    fs.mkdirSync(path.dirname(daemonLogPath()), { recursive: true });
    const log = fs.openSync(daemonLogPath(), 'a');
    const child = spawn(aosPath(), ['serve', '--idle-timeout', '5m'], {
      detached: !managed,
      stdio: ['ignore', 'ignore', log],
      env: process.env,
    });
    if (!managed) child.unref();
    return managed ? child : null;
  }

  process.stderr.write(`ipc: starting ${runtimeMode()} daemon via launchd service...\n`);
  const child = spawn(aosPath(), ['service', 'start', '--mode', runtimeMode(), '--json'], {
    detached: true,
    stdio: ['ignore', 'ignore', 'ignore'],
    env: process.env,
  });
  child.unref();
  return null;
}

async function connectWithAutoStart(options = {}) {
  let socket = await connectOnce();
  if (socket) return { socket, daemon: null };
  if (autoStartDisabled()) {
    process.stderr.write('ipc: daemon auto-start disabled by AOS_DISABLE_DAEMON_AUTOSTART\n');
    return null;
  }
  const daemon = startDaemon(options);
  for (let i = 0; i < 30; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 100));
    socket = await connectOnce();
    if (socket) return { socket, daemon };
  }
  if (daemon && !daemon.killed) daemon.kill('SIGTERM');
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

async function sendEnvelope(socket, action, data = {}, timeoutMs = 3000) {
  socket.write(`${JSON.stringify({ v: 1, service: 'show', action, data })}\n`);
  return readOneJSON(socket, timeoutMs);
}

async function oneShot(action, data, { autoStart = false, emptyListOnNoDaemon = false } = {}) {
  const connection = autoStart ? await connectWithAutoStart() : { socket: await connectOnce() };
  const socket = connection?.socket ?? null;
  if (!socket) {
    if (emptyListOnNoDaemon) {
      process.stdout.write('{"status":"success","canvases":[]}\n');
      return;
    }
    error(action === 'remove' || action === 'remove_all' ? 'Daemon not running. Nothing to remove.' : 'Daemon not running.', 'NO_DAEMON');
  }
  const response = await sendEnvelope(socket, action, data);
  socket.end();
  if (!response) error('IPC failure', 'INTERNAL');
  if (response.error) {
    process.stderr.write(`${JSON.stringify(response)}\n`);
    process.exit(1);
  }
  process.stdout.write(`${JSON.stringify(legacyCanvasResponse(response))}\n`);
}

function legacyCanvasResponse(response) {
  const body = response?.data && typeof response.data === 'object' ? response.data : response;
  const out = {};
  if (body.status !== undefined) out.status = body.status;
  else if (response?.status !== undefined) out.status = response.status;
  if (body.error !== undefined) out.error = body.error;
  if (body.code !== undefined) out.code = body.code;
  if (body.canvases !== undefined) out.canvases = body.canvases;
  if (body.result !== undefined) out.result = body.result;
  if (body.uptime !== undefined) out.uptime = body.uptime;
  for (const [key, value] of Object.entries(body || {})) {
    if (!(key in out) && !['v', 'data'].includes(key)) out[key] = value;
  }
  return out;
}

function parseDurationMs(value, flagName) {
  const match = String(value).match(/^([0-9]+(?:\.[0-9]+)?)(ms|s|m)?$/);
  if (!match) error(`${flagName} must be a positive finite duration`, 'INVALID_ARG');
  const number = Number(match[1]);
  if (!Number.isFinite(number) || number <= 0) error(`${flagName} must be a positive finite duration`, 'INVALID_ARG');
  const unit = match[2] || 's';
  if (unit === 'ms') return Math.trunc(number);
  if (unit === 's') return Math.trunc(number * 1000);
  if (unit === 'm') return Math.trunc(number * 60000);
  error(`${flagName} must be a positive finite duration`, 'INVALID_ARG');
}

function parseDurationSeconds(value) {
  const text = String(value).toLowerCase();
  if (text === 'none') return Infinity;
  const match = text.match(/^([0-9]+(?:\.[0-9]+)?)(s|m|h)?$/);
  if (!match) error(`Invalid duration: ${value}. Use format like 5s, 10m, 1h, or 'none'.`, 'INVALID_DURATION');
  const number = Number(match[1]);
  if (!Number.isFinite(number)) error(`Invalid duration: ${value}. Use format like 5s, 10m, 1h, or 'none'.`, 'INVALID_DURATION');
  const unit = match[2] || 's';
  if (unit === 's') return number;
  if (unit === 'm') return number * 60;
  if (unit === 'h') return number * 3600;
  error(`Invalid duration: ${value}. Use format like 5s, 10m, 1h, or 'none'.`, 'INVALID_DURATION');
}

function parseCanvasTTL(value, kind) {
  if (String(value).trim().toLowerCase() === 'none') {
    return kind === 'create' ? undefined : 0;
  }
  const seconds = parseDurationSeconds(value);
  if (!Number.isFinite(seconds)) error(`Invalid --ttl: ${value}. Use a finite duration or 'none'.`, 'INVALID_DURATION');
  if (seconds < 0) error(`Invalid --ttl: ${value}. Duration must be non-negative.`, 'INVALID_DURATION');
  return seconds;
}

function nextValue(args, index, flag) {
  const next = index + 1;
  if (next >= args.length || args[next].startsWith('--')) error(`${flag} requires a value`, 'MISSING_ARG');
  return [args[next], next];
}

function parseIDOnly(args, commandName) {
  let id;
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === '--id') {
      [id, i] = nextValue(args, i, '--id');
    } else {
      unknownArg(args[i]);
    }
  }
  if (!id) error(`${commandName} requires --id <name>`, 'MISSING_ARG');
  return id;
}

function parseIntValue(value, message) {
  if (!/^-?[0-9]+$/.test(String(value))) error(message, 'INVALID_ARG');
  return Number(value);
}

function parseQuad(value, invalidMessage) {
  const parts = String(value).split(',');
  if (parts.length !== 4) error(invalidMessage, 'INVALID_ARG');
  return parts.map((part) => {
    const number = Number(part);
    if (!Number.isFinite(number)) error(invalidMessage, 'INVALID_ARG');
    return number;
  });
}

function readStdinIfPiped() {
  try {
    if (fs.fstatSync(0).isFIFO() || fs.fstatSync(0).isFile()) {
      const data = fs.readFileSync(0);
      if (data.length > 0) return data.toString('utf8');
    }
  } catch {
    return null;
  }
  return null;
}

function resolveHTML(htmlValue, fileValue) {
  if (htmlValue !== undefined) return htmlValue;
  if (fileValue !== undefined) {
    try {
      return fs.readFileSync(fileValue, 'utf8');
    } catch {
      error(`Cannot read file: ${fileValue}`, 'FILE_NOT_FOUND');
    }
  }
  return readStdinIfPiped();
}

function parseCanvasMutationOptions(args, kind) {
  const options = {};
  for (let i = 0; i < args.length; i += 1) {
    switch (args[i]) {
      case '--id':
        [options.id, i] = nextValue(args, i, '--id');
        break;
      case '--at':
        [options.at, i] = nextValue(args, i, '--at');
        break;
      case '--anchor-window': {
        let value;
        [value, i] = nextValue(args, i, '--anchor-window');
        options.anchorWindow = parseIntValue(value, '--anchor-window requires an integer');
        break;
      }
      case '--anchor-channel':
        [options.anchorChannel, i] = nextValue(args, i, '--anchor-channel');
        break;
      case '--anchor-browser':
        [options.anchorBrowser, i] = nextValue(args, i, '--anchor-browser');
        break;
      case '--offset':
        [options.offset, i] = nextValue(args, i, '--offset');
        break;
      case '--html':
        [options.htmlValue, i] = nextValue(args, i, '--html');
        break;
      case '--file':
        [options.fileValue, i] = nextValue(args, i, '--file');
        break;
      case '--url':
        [options.urlValue, i] = nextValue(args, i, '--url');
        break;
      case '--interactive':
        options.interactive = true;
        break;
      case '--no-interactive':
        if (kind !== 'update') unknownArg(args[i]);
        options.interactive = false;
        break;
      case '--window-level':
        [options.windowLevel, i] = nextValue(args, i, '--window-level');
        if (!WINDOW_LEVELS.has(options.windowLevel)) {
          error(`Unknown --window-level: ${options.windowLevel}. Supported: ${[...WINDOW_LEVELS].join(', ')}`, 'INVALID_ARG');
        }
        break;
      case '--focus':
        options.focus = true;
        break;
      case '--no-focus':
        if (kind !== 'update') unknownArg(args[i]);
        options.focus = false;
        break;
      case '--ttl':
        [options.ttlValue, i] = nextValue(args, i, '--ttl');
        break;
      case '--scope': {
        if (kind !== 'create') unknownArg(args[i]);
        let value;
        [value, i] = nextValue(args, i, '--scope');
        if (!['connection', 'global'].includes(value)) error("--scope must be 'connection' or 'global'", 'INVALID_ARG');
        options.scope = value;
        break;
      }
      case '--auto-project':
        if (kind !== 'create') unknownArg(args[i]);
        [options.autoProject, i] = nextValue(args, i, '--auto-project');
        if (!AUTO_PROJECT_MODES.has(options.autoProject)) {
          error(`Unknown --auto-project mode: ${options.autoProject}. Supported: ${[...AUTO_PROJECT_MODES].join(', ')}`, 'INVALID_ARG');
        }
        break;
      case '--track': {
        let value;
        [value, i] = nextValue(args, i, '--track');
        if (value !== 'union') error(`Unknown --track target: ${value}. Supported: union`, 'INVALID_ARG');
        options.track = value;
        break;
      }
      case '--surface': {
        if (kind !== 'create') unknownArg(args[i]);
        let value;
        [value, i] = nextValue(args, i, '--surface');
        if (value !== 'desktop-world') error(`Unknown --surface target: ${value}. Supported: desktop-world`, 'INVALID_ARG');
        options.surface = value;
        break;
      }
      default:
        unknownArg(args[i]);
    }
  }
  return options;
}

function runResolveAnchor(spec) {
  const result = spawnSync(aosPath(), ['browser', '_resolve-anchor', spec, '--json'], {
    cwd: process.cwd(),
    env: process.env,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (result.status !== 0) {
    const errText = result.stderr.trim() || result.stdout.trim();
    try {
      const parsed = JSON.parse(errText);
      error(parsed.error || errText, parsed.code || 'INTERNAL');
    } catch {
      error(errText || 'Failed to resolve browser anchor', 'INTERNAL');
    }
  }
  try {
    return JSON.parse(result.stdout);
  } catch {
    error('Failed to decode browser anchor', 'INTERNAL');
  }
}

function applyCanvasMutationOptions(options, request, kind) {
  if (options.anchorBrowser !== undefined) {
    if (options.anchorWindow !== undefined || options.anchorChannel !== undefined) {
      error('--anchor-browser is mutually exclusive with --anchor-window and --anchor-channel', 'INVALID_ARG');
    }
    const anchor = runResolveAnchor(options.anchorBrowser);
    options.anchorWindow = anchor.anchor_window;
    options.offset = anchor.offset.join(',');
  }

  if (options.ttlValue !== undefined) {
    const ttl = parseCanvasTTL(options.ttlValue, kind);
    if (ttl !== undefined) request.ttl = ttl;
  }

  const exclusive = [
    ['--at', options.at !== undefined],
    ['--track', options.track !== undefined],
    ['--surface', options.surface !== undefined],
    ['--anchor-window', options.anchorWindow !== undefined],
    ['--anchor-channel', options.anchorChannel !== undefined],
  ].filter((entry) => entry[1]).map((entry) => entry[0]);
  if (exclusive.length > 1) error(`cannot combine ${exclusive.join(', ')} (pick one)`, 'INVALID_ARG');

  if (options.at !== undefined) request.at = parseQuad(options.at, kind === 'create' ? '--at must be x,y,w,h (comma-separated)' : '--at must be x,y,w,h');
  if (options.anchorWindow !== undefined) request.anchor_window = options.anchorWindow;
  if (options.anchorChannel !== undefined) request.anchor_channel = options.anchorChannel;
  if (options.offset !== undefined) request.offset = parseQuad(options.offset, kind === 'create' ? '--offset must be x,y,w,h (comma-separated)' : '--offset must be x,y,w,h');
  if (options.scope !== undefined) request.scope = options.scope;
  if (options.autoProject !== undefined) request.auto_project = options.autoProject;
  if (options.track !== undefined) request.track = options.track;
  if (options.surface !== undefined) request.surface = options.surface;
  if (options.windowLevel !== undefined) request.window_level = options.windowLevel;
  if (options.urlValue !== undefined) {
    request.url = options.urlValue;
  } else if (kind === 'create') {
    if (options.autoProject === undefined) {
      const html = resolveHTML(options.htmlValue, options.fileValue);
      if (html !== null && html !== undefined) request.html = html;
    }
  } else if (options.htmlValue !== undefined || options.fileValue !== undefined) {
    const html = resolveHTML(options.htmlValue, options.fileValue);
    if (html !== null && html !== undefined) request.html = html;
  }
}

async function mutationCommand(args, kind) {
  const options = parseCanvasMutationOptions(args, kind);
  if (!options.id) error(`${kind} requires --id <name>`, 'MISSING_ARG');
  const request = { id: options.id };
  if (kind === 'create') {
    request.interactive = options.interactive ?? false;
    if (options.focus === true) request.focus = true;
    request.owner = currentOwner();
  } else {
    if (options.interactive !== undefined) request.interactive = options.interactive;
    if (options.focus !== undefined) request.focus = options.focus;
  }
  applyCanvasMutationOptions(options, request, kind);
  await oneShot(kind, request, { autoStart: kind === 'create' });
}

async function waitCommand(args) {
  let id;
  let manifest;
  let js;
  let timeoutMs = 5000;
  let autoStart = false;
  let asJSON = false;

  for (let i = 0; i < args.length; i += 1) {
    switch (args[i]) {
      case '--id':
        [id, i] = nextValue(args, i, '--id');
        break;
      case '--manifest':
        [manifest, i] = nextValue(args, i, '--manifest');
        break;
      case '--js':
        [js, i] = nextValue(args, i, '--js');
        break;
      case '--timeout': {
        let value;
        [value, i] = nextValue(args, i, '--timeout');
        timeoutMs = parseDurationMs(value, '--timeout');
        break;
      }
      case '--auto-start':
        autoStart = true;
        break;
      case '--json':
        asJSON = true;
        break;
      default:
        unknownArg(args[i]);
    }
  }

  if (!id) error('wait requires --id <name>', 'MISSING_ARG');
  const connection = autoStart ? await connectWithAutoStart() : { socket: await connectOnce() };
  const socket = connection?.socket ?? null;
  if (!socket) error('Cannot connect to daemon', autoStart ? 'CONNECT_ERROR' : 'NO_DAEMON');

  let condition = "window.headsup && typeof window.headsup.receive === 'function'";
  if (manifest) condition += ` && window.headsup.manifest && window.headsup.manifest.name === ${JSON.stringify(manifest)}`;
  if (js) condition += ` && (${js})`;
  const evalJS = `(${condition}) ? 'ready' : 'wait'`;

  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const response = await sendEnvelope(socket, 'eval', { id, js: evalJS }, 1500);
    const body = response?.data && typeof response.data === 'object' ? response.data : response;
    if (body?.result === 'ready') {
      socket.end();
      if (asJSON) process.stdout.write(`${JSON.stringify({ status: 'success', ready: true, id }, null, 2)}\n`);
      else process.stdout.write('ready\n');
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  socket.end();
  error(`Canvas ${id} did not become ready before timeout`, 'CANVAS_WAIT_TIMEOUT');
}

async function evalCommand(args) {
  let id;
  let js;
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === '--id') [id, i] = nextValue(args, i, '--id');
    else if (args[i] === '--js') [js, i] = nextValue(args, i, '--js');
    else unknownArg(args[i]);
  }
  if (!id) error('eval requires --id <name>', 'MISSING_ARG');
  if (!js) error('eval requires --js <code>', 'MISSING_ARG');
  await oneShot('eval', { id, js });
}

async function postCommand(args) {
  let id;
  let event;
  let channel;
  let data;
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === '--id') [id, i] = nextValue(args, i, '--id');
    else if (args[i] === '--event') [event, i] = nextValue(args, i, '--event');
    else if (args[i] === '--channel') [channel, i] = nextValue(args, i, '--channel');
    else if (args[i] === '--data') [data, i] = nextValue(args, i, '--data');
    else unknownArg(args[i]);
  }
  if (event !== undefined && !id) error('post requires --id <name> when using --event', 'MISSING_ARG');
  if (id && event === undefined) error('post requires --event <json> when targeting a canvas', 'MISSING_ARG');
  if (!id && !channel) error('post requires --id <name> --event <json>', 'MISSING_ARG');
  if (id && channel) error('post accepts either canvas delivery (--id/--event) or legacy channel relay (--channel/--data), not both', 'INVALID_ARG');
  await oneShot('post', id ? { id, data: event } : { channel, data }, { autoStart: true });
}

async function listenCommand(args) {
  if (args.length > 0) unknownArg(args[0]);
  const connection = await connectWithAutoStart({ managed: true });
  const socket = connection?.socket ?? null;
  const daemon = connection?.daemon ?? null;
  if (!socket) error('Failed to start aos daemon', 'DAEMON_START_FAILED');

  let closing = false;
  const close = () => {
    if (closing) return;
    closing = true;
    socket.end();
    if (!daemon || daemon.killed) {
      process.exit(0);
    }
    let daemonExited = false;
    const exitAfterDaemon = () => process.exit(0);
    daemon.once('exit', () => {
      daemonExited = true;
      exitAfterDaemon();
    });
    daemon.kill('SIGTERM');
    setTimeout(() => {
      if (!daemonExited) daemon.kill('SIGKILL');
    }, 250).unref();
    setTimeout(exitAfterDaemon, 1000).unref();
  };
  process.once('SIGINT', close);
  process.once('SIGTERM', close);
  installParentExitWatchdog(close);

  socket.on('data', (chunk) => {
    process.stdout.write(chunk);
  });
  socket.once('close', close);
  socket.once('error', close);

  process.stdin.on('data', (chunk) => {
    socket.write(chunk);
  });
  process.stdin.once('end', close);

  socket.write(`${JSON.stringify({ action: 'subscribe' })}\n`);
}

function installParentExitWatchdog(close, intervalMs = 1000) {
  const timer = setInterval(() => {
    if (process.ppid !== ORIGINAL_PARENT_PID) close();
  }, intervalMs);
  timer.unref();
}

const [command, ...args] = process.argv.slice(2);
switch (command) {
  case 'create':
    await mutationCommand(args, 'create');
    break;
  case 'update':
    await mutationCommand(args, 'update');
    break;
  case 'list':
    if (args.some((arg) => arg !== '--json')) unknownArg(args.find((arg) => arg !== '--json'));
    await oneShot('list', {}, { emptyListOnNoDaemon: true });
    break;
  case 'ping':
    if (args.length > 0) unknownArg(args[0]);
    await oneShot('ping', {});
    break;
  case 'remove':
    await oneShot('remove', { id: parseIDOnly(args, 'remove') });
    break;
  case 'remove-all':
    if (args.length > 0) unknownArg(args[0]);
    await oneShot('remove_all', {});
    break;
  case 'eval':
    await evalCommand(args);
    break;
  case 'post':
    await postCommand(args);
    break;
  case 'to-front':
    await oneShot('to_front', { id: parseIDOnly(args, 'to-front') }, { autoStart: true });
    break;
  case 'wait':
    await waitCommand(args);
    break;
  case 'listen':
    await listenCommand(args);
    break;
  default:
    error(`Unknown show command: ${command ?? ''}`, 'UNKNOWN_COMMAND');
}
