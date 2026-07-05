import fs from 'node:fs';
import crypto from 'node:crypto';
import {
  buildWorkRecordRepairAttemptArtifact,
  buildWorkRecordReplacementProposal,
  executeControlledWorkRecordRepair,
  finalizeWorkRecordRepair,
  lookupWorkRecordSourceSupersession,
  readWorkRecord,
  validateWorkRecordRepairAttemptArtifact,
  validateWorkRecordReplacementProposal,
  validateWorkRecordSourceSupersessionEntry,
  writeReplacementWorkRecord,
  writeWorkRecordSourceSupersessionIndex,
} from '../../packages/toolkit/workbench/work-record.js';

function readJsonFile(file, code = 'INVALID_JSON', fail) {
  if (!fs.existsSync(file)) fail(`JSON file not found: ${file}`, code);
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (error) {
    fail(`Invalid JSON: ${error.message}`, code);
  }
  return null;
}

function digestFile(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function failedResult(result) {
  return result.status?.startsWith('blocked_')
    || result.status === 'unsupported'
    || result.status === 'conflict'
    || result.status === 'partial_finalized'
    || result.status === 'stale'
    || result.status === 'mismatch';
}

export async function handleRepairFamily({ action, target, rest, options, fail, emitJSON }) {
  if (rest.length > 0) fail(`Unexpected argument: ${rest[0]}`, 'UNKNOWN_ARG');
  if (target) fail(`Unexpected argument: ${target}`, 'UNKNOWN_ARG');
  if (action === 'execute') {
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
    return true;
  }
  if (action === 'finalize') {
    if (!options.source) fail('repair finalize requires --source <id-or-path>', 'MISSING_ARG');
    if (!options.attemptPlan) fail('repair finalize requires --attempt-plan <plan-path>', 'MISSING_ARG');
    if (!options.attemptArtifact) fail('repair finalize requires --attempt-artifact <artifact-path>', 'MISSING_ARG');
    if (options.replacementRoots.length !== 1) fail('repair finalize requires exactly one --replacement-root <dir>', 'MISSING_ARG');
    if (!options.indexRoot) fail('repair finalize requires --index-root <dir>', 'MISSING_ARG');
    const result = finalizeWorkRecordRepair({
      sourceRef: options.source,
      attemptPlanPath: options.attemptPlan,
      attemptArtifactPath: options.attemptArtifact,
      replacementRoot: options.replacementRoots[0],
      indexRoot: options.indexRoot,
      proposedIdSeed: options.proposedIdSeed,
      replacementOutputPath: options.replacementOutputPath,
      dryRun: options.dryRun,
      roots: options.roots,
      repoRoot: process.cwd(),
    });
    emitJSON(result, failedResult(result));
    if (failedResult(result)) process.exit(1);
    return true;
  }
  fail(`Unknown repair subcommand: ${action || ''}`, 'UNKNOWN_COMMAND');
  return true;
}

export function handleAttemptArtifactFamily({ action, target, rest, options, fail, emitJSON }) {
  if (rest.length > 0) fail(`Unexpected argument: ${rest[0]}`, 'UNKNOWN_ARG');
  if (action === 'validate') {
    if (!target) fail('attempt-artifact validate requires an artifact path', 'MISSING_ARG');
    const validation = validateWorkRecordRepairAttemptArtifact(readJsonFile(target, 'INVALID_REPAIR_ATTEMPT_ARTIFACT', fail));
    emitJSON(validation, validation.status !== 'passed');
    if (validation.status !== 'passed') process.exit(1);
    return true;
  }
  if (action === 'build') {
    if (target) fail(`Unexpected argument: ${target}`, 'UNKNOWN_ARG');
    if (!options.input) fail('attempt-artifact build requires --input <outcome-input-path>', 'MISSING_ARG');
    emitJSON(buildWorkRecordRepairAttemptArtifact(readJsonFile(options.input, 'INVALID_REPAIR_ATTEMPT_ARTIFACT_INPUT', fail)));
    return true;
  }
  fail(`Unknown attempt-artifact subcommand: ${action || ''}`, 'UNKNOWN_COMMAND');
  return true;
}

export function handleReplacementProposalFamily({ action, target, rest, options, context, fail, emitJSON }) {
  if (rest.length > 0) fail(`Unexpected argument: ${rest[0]}`, 'UNKNOWN_ARG');
  if (action === 'validate') {
    if (!target) fail('replacement-proposal validate requires a proposal path', 'MISSING_ARG');
    const validation = validateWorkRecordReplacementProposal(readJsonFile(target, 'INVALID_REPLACEMENT_PROPOSAL', fail));
    emitJSON(validation, validation.status !== 'passed');
    if (validation.status !== 'passed') process.exit(1);
    return true;
  }
  if (action === 'write') {
    if (!target) fail('replacement-proposal write requires a proposal path', 'MISSING_ARG');
    if (!options.outputRoot) fail('replacement-proposal write requires --output-root <dir>', 'MISSING_ARG');
    const result = writeReplacementWorkRecord({
      proposal: readJsonFile(target, 'INVALID_REPLACEMENT_PROPOSAL', fail),
      outputRoot: options.outputRoot,
      outputPath: options.outputPath,
      dryRun: options.dryRun,
    });
    emitJSON(result, failedResult(result));
    if (failedResult(result)) process.exit(1);
    return true;
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
      repair_attempt_plan: readJsonFile(options.attemptPlan, 'INVALID_REPAIR_ATTEMPT_PLAN', fail),
      repair_attempt_artifact: readJsonFile(options.attemptArtifact, 'INVALID_REPAIR_ATTEMPT_ARTIFACT', fail),
      source_work_record_digest_after: sourcePath ? digestFile(sourcePath) : beforeDigest,
      proposed_id_seed: options.proposedIdSeed,
    });
    emitJSON(proposal);
    return true;
  }
  fail(`Unknown replacement-proposal subcommand: ${action || ''}`, 'UNKNOWN_COMMAND');
  return true;
}

export function handleSupersessionFamily({ action, target, rest, options, fail, emitJSON }) {
  if (rest.length > 0) fail(`Unexpected argument: ${rest[0]}`, 'UNKNOWN_ARG');
  if (action === 'validate') {
    if (!target) fail('supersession validate requires an entry path', 'MISSING_ARG');
    const validation = validateWorkRecordSourceSupersessionEntry(readJsonFile(target, 'INVALID_SOURCE_SUPERSESSION_ENTRY', fail));
    emitJSON(validation, validation.status !== 'passed');
    if (validation.status !== 'passed') process.exit(1);
    return true;
  }
  if (action === 'lookup') {
    if (target) fail(`Unexpected argument: ${target}`, 'UNKNOWN_ARG');
    if (!options.source) fail('supersession lookup requires --source <id-or-path>', 'MISSING_ARG');
    if (!options.indexRoot) fail('supersession lookup requires --index-root <dir>', 'MISSING_ARG');
    const result = lookupWorkRecordSourceSupersession({
      sourceRef: options.source,
      indexRoot: options.indexRoot,
      sourceRoots: options.roots,
      replacementRoots: options.replacementRoots,
      repoRoot: process.cwd(),
    });
    emitJSON(result, failedResult(result));
    if (failedResult(result)) process.exit(1);
    return true;
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
    emitJSON(result, failedResult(result));
    if (failedResult(result)) process.exit(1);
    return true;
  }
  fail(`Unknown supersession subcommand: ${action || ''}`, 'UNKNOWN_COMMAND');
  return true;
}
