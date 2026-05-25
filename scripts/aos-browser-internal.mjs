#!/usr/bin/env node

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';

function error(message, code) {
  process.stderr.write(`${JSON.stringify({ code, error: message }, null, 2)}\n`);
  process.exit(1);
}

function runtimeMode() {
  return process.env.AOS_RUNTIME_MODE?.toLowerCase() === 'installed' ? 'installed' : 'repo';
}

function stateDir() {
  return path.join(path.resolve(process.env.AOS_STATE_ROOT || path.join(os.homedir(), '.config/aos')), runtimeMode());
}

function registryPath() {
  const dir = path.join(stateDir(), 'browser');
  fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, 'sessions.json');
}

function parseBrowserTarget(input) {
  if (!input.startsWith('browser:')) {
    throw ['INVALID_TARGET', "invalid target: target must start with 'browser:'"];
  }
  const remainder = input.slice('browser:'.length);
  if (remainder === '') {
    const session = process.env.PLAYWRIGHT_CLI_SESSION;
    if (!session) throw ['MISSING_SESSION', 'PLAYWRIGHT_CLI_SESSION not set and no session in target'];
    validateSession(session);
    return { ref: null, session };
  }
  if (remainder.startsWith('/')) {
    throw ['INVALID_TARGET', "invalid target: unexpected '/' after 'browser:'"];
  }
  const parts = remainder.split('/');
  if (parts.length === 1) {
    validateSession(parts[0]);
    return { ref: null, session: parts[0] };
  }
  if (parts.length === 2) {
    validateSession(parts[0]);
    validateRef(parts[1]);
    return { ref: parts[1], session: parts[0] };
  }
  throw ['INVALID_TARGET', "invalid target: too many '/' segments; v1 supports only browser:<session>[/<ref>]"];
}

function validateSession(value) {
  if (!value) throw ['INVALID_TARGET', 'invalid target: empty session name'];
  if (!/^[A-Za-z0-9_-]+$/.test(value)) {
    throw ['INVALID_TARGET', 'invalid target: session name must match [A-Za-z0-9_-]+'];
  }
}

function validateRef(value) {
  if (!value) throw ['INVALID_TARGET', 'invalid target: empty ref'];
  if (!/^[A-Za-z0-9]+$/.test(value)) {
    throw ['INVALID_TARGET', 'invalid target: ref must match [A-Za-z0-9]+'];
  }
}

function readRegistry() {
  const file = registryPath();
  if (!fs.existsSync(file)) return [];
  try {
    const raw = fs.readFileSync(file, 'utf8');
    if (!raw.trim()) return [];
    return JSON.parse(raw);
  } catch (err) {
    error(String(err), 'INTERNAL');
  }
}

function stableRecord(record) {
  return {
    active_url: record.active_url ?? null,
    attach_kind: record.attach_kind ?? null,
    browser_window_id: record.browser_window_id ?? null,
    headless: record.headless ?? null,
    id: record.id,
    mode: record.mode,
    updated_at: record.updated_at,
  };
}

function writeRegistry(records) {
  fs.writeFileSync(registryPath(), `${JSON.stringify(records.map(stableRecord), null, 2)}\n`);
}

function parseEq(args, key) {
  const prefix = `${key}=`;
  const found = args.find((arg) => arg.startsWith(prefix));
  return found ? found.slice(prefix.length) : undefined;
}

function isoNow() {
  return new Date().toISOString().replace('Z', '000Z');
}

function runPlaywrightCommand(args) {
  let session = '';
  let verb = '';
  let withFilename = false;
  for (const arg of args) {
    if (arg.startsWith('--session=')) session = arg.slice('--session='.length);
    else if (arg.startsWith('--verb=')) verb = arg.slice('--verb='.length);
    else if (arg === '--with-filename') withFilename = true;
  }
  if (!session || !verb) error('--session=<s> and --verb=<v> are required', 'MISSING_ARG');

  const argv = [`-s=${session}`, verb];
  let filename = null;
  if (withFilename) {
    const scratch = path.join(process.cwd(), '.aos-browser-tmp');
    fs.mkdirSync(scratch, { recursive: true });
    filename = path.join(scratch, `aos-pw-${crypto.randomUUID()}.md`);
    argv.push(`--filename=${filename}`);
  }
  const result = spawnSync('/usr/bin/env', ['playwright-cli', ...argv], {
    encoding: 'utf8',
    env: process.env,
    maxBuffer: 100 * 1024 * 1024,
  });
  if (result.error && result.status === null) {
    error(`launch failed: ${result.error.message}`, 'PLAYWRIGHT_CLI_LAUNCH_FAILED');
  }
  process.stdout.write(`${JSON.stringify({
    exit_code: result.status ?? 1,
    stdout: (result.stdout || '').trim(),
    stderr: (result.stderr || '').trim(),
    filename,
  })}\n`);
}

function registryCommand(args) {
  const [op, ...rest] = args;
  if (!op) error('Usage: aos browser _registry <op> ...', 'MISSING_ARG');
  const records = readRegistry();
  switch (op) {
    case 'list':
      process.stdout.write(`${JSON.stringify(records.map(stableRecord))}\n`);
      return;
    case 'add': {
      const id = parseEq(rest, '--id');
      const mode = parseEq(rest, '--mode');
      if (!id || !mode) error('--id and --mode required', 'MISSING_ARG');
      if (records.some((record) => record.id === id)) error(`session already registered: ${id}`, 'DUPLICATE_ID');
      const headlessRaw = parseEq(rest, '--headless');
      const winRaw = parseEq(rest, '--browser-window-id');
      records.push(stableRecord({
        id,
        mode,
        attach_kind: parseEq(rest, '--attach-kind') ?? null,
        headless: headlessRaw === undefined ? null : headlessRaw === 'true',
        browser_window_id: winRaw === undefined ? null : Number(winRaw),
        active_url: null,
        updated_at: isoNow(),
      }));
      writeRegistry(records);
      process.stdout.write('{"status":"ok"}\n');
      return;
    }
    case 'remove': {
      const id = parseEq(rest, '--id');
      if (!id) error('--id required', 'MISSING_ARG');
      if (!records.some((record) => record.id === id)) error(`session not found: ${id}`, 'NOT_FOUND');
      writeRegistry(records.filter((record) => record.id !== id));
      process.stdout.write('{"status":"ok"}\n');
      return;
    }
    case 'find': {
      const id = parseEq(rest, '--id');
      if (!id) error('--id required', 'MISSING_ARG');
      const record = records.find((item) => item.id === id);
      if (!record) error(`not found: ${id}`, 'NOT_FOUND');
      process.stdout.write(`${JSON.stringify(stableRecord(record))}\n`);
      return;
    }
    default:
      error(`Unknown registry op: ${op}`, 'UNKNOWN_SUBCOMMAND');
  }
}

const [command, ...args] = process.argv.slice(2);
try {
  switch (command) {
    case '_parse-target':
      if (args.length === 0) error('Usage: aos browser _parse-target <target>', 'MISSING_ARG');
      process.stdout.write(`${JSON.stringify(parseBrowserTarget(args[0]))}\n`);
      break;
    case '_registry':
      registryCommand(args);
      break;
    case '_run':
      runPlaywrightCommand(args);
      break;
    default:
      error(`Unknown browser internal command: ${command ?? ''}`, 'UNKNOWN_SUBCOMMAND');
  }
} catch (err) {
  if (Array.isArray(err)) error(err[1], err[0]);
  error(String(err), 'INTERNAL');
}
