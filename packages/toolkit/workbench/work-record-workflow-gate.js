import crypto from 'node:crypto';
import {
  planWorkRecordRepair,
  validateWorkRecordRepairPlan,
  WORK_RECORD_REPAIR_PLAN_SCHEMA_VERSION,
} from './work-record-repair-plan.js';

export const WORK_RECORD_WORKFLOW_GATE_AUTHORIZATION_SCHEMA_VERSION = '2026-07-work-record-workflow-gate-authorization-v0';
export const WORK_RECORD_WORKFLOW_GATE_AUTHORIZATION_TYPE = 'work_record.workflow_gate_authorization';
export const WORK_RECORD_WORKFLOW_GATE_REQUEST_SOURCE = 'work_record.repair_plan';

const TERMINAL_GATE_RECORD_SCHEMA_VERSION = 'aos.gate.record.v1';
const TERMINAL_RESUME_EVENT_SCHEMA_VERSION = 'aos.gate.resume-event.v1';
const GATE_REQUEST_SCHEMA_VERSION = 'aos.gate.request.v1';

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

function shortDigest(value) {
  return digest(value).slice(0, 24);
}

function requiredGatedMutatingSteps(plan = {}) {
  return arrayValue(plan.plan_steps).filter((step) => {
    const item = objectValue(step);
    return item.read_only === false
      && item.requires_workflow_gate === true
      && arrayValue(item.workflow_gate_refs).length > 0;
  });
}

function requiredGatedPatches(plan = {}) {
  return arrayValue(plan.candidate_patches).filter((patch) => {
    const item = objectValue(patch);
    return item.applied === false
      && item.requires_workflow_gate === true
      && arrayValue(item.workflow_gate_refs).length > 0;
  });
}

function gatesNeedingAuthorization(plan = {}) {
  const gates = new Map();
  for (const gate of arrayValue(plan.workflow_gates)) {
    const item = objectValue(gate);
    const id = text(item.id);
    if (id && item.required === true) gates.set(id, cloneJson(item));
  }
  const mutatingRefs = new Set([
    ...requiredGatedMutatingSteps(plan).flatMap((step) => arrayValue(step.workflow_gate_refs).map(text)),
    ...requiredGatedPatches(plan).flatMap((patch) => arrayValue(patch.workflow_gate_refs).map(text)),
  ].filter(Boolean));
  return [...mutatingRefs].sort().map((id) => gates.get(id) || {
    id,
    required: true,
    purpose: 'Authorize a future Work Record repair attempt.',
  });
}

export function repairPlanIdentity(plan = {}) {
  const value = objectValue(plan);
  const gatedSteps = requiredGatedMutatingSteps(value).map((step) => ({
    id: text(step.id),
    kind: text(step.kind),
    workflow_gate_refs: arrayValue(step.workflow_gate_refs).map(text).filter(Boolean).sort(),
  }));
  const gatedPatches = requiredGatedPatches(value).map((patch) => ({
    id: text(patch.id),
    target: text(patch.target),
    workflow_gate_refs: arrayValue(patch.workflow_gate_refs).map(text).filter(Boolean).sort(),
  }));
  const identity = {
    schema_version: text(value.schema_version),
    source_work_record: {
      id: text(value.source_work_record?.id),
      path: text(value.source_work_record?.path),
      requested_ref: text(value.source_work_record?.requested_ref),
      schema_version: text(value.source_work_record?.schema_version),
    },
    health_verdict: text(value.health_verdict || value.current_health),
    workflow_gate_ids: gatesNeedingAuthorization(value).map((gate) => text(gate.id)),
    gated_step_ids: gatedSteps.map((step) => step.id).filter(Boolean).sort(),
    candidate_patch_ids: gatedPatches.map((patch) => patch.id).filter(Boolean).sort(),
  };
  return {
    ...identity,
    digest: digest(identity),
  };
}

