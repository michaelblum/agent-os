#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';

function error(message, code) {
  process.stderr.write(`${JSON.stringify({ code, error: message }, null, 2)}\n`);
  process.exit(1);
}

function unknownArg(arg) {
  error(`Unknown ${String(arg).startsWith('--') ? 'flag' : 'argument'}: ${arg}`, String(arg).startsWith('--') ? 'UNKNOWN_FLAG' : 'UNKNOWN_ARG');
}

function mode() {
  return process.env.AOS_RUNTIME_MODE === 'installed' ? 'installed' : 'repo';
}

function stateRoot() {
  return path.resolve(process.env.AOS_STATE_ROOT || path.join(os.homedir(), '.config/aos'));
}

function stateDir() {
  return path.join(stateRoot(), mode());
}

function socketPath() {
  return path.join(stateDir(), 'sock');
}

function aosPath() {
  return process.env.AOS_PATH || path.join(process.cwd(), 'aos');
}

function valueAfter(args, key) {
  const idx = args.indexOf(key);
  return idx >= 0 && idx + 1 < args.length ? args[idx + 1] : undefined;
}

function validateArgs(args, { valueFlags = [], booleanFlags = [] } = {}) {
  const values = new Set(valueFlags);
  const booleans = new Set(booleanFlags);
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg.startsWith('--')) {
      if (values.has(arg)) {
        i += 1;
        if (i >= args.length || args[i].startsWith('--')) error(`${arg} requires a value`, 'MISSING_ARG');
      } else if (!booleans.has(arg)) {
        unknownArg(arg);
      }
      continue;
    }
    unknownArg(arg);
  }
}

function numberAfter(args, key) {
  const value = valueAfter(args, key);
  if (value === undefined) return undefined;
  const parsed = Number(value);
  return Number.isInteger(parsed) ? parsed : undefined;
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
  const child = spawnSync(aosPath(), ['service', 'start', '--mode', mode(), '--json'], {
    encoding: 'utf8',
    env: process.env,
  });
  if (child.status !== 0 && child.stderr) process.stderr.write(child.stderr);
}

async function connectWithAutoStart(autoStart = true) {
  let socket = await connectOnce();
  if (socket || !autoStart) return socket;
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

async function request(service, action, data = {}, { autoStart = true, optional = false } = {}) {
  const socket = await connectWithAutoStart(autoStart);
  if (!socket) {
    if (optional) return null;
    error('Could not connect to daemon', 'DAEMON_UNAVAILABLE');
  }
  socket.write(`${JSON.stringify({ v: 1, service, action, data })}\n`);
  const response = await readOneJSON(socket);
  socket.end();
  if (!response) {
    if (optional) return null;
    error('Could not connect to daemon', 'DAEMON_UNAVAILABLE');
  }
  return response;
}

function emit(response) {
  if (response?.error) {
    process.stderr.write(`${JSON.stringify(response, null, 2)}\n`);
    process.exit(1);
  }
  process.stdout.write(`${JSON.stringify(response, null, 2)}\n`);
}

function subtreeFromArgs(args) {
  const subtree = {};
  const role = valueAfter(args, '--subtree-role');
  const title = valueAfter(args, '--subtree-title');
  const identifier = valueAfter(args, '--subtree-identifier');
  if (role) subtree.role = role;
  if (title) subtree.title = title;
  if (identifier) subtree.identifier = identifier;
  return Object.keys(subtree).length > 0 ? subtree : undefined;
}

function registryPath() {
  const dir = path.join(stateDir(), 'browser');
  fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, 'sessions.json');
}

function readRegistry() {
  const file = registryPath();
  if (!fs.existsSync(file)) return [];
  const raw = fs.readFileSync(file, 'utf8').trim();
  if (!raw) return [];
  return JSON.parse(raw);
}

function writeRegistry(records) {
  fs.writeFileSync(registryPath(), `${JSON.stringify(records, null, 2)}\n`);
}

