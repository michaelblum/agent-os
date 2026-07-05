import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {
  explainWorkRecordStatus,
  readWorkRecord,
} from './work-record-consumer.js';
import {
  planWorkRecordRepair,
} from './work-record-repair-plan.js';
import {
  buildWorkRecordGateRequestFromRepairPlan,
  checkWorkRecordGateAuthorizationFromRepairPlan,
} from './work-record-workflow-gate.js';
import {
  planWorkRecordRepairAttempt,
} from './work-record-repair-attempt-plan.js';
import {
  validateWorkRecordRepairAttemptArtifact,
} from './work-record-repair-attempt-artifact.js';
import {
  finalizeWorkRecordRepair,
} from './work-record-repair-finalizer.js';
import {
  lookupWorkRecordSourceSupersession,
} from './work-record-supersession-index.js';
import {
  arrayValue,
  attemptDescriptors,
  cloneJson,
  descriptor,
  finalizationDescriptor,
  gateDescriptors,
  recommendedPaths,
  sourceArg,
  stageEnvelope,
  summarizeAttemptArtifact,
  summarizeAttemptPlan,
  summarizeFinalization,
  summarizeGate,
  summarizeRepairPlan,
  summarizeStatus,
  summarizeSupersession,
  supersessionDescriptors,
  text,
} from './work-record-repair-guide-descriptors.js';
import {
  buildGuideRecoverySummary,
} from './work-record-recovery-summary.js';

