import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import zlib from 'node:zlib';

import { validateDescriptor } from '../../scripts/lib/browser-companion/descriptor.mjs';
import { installCompanion } from '../../scripts/lib/browser-companion/lifecycle.mjs';

const repoRoot = fileURLToPath(new URL('../..', import.meta.url));
const sourceDescriptor = JSON.parse(fs.readFileSync(path.join(repoRoot, 'manifests/companions/playwright-cli-v1.json'), 'utf8'));

function writeString(buffer, offset, length, value) {
  buffer.write(value, offset, Math.min(length, Buffer.byteLength(value)), 'ascii');
}

function writeOctal(buffer, offset, length, value) {
  writeString(buffer, offset, length, `${value.toString(8).padStart(length - 1, '0')}\0`);
}

function tarHeader(name, size) {
  const header = Buffer.alloc(512);
  writeString(header, 0, 100, name);
  writeOctal(header, 100, 8, 0o644);
  writeOctal(header, 108, 8, 0);
  writeOctal(header, 116, 8, 0);
  writeOctal(header, 124, 12, size);
  writeOctal(header, 136, 12, 0);
  header.fill(0x20, 148, 156);
  writeString(header, 156, 1, '0');
  writeString(header, 257, 6, 'ustar\0');
  writeString(header, 263, 2, '00');
  const checksum = header.reduce((sum, value) => sum + value, 0);
  writeString(header, 148, 8, `${checksum.toString(8).padStart(6, '0')}\0 `);
  return header;
}

function tarball(entries) {
  const chunks = [];
  for (const entry of entries) {
    const bytes = Buffer.from(entry.bytes);
    chunks.push(tarHeader(entry.name, bytes.length), bytes);
    const padding = (512 - (bytes.length % 512)) % 512;
    if (padding) chunks.push(Buffer.alloc(padding));
  }
  chunks.push(Buffer.alloc(1024));
  return zlib.gzipSync(Buffer.concat(chunks));
}

function packageManifest(name, cliVersion) {
  if (name === '@playwright/cli') return {
    name, version: cliVersion, engines: { node: '>=18' },
    dependencies: { playwright: '1.62.0-alpha-2026-06-29', 'playwright-core': '1.62.0-alpha-2026-06-29' },
    bin: { 'playwright-cli': 'playwright-cli.js' },
  };
  if (name === 'playwright') return {
    name, version: '1.62.0-alpha-2026-06-29', engines: { node: '>=18' },
    dependencies: { 'playwright-core': '1.62.0-alpha-2026-06-29' }, optionalDependencies: { fsevents: '2.3.2' },
    bin: { playwright: 'cli.js' },
  };
  return {
    name, version: '1.62.0-alpha-2026-06-29', engines: { node: '>=18' },
    bin: { 'playwright-core': 'cli.js' },
  };
}

