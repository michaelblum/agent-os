import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  runWorkRecordVerifierProfile,
  WORK_RECORD_REPORT_ONLY_PROFILE_ID,
} from '../../packages/toolkit/workbench/work-record-verifier.js';
import { materializeReplacementWorkRecord } from '../../packages/toolkit/workbench/work-record-replacement-writer.js';
import { replacementProposal } from '../lib/work-record-v1-fixtures.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (relative) => JSON.parse(fs.readFileSync(path.join(repoRoot, relative), 'utf8'));

test('V1 verifier is deterministic, report-only, and authority-neutral', () => {
  const record = read('shared/schemas/fixtures/aos-work-record-v1/valid/workflow-browser-click-status.json');
  const first = runWorkRecordVerifierProfile(record);
  const second = runWorkRecordVerifierProfile(record);
  assert.equal(WORK_RECORD_REPORT_ONLY_PROFILE_ID, 'aos.verifier.work-record.v1.report-only');
  assert.deepEqual(first, second);
  assert.equal(first.status, 'passed');
  assert.equal(first.mutates_record, false);
  assert.doesNotMatch(JSON.stringify(first), /authorization|approval|required_gate|risk_level|allowed_operations|automatic_replay/);
});

test('V1 verifier fails closed on broken claim/evidence references', () => {
  const record = read('shared/schemas/fixtures/aos-work-record-v1/valid/workflow-browser-click-status.json');
  record.claim_results[0].claim_id = 'claim:missing';
  const result = runWorkRecordVerifierProfile(record);
  assert.equal(result.status, 'failed');
  assert.ok(result.diagnostics.length > 0);
});

test('V1 verifier rejects malformed schema bytes and duplicate identity-bearing entries', () => {
  const malformed = {
    type: 'aos.work_record',
    schema_version: '2026-08-work-record-v1',
    id: 'work-record:malformed',
  };
  const malformedResult = runWorkRecordVerifierProfile(malformed);
  assert.equal(malformedResult.status, 'failed');
  assert.ok(malformedResult.diagnostics.some((item) => item.code === 'work_record_v1_schema_invalid'));

  const duplicate = read('shared/schemas/fixtures/aos-work-record-v1/valid/ad-hoc.json');
  duplicate.evidence.push({ ...duplicate.evidence[0], uri: 'artifact:conflicting-duplicate' });
  const duplicateResult = runWorkRecordVerifierProfile(duplicate);
  assert.equal(duplicateResult.status, 'failed');
  assert.ok(duplicateResult.diagnostics.some((item) => item.code === 'duplicate_evidence_id'));
});

test('V1 verifier requires exact evidence-backed postcondition coverage for verified Claim Results', () => {
  const mutations = [
    (result) => { result.postcondition_results = []; result.evidence_refs = []; },
    (result) => { result.postcondition_results.shift(); result.evidence_refs.shift(); },
    (result) => { result.postcondition_results[0].status = 'unchecked'; },
    (result) => { result.postcondition_results[0].evidence_refs = []; },
    (result, record) => {
      result.postcondition_results.push({
        ...structuredClone(record.claim_results[1].postcondition_results[0]),
      });
      result.evidence_refs.push(...record.claim_results[1].evidence_refs);
    },
  ];
  for (const mutate of mutations) {
    const record = read('shared/schemas/fixtures/aos-work-record-v1/valid/workflow-browser-click-status.json');
    mutate(record.claim_results[0], record);
    const result = runWorkRecordVerifierProfile(record);
    assert.equal(result.status, 'failed');
    assert.ok(result.diagnostics.some((item) => [
      'claim_result_postcondition_coverage_mismatch',
      'claim_result_evidence_mapping_mismatch',
      'verified_claim_result_not_proven',
    ].includes(item.code)));
  }
});

