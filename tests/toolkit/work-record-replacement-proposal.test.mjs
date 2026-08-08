import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  buildWorkRecordReplacementProposal,
  validateWorkRecordReplacementProposal,
} from '../../packages/toolkit/workbench/work-record-replacement-proposal.js';
import { materializeReplacementWorkRecord, writeReplacementWorkRecord } from '../../packages/toolkit/workbench/work-record-replacement-writer.js';
import { planWorkRecordRepair, planWorkRecordRepairAttempt } from '../../packages/toolkit/workbench/work-record.js';
import { attemptPlan, readJson, repairableWorkRecordPath, replacementProposal, repoRoot, successfulAttemptArtifact } from '../lib/work-record-v1-fixtures.mjs';

test('Replacement Proposal V1 preserves source evidence and exact plan/artifact identities', () => {
  const proposal = replacementProposal();
  assert.equal(proposal.status, 'proposed');
  assert.equal(proposal.schema_version, '2026-08-work-record-replacement-proposal-v1');
  assert.equal(proposal.proposed_replacement_work_record.schema_version, '2026-08-work-record-v1');
  assert.equal(proposal.proposed_replacement_work_record.persisted, false);
  const source = readJson(repairableWorkRecordPath);
  assert.notDeepEqual(proposal.proposed_replacement_work_record.execution_map, source.execution_map);
  assert.equal(proposal.proposed_replacement_work_record.execution_map.steps[0].action.args.current_validation.status, 'resolved');
  assert.equal(proposal.proposed_replacement_work_record.execution_map.targets.find((target) => /postcondition-ref/.test(target.id)).candidates[0].value, 'Ada');
  assert.equal(validateWorkRecordReplacementProposal(proposal).status, 'passed');
  assert.deepEqual(proposal.proposed_replacement_work_record.metadata, {
    ...source.metadata,
    replacement_proposal: true,
    writes_replacement_record: false,
    persisted_by_writer: false,
  });
  assert.doesNotMatch(JSON.stringify(proposal), /workflow_gate|authorization|approval|required_risk|risk_level|allowlisted|allowed_operations|controlled_fixture|automatic_replay/);
});

test('Replacement Proposal permits only the execution-map and defined replacement deltas', () => {
  const mutations = [
    (proposal) => { proposal.proposed_replacement_work_record.label = 'fabricated label'; },
    (proposal) => { proposal.proposed_replacement_work_record.origin.kind = 'fabricated'; },
    (proposal) => { proposal.proposed_replacement_work_record.intent.summary = 'fabricated intent'; },
    (proposal) => { proposal.proposed_replacement_work_record.claims[0].text = 'fabricated claim'; },
    (proposal) => { proposal.proposed_replacement_work_record.claims.pop(); },
    (proposal) => { proposal.proposed_replacement_work_record.claims.push(structuredClone(proposal.proposed_replacement_work_record.claims[0])); },
    (proposal) => { proposal.proposed_replacement_work_record.references[0].ref = 'fabricated:reference'; },
    (proposal) => { proposal.proposed_replacement_work_record.metadata.generated_by = 'fabricated'; },
    (proposal) => { proposal.proposed_replacement_work_record.evidence_refs.push('evidence:fabricated-extra'); },
    (proposal) => { proposal.proposed_replacement_work_record.evidence_refs.push(proposal.proposed_replacement_work_record.evidence_refs[0]); },
    (proposal) => { proposal.postcondition_evidence_map.pop(); },
    (proposal) => { proposal.postcondition_evidence_map.push(structuredClone(proposal.postcondition_evidence_map[0])); },
  ];
  for (const mutate of mutations) {
    const proposal = structuredClone(replacementProposal());
    mutate(proposal);
    assert.equal(validateWorkRecordReplacementProposal(proposal).status, 'failed');
  }
});

test('Replacement Proposal fails closed without overwriting reserved source metadata', () => {
  const plan = attemptPlan();
  const source = readJson(repairableWorkRecordPath);
  source.metadata.replacement_proposal = 'caller-owned proposal marker';
  source.metadata.persisted_by_writer = 'caller-owned persistence marker';
  source.metadata.replacement_writer = { caller_owned: true };
  const proposal = buildWorkRecordReplacementProposal({
    source_work_record: { ...plan.source_work_record, record: source },
    repair_attempt_plan: plan,
    repair_attempt_artifact: successfulAttemptArtifact(plan),
  });
  assert.equal(proposal.status, 'blocked_source_metadata_collision');
  assert.deepEqual(proposal.proposed_replacement_work_record.metadata, source.metadata);
  assert.ok(proposal.diagnostics.some((item) => item.code === 'REPLACEMENT_PROPOSAL_SOURCE_METADATA_COLLISION'));
  assert.throws(
    () => materializeReplacementWorkRecord(proposal),
    /REPLACEMENT_PROPOSAL_SOURCE_METADATA_COLLISION/,
  );
  assert.equal(writeReplacementWorkRecord({
    proposal,
    outputRoot: fs.mkdtempSync(path.join(os.tmpdir(), 'aos-replacement-metadata-collision-v1-')),
    dryRun: true,
  }).status, 'blocked_invalid_proposal');
});

