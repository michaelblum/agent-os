import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  buildWorkRecordGateRequestFromRepairPlan,
  buildWorkRecordRepairAttemptArtifact,
  buildWorkRecordReplacementProposal,
  planWorkRecordRepair,
  planWorkRecordRepairAttempt,
  readWorkRecord,
  validateWorkRecordReplacementProposal,
  WORK_RECORD_REPLACEMENT_PROPOSAL_SCHEMA_VERSION,
  WORK_RECORD_REPLACEMENT_PROPOSAL_STATUSES,
} from '../../packages/toolkit/workbench/work-record.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../..');
const repairableFixture = path.join(repoRoot, 'shared/schemas/fixtures/aos-work-record-v0/valid/repairable-stale-saved-ref.json');

function runAos(args) {
  return spawnSync('./aos', args, {
    cwd: repoRoot,
    encoding: 'utf8',
  });
}

function writeTempJson(value, prefix = 'aos-work-record-replacement-proposal-') {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  const file = path.join(dir, 'payload.json');
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
  return file;
}

function approvedRecord(request, response = { authorization: 'approve' }) {
  return {
    schema_version: 'aos.gate.record.v1',
    gate_id: request.gate_request.id,
    request_schema_version: 'aos.gate.request.v1',
    prompt_title: request.gate_request.prompt.title,
    source: { surface: 'work_record.repair_plan', session_id: null, agent: null },
    receptor: 'test',
    ui_variant: 'approve_deny',
    field_kinds: ['exclusive_choice'],
    timeout_ms: 0,
    created_at: '2026-07-04T00:00:00.000Z',
    presented_at: '2026-07-04T00:00:00.000Z',
    resolved_at: '2026-07-04T00:00:01.000Z',
    elapsed_ms: 1000,
    resolution: 'answered',
    status: null,
    response_stored: true,
    response,
  };
}

function readyAttemptPlan() {
  const repairPlan = planWorkRecordRepair(repairableFixture, { repoRoot });
  const request = buildWorkRecordGateRequestFromRepairPlan(repairPlan);
  return planWorkRecordRepairAttempt(repairableFixture, {
    repoRoot,
    gateOutcome: approvedRecord(request),
  });
}

function evidenceRequirementIds(plan) {
  return [...new Set([
    ...plan.planned_operations.flatMap((operation) => operation.evidence_requirement_refs || []),
    ...plan.evidence_requirements
      .filter((requirement) => requirement.required === true)
      .map((requirement) => requirement.id),
  ]
    .filter(Boolean))]
    .sort();
}

function successArtifactInput({ status = 'succeeded', overrides = {} } = {}) {
  const plan = readyAttemptPlan();
  const evidenceIds = evidenceRequirementIds(plan);
  const operationOutcomes = plan.planned_operations.map((operation, index) => ({
    id: `operation-outcome:${index + 1}`,
    planned_operation_id: operation.id,
    kind: operation.kind,
    status: operation.mutates_state ? 'succeeded' : 'skipped',
    started_at: '2026-07-04T00:00:00.000Z',
    finished_at: '2026-07-04T00:00:01.000Z',
    mutated_state: operation.mutates_state,
    target_boundary: operation.target_boundary,
    authorization_ref: operation.authorization_ref,
    evidence_ref_ids: operation.evidence_requirement_refs || [],
    cleanup_required: operation.mutates_state,
    rollback_required: false,
  }));
  return {
    status,
    repair_attempt_plan: plan,
    operation_outcomes: operationOutcomes,
    candidate_patch_outcomes: [{
      id: 'candidate-patch-outcome:execution-map-refs',
      candidate_patch_id: 'candidate_patch:execution_map_refs',
      status: 'applied',
      applied: true,
      evidence_ref_ids: ['evidence_requirement:patch:candidate_patch:execution_map_refs'],
    }],
    recommended_command_outcomes: plan.recommended_commands.map((command, index) => ({
      id: `recommended-command-outcome:${index + 1}`,
      command_ref: command.command,
      status: 'skipped',
      executed: false,
    })),
    evidence_refs: evidenceIds.map((id) => ({ id, uri: `artifact:${id}.json`, digest: `digest:${id}` })),
    verifier_before: { status: 'failed', health_verdict: 'repairable' },
    verifier_after: { status: 'passed', health_verdict: 'valid' },
    postcondition_results: plan.postconditions.map((postcondition) => ({
      id: `postcondition-result:${postcondition.id}`,
      postcondition_id: postcondition.id,
      status: 'passed',
      evidence_ref_ids: evidenceIds,
    })),
    cleanup_results: operationOutcomes
      .filter((outcome) => outcome.cleanup_required)
      .map((outcome) => ({
        id: `cleanup:${outcome.id}`,
        operation_outcome_id: outcome.id,
        status: 'passed',
        evidence_ref_ids: outcome.evidence_ref_ids,
      })),
    rollback_results: [],
    source_work_record_mutation_check: {
      status: 'passed',
      before_digest: 'source-before',
      after_digest: 'source-before',
    },
    ...overrides,
  };
}

