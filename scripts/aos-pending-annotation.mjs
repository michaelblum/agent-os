#!/usr/bin/env node

import fs from 'node:fs';
import {
  consumePendingAnnotation,
  createPendingAnnotation,
  deletePendingAnnotation,
  emitPendingAnnotationError,
  isPendingAnnotationError,
  linkPendingAnnotationWorkRecord,
  listPendingAnnotations,
  readPendingAnnotation,
} from './lib/pending-annotations.mjs';

function printJSON(value) {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

function error(message, code, extra = {}) {
  const err = new Error(message);
  err.name = 'PendingAnnotationError';
  err.code = code;
  err.extra = extra;
  err.toJSON = () => ({ code, error: message, ...extra });
  throw err;
}

const VALUE_FLAGS = new Set([
  '--id',
  '--target-kind',
  '--target-summary',
  '--comment',
  '--workspace',
  '--snapshot',
  '--ref',
  '--fallback-kind',
  '--fallback-summary',
  '--fallback-reason',
  '--artifact',
  '--next-argv',
  '--from-json',
  '--from-capture-json',
  '--work-record',
  '--relation',
  '--link-status',
  '--source',
  '--actor',
  '--state',
]);

const BOOL_FLAGS = new Set(['--json']);

function parseArgs(args, allowedFlags) {
  const values = new Map();
  const positionals = [];
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg.startsWith('--')) {
      if (!allowedFlags.has(arg)) error(`Unknown flag: ${arg}`, 'UNKNOWN_FLAG');
      if (BOOL_FLAGS.has(arg)) {
        values.set(arg, true);
        continue;
      }
      if (!VALUE_FLAGS.has(arg)) error(`Unknown flag: ${arg}`, 'UNKNOWN_FLAG');
      if (i + 1 >= args.length || args[i + 1].startsWith('--')) {
        error(`${arg} requires a value`, 'MISSING_ARG');
      }
      const existing = values.get(arg);
      if (arg === '--artifact' || arg === '--next-argv') {
        values.set(arg, [...(existing || []), args[i + 1]]);
      } else {
        values.set(arg, args[i + 1]);
      }
      i += 1;
      continue;
    }
    positionals.push(arg);
  }
  return { values, positionals };
}

function parseJSONArg(value, label) {
  try {
    return JSON.parse(value);
  } catch (err) {
    error(`${label} must be valid JSON: ${err.message}`, 'INVALID_ARG');
  }
}

function loadJSONInput(file, label = '--from-json') {
  if (file === '-') {
    return parseJSONArg(fs.readFileSync(0, 'utf8'), label);
  }
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (err) {
    error(`Cannot read annotation JSON input: ${file}`, 'INVALID_ARG', { path: file, flag: label });
  }
}

function createInput(values) {
  const recommendedNext = (values.get('--next-argv') || []).map((argvJSON) => ({
    kind: 'follow_up',
    reason: 'Operator annotation follow-up command.',
    argv: parseJSONArg(argvJSON, '--next-argv'),
  }));
  if (values.has('--from-capture-json')) {
    return {
      capture_result: loadJSONInput(values.get('--from-capture-json'), '--from-capture-json'),
      id: values.get('--id') || undefined,
      selected_ref: values.get('--ref') || undefined,
      target_summary: values.get('--target-summary') || undefined,
      target_kind: values.get('--target-kind') || undefined,
      comment: values.get('--comment') ?? null,
      workspace: values.get('--workspace') || undefined,
      source: values.get('--source') || 'cli',
      artifact_refs: values.get('--artifact') || [],
      recommended_next: recommendedNext.length ? recommendedNext : undefined,
    };
  }
  if (values.has('--from-json')) {
    return loadJSONInput(values.get('--from-json'), '--from-json');
  }
  const targetKind = values.get('--target-kind');
  const targetSummary = values.get('--target-summary');
  if (!targetKind) error('annotation create requires --target-kind', 'MISSING_ARG');
  if (!targetSummary) error('annotation create requires --target-summary', 'MISSING_ARG');
  const fallbackKind = values.get('--fallback-kind');
  const fallbackSummary = values.get('--fallback-summary');
  const fallbackReason = values.get('--fallback-reason');
  return {
    id: values.get('--id') || undefined,
    target_kind: targetKind,
    target_summary: targetSummary,
    comment: values.get('--comment') ?? null,
    workspace: values.get('--workspace') || undefined,
    snapshot: values.get('--snapshot') || undefined,
    ref: values.get('--ref') || undefined,
    source: values.get('--source') || 'cli',
    fallback_evidence: (fallbackKind || fallbackSummary || fallbackReason) ? [{
      kind: fallbackKind || 'region',
      summary: fallbackSummary || targetSummary,
      reason: fallbackReason || 'semantic_ref_unavailable',
    }] : [],
    artifact_refs: values.get('--artifact') || [],
    recommended_next: recommendedNext,
  };
}

