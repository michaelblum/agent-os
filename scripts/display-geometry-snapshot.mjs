#!/usr/bin/env node
// One-shot subscriber for the display_geometry channel.
// Resolves the active socket via `./aos doctor --json` so the script
// works under both repo and installed runtime modes without hardcoding
// a path. Override with AOS_SOCKET_PATH for CI harnesses that already
// know the path.

import net from 'node:net';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const aosBin = path.join(repoRoot, 'aos');

function resolveSocketPath() {
  const override = process.env.AOS_SOCKET_PATH;
  if (override) return override;
  const raw = execFileSync(aosBin, ['doctor', '--json'], { encoding: 'utf8' });
  const doctor = JSON.parse(raw);
  const socketPath = doctor?.identity?.socket_path || doctor?.runtime?.socket_path;
  if (!socketPath) {
    throw new Error('aos doctor --json did not report a socket_path');
  }
  return socketPath;
}

const sock = resolveSocketPath();
const client = net.createConnection(sock);
let buf = '';
let done = false;

function emit(payload) {
  if (done) return;
  done = true;
  process.stdout.write(JSON.stringify(payload));
  client.end();
  process.exit(0);
}

client.on('data', (chunk) => {
  buf += chunk.toString('utf8');
  const lines = buf.split('\n');
  buf = lines.pop() ?? '';
  for (const line of lines) {
    if (!line) continue;
    try {
      const env = JSON.parse(line);
      if (env.event === 'display_geometry' && env.data) {
        emit(env.data);
        return;
      }
    } catch {}
  }
});
client.on('connect', () => {
  client.write(JSON.stringify({ action: 'subscribe', events: ['display_geometry'], snapshot: true }) + '\n');
});
client.on('error', (err) => {
  console.error(err.message);
  process.exit(1);
});
setTimeout(() => {
  if (!done) {
    console.error('timeout waiting for display_geometry snapshot');
    process.exit(1);
  }
}, 3000);
