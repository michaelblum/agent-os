import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {
  readWorkRecord,
} from './work-record-consumer.js';
import {
  validateWorkRecordRepairAttemptPlan,
} from './work-record-repair-attempt-plan.js';
import {
  validateWorkRecordRepairAttemptArtifact,
} from './work-record-repair-attempt-artifact.js';
import {
  buildWorkRecordReplacementProposal,
  digestJson,
  validateWorkRecordReplacementProposal,
} from './work-record-replacement-proposal.js';
import {
  writeReplacementWorkRecord,
  materializeReplacementWorkRecord,
} from './work-record-replacement-writer.js';
import {
  lookupWorkRecordSourceSupersession,
  validateWorkRecordSourceSupersessionEntry,
  writeWorkRecordSourceSupersessionIndex,
} from './work-record-supersession-index.js';
import {
  planWorkRecordSourceSupersessionFromRecords,
} from './work-record-supersession-plan.js';
import {
  workRecordReadRecommendation,
  workRecordSupersessionLookupRecommendation,
  workRecordSupersessionWriteRecommendation,
} from './work-record-command-recommendation.js';

export const WORK_RECORD_REPAIR_FINALIZATION_RESULT_SCHEMA_VERSION = '2026-07-work-record-repair-finalization-result-v0';
export const WORK_RECORD_REPAIR_FINALIZATION_RESULT_TYPE = 'work_record.repair_finalization_result';
export const WORK_RECORD_REPAIR_FINALIZER_IMPLEMENTATION_VERSION = '2026-07-work-record-repair-finalizer-v0';

export const WORK_RECORD_REPAIR_FINALIZATION_STATUSES = [
  'dry_run',
  'finalized',
  'already_finalized',
  'not_required',
  'blocked_invalid_source',
  'blocked_invalid_attempt_plan',
  'blocked_invalid_attempt_artifact',
  'blocked_attempt_not_successful',
  'blocked_missing_evidence',
  'blocked_source_mutated',
  'blocked_health_mismatch',
  'blocked_replacement_proposal',
  'blocked_replacement_write',
  'blocked_supersession_write',
  'blocked_path_escape',
  'blocked_conflict',
  'partial_finalized',
  'stale',
  'mismatch',
  'unsupported',
];

function text(value, fallback = '') {
  const normalized = String(value ?? '').replace(/\s+/g, ' ').trim();
  return normalized || fallback;
}