function authorizationEnvelope({
  status,
  sourceWorkRecord = {},
  repairPlan = {},
  workflowGate = {},
  gateRequest = null,
  gateRecord = null,
  resumeEvent = null,
  result = null,
  diagnostics = [],
  recommendedNext = {},
} = {}) {
  return {
    type: WORK_RECORD_WORKFLOW_GATE_AUTHORIZATION_TYPE,
    schema_version: WORK_RECORD_WORKFLOW_GATE_AUTHORIZATION_SCHEMA_VERSION,
    status,
    source_work_record: cloneJson(sourceWorkRecord),
    repair_plan: cloneJson(repairPlan),
    workflow_gate: cloneJson(workflowGate),
    gate_request: gateRequest ? cloneJson(gateRequest) : null,
    gate_record: gateRecord ? cloneJson(gateRecord) : null,
    resume_event: resumeEvent ? cloneJson(resumeEvent) : null,
    terminal_gate_record_or_resume_event_id: text(gateRecord?.gate_id || resumeEvent?.event_id),
    authorization_status: status,
    result,
    authorizes_future_attempt: status === 'authorized',
    executes_repair: false,
    mutates_record: false,
    automatic_replay_allowed: false,
    diagnostics,
    recommended_next: cloneJson(recommendedNext),
  };
}

function requestGateSelection(plan = {}, workflowGateId = '') {
  const gates = gatesNeedingAuthorization(plan);
  if (workflowGateId) return gates.find((gate) => text(gate.id) === workflowGateId) || null;
  return gates[0] || null;
}

function notRequired(plan = {}, workflowGateId = '') {
  const identity = repairPlanIdentity(plan);
  return authorizationEnvelope({
    status: 'not_required',
    sourceWorkRecord: plan.source_work_record || {},
    repairPlan: {
      schema_version: text(plan.schema_version),
      digest: identity.digest,
      identity,
    },
    workflowGate: workflowGateId ? { id: workflowGateId } : {},
    diagnostics: [{
      severity: 'info',
      code: 'WORKFLOW_GATE_NOT_REQUIRED',
      message: 'Current Repair Plan output has no gated mutating step or candidate patch requiring this Workflow gate.',
    }],
    recommendedNext: {
      action: 'no_gate_request',
      reason: 'No repair authorization is required by the current plan.',
    },
  });
}

export function buildWorkRecordGateRequestFromRepairPlan(plan = {}, {
  workflowGateId = '',
  timeoutMs = 0,
} = {}) {
  const validation = validateWorkRecordRepairPlan(plan);
  if (validation.status !== 'passed') {
    return authorizationEnvelope({
      status: 'unsupported',
      sourceWorkRecord: objectValue(plan.source_work_record),
      diagnostics: validation.diagnostics,
      recommendedNext: {
        action: 'repair_plan_invalid',
      },
    });
  }

  const gate = requestGateSelection(plan, workflowGateId);
  if (!gate) return notRequired(plan, workflowGateId);

  const identity = repairPlanIdentity(plan);
  const gateId = `work-record-gate:${shortDigest({
    plan_digest: identity.digest,
    workflow_gate_id: gate.id,
  })}`;
  const source = objectValue(plan.source_work_record);
  const patchIds = requiredGatedPatches(plan).map((patch) => text(patch.id)).filter(Boolean).sort();
  const stepIds = requiredGatedMutatingSteps(plan)
    .filter((step) => arrayValue(step.workflow_gate_refs).includes(gate.id))
    .map((step) => text(step.id))
    .filter(Boolean)
    .sort();
  const title = `Authorize Work Record repair gate: ${source.id || source.requested_ref || 'unknown Work Record'}`;
  const message = [
    `Authorize only a future gated repair attempt for ${source.id || source.path || 'the Work Record'}.`,
    `Workflow gate: ${gate.id}.`,
    'This request does not execute repair, apply patches, replay actions, or mutate the source Work Record.',
  ].join(' ');
  const metadata = {
    type: 'work_record.workflow_gate_request',
    source: WORK_RECORD_WORKFLOW_GATE_REQUEST_SOURCE,
    record_response: true,
    source_work_record: {
      id: text(source.id),
      path: text(source.path),
      requested_ref: text(source.requested_ref),
      schema_version: text(source.schema_version),
    },
    repair_plan: {
      schema_version: text(plan.schema_version),
      digest: identity.digest,
      identity,
    },
    workflow_gate: {
      id: text(gate.id),
      purpose: text(gate.purpose),
    },
    candidate_patch_ids: patchIds,
    step_ids: stepIds,
    current_health: text(plan.health_verdict || plan.current_health),
    authorizes_future_attempt_only: true,
    executes_repair: false,
    mutates_record: false,
    automatic_replay_allowed: false,
  };
  const request = {
    schema_version: GATE_REQUEST_SCHEMA_VERSION,
    id: gateId,
    prompt: {
      title,
      body: message,
    },
    fields: [{
      id: 'authorization',
      kind: 'exclusive_choice',
      label: 'Authorization',
      options: [
        { value: 'approve', label: 'Approve' },
        { value: 'deny', label: 'Deny', danger: true },
      ],
    }],
    ui: {
      variant: 'approve_deny',
    },
    timeout_ms: timeoutMs,
    source: {
      surface: WORK_RECORD_WORKFLOW_GATE_REQUEST_SOURCE,
      session_id: null,
      agent: null,
    },
    record_response: true,
    metadata,
  };
  return {
    type: 'work_record.workflow_gate_request',
    schema_version: WORK_RECORD_WORKFLOW_GATE_AUTHORIZATION_SCHEMA_VERSION,
    status: 'pending',
    source_work_record: metadata.source_work_record,
    repair_plan: metadata.repair_plan,
    workflow_gate: metadata.workflow_gate,
    gate_request: request,
    authorizes_future_attempt: false,
    executes_repair: false,
    mutates_record: false,
    automatic_replay_allowed: false,
    diagnostics: [],
    recommended_next: {
      action: 'ask_or_defer_gate_request',
      note: 'Use aos gate ask/defer with this request; use --store-response or submit metadata.record_response:true so later authorization can prove approval.',
    },
  };
}

