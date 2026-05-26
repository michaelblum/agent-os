#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

function error(message, code) {
  process.stderr.write(`${JSON.stringify({ code, error: message }, null, 2)}\n`);
  process.exit(1);
}

function unknownArg(arg) {
  error(`Unknown ${arg.startsWith('--') ? 'flag' : 'argument'}: ${arg}`, arg.startsWith('--') ? 'UNKNOWN_FLAG' : 'UNKNOWN_ARG');
}

function runtimeMode() {
  return process.env.AOS_RUNTIME_MODE === 'installed' ? 'installed' : 'repo';
}

function stateRoot() {
  return path.resolve(process.env.AOS_STATE_ROOT || path.join(os.homedir(), '.config/aos'));
}

function wikiRoot() {
  return path.join(stateRoot(), runtimeMode(), 'wiki');
}

function repoRoot() {
  return process.env.AOS_REPO_ROOT || process.cwd();
}

function aosPath() {
  return process.env.AOS_PATH || path.join(process.cwd(), 'aos');
}

function valueAfter(args, key) {
  const idx = args.indexOf(key);
  return idx >= 0 && idx + 1 < args.length ? args[idx + 1] : undefined;
}

function allValuesAfter(args, key) {
  const values = [];
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === key && i + 1 < args.length) {
      values.push(args[i + 1]);
      i += 1;
    }
  }
  return values;
}

function copyIfAbsent(namespace, pairs) {
  let written = 0;
  for (const pair of pairs) {
    const colon = pair.indexOf(':');
    if (colon <= 0) error('Error: --file value must be <rel>:<absolutePath>', 'INVALID_ARG');
    const rel = pair.slice(0, colon);
    const src = pair.slice(colon + 1);
    const dst = path.join(wikiRoot(), namespace, rel);
    if (fs.existsSync(dst)) continue;
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    fs.copyFileSync(src, dst);
    written += 1;
  }
  return written;
}

function hasWikiContent(root) {
  for (const dirType of ['plugins', 'entities', 'concepts']) {
    for (const rel of [`aos/${dirType}`, dirType]) {
      const dir = path.join(root, rel);
      if (!fs.existsSync(dir)) continue;
      if (fs.readdirSync(dir).some((name) => !name.startsWith('.'))) return true;
    }
  }
  return false;
}

function copySeedTree(sourceDir, force) {
  let copied = 0;
  for (const subDir of ['plugins', 'entities', 'concepts']) {
    const srcRoot = path.join(sourceDir, subDir);
    const dstRoot = path.join(wikiRoot(), 'aos', subDir);
    if (!fs.existsSync(srcRoot)) continue;
    const stack = [''];
    while (stack.length > 0) {
      const rel = stack.pop();
      const src = path.join(srcRoot, rel);
      const dst = path.join(dstRoot, rel);
      const stat = fs.statSync(src);
      if (stat.isDirectory()) {
        fs.mkdirSync(dst, { recursive: true });
        for (const child of fs.readdirSync(src)) stack.push(path.join(rel, child));
      } else {
        if (fs.existsSync(dst)) {
          if (!force) continue;
          fs.rmSync(dst);
        }
        fs.mkdirSync(path.dirname(dst), { recursive: true });
        fs.copyFileSync(src, dst);
        copied += 1;
      }
    }
  }
  return copied;
}

function runReindex(asJSON) {
  const result = spawnSync(aosPath(), ['wiki', 'reindex', ...(asJSON ? ['--json'] : [])], {
    encoding: 'utf8',
    env: process.env,
  });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  if (result.status !== 0) process.exit(result.status ?? 1);
}

const args = process.argv.slice(2);
const asJSON = args.includes('--json');
const force = args.includes('--force');
const namespace = valueAfter(args, '--namespace');

const allowed = new Set(['--json', '--force', '--from', '--namespace', '--file']);
for (let i = 0; i < args.length; i += 1) {
  const arg = args[i];
  if (!arg.startsWith('--')) unknownArg(arg);
  if (!allowed.has(arg)) unknownArg(arg);
  if (['--from', '--namespace', '--file'].includes(arg)) {
    i += 1;
    if (i >= args.length) error(`${arg} requires a value`, 'MISSING_ARG');
  }
}

if (namespace) {
  const written = copyIfAbsent(namespace, allValuesAfter(args, '--file'));
  if (asJSON) process.stdout.write(`${JSON.stringify({ status: 'ok', written }, null, 2)}\n`);
  else process.stdout.write(`Seeded ${written} file(s) into ${namespace}.\n`);
  process.exit(0);
}

if (hasWikiContent(wikiRoot()) && !force) {
  if (asJSON) {
    process.stdout.write(`${JSON.stringify({ status: 'skipped', reason: 'Wiki already has content. Use --force to overwrite.' })}\n`);
  } else {
    process.stdout.write('Wiki already has content. Use --force to seed anyway.\n');
  }
  process.exit(0);
}

const sourceDir = valueAfter(args, '--from') || path.join(repoRoot(), 'wiki-seed');
if (!fs.existsSync(sourceDir)) error(`Seed directory not found at ${sourceDir}`, 'WIKI_SEED_NOT_FOUND');

const copied = copySeedTree(sourceDir, force);
runReindex(asJSON);

if (asJSON) process.stdout.write(`${JSON.stringify({ status: 'ok', files_copied: copied }, null, 2)}\n`);
else process.stdout.write(`Seeded ${copied} files. Wiki is ready.\n`);
