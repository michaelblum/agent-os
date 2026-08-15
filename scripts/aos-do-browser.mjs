#!/usr/bin/env node

import {
  executeManagedSessionOperation,
  validateManagedSessionOperation,
} from './lib/browser-companion/session-lifecycle.mjs';
import { parseManagedBrowserTarget, requireSessionOnlyTarget } from './lib/browser-companion/session-target.mjs';
import { ManagedSessionError, sessionErrorReceipt } from './lib/browser-companion/session-model.mjs';

function fail(message, code) {
  process.stderr.write(`${JSON.stringify({ code, error: message })}\n`);
  process.exit(1);
}

function parse(args, valueFlags = [], boolFlags = []) {
  const values = new Set(valueFlags);
  const booleans = new Set(boolFlags);
  const positional = [];
  const options = {};
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (!arg.startsWith('--')) { positional.push(arg); continue; }
    if (values.has(arg)) {
      const value = args[++index];
      if (value === undefined || value.startsWith('--')) fail(`${arg} requires a value`, 'MISSING_ARG');
      options[arg] = value;
    } else if (booleans.has(arg)) options[arg] = true;
    else fail(`Unknown flag: ${arg}`, 'UNKNOWN_FLAG');
  }
  return { positional, options };
}

function dryReceipt(operation, target, identity) {
  return Object.freeze({
    status: 'dry_run',
    action: operation,
    target: `browser:${target.session}`,
    session_generation: identity.session.generation,
    mutation_performed: false,
  });
}

async function runSessionOperation(command, args) {
  const parsed = parse(args, [], command === 'scroll' ? ['--dry-run'] : []);
  if (parsed.positional.length < 1) fail(`aos do ${command} requires a browser session target`, 'MISSING_ARG');
  const parsedTarget = parseManagedBrowserTarget(parsed.positional[0]);
  if (parsedTarget.ref) fail('browser Observation Ref actions remain unsupported', 'TARGET_ACTION_UNSUPPORTED');
  const target = requireSessionOnlyTarget(parsed.positional[0]);
  let operation = command;
  let input = {};
  if (command === 'navigate') {
    if (parsed.positional.length !== 2) fail('navigate requires exactly one URL', 'MISSING_ARG');
    input = { url: parsed.positional[1] };
  } else if (command === 'type') {
    if (parsed.positional.length !== 2) fail('type requires exactly one text argument', 'MISSING_ARG');
    input = { text: parsed.positional[1] };
  } else if (command === 'key') {
    if (parsed.positional.length !== 2) fail('key requires exactly one key combo', 'MISSING_ARG');
    input = { key: parsed.positional[1] };
  } else if (command === 'scroll') {
    if (parsed.positional.length !== 2) fail('scroll requires exactly one x,y delta', 'MISSING_ARG');
    const values = String(parsed.positional[1]).split(',');
    if (values.length !== 2 || values.some((value) => !/^-?[0-9]+$/u.test(value))) fail('scroll delta must be x,y integers', 'INVALID_ARG');
    input = { delta_x: Number(values[0]), delta_y: Number(values[1]) };
  } else {
    fail('browser Observation Ref actions remain unsupported', 'TARGET_ACTION_UNSUPPORTED');
  }
  if (parsed.options['--dry-run']) {
    const validated = await validateManagedSessionOperation(target.session, operation, input);
    process.stdout.write(`${JSON.stringify(dryReceipt(operation, target, validated))}\n`);
    return;
  }
  const result = await executeManagedSessionOperation(target.session, operation, input);
  process.stdout.write(`${JSON.stringify({
    status: 'success',
    action: command,
    result: result.receipt,
    execution: {
      strategy: `managed_playwright_${operation}`,
      backend: 'managed_playwright_companion',
      session_generation: result.receipt.session_generation,
      fallback_used: false,
    },
  })}\n`);
}

function rejectRefOperation(command, args) {
  const parsed = parse(args, [], ['--dry-run']);
  const arity = command === 'drag' || command === 'fill' ? 2 : 1;
  if (parsed.positional.length !== arity) fail(`aos do ${command} arguments differ`, 'INVALID_ARG');
  const targets = command === 'drag' ? parsed.positional : [parsed.positional[0]];
  for (const value of targets) {
    const target = parseManagedBrowserTarget(value);
    if (!target.ref) fail('browser Observation Ref target is required', 'INVALID_ARG');
  }
  fail('browser Observation Ref actions remain unsupported', 'TARGET_ACTION_UNSUPPORTED');
}

try {
  const [command, ...args] = process.argv.slice(2);
  if (['navigate', 'type', 'key', 'scroll'].includes(command)) await runSessionOperation(command, args);
  else if (['fill', 'click', 'hover', 'drag'].includes(command)) rejectRefOperation(command, args);
  else fail(`Unknown do browser command: ${command ?? ''}`, 'UNKNOWN_COMMAND');
} catch (error) {
  if (error instanceof ManagedSessionError || error?.code?.startsWith?.('COMPANION_')) {
    process.stderr.write(`${JSON.stringify(sessionErrorReceipt(error, 'operate'))}\n`);
    process.exitCode = 1;
  } else throw error;
}
