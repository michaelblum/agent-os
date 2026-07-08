#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import {
  directNativeAxProofStory,
  NATIVE_AX_SAVED_REF_REQUIRED_IDENTITY_FACTS,
  nativeAxNoForegroundConformance,
} from './lib/agent-workspace/contracts.mjs';

function error(message, code) {
  process.stderr.write(`${JSON.stringify({ code, error: message })}\n`);
  process.exit(1);
}

function unknownArg(arg) {
  error(`Unknown ${String(arg).startsWith('--') ? 'flag' : 'argument'}: ${arg}`, String(arg).startsWith('--') ? 'UNKNOWN_FLAG' : 'UNKNOWN_ARG');
}

function aosPath() {
  return process.env.AOS_PATH || './aos';
}

const valueFlags = new Set([
  '--pid', '--role', '--title', '--label', '--identifier',
  '--index', '--near', '--match', '--depth', '--timeout',
  '--profile', '--value', '--to', '--dy', '--dx', '--window',
  '--delay', '--variance', '--dwell', '--steps', '--speed',
  '--state-id',
]);
const booleanFlags = new Set(['--dry-run', '--right', '--double']);

const intFlags = new Set(['--index', '--depth', '--timeout', '--window', '--dwell', '--steps']);
const numberFlags = new Set(['--dx', '--dy', '--delay', '--variance', '--speed']);
const coordFlags = new Set(['--near', '--to']);

function positionalArgEntries(args) {
  const entries = [];
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg.startsWith('--')) {
      if (valueFlags.has(arg)) {
        i += 1;
        if (i >= args.length || args[i].startsWith('--')) error(`${arg} requires a value`, 'MISSING_ARG');
      } else if (!booleanFlags.has(arg)) {
        unknownArg(arg);
      }
      continue;
    }
    entries.push({ index: i, value: arg });
  }
  return entries;
}

function positionalArgs(args) {
  return positionalArgEntries(args).map((entry) => entry.value);
}

function flagValue(args, flag) {
  const index = args.indexOf(flag);
  if (index < 0) return null;
  return args[index + 1] ?? null;
}

function flagPresence(args, flag) {
  return args.includes(flag);
}

function flagIndexes(args, flag) {
  return args
    .map((arg, index) => (arg === flag ? index : null))
    .filter((index) => index !== null);
}

function requireFlag(args, flag, message, validator = (value) => Boolean(value)) {
  const value = flagValue(args, flag);
  if (!validator(value)) error(message, 'MISSING_ARG');
}

function isCoord(value) {
  return /^-?\d+(?:\.\d+)?,-?\d+(?:\.\d+)?$/.test(value);
}

function isInt(value) {
  return /^-?[0-9]+$/.test(String(value));
}

function isNumber(value) {
  return /^-?(?:\d+|\d*\.\d+)$/.test(String(value));
}

function validateFlagTypes(args) {
  for (let i = 0; i < args.length; i += 1) {
    const flag = args[i];
    if (!flag.startsWith('--') || !valueFlags.has(flag)) continue;
    const value = args[i + 1];
    if (value === undefined || String(value).startsWith('--')) continue;
    if (intFlags.has(flag) && !isInt(value)) error(`${flag} requires an integer`, 'INVALID_ARG');
    if (numberFlags.has(flag) && !isNumber(value)) error(`${flag} requires a number`, 'INVALID_ARG');
    if (coordFlags.has(flag) && !isCoord(value)) error(`${flag} requires x,y`, 'INVALID_ARG');
  }
}

