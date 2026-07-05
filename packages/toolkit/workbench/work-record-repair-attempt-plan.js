import crypto from 'node:crypto';
import {
  checkWorkRecordGateAuthorizationFromRepairPlan,
  repairPlanIdentity,
} from './work-record-workflow-gate.js';
import {
  planWorkRecordRepair,
  validateWorkRecordRepairPlan,
  WORK_RECORD_REPAIR_PLAN_SCHEMA_VERSION,
} from './work-record-repair-plan.js';

export const WORK_RECORD_REPAIR_ATTEMPT_PLAN_SCHEMA_VERSION = '2026-07-work-record-repair-attempt-plan-v0';
export const WORK_RECORD_REPAIR_ATTEMPT_PLAN_TYPE = 'work_record.repair_attempt_plan';

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

function canonicalize(value, seen = new WeakSet()) {
  if (Array.isArray(value)) return value.map((item) => canonicalize(item, seen));
  if (value === null || typeof value !== 'object') return value;
  if (seen.has(value)) return '[Circular]';
  seen.add(value);
  return Object.keys(value).sort().reduce((next, key) => {
    next[key] = canonicalize(value[key], seen);
    return next;
  }, {});
}

function digest(value) {
  return crypto
    .createHash('sha256')
    .update(JSON.stringify(canonicalize(value)))
    .digest('hex');
}

function uniqueStrings(values = []) {
  return [...new Set(values.map((value) => text(value)).filter(Boolean))].sort();
}

function mutatingPlanSteps(plan = {}) {
  return arrayValue(plan.plan_steps).filter((step) => {
    const item = objectValue(step);
    return item.read_only === false || item.requires_workflow_gate === true;
  });
}

function requiredGateIds(plan = {}) {
  return uniqueStrings([
    ...arrayValue(plan.workflow_gates).filter((gate) => objectValue(gate).required === true).map((gate) => objectValue(gate).id),
    ...mutatingPlanSteps(plan).flatMap((step) => arrayValue(objectValue(step).workflow_gate_refs)),
    ...arrayValue(plan.candidate_patches).flatMap((patch) => arrayValue(objectValue(patch).workflow_gate_refs)),
  ]);
}

function requiredMutatingGateIds(plan = {}) {
  return uniqueStrings([
    ...mutatingPlanSteps(plan).flatMap((step) => arrayValue(objectValue(step).workflow_gate_refs)),
    ...arrayValue(plan.candidate_patches)
      .filter((patch) => objectValue(patch).applied === false && objectValue(patch).requires_workflow_gate === true)
      .flatMap((patch) => arrayValue(objectValue(patch).workflow_gate_refs)),
  ]);
}

function sourceIdentity(source = {}) {
  const value = objectValue(source);
  return {
    id: text(value.id),
    path: text(value.path),
    requested_ref: text(value.requested_ref),
    schema_version: text(value.schema_version),
  };
}

function authorizationIdentity(authorization = {}) {
  const value = objectValue(authorization);
  return {
    type: text(value.type),
    schema_version: text(value.schema_version),
    status: text(value.status || value.authorization_status),
    source_work_record: sourceIdentity(value.source_work_record),
    repair_plan_digest: text(value.repair_plan?.digest || value.repair_plan?.identity?.digest),
    workflow_gate_id: text(value.workflow_gate?.id),
    terminal_gate_record_or_resume_event_id: text(value.terminal_gate_record_or_resume_event_id),
    digest: digest(value),
  };
}

function normalizeAuthorization(plan = {}, options = {}) {
  if (options.authorization) return cloneJson(options.authorization);
  if (options.gateOutcome) {
    return checkWorkRecordGateAuthorizationFromRepairPlan(plan, options.gateOutcome, {
      workflowGateId: options.workflowGateId,
    });
  }
  return null;
}