test('V1 verifier validates one exact digest row for every Claim when advertised', () => {
  const baseline = materializeReplacementWorkRecord(replacementProposal());
  assert.equal(runWorkRecordVerifierProfile(baseline).status, 'passed');
  const mutations = [
    (record) => { record.claims[0].text = 'fabricated replacement claim text'; },
    (record) => { record.verifier_report.claims_digest.shift(); },
    (record) => { record.verifier_report.claims_digest.push(structuredClone(record.verifier_report.claims_digest[0])); },
    (record) => { record.verifier_report.claims_digest[0].digest = 'sha256:mismatch'; },
  ];
  for (const mutate of mutations) {
    const record = structuredClone(baseline);
    mutate(record);
    const result = runWorkRecordVerifierProfile(record);
    assert.equal(result.status, 'failed');
    assert.ok(result.diagnostics.some((item) => [
      'duplicate_claim_digest_id',
      'claim_digest_coverage_mismatch',
      'claim_digest_mismatch',
    ].includes(item.code)));
  }
});

test('V1 verifier binds bare semantic refs to their enclosing evidence target', () => {
  const record = read('shared/schemas/fixtures/aos-work-record-v1/valid/workflow-browser-click-status.json');
  const after = record.evidence.find((item) => /after-see$/.test(item.id));
  after.target = 'browser:unrelated-surface';
  delete after.metadata.semantic_targets.find((item) => item.ref === 'e3').target;
  const result = runWorkRecordVerifierProfile(record);
  assert.equal(result.status, 'failed');
  assert.ok(result.diagnostics.some((item) => item.code === 'evidence_target_ref_drift'));
});

test('V1 verifier does not collapse whitespace in semantic target identity', () => {
  const record = read('shared/schemas/fixtures/aos-work-record-v1/valid/workflow-browser-click-status.json');
  const postcondition = record.execution_map.postconditions
    .find((item) => item.id === 'postcondition:aos-browser-click-status-after-status');
  postcondition.target = postcondition.target.replace('/e3', '/  e3');
  const result = runWorkRecordVerifierProfile(record);
  assert.equal(result.status, 'failed');
  assert.ok(result.diagnostics.some((item) => item.code === 'evidence_target_ref_drift'));
});

test('V1 verifier compares action targets and State IDs as exact byte carriers', () => {
  const targetRecord = read('shared/schemas/fixtures/aos-work-record-v1/valid/workflow-browser-click-status.json');
  const step = targetRecord.execution_map.steps[0];
  const exactTarget = step.action.target;
  const oneSpaceTarget = exactTarget.replace('/e2', '/ e2');
  step.action.target = exactTarget.replace('/e2', '/  e2');
  step.action.args.target_with_ref = oneSpaceTarget;
  step.action.args.target_resolution.target_with_ref = oneSpaceTarget;
  targetRecord.execution_map.targets
    .filter((target) => target.target === exactTarget)
    .forEach((target) => { target.target = oneSpaceTarget; });
  targetRecord.execution_map.targets
    .flatMap((target) => target.candidates)
    .filter((candidate) => candidate.target === exactTarget)
    .forEach((candidate) => { candidate.target = oneSpaceTarget; });
  targetRecord.evidence
    .filter((item) => item.target === exactTarget)
    .forEach((item) => { item.target = oneSpaceTarget; });
  targetRecord.evidence
    .filter((item) => item.metadata?.target_with_ref === exactTarget)
    .forEach((item) => { item.metadata.target_with_ref = oneSpaceTarget; });
  const targetResult = runWorkRecordVerifierProfile(targetRecord);
  assert.equal(targetResult.status, 'failed');
  assert.ok(targetResult.diagnostics.some((item) => item.code === 'target_ref_drift'));

  const stateRecord = read('shared/schemas/fixtures/aos-work-record-v1/valid/workflow-browser-click-status.json');
  const postcondition = stateRecord.execution_map.postconditions[0];
  const evidence = stateRecord.evidence.find((item) => item.id === postcondition.evidence_refs[0]);
  postcondition.state_id = 'state  exact  identity';
  evidence.state_id = 'state exact identity';
  const stateResult = runWorkRecordVerifierProfile(stateRecord);
  assert.equal(stateResult.status, 'failed');
  assert.ok(stateResult.diagnostics.some((item) => item.code === 'state_id_inconsistency'));
});