function linkInput(values) {
  if (!values.has('--work-record')) error('annotation link-work-record requires --work-record', 'MISSING_ARG');
  return {
    ref: values.get('--work-record'),
    relationship: values.get('--relation') || 'annotation_evidence',
    status: values.get('--link-status') || 'linked',
    actor: values.get('--actor') || 'agent',
    artifact_refs: values.get('--artifact') || [],
  };
}

function requireOneID(positionals, command) {
  if (positionals.length === 0) error(`annotation ${command} requires <id>`, 'MISSING_ARG');
  if (positionals.length > 1) error(`Unknown argument: ${positionals[1]}`, 'UNKNOWN_ARG');
  return positionals[0];
}

function run(argv) {
  const [command, ...args] = argv;
  switch (command) {
    case 'create': {
      const parsed = parseArgs(args, new Set([
        '--json',
        '--id',
        '--target-kind',
        '--target-summary',
        '--comment',
        '--workspace',
        '--snapshot',
        '--ref',
        '--fallback-kind',
        '--fallback-summary',
        '--fallback-reason',
        '--artifact',
        '--next-argv',
        '--from-json',
        '--from-capture-json',
        '--source',
      ]));
      if (parsed.positionals.length) error(`Unknown argument: ${parsed.positionals[0]}`, 'UNKNOWN_ARG');
      printJSON(createPendingAnnotation(createInput(parsed.values)));
      return;
    }
    case 'list': {
      const parsed = parseArgs(args, new Set(['--json', '--state']));
      if (parsed.positionals.length) error(`Unknown argument: ${parsed.positionals[0]}`, 'UNKNOWN_ARG');
      printJSON(listPendingAnnotations({ state: parsed.values.get('--state') || null }));
      return;
    }
    case 'read': {
      const parsed = parseArgs(args, new Set(['--json']));
      printJSON(readPendingAnnotation(requireOneID(parsed.positionals, 'read')));
      return;
    }
    case 'consume': {
      const parsed = parseArgs(args, new Set(['--json', '--actor']));
      printJSON(consumePendingAnnotation(requireOneID(parsed.positionals, 'consume'), {
        actor: parsed.values.get('--actor') || 'agent',
      }));
      return;
    }
    case 'link-work-record': {
      const parsed = parseArgs(args, new Set(['--json', '--actor', '--work-record', '--relation', '--link-status', '--artifact']));
      const id = requireOneID(parsed.positionals, 'link-work-record');
      printJSON(linkPendingAnnotationWorkRecord(id, linkInput(parsed.values)));
      return;
    }
    case 'delete': {
      const parsed = parseArgs(args, new Set(['--json']));
      printJSON(deletePendingAnnotation(requireOneID(parsed.positionals, 'delete')));
      return;
    }
    default:
      error(`Unknown annotation subcommand: ${command ?? ''}`, command ? 'UNKNOWN_SUBCOMMAND' : 'MISSING_SUBCOMMAND');
  }
}

try {
  run(process.argv.slice(2));
} catch (err) {
  if (isPendingAnnotationError(err)) emitPendingAnnotationError(err);
  throw err;
}