function validateAuthorizationBinding(plan = {}, authorization = {}) {
  const diagnostics = [];
  const planIdentity = repairPlanIdentity(plan);
  const expectedSource = sourceIdentity(plan.source_work_record);
  const actualSource = sourceIdentity(authorization.source_work_record);
  const authPlanDigest = text(authorization.repair_plan?.digest || authorization.repair_plan?.identity?.digest);
  const authSchema = text(authorization.schema_version);
  const authType = text(authorization.type);

  if (authType !== 'work_record.workflow_gate_authorization') {
    diagnostics.push({
      severity: 'error',
      code: 'UNSUPPORTED_AUTHORIZATION_TYPE',
      message: 'Repair Attempt Plans require work_record.workflow_gate_authorization input.',
      path: 'authorization.type',
    });
  }
  if (authSchema !== '2026-07-work-record-workflow-gate-authorization-v0') {
    diagnostics.push({
      severity: 'error',
      code: 'UNSUPPORTED_AUTHORIZATION_SCHEMA',
      message: 'Workflow Gate Authorization schema_version is not supported.',
      path: 'authorization.schema_version',
    });
  }
  if (actualSource.id && expectedSource.id && actualSource.id !== expectedSource.id) {
    diagnostics.push({
      severity: 'error',
      code: 'AUTHORIZATION_SOURCE_WORK_RECORD_MISMATCH',
      message: 'Workflow Gate Authorization source Work Record does not match the current source Work Record.',
      expected: expectedSource.id,
      actual: actualSource.id,
    });
  }
  if (!authPlanDigest) {
    diagnostics.push({
      severity: 'error',
      code: 'AUTHORIZATION_REPAIR_PLAN_IDENTITY_MISSING',
      message: 'Workflow Gate Authorization does not carry a Repair Plan identity digest.',
      path: 'authorization.repair_plan.digest',
    });
  } else if (authPlanDigest !== planIdentity.digest) {
    diagnostics.push({
      severity: 'error',
      code: 'AUTHORIZATION_REPAIR_PLAN_STALE',
      message: 'Workflow Gate Authorization was produced for a different Repair Plan identity.',
      expected: planIdentity.digest,
      actual: authPlanDigest,
    });
  }

  const gateId = text(authorization.workflow_gate?.id);
  const gates = requiredMutatingGateIds(plan);
  if (gateId && gates.length > 0 && !gates.includes(gateId)) {
    diagnostics.push({
      severity: 'error',
      code: 'AUTHORIZATION_WORKFLOW_GATE_MISMATCH',
      message: 'Workflow Gate Authorization gate does not match a mutating Repair Plan gate.',
      expected: gates,
      actual: gateId,
    });
  }

  return diagnostics;
}

function statusFromPlanAndAuthorization(plan = {}, authorization = null, diagnostics = []) {
  const validation = validateWorkRecordRepairPlan(plan);
  if (validation.status !== 'passed') return 'unsupported';
  if (diagnostics.some((diagnostic) => diagnostic.code === 'UNSUPPORTED_AUTHORIZATION_TYPE'
    || diagnostic.code === 'UNSUPPORTED_AUTHORIZATION_SCHEMA')) return 'unsupported';
  if (diagnostics.some((diagnostic) => diagnostic.code === 'AUTHORIZATION_REPAIR_PLAN_STALE')) return 'stale';
  if (diagnostics.some((diagnostic) => diagnostic.code === 'AUTHORIZATION_SOURCE_WORK_RECORD_MISMATCH'
    || diagnostic.code === 'AUTHORIZATION_WORKFLOW_GATE_MISMATCH')) return 'mismatch';
  if (diagnostics.some((diagnostic) => diagnostic.code === 'AUTHORIZATION_REPAIR_PLAN_IDENTITY_MISSING')) {
    return 'blocked_authorization_insufficient';
  }

  const gates = requiredMutatingGateIds(plan);
  if (gates.length === 0) return 'not_required';
  if (!authorization) return 'blocked_authorization_required';

  const status = text(authorization.status || authorization.authorization_status);
  if (status === 'authorized') return 'ready';
  if (status === 'denied' || status === 'dismissed' || status === 'timeout') return 'blocked_authorization_denied';
  if (status === 'insufficient_evidence') return 'blocked_authorization_insufficient';
  if (status === 'stale') return 'stale';
  if (status === 'mismatch') return 'mismatch';
  if (status === 'unsupported') return 'unsupported';
  if (status === 'not_required') return 'mismatch';
  return 'blocked_authorization_required';
}

