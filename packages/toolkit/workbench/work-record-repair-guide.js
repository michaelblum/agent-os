import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {
  explainWorkRecordStatus,
  readWorkRecord,
} from './work-record-consumer.js';
import { planWorkRecordRepair } from './work-record-repair-plan.js';
import {
  planWorkRecordRepairAttempt,
  validateWorkRecordRepairAttemptPlan,
} from './work-record-repair-attempt-plan.js';
import {
  digestJson,
  validateWorkRecordRepairAttemptArtifact,
} from './work-record-repair-attempt-artifact.js';
import { finalizeWorkRecordRepair } from './work-record-repair-finalizer.js';
import { lookupWorkRecordSourceSupersession } from './work-record-supersession-index.js';
import {
  arrayValue,
  attemptDescriptors,
  cloneJson,
  descriptor,
  finalizationDescriptor,
  recommendedPaths,
  rawText,
  sourceArg,
  stageEnvelope,
  summarizeAttemptArtifact,
  summarizeAttemptPlan,
  summarizeFinalization,
  summarizeRepairPlan,
  summarizeStatus,
  summarizeSupersession,
  supersessionDescriptors,
  text,
} from './work-record-repair-guide-descriptors.js';
import { buildGuideRecoverySummary } from './work-record-recovery-summary.js';

export const WORK_RECORD_REPAIR_GUIDE_SCHEMA_VERSION = '2026-08-work-record-repair-guided-recovery-v1';
export const WORK_RECORD_REPAIR_GUIDE_TYPE = 'work_record.repair_guided_recovery';
export const WORK_RECORD_REPAIR_GUIDE_IMPLEMENTATION_VERSION = '2026-08-work-record-repair-guide-v1';
export const WORK_RECORD_REPAIR_GUIDE_STAGES = Object.freeze([
  'valid_no_repair_needed',
  'superseded',
  'retired_or_impossible',
  'repair_plan_unavailable',
  'blocked_inputs',
  'ready_to_plan_attempt',
  'ready_for_attempt_outcomes',
  'attempt_plan_invalid',
  'attempt_artifact_invalid',
  'ready_to_finalize',
  'finalization_blocked',
  'finalized',
  'unsupported',
]);

const NON_EXECUTION_FLAGS = Object.freeze({
  mutates_record: false,
  writes_replacement_record: false,
  writes_supersession_index_entry: false,
  executes_repair: false,
  executes_actions: false,
  runs_recommended_commands: false,
  applies_patches: false,
  uses_live_ui: false,
  uses_browser: false,
  uses_native_ax: false,
  uses_canvas: false,
});