function setValueSource(args, targetIndex = null) {
  const valueFlagIndexes = flagIndexes(args, '--value');
  if (valueFlagIndexes.length > 1) {
    error('set-value accepts at most one --value flag', 'INVALID_ARG');
  }
  const valueFlagIndex = valueFlagIndexes[0] ?? -1;
  const positionalValues = positionalArgEntries(args).filter((entry) => entry.index !== targetIndex);
  const hasFlagValue = valueFlagIndex >= 0;
  if (hasFlagValue && positionalValues.length > 0) {
    error('set-value accepts exactly one value source: --value or a positional value', 'INVALID_ARG');
  }
  if (!hasFlagValue && positionalValues.length > 1) {
    unknownArg(positionalValues[1].value);
  }
  if (hasFlagValue) {
    return { kind: 'flag', value: args[valueFlagIndex + 1], index: valueFlagIndex };
  }
  if (positionalValues.length === 1) {
    return { kind: 'positional', value: positionalValues[0].value, index: positionalValues[0].index };
  }
  return null;
}

function normalizeSetValueArgs(args) {
  const positionalEntries = positionalArgEntries(args);
  const source = setValueSource(args);
  if (!source || source.kind === 'flag') return args;
  return [
    ...args.slice(0, source.index),
    ...args.slice(source.index + 1),
    '--value',
    source.value,
  ];
}

function validate(verb, args) {
  const pos = positionalArgs(args);
  validateFlagTypes(args);
  switch (verb) {
    case 'click':
      if (pos[0]?.startsWith('browser:')) error('native do click does not accept browser targets', 'INVALID_TARGET');
      if (!(pos[0] && isCoord(pos[0]))) error('click requires coordinates (x,y)', 'MISSING_ARG');
      if (pos.length > 1) unknownArg(pos[1]);
      break;
    case 'hover':
      if (pos[0]?.startsWith('browser:')) error('native do hover does not accept browser targets', 'INVALID_TARGET');
      if (!(pos[0] && isCoord(pos[0]))) error('hover requires coordinates (x,y)', 'MISSING_ARG');
      if (pos.length > 1) unknownArg(pos[1]);
      break;
    case 'drag':
      if (pos.some((arg) => arg.startsWith('browser:'))) error('native do drag does not accept browser targets', 'INVALID_TARGET');
      if (!(pos.length >= 2 && isCoord(pos[0]) && isCoord(pos[1]))) error('drag requires two coordinate pairs (x1,y1 x2,y2)', 'MISSING_ARG');
      if (pos.length > 2) unknownArg(pos[2]);
      break;
    case 'scroll':
      if (pos[0]?.startsWith('browser:')) error('native do scroll does not accept browser targets', 'INVALID_TARGET');
      if (!(pos[0] && isCoord(pos[0]))) error('scroll requires coordinates (x,y)', 'MISSING_ARG');
      if (!args.includes('--dx') && !args.includes('--dy')) error('scroll requires at least one of --dx or --dy', 'MISSING_ARG');
      if (pos.length > 1) unknownArg(pos[1]);
      break;
    case 'type':
      if (pos[0]?.startsWith('browser:')) error('native do type does not accept browser targets', 'INVALID_TARGET');
      if (!pos[0]) error('type requires a text argument', 'MISSING_ARG');
      if (pos.length > 1) unknownArg(pos[1]);
      break;
    case 'key':
      if (pos[0]?.startsWith('browser:')) error('native do key does not accept browser targets', 'INVALID_TARGET');
      if (!pos[0]) error('key requires a key combo argument (e.g. cmd+s)', 'MISSING_ARG');
      if (pos.length > 1) unknownArg(pos[1]);
      break;
    case 'press':
      if (pos.length > 0) unknownArg(pos[0]);
      requireFlag(args, '--pid', 'press requires --pid', isInt);
      requireFlag(args, '--role', 'press requires --role');
      break;
    case 'set-value':
      requireFlag(args, '--pid', 'set-value requires --pid', isInt);
      requireFlag(args, '--role', 'set-value requires --role');
      if (!setValueSource(args)) error('set-value requires --value or a positional value', 'MISSING_ARG');
      break;
    case 'focus':
      if (pos.length > 0) unknownArg(pos[0]);
      requireFlag(args, '--pid', 'focus requires --pid', isInt);
      requireFlag(args, '--role', 'focus requires --role');
      break;
    case 'raise':
      if (pos.length > 0) unknownArg(pos[0]);
      requireFlag(args, '--pid', 'raise requires --pid', isInt);
      break;
    case 'move':
      if (pos.length > 0) unknownArg(pos[0]);
      requireFlag(args, '--pid', 'move requires --pid', isInt);
      requireFlag(args, '--to', 'move requires --to x,y', isCoord);
      break;
    case 'resize':
      if (pos.length > 0) unknownArg(pos[0]);
      requireFlag(args, '--pid', 'resize requires --pid', isInt);
      requireFlag(args, '--to', 'resize requires --to w,h', isCoord);
      break;
    case 'close':
    case 'minimize':
    case 'maximize':
    case 'restore':
      if (pos.length > 0) unknownArg(pos[0]);
      requireFlag(args, '--pid', `${verb} requires --pid`, isInt);
      requireFlag(args, '--window', `${verb} requires --window`, isInt);
      break;
    case 'activate':
    case 'quit':
    case 'hide':
    case 'unhide':
      if (pos.length > 0) unknownArg(pos[0]);
      requireFlag(args, '--pid', `${verb} requires --pid`, isInt);
      break;
    case 'tell':
      if (pos.length < 2) error('tell requires an app name and a script body', 'MISSING_ARG');
      break;
    default:
      break;
  }
}

