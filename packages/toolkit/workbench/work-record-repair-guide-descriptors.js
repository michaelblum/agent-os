export function text(value, fallback = '') {
  const normalized = String(value ?? '').replace(/\s+/g, ' ').trim();
  return normalized || fallback;
}

export function rawText(value, fallback = '') {
  const raw = String(value ?? '');
  return raw || fallback;
}

export function arrayValue(value) {
  return Array.isArray(value) ? value : [];
}

export function cloneJson(value) {
  if (value === undefined) return undefined;
  return JSON.parse(JSON.stringify(value));
}

function objectValue(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

export function descriptor({
  id = '',
  purpose = '',
  argv = [],
  readOnly = true,
  mutatesState = false,
  stdoutArtifact = '',
  saveStdoutTo = '',
  requiresSavedOutputFrom = [],
  nextStageAfterSuccess = '',
} = {}) {
  return {
    id: text(id),
    purpose: text(purpose),
    argv: arrayValue(argv).map((part) => String(part)),
    read_only: readOnly,
    mutates_state: mutatesState,
    executes_in_guide: false,
    stdout_artifact: text(stdoutArtifact) || null,
    save_stdout_to: text(saveStdoutTo) || null,
    requires_saved_output_from: arrayValue(requiresSavedOutputFrom).map(text).filter(Boolean),
    next_stage_after_success: text(nextStageAfterSuccess) || null,
  };
}

export function sourceArg(sourceRef, source = {}) {
  return rawText(sourceRef, rawText(source.path, text(source.id, '<id-or-path>')));
}

export function recommendedPaths(source = {}, sourceRef = '') {
  const stem = text(source.id || sourceRef, 'work-record')
    .replace(/^work-record:/, '')
    .replace(/[^A-Za-z0-9._-]+/g, '-');
  return {
    repair_plan: `artifacts/work-records/${stem}/repair-plan.json`,
    repair_attempt_plan: `artifacts/work-records/${stem}/repair-attempt-plan.json`,
    repair_attempt_artifact: `artifacts/work-records/${stem}/repair-attempt-artifact.json`,
    finalization_result: `artifacts/work-records/${stem}/repair-finalization-result.json`,
  };
}

export function summarizeStatus(status = {}) {
  const value = objectValue(status);
  return {
    type: text(value.type),
    status: text(value.status),
    health_verdict: text(value.health_verdict),
    diagnostics: cloneJson(arrayValue(value.diagnostics)),
  };
}

export function summarizeRepairPlan(plan = {}) {
  const value = objectValue(plan);
  return {
    type: text(value.type),
    schema_version: text(value.schema_version),
    status: text(value.status),
    source_work_record: cloneJson(value.source_work_record || {}),
    plan_step_ids: arrayValue(value.plan_steps).map((step) => text(objectValue(step).id)).filter(Boolean),
    candidate_patch_ids: arrayValue(value.candidate_patches).map((patch) => text(objectValue(patch).id)).filter(Boolean),
    executes_actions: value.executes_actions === true,
    mutates_source: value.mutates_source === true,
    diagnostics: cloneJson(arrayValue(value.diagnostics)),
  };
}

export function summarizeAttemptPlan(plan = null) {
  const value = objectValue(plan);
  return {
    type: text(value.type),
    schema_version: text(value.schema_version),
    status: text(value.status),
    attempt_id: text(value.attempt_identity?.attempt_id),
    attempt_digest: text(value.attempt_identity?.digest),
    planned_operation_ids: arrayValue(value.planned_operations).map((operation) => text(objectValue(operation).id)).filter(Boolean),
    executes_actions: value.executes_actions === true,
    mutates_source: value.mutates_source === true,
    diagnostics: cloneJson(arrayValue(value.diagnostics)),
  };
}

export function summarizeAttemptArtifact(validation = null, read = null) {
  return {
    read_status: text(read?.status),
    path: rawText(read?.path),
    digest: text(read?.digest),
    validation_status: text(validation?.status),
    diagnostics: cloneJson(arrayValue(validation?.diagnostics)),
  };
}

export function summarizeFinalization(result = null) {
  const value = objectValue(result);
  return {
    type: text(value.type),
    schema_version: text(value.schema_version),
    status: text(value.status),
    mode: text(value.mode),
    source_work_record: cloneJson(value.source_work_record || {}),
    replacement_work_record: cloneJson(value.replacement_work_record || {}),
    diagnostics: cloneJson(arrayValue(value.diagnostics)),
  };
}

export function summarizeSupersession(lookup = null) {
  const value = objectValue(lookup);
  return {
    type: text(value.type),
    schema_version: text(value.schema_version),
    status: text(value.status),
    source_work_record: cloneJson(value.source_work_record || {}),
    entries: cloneJson(arrayValue(value.entries)),
    diagnostics: cloneJson(arrayValue(value.diagnostics)),
  };
}

export function stageEnvelope({
  stage = '',
  status = '',
  why = '',
  evidence = [],
  nextCommand = null,
  alternatives = [],
  blockers = [],
  missingInputs = [],
} = {}) {
  return {
    current_stage: text(stage),
    stage_status: text(status),
    why: text(why),
    evidence: arrayValue(evidence).map(text).filter(Boolean),
    safe_next_command: nextCommand ? cloneJson(nextCommand) : null,
    alternatives: arrayValue(alternatives).map(cloneJson),
    blockers: arrayValue(blockers).map(cloneJson),
    missing_inputs: arrayValue(missingInputs).map(text).filter(Boolean),
  };
}

export function attemptDescriptors(sourceRef, source, paths = recommendedPaths(source, sourceRef)) {
  const sourceValue = sourceArg(sourceRef, source);
  return [
    descriptor({
      id: 'work-record-plan-repair',
      purpose: 'Write the non-executing Repair Plan JSON.',
      argv: ['./aos', 'work-record', 'plan-repair', sourceValue, '--json'],
      stdoutArtifact: 'repair_plan',
      saveStdoutTo: paths.repair_plan,
      nextStageAfterSuccess: 'ready_to_plan_attempt',
    }),
    descriptor({
      id: 'work-record-plan-attempt',
      purpose: 'Write the exact source-bound non-executing Attempt Plan JSON.',
      argv: ['./aos', 'work-record', 'plan-attempt', sourceValue, '--json'],
      stdoutArtifact: 'repair_attempt_plan',
      saveStdoutTo: paths.repair_attempt_plan,
      nextStageAfterSuccess: 'ready_for_attempt_outcomes',
    }),
  ];
}

export function finalizationDescriptor({
  sourceRef = '',
  source = {},
  attemptPlanPath = '',
  attemptArtifactPath = '',
  replacementRoot = '',
  indexRoot = '',
} = {}) {
  return descriptor({
    id: 'work-record-repair-finalize-dry-run',
    purpose: 'Preflight finalization with exact plan, artifact, source, and destination digests.',
    argv: [
      './aos', 'work-record', 'repair', 'finalize',
      '--source', sourceArg(sourceRef, source),
      '--attempt-plan', attemptPlanPath || '<repair-attempt-plan.json>',
      '--attempt-artifact', attemptArtifactPath || '<repair-attempt-artifact.json>',
      '--replacement-root', replacementRoot || '<replacement-root>',
      '--index-root', indexRoot || '<index-root>',
      '--dry-run', '--json',
    ],
    nextStageAfterSuccess: 'ready_to_finalize',
  });
}

export function supersessionDescriptors(sourceRef, source, indexRoot = '') {
  return [descriptor({
    id: 'work-record-supersession-lookup',
    purpose: 'Inspect the source supersession relationship.',
    argv: ['./aos', 'work-record', 'supersession', 'lookup', '--source', sourceArg(sourceRef, source), '--index-root', indexRoot || '<index-root>', '--json'],
    nextStageAfterSuccess: 'finalized',
  })];
}
