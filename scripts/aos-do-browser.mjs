#!/usr/bin/env node

import { spawnSync } from 'node:child_process';

function error(message, code) {
  process.stderr.write(`{\n  "code" : ${JSON.stringify(code)},\n  "error" : ${JSON.stringify(message)}\n}\n`);
  process.exit(1);
}

function unknownArg(arg) {
  error(`Unknown ${String(arg).startsWith('--') ? 'flag' : 'argument'}: ${arg}`, String(arg).startsWith('--') ? 'UNKNOWN_FLAG' : 'UNKNOWN_ARG');
}

function aosPath() {
  return process.env.AOS_PATH || './aos';
}

function parseBrowserTarget(input) {
  if (!input.startsWith('browser:')) {
    throw ['INVALID_TARGET', "invalid target: target must start with 'browser:'"];
  }
  const remainder = input.slice('browser:'.length);
  if (remainder === '') {
    const session = process.env.PLAYWRIGHT_CLI_SESSION;
    if (!session) throw ['MISSING_SESSION', 'PLAYWRIGHT_CLI_SESSION not set'];
    validateSession(session);
    return { session, ref: null };
  }
  if (remainder.startsWith('/')) {
    throw ['INVALID_TARGET', "invalid target: unexpected '/' after 'browser:'"];
  }
  const parts = remainder.split('/');
  if (parts.length === 1) {
    validateSession(parts[0]);
    return { session: parts[0], ref: null };
  }
  if (parts.length === 2) {
    validateSession(parts[0]);
    validateRef(parts[1]);
    return { session: parts[0], ref: parts[1] };
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

function positionalArgs(args, allowedFlags = []) {
  const positional = [];
  const valueFlags = new Set(['--state-id']);
  const allowed = new Set(['--state-id', ...allowedFlags]);
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg.startsWith('--') && !allowed.has(arg)) unknownArg(arg);
    if (valueFlags.has(arg)) {
      i += 1;
      if (i >= args.length || args[i].startsWith('--')) error(`${arg} requires a value`, 'MISSING_ARG');
      continue;
    }
    if (!arg.startsWith('--')) positional.push(arg);
  }
  return positional;
}

function getArg(args, flag) {
  const index = args.indexOf(flag);
  return index >= 0 && index + 1 < args.length ? args[index + 1] : undefined;
}

function ensureVersion() {
  const result = spawnSync(aosPath(), ['browser', '_check-version', '--json'], {
    encoding: 'utf8',
    env: process.env,
  });
  if (result.status === 0) return;
  const raw = result.stderr.trim() || result.stdout.trim();
  try {
    const parsed = JSON.parse(raw);
    error(parsed.error || raw, parsed.code || 'PLAYWRIGHT_CLI_PROBE_FAILED');
  } catch {
    error(raw || 'version probe error', 'PLAYWRIGHT_CLI_PROBE_FAILED');
  }
}

function runPlaywright(session, verb, args) {
  const result = spawnSync('/usr/bin/env', ['playwright-cli', `-s=${session}`, verb, ...args], {
    encoding: 'utf8',
    env: process.env,
    maxBuffer: 100 * 1024 * 1024,
  });
  if (result.error && result.status === null) {
    error(`launch failed: ${result.error.message}`, 'PLAYWRIGHT_CLI_LAUNCH_FAILED');
  }
  return {
    exit_code: result.status ?? 1,
    stdout: (result.stdout || '').trim(),
    stderr: (result.stderr || '').trim(),
    filename: null,
  };
}

function detectPlaywrightError(stdout) {
  const lines = String(stdout || '').split(/\r?\n/);
  const index = lines.findIndex((line) => line.trim() === '### Error');
  if (index < 0) return null;
  return lines.slice(index + 1).join('\n').trim() || 'playwright-cli reported an error';
}

function requireSuccess(result, action) {
  if (result.exit_code !== 0) {
    const message = result.stderr || result.stdout;
    error(`${action} failed (exit ${result.exit_code}): ${message}`, 'PLAYWRIGHT_CLI_FAILED');
  }
  const marker = detectPlaywrightError(result.stdout);
  if (marker) error(`${action} failed: ${marker}`, 'PLAYWRIGHT_CLI_FAILED');
}

function emitDoResult(result, strategy, stateID) {
  const execution = {
    strategy,
    backend: 'playwright',
    fallback_used: false,
  };
  if (stateID !== undefined) execution.state_id = stateID;
  process.stdout.write(`${JSON.stringify({
    status: result.exit_code === 0 ? 'success' : 'error',
    result,
    execution,
  })}\n`);
}

