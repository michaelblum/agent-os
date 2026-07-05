import { projectDescriptorPersistence } from './work-record-persistence-projection.js';

function text(value, fallback = '') {
  const normalized = String(value ?? '').replace(/\s+/g, ' ').trim();
  return normalized || fallback;
}

function arrayValue(value) {
  return Array.isArray(value) ? value : [];
}

function objectValue(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function compactObject(value) {
  const object = objectValue(value);
  return Object.fromEntries(Object.entries(object).filter(([, item]) => item !== '' && item !== undefined && item !== null));
}

function diagnosticCodes(envelope = {}) {
  return arrayValue(envelope.diagnostics || envelope.blockers)
    .map((item) => text(item?.code))
    .filter(Boolean);
}

function stateFromGuideStage(stage = '', stageStatus = '', status = '') {
  const currentStage = text(stage);
  const currentStatus = text(stageStatus || status);
  if (currentStage === 'finalized' || currentStage === 'superseded' || currentStage === 'valid_no_repair_needed') return 'finalized';
  if (currentStage === 'unsupported' || currentStatus === 'unsupported') return 'unsupported';
  if (text(status) === 'failed') return 'invalid';
  if (currentStatus === 'ready') return 'ready';
  if (currentStatus === 'blocked') return 'blocked';
  if (currentStatus === 'complete' || currentStatus === 'completed' || currentStatus === 'not_required') return 'finalized';
  return currentStage ? 'unknown' : 'missing';
}

function stateFromInspectionStatus(status = '') {
  const value = text(status);
  if (!value) return 'missing';
  if (value === 'valid' || value === 'degraded') return 'ready';
  if (value === 'unsupported_schema') return 'unsupported';
  if (value === 'blocked_missing_manifest') return 'missing';
  if (value === 'blocked_invalid_manifest' || value === 'blocked_path_escape' || value === 'blocked_forbidden_artifact' || value === 'blocked_digest_mismatch' || value === 'blocked_descriptor_mismatch') return 'invalid';
  if (value.startsWith('blocked_missing')) return 'missing';
  if (value.startsWith('blocked_')) return 'blocked';
  return 'unknown';
}

function descriptorIsContinuable(descriptor = {}, savedOutputsReady = true) {
  const safe = objectValue(descriptor);
  return text(safe.id) !== ''
    && arrayValue(safe.argv).length > 0
    && savedOutputsReady === true;
}

export function classifyInspectionRecovery(envelope = {}) {
  const status = text(envelope.status);
  const continuation = objectValue(envelope.continuation);
  const guide = objectValue(envelope.guide_report);
  const guideState = stateFromGuideStage(
    guide.current_stage || continuation.current_guide_stage,
    guide.stage_status || continuation.stage_status,
    guide.status,
  );
  const descriptor = {
    id: continuation.safe_next_descriptor_id,
    argv: continuation.argv,
    mutates_state: continuation.would_mutate_state,
    requires_approval: continuation.requires_human_approval,
    stdout_artifact: continuation.stdout_artifact,
    save_stdout_to: continuation.save_stdout_to,
    requires_saved_output_from: continuation.requires_saved_output_from,
    persistence_command: continuation.persistence_command,
  };
  const savedOutputsReady = continuation.required_saved_outputs_present === true;
  const descriptorReady = descriptorIsContinuable(descriptor, savedOutputsReady);

  if (status === 'valid' || status === 'degraded') {
    const state = guideState === 'finalized' ? 'finalized' : (descriptorReady ? 'ready' : 'blocked');
    return {
      state,
      continuable: descriptorReady,
      reason: status,
      descriptor,
      saved_outputs_ready: savedOutputsReady,
      missing_saved_outputs: arrayValue(continuation.missing_artifact_paths),
    };
  }

  const state = stateFromInspectionStatus(status);
  return {
    state,
    continuable: false,
    reason: status || 'missing_status',
    descriptor: {},
    saved_outputs_ready: false,
    missing_saved_outputs: arrayValue(continuation.missing_artifact_paths),
  };
}

function safeDescriptorForContinuation(descriptor = {}, continuable = true) {
  if (continuable !== true) return {};
  return objectValue(descriptor);
}

function savedOutputsFromDescriptor(descriptor = {}, savedOutputsReady = true, missingSavedOutputs = []) {
  const missing = arrayValue(missingSavedOutputs).filter(Boolean);
  const requirements = arrayValue(descriptor.requires_saved_output_from);
  if (missing.length > 0) return { saved_outputs_ready: false, missing_saved_outputs: missing };
  if (requirements.length === 0) return { saved_outputs_ready: true, missing_saved_outputs: [] };
  return { saved_outputs_ready: savedOutputsReady === true, missing_saved_outputs: savedOutputsReady === true ? [] : requirements.map((item) => text(item.path)).filter(Boolean) };
}

function nextSummary({
  descriptor = {},
  state = '',
  missingInputs = [],
  savedOutputsReady = true,
  missingSavedOutputs = [],
  fallbackMutates = false,
  fallbackRequiresApproval = false,
  continuable = true,
} = {}) {
  const safeDescriptor = safeDescriptorForContinuation(descriptor, continuable);
  const saved = continuable === true
    ? savedOutputsFromDescriptor(safeDescriptor, savedOutputsReady, missingSavedOutputs)
    : { saved_outputs_ready: false, missing_saved_outputs: arrayValue(missingSavedOutputs).filter(Boolean) };
  return {
    command_id: text(safeDescriptor.id),
    argv: arrayValue(safeDescriptor.argv),
    mutates_state: continuable === true && (safeDescriptor.mutates_state === true || fallbackMutates === true),
    requires_user_approval: continuable === true && (safeDescriptor.requires_approval === true || fallbackRequiresApproval === true),
    ...saved,
    missing_inputs: arrayValue(missingInputs),
    persistence: projectDescriptorPersistence(safeDescriptor, continuable),
  };
}

function safetySummary(flags = {}, extras = {}) {
  return {
    inspector_ran_command: extras.inspector_ran_command === true,
    bundle_wrote_replacement: extras.bundle_wrote_replacement === true,
    bundle_wrote_supersession: extras.bundle_wrote_supersession === true,
    uses_live_ui: flags.uses_live_ui === true || extras.uses_live_ui === true,
    automatic_replay_allowed: flags.automatic_replay_allowed === true || extras.automatic_replay_allowed === true,
  };
}

function artifactPathsFromGuide(envelope = {}) {
  const paths = objectValue(envelope.artifact_path_recommendations);
  return compactObject({
    bundle_manifest: text(envelope.manifest_path),
    guide_report: text(envelope.guide_report_path),
    attempt_plan: text(paths.attempt_plan_path),
    attempt_artifact: text(paths.attempt_artifact_path),
    replacement_root: text(paths.replacement_root),
    index_root: text(paths.index_root),
  });
}

function artifactPathsFromArtifacts(envelope = {}) {
  const paths = artifactPathsFromGuide(envelope);
  for (const artifact of [...arrayValue(envelope.planned_artifacts), ...arrayValue(envelope.written_artifacts)]) {
    const kind = text(artifact.artifact_kind);
    if (kind === 'bundle_manifest') paths.bundle_manifest = text(artifact.path);
    if (kind === 'guide_report') paths.guide_report = text(artifact.path);
    if (kind === 'repair_attempt_plan') paths.attempt_plan = text(artifact.path);
  }
  return compactObject(paths);
}

export function buildGuideRecoverySummary(envelope = {}) {
  const stage = text(envelope.current_stage);
  const stageStatus = text(envelope.stage_status);
  const state = stateFromGuideStage(stage, stageStatus, envelope.status);
  const stageInfo = objectValue(envelope.stage);
  const next = nextSummary({
    descriptor: envelope.next_explicit_command,
    state,
    missingInputs: envelope.missing_inputs,
    savedOutputsReady: state === 'ready',
    fallbackMutates: stageInfo.would_mutate_if_run === true,
    fallbackRequiresApproval: stageInfo.requires_user_approval === true,
  });
  return {
    state,
    headline: stage ? `Work Record recovery is ${state} at ${stage}.` : `Work Record recovery is ${state}.`,
    why: text(stageInfo.why || envelope.diagnostics?.[0]?.message),
    source_work_record: compactObject(envelope.source_work_record),
    bundle_root: text(envelope.output_root || envelope.bundle_root),
    guide_stage: stage,
    guide_stage_status: stageStatus,
    next,
    artifacts: artifactPathsFromGuide(envelope),
    safety: safetySummary(envelope.non_execution_flags, { inspector_ran_command: false }),
    diagnostic_codes: diagnosticCodes(envelope),
  };
}

export function buildBundleRecoverySummary(envelope = {}) {
  const guideStage = text(envelope.guide_report?.current_stage || envelope.current_stage || envelope.recovery_summary?.guide_stage);
  const guideStatus = text(envelope.guide_report?.stage_status || envelope.stage_status || envelope.recovery_summary?.guide_stage_status);
  const state = envelope.status?.startsWith?.('blocked_')
    ? stateFromInspectionStatus(envelope.status)
    : stateFromGuideStage(guideStage, guideStatus, envelope.status === 'written' || envelope.status === 'dry_run' || envelope.status === 'planned' ? guideStatus : envelope.status);
  return {
    state,
    headline: `Recovery bundle is ${text(envelope.status, state)}${guideStage ? ` for ${guideStage}` : ''}.`,
    why: text(envelope.recovery_summary?.why || envelope.diagnostics?.[0]?.message || envelope.guide_report?.stage?.why),
    source_work_record: compactObject(envelope.source_work_record),
    bundle_root: text(envelope.output_root),
    guide_stage: guideStage,
    guide_stage_status: guideStatus,
    next: nextSummary({
      descriptor: envelope.next_recommended_command,
      state,
      missingInputs: envelope.missing_inputs || envelope.guide_report?.missing_inputs || envelope.recovery_summary?.next?.missing_inputs,
      savedOutputsReady: text(envelope.next_recommended_command?.bundle_artifact_status) !== 'planned_only',
    }),
    artifacts: artifactPathsFromArtifacts(envelope),
    safety: safetySummary(envelope.non_execution_flags, {
      bundle_wrote_replacement: false,
      bundle_wrote_supersession: false,
    }),
    diagnostic_codes: diagnosticCodes(envelope),
  };
}

export function buildInspectionRecoverySummary(envelope = {}) {
  const guide = objectValue(envelope.guide_report);
  const continuation = objectValue(envelope.continuation);
  const classification = classifyInspectionRecovery(envelope);
  const { state } = classification;
  return {
    state,
    headline: `Recovery bundle inspection is ${text(envelope.status, state)}.`,
    why: text(envelope.diagnostics?.[0]?.message || continuation.reminder),
    source_work_record: compactObject(envelope.manifest?.source_work_record),
    bundle_root: text(envelope.bundle_root),
    guide_stage: text(guide.current_stage || continuation.current_guide_stage),
    guide_stage_status: text(guide.stage_status || continuation.stage_status),
    next: nextSummary({
      descriptor: classification.descriptor,
      state,
      missingInputs: guide.missing_inputs,
      savedOutputsReady: classification.saved_outputs_ready,
      missingSavedOutputs: classification.missing_saved_outputs,
      continuable: classification.continuable,
    }),
    artifacts: compactObject({
      bundle_manifest: text(envelope.manifest_path || 'bundle-manifest.json'),
      guide_report: text(envelope.guide_report_path || 'guide-report.json'),
    }),
    safety: safetySummary(envelope.non_execution_flags, {
      inspector_ran_command: continuation.inspector_ran_command === true,
    }),
    diagnostic_codes: diagnosticCodes(envelope),
  };
}

export function buildStatusRowRecoverySummary(row = {}) {
  const state = text(row.lifecycle_status, 'unknown');
  return {
    state,
    headline: `Recovery bundle lifecycle is ${state}.`,
    why: text(row.diagnostics?.[0]?.message),
    source_work_record: compactObject(row.source_work_record),
    bundle_root: text(row.bundle_root),
    guide_stage: text(row.guide_stage),
    guide_stage_status: text(row.guide_stage_status),
    next: nextSummary({
      descriptor: {
        id: row.next_command_id,
        argv: row.next_argv,
        mutates_state: row.next_command_mutates_state,
        requires_approval: row.requires_user_approval,
        stdout_artifact: row.next_persistence?.stdout_artifact,
        save_stdout_to: row.next_persistence?.save_stdout_to,
        requires_saved_output_from: row.next_persistence?.requires_saved_output_from,
        persistence_command: row.next_persistence?.persistence_command,
      },
      state,
      missingInputs: row.missing_inputs,
      savedOutputsReady: row.required_saved_outputs_present === true,
      missingSavedOutputs: row.missing_saved_outputs,
      continuable: row.continuation_ready === true,
    }),
    artifacts: {},
    safety: safetySummary({}, { inspector_ran_command: false }),
    diagnostic_codes: diagnosticCodes(row),
  };
}
