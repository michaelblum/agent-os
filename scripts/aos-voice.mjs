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

function autoStartAllowed() {
  return process.env.AOS_ALLOW_DAEMON_AUTOSTART === '1';
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
  if (!autoStartAllowed()) {
    process.stderr.write('ipc: daemon auto-start requires AOS_ALLOW_DAEMON_AUTOSTART=1\n');
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

async function sendEnvelope(action, data = {}) {
  const socket = await connectWithAutoStart();
  if (!socket) error('Cannot connect to daemon', 'DAEMON_UNREACHABLE');
  socket.write(`${JSON.stringify({ v: 1, service: 'voice', action, data })}\n`);
  const response = await readOneJSON(socket);
  socket.end();
  if (!response) error('Cannot connect to daemon', 'DAEMON_UNREACHABLE');
  if (response.error) {
    process.stderr.write(`${JSON.stringify(response)}\n`);
    process.exit(1);
  }
  process.stdout.write(`${JSON.stringify(response)}\n`);
}

function takeValue(args, index, flag) {
  const next = index + 1;
  if (next >= args.length || args[next].startsWith('--')) error(`${flag} requires a value`, 'MISSING_ARG');
  return [args[next], next];
}

function rejectExtraArgs(args) {
  for (const arg of args) {
    if (arg === '--json') continue;
    unknownArg(arg);
  }
}

function listPayload(args) {
  const data = {};
  for (let i = 0; i < args.length; i += 1) {
    switch (args[i]) {
      case '--provider': {
        const [value, next] = takeValue(args, i, '--provider');
        data.provider = value;
        i = next;
        break;
      }
      case '--speakable-only':
        data.speakable_only = true;
        break;
      case '--json':
        break;
      default:
        unknownArg(args[i]);
    }
  }
  return data;
}

function bindPayload(args) {
  const data = {};
  const tags = [];
  let hasFilter = false;
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    switch (arg) {
      case '--session-id': {
        const [value, next] = takeValue(args, i, '--session-id');
        data.session_id = value;
        i = next;
        break;
      }
      case '--voice': {
        const [value, next] = takeValue(args, i, '--voice');
        data.voice_id = value;
        i = next;
        break;
      }
      case '--provider':
      case '--gender':
      case '--locale':
      case '--language':
      case '--region':
      case '--kind':
      case '--quality-tier': {
        const [value, next] = takeValue(args, i, arg);
        data[arg.slice(2).replaceAll('-', '_')] = value;
        hasFilter = true;
        i = next;
        break;
      }
      case '--tag': {
        const [value, next] = takeValue(args, i, '--tag');
        tags.push(value);
        hasFilter = true;
        i = next;
        break;
      }
      case '--json':
        break;
      default:
        unknownArg(arg);
    }
  }
  if (!data.session_id) error('bind requires --session-id <id>', 'MISSING_ARG');
  if (data.voice_id && hasFilter) error('bind accepts either --voice or filter flags, not both', 'INVALID_ARG');
  if (tags.length > 0) data.tags = tags;
  return data;
}

function nextPayload(args) {
  const data = {};
  for (let i = 0; i < args.length; i += 1) {
    switch (args[i]) {
      case '--session-id': {
        const [value, next] = takeValue(args, i, '--session-id');
        data.session_id = value;
        i = next;
        break;
      }
      case '--json':
        break;
      default:
        unknownArg(args[i]);
    }
  }
  if (!data.session_id) error('next requires --session-id <id>', 'MISSING_ARG');
  return data;
}

function finalResponsePayload(args) {
  const data = {};
  for (let i = 0; i < args.length; i += 1) {
    switch (args[i]) {
      case '--session-id': {
        const [value, next] = takeValue(args, i, '--session-id');
        data.session_id = value;
        i = next;
        break;
      }
      case '--harness': {
        const [value, next] = takeValue(args, i, '--harness');
        data.harness = value;
        i = next;
        break;
      }
      default:
        unknownArg(args[i]);
    }
  }

  let stdin = '';
  if (!process.stdin.isTTY) {
    try {
      stdin = fs.readFileSync(0, 'utf8').trim();
    } catch {
      stdin = '';
    }
  }
  if (stdin) {
    try {
      data.hook_payload = JSON.parse(stdin);
    } catch {
      error('voice final-response requires JSON hook payload on stdin', 'INVALID_JSON');
    }
  } else {
    data.hook_payload = {};
  }
  return data;
}

const [command, ...args] = process.argv.slice(2);
switch (command) {
  case 'list':
    await sendEnvelope('list', listPayload(args));
    break;
  case 'assignments':
    rejectExtraArgs(args);
    await sendEnvelope('assignments', {});
    break;
  case 'refresh':
    rejectExtraArgs(args);
    await sendEnvelope('refresh', {});
    break;
  case 'providers':
    rejectExtraArgs(args);
    await sendEnvelope('providers', {});
    break;
  case 'bind':
    await sendEnvelope('bind', bindPayload(args));
    break;
  case 'next':
    await sendEnvelope('next', nextPayload(args));
    break;
  case 'final-response':
    await sendEnvelope('final_response', finalResponsePayload(args));
    break;
  default:
    error(`Unknown voice command: ${command ?? ''}`, 'UNKNOWN_COMMAND');
}
