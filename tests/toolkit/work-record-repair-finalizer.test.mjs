import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  buildWorkRecordGateRequestFromRepairPlan,
  buildWorkRecordRepairAttemptArtifact,
  buildWorkRecordReplacementProposal,
  finalizeWorkRecordRepair,
  lookupWorkRecordSourceSupersession,
  planWorkRecordRepair,
  planWorkRecordRepairAttempt,
  readWorkRecord,
  validateWorkRecordSourceSupersessionEntry,
  writeReplacementWorkRecord,
  writeWorkRecordSourceSupersessionIndex,
  WORK_RECORD_REPAIR_FINALIZATION_RESULT_SCHEMA_VERSION,
  WORK_RECORD_REPAIR_FINALIZATION_STATUSES,
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

function digestFile(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function writeTempJson(value, prefix = 'aos-work-record-repair-finalizer-') {
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
  ].filter(Boolean))].sort();
}

function artifactInput({ status = 'succeeded', overrides = {} } = {}) {
  const plan = readyAttemptPlan();
  const evidenceIds = evidenceRequirementIds(plan);
  const operationOutcomes = plan.planned_operations.map((operation, index) => ({
    id: `operation-outcome:${index + 1}`,
    planned_operation_id: operation.id,
    kind: operation.kind,
    status: operation.mutates_state ? (status === 'succeeded' ? 'succeeded' : status) : 'skipped',
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
      status: status === 'succeeded' ? 'applied' : 'failed',
      applied: status === 'succeeded',
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
    verifier_after: status === 'succeeded' ? { status: 'passed', health_verdict: 'valid' } : null,
    postcondition_results: plan.postconditions.map((postcondition) => ({
      id: `postcondition-result:${postcondition.id}`,
      postcondition_id: postcondition.id,
      status: status === 'succeeded' ? 'passed' : 'failed',
      evidence_ref_ids: evidenceIds,
    })),
    cleanup_results: operationOutcomes
      .filter((outcome) => outcome.cleanup_required)
      .map((outcome) => ({
        id: `cleanup:${outcome.id}`,
        operation_outcome_id: outcome.id,
        status: status === 'cleanup_failed' ? 'failed' : 'passed',
        evidence_ref_ids: outcome.evidence_ref_ids,
      })),
    rollback_results: status === 'rollback_failed' ? [{
      id: 'rollback:operation-outcome:1',
      operation_outcome_id: 'operation-outcome:1',
      status: 'failed',
      evidence_ref_ids: evidenceIds,
    }] : [],
    source_work_record_mutation_check: {
      status: 'passed',
      before_digest: digestFile(repairableFixture),
      after_digest: digestFile(repairableFixture),
    },
    ...overrides,
  };
}

function writeAttemptInputs(input = artifactInput()) {
  const planPath = writeTempJson(input.repair_attempt_plan, 'aos-work-record-finalizer-plan-');
  const artifact = buildWorkRecordRepairAttemptArtifact(input);
  const artifactPath = writeTempJson(artifact, 'aos-work-record-finalizer-artifact-');
  return { planPath, artifactPath, artifact };
}

function finalizeArgs({ input = artifactInput(), replacementRoot = null, indexRoot = null, proposedIdSeed = 'work-record:repairable-stale-saved-ref-finalizer-test', dryRun = false, replacementOutputPath = '' } = {}) {
  const { planPath, artifactPath } = writeAttemptInputs(input);
  return {
    sourceRef: repairableFixture,
    attemptPlanPath: planPath,
    attemptArtifactPath: artifactPath,
    replacementRoot: replacementRoot || fs.mkdtempSync(path.join(os.tmpdir(), 'aos-work-record-finalizer-replacements-')),
    indexRoot: indexRoot || fs.mkdtempSync(path.join(os.tmpdir(), 'aos-work-record-finalizer-index-')),
    proposedIdSeed,
    replacementOutputPath,
    dryRun,
    repoRoot,
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
    digest: digestFile(repairableFixture),
  };
}

function replacementProposalFromInput(input, artifact, proposedIdSeed) {
  return buildWorkRecordReplacementProposal({
    source_work_record: sourceInput(),
    repair_attempt_plan: input.repair_attempt_plan,
    repair_attempt_artifact: artifact,
    source_work_record_digest_after: digestFile(repairableFixture),
    proposed_id_seed: proposedIdSeed,
  });
}

test('Repair Finalization statuses are declared', () => {
  for (const status of [
    'dry_run',
    'finalized',
    'already_finalized',
    'not_required',
    'blocked_invalid_source',
    'blocked_invalid_attempt_plan',
    'blocked_invalid_attempt_artifact',
    'blocked_attempt_not_successful',
    'blocked_missing_evidence',
    'blocked_source_mutated',
    'blocked_health_mismatch',
    'blocked_replacement_proposal',
    'blocked_replacement_write',
    'blocked_supersession_write',
    'blocked_path_escape',
    'blocked_conflict',
    'partial_finalized',
    'stale',
    'mismatch',
    'unsupported',
  ]) {
    assert.ok(WORK_RECORD_REPAIR_FINALIZATION_STATUSES.includes(status));
  }
});

test('dry-run writes no replacement record and no supersession entry', () => {
  const replacementRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'aos-work-record-finalizer-dry-run-replacements-'));
  const indexRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'aos-work-record-finalizer-dry-run-index-'));
  const sourceBefore = fs.readFileSync(repairableFixture, 'utf8');
  const result = finalizeWorkRecordRepair(finalizeArgs({ replacementRoot, indexRoot, dryRun: true }));

  assert.equal(result.schema_version, WORK_RECORD_REPAIR_FINALIZATION_RESULT_SCHEMA_VERSION);
  assert.equal(result.status, 'dry_run', JSON.stringify(result.diagnostics, null, 2));
  assert.equal(result.dry_run, true);
  assert.equal(result.replacement_writer_result.status, 'dry_run');
  assert.equal(result.supersession_index_result.status, 'dry_run');
  assert.equal(result.would_write_replacement_record, true);
  assert.equal(result.would_write_supersession_index_entry, true);
  assert.equal(result.wrote_replacement_record, false);
  assert.equal(result.wrote_supersession_index_entry, false);
  assert.equal(result.executes_repair, false);
  assert.equal(result.executes_actions, false);
  assert.equal(result.uses_live_ui, false);
  assert.equal(result.uses_browser, false);
  assert.equal(result.uses_native_ax, false);
  assert.equal(result.uses_canvas, false);
  assert.equal(result.applies_patches, false);
  assert.equal(result.mutates_source_record, false);
  assert.equal(result.automatic_replay_allowed, false);
  assert.equal(fs.existsSync(result.replacement_writer_result.output.output_path), false);
  assert.equal(fs.existsSync(result.supersession_index_result.output.index_path), false);
  assert.deepEqual(fs.readdirSync(replacementRoot), []);
  assert.deepEqual(fs.readdirSync(indexRoot), []);
  assert.equal(fs.readFileSync(repairableFixture, 'utf8'), sourceBefore);
});

