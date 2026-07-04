#!/usr/bin/env node

import {
  defaultWorkRecordRoots,
  discoverWorkRecords,
  readWorkRecord,
  verifyWorkRecord,
  explainWorkRecordStatus,
  exportWorkRecordBundle,
  WORK_RECORD_CONSUMER_VERSION,
} from '../packages/toolkit/workbench/work-record.js';

function prettyJSON(value) {
  return JSON.stringify(value, null, 2);
}

function emitJSON(value, failure = false) {
  const out = `${prettyJSON(value)}\n`;
  if (failure) process.stderr.write(out);
  else process.stdout.write(out);
}

function fail(message, code = 'WORK_RECORD_COMMAND_FAILED', details = {}) {
  emitJSON({ code, error: message, ...details }, true);
  process.exit(1);
}

function usage() {
  return `Usage:
  ./aos work-record list [--root path ...] [--json]
  ./aos work-record read <id-or-path> [--root path ...] [--json]
  ./aos work-record verify <id-or-path> [--profile id] [--root path ...] [--json]
  ./aos work-record status <id-or-path> [--profile id] [--root path ...] [--json]
  ./aos work-record export <id-or-path> [--profile id] [--root path ...] [--json]
`;
}

function parseArgs(argv) {
  const options = {
    json: false,
    roots: [],
    profileId: undefined,
    positional: [],
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--json') {
      options.json = true;
    } else if (arg === '--help' || arg === '-h') {
      options.help = true;
    } else if (arg === '--root') {
      const value = argv[index + 1];
      if (!value) fail('--root requires a path', 'MISSING_ARG');
      options.roots.push(value);
      index += 1;
    } else if (arg === '--profile') {
      const value = argv[index + 1];
      if (!value) fail('--profile requires a verifier profile id', 'MISSING_ARG');
      options.profileId = value;
      index += 1;
    } else if (arg.startsWith('--')) {
      fail(`Unknown flag: ${arg}`, 'UNKNOWN_FLAG');
    } else {
      options.positional.push(arg);
    }
  }
  return options;
}

function commandText(payload) {
  if (payload.type === 'work_record.discovery') {
    return `${payload.status} ${payload.count} Work Record(s)\n${payload.records.map((record) => `${record.id}\t${record.health_verdict}\t${record.repo_relative_path}`).join('\n')}\n`;
  }
  if (payload.summary) {
    return `${payload.status} ${payload.summary.id} ${payload.health_verdict || payload.summary.health_verdict || ''}\n`;
  }
  return `${payload.status || 'success'}\n`;
}

function emitPayload(payload, asJSON) {
  const failed = payload.status === 'failed' || payload.code || payload.status === 'unsupported_profile';
  if (asJSON) {
    emitJSON(payload, failed);
  } else if (failed) {
    process.stderr.write(`${payload.error || payload.code || 'Work Record command failed'}\n`);
  } else {
    process.stdout.write(commandText(payload));
  }
  if (failed) process.exit(1);
}

function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  const [command, ref, ...extra] = options.positional;
  if (options.help || !command) {
    process.stdout.write(usage());
    return;
  }
  if (extra.length > 0) fail(`Unexpected argument: ${extra[0]}`, 'UNKNOWN_ARG');
  const context = {
    roots: options.roots,
    profileId: options.profileId,
    repoRoot: process.cwd(),
  };

  let payload;
  if (command === 'list') {
    if (ref) fail(`Unexpected argument: ${ref}`, 'UNKNOWN_ARG');
    payload = discoverWorkRecords(context);
    payload.default_roots = options.roots.length === 0 ? defaultWorkRecordRoots(process.cwd()) : [];
  } else if (command === 'read') {
    payload = readWorkRecord(ref, context);
  } else if (command === 'verify') {
    payload = verifyWorkRecord(ref, context);
  } else if (command === 'status' || command === 'explain') {
    payload = explainWorkRecordStatus(ref, context);
  } else if (command === 'export') {
    payload = exportWorkRecordBundle(ref, context);
  } else if (command === 'profiles') {
    if (ref) fail(`Unexpected argument: ${ref}`, 'UNKNOWN_ARG');
    payload = {
      type: 'work_record.profiles',
      schema_version: WORK_RECORD_CONSUMER_VERSION,
      status: 'success',
      profiles: ['aos.verifier.work-record.v0.report-only'],
    };
  } else {
    fail(`Unknown work-record subcommand: ${command}`, 'UNKNOWN_COMMAND');
  }

  emitPayload(payload, options.json);
}

main();
