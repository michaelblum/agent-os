import {
  createBrowserPlaybookPrototype,
  createBrowserPlaybookPrototypeWorkRecordOpenMessage,
  runBrowserPlaybookPrototype,
} from '../../workbench/browser-playbook-prototype.js';
import {
  subjectContracts,
  subjectFacets,
} from '../../workbench/subject.js';
import {
  checkPlaybookHarnessGate,
  normalizePlaybookHarnessGate,
} from '../../workbench/playbook-step-harness.js';
import {
  createWorkRecordWorkbenchState,
  openWorkRecord,
  workRecordWorkbenchSnapshot,
} from '../work-record-workbench/model.js';
import {
  PLAYBOOK_WORKBENCH_SURFACE,
  PLAYBOOK_WORKBENCH_URL,
  playbookWorkbenchSemanticRefs,
} from './semantics.js';

export { PLAYBOOK_WORKBENCH_SURFACE, PLAYBOOK_WORKBENCH_URL };

export const PLAYBOOK_WORKBENCH_SCHEMA_VERSION = '2026-05-06-playbook-workbench-v0';
export const PLAYBOOK_WORKBENCH_WORK_RECORD_CANVAS_ID = 'playbook-workbench-v0-work-record';
export const PLAYBOOK_WORKBENCH_MESSAGE_TYPES = Object.freeze({
  load: 'playbook_workbench.load',
  workflowGateSet: 'playbook_workbench.workflow_gate.set',
  simulateRequested: 'playbook_workbench.simulate.requested',
  simulateResult: 'playbook_workbench.simulate.result',
  workRecordOpenRequested: 'playbook_workbench.work_record.open.requested',
  workRecordOpenResult: 'playbook_workbench.work_record.open.result',
});

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

function hasObject(value) {
  return Object.keys(objectValue(value)).length > 0;
}

function gateRefsFromPrototype(prototype = {}) {
  return arrayValue(objectValue(prototype.run_policy).workflow_gate_refs)
    .map((ref) => text(ref))
    .filter(Boolean);
}

function prototypeFromInputs({
  playbookStep = null,
  evidenceSource = null,
  workflowGateRef = '',
} = {}) {
  if (!hasObject(playbookStep) || !hasObject(evidenceSource)) return null;
  return createBrowserPlaybookPrototype({
    playbookStep,
    evidenceSource,
    workflowGateRef,
  });
}

function summarizeStep(prototype = null) {
  const step = objectValue(prototype?.playbook_step);
  const targetResolution = objectValue(step.target_resolution);
  return {
    id: text(step.id),
    label: text(step.label),
    playbook_ref: text(step.playbook_ref),
    target_dialect: text(step.target_dialect),
    target: text(targetResolution.target),
    target_with_ref: text(targetResolution.target_with_ref),
    ref: text(targetResolution.ref),
    semantic_ref: text(targetResolution.semantic_ref),
    action: {
      verb: text(objectValue(step.action).verb),
      target: text(objectValue(step.action).target),
    },
    precondition_count: arrayValue(step.preconditions).length,
    postcondition_count: arrayValue(step.postconditions).length,
    claim_promotion_count: arrayValue(step.claim_promotions).length,
    repair_hint_count: arrayValue(step.repair_hints).length,
  };
}

function summarizeVerifier(verifier = null) {
  const value = objectValue(verifier);
  const summary = objectValue(value.summary);
  return {
    status: text(value.status),
    profile_id: text(value.profile_id || objectValue(value.profile).id),
    mutates_record: value.mutates_record === true,
    diagnostics: arrayValue(value.diagnostics).length,
    claims: Number.isFinite(summary.claims) ? summary.claims : 0,
    evidence: Number.isFinite(summary.evidence) ? summary.evidence : 0,
    postconditions: Number.isFinite(summary.postconditions) ? summary.postconditions : 0,
    replay_gated: summary.replay_gated === true,
    repair_gated: summary.repair_gated === true,
  };
}

function summarizeWorkRecord(record = null) {
  const value = objectValue(record);
  const executionMap = objectValue(value.execution_map);
  const replayPolicy = objectValue(executionMap.replay_policy);
  const health = objectValue(value.health);
  return {
    id: text(value.id),
    label: text(value.label),
    origin_kind: text(objectValue(value.origin).kind),
    origin_ref: text(objectValue(value.origin).ref),
    run_id: text(objectValue(value.origin).run_id),
    health_verdict: text(health.verdict || health.state),
    health_reason: text(health.reason),
    steps: arrayValue(executionMap.steps).length,
    claims: arrayValue(value.claims).length,
    claim_results: arrayValue(value.claim_results).length,
    evidence: arrayValue(value.evidence).length,
    postconditions: arrayValue(executionMap.postconditions).length,
    verifier_report_id: text(objectValue(value.verifier_report).id),
    replay_policy: {
      mode: text(replayPolicy.mode),
      replay_requires_workflow_gate: replayPolicy.replay_requires_workflow_gate === true,
      repair_requires_workflow_gate: replayPolicy.repair_requires_workflow_gate === true,
      gate_refs: arrayValue(replayPolicy.gate_refs).map((ref) => text(ref)).filter(Boolean),
    },
  };
}