test('successful finalization writes valid replacement and supersession outputs', () => {
  const args = finalizeArgs();
  const sourceBefore = fs.readFileSync(repairableFixture, 'utf8');
  const result = finalizeWorkRecordRepair(args);

  assert.equal(result.status, 'finalized', JSON.stringify(result.diagnostics, null, 2));
  assert.equal(result.side_effects.includes('write_replacement_work_record'), true);
  assert.equal(result.side_effects.includes('write_source_supersession_index_entry'), true);
  assert.equal(result.wrote_replacement_record, true);
  assert.equal(result.replacement_record_already_existed, false);
  assert.equal(result.wrote_supersession_index_entry, true);
  assert.equal(result.supersession_index_entry_already_existed, false);
  assert.equal(result.source_work_record.immutable, true);
  assert.equal(fs.readFileSync(repairableFixture, 'utf8'), sourceBefore);
  assert.ok(result.replacement_writer_result.output.output_path.startsWith(args.replacementRoot));
  assert.ok(result.supersession_index_result.output.index_path.startsWith(args.indexRoot));

  const replacementRead = readWorkRecord(result.replacement_writer_result.output.output_path, {
    roots: [args.replacementRoot],
    repoRoot,
  });
  assert.equal(replacementRead.status, 'success');
  assert.equal(replacementRead.record.metadata.replacement_writer.executes_repair, false);
  const replacementEvidenceIds = new Set(replacementRead.record.evidence.map((item) => item.id));
  for (const mapping of result.readback.replacement.record.metadata.replacement_writer
    ? replacementRead.record.execution_map.postconditions
    : []) {
    for (const evidenceRef of mapping.evidence_refs || []) assert.equal(replacementEvidenceIds.has(evidenceRef), true);
  }

  const entry = JSON.parse(fs.readFileSync(result.supersession_index_result.output.index_path, 'utf8'));
  const validation = validateWorkRecordSourceSupersessionEntry(entry);
  assert.equal(validation.status, 'passed', JSON.stringify(validation.diagnostics, null, 2));
  const lookup = lookupWorkRecordSourceSupersession({
    sourceRef: repairableFixture,
    indexRoot: args.indexRoot,
    repoRoot,
  });
  assert.equal(lookup.status, 'active', JSON.stringify(lookup.diagnostics, null, 2));
  assert.equal(lookup.entries[0].replacement_work_record.id, replacementRead.record.id);
});

