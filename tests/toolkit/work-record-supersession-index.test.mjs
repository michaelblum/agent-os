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
  lookupWorkRecordSourceSupersession,
  planWorkRecordSourceSupersession,
  planWorkRecordRepair,
  planWorkRecordRepairAttempt,
  readWorkRecord,
  validateWorkRecordSourceSupersessionEntry,
  writeReplacementWorkRecord,
  writeWorkRecordSourceSupersessionIndex,
  WORK_RECORD_SOURCE_SUPERSESSION_INDEX_SCHEMA_VERSION,
  WORK_RECORD_SOURCE_SUPERSESSION_INDEX_STATUSES,
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

function writeTempJson(value, prefix = 'aos-work-record-supersession-index-') {
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

function successArtifactInput() {
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
    status: 'succeeded',
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
      before_digest: digestFile(repairableFixture),
      after_digest: digestFile(repairableFixture),
    },
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

function writeReplacement({ proposedIdSeed = 'work-record:supersession-index-test-replacement' } = {}) {
  const artifactInput = successArtifactInput();
  const artifact = buildWorkRecordRepairAttemptArtifact(artifactInput);
  const proposal = buildWorkRecordReplacementProposal({
    source_work_record: sourceInput(),
    repair_attempt_plan: artifactInput.repair_attempt_plan,
    repair_attempt_artifact: artifact,
    source_work_record_digest_after: digestFile(repairableFixture),
    proposed_id_seed: proposedIdSeed,
  });
  const outputRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'aos-work-record-supersession-replacements-'));
  const writerResult = writeReplacementWorkRecord({ proposal, outputRoot });
  assert.equal(writerResult.status, 'written', JSON.stringify(writerResult.diagnostics, null, 2));
  return { outputRoot, writerResult, replacementPath: writerResult.output.output_path };
}

test('Source Supersession Index statuses are declared', () => {
  for (const status of [
    'dry_run',
    'written',
    'active',
    'not_found',
    'already_exists',
    'conflict',
    'blocked_invalid_source',
    'blocked_invalid_replacement',
    'blocked_source_changed',
    'blocked_relationship_mismatch',
    'blocked_index_escape',
    'blocked_write_failed',
    'blocked_cleanup_failed',
    'malformed_index',
    'unsupported',
  ]) {
    assert.ok(WORK_RECORD_SOURCE_SUPERSESSION_INDEX_STATUSES.includes(status));
  }
});

test('dry-run reports exact index path and does not write', () => {
  const indexRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'aos-work-record-supersession-index-dry-run-'));
  const { outputRoot, replacementPath, writerResult } = writeReplacement();
  const sourceBefore = fs.readFileSync(repairableFixture, 'utf8');
  const replacementBefore = fs.readFileSync(replacementPath, 'utf8');
  const result = writeWorkRecordSourceSupersessionIndex({
    sourceRef: repairableFixture,
    replacementRef: replacementPath,
    replacementRoots: [outputRoot],
    indexRoot,
    dryRun: true,
    repoRoot,
    writerResultPath: writeTempJson(writerResult),
  });

  assert.equal(result.schema_version, WORK_RECORD_SOURCE_SUPERSESSION_INDEX_SCHEMA_VERSION);
  assert.equal(result.status, 'dry_run', JSON.stringify(result.diagnostics, null, 2));
  assert.equal(result.mode, 'dry_run');
  assert.equal(result.writes_index_entry, false);
  assert.equal(result.would_write_index_entry, true);
  assert.equal(result.mutates_source_record, false);
  assert.equal(result.mutates_replacement_record, false);
  assert.equal(result.executes_repair, false);
  assert.equal(result.executes_actions, false);
  assert.equal(result.applies_patches, false);
  assert.equal(result.automatic_replay_allowed, false);
  assert.equal(result.idempotency.status, 'new');
  assert.ok(result.output.index_path.startsWith(indexRoot));
  assert.equal(fs.existsSync(result.output.index_path), false);
  assert.equal(fs.readFileSync(repairableFixture, 'utf8'), sourceBefore);
  assert.equal(fs.readFileSync(replacementPath, 'utf8'), replacementBefore);
});

