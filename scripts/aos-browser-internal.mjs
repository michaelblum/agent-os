#!/usr/bin/env node

import fs from 'node:fs';

import { executeManagedSessionOperation, managedSessionIdentity } from './lib/browser-companion/session-lifecycle.mjs';
import { parseManagedBrowserTarget } from './lib/browser-companion/session-target.mjs';
import { parseSnapshotMarkdown } from './lib/browser-companion/snapshot-parser.mjs';
import { ManagedSessionError, sessionErrorReceipt } from './lib/browser-companion/session-model.mjs';

function fail(message, code) {
  process.stderr.write(`${JSON.stringify({ code, error: message })}\n`);
  process.exit(1);
}

function parseEq(args, allowed) {
  const result = {};
  for (const arg of args) {
    const index = arg.indexOf('=');
    const key = index >= 0 ? arg.slice(0, index) : arg;
    if (!allowed.has(key)) fail(`Unknown ${arg.startsWith('--') ? 'flag' : 'argument'}: ${arg}`, arg.startsWith('--') ? 'UNKNOWN_FLAG' : 'UNKNOWN_ARG');
    if (index < 0 || index === arg.length - 1) fail(`${key} requires a value`, 'MISSING_ARG');
    if (Object.hasOwn(result, key)) fail(`${key} may be provided only once`, 'INVALID_ARG');
    result[key] = arg.slice(index + 1);
  }
  return result;
}

async function query(operation, args) {
  const values = parseEq(args, new Set(['--session', '--ref']));
  if (!values['--session']) fail('--session=<id> is required', 'MISSING_ARG');
  const input = values['--ref'] ? { ref: values['--ref'] } : {};
  const result = await executeManagedSessionOperation(values['--session'], operation, input);
  process.stdout.write(`${JSON.stringify({ status: 'ok', operation, session_generation: result.receipt.session_generation, result: result.worker.result })}\n`);
}

try {
  const [command, ...args] = process.argv.slice(2);
  if (command === '_parse-target') {
    if (args.length !== 1) fail('Usage: aos browser _parse-target <target>', 'INVALID_ARG');
    process.stdout.write(`${JSON.stringify(parseManagedBrowserTarget(args[0]))}\n`);
  } else if (command === '_parse-snapshot') {
    if (args.length !== 1) fail('Usage: aos browser _parse-snapshot <markdown-file>', 'INVALID_ARG');
    let markdown;
    try { markdown = fs.readFileSync(args[0], 'utf8'); } catch { fail('snapshot markdown is unreadable', 'SNAPSHOT_READ_FAILED'); }
    process.stdout.write(`${JSON.stringify(parseSnapshotMarkdown(markdown))}\n`);
  } else if (command === '_identity') {
    const values = parseEq(args, new Set(['--session']));
    if (!values['--session']) fail('--session=<id> is required', 'MISSING_ARG');
    process.stdout.write(`${JSON.stringify(await managedSessionIdentity(values['--session']))}\n`);
  } else if (command === '_page-identity') await query('page_identity', args);
  else fail(`Unknown internal subcommand: ${command ?? ''}`, 'UNKNOWN_SUBCOMMAND');
} catch (error) {
  if (error instanceof ManagedSessionError || error?.code?.startsWith?.('COMPANION_')) {
    process.stderr.write(`${JSON.stringify(sessionErrorReceipt(error, 'internal'))}\n`);
    process.exitCode = 1;
  } else throw error;
}
