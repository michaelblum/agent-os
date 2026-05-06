import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  checkWorkRecordReportOnly,
  deriveWorkRecordClaimIndexes,
} from '../../packages/toolkit/workbench/work-record-verifier.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../..');
const v0FixtureRoot = path.join(repoRoot, 'shared/schemas/fixtures/aos-work-record-v0/valid');

function fixture(name) {
  return JSON.parse(fs.readFileSync(path.join(v0FixtureRoot, name), 'utf8'));
}

test('report-only verifier checker derives indexes and does not mutate valid v0 records', () => {
  const record = fixture('playbook-origin.json');
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

test('report-only verifier checker reports internal reference and gate drift', () => {
  const record = fixture('playbook-origin.json');
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