function preconditions(plan = {}, status = '') {
  const planIdentity = repairPlanIdentity(plan);
  const gates = requiredMutatingGateIds(plan);
  return [
    {
      id: 'precondition:source-work-record-resolved',
      kind: 'source_resolution',
      status: plan.source_work_record?.id ? 'representable' : 'missing',
      check: {
        source_work_record: sourceIdentity(plan.source_work_record),
      },
    },
    {
      id: 'precondition:repair-plan-validates',
      kind: 'repair_plan_validation',
      status: validateWorkRecordRepairPlan(plan).status === 'passed' ? 'representable' : 'failed',
      check: {
        schema_version: WORK_RECORD_REPAIR_PLAN_SCHEMA_VERSION,
        digest: planIdentity.digest,
      },
    },
    {
      id: 'precondition:authorization-matches-current-plan',
      kind: 'workflow_gate_authorization',
      status: gates.length === 0 ? 'not_required' : status === 'ready' ? 'representable' : 'blocked',
      required_workflow_gate_ids: gates,
    },
    {
      id: 'precondition:future-attempt-writes-new-artifact',
      kind: 'immutability',
      status: 'representable',
      check: {
        source_work_record_immutable: true,
        allowed_outputs: ['new_work_record', 'explicit_patch_artifact'],
      },
    },
    {
      id: 'precondition:repo-worktree-clean-for-patch-attempt',
      kind: 'worktree_cleanliness',
      status: arrayValue(plan.candidate_patches).length > 0 ? 'representable' : 'not_required',
      check: {
        required_before_future_executor: arrayValue(plan.candidate_patches).length > 0,
      },
    },
  ];
}

function evidenceRequirements(plan = {}) {
  const sourceId = text(plan.source_work_record?.id, 'work-record');
  const base = sourceId.replace(/^work-record:/, '').replace(/[^A-Za-z0-9._-]+/g, '-');
  const requirements = [
    {
      id: 'evidence_requirement:new-work-record-or-patch-artifact',
      kind: 'new_artifact',
      required: true,
      description: 'A future attempt must emit a new Work Record or explicit patch artifact; it must not rewrite the source Work Record.',
      expected_artifact_ref: `artifact:artifacts/work-records/${base}/future-attempt.json`,
    },
    {
      id: 'evidence_requirement:gate-authorization-reference',
      kind: 'authorization_reference',
      required: requiredMutatingGateIds(plan).length > 0,
      workflow_gate_ids: requiredMutatingGateIds(plan),
    },
    {
      id: 'evidence_requirement:before-after-verifier-reports',
      kind: 'verifier_report_pair',
      required: text(plan.status) !== 'no_repair_needed',
      profile_id: text(plan.depends_on?.verifier_profile_id),
    },
  ];

  for (const command of arrayValue(plan.recommended_commands)) {
    const item = objectValue(command);
    requirements.push({
      id: `evidence_requirement:command:${requirements.length}`,
      kind: 'command_output',
      required: false,
      command: text(item.command),
      expected_artifact_ref: `artifact:artifacts/work-records/${base}/command-${requirements.length}.json`,
      command_executes_in_plan: false,
    });
  }
  for (const patch of arrayValue(plan.candidate_patches)) {
    const item = objectValue(patch);
    requirements.push({
      id: `evidence_requirement:patch:${text(item.id, requirements.length)}`,
      kind: 'patch_digest',
      required: true,
      candidate_patch_id: text(item.id),
      target: text(item.target),
      applied_in_plan: false,
    });
  }
  return requirements;
}

function operationAuthorizationStatus(operation = {}, authorization = null, status = '') {
  if (operation.requires_workflow_gate !== true) return 'not_required';
  if (status === 'ready') return 'authorized';
  if (!authorization) return 'missing';
  return text(authorization.status || authorization.authorization_status, 'missing');
}

function controlledExecutorDescriptor(candidatePatch = {}) {
  const executor = objectValue(candidatePatch.controlled_repair_executor);
  const registryKind = text(executor.registry_kind);
  const operationId = text(executor.allowlisted_operation_id);
  if (registryKind !== 'controlled_repair_fixture_registry') return {};
  if (!operationId.startsWith('controlled_fixture.')) return {};
  return {
    allowlisted_operation_id: operationId,
    controlled_repair_executor: {
      registry_kind: registryKind,
      allowlisted_operation_id: operationId,
    },
  };
}

