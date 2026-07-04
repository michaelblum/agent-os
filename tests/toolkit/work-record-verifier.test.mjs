import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  checkWorkRecordReportOnly,
  classifyWorkRecordHealth,
  deriveCurrentWorkRecordHealth,
  deriveWorkRecordClaimIndexes,
  runWorkRecordVerifierProfile,
  WORK_RECORD_REPORT_ONLY_PROFILE_ID,
  workRecordVerifierProfile,
  workRecordVerifierProfiles,
} from '../../packages/toolkit/workbench/work-record-verifier.js';
import {
  checkWorkRecordEvidenceAdapters,
  WORK_RECORD_EVIDENCE_ADAPTER_IDS,
  workRecordEvidenceAdapters,
} from '../../packages/toolkit/workbench/work-record-evidence-adapters.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../..');
const v0FixtureRoot = path.join(repoRoot, 'shared/schemas/fixtures/aos-work-record-v0/valid');
const reportOnlyFailureFixtureRoot = path.join(repoRoot, 'shared/schemas/fixtures/aos-work-record-v0/report-only-failures');

function fixture(name) {
  return JSON.parse(fs.readFileSync(path.join(v0FixtureRoot, name), 'utf8'));
}

function reportOnlyFailureFixture(name) {
  return JSON.parse(fs.readFileSync(path.join(reportOnlyFailureFixtureRoot, name), 'utf8'));
}

function markPostconditionFailed(record, postconditionId, reason) {
  for (const claimResult of record.claim_results) {
    let changed = false;
    for (const postconditionResult of claimResult.postcondition_results) {
      if (postconditionResult.postcondition_id !== postconditionId) continue;
      postconditionResult.status = 'failed';
      postconditionResult.reason = reason;
      changed = true;
    }
    if (changed) {
      claimResult.status = 'failed';
      claimResult.confidence = 0.2;
      claimResult.reason = reason;
    }
  }
  record.verifier_report.derived_indexes = deriveWorkRecordClaimIndexes(record);
  record.health.verdict = 'blocked';
  record.health.reason = reason;
}

test('report-only verifier checker derives indexes and does not mutate valid v0 records', () => {
  const record = fixture('workflow-origin.json');
  const before = JSON.stringify(record);
  const result = checkWorkRecordReportOnly(record);

  assert.equal(result.status, 'passed');
  assert.equal(result.mode, 'report_only');
  assert.equal(result.mutates_record, false);
  assert.equal(result.summary.claims, 2);
  assert.equal(result.summary.claim_results, 2);
  assert.equal(result.summary.evidence, 3);
  assert.equal(result.summary.postconditions, 3);
  assert.equal(result.summary.replay_gated, true);
  assert.equal(result.summary.repair_gated, true);
  assert.deepEqual(result.diagnostics, []);
  assert.deepEqual(result.derived_indexes, {
    verified: [
      'claim:before-action-after-evidence-captured',
      'claim:sigil-subject-opened',
    ],
    failed: [],
    unverified: [],
  });
  assert.deepEqual(deriveWorkRecordClaimIndexes(record), result.derived_indexes);
  assert.equal(JSON.stringify(record), before);
});

test('named report-only verifier profile runs the deterministic checker', () => {
  const record = fixture('repo-command-adapter-test.json');
  const before = JSON.stringify(record);
  const profile = workRecordVerifierProfile(WORK_RECORD_REPORT_ONLY_PROFILE_ID);
  const result = runWorkRecordVerifierProfile(record, { profileId: WORK_RECORD_REPORT_ONLY_PROFILE_ID });

  assert.equal(profile.id, WORK_RECORD_REPORT_ONLY_PROFILE_ID);
  assert.ok(workRecordVerifierProfiles().some((item) => item.id === WORK_RECORD_REPORT_ONLY_PROFILE_ID));
  assert.equal(result.status, 'passed');
  assert.equal(result.profile_id, WORK_RECORD_REPORT_ONLY_PROFILE_ID);
  assert.equal(result.profile.mode, 'report_only');
  assert.equal(result.profile.mutates_record, false);
  assert.deepEqual(result.diagnostics, []);
  assert.equal(JSON.stringify(record), before);
});

