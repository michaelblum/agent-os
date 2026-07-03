#!/usr/bin/env node

import { spawnSync } from 'node:child_process';

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

const verbValueFlags = new Map([
  ['click', new Set(['--dwell', '--state-id'])],
  ['set-value', new Set(['--value', '--state-id', '--pid', '--role'])],
  ['drag', new Set(['--by', '--to-value', '--playback', '--state-id'])],
]);
const verbBooleanFlags = new Map([
  ['click', new Set(['--dry-run', '--right', '--double'])],
  ['set-value', new Set(['--dry-run'])],
  ['drag', new Set(['--dry-run'])],
]);

function valueFlags(verb) {
  return verbValueFlags.get(verb) ?? new Set();
}

function booleanFlags(verb) {
  return verbBooleanFlags.get(verb) ?? new Set();
}

function positionalArgEntries(verb, args) {
  const entries = [];
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg.startsWith('--')) {
      if (valueFlags(verb).has(arg)) {
        i += 1;
        if (i >= args.length || args[i].startsWith('--')) error(`${arg} requires a value`, 'MISSING_ARG');
      } else if (!booleanFlags(verb).has(arg)) {
        unknownArg(arg);
      }
      continue;
    }
    entries.push({ index: i, value: arg });
  }
  return entries;
}

function flagIndexes(args, flag) {
  return args
    .map((arg, index) => (arg === flag ? index : null))
    .filter((index) => index !== null);
}

function flagValue(args, flag) {
  const indexes = flagIndexes(args, flag);
  if (indexes.length === 0) return null;
  return args[indexes[0] + 1] ?? null;
}

function flagPresence(args, flag) {
  return flagIndexes(args, flag).length > 0;
}

function rejectDuplicateFlags(verb, args, flags) {
  for (const flag of flags) {
    if (flagIndexes(args, flag).length > 1) {
      error(`canvas ${verb} accepts at most one ${flag} flag`, 'INVALID_ARG');
    }
  }
}

function isCoord(value) {
  return /^-?\d+(?:\.\d+)?,-?\d+(?:\.\d+)?$/.test(String(value));
}

function isInt(value) {
  return /^-?[0-9]+$/.test(String(value));
}

function isNumber(value) {
  return /^-?(?:\d+|\d*\.\d+)$/.test(String(value));
}

function validateCanvasTarget(verb, pos) {
  if (!pos[0]) error(`${verb} canvas target requires canvas:<canvas-id>/<ref>`, 'MISSING_ARG');
  if (!pos[0].startsWith('canvas:')) error(`canvas ${verb} requires canvas:<canvas-id>/<ref>`, 'INVALID_TARGET');
}

function validateClick(args) {
  const pos = positionalArgEntries('click', args).map((entry) => entry.value);
  validateCanvasTarget('click', pos);
  if (pos.length > 1) unknownArg(pos[1]);
  const dwell = flagValue(args, '--dwell');
  if (dwell && !isInt(dwell)) error('--dwell requires an integer', 'INVALID_ARG');
}

function setValueSource(args, targetIndex) {
  const valueFlagIndexes = flagIndexes(args, '--value');
  if (valueFlagIndexes.length > 1) {
    error('set-value accepts at most one --value flag', 'INVALID_ARG');
  }
  const valueFlagIndex = valueFlagIndexes[0] ?? -1;
  const positionalValues = positionalArgEntries('set-value', args).filter((entry) => entry.index !== targetIndex);
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
  const positionalEntries = positionalArgEntries('set-value', args);
  const target = positionalEntries[0] ?? null;
  validateCanvasTarget('set-value', positionalEntries.map((entry) => entry.value));
  if (flagPresence(args, '--pid') || flagPresence(args, '--role')) {
    error('set-value accepts exactly one target source: target or --pid/--role', 'INVALID_ARG');
  }
  const source = setValueSource(args, target.index);
  if (!source) error('set-value requires --value or a positional value', 'MISSING_ARG');
  if (source.kind === 'flag') return args;
  return [
    ...args.slice(0, source.index),
    ...args.slice(source.index + 1),
    '--value',
    source.value,
  ];
}

function validateDrag(args) {
  const pos = positionalArgEntries('drag', args).map((entry) => entry.value);
  validateCanvasTarget('drag', pos);
  if (pos.length > 1) unknownArg(pos[1]);
  rejectDuplicateFlags('drag', args, ['--by', '--to-value', '--playback']);
  const hasBy = flagPresence(args, '--by');
  const hasToValue = flagPresence(args, '--to-value');
  if (hasBy && hasToValue) error('canvas drag accepts exactly one of --by or --to-value', 'INVALID_ARG');
  if (!hasBy && !hasToValue) error('drag canvas target requires --by dx,dy or --to-value value', 'MISSING_ARG');
  const by = flagValue(args, '--by');
  if (by && !isCoord(by)) error('--by requires x,y', 'INVALID_ARG');
  const toValue = flagValue(args, '--to-value');
  if (toValue && !isNumber(toValue)) error('--to-value requires a number', 'INVALID_ARG');
  const playback = flagValue(args, '--playback');
  if (playback && !['auto', 'immediate', 'human'].includes(playback)) {
    error(`unsupported playback mode '${playback}'`, 'INVALID_PLAYBACK');
  }
}

function validate(verb, args) {
  switch (verb) {
    case 'click':
      validateClick(args);
      return args;
    case 'set-value':
      return normalizeSetValueArgs(args);
    case 'drag':
      validateDrag(args);
      return args;
    default:
      error(`unsupported canvas action: ${verb}`, 'INVALID_ARG');
  }
}

const [verb, ...args] = process.argv.slice(2);
if (!verb) error('do canvas wrapper requires a primitive', 'MISSING_ARG');
const dispatchArgs = validate(verb, args);

const result = spawnSync(aosPath(), ['__do', verb, ...dispatchArgs], {
  encoding: 'utf8',
  env: process.env,
});
if (result.stdout) process.stdout.write(result.stdout);
if (result.stderr) process.stderr.write(result.stderr);
process.exit(result.status ?? 1);