function fillCommand(args) {
  const positional = positionalArgs(args);
  if (positional.length < 2) error('Usage: aos do fill <browser:<s>/<ref>> <text>', 'MISSING_ARG');
  if (positional.length > 2) unknownArg(positional[2]);
  const [targetString, text] = positional;
  if (!targetString.startsWith('browser:')) {
    error('aos do fill is browser-only in v1. Target must be browser:<s>/<ref>.', 'BROWSER_ONLY');
  }
  const target = parseBrowserTarget(targetString);
  if (!target.ref) error('aos do fill requires a ref (browser:<session>/<ref>)', 'INVALID_TARGET');
  ensureVersion();
  const result = runPlaywright(target.session, 'fill', [target.ref, text]);
  requireSuccess(result, 'fill');
  emitDoResult(result, 'playwright_fill', getArg(args, '--state-id'));
}

function navigateCommand(args) {
  if (args.length < 2) error('Usage: aos do navigate <browser:<s>> <url>', 'MISSING_ARG');
  for (const arg of args) if (arg.startsWith('--')) unknownArg(arg);
  if (args.length > 2) unknownArg(args[2]);
  const [targetString, url] = args;
  if (!targetString.startsWith('browser:')) error('aos do navigate is browser-only in v1.', 'BROWSER_ONLY');
  const target = parseBrowserTarget(targetString);
  if (target.ref) error('aos do navigate targets a browser session, not an element ref (use browser:<session>).', 'INVALID_TARGET');
  ensureVersion();
  const result = runPlaywright(target.session, 'goto', [url]);
  requireSuccess(result, 'goto');
  emitDoResult(result, 'playwright_goto', undefined);
}

function singleTargetCommand(command, args) {
  const positional = positionalArgs(args, command === 'click' ? ['--double', '--right'] : []);
  if (positional.length < 1) error(`Usage: aos do ${command} <browser:<s>[/<ref>]>`, 'MISSING_ARG');
  const target = parseBrowserTarget(positional[0]);
  ensureVersion();

  let verb = command;
  let extra = [];
  let strategy = `playwright_${command}`;
  if (command === 'click') {
    if (positional.length > 1) unknownArg(positional[1]);
    if (args.includes('--double')) {
      verb = 'dblclick';
      strategy = 'playwright_dblclick';
    } else {
      extra = args.includes('--right') ? ['right'] : [];
    }
  } else if (command === 'scroll') {
    if (positional.length > 2) unknownArg(positional[2]);
    const deltas = positional[1]?.split(',') || [];
    if (deltas.length === 2) extra = [deltas[0], deltas[1]];
    verb = 'mousewheel';
    strategy = 'playwright_mousewheel';
  } else if (command === 'type') {
    if (positional.length < 2) error('type requires a text argument', 'MISSING_ARG');
    if (positional.length > 2) unknownArg(positional[2]);
    extra = [positional[1]];
  } else if (command === 'key') {
    if (positional.length < 2) error('key requires a key combo argument (e.g. cmd+s)', 'MISSING_ARG');
    if (positional.length > 2) unknownArg(positional[2]);
    verb = 'press';
    strategy = 'playwright_press';
    extra = [positional[1]];
  } else if (positional.length > 1) {
    unknownArg(positional[1]);
  }

  const argv = [];
  if (target.ref) argv.push(target.ref);
  argv.push(...extra);
  const result = runPlaywright(target.session, verb, argv);
  requireSuccess(result, verb);
  emitDoResult(result, strategy, getArg(args, '--state-id'));
}

function dragCommand(args) {
  const positional = positionalArgs(args);
  if (positional.length < 2) error('drag requires two browser targets', 'MISSING_ARG');
  if (positional.length > 2) unknownArg(positional[2]);
  const from = parseBrowserTarget(positional[0]);
  const to = parseBrowserTarget(positional[1]);
  if (from.session !== to.session) error('drag endpoints must share the same browser session', 'INVALID_TARGET');
  if (!from.ref || !to.ref) error('drag requires ref on both endpoints (browser:<s>/<ref>)', 'INVALID_TARGET');
  ensureVersion();
  const result = runPlaywright(from.session, 'drag', [from.ref, to.ref]);
  requireSuccess(result, 'drag');
  emitDoResult(result, 'playwright_drag', getArg(args, '--state-id'));
}

try {
  const [command, ...args] = process.argv.slice(2);
  if (command === 'fill') fillCommand(args);
  else if (command === 'navigate') navigateCommand(args);
  else if (['click', 'hover', 'scroll', 'type', 'key'].includes(command)) singleTargetCommand(command, args);
  else if (command === 'drag') dragCommand(args);
  else error(`Unknown do browser command: ${command ?? ''}`, 'UNKNOWN_COMMAND');
} catch (err) {
  if (Array.isArray(err)) error(err[1], err[0]);
  error(String(err), 'INTERNAL');
}
