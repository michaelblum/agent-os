#!/usr/bin/env node

import fs from 'node:fs';
import crypto from 'node:crypto';
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
  executeControlledWorkRecordRepair,
  readWorkRecord,
  verifyWorkRecord,
  explainWorkRecordStatus,
  exportWorkRecordBundle,
  buildWorkRecordRepairAttemptArtifact,
  buildWorkRecordReplacementProposal,
  lookupWorkRecordSourceSupersession,
  writeReplacementWorkRecord,
  writeWorkRecordSourceSupersessionIndex,
  planWorkRecordRepairAttempt,
  planWorkRecordRepair,
  validateWorkRecordRepairAttemptArtifact,
  validateWorkRecordReplacementProposal,
  validateWorkRecordSourceSupersessionEntry,
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
  ./aos work-record repair execute --attempt-plan <plan-path> --execution-root <dir> --artifact-root <dir> [--operation-id id] [--dry-run] [--json]
  ./aos work-record attempt-artifact validate <artifact-path> [--json]
  ./aos work-record attempt-artifact build --input <outcome-input-path> [--json]
  ./aos work-record replacement-proposal build --source <id-or-path> --attempt-plan <plan-path> --attempt-artifact <artifact-path> [--proposed-id-seed id] [--json]
  ./aos work-record replacement-proposal validate <proposal-path> [--json]
  ./aos work-record replacement-proposal write <proposal-path> --output-root <dir> [--output-path path] [--dry-run] [--json]
  ./aos work-record supersession write --source <id-or-path> --replacement <id-or-path> --index-root <dir> [--replacement-root path ...] [--writer-result path] [--dry-run] [--json]
  ./aos work-record supersession lookup --source <id-or-path> --index-root <dir> [--root path ...] [--json]
  ./aos work-record supersession validate <entry-path> [--json]
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
    input: '',
    source: '',
    attemptPlan: '',
    attemptArtifact: '',
    proposedIdSeed: '',
    outputRoot: '',
    outputPath: '',
    replacement: '',
    replacementRoots: [],
    indexRoot: '',
    writerResult: '',
    executionRoot: '',
    artifactRoot: '',
    operationId: '',
    dryRun: false,
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
    } else if (arg === '--input') {
      const value = argv[index + 1];
      if (!value) fail('--input requires a JSON path', 'MISSING_ARG');
      options.input = value;
      index += 1;
    } else if (arg === '--source') {
      const value = argv[index + 1];
      if (!value) fail('--source requires a Work Record id or path', 'MISSING_ARG');
      options.source = value;
      index += 1;
    } else if (arg === '--attempt-plan') {
      const value = argv[index + 1];
      if (!value) fail('--attempt-plan requires a Repair Attempt Plan JSON path', 'MISSING_ARG');
      options.attemptPlan = value;
      index += 1;
    } else if (arg === '--attempt-artifact') {
      const value = argv[index + 1];
      if (!value) fail('--attempt-artifact requires a Repair Attempt Artifact JSON path', 'MISSING_ARG');
      options.attemptArtifact = value;
      index += 1;
    } else if (arg === '--proposed-id-seed') {
      const value = argv[index + 1];
      if (!value) fail('--proposed-id-seed requires a proposed Work Record id seed', 'MISSING_ARG');
      options.proposedIdSeed = value;
      index += 1;
    } else if (arg === '--output-root') {
      const value = argv[index + 1];
      if (!value) fail('--output-root requires a directory path', 'MISSING_ARG');
      options.outputRoot = value;
      index += 1;
    } else if (arg === '--output-path') {
      const value = argv[index + 1];
      if (!value) fail('--output-path requires a JSON path', 'MISSING_ARG');
      options.outputPath = value;
      index += 1;
    } else if (arg === '--replacement') {
      const value = argv[index + 1];
      if (!value) fail('--replacement requires a Work Record id or path', 'MISSING_ARG');
      options.replacement = value;
      index += 1;
    } else if (arg === '--replacement-root') {
      const value = argv[index + 1];
      if (!value) fail('--replacement-root requires a path', 'MISSING_ARG');
      options.replacementRoots.push(value);
      index += 1;
    } else if (arg === '--index-root') {
      const value = argv[index + 1];
      if (!value) fail('--index-root requires a directory path', 'MISSING_ARG');
      options.indexRoot = value;
      index += 1;
    } else if (arg === '--writer-result') {
      const value = argv[index + 1];
      if (!value) fail('--writer-result requires a Replacement Writer Result JSON path', 'MISSING_ARG');
      options.writerResult = value;
      index += 1;
    } else if (arg === '--execution-root') {
      const value = argv[index + 1];
      if (!value) fail('--execution-root requires a directory path', 'MISSING_ARG');
      options.executionRoot = value;
      index += 1;
    } else if (arg === '--artifact-root') {
      const value = argv[index + 1];
      if (!value) fail('--artifact-root requires a directory path', 'MISSING_ARG');
      options.artifactRoot = value;
      index += 1;
    } else if (arg === '--operation-id') {
      const value = argv[index + 1];
      if (!value) fail('--operation-id requires a planned operation id', 'MISSING_ARG');
      options.operationId = value;
      index += 1;
    } else if (arg === '--dry-run') {
      options.dryRun = true;
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

function readJsonFile(file, code = 'INVALID_JSON') {
  if (!fs.existsSync(file)) fail(`JSON file not found: ${file}`, code);
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (error) {
    fail(`Invalid JSON: ${error.message}`, code);
  }
}

function digestFile(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
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
  if (!['repair', 'attempt-artifact', 'replacement-proposal', 'supersession'].includes(command) && extra.length > 0) fail(`Unexpected argument: ${extra[0]}`, 'UNKNOWN_ARG');
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
  } else if (command === 'repair') {
    const [action, target, ...rest] = [ref, ...extra];
    if (rest.length > 0) fail(`Unexpected argument: ${rest[0]}`, 'UNKNOWN_ARG');
    if (action === 'execute') {
      if (target) fail(`Unexpected argument: ${target}`, 'UNKNOWN_ARG');
      if (!options.attemptPlan) fail('repair execute requires --attempt-plan <plan-path>', 'MISSING_ARG');
      if (!options.executionRoot) fail('repair execute requires --execution-root <dir>', 'MISSING_ARG');
      if (!options.artifactRoot) fail('repair execute requires --artifact-root <dir>', 'MISSING_ARG');
      const result = await executeControlledWorkRecordRepair({
        attemptPlanPath: options.attemptPlan,
        executionRoot: options.executionRoot,
        artifactRoot: options.artifactRoot,
        operationId: options.operationId,
        dryRun: options.dryRun,
        repoRoot: process.cwd(),
      });
      const failed = result.status !== 'dry_run' && result.status !== 'succeeded';
      emitJSON(result, failed);
      if (failed) process.exit(1);
      return;
    }
    fail(`Unknown repair subcommand: ${action || ''}`, 'UNKNOWN_COMMAND');
  } else if (command === 'attempt-artifact') {
    const [action, target, ...rest] = [ref, ...extra];
    if (rest.length > 0) fail(`Unexpected argument: ${rest[0]}`, 'UNKNOWN_ARG');
    if (action === 'validate') {
      if (!target) fail('attempt-artifact validate requires an artifact path', 'MISSING_ARG');
      const validation = validateWorkRecordRepairAttemptArtifact(readJsonFile(target, 'INVALID_REPAIR_ATTEMPT_ARTIFACT'));
      emitJSON(validation, validation.status !== 'passed');
      if (validation.status !== 'passed') process.exit(1);
      return;
    }
    if (action === 'build') {
      if (target) fail(`Unexpected argument: ${target}`, 'UNKNOWN_ARG');
      if (!options.input) fail('attempt-artifact build requires --input <outcome-input-path>', 'MISSING_ARG');
      emitJSON(buildWorkRecordRepairAttemptArtifact(readJsonFile(options.input, 'INVALID_REPAIR_ATTEMPT_ARTIFACT_INPUT')));
      return;
    }
    fail(`Unknown attempt-artifact subcommand: ${action || ''}`, 'UNKNOWN_COMMAND');
  } else if (command === 'replacement-proposal') {
    const [action, target, ...rest] = [ref, ...extra];
    if (rest.length > 0) fail(`Unexpected argument: ${rest[0]}`, 'UNKNOWN_ARG');
    if (action === 'validate') {
      if (!target) fail('replacement-proposal validate requires a proposal path', 'MISSING_ARG');
      const validation = validateWorkRecordReplacementProposal(readJsonFile(target, 'INVALID_REPLACEMENT_PROPOSAL'));
      emitJSON(validation, validation.status !== 'passed');
      if (validation.status !== 'passed') process.exit(1);
      return;
    }
    if (action === 'write') {
      if (!target) fail('replacement-proposal write requires a proposal path', 'MISSING_ARG');
      if (!options.outputRoot) fail('replacement-proposal write requires --output-root <dir>', 'MISSING_ARG');
      const result = writeReplacementWorkRecord({
        proposal: readJsonFile(target, 'INVALID_REPLACEMENT_PROPOSAL'),
        outputRoot: options.outputRoot,
        outputPath: options.outputPath,
        dryRun: options.dryRun,
      });
      emitJSON(result, result.status.startsWith('blocked_') || result.status === 'unsupported');
      if (result.status.startsWith('blocked_') || result.status === 'unsupported') process.exit(1);
      return;
    }
    if (action === 'build') {
      if (target) fail(`Unexpected argument: ${target}`, 'UNKNOWN_ARG');
      if (!options.source) fail('replacement-proposal build requires --source <id-or-path>', 'MISSING_ARG');
      if (!options.attemptPlan) fail('replacement-proposal build requires --attempt-plan <plan-path>', 'MISSING_ARG');
      if (!options.attemptArtifact) fail('replacement-proposal build requires --attempt-artifact <artifact-path>', 'MISSING_ARG');
      const sourceRead = readWorkRecord(options.source, context);
      if (sourceRead.status !== 'success') {
        emitJSON(sourceRead, true);
        process.exit(1);
      }
      const sourcePath = sourceRead.source?.path;
      const beforeDigest = sourcePath ? digestFile(sourcePath) : '';
      const proposal = buildWorkRecordReplacementProposal({
        source_work_record: {
          ...sourceRead.summary,
          ...sourceRead.source,
          record: sourceRead.record,
          path: sourcePath,
          requested_ref: options.source,
          digest: beforeDigest,
        },
        repair_attempt_plan: readJsonFile(options.attemptPlan, 'INVALID_REPAIR_ATTEMPT_PLAN'),
        repair_attempt_artifact: readJsonFile(options.attemptArtifact, 'INVALID_REPAIR_ATTEMPT_ARTIFACT'),
        source_work_record_digest_after: sourcePath ? digestFile(sourcePath) : beforeDigest,
        proposed_id_seed: options.proposedIdSeed,
      });
      emitJSON(proposal);
      return;
    }
    fail(`Unknown replacement-proposal subcommand: ${action || ''}`, 'UNKNOWN_COMMAND');
  } else if (command === 'supersession') {
    const [action, target, ...rest] = [ref, ...extra];
    if (rest.length > 0) fail(`Unexpected argument: ${rest[0]}`, 'UNKNOWN_ARG');
    if (action === 'validate') {
      if (!target) fail('supersession validate requires an entry path', 'MISSING_ARG');
      const validation = validateWorkRecordSourceSupersessionEntry(readJsonFile(target, 'INVALID_SOURCE_SUPERSESSION_ENTRY'));
      emitJSON(validation, validation.status !== 'passed');
      if (validation.status !== 'passed') process.exit(1);
      return;
    }
    if (action === 'lookup') {
      if (target) fail(`Unexpected argument: ${target}`, 'UNKNOWN_ARG');
      if (!options.source) fail('supersession lookup requires --source <id-or-path>', 'MISSING_ARG');
      if (!options.indexRoot) fail('supersession lookup requires --index-root <dir>', 'MISSING_ARG');
      const result = lookupWorkRecordSourceSupersession({
        sourceRef: options.source,
        indexRoot: options.indexRoot,
        sourceRoots: options.roots,
        repoRoot: process.cwd(),
      });
      emitJSON(result, result.status.startsWith('blocked_') || result.status === 'unsupported');
      if (result.status.startsWith('blocked_') || result.status === 'unsupported') process.exit(1);
      return;
    }
    if (action === 'write') {
      if (target) fail(`Unexpected argument: ${target}`, 'UNKNOWN_ARG');
      if (!options.source) fail('supersession write requires --source <id-or-path>', 'MISSING_ARG');
      if (!options.replacement) fail('supersession write requires --replacement <id-or-path>', 'MISSING_ARG');
      if (!options.indexRoot) fail('supersession write requires --index-root <dir>', 'MISSING_ARG');
      const result = writeWorkRecordSourceSupersessionIndex({
        sourceRef: options.source,
        replacementRef: options.replacement,
        indexRoot: options.indexRoot,
        sourceRoots: options.roots,
        replacementRoots: options.replacementRoots,
        writerResultPath: options.writerResult,
        dryRun: options.dryRun,
        repoRoot: process.cwd(),
      });
      emitJSON(result, result.status.startsWith('blocked_') || result.status === 'unsupported' || result.status === 'conflict');
      if (result.status.startsWith('blocked_') || result.status === 'unsupported' || result.status === 'conflict') process.exit(1);
      return;
    }
    fail(`Unknown supersession subcommand: ${action || ''}`, 'UNKNOWN_COMMAND');
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
