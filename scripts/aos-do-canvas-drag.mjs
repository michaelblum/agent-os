#!/usr/bin/env node

import { spawnSync } from 'node:child_process';

function error(message, code) {
  process.stderr.write(`${JSON.stringify({ code, error: message })}\n`);
  process.exit(1);
}

function unknownArg(arg) {
  error(`Unknown ${String(arg).startsWith('--') ? 'flag' : 'argument'}: ${arg}`, String(arg).startsWith('--') ? 'UNKNOWN_FLAG' : 'UNKNOWN_ARG');
}

function aosPath() {
  return process.env.AOS_PATH || './aos';
}

const valueFlags = new Set(['--by', '--to-value', '--playback', '--state-id']);
const booleanFlags = new Set(['--dry-run']);

function positionalArgs(args) {
  const out = [];
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg.startsWith('--')) {
      if (valueFlags.has(arg)) {
        i += 1;
        if (i >= args.length || args[i].startsWith('--')) error(`${arg} requires a value`, 'MISSING_ARG');
      } else if (!booleanFlags.has(arg)) {
        unknownArg(arg);
      }
      continue;
    }
    out.push(arg);
  }
  return out;
}

function flagValue(args, flag) {
  const index = args.indexOf(flag);
  if (index < 0) return null;
  return args[index + 1] ?? null;
}

function flagPresence(args, flag) {
  return args.includes(flag);
}

function isCoord(value) {
  return /^-?\d+(?:\.\d+)?,-?\d+(?:\.\d+)?$/.test(String(value));
}

function isNumber(value) {
  return /^-?(?:\d+|\d*\.\d+)$/.test(String(value));
}

function validate(args) {
  const pos = positionalArgs(args);
  if (!pos[0]) error('drag canvas target requires canvas:<canvas-id>/<ref>', 'MISSING_ARG');
  if (!pos[0].startsWith('canvas:')) error('canvas drag requires canvas:<canvas-id>/<ref>', 'INVALID_TARGET');
  if (pos.length > 1) unknownArg(pos[1]);
  const hasBy = flagPresence(args, '--by');
  const hasToValue = flagPresence(args, '--to-value');
  if (hasBy && hasToValue) error('canvas drag accepts exactly one of --by or --to-value', 'INVALID_ARG');
  if (!hasBy && !hasToValue) error('drag canvas target requires --by dx,dy or --to-value value', 'MISSING_ARG');
  const by = flagValue(args, '--by');
  if (by && !isCoord(by)) error('--by requires x,y', 'INVALID_ARG');
  const toValue = flagValue(args, '--to-value');
  if (toValue && !isNumber(toValue)) error('--to-value requires a number', 'INVALID_ARG');
  const playback = flagValue(args, '--playback');
  if (playback && !['auto', 'immediate', 'human'].includes(playback)) {
    error(`unsupported playback mode '${playback}'`, 'INVALID_PLAYBACK');
  }
}

const args = process.argv.slice(2);
validate(args);

const result = spawnSync(aosPath(), ['__do', 'drag', ...args], {
  encoding: 'utf8',
  env: process.env,
});
if (result.stdout) process.stdout.write(result.stdout);
if (result.stderr) process.stderr.write(result.stderr);
process.exit(result.status ?? 1);
