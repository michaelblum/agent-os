import path from 'node:path';
import {
  commandHintFromArgv,
  shellQuoteArg,
} from './work-record-command-recommendation.js';

export function text(value, fallback = '') {
  const normalized = String(value ?? '').replace(/\s+/g, ' ').trim();
  return normalized || fallback;
}

export function arrayValue(value) {
  return Array.isArray(value) ? value : [];
}

export function cloneJson(value) {
  if (value === undefined) return undefined;
  return JSON.parse(JSON.stringify(value));
}

export function descriptor({
  id,
  purpose,
  argv,
  mutatesState = false,
  requiresApproval = false,
  requiresExistingAuthorization = false,
  requiresUserSuppliedRoot = false,
  expectedOutput = 'json',
  nextStageAfterSuccess = '',
  stdoutArtifact = null,
  requiresSavedOutputFrom = [],
} = {}) {
  const item = {
    id,
    purpose,
    command: commandHintFromArgv(argv),
    argv,
    mutates_state: mutatesState,
    requires_approval: requiresApproval,
    requires_existing_authorization: requiresExistingAuthorization,
    requires_user_supplied_root: requiresUserSuppliedRoot,
    expected_output: expectedOutput,
    next_stage_after_success: nextStageAfterSuccess,
    not_run_by_guide: true,
  };
  if (stdoutArtifact) {
    item.stdout_artifact = stdoutArtifact;
    item.save_stdout_to = stdoutArtifact.path;
    item.persistence_command = `${item.command} > ${shellQuoteArg(stdoutArtifact.path)}`;
  }
  if (requiresSavedOutputFrom.length > 0) {
    item.requires_saved_output_from = requiresSavedOutputFrom;
  }
  return item;
}

export function sourceArg(sourceRef, source = {}) {
  return text(sourceRef || source.path || source.id, '<id-or-path>');
}

