#!/usr/bin/env node

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';

function error(message, code) {
  process.stderr.write(`${JSON.stringify({ code, error: message })}\n`);
  process.exit(1);
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

async function sendEnvelope(socket, action, data = {}, timeoutMs = 3000) {
  socket.write(`${JSON.stringify({ v: 1, service: 'show', action, data })}\n`);
  return readOneJSON(socket, timeoutMs);
}

async function oneShot(action, data, { autoStart = false, emptyListOnNoDaemon = false } = {}) {
  const socket = autoStart ? await connectWithAutoStart() : await connectOnce();
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

function nextValue(args, index, flag) {
  const next = index + 1;
  if (next >= args.length) error(`${flag} requires a value`, 'MISSING_ARG');
  return [args[next], next];
}

function parseIDOnly(args, commandName) {
  let id;
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === '--id') {
      [id, i] = nextValue(args, i, '--id');
    } else {
      error(`Unknown argument: ${args[i]}`, 'UNKNOWN_ARG');
    }
  }
  if (!id) error(`${commandName} requires --id <name>`, 'MISSING_ARG');
  return id;
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
        error(`Unknown argument: ${args[i]}`, 'UNKNOWN_ARG');
    }
  }

  if (!id) error('wait requires --id <name>', 'MISSING_ARG');
  const socket = autoStart ? await connectWithAutoStart() : await connectOnce();
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
    else error(`Unknown argument: ${args[i]}`, 'UNKNOWN_ARG');
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
    else error(`Unknown argument: ${args[i]}`, 'UNKNOWN_ARG');
  }
  if (event !== undefined && !id) error('post requires --id <name> when using --event', 'MISSING_ARG');
  if (id && event === undefined) error('post requires --event <json> when targeting a canvas', 'MISSING_ARG');
  if (!id && !channel) error('post requires --id <name> --event <json>', 'MISSING_ARG');
  if (id && channel) error('post accepts either canvas delivery (--id/--event) or legacy channel relay (--channel/--data), not both', 'INVALID_ARG');
  await oneShot('post', id ? { id, data: event } : { channel, data }, { autoStart: true });
}

const [command, ...args] = process.argv.slice(2);
switch (command) {
  case 'list':
    if (args.some((arg) => arg !== '--json')) error(`Unknown argument: ${args.find((arg) => arg !== '--json')}`, 'UNKNOWN_ARG');
    await oneShot('list', {}, { emptyListOnNoDaemon: true });
    break;
  case 'ping':
    if (args.length > 0) error(`Unknown argument: ${args[0]}`, 'UNKNOWN_ARG');
    await oneShot('ping', {});
    break;
  case 'remove':
    await oneShot('remove', { id: parseIDOnly(args, 'remove') });
    break;
  case 'remove-all':
    if (args.length > 0) error(`Unknown argument: ${args[0]}`, 'UNKNOWN_ARG');
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
  default:
    error(`Unknown show command: ${command ?? ''}`, 'UNKNOWN_COMMAND');
}