test('Replacement Proposal fails closed on plan mismatch and missing evidence', () => {
  const plan = attemptPlan();
  const artifact = successfulAttemptArtifact(plan);
  artifact.repair_attempt_plan.digest = 'stale';
  const stale = buildWorkRecordReplacementProposal({
    source_work_record: { ...plan.source_work_record, record: readJson(repairableWorkRecordPath) },
    repair_attempt_plan: plan,
    repair_attempt_artifact: artifact,
  });
  assert.notEqual(stale.status, 'proposed');

  const wrongSourcePlan = structuredClone(plan);
  wrongSourcePlan.source_work_record.digest = 'different-source-bytes';
  const sourceMismatch = buildWorkRecordReplacementProposal({
    source_work_record: { ...plan.source_work_record, record: readJson(repairableWorkRecordPath) },
    repair_attempt_plan: wrongSourcePlan,
    repair_attempt_artifact: successfulAttemptArtifact(plan),
  });
  assert.notEqual(sourceMismatch.status, 'proposed');
});

test('Replacement Proposal rejects malformed proposed execution-map structure', () => {
  const plan = attemptPlan();
  const artifact = successfulAttemptArtifact(plan);
  artifact.candidate_patch_outcomes[0].proposed_execution_map = { postconditions: {} };
  const proposal = buildWorkRecordReplacementProposal({
    source_work_record: { ...plan.source_work_record, record: readJson(repairableWorkRecordPath) },
    repair_attempt_plan: plan,
    repair_attempt_artifact: artifact,
  });
  assert.notEqual(proposal.status, 'proposed');
});

test('Replacement Proposal identity binds every writer-relevant mirror', () => {
  for (const mutate of [
    (proposal) => { proposal.proposed_replacement_work_record.id = 'work-record:tampered'; },
    (proposal) => { proposal.proposed_replacement_work_record.label = 'tampered'; },
    (proposal) => { proposal.replacement_proposal_identity.id = 'work-record-replacement-proposal:tampered'; },
    (proposal) => { proposal.repair_attempt_plan.digest = 'tampered'; },
    (proposal) => { proposal.verifier_before.health_verdict = 'fabricated'; },
    (proposal) => { proposal.verifier_after.health_verdict = 'fabricated'; },
    (proposal) => { proposal.supersedes.verifier_after_health = 'fabricated'; },
    (proposal) => { proposal.claim_provenance[0].claim_id = 'claim:fabricated'; },
    (proposal) => { proposal.final_proposed_health.derived_from = 'fabricated'; },
  ]) {
    const proposal = structuredClone(replacementProposal());
    mutate(proposal);
    assert.equal(validateWorkRecordReplacementProposal(proposal).status, 'failed');
    assert.equal(writeReplacementWorkRecord({ proposal, outputRoot: '/tmp/aos-tampered-proposal', dryRun: true }).status, 'blocked_invalid_proposal');
  }
});

test('Replacement Proposal rejects an artifact whose Attempt Plan mirror differs', () => {
  const plan = attemptPlan();
  const artifact = successfulAttemptArtifact(plan);
  artifact.repair_attempt_plan.attempt_identity.attempt_id = 'work-record-repair-attempt:tampered';
  const result = buildWorkRecordReplacementProposal({
    source_work_record: { ...plan.source_work_record, record: readJson(repairableWorkRecordPath) },
    repair_attempt_plan: plan,
    repair_attempt_artifact: artifact,
  });
  assert.notEqual(result.status, 'proposed');
});

test('Replacement Proposal cannot silently omit any source evidence', () => {
  const plan = attemptPlan();
  const artifact = successfulAttemptArtifact(plan);
  const source = readJson(repairableWorkRecordPath);
  const digest = crypto.createHash('sha256').update(fs.readFileSync(repairableWorkRecordPath)).digest('hex');
  const proposal = buildWorkRecordReplacementProposal({
    source_work_record: { ...plan.source_work_record, record: source, digest },
    repair_attempt_plan: plan,
    repair_attempt_artifact: artifact,
    evidence_policy: {
      carried_forward_evidence: [{ source_evidence_id: source.evidence[0].id }],
    },
  });
  assert.equal(proposal.status, 'blocked_missing_evidence');
  assert.ok(validateWorkRecordReplacementProposal(proposal).diagnostics
    .some((item) => item.code === 'REPLACEMENT_PROPOSAL_SOURCE_EVIDENCE_COVERAGE_MISMATCH'));
  const materializedIds = new Set(materializeReplacementWorkRecord(proposal).evidence.map((item) => item.id));
  assert.ok(source.evidence.every((item) => materializedIds.has(item.id)));
  assert.equal(writeReplacementWorkRecord({ proposal, outputRoot: '/tmp/aos-evidence-omission', dryRun: true }).status, 'blocked_invalid_proposal');
});

test('Proposal and Writer preserve source label whitespace exactly', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aos-label-fidelity-v1-'));
  const sourcePath = path.join(root, 'source.json');
  const source = readJson(repairableWorkRecordPath);
  source.label = 'Repairable  label';
  fs.writeFileSync(sourcePath, `${JSON.stringify(source, null, 2)}\n`);
  const repairPlan = planWorkRecordRepair(sourcePath, { repoRoot, roots: [root] });
  const plan = planWorkRecordRepairAttempt(sourcePath, { repoRoot, roots: [root], repairPlan });
  const proposal = replacementProposal(plan, successfulAttemptArtifact(plan), sourcePath);
  assert.equal(proposal.status, 'proposed');
  assert.equal(proposal.proposed_replacement_work_record.label, source.label);
  const writer = writeReplacementWorkRecord({ proposal, outputRoot: path.join(root, 'records'), dryRun: true });
  assert.equal(writer.status, 'dry_run');
  assert.equal(materializeReplacementWorkRecord(proposal).label, source.label);
});