function parseJSON(text) {
  const trimmed = String(text || '').trim();
  if (!trimmed) return null;
  try {
    return JSON.parse(trimmed);
  } catch {
    return null;
  }
}

function present(value) {
  if (value === null || value === undefined) return false;
  if (Array.isArray(value)) return value.length > 0;
  return String(value).length > 0;
}

function directNativeAXFacts(args) {
  return {
    app_pid: flagValue(args, '--pid') ? Number(flagValue(args, '--pid')) : null,
    window_id: flagValue(args, '--window') ? Number(flagValue(args, '--window')) : null,
    role: flagValue(args, '--role'),
    title: flagValue(args, '--title'),
    label: flagValue(args, '--label'),
    ax_identifier: flagValue(args, '--identifier'),
    index: flagValue(args, '--index') ? Number(flagValue(args, '--index')) : null,
    near: flagValue(args, '--near'),
    match: flagValue(args, '--match'),
    depth: flagValue(args, '--depth') ? Number(flagValue(args, '--depth')) : null,
    timeout_ms: flagValue(args, '--timeout') ? Number(flagValue(args, '--timeout')) : null,
  };
}

function directNativeAXAvailableIdentityFacts(facts) {
  const available = [];
  if (present(facts.app_pid)) available.push('app_pid');
  if (present(facts.window_id)) available.push('window_id');
  if (present(facts.ax_identifier)) {
    available.push('ax_identifier');
    available.push('ax_identifier_or_stable_path');
  }
  for (const key of ['role', 'title', 'label', 'index', 'near', 'match', 'depth', 'timeout_ms']) {
    if (present(facts[key])) available.push(key);
  }
  return available;
}

function payloadBoolean(payload, key) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return false;
  return payload[key] === true || payload.execution?.[key] === true;
}

function directNativeNoForegroundConformance(payload) {
  return nativeAxNoForegroundConformance({
    fallbackUsed: payloadBoolean(payload, 'fallback_used'),
    foregroundFallbackRequired: payloadBoolean(payload, 'foreground_fallback_required'),
    focusPreservation: payload?.execution?.foreground_preservation,
  });
}

