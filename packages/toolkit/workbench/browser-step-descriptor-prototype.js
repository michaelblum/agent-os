import { createWorkbenchSubject } from './subject.js';
import { runOneStepStepDescriptorHarness } from './step-descriptor-harness.js';
import { WORK_RECORD_REPORT_ONLY_PROFILE_ID } from './work-record-verifier.js';

export const BROWSER_STEP_DESCRIPTOR_PROTOTYPE_VERSION = '2026-05-browser-step-descriptor-prototype-v0';
export const BROWSER_CLICK_STATUS_PROTOTYPE_ID = 'step-descriptor-prototype:browser-click-status';
export const STEP_DESCRIPTOR_WORKBENCH_URL = 'aos://toolkit/components/step-descriptor-workbench/index.html';

const DEFAULT_OWNER = 'aos-step-descriptor-prototype';

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

function requireObject(value, label) {
  const normalized = objectValue(value);
  if (Object.keys(normalized).length === 0) {
    throw new TypeError(`${label} is required`);
  }
  return normalized;
}

function uniqueStrings(values = []) {
  const seen = new Set();
  const result = [];
  for (const value of values.map((item) => text(item)).filter(Boolean)) {
    if (!seen.has(value)) {
      seen.add(value);
      result.push(value);
    }
  }
  return result;
}

function prototypeLabel({ label, stepDescriptor, id }) {
  return text(
    label,
    text(stepDescriptor.label, `Browser Step Descriptor prototype: ${text(stepDescriptor.id, id)}`),
  );
}

function prototypeGateRefs(stepDescriptor = {}) {
  return uniqueStrings(arrayValue(objectValue(stepDescriptor.workflow_gates).gate_refs));
}

function prototypeArtifacts({ stepDescriptor, evidenceSource, record = null }) {
  const artifacts = [
    {
      id: 'artifact:browser-step-descriptor-descriptor',
      kind: 'aos.step_descriptor',
      label: 'Step Descriptor',
      ref: text(stepDescriptor.id),
      immutable: true,
    },
    {
      id: 'artifact:browser-step-descriptor-saved-action-evidence',
      kind: 'aos.action_evidence',
      label: 'Saved browser see/do/see evidence',
      ref: text(evidenceSource.id),
      immutable: true,
    },
  ];

  if (record) {
    artifacts.push({
      id: 'artifact:browser-step-descriptor-work-record',
      kind: 'aos.work_record',
      label: 'Emitted Workflow-origin Work Record v0',
      ref: text(record.id),
      immutable: true,
      read_only: true,
    });
  }

  return artifacts;
}

function stepDescriptorWorkbenchHost(preferred = false, facet = '') {
  return {
    kind: 'canvas',
    target_dialect: 'canvas',
    entry: {
      kind: 'aos-url',
      value: STEP_DESCRIPTOR_WORKBENCH_URL,
      ...(facet ? { facet } : {}),
    },
    browser_compatible: true,
    ...(preferred ? { preferred: true } : {}),
  };
}

function prototypeFacets({ recordId = '' } = {}) {
  return [
    {
      key: 'step-descriptor-descriptor',
      layer: 'descriptor',
      label: 'Step Descriptor',
      capabilities: ['inspectable'],
      contracts: ['step_descriptor.inspect'],
      hosts: [stepDescriptorWorkbenchHost(true, 'descriptor')],
    },
    {
      key: 'step-descriptor-simulate-controls',
      layer: 'controls',
      label: 'Simulation Controls',
      capabilities: ['verifier-target'],
      contracts: ['step_descriptor.simulate.once'],
      hosts: [stepDescriptorWorkbenchHost(false, 'simulate')],
    },
    {
      key: 'harness-result',
      layer: 'artifacts',
      label: 'Harness Result',
      capabilities: ['inspectable', 'verifier-target'],
      contracts: ['step_descriptor.harness_result.view'],
      hosts: [stepDescriptorWorkbenchHost(false, 'harness-result')],
    },
    {
      key: 'work-record-summary',
      layer: 'artifacts',
      label: 'Work Record Summary',
      capabilities: ['inspectable', 'exportable'],
      contracts: [
        'work_record.open.read_only',
        ...(recordId ? ['work_record.summary.view'] : []),
      ],
      hosts: [stepDescriptorWorkbenchHost(false, 'work-record-summary')],
    },
    {
      key: 'work-record-verifier-report',
      layer: 'health',
      label: 'Verifier Report',
      capabilities: ['verifier-target'],
      contracts: ['work_record.verifier_report.view'],
      hosts: [stepDescriptorWorkbenchHost(false, 'verifier-report')],
    },
  ];
}

