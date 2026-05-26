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

const valueFlags = new Set([
  '--pid', '--role', '--title', '--label', '--identifier',
  '--index', '--near', '--match', '--depth', '--timeout',
  '--profile', '--value', '--to', '--dy', '--dx', '--window',
  '--delay', '--variance', '--dwell', '--steps', '--speed',
  '--state-id',
]);
const booleanFlags = new Set(['--dry-run']);

function positionalArgs(args) {
  const positional = [];
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
    positional.push(arg);
  }
  return positional;
}

function flagValue(args, flag) {
  const index = args.indexOf(flag);
  if (index < 0) return null;
  return args[index + 1] ?? null;
}

function requireFlag(args, flag, message, validator = (value) => Boolean(value)) {
  const value = flagValue(args, flag);
  if (!validator(value)) error(message, 'MISSING_ARG');
}

function isCoord(value) {
  return /^-?\d+(?:\.\d+)?,-?\d+(?:\.\d+)?$/.test(value);
}

function validate(verb, args) {
  const pos = positionalArgs(args);
  switch (verb) {
    case 'click':
      if (pos[0]?.startsWith('browser:')) error('native do click does not accept browser targets', 'INVALID_TARGET');
      if (!(pos[0] && (isCoord(pos[0]) || pos[0].startsWith('canvas:')))) error('click requires coordinates (x,y) or canvas:<canvas-id>/<ref>', 'MISSING_ARG');
      if (pos.length > 1) unknownArg(pos[1]);
      break;
    case 'hover':
      if (pos[0]?.startsWith('browser:')) error('native do hover does not accept browser targets', 'INVALID_TARGET');
      if (!(pos[0] && isCoord(pos[0]))) error('hover requires coordinates (x,y)', 'MISSING_ARG');
      if (pos.length > 1) unknownArg(pos[1]);
      break;
    case 'drag':
      if (pos.some((arg) => arg.startsWith('browser:'))) error('native do drag does not accept browser targets', 'INVALID_TARGET');
      if (!(pos.length >= 2 && isCoord(pos[0]) && isCoord(pos[1]))) error('drag requires two coordinate pairs (x1,y1 x2,y2)', 'MISSING_ARG');
      if (pos.length > 2) unknownArg(pos[2]);
      break;
    case 'scroll':
      if (pos[0]?.startsWith('browser:')) error('native do scroll does not accept browser targets', 'INVALID_TARGET');
      if (!(pos[0] && isCoord(pos[0]))) error('scroll requires coordinates (x,y)', 'MISSING_ARG');
      if (!args.includes('--dx') && !args.includes('--dy')) error('scroll requires at least one of --dx or --dy', 'MISSING_ARG');
      if (pos.length > 1) unknownArg(pos[1]);
      break;
    case 'type':
      if (pos[0]?.startsWith('browser:')) error('native do type does not accept browser targets', 'INVALID_TARGET');
      if (!pos[0]) error('type requires a text argument', 'MISSING_ARG');
      if (pos.length > 1) unknownArg(pos[1]);
      break;
    case 'key':
      if (pos[0]?.startsWith('browser:')) error('native do key does not accept browser targets', 'INVALID_TARGET');
      if (!pos[0]) error('key requires a key combo argument (e.g. cmd+s)', 'MISSING_ARG');
      if (pos.length > 1) unknownArg(pos[1]);
      break;
    case 'press':
      requireFlag(args, '--pid', 'press requires --pid');
      break;
    case 'set-value':
      requireFlag(args, '--pid', 'set-value requires --pid');
      requireFlag(args, '--role', 'set-value requires --role');
      requireFlag(args, '--value', 'set-value requires --value');
      break;
    case 'focus':
      requireFlag(args, '--pid', 'focus requires --pid');
      requireFlag(args, '--role', 'focus requires --role');
      break;
    case 'raise':
      requireFlag(args, '--pid', 'raise requires --pid');
      break;
    case 'move':
      requireFlag(args, '--pid', 'move requires --pid');
      requireFlag(args, '--to', 'move requires --to x,y', isCoord);
      break;
    case 'resize':
      requireFlag(args, '--pid', 'resize requires --pid');
      requireFlag(args, '--to', 'resize requires --to w,h', isCoord);
      break;
    case 'tell':
      if (pos.length < 2) error('tell requires an app name and a script body', 'MISSING_ARG');
      break;
    default:
      break;
  }
}

const [verb, ...args] = process.argv.slice(2);
if (!verb) error('do native wrapper requires a primitive', 'MISSING_ARG');
validate(verb, args);

const result = spawnSync(aosPath(), ['__do', verb, ...args], {
  encoding: 'utf8',
  env: process.env,
});
if (result.stdout) process.stdout.write(result.stdout);
if (result.stderr) process.stderr.write(result.stderr);
process.exit(result.status ?? 1);
