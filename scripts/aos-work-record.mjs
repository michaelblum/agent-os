#!/usr/bin/env node

import {
  defaultWorkRecordRoots,
  discoverWorkRecords,
  readWorkRecord,
  verifyWorkRecord,
  explainWorkRecordStatus,
  exportWorkRecordBundle,
  guideWorkRecordRepair,
  inspectWorkRecordRepairBundle,
  statusWorkRecordRepairBundles,
  writeWorkRecordRepairBundle,
  planWorkRecordRepairAttempt,
  planWorkRecordRepair,
  WORK_RECORD_CONSUMER_VERSION,
} from '../packages/toolkit/workbench/work-record.js';
import {
  handleAttemptArtifactFamily,
  handleRepairFamily,
  handleReplacementProposalFamily,
  handleSupersessionFamily,
} from './lib/work-record-command-families.mjs';

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
  ./aos work-record plan-attempt <id-or-path> [--profile id] [--root path ...] [--json]
  ./aos work-record repair guide <id-or-path> [--profile id] [--root path ...] [--attempt-plan path] [--attempt-artifact path] [--replacement-root dir] [--index-root dir] [--json]
  ./aos work-record repair bundle status --bundle-root <dir> [--bundle-root <dir> ...] [--bundle-parent <dir> ...] [--json]
  ./aos work-record repair bundle inspect <bundle-root> [--json]
  ./aos work-record repair bundle <id-or-path> --output-root <dir> [--profile id] [--root path ...] [--attempt-plan path] [--attempt-artifact path] [--replacement-root dir] [--index-root dir] [--dry-run] [--json]
  ./aos work-record repair finalize --source <id-or-path> --attempt-plan <plan-path> --attempt-artifact <artifact-path> --replacement-root <dir> --index-root <dir> [--proposed-id-seed id] [--replacement-output-path path] [--dry-run] [--json]
  ./aos work-record attempt-artifact validate <artifact-path> [--json]
  ./aos work-record attempt-artifact build --input <outcome-input-path> [--json]
  ./aos work-record replacement-proposal build --source <id-or-path> --attempt-plan <plan-path> --attempt-artifact <artifact-path> [--proposed-id-seed id] [--json]
  ./aos work-record replacement-proposal validate <proposal-path> [--json]
  ./aos work-record replacement-proposal write <proposal-path> --output-root <dir> [--output-path path] [--dry-run] [--json]
  ./aos work-record supersession write --source <id-or-path> --replacement <id-or-path> --index-root <dir> --writer-result <path> [--replacement-root path ...] [--dry-run] [--json]
  ./aos work-record supersession lookup --source <id-or-path> --index-root <dir> [--root path ...] [--replacement-root path ...] [--json]
  ./aos work-record supersession validate <entry-path> [--json]
  ./aos work-record export <id-or-path> [--profile id] [--root path ...] [--json]