function objectValue(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function fileDigest(file = '') {
  if (!file || !fs.existsSync(file)) return '';
  return `sha256:${crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')}`;
}

function readJsonFile(file = '') {
  const resolved = path.resolve(file);
  try {
    return {
      status: 'success',
      path: resolved,
      value: JSON.parse(fs.readFileSync(resolved, 'utf8')),
      digest: fileDigest(resolved),
    };
  } catch (error) {
    return {
      status: 'failed',
      path: resolved,
      error: error.message,
      diagnostics: [{
        severity: 'error',
        code: 'WORK_RECORD_REPAIR_GUIDE_JSON_READ_FAILED',
        message: `Could not read JSON file: ${error.message}`,
        path: resolved,
      }],
    };
  }
}

function sourceIdentity(read = {}, sourceRef = '') {
  return {
    id: text(read.summary?.id || read.record?.id),
    path: rawText(read.source?.path),
    requested_ref: rawText(sourceRef),
    schema_version: text(read.summary?.schema_version || read.record?.schema_version),
    digest: fileDigest(read.source?.path),
  };
}

function withRecoverySummary(envelope) {
  return { ...envelope, recovery_summary: buildGuideRecoverySummary(envelope) };
}

function bareDigest(value = '') {
  return text(value).replace(/^sha256:/, '');
}

function attemptArtifactBindingDiagnostics({ artifact = {}, source = {}, attemptPlan = {} } = {}) {
  const value = objectValue(artifact);
  const diagnostics = [];
  const add = (code, message, diagnosticPath) => diagnostics.push({
    severity: 'error', code, message, path: diagnosticPath,
  });
  const normalizedSource = (identity) => ({
    id: text(identity?.id),
    path: rawText(identity?.path),
    requested_ref: rawText(identity?.requested_ref),
    schema_version: text(identity?.schema_version),
    digest: bareDigest(identity?.digest),
  });
  if (digestJson(normalizedSource(value.source_work_record)) !== digestJson(normalizedSource(source))) {
    add('WORK_RECORD_REPAIR_GUIDE_ARTIFACT_SOURCE_MISMATCH', 'Attempt Artifact source identity does not exactly match the guide source Work Record.', 'repair_attempt_artifact.source_work_record');
  }
  if (digestJson(value.repair_plan) !== digestJson(attemptPlan.repair_plan)) {
    add('WORK_RECORD_REPAIR_GUIDE_ARTIFACT_REPAIR_PLAN_MISMATCH', 'Attempt Artifact Repair Plan identity does not match the current derived Attempt Plan.', 'repair_attempt_artifact.repair_plan');
  }
  if (text(value.repair_attempt_plan?.digest) !== digestJson(attemptPlan)
    || digestJson(value.repair_attempt_plan?.attempt_identity) !== digestJson(attemptPlan.attempt_identity)) {
    add('WORK_RECORD_REPAIR_GUIDE_ARTIFACT_ATTEMPT_PLAN_MISMATCH', 'Attempt Artifact Attempt Plan digest/identity does not match the current derived Attempt Plan.', 'repair_attempt_artifact.repair_attempt_plan');
  }
  if (digestJson(value.planned_operations) !== digestJson(attemptPlan.planned_operations)) {
    add('WORK_RECORD_REPAIR_GUIDE_ARTIFACT_OPERATIONS_MISMATCH', 'Attempt Artifact planned operations do not match the current derived Attempt Plan.', 'repair_attempt_artifact.planned_operations');
  }
  if (digestJson(value.planned_candidate_patches) !== digestJson(attemptPlan.candidate_patches)) {
    add('WORK_RECORD_REPAIR_GUIDE_ARTIFACT_PATCHES_MISMATCH', 'Attempt Artifact planned candidate patch does not match the current derived Attempt Plan.', 'repair_attempt_artifact.planned_candidate_patches');
  }
  if (digestJson(value.planned_evidence_requirements) !== digestJson(attemptPlan.evidence_requirements)) {
    add('WORK_RECORD_REPAIR_GUIDE_ARTIFACT_EVIDENCE_REQUIREMENTS_MISMATCH', 'Attempt Artifact evidence requirements do not match the current derived Attempt Plan.', 'repair_attempt_artifact.planned_evidence_requirements');
  }
  return diagnostics;
}

export function guideWorkRecordRepair({
  sourceRef = '',
  roots = [],
  profileId = undefined,
  attemptPlanPath = '',
  attemptArtifactPath = '',
  replacementRoot = '',
  replacementRoots = [],
  indexRoot = '',
  proposedIdSeed = '',
  replacementOutputPath = '',
  repoRoot = process.cwd(),
} = {}) {
  const context = { roots, profileId, repoRoot };
  const read = readWorkRecord(sourceRef, context);
  const source = sourceIdentity(read, sourceRef);
  const paths = recommendedPaths(source, sourceRef);
  const report = {
    type: WORK_RECORD_REPAIR_GUIDE_TYPE,
    schema_version: WORK_RECORD_REPAIR_GUIDE_SCHEMA_VERSION,
    guide_implementation_version: WORK_RECORD_REPAIR_GUIDE_IMPLEMENTATION_VERSION,
    status: 'success',
    source_work_record: {
      ...source,
      match: text(read.source?.match),
      read_status: text(read.status),
    },
    current_status_report: null,
    repair_plan_summary: null,
    repair_attempt_plan_summary: null,
    repair_attempt_artifact_validation: null,
    finalization_dry_run_summary: null,
    supersession_lookup_summary: null,
    artifact_path_recommendations: paths,
    non_execution_flags: { ...NON_EXECUTION_FLAGS },
    ...NON_EXECUTION_FLAGS,
    diagnostics: [],
  };

  if (read.status !== 'success') {
    report.diagnostics = arrayValue(read.diagnostics);
    return withRecoverySummary({
      ...report,
      status: 'failed',
      ...stageEnvelope({
        stage: 'unsupported',
        status: 'unsupported',
        why: read.error || 'The source Work Record could not be read.',
        evidence: ['readWorkRecord'],
        blockers: arrayValue(read.diagnostics),
        missingInputs: ['active_source_work_record_v1'],
      }),
    });
  }

  const status = explainWorkRecordStatus(sourceRef, context);
  const repairPlan = planWorkRecordRepair(sourceRef, context);
  const attemptPlan = planWorkRecordRepairAttempt(sourceRef, { ...context, repairPlan });
  report.current_status_report = summarizeStatus(status);
  report.repair_plan_summary = summarizeRepairPlan(repairPlan);
  report.repair_attempt_plan_summary = summarizeAttemptPlan(attemptPlan);

  if (indexRoot) {
    const lookup = lookupWorkRecordSourceSupersession({
      sourceRef,
      indexRoot,
      sourceRoots: roots,
      replacementRoots: [...replacementRoots, replacementRoot].filter(Boolean),
      repoRoot,
    });
    report.supersession_lookup_summary = summarizeSupersession(lookup);
    if (lookup.status === 'active') {
      return withRecoverySummary({
        ...report,
        ...stageEnvelope({
          stage: 'superseded',
          status: 'complete',
          why: 'The source supersession index resolves an active replacement.',
          evidence: ['supersession_lookup:active'],
          nextCommand: supersessionDescriptors(sourceRef, source, indexRoot)[0],
        }),
      });
    }
  }

  if (repairPlan.status === 'no_repair_needed') {
    return withRecoverySummary({
      ...report,
      ...stageEnvelope({
        stage: 'valid_no_repair_needed',
        status: 'not_required',
        why: 'Current report-only verification says no repair is needed.',
        evidence: ['repair_plan:no_repair_needed'],
        nextCommand: descriptor({
          id: 'work-record-read',
          purpose: 'Read the valid Work Record.',
          argv: ['./aos', 'work-record', 'read', sourceArg(sourceRef, source), '--json'],
          nextStageAfterSuccess: 'valid_no_repair_needed',
        }),
      }),
    });
  }

  if (repairPlan.status === 'superseded') {
    return withRecoverySummary({
      ...report,
      ...stageEnvelope({
        stage: 'superseded',
        status: 'complete',
        why: 'The Repair Plan reports the source Work Record is superseded.',
        evidence: ['repair_plan:superseded'],
        nextCommand: indexRoot ? supersessionDescriptors(sourceRef, source, indexRoot)[0] : null,
        missingInputs: indexRoot ? [] : ['index_root'],
      }),
    });
  }

  if (repairPlan.status === 'retired' || repairPlan.status === 'not_repairable') {
    return withRecoverySummary({
      ...report,
      ...stageEnvelope({
        stage: 'retired_or_impossible',
        status: 'not_required',
        why: `The Repair Plan status is ${repairPlan.status}; no repair proposal is available.`,
        evidence: [`repair_plan:${repairPlan.status}`],
      }),
    });
  }

  if (repairPlan.status === 'blocked_inputs' || attemptPlan.status === 'blocked_inputs') {
    return withRecoverySummary({
      ...report,
      ...stageEnvelope({
        stage: 'blocked_inputs',
        status: 'blocked',
        why: 'Required evidence or mechanical inputs are incomplete.',
        evidence: [`repair_plan:${repairPlan.status}`, `repair_attempt_plan:${attemptPlan.status}`],
        blockers: [...arrayValue(repairPlan.diagnostics), ...arrayValue(attemptPlan.diagnostics)],
        nextCommand: attemptDescriptors(sourceRef, source, paths)[0],
      }),
    });
  }

  if (attemptPlan.status !== 'ready') {
    return withRecoverySummary({
      ...report,
      ...stageEnvelope({
        stage: 'repair_plan_unavailable',
        status: attemptPlan.status === 'not_required' ? 'not_required' : 'blocked',
        why: `Repair Attempt Plan status is ${attemptPlan.status}.`,
        evidence: [`repair_attempt_plan:${attemptPlan.status}`],
        blockers: arrayValue(attemptPlan.diagnostics),
      }),
    });
  }

  if (attemptPlanPath) {
    const suppliedPlanRead = readJsonFile(attemptPlanPath);
    const suppliedPlanValidation = suppliedPlanRead.status === 'success'
      ? validateWorkRecordRepairAttemptPlan(suppliedPlanRead.value)
      : { status: 'failed', diagnostics: suppliedPlanRead.diagnostics };
    const suppliedMatchesDerived = suppliedPlanValidation.status === 'passed'
      && digestJson(suppliedPlanRead.value) === digestJson(attemptPlan);
    if (!suppliedMatchesDerived) {
      const diagnostics = suppliedPlanValidation.status === 'passed'
        ? [{
          severity: 'error',
          code: 'WORK_RECORD_REPAIR_GUIDE_ATTEMPT_PLAN_MISMATCH',
          message: 'The supplied Repair Attempt Plan does not exactly match the current source-bound derived plan.',
          path: suppliedPlanRead.path,
        }]
        : arrayValue(suppliedPlanValidation.diagnostics);
      return withRecoverySummary({
        ...report,
        ...stageEnvelope({
          stage: 'attempt_plan_invalid',
          status: 'blocked',
          why: 'The supplied Repair Attempt Plan is invalid or stale for the current source Work Record.',
          evidence: [`attempt_plan_validation:${suppliedPlanValidation.status}`],
          blockers: diagnostics,
        }),
      });
    }
  }

  if (!attemptArtifactPath) {
    const commands = attemptDescriptors(sourceRef, source, paths);
    const artifactBuilder = descriptor({
      id: 'work-record-attempt-artifact-build',
      purpose: 'Build an Attempt Artifact from caller-supplied execution outcomes.',
      argv: ['./aos', 'work-record', 'attempt-artifact', 'build', '--input', '<caller-outcomes.json>', '--json'],
      stdoutArtifact: 'repair_attempt_artifact',
      saveStdoutTo: paths.repair_attempt_artifact,
      nextStageAfterSuccess: 'ready_to_finalize',
    });
    return withRecoverySummary({
      ...report,
      ...stageEnvelope({
        stage: 'ready_for_attempt_outcomes',
        status: 'ready',
        why: 'The proposal inputs are complete and source-bound; a caller may supply execution outcomes as an Attempt Artifact.',
        evidence: ['repair_attempt_plan:ready'],
        nextCommand: artifactBuilder,
        missingInputs: ['caller_outcome_input'],
        alternatives: [...commands, artifactBuilder],
      }),
    });
  }

  const artifactRead = readJsonFile(attemptArtifactPath);
  const validation = artifactRead.status === 'success'
    ? validateWorkRecordRepairAttemptArtifact(artifactRead.value)
    : { type: 'work_record.repair_attempt_artifact.validation', status: 'failed', diagnostics: artifactRead.diagnostics };
  report.repair_attempt_artifact_validation = summarizeAttemptArtifact(validation, artifactRead);
  if (validation.status !== 'passed') {
    return withRecoverySummary({
      ...report,
      ...stageEnvelope({
        stage: 'attempt_artifact_invalid',
        status: 'blocked',
        why: 'The supplied Repair Attempt Artifact did not validate.',
        evidence: ['attempt_artifact_validation:failed'],
        nextCommand: descriptor({
          id: 'work-record-attempt-artifact-validate',
          purpose: 'Validate the supplied caller-outcome artifact.',
          argv: ['./aos', 'work-record', 'attempt-artifact', 'validate', attemptArtifactPath, '--json'],
          nextStageAfterSuccess: 'ready_to_finalize',
        }),
        blockers: arrayValue(validation.diagnostics),
      }),
    });
  }
  const artifactBindingDiagnostics = attemptArtifactBindingDiagnostics({
    artifact: artifactRead.value,
    source,
    attemptPlan,
  });
  if (artifactBindingDiagnostics.length > 0) {
    report.repair_attempt_artifact_validation = {
      ...report.repair_attempt_artifact_validation,
      binding_status: 'failed',
      binding_diagnostics: artifactBindingDiagnostics,
    };
    return withRecoverySummary({
      ...report,
      ...stageEnvelope({
        stage: 'attempt_artifact_invalid',
        status: 'blocked',
        why: 'The supplied Repair Attempt Artifact does not match the current source Work Record and derived Attempt Plan.',
        evidence: ['attempt_artifact_validation:passed', 'attempt_artifact_binding:failed'],
        blockers: artifactBindingDiagnostics,
      }),
    });
  }
  report.repair_attempt_artifact_validation = {
    ...report.repair_attempt_artifact_validation,
    binding_status: 'passed',
  };

  const finalizeDescriptor = finalizationDescriptor({
    sourceRef,
    source,
    attemptPlanPath,
    attemptArtifactPath,
    replacementRoot,
    indexRoot,
  });
  const missing = [];
  if (!attemptPlanPath) missing.push('repair_attempt_plan_path');
  if (!replacementRoot) missing.push('replacement_root');
  if (!indexRoot) missing.push('index_root');
  if (missing.length > 0) {
    return withRecoverySummary({
      ...report,
      ...stageEnvelope({
        stage: 'ready_to_finalize',
        status: 'blocked',
        why: 'The Attempt Artifact validates; exact finalization paths are still required.',
        evidence: ['attempt_artifact_validation:passed'],
        nextCommand: finalizeDescriptor,
        missingInputs: missing,
      }),
    });
  }

  const finalization = finalizeWorkRecordRepair({
    sourceRef,
    attemptPlanPath,
    attemptArtifactPath,
    replacementRoot,
    indexRoot,
    proposedIdSeed,
    replacementOutputPath,
    roots,
    replacementRoots,
    repoRoot,
    dryRun: true,
  });
  report.finalization_dry_run_summary = summarizeFinalization(finalization);
  const complete = ['dry_run', 'dry_run_ready', 'finalized', 'already_finalized'].includes(finalization.status);
  return withRecoverySummary({
    ...report,
    ...stageEnvelope({
      stage: complete ? 'ready_to_finalize' : 'finalization_blocked',
      status: complete ? 'ready' : 'blocked',
      why: complete
        ? 'Exact plan, artifact, source, replacement, and supersession preflight checks passed.'
        : `Finalization preflight status is ${finalization.status}.`,
      evidence: [`attempt_artifact_validation:${validation.status}`, `finalization:${finalization.status}`],
      nextCommand: finalizeDescriptor,
      blockers: complete ? [] : arrayValue(finalization.diagnostics),
    }),
  });
}