test('report-only verifier checker reports internal reference and gate drift', () => {
  const record = fixture('workflow-origin.json');
  record.intent.claim_refs.push('claim:missing');
  record.claims[0].postcondition_refs.push('postcondition:missing');
  record.execution_map.postconditions[0].evidence_refs.push('evidence:missing');
  record.evidence[0].immutable = false;
  record.claim_results[0].claim_id = 'claim:missing';
  record.claim_results[1].postcondition_results[0].evidence_refs.push('evidence:missing');
  record.verifier_report.derived_indexes.verified = [];
  record.verifier_report.evidence_refs.push('evidence:missing');
  record.health.verifier_report_id = 'verifier-report:missing';
  record.execution_map.replay_policy.replay_requires_workflow_gate = false;
  record.execution_map.replay_policy.repair_requires_workflow_gate = false;

  const result = checkWorkRecordReportOnly(record);
  const codes = new Set(result.diagnostics.map((diagnostic) => diagnostic.code));

  assert.equal(result.status, 'failed');
  assert.ok(codes.has('unknown_intent_claim_ref'));
  assert.ok(codes.has('unknown_claim_postcondition_ref'));
  assert.ok(codes.has('unknown_postcondition_evidence_ref'));
  assert.ok(codes.has('mutable_evidence'));
  assert.ok(codes.has('unknown_result_claim_id'));
  assert.ok(codes.has('missing_claim_result'));
  assert.ok(codes.has('unknown_postcondition_result_evidence_ref'));
  assert.ok(codes.has('derived_index_mismatch'));
  assert.ok(codes.has('unknown_verifier_report_evidence_ref'));
  assert.ok(codes.has('health_report_mismatch'));
  assert.ok(codes.has('replay_gate_not_required'));
  assert.ok(codes.has('repair_gate_not_required'));
  assert.ok(result.failure_classes.includes('evidence_ref_drift'));
  assert.ok(result.failure_classes.includes('workflow_gate_drift'));
});

test('report-only verifier checker rejects unsupported legacy records', () => {
  const result = checkWorkRecordReportOnly({
    type: 'aos.do_step',
    id: 'legacy-step',
  });

  assert.equal(result.status, 'unsupported');
  assert.equal(result.record_id, 'legacy-step');
  assert.equal(result.diagnostics[0].code, 'unsupported_record_shape');
});

test('report-only verifier reads every Work Record health verdict classification', () => {
  const base = fixture('workflow-origin.json');
  for (const verdict of ['valid', 'stale', 'repairable', 'blocked', 'impossible', 'superseded', 'retired']) {
    const record = structuredClone(base);
    record.health.verdict = verdict;
    const result = checkWorkRecordReportOnly(record);

    assert.equal(classifyWorkRecordHealth(record), verdict);
    assert.equal(result.health_verdict, verdict);
    assert.equal(result.summary.health_verdict, verdict);
  }
});

test('report-only verifier derives current health from diagnostics, not optimistic embedded health', () => {
  const record = fixture('cleanup-or-postcondition-failed.json');
  record.health.verdict = 'valid';
  record.health.reason = 'forced optimistic embedded health';
  const before = JSON.stringify(record);
  const result = checkWorkRecordReportOnly(record);

  assert.equal(classifyWorkRecordHealth(record), 'valid');
  assert.equal(deriveCurrentWorkRecordHealth(record, {
    status: result.status,
    diagnostics: result.diagnostics,
  }), 'blocked');
  assert.equal(result.status, 'failed');
  assert.equal(result.embedded_health_verdict, 'valid');
  assert.equal(result.health_verdict, 'blocked');
  assert.equal(result.summary.embedded_health_verdict, 'valid');
  assert.equal(result.summary.health_verdict, 'blocked');
  assert.equal(JSON.stringify(record), before);
});

test('report-only verifier reads saved-ref repairable and blocked fixture health without mutating records', () => {
  for (const [name, verdict] of [
    ['repairable-stale-saved-ref.json', 'repairable'],
    ['cleanup-or-postcondition-failed.json', 'blocked'],
  ]) {
    const record = fixture(name);
    const before = JSON.stringify(record);
    const result = checkWorkRecordReportOnly(record);

    assert.equal(result.summary.health_verdict, verdict);
    assert.equal(classifyWorkRecordHealth(record), verdict);
    assert.equal(JSON.stringify(record), before);
  }
});

test('report-only verifier checks structured browser, canvas, and artifact metadata evidence', () => {
  const record = fixture('evidence-adapter-browser-canvas.json');
  const before = JSON.stringify(record);
  const adapterIds = new Set(workRecordEvidenceAdapters().map((adapter) => adapter.id));
  const adapterReport = checkWorkRecordEvidenceAdapters(record);
  const result = checkWorkRecordReportOnly(record);

  assert.ok(adapterIds.has(WORK_RECORD_EVIDENCE_ADAPTER_IDS.browserSemanticTargets));
  assert.ok(adapterIds.has(WORK_RECORD_EVIDENCE_ADAPTER_IDS.canvasSemanticTargets));
  assert.ok(adapterIds.has(WORK_RECORD_EVIDENCE_ADAPTER_IDS.artifactMetadata));
  assert.equal(adapterReport.status, 'passed');
  assert.equal(adapterReport.mutates_record, false);
  assert.equal(adapterReport.summary.checked, 3);
  assert.deepEqual(adapterReport.diagnostics, []);
  assert.equal(result.status, 'passed');
  assert.equal(result.summary.evidence_adapter_checks, 3);
  assert.equal(result.summary.evidence_adapter_failures, 0);
  assert.deepEqual(result.diagnostics, []);
  assert.equal(JSON.stringify(record), before);
});

