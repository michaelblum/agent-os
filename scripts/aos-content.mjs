#!/usr/bin/env node

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { guardAgentOSWorktreeDefaultRuntime, guardedLiveOperation, runtimeFailurePayload } from './lib/aos-live-operation.mjs';

function prettyError(message, code) {
  process.stderr.write(`{\n  "code" : "${code}",\n  "error" : "${message}"\n}\n`);
  process.exit(1);
}

function prettyFailure(payload) {
  process.stderr.write(`${JSON.stringify(payload, null, 2)}\n`);
  process.exit(1);
}

function unknownArg(arg) {
  const text = String(arg);
  if (text.startsWith('-')) prettyError(`Unknown flag: ${text}`, 'UNKNOWN_FLAG');
  prettyError(`Unknown argument: ${text}`, 'UNKNOWN_ARG');
}

function stateRoot() {
  if (process.env.AOS_STATE_ROOT) return path.resolve(process.env.AOS_STATE_ROOT);
  return path.join(os.homedir(), '.config', 'aos');
}

function runtimeMode() {
  const override = process.env.AOS_RUNTIME_MODE?.toLowerCase();
  return override === 'installed' ? 'installed' : 'repo';
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

function parseDuration(value) {
  if (value === 'none') return Number.POSITIVE_INFINITY;
  const lower = value.toLowerCase();
  const unit = lower.match(/^([0-9]+(?:\.[0-9]+)?)([smh])$/);
  if (unit) {
    const number = Number(unit[1]);
    if (unit[2] === 's') return number;
    if (unit[2] === 'm') return number * 60;
    if (unit[2] === 'h') return number * 3600;
  }
  const raw = Number(lower);
  if (Number.isFinite(raw)) return raw;
  prettyError(`Invalid duration: ${value}. Use format like 5s, 10m, 1h, or 'none'.`, 'INVALID_DURATION');
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

async function connectWithAutoStart(autoStart) {
  let socket = await connectOnce();
  if (socket) return socket;
  if (!autoStart) return null;
  if (process.env.AOS_DISABLE_DAEMON_AUTOSTART && ['1', 'true', 'yes', 'on'].includes(process.env.AOS_DISABLE_DAEMON_AUTOSTART.toLowerCase())) {
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
    stdio: ['ignore', 'ignore', 'ignore'],
    env: process.env,
  });
  child.unref();
}

function sendEnvelope(socket, service, action, data = {}) {
  return new Promise((resolve) => {
    let buffer = '';
    let settled = false;
    const cleanup = () => {
      clearTimeout(timer);
      socket.off('data', onData);
      socket.off('error', onError);
    };
    const finish = (value) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(value);
    };
    const timer = setTimeout(() => {
      socket.destroy();
      finish(null);
    }, 3000);
    const onData = (chunk) => {
      buffer += chunk.toString('utf8');
      const newline = buffer.indexOf('\n');
      if (newline < 0) return;
      const line = buffer.slice(0, newline);
      try {
        finish(JSON.parse(line));
      } catch {
        finish(null);
      }
    };
    const onError = () => finish(null);
    socket.on('data', onData);
    socket.once('error', onError);
    socket.write(`${JSON.stringify({ v: 1, service, action, data })}\n`, (error) => {
      if (error) finish(null);
    });
  });
}

function unwrapResponse(raw) {
  return raw?.data ?? raw;
}

function contentReady(response, requiredRoots) {
  const port = Number(response?.port ?? 0);
  if (!(port > 0)) return false;
  const roots = response?.roots ?? {};
  return requiredRoots.every((root) => roots[root] != null);
}

function printStatus(response, json) {
  if (json) {
    process.stdout.write(`${JSON.stringify(response, null, 2)}\n`);
    return;
  }
  const port = Number(response?.port ?? 0);
  const roots = response?.roots ?? {};
  if (port > 0) {
    process.stdout.write(`Content server: http://127.0.0.1:${port}/\n`);
    for (const [prefix, dir] of Object.entries(roots).sort(([a], [b]) => a.localeCompare(b))) {
      process.stdout.write(`  /${prefix}/ -> ${dir}\n`);
    }
  } else {
    process.stdout.write('Content server: not running (no roots configured)\n');
  }
}

async function statusCommand(args) {
  const json = args.includes('--json');
  for (const arg of args) {
    if (arg !== '--json') unknownArg(arg);
  }
  const socket = await connectWithAutoStart(false);
  if (!socket) prettyError("Cannot connect to daemon — is 'aos serve' running?", 'NO_DAEMON');
  const response = unwrapResponse(await sendEnvelope(socket, 'content', 'status', {}));
  socket.end();
  printStatus(response, json);
}

