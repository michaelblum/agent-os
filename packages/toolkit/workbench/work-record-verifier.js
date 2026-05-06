import {
  isWorkRecordV0,
  normalizeWorkRecord,
  WORK_RECORD_V0_SCHEMA_VERSION,
} from './work-record-adapter.js';

export const WORK_RECORD_REPORT_CHECKER_VERSION = '2026-05-report-only';
export const WORK_RECORD_REPORT_ONLY_PROFILE_ID = 'aos.verifier.work-record.v0.report-only';
export const WORK_RECORD_REPORT_ONLY_PROFILE = Object.freeze({
  id: WORK_RECORD_REPORT_ONLY_PROFILE_ID,
  kind: 'work_record_v0_report_only',
  version: WORK_RECORD_REPORT_CHECKER_VERSION,
  mode: 'report_only',
  mutates_record: false,
  description: 'Checks Work Record v0 report integrity without mutating the record.',
});

function text(value, fallback = '') {
  const normalized = String(value ?? '').replace(/\s+/g, ' ').trim();
  return normalized || fallback;
}

function objectValue(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function cloneJson(value) {
  if (value === undefined) return undefined;
  return JSON.parse(JSON.stringify(value));
}

function arrayValue(value) {
  return Array.isArray(value) ? value : [];
}

function idSet(values = []) {
  return new Set(arrayValue(values).map((value) => text(objectValue(value).id)).filter(Boolean));
}

function refList(values = []) {
  return arrayValue(values).map((value) => text(value)).filter(Boolean);
}

function addDiagnostic(diagnostics, code, message, path, severity = 'error') {
  diagnostics.push({ severity, code, message, path });
}

const WORK_RECORD_VERIFIER_PROFILES = Object.freeze({
  [WORK_RECORD_REPORT_ONLY_PROFILE_ID]: WORK_RECORD_REPORT_ONLY_PROFILE,
});

export function workRecordVerifierProfiles() {
  return Object.values(WORK_RECORD_VERIFIER_PROFILES).map((profile) => cloneJson(profile));
}

export function workRecordVerifierProfile(profileId = WORK_RECORD_REPORT_ONLY_PROFILE_ID) {
  return cloneJson(WORK_RECORD_VERIFIER_PROFILES[text(profileId)]);
}

export function deriveWorkRecordClaimIndexes(record = {}) {
  const indexes = {
    verified: [],
    failed: [],
    unverified: [],
  };
  for (const result of arrayValue(record.claim_results)) {
    const status = text(objectValue(result).status);
    const claimId = text(objectValue(result).claim_id);
    if (Object.hasOwn(indexes, status) && claimId) {
      indexes[status].push(claimId);
    }
  }
  for (const status of Object.keys(indexes)) {
    indexes[status].sort();
  }
  return indexes;
}

function assertRefsKnown({ diagnostics, refs, known, code, label, path }) {
  for (const ref of refs) {
    if (!known.has(ref)) {
      addDiagnostic(
        diagnostics,
        code,
        `${label} references unknown id ${ref}`,
        path,
      );
    }
  }
}

function sameMembers(a = [], b = []) {
  const left = [...a].sort();
  const right = [...b].sort();
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

export function checkWorkRecordReportOnly(record = {}) {
  const normalized = normalizeWorkRecord(record);
  const diagnostics = [];

  if (!isWorkRecordV0(record)) {
    addDiagnostic(
      diagnostics,
      'unsupported_record_shape',
      `report-only checker expects ${WORK_RECORD_V0_SCHEMA_VERSION} Work Records`,
      '',
    );
    return {
      type: 'work_record.report_only_check',
      schema_version: WORK_RECORD_REPORT_CHECKER_VERSION,
      mode: 'report_only',
      status: 'unsupported',
      record_id: normalized.id,
      record_schema_version: normalized.schemaVersion,
      mutates_record: false,
      derived_indexes: { verified: [], failed: [], unverified: [] },
      diagnostics,
      summary: {
        claims: normalized.claims.length,
        claim_results: normalized.claimResults.length,
        evidence: normalized.evidence.length,
        postconditions: 0,
        replay_gated: false,
        repair_gated: false,
      },
    };
  }

  const executionMap = objectValue(record.execution_map);
  const postconditions = arrayValue(executionMap.postconditions);
  const verifierReport = objectValue(record.verifier_report);
  const replayPolicy = objectValue(executionMap.replay_policy);
  const health = objectValue(record.health);
  const claims = arrayValue(record.claims);
  const claimResults = arrayValue(record.claim_results);
  const evidence = arrayValue(record.evidence);

  const claimIds = idSet(claims);
  const postconditionIds = idSet(postconditions);
  const evidenceIds = idSet(evidence);
  const resultClaimCounts = new Map();
  const derivedIndexes = deriveWorkRecordClaimIndexes(record);

  assertRefsKnown({
    diagnostics,
    refs: refList(objectValue(record.intent).claim_refs),
    known: claimIds,
    code: 'unknown_intent_claim_ref',
    label: 'intent.claim_refs[]',
    path: 'intent.claim_refs',
  });

  claims.forEach((claim, index) => {
    const claimId = text(objectValue(claim).id, `claims[${index}]`);
    assertRefsKnown({
      diagnostics,
      refs: refList(objectValue(claim).postcondition_refs),
      known: postconditionIds,
      code: 'unknown_claim_postcondition_ref',
      label: `claim ${claimId}`,
      path: `claims[${index}].postcondition_refs`,
    });
  });

  postconditions.forEach((postcondition, index) => {
    const postconditionId = text(objectValue(postcondition).id, `postconditions[${index}]`);
    assertRefsKnown({
      diagnostics,
      refs: refList(objectValue(postcondition).evidence_refs),
      known: evidenceIds,
      code: 'unknown_postcondition_evidence_ref',
      label: `postcondition ${postconditionId}`,
      path: `execution_map.postconditions[${index}].evidence_refs`,
    });
  });

  evidence.forEach((item, index) => {
    if (objectValue(item).immutable !== true) {
      addDiagnostic(
        diagnostics,
        'mutable_evidence',
        `evidence ${text(objectValue(item).id, `evidence[${index}]`)} must be immutable`,
        `evidence[${index}].immutable`,
      );
    }
  });

  claimResults.forEach((result, index) => {
    const value = objectValue(result);
    const claimId = text(value.claim_id);
    resultClaimCounts.set(claimId, (resultClaimCounts.get(claimId) || 0) + 1);
    if (!claimIds.has(claimId)) {
      addDiagnostic(
        diagnostics,
        'unknown_result_claim_id',
        `claim_result ${text(value.id, `claim_results[${index}]`)} references unknown claim ${claimId}`,
        `claim_results[${index}].claim_id`,
      );
    }
    assertRefsKnown({
      diagnostics,
      refs: refList(value.evidence_refs),
      known: evidenceIds,
      code: 'unknown_result_evidence_ref',
      label: `claim_result ${text(value.id, claimId)}`,
      path: `claim_results[${index}].evidence_refs`,
    });
    arrayValue(value.postcondition_results).forEach((postconditionResult, resultIndex) => {
      const postconditionValue = objectValue(postconditionResult);
      const postconditionId = text(postconditionValue.postcondition_id);
      if (!postconditionIds.has(postconditionId)) {
        addDiagnostic(
          diagnostics,
          'unknown_result_postcondition_id',
          `claim_result ${text(value.id, claimId)} references unknown postcondition ${postconditionId}`,
          `claim_results[${index}].postcondition_results[${resultIndex}].postcondition_id`,
        );
      }
      assertRefsKnown({
        diagnostics,
        refs: refList(postconditionValue.evidence_refs),
        known: evidenceIds,
        code: 'unknown_postcondition_result_evidence_ref',
        label: `postcondition_result ${postconditionId}`,
        path: `claim_results[${index}].postcondition_results[${resultIndex}].evidence_refs`,
      });
    });
  });

  for (const claimId of claimIds) {
    const resultCount = resultClaimCounts.get(claimId) || 0;
    if (resultCount === 0) {
      addDiagnostic(
        diagnostics,
        'missing_claim_result',
        `claim ${claimId} has no claim_result`,
        'claim_results',
      );
    } else if (resultCount > 1) {
      addDiagnostic(
        diagnostics,
        'duplicate_claim_result',
        `claim ${claimId} has ${resultCount} claim_results`,
        'claim_results',
      );
    }
  }

  if (text(verifierReport.claim_results_ref) !== 'claim_results') {
    addDiagnostic(
      diagnostics,
      'invalid_claim_results_ref',
      'verifier_report.claim_results_ref must be claim_results',
      'verifier_report.claim_results_ref',
    );
  }

  for (const status of Object.keys(derivedIndexes)) {
    const reported = refList(objectValue(verifierReport.derived_indexes)[status]);
    if (!sameMembers(reported, derivedIndexes[status])) {
      addDiagnostic(
        diagnostics,
        'derived_index_mismatch',
        `verifier_report.derived_indexes.${status} must match claim_results[]`,
        `verifier_report.derived_indexes.${status}`,
      );
    }
  }

  assertRefsKnown({
    diagnostics,
    refs: refList(verifierReport.evidence_refs),
    known: evidenceIds,
    code: 'unknown_verifier_report_evidence_ref',
    label: 'verifier_report.evidence_refs[]',
    path: 'verifier_report.evidence_refs',
  });

  if (text(health.verifier_report_id) !== text(verifierReport.id)) {
    addDiagnostic(
      diagnostics,
      'health_report_mismatch',
      'health.verifier_report_id must match verifier_report.id',
      'health.verifier_report_id',
    );
  }

  if (replayPolicy.replay_requires_workflow_gate !== true) {
    addDiagnostic(
      diagnostics,
      'replay_gate_not_required',
      'execution_map.replay_policy.replay_requires_workflow_gate must be true',
      'execution_map.replay_policy.replay_requires_workflow_gate',
    );
  }

  if (replayPolicy.repair_requires_workflow_gate !== true) {
    addDiagnostic(
      diagnostics,
      'repair_gate_not_required',
      'execution_map.replay_policy.repair_requires_workflow_gate must be true',
      'execution_map.replay_policy.repair_requires_workflow_gate',
    );
  }

  const errorCount = diagnostics.filter((diagnostic) => diagnostic.severity === 'error').length;
  return {
    type: 'work_record.report_only_check',
    schema_version: WORK_RECORD_REPORT_CHECKER_VERSION,
    mode: 'report_only',
    status: errorCount === 0 ? 'passed' : 'failed',
    record_id: normalized.id,
    record_schema_version: normalized.schemaVersion,
    mutates_record: false,
    derived_indexes: derivedIndexes,
    diagnostics,
    summary: {
      claims: claims.length,
      claim_results: claimResults.length,
      evidence: evidence.length,
      postconditions: postconditions.length,
      replay_gated: replayPolicy.replay_requires_workflow_gate === true,
      repair_gated: replayPolicy.repair_requires_workflow_gate === true,
    },
  };
}

export function runWorkRecordVerifierProfile(record = {}, {
  profileId = WORK_RECORD_REPORT_ONLY_PROFILE_ID,
} = {}) {
  const profile = workRecordVerifierProfile(profileId);
  if (!profile) {
    return {
      type: 'work_record.verifier_profile_check',
      schema_version: WORK_RECORD_REPORT_CHECKER_VERSION,
      mode: 'report_only',
      status: 'unsupported_profile',
      profile_id: text(profileId),
      mutates_record: false,
      diagnostics: [{
        severity: 'error',
        code: 'unknown_verifier_profile',
        message: `Unknown Work Record verifier profile ${text(profileId)}`,
        path: 'profile_id',
      }],
    };
  }

  return {
    ...checkWorkRecordReportOnly(record),
    profile_id: profile.id,
    profile,
  };
}
