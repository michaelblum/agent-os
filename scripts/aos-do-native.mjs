#!/usr/bin/env node

import { spawnSync } from 'node:child_process';

function error(message, code) {
  process.stderr.write(`${JSON.stringify({ code, error: message })}\n`);
  process.exit(1);
}

function aosPath() {
  return process.env.AOS_PATH || './aos';
}

function positionalArgs(args) {
  const positional = [];
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg.startsWith('--')) {
      if (['--state-id', '--dwell', '--speed', '--dx', '--dy', '--delay', '--variance', '--pid', '--role', '--title', '--description', '--value', '--window', '--to', '--profile'].includes(arg)) {
        i += 1;
      }
      continue;
    }
    positional.push(arg);
  }
  return positional;
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
      break;
    case 'hover':
      if (pos[0]?.startsWith('browser:')) error('native do hover does not accept browser targets', 'INVALID_TARGET');
      if (!(pos[0] && isCoord(pos[0]))) error('hover requires coordinates (x,y)', 'MISSING_ARG');
      break;
    case 'drag':
      if (pos.some((arg) => arg.startsWith('browser:'))) error('native do drag does not accept browser targets', 'INVALID_TARGET');
      if (!(pos.length >= 2 && isCoord(pos[0]) && isCoord(pos[1]))) error('drag requires two coordinate pairs (x1,y1 x2,y2)', 'MISSING_ARG');
      break;
    case 'scroll':
      if (pos[0]?.startsWith('browser:')) error('native do scroll does not accept browser targets', 'INVALID_TARGET');
      if (!(pos[0] && isCoord(pos[0]))) error('scroll requires coordinates (x,y)', 'MISSING_ARG');
      if (!args.includes('--dx') && !args.includes('--dy')) error('scroll requires at least one of --dx or --dy', 'MISSING_ARG');
      break;
    case 'type':
      if (pos[0]?.startsWith('browser:')) error('native do type does not accept browser targets', 'INVALID_TARGET');
      if (!pos[0]) error('type requires a text argument', 'MISSING_ARG');
      break;
    case 'key':
      if (pos[0]?.startsWith('browser:')) error('native do key does not accept browser targets', 'INVALID_TARGET');
      if (!pos[0]) error('key requires a key combo argument (e.g. cmd+s)', 'MISSING_ARG');
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