export function createBrowserStepDescriptorPrototypeSubject({
  id = BROWSER_CLICK_STATUS_PROTOTYPE_ID,
  label = '',
  stepDescriptor = {},
  evidenceSource = {},
  harnessResult = null,
  workflowGateRef = '',
} = {}) {
  const step = objectValue(stepDescriptor);
  const evidence = objectValue(evidenceSource);
  const gateRefs = prototypeGateRefs(step);
  const targetResolution = objectValue(step.target_resolution);
  const record = objectValue(objectValue(harnessResult).record);
  const verifier = objectValue(objectValue(harnessResult).verifier);
  const recordId = text(record.id);
  const verifierProfileId = text(
    verifier.profile_id || objectValue(objectValue(record.verifier_report).verifier).id,
    WORK_RECORD_REPORT_ONLY_PROFILE_ID,
  );

  return createWorkbenchSubject({
    id,
    type: 'aos.step_descriptor_prototype',
    label: prototypeLabel({ label, stepDescriptor: step, id }),
    owner: DEFAULT_OWNER,
    source: {
      kind: 'browser_step_descriptor_prototype',
      format: 'one-step-report-only-v0',
      workflow_ref: text(step.workflow_ref),
      step_descriptor_id: text(step.id),
      evidence_source_id: text(evidence.id),
      harness_api: 'runOneStepStepDescriptorHarness',
    },
    capabilities: [
      'inspectable',
      'verifier-target',
      'exportable',
    ],
    contracts: [
      'step_descriptor.inspect',
      'step_descriptor.simulate.once',
      'step_descriptor.harness_result.view',
      'work_record.open.read_only',
      ...(recordId ? ['work_record.summary.view'] : []),
      'work_record.verifier_report.view',
    ],
    facets: prototypeFacets({ recordId }),
    persistence: null,
    artifacts: prototypeArtifacts({
      stepDescriptor: step,
      evidenceSource: evidence,
      record: recordId ? record : null,
    }),
    state: {
      target_dialect: text(step.target_dialect),
      target: text(targetResolution.target),
      target_with_ref: text(targetResolution.target_with_ref),
      one_step_only: true,
      mode: 'simulate',
      explicit_workflow_gate_required: true,
      workflow_gate_ref: text(workflowGateRef, gateRefs[0] || null),
      workflow_gate_refs: gateRefs,
      report_only: true,
      autonomous_replay_allowed: false,
      autonomous_repair_allowed: false,
      macro_playback_allowed: false,
      background_loop_allowed: false,
      broad_cli_surface_added: false,
      record_id: recordId || null,
      verifier_profile_id: verifierProfileId,
      verifier_status: text(verifier.status) || null,
      workbench_open: recordId ? {
        message_type: 'work_record.open',
        read_only: true,
      } : null,
    },
    metadata: {
      schema_version: BROWSER_STEP_DESCRIPTOR_PROTOTYPE_VERSION,
      prototype_boundary: 'browser-compatible saved-evidence bridge',
      is_wiki_subject_browser: false,
      is_general_step_descriptor_ui: false,
      adds_public_cli_surface: false,
      emits_work_record_v0: !!recordId,
      verifier_profile_id: verifierProfileId,
      evidence_source_shape: text(evidence.type),
    },
  });
}