function plannedOperations(plan = {}, authorization = null, status = '') {
  return [
    ...arrayValue(plan.plan_steps).map((step) => {
      const item = objectValue(step);
      const gateRefs = arrayValue(item.workflow_gate_refs).map(text).filter(Boolean).sort();
      return {
        id: text(item.id),
        kind: text(item.kind),
        source_step_id: text(item.id),
        requires_workflow_gate: item.requires_workflow_gate === true,
        workflow_gate_refs: gateRefs,
        authorization_status: operationAuthorizationStatus(item, authorization, status),
        authorization_ref: text(authorization?.workflow_gate?.id),
        mutates_state: item.read_only === false,
        target_boundary: item.read_only === false ? 'future_executor_only' : 'read_only_validation',
        precondition_refs: ['precondition:source-work-record-resolved', 'precondition:repair-plan-validates'],
        evidence_requirement_refs: ['evidence_requirement:new-work-record-or-patch-artifact'],
        postcondition_refs: ['postcondition:source-work-record-unchanged'],
        cleanup_refs: ['cleanup_expectation:future-executor-records-cleanup'],
        rollback_refs: item.read_only === false ? ['rollback_expectation:future-executor-reverts-or-records-failure'] : [],
        executes_in_plan: false,
        description: text(item.description),
      };
    }),
    ...arrayValue(plan.candidate_patches).map((patch) => {
      const item = objectValue(patch);
      const executorDescriptor = controlledExecutorDescriptor(item);
      return {
        id: `planned_operation:${text(item.id)}`,
        kind: 'candidate_patch',
        source_candidate_patch_id: text(item.id),
        ...executorDescriptor,
        requires_workflow_gate: item.requires_workflow_gate === true,
        workflow_gate_refs: arrayValue(item.workflow_gate_refs).map(text).filter(Boolean).sort(),
        authorization_status: operationAuthorizationStatus(item, authorization, status),
        authorization_ref: text(authorization?.workflow_gate?.id),
        mutates_state: true,
        target_boundary: text(item.target),
        precondition_refs: ['precondition:authorization-matches-current-plan', 'precondition:repo-worktree-clean-for-patch-attempt'],
        evidence_requirement_refs: [`evidence_requirement:patch:${text(item.id)}`],
        postcondition_refs: ['postcondition:source-work-record-unchanged', 'postcondition:future-artifact-validates'],
        cleanup_refs: ['cleanup_expectation:future-executor-records-cleanup'],
        rollback_refs: ['rollback_expectation:future-executor-reverts-or-records-failure'],
        executes_in_plan: false,
      };
    }),
  ].filter((operation) => text(operation.id));
}

function candidatePatches(plan = {}) {
  return arrayValue(plan.candidate_patches).map((patch) => {
    const item = objectValue(patch);
    return {
      ...cloneJson(item),
      applied: false,
      executes_in_plan: false,
      validation_expectations: [
        'future attempt emits a patch artifact or new Work Record',
        'future verifier report is captured as evidence',
      ],
      rollback_expectation_refs: ['rollback_expectation:future-executor-reverts-or-records-failure'],
    };
  });
}

function recommendedCommands(plan = {}) {
  return arrayValue(plan.recommended_commands).map((command) => {
    const item = objectValue(command);
    return {
      ...cloneJson(item),
      executes_in_plan: false,
      required_preconditions: ['precondition:source-work-record-resolved'],
      expected_evidence_artifact: 'future executor command output artifact',
      warning: item.mutates_state === true
        ? 'This command would mutate state and requires a future explicit executor plus Workflow gate.'
        : 'This command is a descriptor only and is not run by the Repair Attempt Plan.',
    };
  });
}

function attemptIdentity(plan = {}, authorization = null, operations = []) {
  const planIdentity = repairPlanIdentity(plan);
  const authorizations = authorization ? [authorizationIdentity(authorization)] : [];
  const identity = {
    source_work_record: sourceIdentity(plan.source_work_record),
    repair_plan: {
      schema_version: text(plan.schema_version),
      digest: planIdentity.digest,
    },
    workflow_gate_authorizations: authorizations,
    workflow_gate_ids: requiredGateIds(plan),
    gated_step_ids: uniqueStrings(mutatingPlanSteps(plan).map((step) => objectValue(step).id)),
    candidate_patch_ids: uniqueStrings(arrayValue(plan.candidate_patches).map((patch) => objectValue(patch).id)),
    planned_operation_ids: uniqueStrings(operations.map((operation) => operation.id)),
  };
  return {
    ...identity,
    digest: digest(identity),
    attempt_id: `work-record-repair-attempt:${digest(identity).slice(0, 24)}`,
  };
}

