import {
  createBrowserStepDescriptorPrototype,
  createBrowserStepDescriptorPrototypeWorkRecordOpenMessage,
  runBrowserStepDescriptorPrototype,
} from '../../workbench/browser-step-descriptor-prototype.js';
import { validateStepDescriptor } from '../../workbench/step-descriptor-harness.js';
import { stepDescriptorEvidenceMismatches } from '../../workbench/work-record-capture-helpers.js';
import {
  subjectContracts,
  subjectFacets,
} from '../../workbench/subject.js';
import {
  createWorkRecordWorkbenchState,
  openWorkRecord,
  workRecordWorkbenchSnapshot,
} from '../work-record-workbench/model.js';
import {
  STEP_DESCRIPTOR_WORKBENCH_SURFACE,
  STEP_DESCRIPTOR_WORKBENCH_MANIFEST,
  STEP_DESCRIPTOR_WORKBENCH_URL,
  stepDescriptorWorkbenchSemanticRefs,
} from './semantics.js';

export { STEP_DESCRIPTOR_WORKBENCH_SURFACE, STEP_DESCRIPTOR_WORKBENCH_MANIFEST, STEP_DESCRIPTOR_WORKBENCH_URL };

export const STEP_DESCRIPTOR_WORKBENCH_SCHEMA_VERSION = '2026-08-step-descriptor-workbench-v1';
export const STEP_DESCRIPTOR_WORKBENCH_WORK_RECORD_CANVAS_ID = 'step-descriptor-workbench-v1-work-record';
export const STEP_DESCRIPTOR_WORKBENCH_MESSAGE_TYPES = Object.freeze({
  load: 'step_descriptor_workbench.load',
  simulateRequested: 'step_descriptor_workbench.simulate.requested',
  simulateResult: 'step_descriptor_workbench.simulate.result',
  workRecordOpenRequested: 'step_descriptor_workbench.work_record.open.requested',
  workRecordOpenResult: 'step_descriptor_workbench.work_record.open.result',
});

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

function cloneJson(value) {
  if (value === undefined) return undefined;
  return JSON.parse(JSON.stringify(value));
}

function hasObject(value) {
  return Object.keys(objectValue(value)).length > 0;
}

function preparePrototype({ stepDescriptor = null, evidenceSource = null } = {}) {
  if (!hasObject(stepDescriptor) || !hasObject(evidenceSource)) {
    return {
      prototype: null,
      diagnostics: [{
        severity: 'error',
        code: 'step_descriptor_workbench_inputs_required',
        path: 'step_descriptor_workbench',
        message: 'A complete active Step Descriptor V1 and evidence source are required.',
      }],
    };
  }
  const diagnostics = [
    ...validateStepDescriptor(stepDescriptor),
    ...stepDescriptorEvidenceMismatches(stepDescriptor, evidenceSource).map((item) => ({
      severity: 'error',
      ...item,
    })),
  ];
  return {
    prototype: diagnostics.length === 0
      ? createBrowserStepDescriptorPrototype({ stepDescriptor, evidenceSource })
      : null,
    diagnostics,
  };
}