test('repeated finalization is idempotent', () => {
  const args = finalizeArgs({ proposedIdSeed: 'work-record:repairable-stale-saved-ref-finalizer-idempotent' });
  const first = finalizeWorkRecordRepair(args);
  const second = finalizeWorkRecordRepair(args);

  assert.equal(first.status, 'finalized', JSON.stringify(first.diagnostics, null, 2));
  assert.equal(second.status, 'already_finalized', JSON.stringify(second.diagnostics, null, 2));
  assert.equal(second.replacement_writer_result.status, 'already_exists');
  assert.equal(second.supersession_index_result.status, 'already_exists');
  assert.equal(second.wrote_replacement_record, false);
  assert.equal(second.replacement_record_already_existed, true);
  assert.equal(second.wrote_supersession_index_entry, false);
  assert.equal(second.supersession_index_entry_already_existed, true);
});

test('invalid index root is preflighted before replacement write', () => {
  const replacementRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'aos-work-record-finalizer-partial-replacements-'));
  const blockedIndexRoot = writeTempJson({ not: 'a-directory' }, 'aos-work-record-finalizer-blocked-index-root-');
  const result = finalizeWorkRecordRepair(finalizeArgs({
    replacementRoot,
    indexRoot: blockedIndexRoot,
    proposedIdSeed: 'work-record:repairable-stale-saved-ref-finalizer-partial',
  }));

  assert.equal(result.status, 'blocked_path_escape');
  assert.equal(result.replacement_writer_result.status, 'dry_run');
  assert.equal(result.supersession_index_result.status, 'blocked_index_escape');
  assert.equal(fs.existsSync(result.replacement_writer_result.output.output_path), false);
  assert.deepEqual(fs.readdirSync(replacementRoot), []);
});

test('partial supersession failure is reserved for post-preflight write failure', () => {
  const args = finalizeArgs({
    proposedIdSeed: 'work-record:repairable-stale-saved-ref-finalizer-post-preflight-partial',
  });
  const originalRename = fs.renameSync;
  let renameCount = 0;
  fs.renameSync = (from, to) => {
    renameCount += 1;
    if (renameCount === 2) throw new Error('simulated post-preflight supersession race');
    return originalRename(from, to);
  };
  try {
    const result = finalizeWorkRecordRepair(args);
    assert.equal(result.status, 'partial_finalized', JSON.stringify(result.diagnostics, null, 2));
    assert.equal(result.replacement_writer_result.status, 'written');
    assert.equal(result.supersession_index_result.status, 'blocked_write_failed');
    assert.equal(fs.existsSync(result.replacement_writer_result.output.output_path), true);
  } finally {
    fs.renameSync = originalRename;
  }
});