test('planning rejects invalid index roots and accepts in-memory writer results', () => {
  const indexRootFile = writeTempJson({ not: 'a-directory' }, 'aos-work-record-supersession-index-root-file-');
  const { outputRoot, replacementPath, writerResult } = writeReplacement({
    proposedIdSeed: 'work-record:supersession-index-plan-replacement',
  });
  const invalidPlan = planWorkRecordSourceSupersession({
    sourceRef: repairableFixture,
    replacementRef: replacementPath,
    replacementRoots: [outputRoot],
    indexRoot: indexRootFile,
    writerResult,
    repoRoot,
  });
  assert.equal(invalidPlan.status, 'blocked_index_escape');
  assert.equal(fs.existsSync(path.join(indexRootFile, 'source-supersession')), false);

  const indexRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'aos-work-record-supersession-index-plan-'));
  const memoryPlan = planWorkRecordSourceSupersession({
    sourceRef: repairableFixture,
    replacementRef: replacementPath,
    replacementRoots: [outputRoot],
    indexRoot,
    writerResult,
    repoRoot,
  });
  const filePlan = planWorkRecordSourceSupersession({
    sourceRef: repairableFixture,
    replacementRef: replacementPath,
    replacementRoots: [outputRoot],
    indexRoot,
    writerResultPath: writeTempJson(writerResult),
    repoRoot,
  });
  assert.equal(memoryPlan.status, 'dry_run', JSON.stringify(memoryPlan.diagnostics, null, 2));
  assert.equal(filePlan.status, 'dry_run', JSON.stringify(filePlan.diagnostics, null, 2));
  assert.equal(memoryPlan.supersession_entry.id, filePlan.supersession_entry.id);
  assert.equal(memoryPlan.supersession_entry.digest, filePlan.supersession_entry.digest);
  assert.equal(memoryPlan.output.index_path, filePlan.output.index_path);
});

test('write, validate, lookup, idempotency, and immutability are deterministic', () => {
  const indexRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'aos-work-record-supersession-index-write-'));
  const { outputRoot, replacementPath, writerResult } = writeReplacement();
  const writerResultPath = writeTempJson(writerResult);
  const sourceBefore = fs.readFileSync(repairableFixture, 'utf8');
  const replacementBefore = fs.readFileSync(replacementPath, 'utf8');
  const result = writeWorkRecordSourceSupersessionIndex({
    sourceRef: repairableFixture,
    replacementRef: replacementPath,
    replacementRoots: [outputRoot],
    indexRoot,
    repoRoot,
    writerResultPath,
  });

  assert.equal(result.status, 'written', JSON.stringify(result.diagnostics, null, 2));
  assert.equal(result.writes_index_entry, true);
  assert.equal(result.side_effects.includes('write_source_supersession_index_entry'), true);
  assert.equal(result.atomic_write.temp_file_leftover, false);
  assert.equal(fs.existsSync(result.atomic_write.temp_file), false);
  assert.equal(fs.readFileSync(repairableFixture, 'utf8'), sourceBefore);
  assert.equal(fs.readFileSync(replacementPath, 'utf8'), replacementBefore);

  const entry = JSON.parse(fs.readFileSync(result.output.index_path, 'utf8'));
  const validation = validateWorkRecordSourceSupersessionEntry(entry);
  assert.equal(validation.status, 'passed', JSON.stringify(validation.diagnostics, null, 2));
  assert.equal(entry.relationship, 'superseded_by');
  assert.equal(entry.relationship_status, 'active');
  assert.equal(entry.mutates_source_record, false);
  assert.equal(entry.mutates_replacement_record, false);
  assert.equal(entry.executes_repair, false);
  assert.equal(entry.executes_actions, false);
  assert.equal(entry.applies_patches, false);
  assert.equal(entry.automatic_replay_allowed, false);

  const lookup = lookupWorkRecordSourceSupersession({
    sourceRef: repairableFixture,
    sourceRoots: [path.dirname(repairableFixture)],
    indexRoot,
    repoRoot,
  });
  assert.equal(lookup.status, 'active', JSON.stringify(lookup.diagnostics, null, 2));
  assert.equal(lookup.entries.length, 1);
  assert.equal(lookup.entries[0].replacement_work_record.id, writerResult.written_replacement_work_record.id);
  assert.match(lookup.entries[0].recommended_next.command_hint, /aos work-record read/);

  const repeat = writeWorkRecordSourceSupersessionIndex({
    sourceRef: repairableFixture,
    replacementRef: replacementPath,
    replacementRoots: [outputRoot],
    indexRoot,
    repoRoot,
    writerResultPath,
  });
  assert.equal(repeat.status, 'already_exists');
  assert.equal(repeat.idempotency.status, 'identical_existing');
});

