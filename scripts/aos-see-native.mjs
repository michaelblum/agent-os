#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import {
  parseCaptureArgs,
  savedCaptureCommand,
} from './lib/aos-agent-workspace.mjs';

function error(message, code) {
  process.stderr.write(`${JSON.stringify({ code, error: message })}\n`);
  process.exit(1);
}

function aosPath() {
  return process.env.AOS_PATH || './aos';
}

function parseNoArgPrimitive(primitive, args) {
  for (const arg of args) {
    if (arg === '--json') continue;
    if (String(arg).startsWith('--')) error(`Unknown see ${primitive} flag: ${arg}`, 'UNKNOWN_FLAG');
    error(`Unknown see ${primitive} argument: ${arg}`, 'UNKNOWN_ARG');
  }
}

const [primitive, ...args] = process.argv.slice(2);
if (!primitive) error('see native wrapper requires a primitive', 'MISSING_ARG');
if (!['capture', 'cursor', 'list', 'selection'].includes(primitive)) {
  error(`Unknown see native primitive: ${primitive}`, 'UNKNOWN_SUBCOMMAND');
}
let savedCapture = null;
if (primitive === 'capture') {
  savedCapture = parseCaptureArgs(args);
  if (savedCapture.errors.length) {
    const first = savedCapture.errors[0];
    error(first.error, first.code);
  }
}
if (['cursor', 'list', 'selection'].includes(primitive)) parseNoArgPrimitive(primitive, args);

if (primitive === 'capture' && savedCapture?.options.save) {
  await savedCaptureCommand(args, savedCapture);
  process.exit(0);
}

const result = spawnSync(aosPath(), ['__see', primitive, ...args], {
  encoding: 'utf8',
  env: process.env,
});
if (result.stdout) process.stdout.write(result.stdout);
if (result.stderr) process.stderr.write(result.stderr);
process.exit(result.status ?? 1);