test('lower-level supersession then finalizer is already finalized with shared writer-result identity', () => {
  const input = artifactInput();
  const { planPath, artifactPath, artifact } = writeAttemptInputs(input);
  const replacementRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'aos-work-record-finalizer-cross-replacements-'));
  const indexRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'aos-work-record-finalizer-cross-index-'));
  const proposedIdSeed = 'work-record:repairable-stale-saved-ref-finalizer-cross-lower-first';
  const proposal = replacementProposalFromInput(input, artifact, proposedIdSeed);
  const writerResult = writeReplacementWorkRecord({ proposal, outputRoot: replacementRoot });
  assert.equal(writerResult.status, 'written', JSON.stringify(writerResult.diagnostics, null, 2));
  const supersession = writeWorkRecordSourceSupersessionIndex({
    sourceRef: repairableFixture,
    replacementRef: writerResult.output.output_path,
    indexRoot,
    replacementRoots: [replacementRoot],
    writerResult,
    repoRoot,
  });
  assert.equal(supersession.status, 'written', JSON.stringify(supersession.diagnostics, null, 2));

  const finalizer = finalizeWorkRecordRepair({
    sourceRef: repairableFixture,
    attemptPlanPath: planPath,
    attemptArtifactPath: artifactPath,
    replacementRoot,
    indexRoot,
    proposedIdSeed,
    repoRoot,
  });
  assert.equal(finalizer.status, 'already_finalized', JSON.stringify(finalizer.diagnostics, null, 2));
  assert.equal(finalizer.supersession_index_result.status, 'already_exists');
});

test('finalizer then lower-level supersession with finalizer writer result is already exists', () => {
  const args = finalizeArgs({
    proposedIdSeed: 'work-record:repairable-stale-saved-ref-finalizer-cross-finalizer-first',
  });
  const finalizer = finalizeWorkRecordRepair(args);
  assert.equal(finalizer.status, 'finalized', JSON.stringify(finalizer.diagnostics, null, 2));
  const repeat = writeWorkRecordSourceSupersessionIndex({
    sourceRef: repairableFixture,
    replacementRef: finalizer.replacement_writer_result.output.output_path,
    indexRoot: args.indexRoot,
    replacementRoots: [args.replacementRoot],
    writerResult: finalizer.replacement_writer_result,
    repoRoot,
  });
  assert.equal(repeat.status, 'already_exists', JSON.stringify(repeat.diagnostics, null, 2));
});

test('same source and replacement cannot gain duplicate active entries from writer-result mismatch', () => {
  const args = finalizeArgs({
    proposedIdSeed: 'work-record:repairable-stale-saved-ref-finalizer-no-duplicate',
  });
  const finalizer = finalizeWorkRecordRepair(args);
  assert.equal(finalizer.status, 'finalized', JSON.stringify(finalizer.diagnostics, null, 2));
  const mismatch = writeWorkRecordSourceSupersessionIndex({
    sourceRef: repairableFixture,
    replacementRef: finalizer.replacement_writer_result.output.output_path,
    indexRoot: args.indexRoot,
    replacementRoots: [args.replacementRoot],
    repoRoot,
  });
  assert.equal(mismatch.status, 'conflict');
  const lookup = lookupWorkRecordSourceSupersession({
    sourceRef: repairableFixture,
    indexRoot: args.indexRoot,
    repoRoot,
  });
  assert.equal(lookup.status, 'active', JSON.stringify(lookup.diagnostics, null, 2));
  assert.equal(lookup.entries.length, 1);
});

test('failed and invalid attempt artifacts fail closed', () => {
  for (const status of ['failed', 'partial', 'cleanup_failed', 'rollback_failed', 'invalid_artifact', 'unsupported']) {
    const result = finalizeWorkRecordRepair(finalizeArgs({
      input: artifactInput({ status }),
      proposedIdSeed: `work-record:repairable-stale-saved-ref-finalizer-${status}`,
    }));
    assert.notEqual(result.status, 'finalized');
    assert.notEqual(result.status, 'already_finalized');
    assert.ok(['blocked_invalid_attempt_artifact', 'blocked_attempt_not_successful', 'unsupported'].includes(result.status), `${status} -> ${result.status}`);
  }
});

test('mismatched, source-mutated, missing-evidence, and health-mismatched artifacts fail closed', () => {
  const cases = [
    {
      name: 'wrong-source',
      input: (() => {
        const input = artifactInput();
        input.repair_attempt_plan = {
          ...input.repair_attempt_plan,
          source_work_record: {
            ...input.repair_attempt_plan.source_work_record,
            id: 'work-record:wrong',
          },
        };
        return input;
      })(),
      statuses: ['mismatch'],
    },
    {
      name: 'missing-evidence',
      input: artifactInput({ overrides: { evidence_refs: [] } }),
      statuses: ['blocked_invalid_attempt_artifact', 'blocked_missing_evidence'],
    },
    {
      name: 'source-mutated',
      input: artifactInput({
        overrides: {
          source_work_record_mutated: true,
          source_work_record_mutation_check: {
            status: 'failed',
            before_digest: digestFile(repairableFixture),
            after_digest: 'changed',
          },
        },
      }),
      statuses: ['blocked_invalid_attempt_artifact', 'blocked_source_mutated'],
    },
  ];

  for (const item of cases) {
    const result = finalizeWorkRecordRepair(finalizeArgs({
      input: item.input,
      proposedIdSeed: `work-record:repairable-stale-saved-ref-finalizer-${item.name}`,
    }));
    assert.ok(item.statuses.includes(result.status), `${item.name} -> ${result.status}`);
  }
});

