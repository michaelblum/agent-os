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
  WORK_RECORD_SOURCE_SUPERSESSION_INDEX_SCHEMA_VERSION,
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
} from './work-record-command-recommendation.js';
import {
  readTextFileNoFollow,
} from './work-record-atomic-publish.js';

export const WORK_RECORD_REPAIR_FINALIZATION_RESULT_SCHEMA_VERSION = '2026-08-work-record-repair-finalization-result-v1';
export const WORK_RECORD_REPAIR_FINALIZATION_RESULT_TYPE = 'work_record.repair_finalization_result';
export const WORK_RECORD_REPAIR_FINALIZER_IMPLEMENTATION_VERSION = '2026-08-work-record-repair-finalizer-v1';

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

function rawText(value, fallback = '') {
  const raw = String(value ?? '');
  return raw || fallback;
}

function objectValue(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function arrayValue(value) {
  return Array.isArray(value) ? value : [];
}

function readPinnedJsonFile(file = '', boundaryRoot = '', expectedIdentity = null) {
  const read = readTextFileNoFollow(file, {
    boundaryRoot,
    expectedIdentity,
  });
  if (read.status !== 'readable') {
    return {
      path: file,
      digest: '',
      error: read.error || new Error(`Path identity is not safely readable (${read.status}).`),
    };
  }
  try {
    return {
      path: file,
      digest: read.existing_digest,
      value: JSON.parse(read.bytes),
    };
  } catch (error) {
    return { path: file, digest: read.existing_digest, error };
  }
}

function cloneJson(value) {
  if (value === undefined) return undefined;
  return JSON.parse(JSON.stringify(value));
}

function readJsonFile(file = '') {
  const resolved = path.resolve(file);
  try {
    const bytes = fs.readFileSync(resolved);
    return {
      path: resolved,
      value: JSON.parse(bytes.toString('utf8')),
      digest: crypto.createHash('sha256').update(bytes).digest('hex'),
    };
  } catch (error) {
    return {
      path: resolved,
      error,
      digest: '',
    };
  }
}

function readFileDigest(file = '') {
  const resolved = path.resolve(file);
  try {
    return {
      path: resolved,
      digest: fileDigest(resolved),
    };
  } catch (error) {
    return {
      path: resolved,
      digest: '',
      error,
    };
  }
}

function fileDigest(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function sourceIdentityFromRead(sourceRef = '', sourceRead = {}, digest = '') {
  return {
    id: text(sourceRead.record?.id || sourceRead.summary?.id),
    path: rawText(sourceRead.source?.path),
    requested_ref: rawText(sourceRef),
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
      result.source_work_record?.id || result.source_work_record?.path,
      result.supersession_index_result?.output?.index_root,
    );
    const readRecommendation = workRecordReadRecommendation(
      result.replacement_writer_result?.written_replacement_work_record?.id,
      result.replacement_writer_result?.output?.output_root,
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
    const supersession = objectValue(result.supersession_index_result);
    const writer = objectValue(result.replacement_writer_result);
    if (supersession.atomic_write?.published === true && supersession.atomic_write?.cleanup_failed === true) {
      return {
        action: 'inspect_published_supersession_and_cleanup_temp',
        temp_file: rawText(supersession.atomic_write.temp_file),
        published_index_path: rawText(supersession.output?.index_path),
        recommendations: [cloneJson(objectValue(supersession.recommended_next))],
      };
    }
    if (supersession.atomic_write?.published === true) {
      return {
        action: 'inspect_published_finalization_state',
        published_index_path: rawText(supersession.output?.index_path),
        published_replacement_path: rawText(writer.output?.output_path),
        recommendations: [cloneJson(objectValue(supersession.recommended_next))],
      };
    }
    if (writer.atomic_write?.published === true && writer.atomic_write?.cleanup_failed === true) {
      return {
        action: 'inspect_published_replacement_and_cleanup_temp',
        temp_file: rawText(writer.atomic_write.temp_file),
        published_replacement_path: rawText(writer.output?.output_path),
        recommendations: [cloneJson(objectValue(writer.recommended_next))],
      };
    }
    if (['written', 'already_exists'].includes(text(writer.status))) {
      return {
        action: 'persist_writer_result_then_write_supersession',
        required_input: {
          id: 'writer_result_path',
          source: 'replacement_writer_result',
          accepted_statuses: ['written', 'already_exists'],
        },
        source: rawText(result.source_work_record?.requested_ref || result.source_work_record?.path),
        replacement: rawText(writer.output?.output_path),
        index_root: rawText(supersession.output?.index_root),
        replacement_root: rawText(writer.output?.output_root),
        recommendations: [],
      };
    }
    return {
      action: 'inspect_finalization_diagnostics',
      recommendations: [],
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
    writes_replacement_record: writerResult.writes_replacement_record === true || ['written', 'already_exists'].includes(text(writerResult.status)),
    writes_supersession_index_entry: supersessionResult.writes_index_entry === true || ['written', 'already_exists'].includes(text(supersessionResult.status)),
    wrote_replacement_record: text(writerResult.status) === 'written' || writerResult.atomic_write?.published === true,
    replacement_record_already_existed: text(writerResult.status) === 'already_exists',
    would_write_replacement_record: text(writerResult.status) === 'dry_run' && writerResult.idempotency?.existing !== true,
    wrote_supersession_index_entry: text(supersessionResult.status) === 'written'
      || supersessionResult.atomic_write?.published === true,
    supersession_index_entry_already_existed: text(supersessionResult.status) === 'already_exists',
    would_write_supersession_index_entry: text(supersessionResult.status) === 'dry_run' && supersessionResult.idempotency?.existing !== true,
    source_work_record: {
      ...cloneJson(source),
      digest_before: text(source.digest),
      digest_after: text(sourceDigestAfter, text(source.digest)),
      immutable: text(source.digest) && text(sourceDigestAfter, text(source.digest)) === text(source.digest),
    },
    repair_attempt_plan: {
      path: rawText(attemptPlanPath),
      type: text(attemptPlan.type),
      schema_version: text(attemptPlan.schema_version),
      status: text(attemptPlan.status),
      digest: text(attemptPlanDigest),
      validation: attemptPlanValidation ? cloneJson(attemptPlanValidation) : null,
    },
    repair_attempt_artifact: {
      path: rawText(attemptArtifactPath),
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
      source: { requested_ref: rawText(sourceRef) },
      diagnostics: arrayValue(sourceRead.diagnostics).length > 0 ? sourceRead.diagnostics : [{
        severity: 'error',
        code: 'REPAIR_FINALIZATION_SOURCE_READ_FAILED',
        message: sourceRead.error || 'Could not read source Work Record.',
        path: 'source',
      }],
    });
  }
  const sourcePath = rawText(sourceRead.source?.path);
  const sourceDigestReadBefore = sourcePath
    ? readFileDigest(sourcePath)
    : { path: '', digest: digestJson(sourceRead.record) };
  if (sourceDigestReadBefore.error) {
    return baseResult({
      status: 'blocked_invalid_source',
      mode,
      source: {
        requested_ref: rawText(sourceRef),
        path: sourcePath,
      },
      diagnostics: [{
        severity: 'error',
        code: 'REPAIR_FINALIZATION_SOURCE_DIGEST_READ_FAILED',
        message: `Source Work Record digest could not be read: ${sourceDigestReadBefore.error.message}`,
        path: 'source_work_record.path',
      }],
    });
  }
  const sourceDigestBefore = sourceDigestReadBefore.digest;
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

  const sourceDigestAfterProposal = sourcePath
    ? readFileDigest(sourcePath)
    : { path: '', digest: sourceDigestBefore };
  if (sourceDigestAfterProposal.error) {
    return baseResult({
      status: 'blocked_source_mutated',
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
      diagnostics: [{
        severity: 'error',
        code: 'REPAIR_FINALIZATION_SOURCE_DIGEST_READBACK_FAILED',
        message: `Source Work Record digest readback failed before proposal construction: ${sourceDigestAfterProposal.error.message}`,
        path: 'source_work_record.path',
      }],
    });
  }
  const sourceDigestAfterProposalRead = sourceDigestAfterProposal.digest;
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
      replacementRef: rawText(writerPlan.output?.output_path),
      sourceRecord: sourceRead.record,
      replacementRecord,
      sourcePath,
      replacementPath: rawText(writerPlan.output?.output_path),
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
      status: writerResult.writes_replacement_record === true ? 'partial_finalized' : finalStatusFromWriter(text(writerResult.status)),
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

  const replacementPath = rawText(writerResult.output?.output_path);
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

  let supersessionResult;
  try {
    supersessionResult = writeWorkRecordSourceSupersessionIndex({
      sourceRef,
      replacementRef: replacementPath,
      indexRoot,
      sourceRoots: roots,
      replacementRoots: [replacementRoot],
      writerResult,
      dryRun: false,
      repoRoot,
    });
  } catch (error) {
    supersessionResult = {
      type: 'work_record.source_supersession_index_writer_result',
      schema_version: WORK_RECORD_SOURCE_SUPERSESSION_INDEX_SCHEMA_VERSION,
      status: 'blocked_write_failed',
      mode: 'write',
      index_writer_result: {
        status: 'blocked_write_failed',
        index_root: rawText(indexRoot),
        index_path: '',
        relationship: 'superseded_by',
      },
      source_work_record: cloneJson(source),
      replacement_work_record: cloneJson(writerResult.written_replacement_work_record),
      output: {
        index_root: rawText(indexRoot),
        index_path: '',
        deterministic_filename: 'active.json',
        digest: '',
      },
      atomic_write: {
        published: false,
      },
      side_effects: [],
      writes_index_entry: false,
      would_write_index_entry: false,
      mutates_source_record: false,
      mutates_replacement_record: false,
      executes_repair: false,
      executes_actions: false,
      applies_patches: false,
      diagnostics: [{
        severity: 'error',
        code: 'REPAIR_FINALIZATION_SUPERSESSION_WRITE_FAILED',
        message: `Source Supersession planning or write failed after replacement publication: ${error.message}`,
        path: 'supersession_index_result',
      }],
      recommended_next: {
        action: 'inspect_index_writer_diagnostics',
      },
    };
  }
  const sourceDigestReadAfter = sourcePath
    ? readFileDigest(sourcePath)
    : { path: '', digest: sourceDigestBefore };
  const sourceDigestAfter = text(sourceDigestReadAfter.digest);
  const sourceReadbackDiagnostics = sourceDigestReadAfter.error ? [{
    severity: 'error',
    code: 'REPAIR_FINALIZATION_SOURCE_READBACK_FAILED',
    message: `Source Work Record digest readback failed after publication: ${sourceDigestReadAfter.error.message}`,
    path: 'source_work_record.path',
  }] : [];
  if (!['written', 'already_exists'].includes(text(supersessionResult.status))) {
    const supersessionPublished = supersessionResult.atomic_write?.published === true;
    const replacementReadbackAfterFailure = supersessionPublished
      ? readWorkRecord(replacementPath, {
        roots: [replacementRoot],
        repoRoot,
      })
      : replacementRead;
    return baseResult({
      status: writerResult.status === 'written' || supersessionPublished
        ? 'partial_finalized'
        : finalStatusFromSupersession(text(supersessionResult.status)),
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
      replacementReadback: replacementReadbackAfterFailure,
      diagnostics: [
        ...arrayValue(supersessionResult.diagnostics),
        ...arrayValue(replacementReadbackAfterFailure.diagnostics),
        ...sourceReadbackDiagnostics,
      ],
    });
  }

  const entryPath = rawText(supersessionResult.output?.index_path);
  const entryRead = entryPath ? readPinnedJsonFile(
    entryPath,
    indexRoot,
    supersessionResult.atomic_write?.destination_identity,
  ) : {
    path: '',
    digest: '',
    error: new Error('Supersession writer returned no index path.'),
  };
  const entry = entryRead.error ? null : objectValue(entryRead.value);
  let supersessionValidation = entry ? validateWorkRecordSourceSupersessionEntry(entry) : {
    status: 'failed',
    diagnostics: [{
      severity: 'error',
      code: 'REPAIR_FINALIZATION_SUPERSESSION_ENTRY_READBACK_FAILED',
      message: `Supersession writer reported success but its entry could not be read and parsed: ${entryRead.error?.message || 'missing index path'}`,
      path: 'supersession_index_result.output.index_path',
    }],
  };
  if (supersessionValidation.status === 'passed'
    && text(entryRead.digest) !== text(supersessionResult.output?.digest)) {
    supersessionValidation = {
      status: 'failed',
      diagnostics: [{
        severity: 'error',
        code: 'REPAIR_FINALIZATION_SUPERSESSION_ENTRY_DIGEST_MISMATCH',
        message: 'Supersession entry readback bytes do not match the Index Writer output digest.',
        path: 'supersession_index_result.output.digest',
        expected_digest: text(supersessionResult.output?.digest),
        actual_digest: text(entryRead.digest),
      }],
    };
  }
  let lookup;
  try {
    lookup = lookupWorkRecordSourceSupersession({
      sourceRef,
      indexRoot,
      sourceRoots: roots,
      replacementRoots: [replacementRoot],
      repoRoot,
    });
  } catch (error) {
    lookup = {
      status: 'malformed_index',
      relationship_status: 'malformed_index',
      entries: [],
      diagnostics: [{
        severity: 'error',
        code: 'REPAIR_FINALIZATION_SUPERSESSION_LOOKUP_FAILED',
        message: `Post-publication Source Supersession lookup failed: ${error.message}`,
        path: 'supersession_index_result.output.index_root',
      }],
    };
  }
  const replacementFileRead = replacementPath ? readPinnedJsonFile(
    replacementPath,
    replacementRoot,
    writerResult.atomic_write?.destination_identity,
  ) : {
    path: '',
    digest: '',
    error: new Error('Replacement Writer returned no output path.'),
  };
  const replacementReadAfter = replacementFileRead.error
    ? {
      status: 'failed',
      diagnostics: [{
        severity: 'error',
        code: 'REPAIR_FINALIZATION_REPLACEMENT_READBACK_FAILED',
        message: `Published replacement Work Record could not be read and parsed: ${replacementFileRead.error.message}`,
        path: 'replacement_writer_result.output.output_path',
      }],
    }
    : readWorkRecord(replacementPath, {
      roots: [replacementRoot],
      repoRoot,
    });
  const sourceUnchanged = !sourceDigestReadAfter.error && sourceDigestAfter === sourceDigestBefore;
  const replacementMatches = !replacementFileRead.error
    && replacementReadAfter.status === 'success'
    && text(replacementReadAfter.record?.id) === text(writerResult.written_replacement_work_record?.id)
    && digestJson(replacementReadAfter.record) === text(writerResult.written_replacement_work_record?.digest)
    && digestJson(replacementFileRead.value) === text(writerResult.written_replacement_work_record?.digest)
    && text(replacementFileRead.digest) === text(writerResult.output?.digest);
  const lookupReplacementProven = lookup.status === 'active'
    && arrayValue(lookup.entries).length === 1
    && arrayValue(lookup.entries).every((item) => text(objectValue(item).replacement_readback?.status) === 'readable');
  const supersessionValid = supersessionValidation.status === 'passed' && lookupReplacementProven;
  const postPublicationReadFailed = Boolean(sourceDigestReadAfter.error || entryRead.error || replacementFileRead.error);
  const finalStatus = sourceUnchanged && replacementMatches && supersessionValid
    ? (writerResult.status === 'already_exists' && supersessionResult.status === 'already_exists' ? 'already_finalized' : 'finalized')
    : postPublicationReadFailed
      ? 'partial_finalized'
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
    replacementReadback: replacementReadAfter,
    supersessionValidation,
    diagnostics: finalStatus === 'finalized' || finalStatus === 'already_finalized' ? [] : [
      ...arrayValue(supersessionValidation.diagnostics),
      ...arrayValue(lookup.diagnostics),
      ...arrayValue(replacementReadAfter.diagnostics),
      ...sourceReadbackDiagnostics,
    ],
  });
}