test('writer fails closed for invalid source, invalid replacement, source drift, relationship mismatch, traversal, symlink escape, malformed lookup, and conflict', () => {
  const indexRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'aos-work-record-supersession-index-negative-'));
  const { outputRoot, replacementPath, writerResult } = writeReplacement({
    proposedIdSeed: 'work-record:supersession-index-negative-replacement',
  });
  const writerResultPath = writeTempJson(writerResult);

  const invalidSource = writeWorkRecordSourceSupersessionIndex({
    sourceRef: path.join(indexRoot, 'missing-source.json'),
    replacementRef: replacementPath,
    replacementRoots: [outputRoot],
    indexRoot,
    repoRoot,
  });
  assert.equal(invalidSource.status, 'blocked_invalid_source');

  const invalidReplacement = writeWorkRecordSourceSupersessionIndex({
    sourceRef: repairableFixture,
    replacementRef: repairableFixture,
    indexRoot,
    repoRoot,
  });
  assert.equal(invalidReplacement.status, 'blocked_relationship_mismatch');

  const changedSource = writeWorkRecordSourceSupersessionIndex({
    sourceRef: repairableFixture,
    replacementRef: replacementPath,
    replacementRoots: [outputRoot],
    indexRoot,
    repoRoot,
    writerResultPath: writeTempJson({
      ...writerResult,
      source_work_record: {
        ...writerResult.source_work_record,
        digest: 'sha256:not-current',
      },
    }),
  });
  assert.equal(changedSource.status, 'blocked_source_changed');

  const badReplacementPath = path.join(indexRoot, 'bad-replacement.json');
  const badReplacement = JSON.parse(fs.readFileSync(replacementPath, 'utf8'));
  badReplacement.metadata.replacement_writer.supersedes_source.source_work_record_id = 'work-record:different';
  fs.writeFileSync(badReplacementPath, `${JSON.stringify(badReplacement, null, 2)}\n`);
  const mismatch = writeWorkRecordSourceSupersessionIndex({
    sourceRef: repairableFixture,
    replacementRef: badReplacementPath,
    replacementRoots: [indexRoot],
    indexRoot,
    repoRoot,
  });
  assert.equal(mismatch.status, 'blocked_relationship_mismatch');

  const traversal = writeWorkRecordSourceSupersessionIndex({
    sourceRef: repairableFixture,
    replacementRef: replacementPath,
    replacementRoots: [outputRoot],
    indexRoot: `${indexRoot}/../escape`,
    repoRoot,
  });
  assert.equal(traversal.status, 'blocked_index_escape');

  const external = fs.mkdtempSync(path.join(os.tmpdir(), 'aos-work-record-supersession-index-external-'));
  const symlinkProbe = writeWorkRecordSourceSupersessionIndex({
    sourceRef: repairableFixture,
    replacementRef: replacementPath,
    replacementRoots: [outputRoot],
    indexRoot,
    repoRoot,
    dryRun: true,
  });
  assert.equal(symlinkProbe.status, 'dry_run', JSON.stringify(symlinkProbe.diagnostics, null, 2));
  const symlinkParent = path.dirname(symlinkProbe.output.index_path);
  fs.mkdirSync(path.dirname(symlinkParent), { recursive: true });
  fs.symlinkSync(external, symlinkParent);
  const symlinkEscape = writeWorkRecordSourceSupersessionIndex({
    sourceRef: repairableFixture,
    replacementRef: replacementPath,
    replacementRoots: [outputRoot],
    indexRoot,
    repoRoot,
  });
  assert.equal(symlinkEscape.status, 'blocked_index_escape');

  const malformedRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'aos-work-record-supersession-index-malformed-'));
  fs.mkdirSync(path.join(malformedRoot, 'source-supersession', 'v0', 'x'), { recursive: true });
  fs.writeFileSync(path.join(malformedRoot, 'source-supersession', 'v0', 'x', 'bad.json'), '{"not valid"\n');
  const malformed = lookupWorkRecordSourceSupersession({
    sourceRef: repairableFixture,
    sourceRoots: [path.dirname(repairableFixture)],
    indexRoot: malformedRoot,
    repoRoot,
  });
  assert.equal(malformed.status, 'malformed_index');
  assert.equal(malformed.malformed_entries.length, 1);

  const conflictRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'aos-work-record-supersession-index-conflict-'));
  const first = writeWorkRecordSourceSupersessionIndex({
    sourceRef: repairableFixture,
    replacementRef: replacementPath,
    replacementRoots: [outputRoot],
    indexRoot: conflictRoot,
    repoRoot,
    writerResultPath,
  });
  assert.equal(first.status, 'written', JSON.stringify(first.diagnostics, null, 2));
  const other = writeReplacement({ proposedIdSeed: 'work-record:supersession-index-conflicting-replacement' });
  const conflict = writeWorkRecordSourceSupersessionIndex({
    sourceRef: repairableFixture,
    replacementRef: other.replacementPath,
    replacementRoots: [other.outputRoot],
    indexRoot: conflictRoot,
    repoRoot,
    writerResultPath: writeTempJson(other.writerResult),
  });
  assert.equal(conflict.status, 'conflict');
});

