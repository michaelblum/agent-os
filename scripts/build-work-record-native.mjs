#!/usr/bin/env node

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const scriptPath = fileURLToPath(import.meta.url);
const scriptDir = path.dirname(scriptPath);
const repoRoot = path.resolve(scriptDir, '..');
const source = path.join(repoRoot, 'src/platform/descriptor-relative-fs-addon.cc');
const mode = process.argv.includes('--release') ? 'release' : 'dev';
const checkOnly = process.argv.includes('--check');
const json = process.argv.includes('--json');

function fail(message, code = 1) {
  if (json) process.stdout.write(`${JSON.stringify({ ok: false, error: message })}\n`);
  else process.stderr.write(`build-work-record-native: ${message}\n`);
  process.exit(code);
}

if (process.platform !== 'darwin') fail('descriptor-relative Work Record publication currently supports Darwin only.');
if (!fs.existsSync(source)) fail('native descriptor-relative source is missing.');

const nodePrefix = path.resolve(path.dirname(process.execPath), '..');
const includeCandidates = [
  path.join(nodePrefix, 'include/node'),
  '/usr/local/include/node',
  '/opt/homebrew/include/node',
];
const includeRoot = includeCandidates.find((candidate) => fs.existsSync(path.join(candidate, 'node_api.h')));
if (!includeRoot) fail('Node N-API headers are unavailable.');

const outputDir = path.join(repoRoot, 'packages/toolkit/workbench/native/build', `${process.platform}-${process.arch}`);
const output = path.join(outputDir, 'descriptor-relative-fs.node');
const fingerprintPath = `${output}.sha256`;
const compiler = '/usr/bin/xcrun';
const flags = [
  'clang++',
  '-std=c++17',
  mode === 'release' ? '-O2' : '-O0',
  '-Wall',
  '-Wextra',
  '-Wpedantic',
  '-fvisibility=hidden',
  '-bundle',
  '-undefined',
  'dynamic_lookup',
  '-I',
  includeRoot,
  source,
];
const fingerprint = crypto.createHash('sha256')
  .update(fs.readFileSync(source))
  .update('\0')
  .update(fs.readFileSync(scriptPath))
  .update('\0')
  .update(compiler)
  .update('\0')
  .update(flags.join('\0'))
  .update('\0')
  .update(process.versions.napi || '')
  .update('\0')
  .update(process.arch)
  .update('\0')
  .update(mode)
  .digest('hex');

const current = fs.existsSync(output)
  && fs.existsSync(fingerprintPath)
  && fs.readFileSync(fingerprintPath, 'utf8').trim() === fingerprint;
if (checkOnly) {
  if (!current) fail('native descriptor-relative addon is missing or stale.');
  const result = { ok: true, status: 'current', mode, output: path.relative(repoRoot, output) };
  process.stdout.write(`${json ? JSON.stringify(result) : `Current: ${result.output}`}\n`);
  process.exit(0);
}
if (current) {
  const result = { ok: true, status: 'current', mode, output: path.relative(repoRoot, output) };
  process.stdout.write(`${json ? JSON.stringify(result) : `Current: ${result.output}`}\n`);
  process.exit(0);
}

fs.mkdirSync(outputDir, { recursive: true });
const temporary = path.join(outputDir, `.descriptor-relative-fs.${process.pid}.${crypto.randomUUID()}.node`);
const compile = spawnSync(compiler, [...flags, '-o', temporary], {
  cwd: repoRoot,
  encoding: 'utf8',
  stdio: ['ignore', 'pipe', 'pipe'],
});
if (compile.status !== 0) {
  try { fs.rmSync(temporary, { force: true }); } catch {}
  const diagnostic = String(compile.stderr || compile.stdout || '').trim();
  fail(diagnostic ? `native compilation failed: ${diagnostic}` : 'native compilation failed.');
}
fs.renameSync(temporary, output);
fs.writeFileSync(fingerprintPath, `${fingerprint}\n`, { mode: 0o600 });
const result = { ok: true, status: 'built', mode, output: path.relative(repoRoot, output) };
process.stdout.write(`${json ? JSON.stringify(result) : `Built: ${result.output}`}\n`);