export function playbookWorkbenchBoundarySummary() {
  return {
    fixture_backed: true,
    report_only: true,
    one_step_only: true,
    live_browser_execution_allowed: false,
    autonomous_replay_allowed: false,
    autonomous_repair_allowed: false,
    macro_playback_allowed: false,
    background_loop_allowed: false,
    public_cli_surface_added: false,
    second_work_record_viewer: false,
  };
}

export function playbookWorkbenchForbiddenControls(subject = {}) {
  const contracts = [
    ...subjectContracts(subject),
    ...subjectFacets(subject).flatMap((facet) => arrayValue(facet.contracts).map((contract) => text(contract))),
  ].join(' ');
  const textSurface = contracts;
  return {
    replay: /replay/i.test(textSurface),
    repair: /repair/i.test(textSurface),
    macro: /macro/i.test(textSurface),
    background_loop: /background/i.test(textSurface),
  };
}

export function playbookWorkbenchGateStatus(state = {}) {
  const prototype = objectValue(state.prototype);
  if (!hasObject(prototype)) {
    return {
      status: 'waiting_for_fixture',
      reason: 'fixture_required',
      ref: '',
      token_present: false,
      allowed_gate_refs: [],
    };
  }

  const gate = normalizePlaybookHarnessGate(state.workflow_gate);
  const check = checkPlaybookHarnessGate(prototype.playbook_step, gate);
  if (check.ok) {
    return {
      status: 'ready',
      reason: 'workflow_gate_accepted',
      ref: text(check.gate.ref),
      token_present: true,
      allowed_gate_refs: gateRefsFromPrototype(prototype),
    };
  }

  return {
    status: 'blocked',
    reason: text(check.diagnostic?.code, 'workflow_gate_required'),
    ref: text(gate.ref),
    token_present: !!text(gate.token),
    allowed_gate_refs: gateRefsFromPrototype(prototype),
    diagnostic: cloneJson(check.diagnostic),
  };
}

export function createPlaybookWorkbenchState({
  playbookStep = null,
  evidenceSource = null,
  workflowGate = null,
  workflowGateRef = '',
  workRecordWorkbenchUrl = '',
  workRecordCanvasId = PLAYBOOK_WORKBENCH_WORK_RECORD_CANVAS_ID,
} = {}) {
  const gate = normalizePlaybookHarnessGate(workflowGate);
  if (!gate.ref && workflowGateRef) gate.ref = text(workflowGateRef);
  const prototype = prototypeFromInputs({
    playbookStep,
    evidenceSource,
    workflowGateRef: text(gate.ref),
  });
  const state = {
    type: 'playbook_workbench.snapshot',
    schema_version: PLAYBOOK_WORKBENCH_SCHEMA_VERSION,
    surface: PLAYBOOK_WORKBENCH_SURFACE,
    url: PLAYBOOK_WORKBENCH_URL,
    fixture_loaded: !!prototype,
    status: prototype ? 'ready' : 'waiting_for_fixture',
    prototype,
    subject: prototype ? cloneJson(prototype.subject) : null,
    step_summary: summarizeStep(prototype),
    workflow_gate: gate,
    gate_status: null,
    result: null,
    record: null,
    verifier: null,
    diagnostics: [],
    verifier_summary: summarizeVerifier(null),
    work_record_summary: summarizeWorkRecord(null),
    work_record_open_message: null,
    work_record_open: null,
    work_record_workbench_url: text(
      workRecordWorkbenchUrl,
      'aos://toolkit/components/work-record-workbench/index.html',
    ),
    work_record_canvas_id: text(workRecordCanvasId, PLAYBOOK_WORKBENCH_WORK_RECORD_CANVAS_ID),
    semantic_refs: playbookWorkbenchSemanticRefs(),
    boundaries: playbookWorkbenchBoundarySummary(),
    forbidden_controls: playbookWorkbenchForbiddenControls(prototype?.subject),
    last_event: null,
    last_result: null,
  };
  state.gate_status = playbookWorkbenchGateStatus(state);
  return state;
}

