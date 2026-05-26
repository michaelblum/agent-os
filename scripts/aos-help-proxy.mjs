#!/usr/bin/env node

import { spawnSync } from 'node:child_process';

function error(message, code) {
  process.stderr.write(`${JSON.stringify({ code, error: message })}\n`);
  process.exit(1);
}

function aosPath() {
  return process.env.AOS_PATH || './aos';
}

const [family, ...args] = process.argv.slice(2);
if (!family) error('help proxy requires a command family', 'MISSING_ARG');

const result = spawnSync(aosPath(), ['help', family, ...args], {
  encoding: 'utf8',
  env: process.env,
});
if (result.stdout) process.stdout.write(result.stdout);
if (result.stderr) process.stderr.write(result.stderr);
process.exit(result.status ?? 1);
