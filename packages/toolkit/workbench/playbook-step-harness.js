import {
  buildWorkRecordV0FromPlaybookStepEvidence,
  runWorkRecordVerifierProfile,
  WORK_RECORD_REPORT_ONLY_PROFILE_ID,
} from './work-record.js';

export const PLAYBOOK_STEP_HARNESS_VERSION = '2026-05-one-step-playbook-harness-v0';

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

function harnessResult({
  status,
  reason,
  playbookStep,
  workflowGate = null,
  mode = 'simulate',
  diagnostics = [],
  record = null,
  verifier = null,
}) {
  return {
    type: 'aos.playbook_step_harness.result',
    schema_version: PLAYBOOK_STEP_HARNESS_VERSION,
    status,
    mode,
    reason,
    playbook_step_id: text(objectValue(playbookStep).id) || null,
    workflow_gate_ref: text(objectValue(workflowGate).ref) || null,
    record,
    verifier,
    diagnostics,
  };
}

function diagnostic(code, message, path = '', details = {}) {
  return {
    severity: 'error',
    code,
    failure_class: text(details.failure_class, 'workflow_gate'),
    report_only: true,
    message,
    path,
    ...details,
  };
}

export function normalizePlaybookHarnessGate(gate = null) {
  if (typeof gate === 'string') {
    return {
      ref: text(gate),
      token: '',
    };
  }
  const value = objectValue(gate);
  return {
    ...cloneJson(value),
    ref: text(value.ref || value.gate_ref || value.workflow_gate_ref),
    token: text(value.token || value.token_ref || value.workflow_gate_token),
  };
}

export function checkPlaybookHarnessGate(playbookStep = {}, gate = null) {
  const step = objectValue(playbookStep);
  const normalizedGate = normalizePlaybookHarnessGate(gate);
  const gateRef = text(normalizedGate.ref);
  const gateToken = text(normalizedGate.token);
  const allowedRefs = arrayValue(objectValue(step.workflow_gates).gate_refs)
    .map((ref) => text(ref))
    .filter(Boolean);

  if (!gateRef || !gateToken) {
    return {
      ok: false,
      gate: normalizedGate,
      diagnostic: diagnostic(
        'workflow_gate_required',
        'Playbook harness execution requires an explicit workflow gate ref and token before any action path can run.',
        'workflow_gate',
      ),
    };
  }

  if (allowedRefs.length === 0 || !allowedRefs.includes(gateRef)) {
    return {
      ok: false,
      gate: normalizedGate,
      diagnostic: diagnostic(
        'workflow_gate_ref_not_allowed',
        `Workflow gate ${gateRef} is not declared by the Playbook step.`,
        'workflow_gate.ref',
        {
          gate_ref: gateRef,
          allowed_gate_refs: allowedRefs,
        },
      ),
    };
  }

  return {
    ok: true,
    gate: normalizedGate,
  };
}

function normalizeHarnessMode(mode = 'simulate') {
  const normalized = text(mode, 'simulate');
  return normalized === 'execute' ? 'execute' : 'simulate';
}

export function runOneStepPlaybookHarness(playbookStep = {}, {
  workflowGate = null,
  mode = 'simulate',
  evidenceSource = null,
  executeStep = null,
  verifierProfileId = WORK_RECORD_REPORT_ONLY_PROFILE_ID,
} = {}) {
  const step = objectValue(playbookStep);
  const harnessMode = normalizeHarnessMode(mode);

  if (Array.isArray(playbookStep) || arrayValue(step.steps).length > 0) {
    return harnessResult({
      status: 'rejected',
      reason: 'one_step_only',
      playbookStep: step,
      workflowGate,
      mode: harnessMode,
      diagnostics: [
        diagnostic(
          'one_step_only',
          'The v0 Playbook harness accepts exactly one Playbook step descriptor.',
          'playbook_step',
          { failure_class: 'harness_contract' },
        ),
      ],
    });
  }

  const gateCheck = checkPlaybookHarnessGate(step, workflowGate);
  if (!gateCheck.ok) {
    return harnessResult({
      status: 'rejected',
      reason: gateCheck.diagnostic.code,
      playbookStep: step,
      workflowGate: gateCheck.gate,
      mode: harnessMode,
      diagnostics: [gateCheck.diagnostic],
    });
  }

  let source = objectValue(evidenceSource);
  if (harnessMode === 'execute') {
    if (typeof executeStep !== 'function') {
      return harnessResult({
        status: 'rejected',
        reason: 'execute_step_adapter_required',
        playbookStep: step,
        workflowGate: gateCheck.gate,
        mode: harnessMode,
        diagnostics: [
          diagnostic(
            'execute_step_adapter_required',
            'Execute mode requires a caller-supplied adapter that returns one saved AOS action evidence source.',
            'executeStep',
            { failure_class: 'harness_contract' },
          ),
        ],
      });
    }
    source = objectValue(executeStep({
      playbookStep: cloneJson(step),
      workflowGate: cloneJson(gateCheck.gate),
    }));
  }

  if (Object.keys(source).length === 0) {
    return harnessResult({
      status: 'rejected',
      reason: 'evidence_source_required',
      playbookStep: step,
      workflowGate: gateCheck.gate,
      mode: harnessMode,
      diagnostics: [
        diagnostic(
          'evidence_source_required',
          'The v0 harness records through saved AOS action evidence and requires one evidence source.',
          'evidenceSource',
          { failure_class: 'harness_contract' },
        ),
      ],
    });
  }

  const record = buildWorkRecordV0FromPlaybookStepEvidence(step, source);
  const verifier = runWorkRecordVerifierProfile(record, { profileId: verifierProfileId });

  return harnessResult({
    status: verifier.status,
    reason: verifier.status === 'passed'
      ? 'record_verified'
      : 'verifier_reported_diagnostics',
    playbookStep: step,
    workflowGate: gateCheck.gate,
    mode: harnessMode,
    record,
    verifier,
    diagnostics: arrayValue(verifier.diagnostics).map((item) => cloneJson(item)),
  });
}
