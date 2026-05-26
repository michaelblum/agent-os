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

function unknownArgError(arg) {
  if (arg.startsWith('-')) error(`Unknown flag: ${arg}`, 'UNKNOWN_FLAG');
  error(`Unknown argument: ${arg}`, 'UNKNOWN_ARG');
}

function requireExactArgs(args, usage) {
  if (args.length === 0) error(usage, 'MISSING_ARG');
  if (args.length > 1) unknownArgError(args[1]);
}

function parseAllowedEqArgs(args, allowed) {
  const seen = new Set();
  for (const arg of args) {
    const equals = arg.indexOf('=');
    const key = equals >= 0 ? arg.slice(0, equals) : arg;
    if (!allowed.has(key)) unknownArgError(arg);
    if (equals < 0) error(`Missing value for ${key}`, 'MISSING_ARG');
    seen.add(key);
  }
  return seen;
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
    else unknownArgError(arg);
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

function stripListMarker(line) {
  let columns = 0;
  let i = 0;
  while (i < line.length && (line[i] === ' ' || line[i] === '\t')) {
    columns += line[i] === '\t' ? 2 : 1;
    i += 1;
  }
  if (line[i] !== '-') return null;
  i += 1;
  while (i < line.length && (line[i] === ' ' || line[i] === '\t')) i += 1;
  const body = line.slice(i);
  if (!body) return null;
  return { indent: Math.floor(columns / 2), body };
}

function readQuoted(text, start) {
  let value = '';
  let escaped = false;
  for (let i = start + 1; i < text.length; i += 1) {
    const ch = text[i];
    if (escaped) {
      value += ch;
      escaped = false;
    } else if (ch === '\\') {
      escaped = true;
    } else if (ch === '"') {
      return { value, next: i + 1 };
    } else {
      value += ch;
    }
  }
  return null;
}

function findClosingBracket(text, start) {
  let inQuote = false;
  let escaped = false;
  for (let i = start + 1; i < text.length; i += 1) {
    const ch = text[i];
    if (escaped) escaped = false;
    else if (inQuote) {
      if (ch === '\\') escaped = true;
      else if (ch === '"') inQuote = false;
    } else if (ch === '"') inQuote = true;
    else if (ch === ']') return i;
  }
  return -1;
}

function parseBracketMarker(inner) {
  const trimmed = inner.trim();
  if (!trimmed) return null;
  const equals = trimmed.indexOf('=');
  if (equals < 0) return { key: trimmed, value: null };
  const key = trimmed.slice(0, equals).trim();
  if (!key) return null;
  const rawValue = trimmed.slice(equals + 1).trim();
  if (rawValue.startsWith('"')) {
    const quoted = readQuoted(rawValue, 0);
    if (quoted && quoted.next === rawValue.length) return { key, value: quoted.value };
  }
  return { key, value: rawValue };
}

function parseInlineFields(text) {
  let title;
  const markers = {};
  const flags = new Set();
  for (let i = 0; i < text.length;) {
    if (text[i] === '"') {
      const quoted = readQuoted(text, i);
      if (quoted) {
        if (title === undefined) title = quoted.value;
        i = quoted.next;
        continue;
      }
    } else if (text[i] === '[') {
      const close = findClosingBracket(text, i);
      if (close >= 0) {
        const marker = parseBracketMarker(text.slice(i + 1, close));
        if (marker) {
          if (marker.value === null) flags.add(marker.key);
          else markers[marker.key] = marker.value;
        }
        i = close + 1;
        continue;
      }
    }
    i += 1;
  }
  return { title, markers, flags };
}

function parseSnapshotLine(body) {
  let text = body.endsWith(':') ? body.slice(0, -1) : body;
  const match = text.match(/^(\S+)(?:\s+(.*))?$/);
  if (!match) return null;
  const role = match[1].trim();
  const rest = match[2] || '';
  if (!role || role.startsWith('/')) return null;
  const inline = parseInlineFields(rest);
  const ref = inline.markers.ref;
  if (!ref || !/^[A-Za-z0-9_-]+$/.test(ref)) return null;
  const out = {
    context_path: [],
    enabled: !inline.flags.has('disabled'),
    ref,
    role,
  };
  if (inline.title !== undefined) out.title = inline.title;
  if (inline.markers.value !== undefined) out.value = inline.markers.value;
  return out;
}

function parseSnapshotMarkdown(contents) {
  const elements = [];
  const stack = [];
  for (const line of contents.split('\n')) {
    const stripped = stripListMarker(line);
    if (!stripped) continue;
    const parsed = parseSnapshotLine(stripped.body);
    if (!parsed) continue;
    while (stack.length > 0 && stack[stack.length - 1].indent >= stripped.indent) stack.pop();
    parsed.context_path = stack.map((item) => item.role);
    elements.push(parsed);
    stack.push({ indent: stripped.indent, role: parsed.role });
  }
  return elements;
}

function parseSnapshotCommand(args) {
  requireExactArgs(args, 'Usage: aos browser _parse-snapshot <markdown-file>');
  const file = args[0];
  let contents;
  try {
    contents = fs.readFileSync(file, 'utf8');
  } catch {
    error(`Snapshot markdown not found: ${file}`, 'SNAPSHOT_READ_FAILED');
  }
  process.stdout.write(`${JSON.stringify(parseSnapshotMarkdown(contents), null, 2)}\n`);
}

function detectPlaywrightErrorMarker(stdout) {
  const index = stdout.indexOf('### Error');
  if (index < 0) return null;
  const after = stdout.slice(index + '### Error'.length).trim();
  const next = after.indexOf('\n### ');
  return (next >= 0 ? after.slice(0, next) : after).trim();
}

function parsePlaywrightResultBody(stdout) {
  if (detectPlaywrightErrorMarker(stdout)) return null;
  const trimmed = stdout.trim();
  const index = trimmed.indexOf('### Result');
  if (index < 0) return trimmed;
  const after = trimmed.slice(index + '### Result'.length).trim();
  const next = after.indexOf('\n### ');
  return next >= 0 ? after.slice(0, next) : after;
}

function boundsViaEval(session, ref) {
  const js = '(e) => { const r = e.getBoundingClientRect(); return {x:r.left,y:r.top,w:r.width,h:r.height}; }';
  const result = spawnSync('/usr/bin/env', ['playwright-cli', `-s=${session}`, 'eval', js, ref], {
    encoding: 'utf8',
    env: process.env,
    maxBuffer: 100 * 1024 * 1024,
  });
  if (result.status !== 0) return null;
  const body = parsePlaywrightResultBody(result.stdout || '');
  if (body === null) return null;
  try {
    const rect = JSON.parse(body);
    if (rect.w === 0 && rect.h === 0) return null;
    return [Math.trunc(rect.x), Math.trunc(rect.y), Math.trunc(rect.w), Math.trunc(rect.h)];
  } catch {
    return null;
  }
}

function resolveAnchorCommand(args) {
  requireExactArgs(args, 'Usage: aos browser _resolve-anchor <target>');
  const input = args[0];
  const target = parseBrowserTarget(input);
  const record = readRegistry().find((item) => item.id === target.session);
  if (!record) error(`browser session '${target.session}' not registered`, 'NOT_FOUND');
  if (record.browser_window_id === null || record.browser_window_id === undefined) {
    if (record.headless === true) error('headless browser sessions cannot be anchored (no CGWindowID)', 'BROWSER_HEADLESS');
    error('browser session has no local window (remote CDP or unmatched)', 'BROWSER_NOT_LOCAL');
  }
  if (!target.ref) {
    process.stdout.write(`${JSON.stringify({ anchor_window: record.browser_window_id, offset: [0, 0, 0, 0] })}\n`);
    return;
  }
  const offset = boundsViaEval(target.session, target.ref);
  if (!offset) error(`bounds query returned nil or zero-sized rect for ref ${target.ref}`, 'ANCHOR_EVAL_FAILED');
  process.stdout.write(`${JSON.stringify({ anchor_window: record.browser_window_id, offset })}\n`);
}

function registryCommand(args) {
  const [op, ...rest] = args;
  if (!op) error('Usage: aos browser _registry <op> ...', 'MISSING_ARG');
  const records = readRegistry();
  switch (op) {
    case 'list':
      if (rest.length > 0) unknownArgError(rest[0]);
      process.stdout.write(`${JSON.stringify(records.map(stableRecord))}\n`);
      return;
    case 'add': {
      parseAllowedEqArgs(rest, new Set(['--id', '--mode', '--attach-kind', '--headless', '--browser-window-id']));
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
      parseAllowedEqArgs(rest, new Set(['--id']));
      const id = parseEq(rest, '--id');
      if (!id) error('--id required', 'MISSING_ARG');
      if (!records.some((record) => record.id === id)) error(`session not found: ${id}`, 'NOT_FOUND');
      writeRegistry(records.filter((record) => record.id !== id));
      process.stdout.write('{"status":"ok"}\n');
      return;
    }
    case 'find': {
      parseAllowedEqArgs(rest, new Set(['--id']));
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
  if (!command) error('Usage: aos browser _<op> ...', 'MISSING_ARG');
  switch (command) {
    case '_parse-target':
      requireExactArgs(args, 'Usage: aos browser _parse-target <target>');
      process.stdout.write(`${JSON.stringify(parseBrowserTarget(args[0]))}\n`);
      break;
    case '_registry':
      registryCommand(args);
      break;
    case '_run':
      runPlaywrightCommand(args);
      break;
    case '_parse-snapshot':
      parseSnapshotCommand(args);
      break;
    case '_resolve-anchor':
      resolveAnchorCommand(args);
      break;
    default:
      error(`Unknown internal subcommand: ${command}`, 'UNKNOWN_SUBCOMMAND');
  }
} catch (err) {
  if (Array.isArray(err)) error(err[1], err[0]);
  error(String(err), 'INTERNAL');
}
