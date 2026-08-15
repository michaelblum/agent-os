#!/usr/bin/env node

import { focusDaemonRequest } from './lib/focus-daemon.mjs';
import { parseFocusDepth } from './lib/focus-depth.mjs';
import {
  createManagedSession,
  listManagedSessions,
  removeManagedSession,
} from './lib/browser-companion/session-lifecycle.mjs';
import { ManagedSessionError, sessionErrorReceipt } from './lib/browser-companion/session-model.mjs';

function fail(message, code) {
  process.stderr.write(`${JSON.stringify({ code, error: message })}\n`);
  process.exit(1);
}

function emit(value) {
  if (value?.error) fail(value.error, value.code ?? 'DAEMON_ERROR');
  process.stdout.write(`${JSON.stringify(value)}\n`);
}

function parse(args, valueFlags = [], boolFlags = []) {
  const values = new Set(valueFlags);
  const booleans = new Set(boolFlags);
  const out = {};
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    const equals = arg.indexOf('=');
    const key = equals >= 0 ? arg.slice(0, equals) : arg;
    if (values.has(key)) {
      const value = equals >= 0 ? arg.slice(equals + 1) : args[++index];
      if (!value || value.startsWith('--')) fail(`${key} requires a value`, 'MISSING_ARG');
      if (Object.hasOwn(out, key)) fail(`${key} may be provided only once`, 'INVALID_ARG');
      out[key] = value;
    } else if (booleans.has(key) && equals < 0) out[key] = true;
    else fail(`Unknown ${arg.startsWith('--') ? 'flag' : 'argument'}: ${arg}`, arg.startsWith('--') ? 'UNKNOWN_FLAG' : 'UNKNOWN_ARG');
  }
  return out;
}

function positiveInteger(value, flag) {
  if (value === undefined) return undefined;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) fail(`${flag} is invalid`, 'INVALID_ARG');
  return parsed;
}

function subtree(values) {
  const result = {};
  for (const [flag, key] of [['--subtree-role', 'role'], ['--subtree-title', 'title'], ['--subtree-identifier', 'identifier']]) {
    if (values[flag]) result[key] = values[flag];
  }
  return Object.keys(result).length ? result : undefined;
}

async function browserCreate(id, values) {
  const target = values['--target'];
  if (!['browser://attach', 'browser://new'].includes(target)) fail('invalid --target', 'INVALID_ARG');
  if (target === 'browser://attach') {
    const extension = values['--extension'];
    const cdp = values['--cdp'];
    if (extension !== undefined && extension !== 'chrome') fail('--extension must equal chrome', 'INVALID_ARG');
    if (values['--headless'] || values['--persistent'] || values['--url']) {
      fail('attached sessions forbid launch options', 'INVALID_ARG');
    }
    if ((extension === 'chrome') === Boolean(cdp)) fail('attach requires exactly one of --extension=chrome or --cdp <url>', 'INVALID_ARG');
    return createManagedSession(id, cdp
      ? { kind: 'attached', attach_kind: 'cdp', cdp_url: cdp }
      : { kind: 'attached', attach_kind: 'extension' });
  }
  if (values['--extension'] || values['--cdp']) fail('launched sessions forbid attach options', 'INVALID_ARG');
  return createManagedSession(id, {
    kind: 'launched', headless: values['--headless'] === true,
    persistent: values['--persistent'] === true, url: values['--url'],
  });
}

async function focusCreate(args) {
  const values = parse(args,
    ['--id', '--target', '--window', '--pid', '--depth', '--subtree-role', '--subtree-title', '--subtree-identifier', '--cdp', '--url', '--extension'],
    ['--headless', '--persistent']);
  const id = values['--id'];
  if (!id) fail('--id is required', 'MISSING_ARG');
  if (values['--target'] && values['--window']) fail('--target and --window are mutually exclusive', 'INVALID_ARG');
  if (values['--target']) {
    if (values['--pid'] || values['--depth'] || subtree(values)) fail('browser targets forbid native focus options', 'INVALID_ARG');
    return emit(await browserCreate(id, values));
  }
  if (values['--extension'] || values['--cdp'] || values['--url']
    || values['--headless'] || values['--persistent']) {
    fail('native window targets forbid browser session options', 'INVALID_ARG');
  }
  const windowId = positiveInteger(values['--window'], '--window');
  if (!windowId) fail('--window is required', 'MISSING_ARG');
  const data = { id, window_id: windowId };
  const pid = positiveInteger(values['--pid'], '--pid');
  const depth = parseFocusDepth(values['--depth'], fail);
  if (pid) data.pid = pid;
  if (depth !== undefined) data.depth = depth;
  if (subtree(values)) data.subtree = subtree(values);
  emit(await focusDaemonRequest('focus', 'create', data));
}