`;
}

function parseArgs(argv) {
  const options = {
    json: false,
    roots: [],
    profileId: undefined,
    input: '',
    source: '',
    attemptPlan: '',
    attemptArtifact: '',
    proposedIdSeed: '',
    outputRoot: '',
    bundleRoots: [],
    bundleParents: [],
    outputPath: '',
    replacement: '',
    replacementRoots: [],
    replacementOutputPath: '',
    indexRoot: '',
    writerResult: '',
    dryRun: false,
    positional: [],
    usedFlags: new Set(),
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--json') {
      options.usedFlags.add(arg);
      options.json = true;
    } else if (arg === '--help' || arg === '-h') {
      options.usedFlags.add(arg);
      options.help = true;
    } else if (arg === '--root') {
      options.usedFlags.add(arg);
      const value = argv[index + 1];
      if (!value) fail('--root requires a path', 'MISSING_ARG');
      options.roots.push(value);
      index += 1;
    } else if (arg === '--profile') {
      options.usedFlags.add(arg);
      const value = argv[index + 1];
      if (!value) fail('--profile requires a verifier profile id', 'MISSING_ARG');
      options.profileId = value;
      index += 1;
    } else if (arg === '--input') {
      options.usedFlags.add(arg);
      const value = argv[index + 1];
      if (!value) fail('--input requires a JSON path', 'MISSING_ARG');
      options.input = value;
      index += 1;
    } else if (arg === '--source') {
      options.usedFlags.add(arg);
      const value = argv[index + 1];
      if (!value) fail('--source requires a Work Record id or path', 'MISSING_ARG');
      options.source = value;
      index += 1;
    } else if (arg === '--attempt-plan') {
      options.usedFlags.add(arg);
      const value = argv[index + 1];
      if (!value) fail('--attempt-plan requires a Repair Attempt Plan JSON path', 'MISSING_ARG');
      options.attemptPlan = value;
      index += 1;
    } else if (arg === '--attempt-artifact') {
      options.usedFlags.add(arg);
      const value = argv[index + 1];
      if (!value) fail('--attempt-artifact requires a Repair Attempt Artifact JSON path', 'MISSING_ARG');
      options.attemptArtifact = value;
      index += 1;
    } else if (arg === '--proposed-id-seed') {
      options.usedFlags.add(arg);
      const value = argv[index + 1];
      if (!value) fail('--proposed-id-seed requires a proposed Work Record id seed', 'MISSING_ARG');
      options.proposedIdSeed = value;
      index += 1;
    } else if (arg === '--output-root') {
      options.usedFlags.add(arg);
      const value = argv[index + 1];
      if (!value) fail('--output-root requires a directory path', 'MISSING_ARG');
      options.outputRoot = value;
      index += 1;
    } else if (arg === '--bundle-root') {
      options.usedFlags.add(arg);
      const value = argv[index + 1];
      if (!value) fail('--bundle-root requires a directory path', 'MISSING_ARG');
      options.bundleRoots.push(value);
      index += 1;
    } else if (arg === '--bundle-parent') {
      options.usedFlags.add(arg);
      const value = argv[index + 1];
      if (!value) fail('--bundle-parent requires a directory path', 'MISSING_ARG');
      options.bundleParents.push(value);
      index += 1;
    } else if (arg === '--output-path') {
      options.usedFlags.add(arg);
      const value = argv[index + 1];
      if (!value) fail('--output-path requires a JSON path', 'MISSING_ARG');
      options.outputPath = value;
      index += 1;
    } else if (arg === '--replacement') {
      options.usedFlags.add(arg);
      const value = argv[index + 1];
      if (!value) fail('--replacement requires a Work Record id or path', 'MISSING_ARG');
      options.replacement = value;
      index += 1;
    } else if (arg === '--replacement-root') {
      options.usedFlags.add(arg);
      const value = argv[index + 1];
      if (!value) fail('--replacement-root requires a path', 'MISSING_ARG');
      options.replacementRoots.push(value);
      index += 1;
    } else if (arg === '--replacement-output-path') {
      options.usedFlags.add(arg);
      const value = argv[index + 1];
      if (!value) fail('--replacement-output-path requires a JSON path', 'MISSING_ARG');
      options.replacementOutputPath = value;
      index += 1;
    } else if (arg === '--index-root') {
      options.usedFlags.add(arg);
      const value = argv[index + 1];
      if (!value) fail('--index-root requires a directory path', 'MISSING_ARG');
      options.indexRoot = value;
      index += 1;
    } else if (arg === '--writer-result') {
      options.usedFlags.add(arg);
      const value = argv[index + 1];
      if (!value) fail('--writer-result requires a Replacement Writer Result JSON path', 'MISSING_ARG');
      options.writerResult = value;
      index += 1;
    } else if (arg === '--dry-run') {
      options.usedFlags.add(arg);
      options.dryRun = true;
    } else if (arg.startsWith('--')) {
      fail(`Unknown flag: ${arg}`, 'UNKNOWN_FLAG');
    } else {
      options.positional.push(arg);
    }
  }
  return options;
}

const FORM_FLAGS = Object.freeze({
  list: ['--root', '--json'],
  read: ['--root', '--json'],
  verify: ['--profile', '--root', '--json'],
  status: ['--profile', '--root', '--json'],
  'plan-repair': ['--profile', '--root', '--json'],
  'plan-attempt': ['--profile', '--root', '--json'],
  export: ['--profile', '--root', '--json'],
  profiles: ['--json'],
  'repair-guide': ['--profile', '--root', '--attempt-plan', '--attempt-artifact', '--replacement-root', '--index-root', '--json'],
  'repair-bundle': ['--output-root', '--profile', '--root', '--attempt-plan', '--attempt-artifact', '--replacement-root', '--index-root', '--dry-run', '--json'],
  'repair-bundle-status': ['--bundle-root', '--bundle-parent', '--json'],
  'repair-bundle-inspect': ['--json'],
  'repair-finalize': ['--source', '--attempt-plan', '--attempt-artifact', '--replacement-root', '--index-root', '--proposed-id-seed', '--replacement-output-path', '--dry-run', '--json'],
  'attempt-artifact-validate': ['--json'],
  'attempt-artifact-build': ['--input', '--json'],
  'replacement-proposal-build': ['--source', '--attempt-plan', '--attempt-artifact', '--proposed-id-seed', '--json'],
  'replacement-proposal-validate': ['--json'],
  'replacement-proposal-write': ['--output-root', '--output-path', '--dry-run', '--json'],
  'supersession-write': ['--source', '--replacement', '--index-root', '--root', '--replacement-root', '--writer-result', '--dry-run', '--json'],
  'supersession-lookup': ['--source', '--index-root', '--root', '--replacement-root', '--json'],
  'supersession-validate': ['--json'],
});

function assertFormFlags(options, form) {
  const allowed = new Set([...(FORM_FLAGS[form] || []), '--help', '-h']);
  const unexpected = [...options.usedFlags].find((flag) => !allowed.has(flag));
  if (unexpected) fail(`Unknown flag for ${form}: ${unexpected}`, 'UNKNOWN_FLAG');
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
  const failed = payload.status === 'failed'
    || payload.status === 'unsupported'
    || payload.status === 'unsupported_profile'
    || payload.code;
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
  };

  let payload;
  if (command === 'list') {
    assertFormFlags(options, 'list');
    if (ref) fail(`Unexpected argument: ${ref}`, 'UNKNOWN_ARG');
    payload = discoverWorkRecords(context);
    payload.default_roots = options.roots.length === 0 ? defaultWorkRecordRoots(process.cwd()) : [];
  } else if (command === 'read') {
    assertFormFlags(options, 'read');
    payload = readWorkRecord(ref, context);
  } else if (command === 'verify') {
    assertFormFlags(options, 'verify');
    payload = verifyWorkRecord(ref, context);
  } else if (command === 'status' || command === 'explain') {
    assertFormFlags(options, 'status');
    payload = explainWorkRecordStatus(ref, context);
  } else if (command === 'plan-repair') {
    assertFormFlags(options, 'plan-repair');
    payload = planWorkRecordRepair(ref, context);
  } else if (command === 'plan-attempt') {
    assertFormFlags(options, 'plan-attempt');
    payload = planWorkRecordRepairAttempt(ref, context);
  } else if (command === 'repair') {
    const [action, target, ...rest] = [ref, ...extra];
    if (action === 'guide') {
      assertFormFlags(options, 'repair-guide');
      if (!target) fail('repair guide requires a Work Record id or path', 'MISSING_ARG');
      if (rest.length > 0) fail(`Unexpected argument: ${rest[0]}`, 'UNKNOWN_ARG');
      payload = guideWorkRecordRepair({
        sourceRef: target,
        ...context,
        attemptPlanPath: options.attemptPlan,
        attemptArtifactPath: options.attemptArtifact,
        replacementRoot: options.replacementRoots[0] || '',
        replacementRoots: options.replacementRoots,
        indexRoot: options.indexRoot,
        proposedIdSeed: options.proposedIdSeed,
        replacementOutputPath: options.replacementOutputPath,
      });
      emitPayload(payload, options.json);
      return;
    }
    if (action === 'bundle') {
      if (target === 'status') {
        assertFormFlags(options, 'repair-bundle-status');
        if (rest.length > 0) fail(`Unexpected argument: ${rest[0]}`, 'UNKNOWN_ARG');
        payload = statusWorkRecordRepairBundles({
          bundleRoots: options.bundleRoots,
          bundleParents: options.bundleParents,
        });
        emitJSON(payload, payload.status === 'failed');
        if (payload.status === 'failed') process.exit(1);
        return;
      }
      if (target === 'inspect') {
        assertFormFlags(options, 'repair-bundle-inspect');
        const [bundleRoot, ...inspectRest] = rest;
        if (!bundleRoot) fail('repair bundle inspect requires <bundle-root>', 'MISSING_ARG');
        if (inspectRest.length > 0) fail(`Unexpected argument: ${inspectRest[0]}`, 'UNKNOWN_ARG');
        payload = inspectWorkRecordRepairBundle({ bundleRoot });
        const failed = payload.status !== 'valid' && payload.status !== 'degraded';
        emitJSON(payload, failed);
        if (failed) process.exit(1);
        return;
      }
      if (!target) fail('repair bundle requires a Work Record id or path', 'MISSING_ARG');
      assertFormFlags(options, 'repair-bundle');
      if (rest.length > 0) fail(`Unexpected argument: ${rest[0]}`, 'UNKNOWN_ARG');
      payload = writeWorkRecordRepairBundle({
        sourceRef: target,
        outputRoot: options.outputRoot,
        dryRun: options.dryRun,
        ...context,
        attemptPlanPath: options.attemptPlan,
        attemptArtifactPath: options.attemptArtifact,
        replacementRoot: options.replacementRoots[0] || '',
        replacementRoots: options.replacementRoots,
        indexRoot: options.indexRoot,
        proposedIdSeed: options.proposedIdSeed,
        replacementOutputPath: options.replacementOutputPath,
      });
      const failed = payload.status !== 'dry_run' && payload.status !== 'written';
      emitJSON(payload, failed);
      if (failed) process.exit(1);
      return;
    }
    if (action === 'finalize') assertFormFlags(options, 'repair-finalize');
    await handleRepairFamily({ action, target, rest, options, fail, emitJSON });
    return;
  } else if (command === 'attempt-artifact') {
    const [action, target, ...rest] = [ref, ...extra];
    if (action === 'validate') assertFormFlags(options, 'attempt-artifact-validate');
    if (action === 'build') assertFormFlags(options, 'attempt-artifact-build');
    handleAttemptArtifactFamily({ action, target, rest, options, fail, emitJSON });
    return;
  } else if (command === 'replacement-proposal') {
    const [action, target, ...rest] = [ref, ...extra];
    if (action === 'build') assertFormFlags(options, 'replacement-proposal-build');
    if (action === 'validate') assertFormFlags(options, 'replacement-proposal-validate');
    if (action === 'write') assertFormFlags(options, 'replacement-proposal-write');
    handleReplacementProposalFamily({ action, target, rest, options, context, fail, emitJSON });
    return;
  } else if (command === 'supersession') {
    const [action, target, ...rest] = [ref, ...extra];
    if (action === 'write') assertFormFlags(options, 'supersession-write');
    if (action === 'lookup') assertFormFlags(options, 'supersession-lookup');
    if (action === 'validate') assertFormFlags(options, 'supersession-validate');
    handleSupersessionFamily({ action, target, rest, options, fail, emitJSON });
    return;
  } else if (command === 'export') {
    assertFormFlags(options, 'export');
    payload = exportWorkRecordBundle(ref, context);
  } else if (command === 'profiles') {
    assertFormFlags(options, 'profiles');
    if (ref) fail(`Unexpected argument: ${ref}`, 'UNKNOWN_ARG');
    payload = {
      type: 'work_record.profiles',
      schema_version: WORK_RECORD_CONSUMER_VERSION,
      status: 'success',
      profiles: ['aos.verifier.work-record.v1.report-only'],
    };
  } else {
    fail(`Unknown work-record subcommand: ${command}`, 'UNKNOWN_COMMAND');
  }

  emitPayload(payload, options.json);
}

await main();