function sourceInput() {
  const read = readWorkRecord(repairableFixture, { repoRoot });
  assert.equal(read.status, 'success');
  return {
    ...read.summary,
    ...read.source,
    record: read.record,
    requested_ref: repairableFixture,
    digest: 'source-before',
  };
}

function buildProposal({ artifactInput = successArtifactInput(), proposalInput = {} } = {}) {
  const artifact = buildWorkRecordRepairAttemptArtifact(artifactInput);
  return buildWorkRecordReplacementProposal({
    source_work_record: sourceInput(),
    repair_attempt_plan: artifactInput.repair_attempt_plan,
    repair_attempt_artifact: artifact,
    source_work_record_digest_after: 'source-before',
    proposed_id_seed: 'work-record:repairable-stale-saved-ref-replacement-proposal-test',
    ...proposalInput,
  });
}

function assertValid(proposal) {
  const validation = validateWorkRecordReplacementProposal(proposal);
  assert.equal(validation.status, 'passed', JSON.stringify(validation.diagnostics, null, 2));
  assert.equal(validation.read_only, true);
  assert.equal(validation.mutates_state, false);
  assert.equal(validation.writes_replacement_record, false);
  assert.equal(validation.mutates_source_record, false);
  assert.equal(validation.executes_repair, false);
  assert.equal(validation.executes_actions, false);
  assert.equal(validation.applies_patches, false);
  assert.equal(validation.automatic_replay_allowed, false);
}

test('builder emits deterministic non-writing Replacement Proposal V0', () => {
  const first = buildProposal();
  const second = buildProposal();

  assert.deepEqual(first, second);
  assert.equal(first.type, 'work_record.replacement_proposal');
  assert.equal(first.schema_version, WORK_RECORD_REPLACEMENT_PROPOSAL_SCHEMA_VERSION);
  assert.equal(first.status, 'proposed');
  assert.equal(first.writes_replacement_record, false);
  assert.equal(first.mutates_source_record, false);
  assert.equal(first.rewrites_historical_evidence, false);
  assert.equal(first.executes_repair, false);
  assert.equal(first.executes_actions, false);
  assert.equal(first.applies_patches, false);
  assert.equal(first.automatic_replay_allowed, false);
  assert.equal(first.proposed_replacement_work_record.persisted, false);
  assert.equal(first.proposed_replacement_work_record.proposal_only, true);
  assert.equal(first.supersedes.persisted, false);
  assert.ok(first.carried_forward_evidence.length > 0);
  assert.ok(first.new_evidence.length > 0);
  assert.equal(first.final_proposed_health.classification, 'valid');
  assert.ok(first.replacement_proposal_identity.id.startsWith('work-record-replacement-proposal:'));
  assertValid(first);
});

test('builder preserves distinct evidence refs per replacement postcondition', () => {
  const source = sourceInput();
  const [firstPostcondition, secondPostcondition] = source.record.execution_map.postconditions;
  const artifactInput = successArtifactInput({
    overrides: {
      evidence_refs: [
        ...successArtifactInput().evidence_refs,
        { id: 'evidence:postcondition-one', uri: 'artifact:evidence-one.json', digest: 'digest:evidence-one' },
        { id: 'evidence:postcondition-two', uri: 'artifact:evidence-two.json', digest: 'digest:evidence-two' },
      ],
      postcondition_results: [
        {
          id: `postcondition-result:${firstPostcondition.id}`,
          postcondition_id: firstPostcondition.id,
          status: 'passed',
          evidence_ref_ids: ['evidence:postcondition-one'],
        },
        {
          id: `postcondition-result:${secondPostcondition.id}`,
          postcondition_id: secondPostcondition.id,
          status: 'passed',
          evidence_ref_ids: ['evidence:postcondition-two'],
        },
      ],
    },
  });
  const proposal = buildProposal({ artifactInput });
  assertValid(proposal);

  const firstMapping = proposal.postcondition_evidence_map.find((item) => item.postcondition_id === firstPostcondition.id);
  const secondMapping = proposal.postcondition_evidence_map.find((item) => item.postcondition_id === secondPostcondition.id);
  assert.deepEqual(firstMapping.evidence_refs, ['replacement:evidence:postcondition-one']);
  assert.deepEqual(secondMapping.evidence_refs, ['replacement:evidence:postcondition-two']);
  assert.notDeepEqual(firstMapping.evidence_refs, secondMapping.evidence_refs);
});