export function loadPlaybookWorkbenchFixture(state, {
  playbookStep = null,
  playbook_step = playbookStep,
  evidenceSource = null,
  evidence_source = evidenceSource,
  workflowGate = null,
  workflow_gate = workflowGate,
  workflowGateRef = '',
  workflow_gate_ref = workflowGateRef,
  workRecordWorkbenchUrl = '',
  work_record_workbench_url = workRecordWorkbenchUrl,
  workRecordCanvasId = '',
  work_record_canvas_id = workRecordCanvasId,
} = {}) {
  if (!state || typeof state !== 'object') {
    throw new TypeError('playbook workbench state is required');
  }
  const gate = normalizePlaybookHarnessGate(workflow_gate);
  if (!gate.ref && workflow_gate_ref) gate.ref = text(workflow_gate_ref);
  const prototype = prototypeFromInputs({
    playbookStep: playbook_step,
    evidenceSource: evidence_source,
    workflowGateRef: text(gate.ref),
  });
  if (!prototype) {
    throw new TypeError('playbook_step and evidence_source are required');
  }

  state.fixture_loaded = true;
  state.status = 'ready';
  state.prototype = prototype;
  state.subject = cloneJson(prototype.subject);
  state.step_summary = summarizeStep(prototype);
  state.workflow_gate = gate;
  state.gate_status = playbookWorkbenchGateStatus(state);
  state.result = null;
  state.record = null;
  state.verifier = null;
  state.diagnostics = [];
  state.verifier_summary = summarizeVerifier(null);
  state.work_record_summary = summarizeWorkRecord(null);
  state.work_record_open_message = null;
  state.work_record_open = null;
  state.work_record_workbench_url = text(
    work_record_workbench_url,
    state.work_record_workbench_url,
  );
  state.work_record_canvas_id = text(work_record_canvas_id, state.work_record_canvas_id);
  state.forbidden_controls = playbookWorkbenchForbiddenControls(state.subject);
  state.last_event = {
    type: PLAYBOOK_WORKBENCH_MESSAGE_TYPES.load,
    schema_version: PLAYBOOK_WORKBENCH_SCHEMA_VERSION,
    playbook_step_id: text(prototype.playbook_step.id),
    evidence_source_id: text(prototype.evidence_source.id),
  };
  state.last_result = {
    type: PLAYBOOK_WORKBENCH_MESSAGE_TYPES.load,
    schema_version: PLAYBOOK_WORKBENCH_SCHEMA_VERSION,
    status: 'loaded',
    playbook_step_id: text(prototype.playbook_step.id),
    evidence_source_id: text(prototype.evidence_source.id),
  };
  return state.last_result;
}

export function setPlaybookWorkbenchWorkflowGate(state, gate = null) {
  if (!state || typeof state !== 'object') {
    throw new TypeError('playbook workbench state is required');
  }
  state.workflow_gate = normalizePlaybookHarnessGate(gate);
  state.gate_status = playbookWorkbenchGateStatus(state);
  state.last_event = {
    type: PLAYBOOK_WORKBENCH_MESSAGE_TYPES.workflowGateSet,
    schema_version: PLAYBOOK_WORKBENCH_SCHEMA_VERSION,
    ref: text(state.workflow_gate.ref),
    token_present: !!text(state.workflow_gate.token),
  };
  state.last_result = {
    type: PLAYBOOK_WORKBENCH_MESSAGE_TYPES.workflowGateSet,
    schema_version: PLAYBOOK_WORKBENCH_SCHEMA_VERSION,
    status: state.gate_status.status,
    reason: state.gate_status.reason,
    ref: state.gate_status.ref,
    token_present: state.gate_status.token_present,
  };
  return state.last_result;
}

export function simulatePlaybookWorkbench(state, {
  workflowGate = null,
  workflow_gate = workflowGate,
} = {}) {
  if (!state || typeof state !== 'object') {
    throw new TypeError('playbook workbench state is required');
  }
  if (!hasObject(state.prototype)) {
    state.status = 'rejected';
    state.last_result = {
      type: PLAYBOOK_WORKBENCH_MESSAGE_TYPES.simulateResult,
      schema_version: PLAYBOOK_WORKBENCH_SCHEMA_VERSION,
      status: 'rejected',
      reason: 'fixture_required',
      record_id: null,
    };
    return state.last_result;
  }
  if (workflow_gate !== null && workflow_gate !== undefined) {
    setPlaybookWorkbenchWorkflowGate(state, workflow_gate);
  }

  const result = runBrowserPlaybookPrototype(state.prototype, {
    workflowGate: state.workflow_gate,
  });
  state.result = cloneJson(result);
  state.record = result.record ? cloneJson(result.record) : null;
  state.verifier = result.verifier ? cloneJson(result.verifier) : null;
  state.subject = result.subject ? cloneJson(result.subject) : state.subject;
  state.diagnostics = arrayValue(result.diagnostics).map((diagnostic) => cloneJson(diagnostic));
  state.verifier_summary = summarizeVerifier(result.verifier);
  state.work_record_summary = summarizeWorkRecord(result.record);
  state.work_record_open_message = result.workbench_open_message
    ? cloneJson(result.workbench_open_message)
    : null;
  state.gate_status = playbookWorkbenchGateStatus(state);
  state.status = result.status === 'passed' ? 'simulated' : 'rejected';
  state.forbidden_controls = playbookWorkbenchForbiddenControls(state.subject);
  state.last_result = {
    type: PLAYBOOK_WORKBENCH_MESSAGE_TYPES.simulateResult,
    schema_version: PLAYBOOK_WORKBENCH_SCHEMA_VERSION,
    status: result.status,
    reason: text(result.reason),
    record_id: text(result.record?.id) || null,
    verifier_status: text(result.verifier?.status) || null,
    workflow_gate_ref: text(result.harness?.workflow_gate_ref) || null,
    diagnostics: state.diagnostics,
  };
  return state.last_result;
}