function directNativeAXConformance(verb, args, payload = null) {
  const dryRun = flagPresence(args, '--dry-run');
  const facts = directNativeAXFacts(args);
  const availableIdentityFacts = directNativeAXAvailableIdentityFacts(facts);
  const availableSet = new Set(availableIdentityFacts);
  const noForeground = directNativeNoForegroundConformance(payload);
  const fallbackReported = noForeground.fallback_used || noForeground.foreground_fallback_required;
  return {
    actionability: 'direct_ax_action',
    mutation: dryRun ? 'not_attempted_dry_run' : 'attempted_direct_native_action',
    validation: 'direct_ax_current_matching_semantics',
    proof_level: 'native_primitive_response_plus_wrapper_contract',
    proof: directNativeAxProofStory(),
    no_foreground: noForeground,
    target_uncertainty: {
      status: 'direct_ax_current_matching',
      reasons: [
        'direct AX actions use caller-provided current pid, role, and filter matching instead of saved-ref durable identity',
        dryRun
          ? 'dry-run validates command shape but does not prove current enabled state, current element uniqueness, or no-foreground behavior'
          : 'the wrapper reports the native primitive result but has no enabled-state, focus, cursor, Space, permission, or fallback baseline',
        ...(fallbackReported
          ? ['the underlying native action reported fallback use; no foreground-preservation guarantee is claimed']
          : []),
      ],
      missing_identity_facts: NATIVE_AX_SAVED_REF_REQUIRED_IDENTITY_FACTS.filter((fact) => !availableSet.has(fact)),
      available_identity_facts: availableIdentityFacts,
    },
    known_limits: [
      'direct AX actions use current AX matching semantics and do not make saved-ref durable identity claims',
      'no foreground, focus, cursor, or Space preservation guarantee is claimed by this wrapper',
      `native ${verb} responses require live HITL proof before no-foreground conformance can be upgraded`,
      ...(fallbackReported
        ? ['underlying native action reported fallback use; treat the result as foreground fallback, not no-foreground proof']
        : []),
    ],
  };
}

function directNativeAXTarget(args) {
  return directNativeAXFacts(args);
}

function mergeKnownLimits(existing, next) {
  return [...new Set([...(Array.isArray(existing) ? existing : []), ...next])];
}

function isDirectNativeAXAction(verb, args) {
  if (!['press', 'set-value', 'focus'].includes(verb)) return false;
  return args.includes('--pid');
}

function augmentDirectNativeAXPayload(payload, verb, args) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null;
  const conformance = directNativeAXConformance(verb, args, payload);
  return {
    ...payload,
    direct_target: directNativeAXTarget(args),
    conformance,
    known_limits: mergeKnownLimits(payload.known_limits, conformance.known_limits),
  };
}

function maybeEmitAugmentedDirectNativeAXResult(verb, args, result) {
  if (!isDirectNativeAXAction(verb, args)) return false;

  const stdoutPayload = parseJSON(result.stdout);
  const stderrPayload = parseJSON(result.stderr);
  if (stdoutPayload) {
    const payload = augmentDirectNativeAXPayload(stdoutPayload, verb, args);
    if (!payload) return false;
    process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
    if (result.stderr && !stderrPayload) process.stderr.write(result.stderr);
    return true;
  }

  if (stderrPayload) {
    if (result.stdout) process.stdout.write(result.stdout);
    const payload = augmentDirectNativeAXPayload(stderrPayload, verb, args);
    if (!payload) return false;
    process.stderr.write(`${JSON.stringify(payload, null, 2)}\n`);
    return true;
  }

  return false;
}

const [verb, ...args] = process.argv.slice(2);
if (!verb) error('do native wrapper requires a primitive', 'MISSING_ARG');
validate(verb, args);

const dispatchArgs = verb === 'set-value' ? normalizeSetValueArgs(args) : args;
const result = spawnSync(aosPath(), ['__do', verb, ...dispatchArgs], {
  encoding: 'utf8',
  env: process.env,
});
if (maybeEmitAugmentedDirectNativeAXResult(verb, dispatchArgs, result)) process.exit(result.status ?? 1);
if (result.stdout) process.stdout.write(result.stdout);
if (result.stderr) process.stderr.write(result.stderr);
process.exit(result.status ?? 1);