function fakeWorkerSource(logPath, behavior = 'normal') {
  return [
    '#!/usr/bin/env node',
    "const fs = require('node:fs');",
    "const { spawn } = require('node:child_process');",
    `const logPath = ${JSON.stringify(logPath ?? null)};`,
    `const behavior = ${JSON.stringify(behavior)};`,
    'const argv = process.argv.slice(2);',
    "const nestedSource = \"const fs=require('node:fs');const target=process.argv[1];process.on('SIGTERM',()=>{});let tick=0;setInterval(()=>{if(target)fs.writeFileSync(target,String(++tick))},20)\";",
    "if (logPath && behavior !== 'detached-daemon') fs.appendFileSync(logPath, `${JSON.stringify({ argv, cwd: process.cwd(), env: process.env })}\\n`, { mode: 0o600 });",
    "const session = String(argv[0] || '').replace(/^-s=/, '');",
    "const verb = argv[1] || '';",
    "const filename = argv.find(value => value.startsWith('--filename='))?.slice(11);",
    "if (behavior === 'hang') { const nested = spawn(process.execPath, ['-e', nestedSource, logPath ? `${logPath}.heartbeat` : ''], { stdio: 'ignore' }); if (logPath) fs.writeFileSync(logPath, JSON.stringify({ worker_pid: process.pid, nested_pid: nested.pid })); process.on('SIGTERM',()=>{}); setInterval(()=>{},1000); return; }",
    "if (behavior === 'emit-hang') { const nested = spawn(process.execPath, ['-e', nestedSource, logPath ? `${logPath}.heartbeat` : ''], { stdio: 'ignore' }); if (logPath) fs.writeFileSync(logPath, JSON.stringify({ worker_pid: process.pid, nested_pid: nested.pid })); process.on('SIGTERM',()=>{}); setInterval(()=>process.stdout.write('emitting\\n'),20); return; }",
    "if (behavior === 'leader-closes-nested-hangs') { const nested = spawn(process.execPath, ['-e', nestedSource, logPath ? `${logPath}.heartbeat` : ''], { stdio: 'ignore' }); if (logPath) fs.writeFileSync(logPath, JSON.stringify({ worker_pid: process.pid, nested_pid: nested.pid })); process.on('SIGTERM',()=>process.exit(0)); setInterval(()=>{},1000); return; }",
    "if (behavior === 'detached-daemon' && verb === 'open') { const daemon = spawn(process.execPath, ['-e', \"process.on('SIGTERM',()=>process.exit(0));setInterval(()=>{},1000)\"], { detached:true, stdio:'ignore' }); daemon.unref(); if (logPath) fs.writeFileSync(logPath, JSON.stringify({ daemon_pid: daemon.pid })); }",
    "if (behavior === 'detached-daemon' && verb === 'close' && logPath) { try { const saved=JSON.parse(fs.readFileSync(logPath,'utf8')); process.kill(saved.daemon_pid,'SIGTERM'); } catch {} }",
    "if (behavior === 'overflow') { process.stdout.write('x'.repeat(128 * 1024)); return; }",
    "if (behavior === 'split-overflow') { process.stdout.write('x'.repeat(40 * 1024)); process.stderr.write('y'.repeat(40 * 1024)); return; }",
    "if (behavior === 'invalid-envelope') { process.stdout.write(`${JSON.stringify({ session, status: 'unexpected' })}\\n`); return; }",
    "if (filename) fs.writeFileSync(filename, verb === 'snapshot' ? '# snapshot\\n' : Buffer.from('png'), { mode: 0o600 });",
    "let result = { snapshot: { file: '<auto>' } };",
    "if (verb === 'open') result = { session, pid: 41, result: { snapshot: { file: '<auto>' } } };",
    "else if (verb === 'attach') result = { session, pid: 42, endpoint: argv.find(value => value.startsWith('--extension='))?.slice(12) || argv.find(value => value.startsWith('--cdp='))?.slice(6), result: { snapshot: { file: '<auto>' } } };",
    "else if (verb === 'close') result = { session, status: 'closed' };",
    "else if (verb === 'detach') result = { session, status: 'detached' };",
    "else if (verb === 'eval' && String(argv[2]).includes(\"status:'alive'\")) result = { result: JSON.stringify({ status: 'alive' }) };",
    "else if (verb === 'eval' && String(argv[2]).includes('selector_resolution')) result = { result: JSON.stringify({ status: 'captured', extracted_text: 'Evidence', visible: true, bounding_box: { x: 1, y: 2, width: 3, height: 4 }, selector_resolution: { strategy: 'css', candidates: [{ kind: 'css', value: '#hero', match_count: 1, error: null }], used: { kind: 'css', value: '#hero', index: 0, match_count: 1 } } }) };",
    "else if (verb === 'eval') result = { result: JSON.stringify({ schema: 'aos.agent-workspace.browser-identity.v1', page_url: 'about:blank', frame_url: 'about:blank', top_frame_url: 'about:blank', document_title: null }) };",
    "else if (verb === 'snapshot') result = { snapshot: { file: filename } };",
    "else if (verb === 'screenshot') result = { screenshot: { file: filename } };",
    "process.stdout.write(`${JSON.stringify(result)}\\n`);",
    '',
  ].join('\n');
}

export function managedRuntimeFixture(version = '0.1.15', options = {}) {
  const descriptor = structuredClone(sourceDescriptor);
  descriptor.version = version;
  descriptor.packages[0].version = version;
  descriptor.packages[0].tarball = `https://registry.npmjs.org/@playwright/cli/-/cli-${version}.tgz`;
  const archives = new Map();
  for (const pkg of descriptor.packages) {
    const entrypoint = Object.values(pkg.bin)[0];
    const archive = tarball([
      { name: 'package/package.json', bytes: JSON.stringify(packageManifest(pkg.name, version)) },
      { name: `package/${entrypoint}`, bytes: pkg.name === '@playwright/cli'
        ? fakeWorkerSource(options.workerLog, options.workerBehavior)
        : `#!/usr/bin/env node\n// fake ${pkg.name}\n` },
    ]);
    pkg.integrity = `sha512-${crypto.createHash('sha512').update(archive).digest('base64')}`;
    archives.set(pkg.name, archive);
  }
  return {
    current: validateDescriptor(descriptor),
    download: async ({ packageName }) => archives.get(packageName),
  };
}

export async function installManagedRuntime(env, fixture = managedRuntimeFixture()) {
  await installCompanion({ env, current: fixture.current, download: fixture.download });
  return fixture;
}

export { repoRoot, sourceDescriptor };