test('health-mismatched artifact fails closed', () => {
  const input = artifactInput();
  const { planPath, artifactPath, artifact } = writeAttemptInputs(input);
  artifact.verifier_after = { status: 'failed', health_verdict: 'blocked' };
  fs.writeFileSync(artifactPath, `${JSON.stringify(artifact, null, 2)}\n`);
  const result = finalizeWorkRecordRepair({
    sourceRef: repairableFixture,
    attemptPlanPath: planPath,
    attemptArtifactPath: artifactPath,
    replacementRoot: fs.mkdtempSync(path.join(os.tmpdir(), 'aos-work-record-finalizer-health-replacements-')),
    indexRoot: fs.mkdtempSync(path.join(os.tmpdir(), 'aos-work-record-finalizer-health-index-')),
    proposedIdSeed: 'work-record:repairable-stale-saved-ref-finalizer-health-mismatch',
    repoRoot,
  });

  assert.notEqual(result.status, 'finalized');
  assert.ok(['blocked_invalid_attempt_artifact', 'blocked_health_mismatch'].includes(result.status), result.status);
});

test('path traversal is rejected before source mutation or live execution', () => {
  const replacementRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'aos-work-record-finalizer-path-root-'));
  const result = finalizeWorkRecordRepair(finalizeArgs({
    replacementRoot,
    replacementOutputPath: path.join(replacementRoot, '..', 'work-record:repairable-stale-saved-ref-finalizer-path.json'),
    proposedIdSeed: 'work-record:repairable-stale-saved-ref-finalizer-path',
  }));

  assert.equal(result.status, 'blocked_path_escape');
  assert.equal(result.executes_repair, false);
  assert.equal(result.executes_actions, false);
  assert.equal(result.applies_patches, false);
  assert.equal(result.mutates_source_record, false);
});

test('public CLI exposes help and stable JSON finalize results', () => {
  const args = finalizeArgs({
    proposedIdSeed: 'work-record:repairable-stale-saved-ref-finalizer-cli',
    dryRun: true,
  });
  const help = runAos(['work-record', 'repair', 'finalize', '--help']);
  assert.equal(help.status, 0, help.stderr);
  assert.match(help.stdout, /repair finalize/);
  const nestedHelp = runAos(['help', 'work-record', 'repair', 'finalize', '--json']);
  assert.equal(nestedHelp.status, 0, nestedHelp.stderr);
  assert.equal(JSON.parse(nestedHelp.stdout).path.join(' '), 'work-record repair finalize');
  const unrelatedNestedHelp = runAos(['help', 'see', 'zone', 'define', '--json']);
  assert.equal(unrelatedNestedHelp.status, 0, unrelatedNestedHelp.stderr);
  assert.equal(JSON.parse(unrelatedNestedHelp.stdout).path.join(' '), 'see zone define');

  const smoke = runAos([
    'work-record',
    'repair',
    'finalize',
    '--source',
    repairableFixture,
    '--attempt-plan',
    args.attemptPlanPath,
    '--attempt-artifact',
    args.attemptArtifactPath,
    '--replacement-root',
    args.replacementRoot,
    '--index-root',
    args.indexRoot,
    '--proposed-id-seed',
    args.proposedIdSeed,
    '--dry-run',
    '--json',
  ]);
  assert.equal(smoke.status, 0, smoke.stderr);
  const payload = JSON.parse(smoke.stdout);
  assert.equal(payload.type, 'work_record.repair_finalization_result');
  assert.equal(payload.status, 'dry_run');
  assert.equal(payload.executes_repair, false);
  assert.equal(payload.executes_actions, false);
  assert.equal(payload.applies_patches, false);
  assert.equal(payload.automatic_replay_allowed, false);
});