function objectValue(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function arrayValue(value) {
  return Array.isArray(value) ? value : [];
}

function cloneJson(value) {
  if (value === undefined) return undefined;
  return JSON.parse(JSON.stringify(value));
}

function readJsonFile(file = '') {
  const resolved = path.resolve(file);
  try {
    return {
      path: resolved,
      value: JSON.parse(fs.readFileSync(resolved, 'utf8')),
      digest: fileDigest(resolved),
    };
  } catch (error) {
    return {
      path: resolved,
      error,
      digest: '',
    };
  }
}

function fileDigest(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function sourceIdentityFromRead(sourceRef = '', sourceRead = {}, digest = '') {
  return {
    id: text(sourceRead.record?.id || sourceRead.summary?.id),
    path: text(sourceRead.source?.path),
    requested_ref: text(sourceRef),
    schema_version: text(sourceRead.record?.schema_version || sourceRead.summary?.schema_version),
    digest: text(digest),
    digest_algorithm: 'sha256',
  };
}

function proposalDigest(proposal = {}) {
  return text(proposal.replacement_proposal_identity?.digest, digestJson(proposal));
}

function finalStatusFromProposal(status = '') {
  if (status === 'not_required') return 'not_required';
  if (status === 'blocked_attempt_failed' || status === 'blocked_attempt_partial') return 'blocked_attempt_not_successful';
  if (status === 'blocked_missing_evidence') return 'blocked_missing_evidence';
  if (status === 'blocked_source_mutated') return 'blocked_source_mutated';
  if (status === 'blocked_health_mismatch') return 'blocked_health_mismatch';
  if (status === 'stale') return 'stale';
  if (status === 'mismatch') return 'mismatch';
  if (status === 'unsupported') return 'unsupported';
  return 'blocked_replacement_proposal';
}

function finalStatusFromWriter(status = '') {
  if (status === 'blocked_output_escape') return 'blocked_path_escape';
  if (status === 'blocked_conflict') return 'blocked_conflict';
  if (status === 'blocked_source_changed') return 'blocked_source_mutated';
  return 'blocked_replacement_write';
}

function finalStatusFromSupersession(status = '') {
  if (status === 'blocked_index_escape') return 'blocked_path_escape';
  if (status === 'conflict') return 'blocked_conflict';
  if (status === 'blocked_source_changed') return 'blocked_source_mutated';
  return 'blocked_supersession_write';
}

function sideEffects({ writer = {}, supersession = {} } = {}) {
  return [
    ...arrayValue(writer.side_effects),
    ...arrayValue(supersession.side_effects),
  ];
}

function recoveryGuidance(status = '', result = {}) {
  if (status === 'finalized' || status === 'already_finalized') {
    const lookupRecommendation = workRecordSupersessionLookupRecommendation(
      text(result.source_work_record?.id || result.source_work_record?.path),
      text(result.supersession_index_result?.output?.index_root),
    );
    const readRecommendation = workRecordReadRecommendation(
      text(result.replacement_writer_result?.written_replacement_work_record?.id),
      text(result.replacement_writer_result?.output?.output_root),
    );
    return {
      action: 'lookup_or_read_replacement',
      recommendations: [
        {
          action: 'lookup_source_supersession_entry',
          argv: lookupRecommendation.argv,
          command_hint: lookupRecommendation.command_hint,
        },
        {
          action: 'read_written_replacement_work_record',
          argv: readRecommendation.argv,
          command_hint: readRecommendation.command_hint,
        },
      ],
    };
  }
  if (status === 'dry_run') {
    return {
      action: 'rerun_without_dry_run_to_finalize',
    };
  }
  if (status === 'partial_finalized') {
    const writeRecommendation = workRecordSupersessionWriteRecommendation({
      source: text(result.source_work_record?.id || result.source_work_record?.path),
      replacement: text(result.replacement_writer_result?.output?.output_path),
      indexRoot: text(result.supersession_index_result?.output?.index_root),
      replacementRoot: text(result.replacement_writer_result?.output?.output_root),
    });
    return {
      action: 'recover_by_writing_supersession_index',
      recommendations: [{
        action: 'write_source_supersession_entry',
        argv: writeRecommendation.argv,
        command_hint: writeRecommendation.command_hint,
      }],
    };
  }
  return {
    action: 'inspect_finalization_diagnostics',
    status,
  };
}

function baseResult({
  status = 'unsupported',
  mode = 'write',
  source = {},
  sourceDigestAfter = '',
  attemptPlan = {},
  attemptPlanPath = '',
  attemptPlanDigest = '',
  attemptPlanValidation = null,
  attemptArtifact = {},
  attemptArtifactPath = '',
  attemptArtifactDigest = '',
  attemptArtifactValidation = null,
  proposal = {},
  proposalValidation = null,
  writerResult = {},
  supersessionResult = {},
  sourceReadback = {},
  replacementReadback = {},
  supersessionValidation = null,
  diagnostics = [],
} = {}) {
  const result = {
    type: WORK_RECORD_REPAIR_FINALIZATION_RESULT_TYPE,
    schema_version: WORK_RECORD_REPAIR_FINALIZATION_RESULT_SCHEMA_VERSION,
    finalizer_implementation_version: WORK_RECORD_REPAIR_FINALIZER_IMPLEMENTATION_VERSION,
    status,
    mode,
    dry_run: mode === 'dry_run',
    writes_replacement_record: ['written', 'already_exists'].includes(text(writerResult.status)),
    writes_supersession_index_entry: ['written', 'already_exists'].includes(text(supersessionResult.status)),
    wrote_replacement_record: text(writerResult.status) === 'written',
    replacement_record_already_existed: text(writerResult.status) === 'already_exists',
    would_write_replacement_record: text(writerResult.status) === 'dry_run' && writerResult.idempotency?.existing !== true,
    wrote_supersession_index_entry: text(supersessionResult.status) === 'written',
    supersession_index_entry_already_existed: text(supersessionResult.status) === 'already_exists',
    would_write_supersession_index_entry: text(supersessionResult.status) === 'dry_run' && supersessionResult.idempotency?.existing !== true,
    source_work_record: {
      ...cloneJson(source),
      digest_before: text(source.digest),
      digest_after: text(sourceDigestAfter, text(source.digest)),
      immutable: text(source.digest) && text(sourceDigestAfter, text(source.digest)) === text(source.digest),
    },
    repair_attempt_plan: {
      path: text(attemptPlanPath),
      type: text(attemptPlan.type),
      schema_version: text(attemptPlan.schema_version),
      status: text(attemptPlan.status),
      digest: text(attemptPlanDigest),
      validation: attemptPlanValidation ? cloneJson(attemptPlanValidation) : null,
    },
    repair_attempt_artifact: {
      path: text(attemptArtifactPath),
      type: text(attemptArtifact.type),
      schema_version: text(attemptArtifact.schema_version),
      status: text(attemptArtifact.status),
      digest: text(attemptArtifactDigest),
      validation: attemptArtifactValidation ? cloneJson(attemptArtifactValidation) : null,
    },
    replacement_proposal: proposal && Object.keys(proposal).length > 0 ? {
      type: text(proposal.type),
      schema_version: text(proposal.schema_version),
      id: text(proposal.replacement_proposal_identity?.id),
      digest: proposalDigest(proposal),
      status: text(proposal.status),
      validation: proposalValidation ? cloneJson(proposalValidation) : null,
    } : {},
    replacement_writer_result: cloneJson(writerResult),
    supersession_index_result: cloneJson(supersessionResult),
    readback: {
      source: cloneJson(sourceReadback),
      replacement: cloneJson(replacementReadback),
      supersession_entry_validation: supersessionValidation ? cloneJson(supersessionValidation) : null,
    },
    side_effects: sideEffects({ writer: writerResult, supersession: supersessionResult }),
    executes_repair: false,
    executes_actions: false,
    uses_live_ui: false,
    uses_browser: false,
    uses_native_ax: false,
    uses_canvas: false,
    applies_patches: false,
    mutates_source_record: false,
    automatic_replay_allowed: false,
    diagnostics,
  };
  result.recovery = recoveryGuidance(status, result);
  result.recommended_next = result.recovery;
  return result;
}

export function finalizeWorkRecordRepair({
  sourceRef = '',
  attemptPlanPath = '',
  attemptArtifactPath = '',
  replacementRoot = '',
  indexRoot = '',
  proposedIdSeed = '',
  replacementOutputPath = '',
  dryRun = false,
  roots = [],
  repoRoot = process.cwd(),
} = {}) {
  const mode = dryRun ? 'dry_run' : 'write';
  const sourceRead = readWorkRecord(sourceRef, { roots, repoRoot });
  if (sourceRead.status !== 'success') {
    return baseResult({
      status: 'blocked_invalid_source',
      mode,
      source: { requested_ref: text(sourceRef) },
      diagnostics: arrayValue(sourceRead.diagnostics).length > 0 ? sourceRead.diagnostics : [{
        severity: 'error',
        code: 'REPAIR_FINALIZATION_SOURCE_READ_FAILED',
        message: sourceRead.error || 'Could not read source Work Record.',
        path: 'source',
      }],
    });
  }
  const sourcePath = text(sourceRead.source?.path);
  const sourceDigestBefore = sourcePath && fs.existsSync(sourcePath) ? fileDigest(sourcePath) : digestJson(sourceRead.record);
  const source = sourceIdentityFromRead(sourceRef, sourceRead, sourceDigestBefore);

  const attemptPlanRead = readJsonFile(attemptPlanPath);
  if (attemptPlanRead.error) {
    return baseResult({
      status: 'blocked_invalid_attempt_plan',
      mode,
      source,
      attemptPlanPath,
      diagnostics: [{
        severity: 'error',
        code: 'REPAIR_FINALIZATION_ATTEMPT_PLAN_READ_FAILED',
        message: `Repair Attempt Plan JSON is unreadable: ${attemptPlanRead.error.message}`,
        path: 'attempt_plan',
      }],
    });
  }
  const attemptPlan = objectValue(attemptPlanRead.value);
  const attemptPlanDigest = digestJson(attemptPlan);
  const attemptPlanValidation = validateWorkRecordRepairAttemptPlan(attemptPlan);
  if (attemptPlanValidation.status !== 'passed') {
    return baseResult({
      status: 'blocked_invalid_attempt_plan',
      mode,
      source,
      attemptPlan,
      attemptPlanPath: attemptPlanRead.path,
      attemptPlanDigest,
      attemptPlanValidation,
      diagnostics: attemptPlanValidation.diagnostics,
    });
  }

  const attemptArtifactRead = readJsonFile(attemptArtifactPath);
  if (attemptArtifactRead.error) {
    return baseResult({
      status: 'blocked_invalid_attempt_artifact',
      mode,
      source,
      attemptPlan,
      attemptPlanPath: attemptPlanRead.path,
      attemptPlanDigest,
      attemptPlanValidation,
      diagnostics: [{
        severity: 'error',
        code: 'REPAIR_FINALIZATION_ATTEMPT_ARTIFACT_READ_FAILED',
        message: `Repair Attempt Artifact JSON is unreadable: ${attemptArtifactRead.error.message}`,
        path: 'attempt_artifact',
      }],
    });
  }
  const attemptArtifact = objectValue(attemptArtifactRead.value);
  const attemptArtifactDigest = digestJson(attemptArtifact);
  const attemptArtifactValidation = validateWorkRecordRepairAttemptArtifact(attemptArtifact);
  if (attemptArtifactValidation.status !== 'passed') {
    return baseResult({
      status: 'blocked_invalid_attempt_artifact',
      mode,
      source,
      attemptPlan,
      attemptPlanPath: attemptPlanRead.path,
      attemptPlanDigest,
      attemptPlanValidation,
      attemptArtifact,
      attemptArtifactPath: attemptArtifactRead.path,
      attemptArtifactDigest,
      attemptArtifactValidation,
      diagnostics: attemptArtifactValidation.diagnostics,
    });
  }

  const sourceDigestAfterProposalRead = sourcePath && fs.existsSync(sourcePath) ? fileDigest(sourcePath) : sourceDigestBefore;
  const proposal = buildWorkRecordReplacementProposal({
    source_work_record: {
      ...sourceRead.summary,
      ...sourceRead.source,
      record: sourceRead.record,
      path: sourcePath,
      requested_ref: sourceRef,
      digest: sourceDigestBefore,
    },
    repair_attempt_plan: attemptPlan,
    repair_attempt_artifact: attemptArtifact,
    source_work_record_digest_after: sourceDigestAfterProposalRead,
    proposed_id_seed: proposedIdSeed,
  });
  const proposalValidation = validateWorkRecordReplacementProposal(proposal);
  if (proposalValidation.status !== 'passed' || text(proposal.status) !== 'proposed') {
    return baseResult({
      status: finalStatusFromProposal(text(proposal.status)),
      mode,
      source,
      sourceDigestAfter: sourceDigestAfterProposalRead,
      attemptPlan,
      attemptPlanPath: attemptPlanRead.path,
      attemptPlanDigest,
      attemptPlanValidation,
      attemptArtifact,
      attemptArtifactPath: attemptArtifactRead.path,
      attemptArtifactDigest,
      attemptArtifactValidation,
      proposal,
      proposalValidation,
      diagnostics: proposalValidation.status !== 'passed' ? proposalValidation.diagnostics : arrayValue(proposal.diagnostics),
    });
  }

  const writerPlan = writeReplacementWorkRecord({
    proposal,
    outputRoot: replacementRoot,
    outputPath: replacementOutputPath,
    dryRun: true,
  });
  const replacementRecord = materializeReplacementWorkRecord(proposal);
  const supersessionPlan = writerPlan.status === 'dry_run'
    ? planWorkRecordSourceSupersessionFromRecords({
      sourceRef,
      replacementRef: text(writerPlan.output?.output_path),
      sourceRecord: sourceRead.record,
      replacementRecord,
      sourcePath,
      replacementPath: text(writerPlan.output?.output_path),
      indexRoot,
      sourceRoots: roots,
      replacementRoots: [replacementRoot],
      writerResult: writerPlan,
      allowDryRunWriterResult: true,
      repoRoot,
    })
    : {};
  if (dryRun) {
    const status = writerPlan.status === 'dry_run' && supersessionPlan.status === 'dry_run'
      ? 'dry_run'
      : writerPlan.status === 'dry_run'
        ? finalStatusFromSupersession(supersessionPlan.status)
        : finalStatusFromWriter(writerPlan.status);
    return baseResult({
      status,
      mode,
      source,
      sourceDigestAfter: sourceDigestAfterProposalRead,
      attemptPlan,
      attemptPlanPath: attemptPlanRead.path,
      attemptPlanDigest,
      attemptPlanValidation,
      attemptArtifact,
      attemptArtifactPath: attemptArtifactRead.path,
      attemptArtifactDigest,
      attemptArtifactValidation,
      proposal,
      proposalValidation,
      writerResult: writerPlan,
      supersessionResult: supersessionPlan,
      diagnostics: [
        ...arrayValue(writerPlan.diagnostics),
        ...arrayValue(supersessionPlan.diagnostics),
      ],
    });
  }

  if (writerPlan.status !== 'dry_run') {
    return baseResult({
      status: finalStatusFromWriter(text(writerPlan.status)),
      mode,
      source,
      sourceDigestAfter: sourceDigestAfterProposalRead,
      attemptPlan,
      attemptPlanPath: attemptPlanRead.path,
      attemptPlanDigest,
      attemptPlanValidation,
      attemptArtifact,
      attemptArtifactPath: attemptArtifactRead.path,
      attemptArtifactDigest,
      attemptArtifactValidation,
      proposal,
      proposalValidation,
      writerResult: writerPlan,
      supersessionResult: supersessionPlan,
      diagnostics: [
        ...arrayValue(writerPlan.diagnostics),
        ...arrayValue(supersessionPlan.diagnostics),
      ],
    });
  }

  if (supersessionPlan.status !== 'dry_run') {
    return baseResult({
      status: finalStatusFromSupersession(text(supersessionPlan.status)),
      mode,
      source,
      sourceDigestAfter: sourceDigestAfterProposalRead,
      attemptPlan,
      attemptPlanPath: attemptPlanRead.path,
      attemptPlanDigest,
      attemptPlanValidation,
      attemptArtifact,
      attemptArtifactPath: attemptArtifactRead.path,
      attemptArtifactDigest,
      attemptArtifactValidation,
      proposal,
      proposalValidation,
      writerResult: writerPlan,
      supersessionResult: supersessionPlan,
      diagnostics: supersessionPlan.diagnostics,
    });
  }

  const writerResult = writeReplacementWorkRecord({
    proposal,
    outputRoot: replacementRoot,
    outputPath: replacementOutputPath,
    dryRun: false,
  });
  if (!['written', 'already_exists'].includes(text(writerResult.status))) {
    return baseResult({
      status: finalStatusFromWriter(text(writerResult.status)),
      mode,
      source,
      sourceDigestAfter: sourceDigestAfterProposalRead,
      attemptPlan,
      attemptPlanPath: attemptPlanRead.path,
      attemptPlanDigest,
      attemptPlanValidation,
      attemptArtifact,
      attemptArtifactPath: attemptArtifactRead.path,
      attemptArtifactDigest,
      attemptArtifactValidation,
      proposal,
      proposalValidation,
      writerResult,
      supersessionResult: supersessionPlan,
      diagnostics: writerResult.diagnostics,
    });
  }

  const replacementPath = text(writerResult.output?.output_path);
  const replacementRead = readWorkRecord(replacementPath, {
    roots: [replacementRoot],
    repoRoot,
  });
  if (replacementRead.status !== 'success') {
    return baseResult({
      status: 'partial_finalized',
      mode,
      source,
      sourceDigestAfter: sourceDigestAfterProposalRead,
      attemptPlan,
      attemptPlanPath: attemptPlanRead.path,
      attemptPlanDigest,
      attemptPlanValidation,
      attemptArtifact,
      attemptArtifactPath: attemptArtifactRead.path,
      attemptArtifactDigest,
      attemptArtifactValidation,
      proposal,
      proposalValidation,
      writerResult,
      replacementReadback: replacementRead,
      diagnostics: arrayValue(replacementRead.diagnostics),
    });
  }

  const supersessionResult = writeWorkRecordSourceSupersessionIndex({
    sourceRef,
    replacementRef: replacementPath,
    indexRoot,
    sourceRoots: roots,
    replacementRoots: [replacementRoot],
    writerResult,
    dryRun: false,
    repoRoot,
  });
  const sourceDigestAfter = sourcePath && fs.existsSync(sourcePath) ? fileDigest(sourcePath) : sourceDigestBefore;
  if (!['written', 'already_exists'].includes(text(supersessionResult.status))) {
    return baseResult({
      status: writerResult.status === 'written' ? 'partial_finalized' : finalStatusFromSupersession(text(supersessionResult.status)),
      mode,
      source,
      sourceDigestAfter,
      attemptPlan,
      attemptPlanPath: attemptPlanRead.path,
      attemptPlanDigest,
      attemptPlanValidation,
      attemptArtifact,
      attemptArtifactPath: attemptArtifactRead.path,
      attemptArtifactDigest,
      attemptArtifactValidation,
      proposal,
      proposalValidation,
      writerResult,
      supersessionResult,
      replacementReadback: replacementRead,
      diagnostics: supersessionResult.diagnostics,
    });
  }

  const entryPath = text(supersessionResult.output?.index_path);
  const entry = entryPath && fs.existsSync(entryPath) ? JSON.parse(fs.readFileSync(entryPath, 'utf8')) : null;
  const supersessionValidation = entry ? validateWorkRecordSourceSupersessionEntry(entry) : {
    status: 'failed',
    diagnostics: [{
      severity: 'error',
      code: 'REPAIR_FINALIZATION_SUPERSESSION_ENTRY_MISSING',
      message: 'Supersession writer reported success but no entry file was readable.',
      path: 'supersession_index_result.output.index_path',
    }],
  };
  const lookup = lookupWorkRecordSourceSupersession({
    sourceRef,
    indexRoot,
    sourceRoots: roots,
    repoRoot,
  });
  const sourceUnchanged = sourceDigestAfter === sourceDigestBefore;
  const replacementMatches = replacementRead.status === 'success'
    && text(replacementRead.record?.id) === text(writerResult.written_replacement_work_record?.id);
  const supersessionValid = supersessionValidation.status === 'passed' && lookup.status === 'active';
  const finalStatus = sourceUnchanged && replacementMatches && supersessionValid
    ? (writerResult.status === 'already_exists' && supersessionResult.status === 'already_exists' ? 'already_finalized' : 'finalized')
    : !sourceUnchanged
      ? 'blocked_source_mutated'
      : 'partial_finalized';

  return baseResult({
    status: finalStatus,
    mode,
    source,
    sourceDigestAfter,
    attemptPlan,
    attemptPlanPath: attemptPlanRead.path,
    attemptPlanDigest,
    attemptPlanValidation,
    attemptArtifact,
    attemptArtifactPath: attemptArtifactRead.path,
    attemptArtifactDigest,
    attemptArtifactValidation,
    proposal,
    proposalValidation,
    writerResult,
    supersessionResult,
    sourceReadback: lookup,
    replacementReadback: replacementRead,
    supersessionValidation,
    diagnostics: finalStatus === 'finalized' || finalStatus === 'already_finalized' ? [] : [
      ...arrayValue(supersessionValidation.diagnostics),
      ...arrayValue(lookup.diagnostics),
    ],
  });
}