test('all required proposal statuses are declared', () => {
  for (const status of [
    'proposed',
    'not_required',
    'blocked_attempt_failed',
    'blocked_attempt_partial',
    'blocked_missing_evidence',
    'blocked_source_mutated',
    'blocked_health_mismatch',
    'stale',
    'mismatch',
    'unsupported',
  ]) {
    assert.ok(WORK_RECORD_REPLACEMENT_PROPOSAL_STATUSES.includes(status));
  }
});

test('builder fails closed for failed, partial, missing-evidence, mutated, mismatch, stale, and unsupported artifacts', () => {
  const failedInput = successArtifactInput({ status: 'failed' });
  failedInput.operation_outcomes[0].status = 'failed';
  assert.equal(buildProposal({ artifactInput: failedInput }).status, 'blocked_attempt_failed');

  const partialInput = successArtifactInput({ status: 'partial' });
  partialInput.operation_outcomes[0].status = 'failed';
  partialInput.operation_outcomes[0].rollback_required = true;
  partialInput.rollback_results = [{ id: 'rollback:partial', operation_outcome_id: partialInput.operation_outcomes[0].id, status: 'passed' }];
  assert.equal(buildProposal({ artifactInput: partialInput }).status, 'blocked_attempt_partial');

  const cleanupFailedInput = successArtifactInput({ status: 'cleanup_failed' });
  cleanupFailedInput.operation_outcomes[1].status = 'cleanup_failed';
  cleanupFailedInput.cleanup_results[0].status = 'failed';
  assert.equal(buildProposal({ artifactInput: cleanupFailedInput }).status, 'blocked_attempt_failed');

  const rollbackFailedInput = successArtifactInput({ status: 'rollback_failed' });
  rollbackFailedInput.operation_outcomes[1].status = 'failed';
  rollbackFailedInput.operation_outcomes[1].rollback_required = true;
  rollbackFailedInput.rollback_results = [{ id: 'rollback:failed', operation_outcome_id: rollbackFailedInput.operation_outcomes[1].id, status: 'failed' }];
  assert.equal(buildProposal({ artifactInput: rollbackFailedInput }).status, 'blocked_attempt_failed');

  const missingEvidenceInput = successArtifactInput({ overrides: { evidence_refs: [] } });
  assert.equal(buildProposal({ artifactInput: missingEvidenceInput }).status, 'blocked_missing_evidence');

  const mutatedInput = successArtifactInput({ overrides: { source_work_record_mutated: true } });
  assert.equal(buildProposal({ artifactInput: mutatedInput }).status, 'blocked_source_mutated');

  const contradictedHealthInput = successArtifactInput();
  const contradictedHealthArtifact = {
    ...buildWorkRecordRepairAttemptArtifact(contradictedHealthInput),
    final_health: { classification: 'valid' },
    verifier_after: { status: 'failed', health_verdict: 'repairable' },
  };
  const contradictedHealth = buildWorkRecordReplacementProposal({
    source_work_record: sourceInput(),
    repair_attempt_plan: contradictedHealthInput.repair_attempt_plan,
    repair_attempt_artifact: contradictedHealthArtifact,
    source_work_record_digest_after: 'source-before',
  });
  assert.equal(contradictedHealth.status, 'blocked_health_mismatch');

  const unsupportedInput = successArtifactInput({ status: 'unsupported' });
  unsupportedInput.operation_outcomes = [];
  unsupportedInput.candidate_patch_outcomes = [];
  unsupportedInput.postcondition_results = [];
  unsupportedInput.cleanup_results = [];
  unsupportedInput.verifier_after = null;
  assert.equal(buildProposal({ artifactInput: unsupportedInput }).status, 'unsupported');

  const artifactInput = successArtifactInput();
  const artifact = buildWorkRecordRepairAttemptArtifact(artifactInput);
  const mismatched = buildWorkRecordReplacementProposal({
    source_work_record: { ...sourceInput(), record: { ...sourceInput().record, id: 'work-record:other' } },
    repair_attempt_plan: artifactInput.repair_attempt_plan,
    repair_attempt_artifact: artifact,
    source_work_record_digest_after: 'source-before',
  });
  assert.equal(mismatched.status, 'mismatch');

  const stale = buildWorkRecordReplacementProposal({
    source_work_record: sourceInput(),
    repair_attempt_plan: { ...artifactInput.repair_attempt_plan, recommended_next: { action: 'changed' } },
    repair_attempt_artifact: artifact,
    source_work_record_digest_after: 'source-before',
  });
  assert.equal(stale.status, 'stale');

  const notRequiredInput = successArtifactInput();
  notRequiredInput.repair_attempt_plan = {
    ...notRequiredInput.repair_attempt_plan,
    status: 'not_required',
  };
  const notRequiredArtifact = buildWorkRecordRepairAttemptArtifact(notRequiredInput);
  const notRequired = buildWorkRecordReplacementProposal({
    source_work_record: sourceInput(),
    repair_attempt_plan: notRequiredInput.repair_attempt_plan,
    repair_attempt_artifact: notRequiredArtifact,
    source_work_record_digest_after: 'source-before',
  });
  assert.equal(notRequired.status, 'not_required');
});