function sourceSlug(source = {}, sourceRef = '') {
  return text(source.id || sourceRef || 'work-record')
    .replace(/^work-record:/, '')
    .replace(/[^A-Za-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    || 'work-record';
}

export function recommendedPaths(source = {}, sourceRef = '') {
  const slug = sourceSlug(source, sourceRef);
  const base = path.join('/tmp', 'aos-work-record-repair-guide', slug);
  return {
    guide_root: base,
    attempt_plan_path: path.join(base, 'repair-attempt-plan.json'),
    execution_root: path.join(base, 'execution-root'),
    artifact_root: path.join(base, 'artifact-root'),
    attempt_artifact_path: path.join(base, 'repair-attempt-artifact.json'),
    gate_request_path: path.join(base, 'gate-request.json'),
    replacement_root: path.join(base, 'replacement-records'),
    index_root: path.join(base, 'source-supersession-index'),
  };
}

export function summarizeStatus(status = {}) {
  return {
    type: text(status.type),
    status: text(status.status),
    health_verdict: text(status.health_verdict),
    current_report_status: text(status.current_report_status),
    failure_classes: arrayValue(status.failure_classes),
    diagnostics: arrayValue(status.diagnostics),
    recovery: cloneJson(status.recovery || {}),
  };
}

export function summarizeRepairPlan(plan = {}) {
  return {
    type: text(plan.type),
    schema_version: text(plan.schema_version),
    status: text(plan.status),
    health_verdict: text(plan.health_verdict || plan.current_health),
    source_work_record: cloneJson(plan.source_work_record || {}),
    workflow_gates: cloneJson(arrayValue(plan.workflow_gates)),
    candidate_patches: cloneJson(arrayValue(plan.candidate_patches)),
    blockers: cloneJson(plan.blockers || {}),
    diagnostics: arrayValue(plan.diagnostics),
  };
}

export function summarizeGate(gate = null) {
  if (!gate) return null;
  return {
    type: text(gate.type),
    schema_version: text(gate.schema_version),
    status: text(gate.status),
    source_work_record: cloneJson(gate.source_work_record || {}),
    repair_plan: cloneJson(gate.repair_plan || {}),
    workflow_gate: cloneJson(gate.workflow_gate || {}),
    authorizes_future_attempt: gate.authorizes_future_attempt === true,
    diagnostics: arrayValue(gate.diagnostics),
    recommended_next: cloneJson(gate.recommended_next || {}),
    gate_request: gate.gate_request ? {
      schema_version: text(gate.gate_request.schema_version),
      id: text(gate.gate_request.id),
      metadata: cloneJson(gate.gate_request.metadata || {}),
    } : null,
  };
}

export function summarizeAttemptPlan(plan = null) {
  if (!plan) return null;
  return {
    type: text(plan.type),
    schema_version: text(plan.schema_version),
    status: text(plan.status),
    source_work_record: cloneJson(plan.source_work_record || {}),
    repair_plan: cloneJson(plan.repair_plan || {}),
    workflow_gate_authorizations: cloneJson(arrayValue(plan.workflow_gate_authorizations)),
    attempt_identity: cloneJson(plan.attempt_identity || {}),
    planned_operations: cloneJson(arrayValue(plan.planned_operations)),
    diagnostics: arrayValue(plan.diagnostics),
    recommended_next: cloneJson(plan.recommended_next || {}),
  };
}

export function summarizeAttemptArtifact(validation = null, read = null) {
  if (!validation && !read) return null;
  return {
    path: text(read?.path),
    read_status: text(read?.status),
    digest: text(read?.digest),
    artifact_status: text(read?.value?.status),
    validation: validation ? cloneJson(validation) : null,
  };
}

export function summarizeFinalization(result = null) {
  if (!result) return null;
  return {
    type: text(result.type),
    schema_version: text(result.schema_version),
    status: text(result.status),
    mode: text(result.mode),
    dry_run: result.dry_run === true,
    repair_attempt_plan: cloneJson(result.repair_attempt_plan || {}),
    repair_attempt_artifact: cloneJson(result.repair_attempt_artifact || {}),
    replacement_writer_result: cloneJson(result.replacement_writer_result || {}),
    supersession_index_result: cloneJson(result.supersession_index_result || {}),
    would_write_replacement_record: result.would_write_replacement_record === true,
    would_write_supersession_index_entry: result.would_write_supersession_index_entry === true,
    diagnostics: arrayValue(result.diagnostics),
    recovery: cloneJson(result.recovery || result.recommended_next || {}),
  };
}

export function summarizeSupersession(lookup = null) {
  if (!lookup) return null;
  return {
    type: text(lookup.type),
    schema_version: text(lookup.schema_version),
    status: text(lookup.status),
    relationship_status: text(lookup.relationship_status),
    index_root: text(lookup.index_root),
    source_work_record: cloneJson(lookup.source_work_record || {}),
    entries: cloneJson(arrayValue(lookup.entries)),
    malformed_entries: cloneJson(arrayValue(lookup.malformed_entries)),
    diagnostics: arrayValue(lookup.diagnostics),
  };
}

export function stageEnvelope({
  stage,
  status,
  why,
  evidence = [],
  nextCommand = null,
  missingInputs = [],
  blockers = [],
  wouldMutateIfRun = false,
  requiresUserApproval = false,
  alternatives = [],
} = {}) {
  return {
    current_stage: stage,
    stage_status: status,
    stage: {
      id: stage,
      status,
      why,
      evidence,
      next_command: nextCommand,
      missing_inputs: missingInputs,
      would_mutate_if_run: wouldMutateIfRun,
      requires_user_approval: requiresUserApproval,
    },
    blockers,
    missing_inputs: missingInputs,
    next_explicit_command: nextCommand,
    alternative_explicit_commands: alternatives,
  };
}

function jsonStdoutArtifact({ kind, path: artifactPath }) {
  return {
    required: true,
    kind,
    path: artifactPath,
    format: 'json',
    write_mode: 'create_or_replace',
    directory_precondition: 'create_parent_directory',
  };
}

function savedOutputRequirement({ descriptorId, artifactKind, path: artifactPath }) {
  return {
    descriptor_id: descriptorId,
    artifact_kind: artifactKind,
    path: artifactPath,
  };
}

export function gateDescriptors(sourceRef, source, plan, paths = recommendedPaths(source, sourceRef)) {
  const sourceValue = sourceArg(sourceRef, source);
  const gateRequestPath = paths.gate_request_path;
  return [
    descriptor({
      id: 'work-record-gate-request',
      purpose: 'Emit the Workflow Gate request for the current Repair Plan as JSON stdout.',
      argv: ['./aos', 'work-record', 'gate-request', sourceValue, '--json'],
      stdoutArtifact: jsonStdoutArtifact({
        kind: 'workflow_gate_request',
        path: gateRequestPath,
      }),
      nextStageAfterSuccess: 'authorization_pending',
    }),
    descriptor({
      id: 'aos-gate-ask',
      purpose: 'Present the generated gate request and store the terminal response for later gate-check.',
      argv: ['./aos', 'gate', 'ask', '--request', gateRequestPath, '--store-response', '--json'],
      mutatesState: true,
      requiresApproval: true,
      requiresSavedOutputFrom: [
        savedOutputRequirement({
          descriptorId: 'work-record-gate-request',
          artifactKind: 'workflow_gate_request',
          path: gateRequestPath,
        }),
      ],
      nextStageAfterSuccess: 'authorization_pending',
    }),
    descriptor({
      id: 'work-record-gate-check',
      purpose: 'Check a stored terminal gate record against the current Repair Plan.',
      argv: ['./aos', 'work-record', 'gate-check', sourceValue, '--gate-record', '<gate-record>', '--json'],
      nextStageAfterSuccess: 'ready_to_execute',
    }),
  ].map((item) => ({
    ...item,
    repair_plan_status: text(plan.status),
  }));
}

export function attemptDescriptors({
  sourceRef,
  source,
  paths,
  attemptPlanPath = '',
  executionRoot = '',
  artifactRoot = '',
} = {}) {
  const planPath = text(attemptPlanPath, paths.attempt_plan_path);
  const execRoot = text(executionRoot, paths.execution_root);
  const artRoot = text(artifactRoot, paths.artifact_root);
  const sourceValue = sourceArg(sourceRef, source);
  return [
    descriptor({
      id: 'work-record-plan-attempt',
      purpose: 'Emit the ready Repair Attempt Plan as JSON stdout.',
      argv: ['./aos', 'work-record', 'plan-attempt', sourceValue, '--authorization', '<workflow-gate-authorization.json>', '--json'],
      stdoutArtifact: jsonStdoutArtifact({
        kind: 'repair_attempt_plan',
        path: planPath,
      }),
      nextStageAfterSuccess: 'ready_to_execute',
    }),
    descriptor({
      id: 'work-record-repair-execute-dry-run',
      purpose: 'Preflight the controlled repair executor without writing the Repair Attempt Artifact.',
      argv: ['./aos', 'work-record', 'repair', 'execute', '--attempt-plan', planPath, '--execution-root', execRoot, '--artifact-root', artRoot, '--dry-run', '--json'],
      mutatesState: false,
      requiresExistingAuthorization: true,
      requiresUserSuppliedRoot: !executionRoot || !artifactRoot,
      requiresSavedOutputFrom: [
        savedOutputRequirement({
          descriptorId: 'work-record-plan-attempt',
          artifactKind: 'repair_attempt_plan',
          path: planPath,
        }),
      ],
      nextStageAfterSuccess: 'ready_to_execute',
    }),
    descriptor({
      id: 'work-record-repair-execute',
      purpose: 'Execute the controlled repair under explicit roots and write a Repair Attempt Artifact.',
      argv: ['./aos', 'work-record', 'repair', 'execute', '--attempt-plan', planPath, '--execution-root', execRoot, '--artifact-root', artRoot, '--json'],
      mutatesState: true,
      requiresApproval: true,
      requiresExistingAuthorization: true,
      requiresUserSuppliedRoot: !executionRoot || !artifactRoot,
      requiresSavedOutputFrom: [
        savedOutputRequirement({
          descriptorId: 'work-record-plan-attempt',
          artifactKind: 'repair_attempt_plan',
          path: planPath,
        }),
      ],
      nextStageAfterSuccess: 'ready_to_finalize',
    }),
  ];
}

export function finalizationDescriptor({
  sourceRef,
  source,
  attemptPlanPath,
  attemptArtifactPath,
  replacementRoot,
  indexRoot,
  proposedIdSeed = '',
  replacementOutputPath = '',
  dryRun = false,
} = {}) {
  const argv = [
    './aos',
    'work-record',
    'repair',
    'finalize',
    '--source',
    sourceArg(sourceRef, source),
    '--attempt-plan',
    attemptPlanPath,
    '--attempt-artifact',
    attemptArtifactPath,
    '--replacement-root',
    replacementRoot,
    '--index-root',
    indexRoot,
    ...(proposedIdSeed ? ['--proposed-id-seed', proposedIdSeed] : []),
    ...(replacementOutputPath ? ['--replacement-output-path', replacementOutputPath] : []),
    ...(dryRun ? ['--dry-run'] : []),
    '--json',
  ];
  return descriptor({
    id: dryRun ? 'work-record-repair-finalize-dry-run' : 'work-record-repair-finalize',
    purpose: dryRun
      ? 'Preflight replacement Work Record and Source Supersession Index outputs without writing.'
      : 'Finalize the successful Repair Attempt Artifact into replacement and supersession outputs.',
    argv,
    mutatesState: !dryRun,
    requiresApproval: !dryRun,
    requiresExistingAuthorization: true,
    requiresUserSuppliedRoot: true,
    nextStageAfterSuccess: dryRun ? 'ready_to_finalize' : 'finalized',
  });
}

export function supersessionDescriptors(sourceRef, source, indexRoot = '') {
  return [
    descriptor({
      id: 'work-record-supersession-lookup',
      purpose: 'Look up whether the source Work Record already has an active replacement.',
      argv: ['./aos', 'work-record', 'supersession', 'lookup', '--source', sourceArg(sourceRef, source), '--index-root', text(indexRoot, '<index-root>'), '--json'],
      requiresUserSuppliedRoot: !indexRoot,
      nextStageAfterSuccess: 'finalized',
    }),
  ];
}