function runPlaywright(session, verb, args = []) {
  const result = spawnSync('playwright-cli', [`-s=${session}`, verb, ...args], {
    encoding: 'utf8',
    env: process.env,
  });
  return {
    status: result.status ?? 1,
    stdout: (result.stdout || '').trim(),
    stderr: (result.stderr || '').trim(),
    error: result.error,
  };
}

function requirePlaywrightSuccess(result, action) {
  if (result.error) error(`${action} failed: ${result.error.message}`, 'PLAYWRIGHT_CLI_NOT_FOUND');
  if (result.status !== 0) error(`${action} failed: ${result.stderr || result.stdout}`, 'PLAYWRIGHT_CLI_FAILED');
  if (result.stdout.includes('### Error')) error(`${action} failed: ${result.stdout}`, 'PLAYWRIGHT_CLI_FAILED');
}

function browserWindowID() {
  const injected = process.env.AOS_TEST_BROWSER_WINDOW_ID;
  if (injected && /^-?\d+$/.test(injected)) return Number(injected);
  return null;
}

function addRegistryRecord(record) {
  const records = readRegistry();
  if (records.some((item) => item.id === record.id)) error(`focus channel '${record.id}' already exists`, 'DUPLICATE_ID');
  records.push(record);
  writeRegistry(records);
}

function removeRegistryRecord(id) {
  const records = readRegistry();
  if (!records.some((item) => item.id === id)) error(`focus channel '${id}' not found`, 'NOT_FOUND');
  writeRegistry(records.filter((item) => item.id !== id));
}

function makeBrowserEntry(record) {
  return {
    kind: 'browser',
    id: record.id,
    session: record.id,
    mode: record.mode,
    updated_at: record.updated_at,
    attach: record.attach_kind ?? null,
    headless: record.headless ?? null,
    browser_window_id: record.browser_window_id ?? null,
    active_url: record.active_url ?? null,
  };
}

async function focusCreate(args) {
  validateArgs(args, {
    valueFlags: ['--id', '--target', '--window', '--pid', '--depth', '--subtree-role', '--subtree-title', '--subtree-identifier', '--cdp', '--url'],
    booleanFlags: ['--extension', '--headless', '--persistent'],
  });
  const id = valueAfter(args, '--id');
  if (!id) error('--id is required', 'MISSING_ARG');
  const target = valueAfter(args, '--target');
  const windowID = numberAfter(args, '--window');
  if (target && windowID !== undefined) error('--target and --window are mutually exclusive', 'INVALID_ARG');
  if (target) {
    const url = new URL(target);
    if (url.protocol !== 'browser:' || !['attach', 'new'].includes(url.hostname)) {
      error('invalid --target; expected browser://attach or browser://new', 'INVALID_ARG');
    }
    if (url.hostname === 'attach') {
      let attachKind = 'extension';
      const cdp = valueAfter(args, '--cdp');
      const pwArgs = cdp ? [`--cdp=${cdp}`] : ['--extension'];
      if (cdp) attachKind = 'cdp';
      const result = runPlaywright(id, 'attach', pwArgs);
      requirePlaywrightSuccess(result, 'playwright attach');
      addRegistryRecord({
        id,
        mode: 'attach',
        attach_kind: attachKind,
        headless: null,
        browser_window_id: browserWindowID(),
        active_url: null,
        updated_at: new Date().toISOString(),
      });
      process.stdout.write(`${JSON.stringify({ status: 'success', id, mode: 'attach', attach: attachKind })}\n`);
      return;
    }
    const headless = args.includes('--headless');
    const pwArgs = [];
    if (!headless) pwArgs.push('--headed');
    const pageURL = valueAfter(args, '--url');
    if (pageURL) pwArgs.push(pageURL);
    if (args.includes('--persistent')) pwArgs.push('--persistent');
    const result = runPlaywright(id, 'open', pwArgs);
    requirePlaywrightSuccess(result, 'playwright open');
    addRegistryRecord({
      id,
      mode: 'launched',
      attach_kind: null,
      headless,
      browser_window_id: browserWindowID(),
      active_url: null,
      updated_at: new Date().toISOString(),
    });
    process.stdout.write(`${JSON.stringify({ status: 'success', id, mode: 'launched', headless })}\n`);
    return;
  }
  if (windowID === undefined) error('--window <id> is required', 'MISSING_ARG');
  const data = { id, window_id: windowID };
  const pid = numberAfter(args, '--pid');
  const depth = numberAfter(args, '--depth');
  const subtree = subtreeFromArgs(args);
  if (pid !== undefined) data.pid = pid;
  if (depth !== undefined) data.depth = depth;
  if (subtree) data.subtree = subtree;
  emit(await request('focus', 'create', data));
}