export function createPlaybookWorkbenchWorkRecordOpenMessage(state = {}) {
  if (state.work_record_open_message) return cloneJson(state.work_record_open_message);
  if (!hasObject(state.record)) {
    throw new TypeError('simulated Work Record is required before opening');
  }
  return createBrowserPlaybookPrototypeWorkRecordOpenMessage(state.record, {
    prototype: state.prototype,
  });
}

export function openPlaybookWorkbenchWorkRecord(state, {
  canvasId = '',
  canvas_id = canvasId,
} = {}) {
  if (!state || typeof state !== 'object') {
    throw new TypeError('playbook workbench state is required');
  }
  const openMessage = createPlaybookWorkbenchWorkRecordOpenMessage(state);
  const workbenchState = createWorkRecordWorkbenchState();
  const opened = openWorkRecord(workbenchState, openMessage);
  const snapshot = workRecordWorkbenchSnapshot(workbenchState);
  const childCanvasId = text(canvas_id, state.work_record_canvas_id);
  state.work_record_open = {
    type: PLAYBOOK_WORKBENCH_MESSAGE_TYPES.workRecordOpenResult,
    schema_version: PLAYBOOK_WORKBENCH_SCHEMA_VERSION,
    status: opened.status,
    record_id: text(opened.record_id),
    source: cloneJson(opened.source),
    read_only: snapshot.diagnostics.read_only === true,
    work_record_surface: 'work-record-workbench',
    work_record_canvas_id: childCanvasId,
    open_message: cloneJson(openMessage),
    workbench_snapshot: snapshot,
  };
  state.last_result = {
    type: PLAYBOOK_WORKBENCH_MESSAGE_TYPES.workRecordOpenResult,
    schema_version: PLAYBOOK_WORKBENCH_SCHEMA_VERSION,
    status: opened.status,
    record_id: text(opened.record_id),
    read_only: snapshot.diagnostics.read_only === true,
    work_record_canvas_id: childCanvasId,
  };
  return state.last_result;
}

export function playbookWorkbenchSnapshot(state = {}) {
  return {
    type: 'playbook_workbench.snapshot',
    schema_version: PLAYBOOK_WORKBENCH_SCHEMA_VERSION,
    surface: PLAYBOOK_WORKBENCH_SURFACE,
    url: PLAYBOOK_WORKBENCH_URL,
    fixture_loaded: !!state.fixture_loaded,
    status: text(state.status, 'unknown'),
    subject: state.subject ? cloneJson(state.subject) : null,
    step_summary: cloneJson(state.step_summary || {}),
    gate_status: cloneJson(state.gate_status || playbookWorkbenchGateStatus(state)),
    verifier_summary: cloneJson(state.verifier_summary || summarizeVerifier(state.verifier)),
    work_record_summary: cloneJson(state.work_record_summary || summarizeWorkRecord(state.record)),
    diagnostics: arrayValue(state.diagnostics).map((diagnostic) => cloneJson(diagnostic)),
    work_record_open: state.work_record_open ? cloneJson(state.work_record_open) : null,
    work_record_canvas_id: text(
      state.work_record_canvas_id,
      PLAYBOOK_WORKBENCH_WORK_RECORD_CANVAS_ID,
    ),
    work_record_workbench_url: text(state.work_record_workbench_url),
    semantic_refs: cloneJson(state.semantic_refs || playbookWorkbenchSemanticRefs()),
    boundaries: cloneJson(state.boundaries || playbookWorkbenchBoundarySummary()),
    forbidden_controls: cloneJson(
      state.forbidden_controls || playbookWorkbenchForbiddenControls(state.subject),
    ),
    last_event: state.last_event ? cloneJson(state.last_event) : null,
    last_result: state.last_result ? cloneJson(state.last_result) : null,
  };
}
