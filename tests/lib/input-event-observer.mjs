#!/usr/bin/env node

import fs from 'node:fs';
import net from 'node:net';
import process from 'node:process';

import { normalizeCanvasInputMessage } from '../../packages/toolkit/runtime/input-events.js';

function parseArgs(argv) {
  const options = { socket: '', readyFile: '' };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--socket') options.socket = argv[++i] ?? '';
    else if (argv[i] === '--ready-file') options.readyFile = argv[++i] ?? '';
    else throw new Error(`unknown argument: ${argv[i]}`);
  }
  if (!options.socket) throw new Error('--socket is required');
  return options;
}

function writeRecord(record) {
  process.stdout.write(`${JSON.stringify(record)}\n`);
}

const options = parseArgs(process.argv.slice(2));
const socket = net.createConnection(options.socket);
socket.setEncoding('utf8');

let acknowledged = false;
let buffer = '';
let stopping = false;

function fail(message, details = null) {
  writeRecord({ observer: 'error', message, details });
  process.exitCode = 1;
  socket.destroy();
}

socket.on('connect', () => {
  socket.write(`${JSON.stringify({
    v: 1,
    service: 'see',
    action: 'observe',
    data: { events: ['input_event'], snapshot: false },
  })}\n`);
});

socket.on('data', chunk => {
  buffer += chunk;
  while (buffer.includes('\n')) {
    const newline = buffer.indexOf('\n');
    const line = buffer.slice(0, newline);
    buffer = buffer.slice(newline + 1);
    if (!line) continue;

    let message;
    try {
      message = JSON.parse(line);
    } catch (error) {
      fail('observer received malformed JSON', String(error));
      return;
    }

    if (!acknowledged) {
      const status = message.status ?? message.data?.status;
      if (status !== 'ok' && status !== 'success') {
        fail('see.observe subscription failed', message);
        return;
      }
      acknowledged = true;
      if (options.readyFile) fs.writeFileSync(options.readyFile, 'ready\n');
      writeRecord({ observer: 'ready', socket: options.socket });
      continue;
    }

    if (message.event !== 'input_event') continue;
    const event = normalizeCanvasInputMessage(message.data);
    if (!event || event.input_schema_version !== 2) {
      fail('observer received a noncanonical input_event', message.data ?? null);
      return;
    }
    writeRecord({ observer: 'input_event', event });
  }
});

socket.on('error', error => {
  if (!stopping) fail('observer socket failed', String(error));
});

socket.on('close', () => {
  if (!stopping && process.exitCode == null) {
    writeRecord({ observer: 'error', message: 'observer socket closed unexpectedly' });
    process.exitCode = 1;
  }
});

function stop() {
  if (stopping) return;
  stopping = true;
  socket.end();
  setTimeout(() => process.exit(process.exitCode ?? 0), 25).unref();
}

process.once('SIGINT', stop);
process.once('SIGTERM', stop);
