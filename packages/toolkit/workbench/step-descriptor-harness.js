import {
  buildWorkRecordV1FromStepDescriptorEvidence,
} from './work-record-capture-step-descriptor.js';
import {
  runWorkRecordVerifierProfile,
  WORK_RECORD_REPORT_ONLY_PROFILE_ID,
} from './work-record-verifier.js';
import validateStepDescriptorV1 from './step-descriptor-v1-validator.generated.js';
import {
  stepDescriptorContractMismatches,
  stepDescriptorEvidenceMismatches,
} from './work-record-capture-helpers.js';

export const STEP_DESCRIPTOR_SCHEMA_VERSION = '2026-08-step-descriptor-v1';
export const STEP_DESCRIPTOR_HARNESS_VERSION = '2026-08-one-step-step-descriptor-harness-v1';

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

function diagnostic(code, message, path = '', details = {}) {
  return {
    severity: 'error',
    code,
    failure_class: text(details.failure_class, 'harness_contract'),
    report_only: true,
    message,
    path,
    ...details,
  };
}

function harnessResult({
  status,
  reason,
  stepDescriptor,
  mode = 'simulate',
  diagnostics = [],
  record = null,
  verifier = null,
}) {
  return {
    type: 'aos.step_descriptor_harness.result',
    schema_version: STEP_DESCRIPTOR_HARNESS_VERSION,
    status,
    mode,
    reason,
    step_descriptor_id: text(objectValue(stepDescriptor).id) || null,
    record,
    verifier,
    diagnostics,
  };
}

function normalizeHarnessMode(mode = 'simulate') {
  return text(mode, 'simulate') === 'execute' ? 'execute' : 'simulate';
}

export function validateStepDescriptor(step = {}) {
  const diagnostics = [];
  if (text(step.type) !== 'aos.step_descriptor') {
    diagnostics.push(diagnostic(
      'unsupported_step_descriptor_type',
      'The one-step harness requires type aos.step_descriptor.',
      'step_descriptor.type',
    ));
  }
  if (text(step.schema_version) !== STEP_DESCRIPTOR_SCHEMA_VERSION) {
    diagnostics.push(diagnostic(
      'unsupported_step_descriptor_schema',
      `The one-step harness accepts only ${STEP_DESCRIPTOR_SCHEMA_VERSION}; historical descriptors are unsupported.`,
      'step_descriptor.schema_version',
    ));
  }
  if (diagnostics.length === 0 && !validateStepDescriptorV1(step)) {
    for (const error of arrayValue(validateStepDescriptorV1.errors)) {
      const item = objectValue(error);
      diagnostics.push(diagnostic(
        'step_descriptor_v1_schema_invalid',
        `Step Descriptor V1 schema validation failed: ${text(item.message, 'invalid value')}`,
        text(item.instancePath) ? `step_descriptor${text(item.instancePath)}` : 'step_descriptor',
        { schema_path: text(item.schemaPath) },
      ));
    }
  }
  if (diagnostics.length === 0) {
    diagnostics.push(...stepDescriptorContractMismatches(step).map((item) => diagnostic(
      item.code,
      item.message,
      item.path,
    )));
  }
  return diagnostics;
}

export function runOneStepStepDescriptorHarness(stepDescriptor = {}, {
  mode = 'simulate',
  evidenceSource = null,
  executeStep = null,
  verifierProfileId = WORK_RECORD_REPORT_ONLY_PROFILE_ID,
} = {}) {
  const step = objectValue(stepDescriptor);
  const harnessMode = normalizeHarnessMode(mode);

  if (Array.isArray(stepDescriptor) || arrayValue(step.steps).length > 0) {
    return harnessResult({
      status: 'rejected',
      reason: 'one_step_only',
      stepDescriptor: step,
      mode: harnessMode,
      diagnostics: [diagnostic(
        'one_step_only',
        'The Step Descriptor harness accepts exactly one descriptor.',
        'step_descriptor',
      )],
    });
  }

  const descriptorDiagnostics = validateStepDescriptor(step);
  if (descriptorDiagnostics.length > 0) {
    return harnessResult({
      status: 'rejected',
      reason: descriptorDiagnostics[0].code,
      stepDescriptor: step,
      mode: harnessMode,
      diagnostics: descriptorDiagnostics,
    });
  }

  let source = objectValue(evidenceSource);
  if (harnessMode === 'execute') {
    if (typeof executeStep !== 'function') {
      return harnessResult({
        status: 'rejected',
        reason: 'execute_step_adapter_required',
        stepDescriptor: step,
        mode: harnessMode,
        diagnostics: [diagnostic(
          'execute_step_adapter_required',
          'Execute mode requires a caller-supplied adapter that returns one saved AOS action evidence source.',
          'executeStep',
        )],
      });
    }
    source = objectValue(executeStep({ stepDescriptor: cloneJson(step) }));
  }

  if (Object.keys(source).length === 0) {
    return harnessResult({
      status: 'rejected',
      reason: 'evidence_source_required',
      stepDescriptor: step,
      mode: harnessMode,
      diagnostics: [diagnostic(
        'evidence_source_required',
        'The harness requires one saved AOS action evidence source.',
        'evidenceSource',
      )],
    });
  }

  const evidenceDiagnostics = stepDescriptorEvidenceMismatches(step, source)
    .map((item) => diagnostic(item.code, item.message, item.path));
  if (evidenceDiagnostics.length > 0) {
    return harnessResult({
      status: 'rejected',
      reason: evidenceDiagnostics[0].code,
      stepDescriptor: step,
      mode: harnessMode,
      diagnostics: evidenceDiagnostics,
    });
  }

  const record = buildWorkRecordV1FromStepDescriptorEvidence(step, source);
  const verifier = runWorkRecordVerifierProfile(record, { profileId: verifierProfileId });
  return harnessResult({
    status: verifier.status,
    reason: verifier.status === 'passed' ? 'record_verified' : 'verifier_reported_diagnostics',
    stepDescriptor: step,
    mode: harnessMode,
    record,
    verifier,
    diagnostics: arrayValue(verifier.diagnostics).map((item) => cloneJson(item)),
  });
}