test('report-only verifier reports adapter-backed evidence failure classes without mutating records', () => {
  const record = reportOnlyFailureFixture('evidence-adapter-failures.json');
  const before = JSON.stringify(record);
  const result = checkWorkRecordReportOnly(record);
  const codes = new Set(result.diagnostics.map((diagnostic) => diagnostic.code));

  assert.equal(result.status, 'failed');
  assert.ok(codes.has('evidence_target_ref_drift'));
  assert.ok(codes.has('missing_semantic_target'));
  assert.ok(codes.has('semantic_target_value_mismatch'));
  assert.ok(codes.has('semantic_target_role_name_mismatch'));
  assert.ok(codes.has('artifact_metadata_mismatch'));
  assert.ok(result.failure_classes.includes('target_ref_drift'));
  assert.ok(result.failure_classes.includes('semantic_target_missing'));
  assert.ok(result.failure_classes.includes('semantic_value_mismatch'));
  assert.ok(result.failure_classes.includes('semantic_role_name_mismatch'));
  assert.ok(result.failure_classes.includes('artifact_metadata_mismatch'));
  assert.equal(result.summary.evidence_adapter_checks, 5);
  assert.ok(result.summary.evidence_adapter_failures >= 5);
  assert.ok(result.diagnostics.every((diagnostic) => diagnostic.report_only === true));
  assert.ok(result.diagnostics.every((diagnostic) => diagnostic.source === 'work_record_evidence_adapter'));
  assert.equal(JSON.stringify(record), before);
});

test('report-only verifier classifies target/ref drift without mutating the Work Record', () => {
  const record = fixture('workflow-browser-click-status.json');
  const before = JSON.stringify(record);
  record.execution_map.steps[0].action.target = 'browser:work-record-live-action/e99';

  const mutated = JSON.stringify(record);
  const result = checkWorkRecordReportOnly(record);
  const targetDiagnostics = result.diagnostics.filter((item) => item.code === 'target_ref_drift');

  assert.equal(result.status, 'failed');
  assert.ok(targetDiagnostics.length >= 1);
  assert.ok(targetDiagnostics.every((item) => item.failure_class === 'target_ref_drift'));
  assert.ok(result.failure_classes.includes('target_ref_drift'));
  assert.equal(JSON.stringify(record), mutated);
  assert.notEqual(mutated, before);
});

test('report-only verifier classifies precondition, action, and postcondition failures', () => {
  const cases = [
    {
      postconditionId: 'postcondition:aos-browser-click-status-2026-05-06-before-perception',
      code: 'precondition_failed',
      failureClass: 'precondition_failure',
    },
    {
      postconditionId: 'postcondition:aos-browser-click-status-2026-05-06-action-executed',
      code: 'action_failed',
      failureClass: 'action_failure',
    },
    {
      postconditionId: 'postcondition:aos-browser-click-status-after-status',
      code: 'postcondition_failed',
      failureClass: 'postcondition_failure',
    },
  ];

  for (const item of cases) {
    const record = fixture('workflow-browser-click-status.json');
    markPostconditionFailed(record, item.postconditionId, `${item.failureClass} fixture`);
    const before = JSON.stringify(record);
    const result = checkWorkRecordReportOnly(record);
    const diagnostics = result.diagnostics.filter((diagnostic) => diagnostic.code === item.code);

    assert.equal(result.status, 'failed');
    assert.ok(diagnostics.length >= 1, `expected ${item.code}`);
    assert.ok(diagnostics.every((diagnostic) => diagnostic.failure_class === item.failureClass));
    assert.ok(result.failure_classes.includes(item.failureClass));
    assert.equal(JSON.stringify(record), before);
  }
});

test('report-only verifier classifies State ID inconsistency without mutating the Work Record', () => {
  const record = fixture('workflow-browser-click-status.json');
  record.execution_map.postconditions[0].state_id = 'see_browserlive999';
  const before = JSON.stringify(record);

  const result = checkWorkRecordReportOnly(record);
  const diagnostic = result.diagnostics.find((item) => item.code === 'state_id_inconsistency');

  assert.equal(result.status, 'failed');
  assert.equal(diagnostic.failure_class, 'state_id_inconsistency');
  assert.equal(diagnostic.expected_state_id, 'see_browserlive999');
  assert.equal(diagnostic.actual_state_id, 'see_browserlive001');
  assert.equal(JSON.stringify(record), before);
});
