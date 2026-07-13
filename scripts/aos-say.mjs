#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { sayFollow, writeVoiceCLIError } from './lib/aos-voice-follow.mjs';

function aosPath() {
  return process.env.AOS_PATH || './aos';
}

function error(message, code) {
  process.stderr.write(`${JSON.stringify({ code, error: message })}\n`);
  process.exit(1);
}

function isPositiveInt(value) {
  return /^[1-9]\d*$/.test(value);
}

function isNumeric(value) {
  return /^-?(?:\d+|\d*\.\d+)$/.test(value);
}

function validateSayArgs(args) {
  const valueFlags = new Set(['--voice', '--voice-slot', '--language', '--gender', '--quality-tier', '--rate']);
  const boolFlags = new Set(['--list-voices', '--voices', '--wait']);

  for (let i = 0; i < args.length;) {
    const arg = args[i];
    if (boolFlags.has(arg)) {
      i += 1;
      continue;
    }
    if (valueFlags.has(arg)) {
      if (i + 1 >= args.length || args[i + 1].startsWith('--')) error(`say ${arg} requires a value`, 'MISSING_ARG');
      const value = args[i + 1];
      if (arg === '--voice-slot' && !isPositiveInt(value)) {
        error(`say --voice-slot must be a positive 1-based integer, got ${value}`, 'INVALID_VOICE_SLOT');
      }
      if (arg === '--rate' && !isNumeric(value)) error('say --rate requires a numeric WPM value', 'MISSING_ARG');
      i += 2;
      continue;
    }
    if (arg.startsWith('--')) error(`Unknown say flag: ${arg}`, 'UNKNOWN_FLAG');
    i += 1;
  }
}

function runSayPrimitive(args) {
  validateSayArgs(args);
  const listsVoices = args.includes('--list-voices') || args.includes('--voices');
  const readsStdin = !listsVoices && !process.stdin.isTTY;
  const stdin = readsStdin ? fs.readFileSync(0) : undefined;
  const result = spawnSync(aosPath(), ['__say', ...args], {
    input: stdin,
    env: process.env,
    stdio: [listsVoices ? 'ignore' : process.stdin.isTTY ? 'inherit' : 'pipe', 'pipe', 'pipe'],
  });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  process.exit(result.status ?? 1);
}

const args = process.argv.slice(2);
if (args.includes('--follow')) {
  try {
    await sayFollow(args);
  } catch (error) {
    writeVoiceCLIError(error);
  }
} else {
  runSayPrimitive(args);
}