export const WORK_RECORD_REPAIR_GUIDE_SCHEMA_VERSION = '2026-07-work-record-repair-guided-recovery-v0';
export const WORK_RECORD_REPAIR_GUIDE_TYPE = 'work_record.repair_guided_recovery';
export const WORK_RECORD_REPAIR_GUIDE_IMPLEMENTATION_VERSION = '2026-07-work-record-repair-guide-v0';
export const WORK_RECORD_REPAIR_GUIDE_STAGES = Object.freeze([
  'valid_no_repair_needed',
  'superseded',
  'retired_or_impossible',
  'repair_plan_unavailable',
  'gate_required',
  'authorization_pending',
  'authorization_denied',
  'authorization_insufficient',
  'attempt_plan_blocked',
  'ready_to_plan_attempt',
  'ready_to_execute',
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
  starts_workflow_engine: false,
  auto_resumes: false,
  automatic_replay_allowed: false,
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

function readReplacementFromLookup(lookup = {}, {
  replacementRoots = [],
  repoRoot = process.cwd(),
} = {}) {
  const entry = arrayValue(lookup.entries)[0];
  const replacement = objectValue(entry?.replacement_work_record);
  const replacementPath = text(replacement.path);
  const roots = [
    ...replacementRoots,
    ...(replacementPath ? [path.dirname(replacementPath)] : []),
  ].filter(Boolean);
  const ref = replacementPath || text(replacement.id);
  if (!ref) return null;
  const read = readWorkRecord(ref, { roots, repoRoot });
  const status = read.status === 'success'
    ? explainWorkRecordStatus(ref, { roots, repoRoot })
    : null;
  return {
    read,
    status,
  };
}

function sourceIdentity(read = {}, sourceRef = '') {
  return {
    id: text(read.summary?.id || read.record?.id),
    path: text(read.source?.path),
    requested_ref: text(sourceRef),
    schema_version: text(read.summary?.schema_version || read.record?.schema_version),
    digest: fileDigest(read.source?.path),
  };
}

function stageFromAttemptStatus(status = '') {
  if (status === 'ready') return ['ready_to_execute', 'ready'];
  if (status === 'blocked_authorization_required') return ['authorization_pending', 'blocked'];
  if (status === 'blocked_authorization_denied') return ['authorization_denied', 'blocked'];
  if (status === 'blocked_authorization_insufficient') return ['authorization_insufficient', 'blocked'];
  if (status === 'stale' || status === 'mismatch') return ['authorization_insufficient', 'blocked'];
  if (status === 'not_required') return ['valid_no_repair_needed', 'not_required'];
  if (status === 'unsupported') return ['unsupported', 'unsupported'];
  return ['attempt_plan_blocked', 'blocked'];
}

export function guideWorkRecordRepair({
  sourceRef = '',
  roots = [],
  profileId = undefined,
  authorization = null,
  gateOutcome = null,
  attemptPlanPath = '',
  attemptArtifactPath = '',
  executionRoot = '',
  artifactRoot = '',
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
    gate_request_summary: null,
    gate_authorization_summary: null,
    repair_attempt_plan_summary: null,
    repair_attempt_artifact_validation: null,
    finalization_dry_run_summary: null,
    supersession_lookup_summary: null,
    replacement_summary: null,
    artifact_path_recommendations: paths,
    non_execution_flags: { ...NON_EXECUTION_FLAGS },
    ...NON_EXECUTION_FLAGS,
    diagnostics: [],
  };
  const withRecoverySummary = (envelope) => ({
    ...envelope,
    recovery_summary: buildGuideRecoverySummary(envelope),
  });

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
        missingInputs: ['valid_source_work_record'],
      }),
    });
  }

  const status = explainWorkRecordStatus(sourceRef, context);
  const repairPlan = planWorkRecordRepair(sourceRef, context);
  report.current_status_report = summarizeStatus(status);
  report.repair_plan_summary = summarizeRepairPlan(repairPlan);

  let supersessionLookup = null;
  if (indexRoot) {
    supersessionLookup = lookupWorkRecordSourceSupersession({
      sourceRef,
      indexRoot,
      sourceRoots: roots,
      repoRoot,
    });
    report.supersession_lookup_summary = summarizeSupersession(supersessionLookup);
    if (supersessionLookup.status === 'active') {
      const replacement = readReplacementFromLookup(supersessionLookup, {
        replacementRoots: [...replacementRoots, replacementRoot].filter(Boolean),
        repoRoot,
      });
      report.replacement_summary = replacement ? {
        read: replacement.read.status === 'success'
          ? {
            status: replacement.read.status,
            source: cloneJson(replacement.read.source || {}),
            summary: cloneJson(replacement.read.summary || {}),
          }
          : cloneJson(replacement.read),
        status: replacement.status ? summarizeStatus(replacement.status) : null,
      } : null;
      if (replacement?.read?.status === 'success' && replacement?.status?.status) {
        const next = descriptor({
          id: 'work-record-replacement-status',
          purpose: 'Inspect the active replacement Work Record.',
          argv: ['./aos', 'work-record', 'status', replacement.read.source.path || replacement.read.summary.id, '--json'],
          nextStageAfterSuccess: 'finalized',
        });
        return withRecoverySummary({
          ...report,
          ...stageEnvelope({
            stage: 'finalized',
            status: 'complete',
            why: 'The Source Supersession Index resolves to a readable replacement Work Record with status output.',
            evidence: ['supersession_lookup:active', 'replacement_read:success', 'replacement_status:available'],
            nextCommand: next,
            alternatives: supersessionDescriptors(sourceRef, source, indexRoot),
          }),
        });
      }
    }
  }

  if (repairPlan.status === 'no_repair_needed') {
    const next = descriptor({
      id: 'work-record-read',
      purpose: 'Read the valid Work Record without repair.',
      argv: ['./aos', 'work-record', 'read', sourceArg(sourceRef, source), '--json'],
      nextStageAfterSuccess: 'valid_no_repair_needed',
    });
    return withRecoverySummary({
      ...report,
      ...stageEnvelope({
        stage: 'valid_no_repair_needed',
        status: 'not_required',
        why: 'Current report-only verification says no repair is needed.',
        evidence: ['repair_plan:no_repair_needed'],
        nextCommand: next,
        alternatives: [
          descriptor({
            id: 'work-record-export',
            purpose: 'Export a compact read-only evidence bundle manifest.',
            argv: ['./aos', 'work-record', 'export', sourceArg(sourceRef, source), '--json'],
            nextStageAfterSuccess: 'valid_no_repair_needed',
          }),
        ],
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
        alternatives: supersessionDescriptors(sourceRef, source, indexRoot),
      }),
    });
  }

  if (repairPlan.status === 'retired' || repairPlan.status === 'not_repairable') {
    return withRecoverySummary({
      ...report,
      ...stageEnvelope({
        stage: 'retired_or_impossible',
        status: 'not_required',
        why: `The Repair Plan status is ${repairPlan.status}; repair is not appropriate.`,
        evidence: [`repair_plan:${repairPlan.status}`],
        blockers: arrayValue(repairPlan.diagnostics),
      }),
    });
  }

  if (repairPlan.status !== 'planned' && repairPlan.status !== 'blocked') {
    return withRecoverySummary({
      ...report,
      ...stageEnvelope({
        stage: 'repair_plan_unavailable',
        status: 'blocked',
        why: `The Repair Plan did not produce a repairable workflow stage: ${repairPlan.status}.`,
        evidence: [`repair_plan:${repairPlan.status}`],
        blockers: arrayValue(repairPlan.diagnostics),
      }),
    });
  }

  const gateRequest = buildWorkRecordGateRequestFromRepairPlan(repairPlan);
  report.gate_request_summary = summarizeGate(gateRequest);

  const authorizationInput = authorization || (gateOutcome
    ? checkWorkRecordGateAuthorizationFromRepairPlan(repairPlan, gateOutcome)
    : null);
  if (authorizationInput) report.gate_authorization_summary = summarizeGate(authorizationInput);

  const attemptPlan = planWorkRecordRepairAttempt(sourceRef, {
    ...context,
    repairPlan,
    ...(authorizationInput ? { authorization: authorizationInput } : {}),
  });
  report.repair_attempt_plan_summary = summarizeAttemptPlan(attemptPlan);

  if (!authorizationInput && attemptPlan.status === 'blocked_authorization_required') {
    const commands = gateDescriptors(sourceRef, source, repairPlan, paths);
    return withRecoverySummary({
      ...report,
      ...stageEnvelope({
        stage: 'gate_required',
        status: 'blocked',
        why: 'A Workflow Gate Authorization is required before any repair attempt can be ready.',
        evidence: ['repair_attempt_plan:blocked_authorization_required', 'gate_request:pending'],
        nextCommand: commands[0],
        missingInputs: ['workflow_gate_authorization'],
        blockers: arrayValue(attemptPlan.diagnostics),
        requiresUserApproval: true,
        alternatives: commands.slice(1),
      }),
    });
  }

  const [attemptStage, attemptStageStatus] = stageFromAttemptStatus(attemptPlan.status);
  if (attemptPlan.status !== 'ready') {
    const commands = gateDescriptors(sourceRef, source, repairPlan, paths);
    return withRecoverySummary({
      ...report,
      ...stageEnvelope({
        stage: attemptStage,
        status: attemptStageStatus,
        why: `Repair Attempt Plan status is ${attemptPlan.status}.`,
        evidence: [`repair_attempt_plan:${attemptPlan.status}`],
        nextCommand: commands[0],
        missingInputs: attemptPlan.status === 'blocked_authorization_required' ? ['workflow_gate_authorization'] : [],
        blockers: arrayValue(attemptPlan.diagnostics),
        requiresUserApproval: attemptPlan.status === 'blocked_authorization_required',
        alternatives: commands,
      }),
    });
  }

  if (attemptArtifactPath) {
    const artifactRead = readJsonFile(attemptArtifactPath);
    const validation = artifactRead.status === 'success'
      ? validateWorkRecordRepairAttemptArtifact(artifactRead.value)
      : {
        type: 'work_record.repair_attempt_artifact.validation',
        status: 'failed',
        diagnostics: artifactRead.diagnostics,
      };
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
            purpose: 'Validate the supplied Repair Attempt Artifact directly.',
            argv: ['./aos', 'work-record', 'attempt-artifact', 'validate', attemptArtifactPath, '--json'],
            nextStageAfterSuccess: 'ready_to_finalize',
          }),
          blockers: arrayValue(validation.diagnostics),
        }),
      });
    }

    const missingFinalization = [];
    if (!attemptPlanPath) missingFinalization.push('attempt_plan_path');
    if (!replacementRoot) missingFinalization.push('replacement_root');
    if (!indexRoot) missingFinalization.push('index_root');
    if (missingFinalization.length === 0) {
      const dryRun = finalizeWorkRecordRepair({
        sourceRef,
        attemptPlanPath,
        attemptArtifactPath,
        replacementRoot,
        indexRoot,
        proposedIdSeed,
        replacementOutputPath,
        dryRun: true,
        roots,
        repoRoot,
      });
      report.finalization_dry_run_summary = summarizeFinalization(dryRun);
      if (dryRun.status === 'dry_run') {
        const next = finalizationDescriptor({
          sourceRef,
          source,
          attemptPlanPath,
          attemptArtifactPath,
          replacementRoot,
          indexRoot,
          proposedIdSeed,
          replacementOutputPath,
          dryRun: false,
        });
        return withRecoverySummary({
          ...report,
          ...stageEnvelope({
            stage: 'ready_to_finalize',
            status: 'ready',
            why: 'The supplied Attempt Artifact validates and finalization dry-run can compute replacement and supersession outputs.',
            evidence: ['attempt_artifact_validation:passed', 'repair_finalize:dry_run'],
            nextCommand: next,
            wouldMutateIfRun: true,
            requiresUserApproval: true,
            alternatives: [
              finalizationDescriptor({
                sourceRef,
                source,
                attemptPlanPath,
                attemptArtifactPath,
                replacementRoot,
                indexRoot,
                proposedIdSeed,
                replacementOutputPath,
                dryRun: true,
              }),
            ],
          }),
        });
      }
      return withRecoverySummary({
        ...report,
        ...stageEnvelope({
          stage: 'finalization_blocked',
          status: 'blocked',
          why: `Finalization dry-run status is ${dryRun.status}.`,
          evidence: [`repair_finalize:${dryRun.status}`],
          nextCommand: finalizationDescriptor({
            sourceRef,
            source,
            attemptPlanPath,
            attemptArtifactPath,
            replacementRoot,
            indexRoot,
            proposedIdSeed,
            replacementOutputPath,
            dryRun: true,
          }),
          blockers: arrayValue(dryRun.diagnostics),
        }),
      });
    }
    const next = finalizationDescriptor({
      sourceRef,
      source,
      attemptPlanPath: text(attemptPlanPath, paths.attempt_plan_path),
      attemptArtifactPath,
      replacementRoot: text(replacementRoot, paths.replacement_root),
      indexRoot: text(indexRoot, paths.index_root),
      proposedIdSeed,
      replacementOutputPath,
      dryRun: true,
    });
    return withRecoverySummary({
      ...report,
      ...stageEnvelope({
        stage: 'ready_to_finalize',
        status: 'blocked',
        why: 'The supplied Attempt Artifact validates, but finalization dry-run needs explicit remaining inputs.',
        evidence: ['attempt_artifact_validation:passed'],
        nextCommand: next,
        missingInputs: missingFinalization,
        requiresUserApproval: true,
      }),
    });
  }

  const commands = attemptDescriptors({
    sourceRef,
    source,
    paths,
    attemptPlanPath,
    executionRoot,
    artifactRoot,
  });
  const missingExecuteInputs = [
    ...(!attemptPlanPath ? ['attempt_plan_path'] : []),
    ...(!executionRoot ? ['execution_root'] : []),
    ...(!artifactRoot ? ['artifact_root'] : []),
  ];
  if (missingExecuteInputs.length > 0) {
    const needsPlan = missingExecuteInputs.includes('attempt_plan_path');
    return withRecoverySummary({
      ...report,
      ...stageEnvelope({
        stage: needsPlan ? 'ready_to_plan_attempt' : 'ready_to_execute',
        status: 'blocked',
        why: needsPlan
          ? 'The Repair Attempt Plan is ready in memory; save it before any execute command can be ready.'
          : 'The Repair Attempt Plan path is present, but explicit execution and artifact roots are required before execute can be ready.',
        evidence: ['repair_attempt_plan:ready'],
        nextCommand: needsPlan ? commands[0] : commands[1],
        missingInputs: missingExecuteInputs,
        wouldMutateIfRun: false,
        requiresUserApproval: true,
        alternatives: needsPlan ? [commands[0]] : commands,
      }),
    });
  }
  return withRecoverySummary({
    ...report,
    ...stageEnvelope({
      stage: 'ready_to_execute',
      status: 'ready',
      why: 'The Repair Attempt Plan is ready; the guide did not execute repair.',
      evidence: ['repair_attempt_plan:ready'],
      nextCommand: commands[1],
      missingInputs: [],
      wouldMutateIfRun: false,
      requiresUserApproval: true,
      alternatives: [commands[0], commands[2]],
    }),
  });
}