export function buildWorkRecordGateRequest(ref, options = {}) {
  const plan = planWorkRecordRepair(ref, options);
  if (plan.status === 'failed' || plan.status === 'unsupported_profile') return plan;
  return buildWorkRecordGateRequestFromRepairPlan(plan, options);
}

function positiveApproval(response = {}) {
  const value = objectValue(response);
  const candidates = [
    value.authorization,
    value.decision,
    value.result,
    value.approved,
    value.approve,
  ];
  return candidates.some((candidate) => (
    candidate === true
      || text(candidate).toLowerCase() === 'approve'
      || text(candidate).toLowerCase() === 'approved'
      || text(candidate).toLowerCase() === 'yes'
  ));
}

function negativeApproval(response = {}) {
  const value = objectValue(response);
  const candidates = [
    value.authorization,
    value.decision,
    value.result,
    value.approved,
    value.approve,
  ];
  return candidates.some((candidate) => (
    candidate === false
      || text(candidate).toLowerCase() === 'deny'
      || text(candidate).toLowerCase() === 'denied'
      || text(candidate).toLowerCase() === 'no'
  ));
}

function expectedRequestId(plan = {}, workflowGateId = '') {
  const request = buildWorkRecordGateRequestFromRepairPlan(plan, { workflowGateId });
  return text(request.gate_request?.id);
}

function outcomeKind(outcome = {}) {
  if (text(outcome.schema_version) === TERMINAL_GATE_RECORD_SCHEMA_VERSION) return 'gate_record';
  if (text(outcome.schema_version) === TERMINAL_RESUME_EVENT_SCHEMA_VERSION) return 'resume_event';
  return 'unsupported';
}

function resultForStatus(status, outcome = {}) {
  if (status === 'authorized') return 'approved';
  if (status === 'denied') return 'denied';
  if (status === 'dismissed') return 'dismissed';
  if (status === 'timeout') return 'timeout';
  return null;
}