test('V1 verifier evaluates exact falsy semantic expectations', () => {
  const record = read('shared/schemas/fixtures/aos-work-record-v1/valid/workflow-browser-click-status.json');
  const postcondition = record.execution_map.postconditions
    .find((item) => item.id === 'postcondition:aos-browser-click-status-after-status');
  postcondition.check = { kind: 'semantic_target_value_equals', ref: 'e3', expected: '' };
  const result = runWorkRecordVerifierProfile(record);
  assert.equal(result.status, 'failed');
  assert.ok(result.diagnostics.some((item) => item.code === 'semantic_target_value_mismatch'));
});

test('V1 verifier rejects known but unrelated evidence substituted into a Claim Result', () => {
  const record = read('shared/schemas/fixtures/aos-work-record-v1/valid/workflow-browser-click-status.json');
  const result = record.claim_results
    .find((item) => /post-action-state-observed$/.test(item.claim_id));
  result.evidence_refs = ['evidence:aos-browser-click-status-before-see'];
  result.postcondition_results[0].evidence_refs = ['evidence:aos-browser-click-status-before-see'];
  const report = runWorkRecordVerifierProfile(record);
  assert.equal(report.status, 'failed');
  assert.ok(report.diagnostics.some((item) => item.code === 'postcondition_result_evidence_mismatch'));
});

test('V1 verifier requires every supplied semantic identity constraint to match one candidate', () => {
  const record = read('shared/schemas/fixtures/aos-work-record-v1/valid/workflow-browser-click-status.json');
  const postcondition = record.execution_map.postconditions
    .find((item) => item.id === 'postcondition:aos-browser-click-status-after-status');
  postcondition.check.semantic_ref = 'fabricated.semantic.target';
  const report = runWorkRecordVerifierProfile(record);
  assert.equal(report.status, 'failed');
  assert.ok(report.diagnostics.some((item) => item.code === 'semantic_target_identity_mismatch'));
});

test('V1 verifier treats missing required semantic enabled state as unproven', () => {
  const record = read('shared/schemas/fixtures/aos-work-record-v1/valid/workflow-browser-click-status.json');
  const postcondition = record.execution_map.postconditions
    .find((item) => item.id === 'postcondition:aos-browser-click-status-after-status');
  postcondition.check.enabled = true;
  const afterEvidence = record.evidence.find((item) => /after-see$/.test(item.id));
  delete afterEvidence.metadata.semantic_targets.find((item) => item.ref === 'e3').enabled;
  const executionTarget = record.execution_map.targets.find((item) => /postcondition-ref$/.test(item.id));
  delete executionTarget.candidates.find((item) => item.ref === 'e3').enabled;
  const report = runWorkRecordVerifierProfile(record);
  assert.equal(report.status, 'failed');
  assert.ok(report.diagnostics.some((item) => item.code === 'semantic_target_state_mismatch'));
});

test('V1 verifier evaluates primitive role and name equality expectations', () => {
  for (const [kind, expected] of [
    ['semantic_target_role_equals', 'button'],
    ['semantic_target_name_equals', 'Fabricated status name'],
  ]) {
    const record = read('shared/schemas/fixtures/aos-work-record-v1/valid/workflow-browser-click-status.json');
    const postcondition = record.execution_map.postconditions
      .find((item) => item.id === 'postcondition:aos-browser-click-status-after-status');
    postcondition.check = { kind, ref: 'e3', expected };
    const report = runWorkRecordVerifierProfile(record);
    assert.equal(report.status, 'failed');
    assert.ok(report.diagnostics.some((item) => item.code === 'semantic_target_role_name_mismatch'));
  }

  const incomplete = read('shared/schemas/fixtures/aos-work-record-v1/valid/workflow-browser-click-status.json');
  const postcondition = incomplete.execution_map.postconditions
    .find((item) => item.id === 'postcondition:aos-browser-click-status-after-status');
  postcondition.check = { kind: 'semantic_target_role_name_equals', ref: 'e3', expected: { role: 'status' } };
  const report = runWorkRecordVerifierProfile(incomplete);
  assert.equal(report.status, 'failed');
  assert.ok(report.diagnostics.some((item) => item.code === 'semantic_target_role_name_expectation_incomplete'));
});

test('V1 verifier rejects V0 rather than dual-reading it', () => {
  const historical = read('shared/schemas/fixtures/aos-work-record-v0/valid/workflow-origin.json');
  assert.equal(runWorkRecordVerifierProfile(historical).status, 'unsupported');
});
