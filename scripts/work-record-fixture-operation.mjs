#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';

function argValue(name) {
  const index = process.argv.indexOf(name);
  return index === -1 ? '' : String(process.argv[index + 1] || '');
}

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

const mode = argValue('--mode');
const file = argValue('--file') || 'fixture-output.txt';
const value = argValue('--value') || 'controlled repair fixture output';
const target = path.resolve(process.cwd(), file);

if (!mode) {
  process.stderr.write('missing --mode\n');
  process.exit(64);
}

if (mode === 'write') {
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, `${value}\n`);
  process.stdout.write(`wrote ${file}\n`);
  process.exit(0);
}

if (mode === 'fail-after-write') {
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, `${value}\n`);
  process.stderr.write(`failed after writing ${file}\n`);
  process.exit(7);
}

if (mode === 'cleanup') {
  if (fs.existsSync(target)) fs.rmSync(target, { force: true });
  process.stdout.write(`cleaned ${file}\n`);
  process.exit(0);
}

if (mode === 'cleanup-fail') {
  process.stderr.write(`cleanup failed for ${file}\n`);
  process.exit(8);
}

if (mode === 'rollback') {
  if (fs.existsSync(target)) fs.rmSync(target, { force: true });
  process.stdout.write(`rolled back ${file}\n`);
  process.exit(0);
}

if (mode === 'rollback-fail') {
  process.stderr.write(`rollback failed for ${file}\n`);
  process.exit(9);
}

if (mode === 'sleep') {
  await sleep(Number(argValue('--ms') || 5000));
  process.stdout.write('slept\n');
  process.exit(0);
}

process.stderr.write(`unsupported mode ${mode}\n`);
process.exit(65);
