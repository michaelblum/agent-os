#!/usr/bin/env node

import { spawnSync } from 'node:child_process';

function error(message, code) {
  process.stderr.write(`${JSON.stringify({ code, error: message })}\n`);
  process.exit(1);
}

function aosPath() {
  return process.env.AOS_PATH || './aos';
}

const captureValueFlags = new Set([
  '--out',
  '--crop',
  '--region',
  '--canvas',
  '--channel',
  '--exclude-window',
  '--format',
  '--quality',
  '--radius',
  '--browser-dom-point',
  '--browser-content-rect',
  '--timeout',
  '--delay',
  '--grid',
  '--thickness',
  '--shadow',
]);

const captureBoolFlags = new Set([
  '--window',
  '--base64',
  '--perception',
  '--show-cursor',
  '--interactive',
  '--wait-for-click',
  '--xray',
  '--label',
  '--clipboard',
]);

function isNumeric(value) {
  return /^-?(?:\d+|\d*\.\d+)$/.test(value);
}

function isPositiveInt(value) {
  return /^[1-9]\d*$/.test(value);
}

function parseCaptureArgs(args) {
  let i = 0;
  let target = null;
  if (i < args.length && !args[i].startsWith('--')) {
    target = args[i];
    i += 1;
    if (target === 'external' && i < args.length && !args[i].startsWith('--') && /^\d+$/.test(args[i])) {
      i += 1;
    }
  }

  const seen = new Set();
  while (i < args.length) {
    const arg = args[i];
    if (arg === '--highlight-cursor') {
      seen.add(arg);
      i += 1;
      if (i < args.length && args[i].startsWith('#')) i += 1;
      continue;
    }
    if (arg === '--draw-rect' || arg === '--draw-rect-fill') {
      seen.add(arg);
      if (i + 1 >= args.length || args[i + 1].startsWith('--')) error(`${arg} requires x,y,w,h and #color`, 'MISSING_ARG');
      if (i + 2 >= args.length || args[i + 2].startsWith('--')) error(`${arg} requires a color after coordinates`, 'MISSING_ARG');
      i += 3;
      continue;
    }
    if (captureBoolFlags.has(arg)) {
      seen.add(arg);
      i += 1;
      continue;
    }
    if (captureValueFlags.has(arg)) {
      seen.add(arg);
      if (i + 1 >= args.length || args[i + 1].startsWith('--')) error(`${arg} requires a value`, 'MISSING_ARG');
      const value = args[i + 1];
      if (arg === '--exclude-window' && !isPositiveInt(value)) error('--exclude-window must be a positive integer CGWindowID', 'INVALID_ARG');
      if (arg === '--radius' && !isPositiveInt(value)) error('--radius must be a positive integer', 'INVALID_ARG');
      if (arg === '--timeout' && (!isNumeric(value) || Number(value) <= 0)) error('--timeout must be a positive number', 'INVALID_ARG');
      if (arg === '--delay' && (!isNumeric(value) || Number(value) < 0)) error('--delay must be a non-negative number', 'INVALID_ARG');
      if (arg === '--grid' && !/^[1-9]\d*x[1-9]\d*$/i.test(value)) error('--grid format: COLSxROWS (e.g., 4x3)', 'INVALID_ARG');
      if (arg === '--thickness' && (!isNumeric(value) || Number(value) <= 0)) error('--thickness must be a positive number', 'INVALID_ARG');
      i += 2;
      continue;
    }
    if (arg.startsWith('--')) error(`Unknown see capture flag: ${arg}`, 'UNKNOWN_FLAG');
    if (target) error(`Unknown see capture argument: ${arg}`, 'UNKNOWN_ARG');
    target = arg;
    i += 1;
  }

  if (seen.has('--crop') && seen.has('--region')) error('--region and --crop cannot be used together', 'INVALID_ARG');
  if (seen.has('--window') && seen.has('--region')) error('--region and --window cannot be used together', 'INVALID_ARG');
  const surfaceSelectors = ['--region', '--canvas', '--channel'].filter((flag) => seen.has(flag));
  if (surfaceSelectors.length > 1) error('Use only one of --region, --canvas, or --channel', 'INVALID_ARG');
}

const [primitive, ...args] = process.argv.slice(2);
if (!primitive) error('see native wrapper requires a primitive', 'MISSING_ARG');
if (!['capture', 'cursor', 'list', 'selection'].includes(primitive)) {
  error(`Unknown see native primitive: ${primitive}`, 'UNKNOWN_SUBCOMMAND');
}
if (primitive === 'capture') parseCaptureArgs(args);

const result = spawnSync(aosPath(), ['__see', primitive, ...args], {
  encoding: 'utf8',
  env: process.env,
});
if (result.stdout) process.stdout.write(result.stdout);
if (result.stderr) process.stderr.write(result.stderr);
process.exit(result.status ?? 1);
