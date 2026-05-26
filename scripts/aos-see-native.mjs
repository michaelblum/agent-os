#!/usr/bin/env node

import { spawnSync } from 'node:child_process';

function error(message, code) {
  process.stderr.write(`${JSON.stringify({ code, error: message })}\n`);
  process.exit(1);
}

function aosPath() {
  return process.env.AOS_PATH || './aos';
}

const [primitive, ...args] = process.argv.slice(2);
if (!primitive) error('see native wrapper requires a primitive', 'MISSING_ARG');
if (!['capture', 'cursor', 'list', 'selection'].includes(primitive)) {
  error(`Unknown see native primitive: ${primitive}`, 'UNKNOWN_SUBCOMMAND');
}

const result = spawnSync(aosPath(), ['__see', primitive, ...args], {
  encoding: 'utf8',
  env: process.env,
});
if (result.stdout) process.stdout.write(result.stdout);
if (result.stderr) process.stderr.write(result.stderr);
process.exit(result.status ?? 1);