function summarizeStep(prototype = null) {
  const step = objectValue(prototype?.step_descriptor);
  const targetResolution = objectValue(step.target_resolution);
  return {
    id: text(step.id),
    label: rawText(step.label),
    workflow_ref: text(step.workflow_ref),
    target_dialect: text(step.target_dialect),
    target: rawText(targetResolution.target),
    target_with_ref: rawText(targetResolution.target_with_ref),
    ref: text(targetResolution.ref),
    semantic_ref: text(targetResolution.semantic_ref),
    action: {
      verb: text(objectValue(step.action).verb),
      target: rawText(objectValue(step.action).target),
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
  };
}

function summarizeWorkRecord(record = null) {
  const value = objectValue(record);
  const executionMap = objectValue(value.execution_map);
  const health = objectValue(value.health);
  return {
    id: text(value.id),
    label: rawText(value.label),
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
  };
}

export function stepDescriptorWorkbenchBoundarySummary() {
  return {
    fixture_backed: true,
    report_only: true,
    one_step_only: true,
    executes_actions: false,
    adds_public_cli_surface: false,
    second_work_record_viewer: false,
  };
}

export function stepDescriptorWorkbenchForbiddenControls(subject = {}) {
  const contracts = [
    ...subjectContracts(subject),
    ...subjectFacets(subject).flatMap((facet) => arrayValue(facet.contracts).map((contract) => text(contract))),
  ].join(' ');
  return {
    replay: /replay/i.test(contracts),
    repair: /repair/i.test(contracts),
    macro: /macro/i.test(contracts),
    background_loop: /background/i.test(contracts),
  };
}

export function createStepDescriptorWorkbenchState({
  stepDescriptor = null,
  evidenceSource = null,
  workRecordWorkbenchUrl = '',
  workRecordCanvasId = STEP_DESCRIPTOR_WORKBENCH_WORK_RECORD_CANVAS_ID,
} = {}) {
  const inputSupplied = hasObject(stepDescriptor) || hasObject(evidenceSource);
  const prepared = inputSupplied
    ? preparePrototype({ stepDescriptor, evidenceSource })
    : { prototype: null, diagnostics: [] };
  const { prototype } = prepared;
  return {
    type: 'step_descriptor_workbench.snapshot',
    schema_version: STEP_DESCRIPTOR_WORKBENCH_SCHEMA_VERSION,
    surface: STEP_DESCRIPTOR_WORKBENCH_SURFACE,
    url: STEP_DESCRIPTOR_WORKBENCH_URL,
    fixture_loaded: !!prototype,
    status: prototype ? 'ready' : inputSupplied ? 'rejected' : 'waiting_for_fixture',
    prototype,
    subject: prototype ? cloneJson(prototype.subject) : null,
    step_summary: summarizeStep(prototype),
    result: null,
    record: null,
    verifier: null,
    diagnostics: cloneJson(prepared.diagnostics),
    verifier_summary: summarizeVerifier(null),
    work_record_summary: summarizeWorkRecord(null),
    work_record_open_message: null,
    work_record_open: null,
    work_record_workbench_url: text(workRecordWorkbenchUrl, 'aos://toolkit/components/work-record-workbench/index.html'),
    work_record_canvas_id: text(workRecordCanvasId, STEP_DESCRIPTOR_WORKBENCH_WORK_RECORD_CANVAS_ID),
    semantic_refs: stepDescriptorWorkbenchSemanticRefs(),
    boundaries: stepDescriptorWorkbenchBoundarySummary(),
    forbidden_controls: stepDescriptorWorkbenchForbiddenControls(prototype?.subject),
    last_event: null,
    last_result: null,
  };
}

export function loadStepDescriptorWorkbenchFixture(state, {
  stepDescriptor = null,
  step_descriptor = stepDescriptor,
  evidenceSource = null,
  evidence_source = evidenceSource,
  workRecordWorkbenchUrl = '',
  work_record_workbench_url = workRecordWorkbenchUrl,
  workRecordCanvasId = '',
  work_record_canvas_id = workRecordCanvasId,
} = {}) {
  if (!state || typeof state !== 'object') throw new TypeError('step descriptor workbench state is required');
  if (!hasObject(step_descriptor) || !hasObject(evidence_source)) {
    throw new TypeError('step_descriptor and evidence_source are required');
  }
  const prepared = preparePrototype({ stepDescriptor: step_descriptor, evidenceSource: evidence_source });
  const { prototype } = prepared;
  if (!prototype) {
    Object.assign(state, {
      fixture_loaded: false,
      status: 'rejected',
      prototype: null,
      subject: null,
      step_summary: summarizeStep(null),
      result: null,
      record: null,
      verifier: null,
      diagnostics: cloneJson(prepared.diagnostics),
      verifier_summary: summarizeVerifier(null),
      work_record_summary: summarizeWorkRecord(null),
      work_record_open_message: null,
      work_record_open: null,
      forbidden_controls: stepDescriptorWorkbenchForbiddenControls({}),
    });
    state.last_event = {
      type: STEP_DESCRIPTOR_WORKBENCH_MESSAGE_TYPES.load,
      schema_version: STEP_DESCRIPTOR_WORKBENCH_SCHEMA_VERSION,
      step_descriptor_id: text(objectValue(step_descriptor).id) || null,
      evidence_source_id: text(objectValue(evidence_source).id) || null,
    };
    state.last_result = {
      ...state.last_event,
      status: 'rejected',
      diagnostics: cloneJson(prepared.diagnostics),
    };
    return state.last_result;
  }
  Object.assign(state, {
    fixture_loaded: true,
    status: 'ready',
    prototype,
    subject: cloneJson(prototype.subject),
    step_summary: summarizeStep(prototype),
    result: null,
    record: null,
    verifier: null,
    diagnostics: [],
    verifier_summary: summarizeVerifier(null),
    work_record_summary: summarizeWorkRecord(null),
    work_record_open_message: null,
    work_record_open: null,
    work_record_workbench_url: text(work_record_workbench_url, state.work_record_workbench_url),
    work_record_canvas_id: text(work_record_canvas_id, state.work_record_canvas_id),
    forbidden_controls: stepDescriptorWorkbenchForbiddenControls(prototype.subject),
  });
  state.last_event = {
    type: STEP_DESCRIPTOR_WORKBENCH_MESSAGE_TYPES.load,
    schema_version: STEP_DESCRIPTOR_WORKBENCH_SCHEMA_VERSION,
    step_descriptor_id: text(prototype.step_descriptor.id),
    evidence_source_id: text(prototype.evidence_source.id),
  };
  state.last_result = { ...state.last_event, status: 'loaded' };
  return state.last_result;
}

export function simulateStepDescriptorWorkbench(state) {
  if (!state || typeof state !== 'object') throw new TypeError('step descriptor workbench state is required');
  if (!hasObject(state.prototype)) {
    state.status = 'rejected';
    state.last_result = {
      type: STEP_DESCRIPTOR_WORKBENCH_MESSAGE_TYPES.simulateResult,
      schema_version: STEP_DESCRIPTOR_WORKBENCH_SCHEMA_VERSION,
      status: 'rejected',
      reason: 'fixture_required',
      record_id: null,
    };
    return state.last_result;
  }
  const result = runBrowserStepDescriptorPrototype(state.prototype);
  state.result = cloneJson(result);
  state.record = result.record ? cloneJson(result.record) : null;
  state.verifier = result.verifier ? cloneJson(result.verifier) : null;
  state.subject = result.subject ? cloneJson(result.subject) : state.subject;
  state.diagnostics = arrayValue(result.diagnostics).map((diagnostic) => cloneJson(diagnostic));
  state.verifier_summary = summarizeVerifier(result.verifier);
  state.work_record_summary = summarizeWorkRecord(result.record);
  state.work_record_open_message = result.workbench_open_message ? cloneJson(result.workbench_open_message) : null;
  state.status = result.status === 'passed' ? 'simulated' : 'rejected';
  state.forbidden_controls = stepDescriptorWorkbenchForbiddenControls(state.subject);
  state.last_result = {
    type: STEP_DESCRIPTOR_WORKBENCH_MESSAGE_TYPES.simulateResult,
    schema_version: STEP_DESCRIPTOR_WORKBENCH_SCHEMA_VERSION,
    status: result.status,
    reason: text(result.reason),
    record_id: text(result.record?.id) || null,
    verifier_status: text(result.verifier?.status) || null,
    diagnostics: state.diagnostics,
  };
  return state.last_result;
}

export function createStepDescriptorWorkbenchWorkRecordOpenMessage(state = {}) {
  if (state.work_record_open_message) return cloneJson(state.work_record_open_message);
  if (!hasObject(state.record)) throw new TypeError('simulated Work Record is required before opening');
  return createBrowserStepDescriptorPrototypeWorkRecordOpenMessage(state.record, { prototype: state.prototype });
}

export function openStepDescriptorWorkbenchWorkRecord(state, {
  canvasId = '',
  canvas_id = canvasId,
} = {}) {
  if (!state || typeof state !== 'object') throw new TypeError('step descriptor workbench state is required');
  const openMessage = createStepDescriptorWorkbenchWorkRecordOpenMessage(state);
  const workbenchState = createWorkRecordWorkbenchState();
  const opened = openWorkRecord(workbenchState, openMessage);
  const snapshot = workRecordWorkbenchSnapshot(workbenchState);
  const childCanvasId = text(canvas_id, state.work_record_canvas_id);
  state.work_record_open = {
    type: STEP_DESCRIPTOR_WORKBENCH_MESSAGE_TYPES.workRecordOpenResult,
    schema_version: STEP_DESCRIPTOR_WORKBENCH_SCHEMA_VERSION,
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
    type: STEP_DESCRIPTOR_WORKBENCH_MESSAGE_TYPES.workRecordOpenResult,
    schema_version: STEP_DESCRIPTOR_WORKBENCH_SCHEMA_VERSION,
    status: opened.status,
    record_id: text(opened.record_id),
    read_only: snapshot.diagnostics.read_only === true,
    work_record_canvas_id: childCanvasId,
  };
  return state.last_result;
}

export function stepDescriptorWorkbenchSnapshot(state = {}) {
  return {
    type: 'step_descriptor_workbench.snapshot',
    schema_version: STEP_DESCRIPTOR_WORKBENCH_SCHEMA_VERSION,
    surface: STEP_DESCRIPTOR_WORKBENCH_SURFACE,
    url: STEP_DESCRIPTOR_WORKBENCH_URL,
    fixture_loaded: !!state.fixture_loaded,
    status: text(state.status, 'unknown'),
    subject: state.subject ? cloneJson(state.subject) : null,
    step_summary: cloneJson(state.step_summary || {}),
    verifier_summary: cloneJson(state.verifier_summary || summarizeVerifier(state.verifier)),
    work_record_summary: cloneJson(state.work_record_summary || summarizeWorkRecord(state.record)),
    diagnostics: arrayValue(state.diagnostics).map((diagnostic) => cloneJson(diagnostic)),
    work_record_open: state.work_record_open ? cloneJson(state.work_record_open) : null,
    work_record_canvas_id: text(state.work_record_canvas_id, STEP_DESCRIPTOR_WORKBENCH_WORK_RECORD_CANVAS_ID),
    work_record_workbench_url: text(state.work_record_workbench_url),
    semantic_refs: cloneJson(state.semantic_refs || stepDescriptorWorkbenchSemanticRefs()),
    boundaries: cloneJson(state.boundaries || stepDescriptorWorkbenchBoundarySummary()),
    forbidden_controls: cloneJson(state.forbidden_controls || stepDescriptorWorkbenchForbiddenControls(state.subject)),
    last_event: state.last_event ? cloneJson(state.last_event) : null,
    last_result: state.last_result ? cloneJson(state.last_result) : null,
  };
}
