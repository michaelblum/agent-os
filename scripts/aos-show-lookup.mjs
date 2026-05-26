#!/usr/bin/env node

import net from 'node:net';
import os from 'node:os';
import path from 'node:path';

function error(message, code) {
  process.stderr.write(`${JSON.stringify({ code, error: message })}\n`);
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

function parseArgs(args) {
  let id;
  for (let i = 0; i < args.length; i += 1) {
    switch (args[i]) {
      case '--id':
        i += 1;
        if (i >= args.length || args[i].startsWith('--')) error('--id requires a value', 'MISSING_ARG');
        id = args[i];
        break;
      case '--json':
        break;
      default:
        unknownArg(args[i]);
    }
  }
  if (!id) error('Missing required argument: --id <name>', 'MISSING_ARG');
  return { id };
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

async function canvasList() {
  const socket = await connectOnce();
  if (!socket) {
    return {
      socketReachable: false,
      canvases: [],
      notes: ['Daemon socket is not reachable.'],
    };
  }

  socket.write(`${JSON.stringify({ v: 1, service: 'show', action: 'list', data: {} })}\n`);
  const response = await readOneJSON(socket);
  socket.end();
  if (!response) {
    return {
      socketReachable: true,
      canvases: [],
      notes: ['Failed to decode canvas list.'],
    };
  }
  const body = response.data && typeof response.data === 'object' ? response.data : response;
  if (Array.isArray(body.canvases)) {
    return { socketReachable: true, canvases: body.canvases, notes: [] };
  }
  const message = body.error || response.error || 'Failed to decode canvas list.';
  return { socketReachable: true, canvases: [], notes: [message] };
}

const [command, ...args] = process.argv.slice(2);
if (!['exists', 'get'].includes(command)) error(`Unknown show lookup command: ${command ?? ''}`, 'UNKNOWN_COMMAND');

const { id } = parseArgs(args);
const snapshot = await canvasList();
const canvas = snapshot.canvases.find((item) => item?.id === id) || null;
const notes = [...snapshot.notes];
if (command === 'get' && snapshot.socketReachable && !canvas) {
  notes.push(`Canvas '${id}' was not found.`);
}

process.stdout.write(`${JSON.stringify({
  status: snapshot.socketReachable ? 'ok' : 'degraded',
  exists: canvas !== null,
  daemon_running: snapshot.socketReachable,
  socket_reachable: snapshot.socketReachable,
  canvas: command === 'get' ? canvas : null,
  notes,
})}\n`);