async function focusCommand(args) {
  const [subcommand, ...rest] = args;
  if (subcommand === 'create') return focusCreate(rest);
  if (subcommand === 'update') {
    const values = parse(rest, ['--id', '--depth', '--subtree-role', '--subtree-title', '--subtree-identifier']);
    if (!values['--id']) fail('--id is required', 'MISSING_ARG');
    const data = { id: values['--id'] };
    if (values['--depth'] !== undefined) data.depth = parseFocusDepth(values['--depth'], fail);
    if (subtree(values)) data.subtree = subtree(values);
    return emit(await focusDaemonRequest('focus', 'update', data));
  }
  if (subcommand === 'list') {
    parse(rest);
    const native = await focusDaemonRequest('focus', 'list', {}, { autoStart: false, optional: true });
    let browser = { sessions: [] };
    try { browser = await listManagedSessions(); } catch (error) {
      if (error?.code !== 'BROWSER_SESSION_NOT_ACTIVE') throw error;
    }
    return emit({ status: 'ok', channels: [
      ...((native?.channels ?? native?.data?.channels ?? []).map((entry) => ({ ...entry, kind: 'window' }))),
      ...browser.sessions.map((session) => ({ kind: 'browser', session: session.id, mode: session.ownership === 'attached' ? 'attach' : 'launched', attach: session.attach_kind, ...session })),
    ] });
  }
  if (subcommand === 'remove') {
    const values = parse(rest, ['--id', '--backend']);
    if (!values['--id']) fail('--id is required', 'MISSING_ARG');
    if (!['browser', 'native'].includes(values['--backend'])) {
      fail('--backend must be browser or native', values['--backend'] ? 'INVALID_ARG' : 'MISSING_ARG');
    }
    if (values['--backend'] === 'browser') return emit(await removeManagedSession(values['--id']));
    return emit(await focusDaemonRequest('focus', 'remove', { id: values['--id'] }));
  }
  fail(`Unknown focus subcommand: ${subcommand ?? ''}`, 'UNKNOWN_COMMAND');
}

async function graphCommand(args) {
  const [subcommand, ...rest] = args;
  if (['displays', 'windows'].includes(subcommand)) {
    const values = parse(rest, subcommand === 'windows' ? ['--display'] : []);
    return emit(await focusDaemonRequest('graph', subcommand, values['--display'] ? { display: Number(values['--display']) } : {}));
  }
  if (['deepen', 'collapse'].includes(subcommand)) {
    const values = parse(rest, ['--id', '--depth', '--subtree-role', '--subtree-title', '--subtree-identifier']);
    if (!values['--id']) fail('--id is required', 'MISSING_ARG');
    const data = { id: values['--id'] };
    if (values['--depth'] !== undefined) data.depth = parseFocusDepth(values['--depth'], fail);
    if (subcommand === 'deepen' && subtree(values)) data.subtree = subtree(values);
    return emit(await focusDaemonRequest('graph', subcommand, data));
  }
  fail(`Unknown graph subcommand: ${subcommand ?? ''}`, 'UNKNOWN_COMMAND');
}

try {
  const [command, ...args] = process.argv.slice(2);
  if (command === 'focus') await focusCommand(args);
  else if (command === 'graph') await graphCommand(args);
  else if (command === 'daemon-snapshot') emit(await focusDaemonRequest('see', 'snapshot'));
  else fail(`Unknown focus/graph command: ${command ?? ''}`, 'UNKNOWN_COMMAND');
} catch (error) {
  if (error instanceof ManagedSessionError || error?.code?.startsWith?.('COMPANION_')) {
    process.stderr.write(`${JSON.stringify(sessionErrorReceipt(error, 'focus'))}\n`);
    process.exitCode = 1;
  } else throw error;
}