async function focusCommand(args) {
  const sub = args[0];
  if (!sub) error('Missing focus subcommand', 'MISSING_SUBCOMMAND');
  const rest = args.slice(1);
  switch (sub) {
    case 'create':
      await focusCreate(rest);
      return;
    case 'update': {
      validateArgs(rest, {
        valueFlags: ['--id', '--depth', '--subtree-role', '--subtree-title', '--subtree-identifier'],
      });
      const id = valueAfter(rest, '--id');
      if (!id) error('--id is required', 'MISSING_ARG');
      const data = { id };
      const depth = numberAfter(rest, '--depth');
      const subtree = subtreeFromArgs(rest);
      if (depth !== undefined) data.depth = depth;
      if (subtree) data.subtree = subtree;
      emit(await request('focus', 'update', data));
      return;
    }
    case 'list': {
      validateArgs(rest);
      const response = await request('focus', 'list', {}, { autoStart: false, optional: true });
      const channels = response?.error ? [] : response?.channels ?? response?.data?.channels ?? [];
      emit({
        status: 'ok',
        channels: [
          ...channels.map((entry) => ({ ...entry, kind: 'window' })),
          ...readRegistry().map(makeBrowserEntry),
        ],
      });
      return;
    }
    case 'remove': {
      validateArgs(rest, { valueFlags: ['--id'] });
      const id = valueAfter(rest, '--id');
      if (!id) error('--id is required', 'MISSING_ARG');
      const record = readRegistry().find((item) => item.id === id);
      if (record) {
        if (record.mode === 'launched') runPlaywright(id, 'close', []);
        removeRegistryRecord(id);
        process.stdout.write('{"status":"ok"}\n');
        return;
      }
      emit(await request('focus', 'remove', { id }));
      return;
    }
    default:
      error(`Unknown focus subcommand: ${sub}`, 'UNKNOWN_COMMAND');
  }
}

async function graphCommand(args) {
  const sub = args[0];
  if (!sub) error('Missing graph subcommand', 'MISSING_SUBCOMMAND');
  const rest = args.slice(1);
  switch (sub) {
    case 'displays':
      validateArgs(rest);
      emit(await request('graph', 'displays', {}));
      return;
    case 'windows': {
      validateArgs(rest, { valueFlags: ['--display'] });
      const data = {};
      const display = numberAfter(rest, '--display');
      if (display !== undefined) data.display = display;
      emit(await request('graph', 'windows', data));
      return;
    }
    case 'deepen':
    case 'collapse': {
      validateArgs(rest, {
        valueFlags: sub === 'deepen'
          ? ['--id', '--depth', '--subtree-role', '--subtree-title', '--subtree-identifier']
          : ['--id', '--depth'],
      });
      const id = valueAfter(rest, '--id');
      if (!id) error('--id is required', 'MISSING_ARG');
      const data = { id };
      const depth = numberAfter(rest, '--depth');
      const subtree = subtreeFromArgs(rest);
      if (depth !== undefined) data.depth = depth;
      if (subtree && sub === 'deepen') data.subtree = subtree;
      emit(await request('graph', sub, data));
      return;
    }
    default:
      error(`Unknown graph subcommand: ${sub}`, 'UNKNOWN_COMMAND');
  }
}

const [command, ...args] = process.argv.slice(2);
if (command === 'focus') await focusCommand(args);
else if (command === 'graph') await graphCommand(args);
else if (command === 'daemon-snapshot') emit(await request('see', 'snapshot', {}));
else error(`Unknown focus/graph command: ${command ?? ''}`, 'UNKNOWN_COMMAND');
