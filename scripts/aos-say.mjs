#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';

function aosPath() {
  return process.env.AOS_PATH || './aos';
}

function runSayPrimitive(args) {
  const stdin = process.stdin.isTTY ? undefined : fs.readFileSync(0);
  const result = spawnSync(aosPath(), ['__say', ...args], {
    input: stdin,
    env: process.env,
    stdio: process.stdin.isTTY ? ['inherit', 'pipe', 'pipe'] : ['pipe', 'pipe', 'pipe'],
  });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  process.exit(result.status ?? 1);
}

runSayPrimitive(process.argv.slice(2));