function parseWaitArgs(args) {
  const options = { roots: [], timeoutMs: 10000, autoStart: false, allowStart: false, json: false };
  for (let i = 0; i < args.length;) {
    const arg = args[i];
    if (arg === '--root') {
      i += 1;
      if (i >= args.length || args[i].startsWith('--')) prettyError('--root requires a value', 'MISSING_ARG');
      options.roots.push(args[i]);
    } else if (arg === '--timeout') {
      i += 1;
      if (i >= args.length || args[i].startsWith('--')) prettyError('--timeout requires a duration', 'MISSING_ARG');
      const seconds = parseDuration(args[i]);
      if (!Number.isFinite(seconds) || seconds <= 0) prettyError('--timeout must be a positive finite duration', 'INVALID_ARG');
      options.timeoutMs = Math.floor(seconds * 1000);
    } else if (arg === '--auto-start') {
      options.autoStart = true;
    } else if (arg === '--allow-start') {
      options.allowStart = true;
    } else if (arg === '--json') {
      options.json = true;
    } else {
      unknownArg(arg);
    }
    i += 1;
  }
  return options;
}

async function waitCommand(args) {
  const options = parseWaitArgs(args);
  const worktreeGuard = guardAgentOSWorktreeDefaultRuntime({ operationId: 'content.wait', mode: runtimeMode() });
  if (!worktreeGuard.ok) prettyFailure(worktreeGuard.failure);
  const permitStart = Boolean(options.autoStart && (options.allowStart || process.env.AOS_ALLOW_DAEMON_AUTOSTART === '1'));
  if (options.autoStart && !permitStart) {
    const guarded = guardedLiveOperation({ operationId: 'content.wait', allowStart: false, mode: runtimeMode(), prefix: aosPath() });
    prettyFailure(runtimeFailurePayload({
      operationId: 'content.wait',
      condition: { roots: options.roots, auto_start_requested: true, allow_start: false },
      timeoutMs: options.timeoutMs,
      verdict: guarded.preflight,
      prefix: aosPath(),
      code: 'LIVE_START_NOT_ALLOWED',
      error: '--auto-start requires explicit --allow-start for content wait.',
    }));
  }
  const socket = await connectWithAutoStart(permitStart);
  if (!socket) {
    if (options.json) {
      const guarded = guardedLiveOperation({ operationId: 'content.wait', allowStart: false, mode: runtimeMode(), prefix: aosPath() });
      prettyFailure(runtimeFailurePayload({
        operationId: 'content.wait',
        condition: { roots: options.roots, auto_start_allowed: permitStart },
        timeoutMs: options.timeoutMs,
        verdict: guarded.preflight,
        prefix: aosPath(),
        code: permitStart ? 'CONNECT_ERROR' : 'NO_DAEMON',
        error: permitStart ? 'Cannot connect to daemon after allowed auto-start.' : 'Cannot connect to daemon; auto-start is not allowed.',
      }));
    }
    prettyError("Cannot connect to daemon — is 'aos serve' running?", permitStart ? 'CONNECT_ERROR' : 'NO_DAEMON');
  }
  const deadline = Date.now() + options.timeoutMs;
  while (Date.now() < deadline) {
    const response = unwrapResponse(await sendEnvelope(socket, 'content', 'status', {}));
    if (contentReady(response, options.roots)) {
      socket.end();
      response.status = 'success';
      response.ready = true;
      if (options.json) {
        process.stdout.write(`${JSON.stringify(response, null, 2)}\n`);
      } else {
        const url = `http://127.0.0.1:${response.port}/`;
        if (options.roots.length === 0) process.stdout.write(`ready ${url}\n`);
        else process.stdout.write(`ready ${url} roots=${options.roots.join(',')}\n`);
      }
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  socket.end();
  const rootsText = options.roots.length === 0 ? 'content server' : `content roots ${options.roots.join(', ')}`;
  if (options.json) {
    const guarded = guardedLiveOperation({ operationId: 'content.wait', allowStart: false, mode: runtimeMode(), prefix: aosPath() });
    prettyFailure(runtimeFailurePayload({
      operationId: 'content.wait',
      condition: { roots: options.roots, missing_roots: options.roots },
      timeoutMs: options.timeoutMs,
      verdict: guarded.preflight,
      prefix: aosPath(),
      code: 'CONTENT_WAIT_TIMEOUT',
      error: `${rootsText} did not become ready before timeout`,
    }));
  }
  prettyError(`${rootsText} did not become ready before timeout`, 'CONTENT_WAIT_TIMEOUT');
}

const [subcommand, ...rest] = process.argv.slice(2);
if (subcommand === 'status') await statusCommand(rest);
else if (subcommand === 'wait') await waitCommand(rest);
else if (!subcommand) {
  process.stdout.write('Usage: aos content <status|wait> ...\n');
} else {
  prettyError(`Unknown content command: ${subcommand}`, 'UNKNOWN_COMMAND');
}