function recommendedNext(status = '', plan = {}) {
  if (status === 'ready') {
    return {
      action: 'hand_to_future_explicit_executor',
      note: 'Ready means only safe to hand to a future explicit executor; no repair has happened.',
    };
  }
  if (status === 'blocked_authorization_required') {
    return {
      action: 'request_or_check_workflow_gate_authorization',
      commands: [
        `./aos work-record gate-request ${text(plan.source_work_record?.requested_ref || plan.source_work_record?.id, '<id-or-path>')} --json`,
        `./aos work-record gate-check ${text(plan.source_work_record?.requested_ref || plan.source_work_record?.id, '<id-or-path>')} --gate-record <gate-record> --json`,
      ],
    };
  }
  if (status === 'not_required') {
    return {
      action: 'no_future_repair_attempt_required',
      reason: 'The current Repair Plan has no gated mutating operation requiring an attempt.',
    };
  }
  return {
    action: 'do_not_execute_repair',
    reason: `Repair Attempt Plan status is ${status}.`,
  };
}

function envelope({ plan = {}, authorization = null, status = '', diagnostics = [] } = {}) {
  const operations = plannedOperations(plan, authorization, status);
  const identity = attemptIdentity(plan, authorization, operations);
  const planIdentity = repairPlanIdentity(plan);
  return {
    type: WORK_RECORD_REPAIR_ATTEMPT_PLAN_TYPE,
    schema_version: WORK_RECORD_REPAIR_ATTEMPT_PLAN_SCHEMA_VERSION,
    status,
    source_work_record: cloneJson(plan.source_work_record || {}),
    repair_plan: {
      schema_version: text(plan.schema_version),
      digest: planIdentity.digest,
      identity: planIdentity,
    },
    workflow_gate_authorizations: authorization ? [cloneJson(authorization)] : [],
    attempt_identity: identity,
    preconditions: preconditions(plan, status),
    planned_operations: operations,
    candidate_patches: candidatePatches(plan),
    recommended_commands: recommendedCommands(plan),
    evidence_requirements: evidenceRequirements(plan),
    postconditions: [
      {
        id: 'postcondition:source-work-record-unchanged',
        kind: 'immutability',
        required: true,
        description: 'Future execution must prove the source Work Record bytes or digest stayed unchanged.',
      },
      {
        id: 'postcondition:future-artifact-validates',
        kind: 'validation',
        required: status === 'ready',
        description: 'A future executor must validate any emitted Work Record or patch artifact and record diagnostics.',
      },
    ],
    cleanup_expectations: [
      {
        id: 'cleanup_expectation:future-executor-records-cleanup',
        kind: 'record_cleanup_result',
        executes_in_plan: false,
        description: 'Cleanup belongs to a future executor and must be recorded as evidence or failure diagnostics.',
      },
    ],
    rollback_expectations: [
      {
        id: 'rollback_expectation:future-executor-reverts-or-records-failure',
        kind: 'future_executor_rollback',
        executes_in_plan: false,
        description: 'Rollback is descriptive here; a future executor must either revert its own changes or emit failure evidence.',
      },
    ],
    risk: {
      level: status === 'ready' ? 'bounded_future_mutation' : 'blocked_or_read_only',
      source_work_record_immutable: true,
      authorization_required_for_mutation: requiredMutatingGateIds(plan).length > 0,
    },
    known_limits: [
      'Repair Attempt Plans do not repair anything.',
      'Repair Attempt Plans do not authorize themselves.',
      'Workflow Gate Authorization authorizes only a future attempt.',
      'Future execution must produce new evidence.',
      'Source Work Records stay immutable.',
    ],
    executes_repair: false,
    executes_actions: false,
    applies_patches: false,
    mutates_record: false,
    automatic_replay_allowed: false,
    diagnostics,
    recommended_next: recommendedNext(status, plan),
  };
}

