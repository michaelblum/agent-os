#!/usr/bin/env node

import fs from 'node:fs';
import {
  GateContinuationStore,
} from '../packages/daemon/gate/continuations.js';
import {
  GateRecordStore,
} from '../packages/daemon/gate/records.js';
import {
  buildWorkRecordGateRequest,
  checkWorkRecordGateAuthorization,
  defaultWorkRecordRoots,
  discoverWorkRecords,
  readWorkRecord,
  verifyWorkRecord,
  explainWorkRecordStatus,
  exportWorkRecordBundle,
  planWorkRecordRepairAttempt,
  planWorkRecordRepair,
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
  ./aos work-record plan-repair <id-or-path> [--profile id] [--root path ...] [--json]
  ./aos work-record plan-attempt <id-or-path> [--profile id] [--root path ...] [--authorization path|--gate-record id-or-path|--resume-event path|--continuation-id id] [--workflow-gate id] [--json]
  ./aos work-record gate-request <id-or-path> [--profile id] [--root path ...] [--workflow-gate id] [--json]
  ./aos work-record gate-check <id-or-path> (--gate-record id-or-path|--resume-event path|--continuation-id id) [--profile id] [--root path ...] [--workflow-gate id] [--json]
  ./aos work-record export <id-or-path> [--profile id] [--root path ...] [--json]
`;
}

function parseArgs(argv) {
  const options = {
    json: false,
    roots: [],
    profileId: undefined,
    workflowGateId: '',
    authorization: '',
    gateRecord: '',
    resumeEvent: '',
    continuationId: '',
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
    } else if (arg === '--workflow-gate') {
      const value = argv[index + 1];
      if (!value) fail('--workflow-gate requires a Workflow gate id', 'MISSING_ARG');
      options.workflowGateId = value;
      index += 1;
    } else if (arg === '--authorization') {
      const value = argv[index + 1];
      if (!value) fail('--authorization requires a Workflow Gate Authorization JSON path', 'MISSING_ARG');
      options.authorization = value;
      index += 1;
    } else if (arg === '--gate-record') {
      const value = argv[index + 1];
      if (!value) fail('--gate-record requires a gate record id or path', 'MISSING_ARG');
      options.gateRecord = value;
      index += 1;
    } else if (arg === '--resume-event') {
      const value = argv[index + 1];
      if (!value) fail('--resume-event requires a resume-event path', 'MISSING_ARG');
      options.resumeEvent = value;
      index += 1;
    } else if (arg === '--continuation-id') {
      const value = argv[index + 1];
      if (!value) fail('--continuation-id requires a continuation id', 'MISSING_ARG');
      options.continuationId = value;
      index += 1;
    } else if (arg.startsWith('--')) {
      fail(`Unknown flag: ${arg}`, 'UNKNOWN_FLAG');
    } else {
      options.positional.push(arg);
    }
  }
  return options;
}

async function readGateRecord(ref) {
  if (fs.existsSync(ref)) {
    try {
      return JSON.parse(fs.readFileSync(ref, 'utf8'));
    } catch (error) {
      fail(`Invalid gate record JSON: ${error.message}`, 'INVALID_GATE_RECORD');
    }
  }
  const records = await new GateRecordStore().list({ gateId: ref, limit: 1 });
  if (records.length === 0) fail(`Gate record not found: ${ref}`, 'GATE_RECORD_NOT_FOUND');
  return records[0];
}

async function readResumeEvent(file) {
  if (!fs.existsSync(file)) fail(`Resume event not found: ${file}`, 'RESUME_EVENT_NOT_FOUND');
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (error) {
    fail(`Invalid resume event JSON: ${error.message}`, 'INVALID_RESUME_EVENT');
  }
}

async function readContinuationResumeEvent(id) {
  let continuation;
  try {
    continuation = await new GateContinuationStore().read(id);
  } catch (error) {
    fail(`Continuation not found or unreadable: ${error.message}`, 'CONTINUATION_NOT_FOUND');
  }
  const eventPath = continuation.resume?.event_path;
  if (!eventPath) fail(`Continuation has no submitted resume event: ${id}`, 'CONTINUATION_NOT_SUBMITTED');
  return readResumeEvent(eventPath);
}

async function readAuthorization(file) {
  if (!fs.existsSync(file)) fail(`Workflow Gate Authorization not found: ${file}`, 'AUTHORIZATION_NOT_FOUND');
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (error) {
    fail(`Invalid Workflow Gate Authorization JSON: ${error.message}`, 'INVALID_AUTHORIZATION');
  }
}

async function gateCheckOutcome(options) {
  const refs = [options.gateRecord, options.resumeEvent, options.continuationId].filter(Boolean);
  if (refs.length !== 1) {
    fail('gate-check requires exactly one of --gate-record, --resume-event, or --continuation-id', 'GATE_OUTCOME_REQUIRED');
  }
  if (options.gateRecord) return readGateRecord(options.gateRecord);
  if (options.resumeEvent) return readResumeEvent(options.resumeEvent);
  return readContinuationResumeEvent(options.continuationId);
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

async function main(argv = process.argv.slice(2)) {
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
    workflowGateId: options.workflowGateId,
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
  } else if (command === 'plan-repair') {
    payload = planWorkRecordRepair(ref, context);
  } else if (command === 'plan-attempt') {
    const refs = [options.authorization, options.gateRecord, options.resumeEvent, options.continuationId].filter(Boolean);
    if (refs.length > 1) {
      fail('plan-attempt accepts at most one of --authorization, --gate-record, --resume-event, or --continuation-id', 'ATTEMPT_AUTHORIZATION_INPUT_CONFLICT');
    }
    if (options.authorization) {
      payload = planWorkRecordRepairAttempt(ref, {
        ...context,
        authorization: await readAuthorization(options.authorization),
      });
    } else if (options.gateRecord || options.resumeEvent || options.continuationId) {
      payload = planWorkRecordRepairAttempt(ref, {
        ...context,
        gateOutcome: await gateCheckOutcome(options),
      });
    } else {
      payload = planWorkRecordRepairAttempt(ref, context);
    }
  } else if (command === 'gate-request') {
    payload = buildWorkRecordGateRequest(ref, context);
  } else if (command === 'gate-check') {
    payload = checkWorkRecordGateAuthorization(ref, await gateCheckOutcome(options), context);
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

await main();
