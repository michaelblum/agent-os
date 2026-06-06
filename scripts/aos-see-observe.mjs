#!/usr/bin/env node

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';

function error(message, code) {
  process.stderr.write(`{\n  "code" : ${JSON.stringify(code)},\n  "error" : ${JSON.stringify(message)}\n}\n`);
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

function parseArgs(args) {
  const options = { depth: 2, rate: 'on-settle' };
  for (let i = 0; i < args.length; i += 1) {
    switch (args[i]) {
      case '--depth': {
        i += 1;
        if (i >= args.length || args[i].startsWith('--')) error('--depth requires a value', 'MISSING_ARG');
        const depth = Number(args[i]);
        if (!Number.isInteger(depth) || depth < 0 || depth > 3) {
          error('--depth requires 0-3', 'INVALID_ARG');
        }
        options.depth = depth;
        break;
      }
      case '--rate':
        i += 1;
        if (i >= args.length || args[i].startsWith('--')) error('--rate requires a value', 'MISSING_ARG');
        if (!['continuous', 'on-change', 'on-settle'].includes(args[i])) {
          error('--rate requires: continuous, on-change, on-settle', 'INVALID_ARG');
        }
        options.rate = args[i];
        break;
      default:
        unknownArg(args[i]);
    }
  }
  return options;
}

function discardOneLineThenStream(socket) {
  let buffer = Buffer.alloc(0);
  let ackDiscarded = false;

  socket.on('data', (chunk) => {
    if (ackDiscarded) {
      process.stdout.write(chunk);
      return;
    }

    buffer = Buffer.concat([buffer, chunk]);
    const newline = buffer.indexOf(0x0a);
    if (newline < 0) return;

    ackDiscarded = true;
    const remaining = buffer.subarray(newline + 1);
    buffer = Buffer.alloc(0);
    if (remaining.length > 0) process.stdout.write(remaining);
  });
}

const options = parseArgs(process.argv.slice(2));
const socket = await connectWithAutoStart();
if (!socket) error(`Cannot connect to daemon at ${socketPath()}. Is 'aos serve' running?`, 'CONNECT_ERROR');

const close = () => {
  socket.end();
  process.exit(0);
};
process.once('SIGINT', close);
process.once('SIGTERM', close);
socket.once('close', () => process.exit(0));
socket.once('error', () => process.exit(0));
discardOneLineThenStream(socket);
socket.write(`${JSON.stringify({
  v: 1,
  service: 'see',
  action: 'observe',
  data: { depth: options.depth, scope: 'cursor', rate: options.rate },
})}\n`);