test('validator rejects writing flags, omitted evidence without reason, and historical rewrites', () => {
  const base = buildProposal();
  const cases = [
    ['REPLACEMENT_PROPOSAL_NON_WRITING_FLAG_NOT_FALSE', { writes_replacement_record: true }],
    ['OMITTED_EVIDENCE_REASON_MISSING', { omitted_evidence: [{ source_evidence_id: 'evidence:x', replacement_impact: 'none' }] }],
    ['CLAIM_PROVENANCE_REWRITES_HISTORY', { claim_provenance: [{ ...base.claim_provenance[0], historical_claim_results_rewritten: true }] }],
    ['REPLACEMENT_PROPOSAL_HEALTH_MISMATCH', { final_proposed_health: { ...base.final_proposed_health, classification: 'repairable' } }],
    ['REPLACEMENT_PROPOSAL_SOURCE_MUTATED', { source_work_record_mutation_check: { ...base.source_work_record_mutation_check, status: 'failed' } }],
    ['CARRIED_FORWARD_EVIDENCE_NOT_IN_SOURCE', { source_work_record: { ...base.source_work_record, evidence_ids: ['evidence:wrong'] } }],
    ['NEW_EVIDENCE_NOT_IN_ARTIFACT', { repair_attempt_artifact: { ...base.repair_attempt_artifact, evidence_ids: ['evidence:wrong'] } }],
  ];

  for (const [code, patch] of cases) {
    const validation = validateWorkRecordReplacementProposal({ ...base, ...patch });
    assert.equal(validation.status, 'failed');
    assert.ok(validation.diagnostics.some((diagnostic) => diagnostic.code === code), JSON.stringify(validation.diagnostics, null, 2));
  }
});

test('public replacement-proposal commands are read-only and do not write Work Records', () => {
  const help = runAos(['help', 'work-record', '--json']);
  assert.equal(help.status, 0, help.stderr);
  const helpJson = JSON.parse(help.stdout);
  for (const id of ['work-record-replacement-proposal-build', 'work-record-replacement-proposal-validate']) {
    const form = helpJson.forms.find((item) => item.id === id);
    assert.ok(form, `${id} should be in help`);
    assert.equal(form.execution.read_only, true);
    assert.equal(form.execution.mutates_state, false);
    assert.equal(form.execution.writes_replacement_record, false);
    assert.equal(form.execution.mutates_source_record, false);
    assert.equal(form.execution.executes_repair, false);
    assert.equal(form.execution.executes_actions, false);
    assert.equal(form.execution.applies_patches, false);
    assert.equal(form.execution.automatic_replay_allowed, false);
  }

  const before = fs.readFileSync(repairableFixture, 'utf8');
  const artifactInput = successArtifactInput();
  const planPath = writeTempJson(artifactInput.repair_attempt_plan, 'aos-work-record-replacement-proposal-plan-');
  const artifactPath = writeTempJson(buildWorkRecordRepairAttemptArtifact(artifactInput), 'aos-work-record-replacement-proposal-artifact-');
  const build = runAos([
    'work-record',
    'replacement-proposal',
    'build',
    '--source',
    repairableFixture,
    '--attempt-plan',
    planPath,
    '--attempt-artifact',
    artifactPath,
    '--proposed-id-seed',
    'work-record:repairable-stale-saved-ref-cli-replacement',
    '--json',
  ]);
  assert.equal(build.status, 0, build.stderr);
  const proposal = JSON.parse(build.stdout);
  assert.equal(proposal.type, 'work_record.replacement_proposal');
  assert.equal(proposal.status, 'proposed');
  assert.equal(proposal.writes_replacement_record, false);

  const proposalPath = writeTempJson(proposal);
  const validate = runAos(['work-record', 'replacement-proposal', 'validate', proposalPath, '--json']);
  assert.equal(validate.status, 0, validate.stderr);
  assert.equal(JSON.parse(validate.stdout).status, 'passed');
  assert.equal(fs.readFileSync(repairableFixture, 'utf8'), before);
});