export function planWorkRecordRepairAttempt(ref, options = {}) {
  const plan = options.repairPlan || planWorkRecordRepair(ref, options);
  if (plan.status === 'failed' || plan.status === 'unsupported_profile') {
    return {
      type: WORK_RECORD_REPAIR_ATTEMPT_PLAN_TYPE,
      schema_version: WORK_RECORD_REPAIR_ATTEMPT_PLAN_SCHEMA_VERSION,
      status: 'blocked_precondition',
      source_work_record: cloneJson(plan.source_work_record || {}),
      repair_plan: {},
      workflow_gate_authorizations: [],
      attempt_identity: {
        source_work_record: sourceIdentity(plan.source_work_record),
        digest: digest(plan),
      },
      preconditions: [],
      planned_operations: [],
      candidate_patches: [],
      recommended_commands: [],
      evidence_requirements: [],
      postconditions: [],
      cleanup_expectations: [],
      rollback_expectations: [],
      risk: { level: 'blocked_or_read_only' },
      known_limits: ['Repair Attempt Plans do not repair anything.'],
      executes_repair: false,
      executes_actions: false,
      applies_patches: false,
      mutates_record: false,
      automatic_replay_allowed: false,
      diagnostics: arrayValue(plan.diagnostics),
      recommended_next: { action: 'repair_plan_precondition_failed' },
    };
  }

  const validation = validateWorkRecordRepairPlan(plan);
  const authorization = normalizeAuthorization(plan, options);
  const bindingDiagnostics = authorization ? validateAuthorizationBinding(plan, authorization) : [];
  const diagnostics = [
    ...arrayValue(validation.diagnostics),
    ...bindingDiagnostics,
    ...arrayValue(authorization?.diagnostics),
  ];
  const status = validation.status !== 'passed'
    ? 'unsupported'
    : statusFromPlanAndAuthorization(plan, authorization, bindingDiagnostics);
  return envelope({ plan, authorization, status, diagnostics });
}

export function validateWorkRecordRepairAttemptPlan(attemptPlan = {}) {
  const value = objectValue(attemptPlan);
  const diagnostics = [];
  function add(code, message, path) {
    diagnostics.push({
      severity: 'error',
      code,
      message,
      path,
    });
  }
  if (text(value.type) !== WORK_RECORD_REPAIR_ATTEMPT_PLAN_TYPE) {
    add('INVALID_REPAIR_ATTEMPT_PLAN_TYPE', 'Repair Attempt Plan type must be work_record.repair_attempt_plan.', 'type');
  }
  if (text(value.schema_version) !== WORK_RECORD_REPAIR_ATTEMPT_PLAN_SCHEMA_VERSION) {
    add('INVALID_REPAIR_ATTEMPT_PLAN_SCHEMA_VERSION', 'Repair Attempt Plan schema_version is not supported.', 'schema_version');
  }
  for (const field of ['executes_repair', 'executes_actions', 'applies_patches', 'mutates_record', 'automatic_replay_allowed']) {
    if (value[field] !== false) add('REPAIR_ATTEMPT_PLAN_EXECUTION_FLAG_NOT_FALSE', `${field} must be false.`, field);
  }
  arrayValue(value.planned_operations).forEach((operation, index) => {
    const item = objectValue(operation);
    if (item.executes_in_plan !== false) {
      add('PLANNED_OPERATION_EXECUTES_IN_PLAN', 'Planned operations must not execute inside the Repair Attempt Plan.', `planned_operations[${index}].executes_in_plan`);
    }
  });
  arrayValue(value.candidate_patches).forEach((patch, index) => {
    const item = objectValue(patch);
    if (item.applied !== false) add('CANDIDATE_PATCH_APPLIED_IN_ATTEMPT_PLAN', 'Candidate patches must remain unapplied.', `candidate_patches[${index}].applied`);
  });
  arrayValue(value.recommended_commands).forEach((command, index) => {
    const item = objectValue(command);
    if (item.executes_in_plan !== false) {
      add('RECOMMENDED_COMMAND_EXECUTES_IN_ATTEMPT_PLAN', 'Recommended commands must not execute inside the Repair Attempt Plan.', `recommended_commands[${index}].executes_in_plan`);
    }
  });
  return {
    type: 'work_record.repair_attempt_plan.validation',
    schema_version: WORK_RECORD_REPAIR_ATTEMPT_PLAN_SCHEMA_VERSION,
    status: diagnostics.length > 0 ? 'failed' : 'passed',
    diagnostics,
  };
}