export function createBrowserStepDescriptorPrototype({
  id = BROWSER_CLICK_STATUS_PROTOTYPE_ID,
  label = '',
  stepDescriptor,
  evidenceSource,
  workflowGateRef = '',
} = {}) {
  const step = requireObject(stepDescriptor, 'stepDescriptor');
  const evidence = requireObject(evidenceSource, 'evidenceSource');

  return {
    type: 'aos.browser_step_descriptor_prototype',
    schema_version: BROWSER_STEP_DESCRIPTOR_PROTOTYPE_VERSION,
    id: text(id, BROWSER_CLICK_STATUS_PROTOTYPE_ID),
    label: prototypeLabel({ label, stepDescriptor: step, id }),
    step_descriptor: cloneJson(step),
    evidence_source: cloneJson(evidence),
    subject: createBrowserStepDescriptorPrototypeSubject({
      id,
      label,
      stepDescriptor: step,
      evidenceSource: evidence,
      workflowGateRef,
    }),
    run_policy: {
      mode: 'simulate',
      one_step_only: true,
      explicit_workflow_gate_required: true,
      workflow_gate_refs: prototypeGateRefs(step),
      verifier_profile_id: WORK_RECORD_REPORT_ONLY_PROFILE_ID,
      replay_requires_workflow_gate: true,
      repair_requires_workflow_gate: true,
      autonomous_replay_allowed: false,
      autonomous_repair_allowed: false,
      macro_playback_allowed: false,
      background_loop_allowed: false,
    },
    non_goals: [
      'wiki_subject_browser',
      'general_step_descriptor_ui',
      'public_cli_surface',
      'autonomous_replay',
      'autonomous_repair',
      'macro_playback',
      'background_loop',
    ],
  };
}

export function createBrowserStepDescriptorPrototypeWorkRecordOpenMessage(record = {}, {
  prototype = {},
} = {}) {
  const value = requireObject(record, 'record');
  const step = objectValue(prototype.step_descriptor);

  return {
    type: 'work_record.open',
    source: {
      kind: 'browser_step_descriptor_prototype',
      path: null,
      prototype_id: text(prototype.id),
      workflow_ref: text(step.workflow_ref || objectValue(value.origin).ref),
      step_descriptor_id: text(step.id || objectValue(value.metadata).step_descriptor_id),
      read_only: true,
    },
    record: cloneJson(value),
  };
}

export function runBrowserStepDescriptorPrototype(prototype = {}, {
  workflowGate = null,
  verifierProfileId = WORK_RECORD_REPORT_ONLY_PROFILE_ID,
} = {}) {
  const value = requireObject(prototype, 'prototype');
  const step = requireObject(value.step_descriptor, 'prototype.step_descriptor');
  const evidence = requireObject(value.evidence_source, 'prototype.evidence_source');

  const harness = runOneStepStepDescriptorHarness(step, {
    workflowGate,
    mode: 'simulate',
    evidenceSource: evidence,
    verifierProfileId,
  });
  const record = harness.record ? cloneJson(harness.record) : null;
  const subject = createBrowserStepDescriptorPrototypeSubject({
    id: text(value.id, BROWSER_CLICK_STATUS_PROTOTYPE_ID),
    label: text(value.label),
    stepDescriptor: step,
    evidenceSource: evidence,
    harnessResult: harness,
    workflowGateRef: text(harness.workflow_gate_ref),
  });

  return {
    type: 'aos.browser_step_descriptor_prototype.result',
    schema_version: BROWSER_STEP_DESCRIPTOR_PROTOTYPE_VERSION,
    status: text(harness.status, 'rejected'),
    reason: text(harness.reason),
    mode: 'simulate',
    prototype_id: text(value.id, BROWSER_CLICK_STATUS_PROTOTYPE_ID),
    subject,
    harness: cloneJson(harness),
    record,
    verifier: harness.verifier ? cloneJson(harness.verifier) : null,
    workbench_open_message: record
      ? createBrowserStepDescriptorPrototypeWorkRecordOpenMessage(record, { prototype: value })
      : null,
    diagnostics: arrayValue(harness.diagnostics).map((diagnostic) => cloneJson(diagnostic)),
  };
}