export function checkWorkRecordGateAuthorizationFromRepairPlan(plan = {}, outcome = {}, {
  workflowGateId = '',
} = {}) {
  const validation = validateWorkRecordRepairPlan(plan);
  if (validation.status !== 'passed') {
    return authorizationEnvelope({
      status: 'unsupported',
      sourceWorkRecord: objectValue(plan.source_work_record),
      diagnostics: validation.diagnostics,
      recommendedNext: { action: 'repair_plan_invalid' },
    });
  }
  const gate = requestGateSelection(plan, workflowGateId);
  if (!gate) return notRequired(plan, workflowGateId);

  const identity = repairPlanIdentity(plan);
  const expectedGateId = expectedRequestId(plan, gate.id);
  const kind = outcomeKind(outcome);
  if (kind === 'unsupported') {
    return authorizationEnvelope({
      status: 'unsupported',
      sourceWorkRecord: plan.source_work_record,
      repairPlan: { schema_version: text(plan.schema_version), digest: identity.digest, identity },
      workflowGate: gate,
      diagnostics: [{
        severity: 'error',
        code: 'UNSUPPORTED_GATE_OUTCOME',
        message: 'Gate authorization requires an aos.gate.record.v1 or aos.gate.resume-event.v1 terminal outcome.',
      }],
    });
  }

  const gateId = text(outcome.gate_id);
  const common = {
    sourceWorkRecord: plan.source_work_record,
    repairPlan: { schema_version: text(plan.schema_version), digest: identity.digest, identity },
    workflowGate: gate,
    gateRecord: kind === 'gate_record' ? outcome : null,
    resumeEvent: kind === 'resume_event' ? outcome : null,
  };
  if (gateId !== expectedGateId) {
    const possibleStale = gateId.startsWith('work-record-gate:') && gateId !== expectedGateId;
    return authorizationEnvelope({
      ...common,
      status: possibleStale ? 'stale' : 'mismatch',
      result: null,
      diagnostics: [{
        severity: 'error',
        code: possibleStale ? 'STALE_REPAIR_PLAN_GATE_ID' : 'GATE_ID_MISMATCH',
        message: `Terminal outcome gate_id ${gateId || '<missing>'} does not match expected repair-plan gate ${expectedGateId}.`,
        expected_gate_id: expectedGateId,
        actual_gate_id: gateId,
      }],
    });
  }

  const resolution = text(outcome.resolution);
  const status = text(outcome.status);
  if (resolution === 'dismissed' || status === 'dismissed') {
    return authorizationEnvelope({ ...common, status: 'dismissed', result: 'dismissed' });
  }
  if (resolution === 'timeout' || status === 'timeout') {
    return authorizationEnvelope({ ...common, status: 'timeout', result: 'timeout' });
  }
  if (resolution === 'error') {
    return authorizationEnvelope({
      ...common,
      status: 'denied',
      result: 'denied',
      diagnostics: [{
        severity: 'error',
        code: 'GATE_OUTCOME_ERROR',
        message: text(outcome.error_message, 'Gate outcome recorded an operational error.'),
      }],
    });
  }
  if (resolution !== 'answered') {
    return authorizationEnvelope({
      ...common,
      status: 'insufficient_evidence',
      result: null,
      diagnostics: [{
        severity: 'error',
        code: 'GATE_OUTCOME_NOT_TERMINAL_ANSWER',
        message: 'Gate outcome is not an answered, dismissed, timeout, or error terminal result.',
      }],
    });
  }
  if (outcome.response_stored !== true || !Object.hasOwn(outcome, 'response')) {
    return authorizationEnvelope({
      ...common,
      status: 'insufficient_evidence',
      result: null,
      diagnostics: [{
        severity: 'error',
        code: 'APPROVAL_RESPONSE_NOT_STORED',
        message: 'Answered gate outcome does not store an inspectable approval payload.',
      }],
      recommendedNext: {
        action: 'rerun_gate_with_response_storage',
        note: 'Use --store-response or metadata.record_response:true when submitting the gate response.',
      },
    });
  }
  if (positiveApproval(outcome.response)) {
    return authorizationEnvelope({ ...common, status: 'authorized', result: resultForStatus('authorized', outcome) });
  }
  if (negativeApproval(outcome.response)) {
    return authorizationEnvelope({ ...common, status: 'denied', result: resultForStatus('denied', outcome) });
  }
  return authorizationEnvelope({
    ...common,
    status: 'insufficient_evidence',
    result: null,
    diagnostics: [{
      severity: 'error',
      code: 'APPROVAL_RESPONSE_AMBIGUOUS',
      message: 'Stored answer payload does not contain an unambiguous affirmative or negative authorization.',
    }],
  });
}

export function checkWorkRecordGateAuthorization(ref, outcome, options = {}) {
  const plan = planWorkRecordRepair(ref, options);
  if (plan.status === 'failed' || plan.status === 'unsupported_profile') return plan;
  return checkWorkRecordGateAuthorizationFromRepairPlan(plan, outcome, options);
}
