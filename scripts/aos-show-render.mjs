#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';

function error(message, code) {
  process.stderr.write(`${JSON.stringify({ code, error: message })}\n`);
  process.exit(1);
}

function unknownArg(arg) {
  const text = String(arg);
  if (text.startsWith('-')) error(`Unknown flag: ${text}`, 'UNKNOWN_FLAG');
  error(`Unknown argument: ${text}`, 'UNKNOWN_ARG');
}

function aosPath() {
  return process.env.AOS_PATH || './aos';
}

function parseArgs(args) {
  const parsed = {
    width: '800',
    height: '600',
    html: null,
    file: null,
    out: null,
    base64: false,
  };
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    switch (arg) {
      case '--width': {
        i += 1;
        if (i >= args.length || !/^[1-9][0-9]*$/.test(args[i])) {
          error('--width requires a positive integer', 'INVALID_ARG');
        }
        parsed.width = args[i];
        break;
      }
      case '--height': {
        i += 1;
        if (i >= args.length || !/^[1-9][0-9]*$/.test(args[i])) {
          error('--height requires a positive integer', 'INVALID_ARG');
        }
        parsed.height = args[i];
        break;
      }
      case '--html':
        i += 1;
        if (i >= args.length) error('--html requires a value', 'MISSING_ARG');
        parsed.html = args[i];
        break;
      case '--file':
        i += 1;
        if (i >= args.length) error('--file requires a path', 'MISSING_ARG');
        parsed.file = args[i];
        break;
      case '--out':
        i += 1;
        if (i >= args.length) error('--out requires a path', 'MISSING_ARG');
        parsed.out = args[i];
        break;
      case '--base64':
        parsed.base64 = true;
        break;
      default:
        unknownArg(arg);
    }
  }
  if (!parsed.html && !parsed.file && process.stdin.isTTY) {
    error('No HTML content provided. Use --html, --file, or pipe to stdin.', 'NO_CONTENT');
  }
  if (!parsed.base64 && !parsed.out) {
    error('Specify --out <path> or --base64 for output', 'NO_OUTPUT');
  }
  return parsed;
}

function primitiveArgs(parsed) {
  const args = ['__render', '--width', parsed.width, '--height', parsed.height];
  if (parsed.html !== null) args.push('--html', parsed.html);
  if (parsed.file !== null) args.push('--file', parsed.file);
  if (parsed.out !== null) args.push('--out', parsed.out);
  if (parsed.base64) args.push('--base64');
  return args;
}

const parsed = parseArgs(process.argv.slice(2));
const stdin = process.stdin.isTTY ? undefined : fs.readFileSync(0);
const result = spawnSync(aosPath(), primitiveArgs(parsed), {
  input: stdin,
  env: process.env,
  stdio: process.stdin.isTTY ? ['inherit', 'pipe', 'pipe'] : ['pipe', 'pipe', 'pipe'],
});
if (result.stdout) process.stdout.write(result.stdout);
if (result.stderr) process.stderr.write(result.stderr);
process.exit(result.status ?? 1);