test('public supersession commands expose stable JSON and never run repair', () => {
  const help = runAos(['help', 'work-record', '--json']);
  assert.equal(help.status, 0, help.stderr);
  const helpJson = JSON.parse(help.stdout);
  const writeForm = helpJson.forms.find((item) => item.id === 'work-record-supersession-write');
  const lookupForm = helpJson.forms.find((item) => item.id === 'work-record-supersession-lookup');
  const validateForm = helpJson.forms.find((item) => item.id === 'work-record-supersession-validate');
  assert.ok(writeForm, 'help should expose work-record-supersession-write');
  assert.ok(lookupForm, 'help should expose work-record-supersession-lookup');
  assert.ok(validateForm, 'help should expose work-record-supersession-validate');
  assert.equal(writeForm.execution.read_only, false);
  assert.equal(writeForm.execution.mutates_state, true);
  assert.equal(writeForm.execution.supports_dry_run, true);
  assert.equal(writeForm.execution.writes_index_entry, true);
  assert.equal(writeForm.execution.mutates_source_record, false);
  assert.equal(writeForm.execution.mutates_replacement_record, false);
  assert.equal(writeForm.execution.executes_repair, false);
  assert.equal(writeForm.execution.executes_actions, false);
  assert.equal(writeForm.execution.applies_patches, false);
  assert.equal(writeForm.execution.automatic_replay_allowed, false);
  assert.equal(lookupForm.execution.read_only, true);
  assert.equal(validateForm.execution.read_only, true);

  const indexRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'aos-work-record-supersession-index-cli-'));
  const { outputRoot, replacementPath, writerResult } = writeReplacement({
    proposedIdSeed: 'work-record:supersession-index-cli-replacement',
  });
  const writerResultPath = writeTempJson(writerResult);
  const sourceBefore = fs.readFileSync(repairableFixture, 'utf8');
  const replacementBefore = fs.readFileSync(replacementPath, 'utf8');
  const dryRun = runAos([
    'work-record',
    'supersession',
    'write',
    '--source',
    repairableFixture,
    '--replacement',
    replacementPath,
    '--replacement-root',
    outputRoot,
    '--index-root',
    indexRoot,
    '--writer-result',
    writerResultPath,
    '--dry-run',
    '--json',
  ]);
  assert.equal(dryRun.status, 0, dryRun.stderr);
  assert.equal(JSON.parse(dryRun.stdout).status, 'dry_run');

  const write = runAos([
    'work-record',
    'supersession',
    'write',
    '--source',
    repairableFixture,
    '--replacement',
    replacementPath,
    '--replacement-root',
    outputRoot,
    '--index-root',
    indexRoot,
    '--writer-result',
    writerResultPath,
    '--json',
  ]);
  assert.equal(write.status, 0, write.stderr);
  const writeJson = JSON.parse(write.stdout);
  assert.equal(writeJson.status, 'written');
  assert.equal(writeJson.mutates_source_record, false);
  assert.equal(writeJson.mutates_replacement_record, false);
  assert.equal(writeJson.executes_repair, false);
  assert.equal(writeJson.executes_actions, false);
  assert.equal(writeJson.applies_patches, false);
  assert.equal(writeJson.automatic_replay_allowed, false);
  assert.equal(fs.readFileSync(repairableFixture, 'utf8'), sourceBefore);
  assert.equal(fs.readFileSync(replacementPath, 'utf8'), replacementBefore);

  const lookup = runAos([
    'work-record',
    'supersession',
    'lookup',
    '--source',
    repairableFixture,
    '--index-root',
    indexRoot,
    '--json',
  ]);
  assert.equal(lookup.status, 0, lookup.stderr);
  assert.equal(JSON.parse(lookup.stdout).status, 'active');

  const validate = runAos([
    'work-record',
    'supersession',
    'validate',
    writeJson.output.index_path,
    '--json',
  ]);
  assert.equal(validate.status, 0, validate.stderr);
  assert.equal(JSON.parse(validate.stdout).status, 'passed');
});
