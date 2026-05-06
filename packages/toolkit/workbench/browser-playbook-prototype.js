import { createWorkbenchSubject } from './subject.js';
import { runOneStepPlaybookHarness } from './playbook-step-harness.js';
import { WORK_RECORD_REPORT_ONLY_PROFILE_ID } from './work-record-verifier.js';

export const BROWSER_PLAYBOOK_PROTOTYPE_VERSION = '2026-05-browser-playbook-prototype-v0';
export const BROWSER_CLICK_STATUS_PROTOTYPE_ID = 'playbook-prototype:browser-click-status';

const DEFAULT_OWNER = 'aos-playbook-prototype';

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

function prototypeLabel({ label, playbookStep, id }) {
  return text(
    label,
    text(playbookStep.label, `Browser Playbook prototype: ${text(playbookStep.id, id)}`),
  );
}

function prototypeGateRefs(playbookStep = {}) {
  return uniqueStrings(arrayValue(objectValue(playbookStep.workflow_gates).gate_refs));
}

function prototypeArtifacts({ playbookStep, evidenceSource, record = null }) {
  const artifacts = [
    {
      id: 'artifact:browser-playbook-step-descriptor',
      kind: 'aos.playbook_step',
      label: 'Playbook step descriptor',
      ref: text(playbookStep.id),
      immutable: true,
    },
    {
      id: 'artifact:browser-playbook-saved-action-evidence',
      kind: 'aos.action_evidence',
      label: 'Saved browser see/do/see evidence',
      ref: text(evidenceSource.id),
      immutable: true,
    },
  ];

  if (record) {
    artifacts.push({
      id: 'artifact:browser-playbook-work-record',
      kind: 'aos.work_record',
      label: 'Emitted Playbook-origin Work Record v0',
      ref: text(record.id),
      immutable: true,
      read_only: true,
    });
  }

  return artifacts;
}

export function createBrowserPlaybookPrototypeSubject({
  id = BROWSER_CLICK_STATUS_PROTOTYPE_ID,
  label = '',
  playbookStep = {},
  evidenceSource = {},
  harnessResult = null,
  workflowGateRef = '',
} = {}) {
  const step = objectValue(playbookStep);
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
    type: 'aos.playbook_prototype',
    label: prototypeLabel({ label, playbookStep: step, id }),
    owner: DEFAULT_OWNER,
    source: {
      kind: 'browser_playbook_prototype',
      format: 'one-step-report-only-v0',
      playbook_ref: text(step.playbook_ref),
      playbook_step_id: text(step.id),
      evidence_source_id: text(evidence.id),
      harness_api: 'runOneStepPlaybookHarness',
    },
    capabilities: [
      'inspectable',
      'verifier-target',
      'browser-compatible',
      'playbook_step.simulate.once',
      'work_record.open.read_only',
    ],
    views: [
      'playbook_step.descriptor',
      'playbook_step.harness_result',
      'work_record.summary',
      'work_record.verifier_report',
    ],
    controls: [
      'playbook_step.simulate_once',
    ],
    persistence: null,
    artifacts: prototypeArtifacts({
      playbookStep: step,
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
      schema_version: BROWSER_PLAYBOOK_PROTOTYPE_VERSION,
      prototype_boundary: 'browser-compatible saved-evidence bridge',
      is_wiki_subject_browser: false,
      is_general_playbook_ui: false,
      adds_public_cli_surface: false,
      emits_work_record_v0: !!recordId,
      verifier_profile_id: verifierProfileId,
      evidence_source_shape: text(evidence.type),
    },
  });
}

export function createBrowserPlaybookPrototype({
  id = BROWSER_CLICK_STATUS_PROTOTYPE_ID,
  label = '',
  playbookStep,
  evidenceSource,
  workflowGateRef = '',
} = {}) {
  const step = requireObject(playbookStep, 'playbookStep');
  const evidence = requireObject(evidenceSource, 'evidenceSource');

  return {
    type: 'aos.browser_playbook_prototype',
    schema_version: BROWSER_PLAYBOOK_PROTOTYPE_VERSION,
    id: text(id, BROWSER_CLICK_STATUS_PROTOTYPE_ID),
    label: prototypeLabel({ label, playbookStep: step, id }),
    playbook_step: cloneJson(step),
    evidence_source: cloneJson(evidence),
    subject: createBrowserPlaybookPrototypeSubject({
      id,
      label,
      playbookStep: step,
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
      'general_playbook_ui',
      'public_cli_surface',
      'autonomous_replay',
      'autonomous_repair',
      'macro_playback',
      'background_loop',
    ],
  };
}

export function createBrowserPlaybookPrototypeWorkRecordOpenMessage(record = {}, {
  prototype = {},
} = {}) {
  const value = requireObject(record, 'record');
  const step = objectValue(prototype.playbook_step);

  return {
    type: 'work_record.open',
    source: {
      kind: 'browser_playbook_prototype',
      path: null,
      prototype_id: text(prototype.id),
      playbook_ref: text(step.playbook_ref || objectValue(value.origin).ref),
      playbook_step_id: text(step.id || objectValue(value.metadata).playbook_step_id),
      read_only: true,
    },
    record: cloneJson(value),
  };
}

export function runBrowserPlaybookPrototype(prototype = {}, {
  workflowGate = null,
  verifierProfileId = WORK_RECORD_REPORT_ONLY_PROFILE_ID,
} = {}) {
  const value = requireObject(prototype, 'prototype');
  const step = requireObject(value.playbook_step, 'prototype.playbook_step');
  const evidence = requireObject(value.evidence_source, 'prototype.evidence_source');

  const harness = runOneStepPlaybookHarness(step, {
    workflowGate,
    mode: 'simulate',
    evidenceSource: evidence,
    verifierProfileId,
  });
  const record = harness.record ? cloneJson(harness.record) : null;
  const subject = createBrowserPlaybookPrototypeSubject({
    id: text(value.id, BROWSER_CLICK_STATUS_PROTOTYPE_ID),
    label: text(value.label),
    playbookStep: step,
    evidenceSource: evidence,
    harnessResult: harness,
    workflowGateRef: text(harness.workflow_gate_ref),
  });

  return {
    type: 'aos.browser_playbook_prototype.result',
    schema_version: BROWSER_PLAYBOOK_PROTOTYPE_VERSION,
    status: text(harness.status, 'rejected'),
    reason: text(harness.reason),
    mode: 'simulate',
    prototype_id: text(value.id, BROWSER_CLICK_STATUS_PROTOTYPE_ID),
    subject,
    harness: cloneJson(harness),
    record,
    verifier: harness.verifier ? cloneJson(harness.verifier) : null,
    workbench_open_message: record
      ? createBrowserPlaybookPrototypeWorkRecordOpenMessage(record, { prototype: value })
      : null,
    diagnostics: arrayValue(harness.diagnostics).map((diagnostic) => cloneJson(diagnostic)),
  };
}
