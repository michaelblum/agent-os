import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import * as publicWorkRecord from '../../packages/toolkit/workbench/work-record.js';
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
import {
  planWorkRecordSourceSupersessionFromRecords,
} from '../../packages/toolkit/workbench/work-record-supersession-plan.js';
import {
  commandHintFromArgv,
} from '../../packages/toolkit/workbench/work-record-command-recommendation.js';

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

function writeReplacement({
  proposedIdSeed = 'work-record:supersession-index-test-replacement',
  outputRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'aos-work-record-supersession-replacements-')),
} = {}) {
  const artifactInput = successArtifactInput();
  const artifact = buildWorkRecordRepairAttemptArtifact(artifactInput);
  const proposal = buildWorkRecordReplacementProposal({
    source_work_record: sourceInput(),
    repair_attempt_plan: artifactInput.repair_attempt_plan,
    repair_attempt_artifact: artifact,
    source_work_record_digest_after: digestFile(repairableFixture),
    proposed_id_seed: proposedIdSeed,
  });
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

test('Source Supersession Index facade stays below the review line threshold', () => {
  const indexPath = path.join(repoRoot, 'packages/toolkit/workbench/work-record-supersession-index.js');
  const lineCount = fs.readFileSync(indexPath, 'utf8').split('\n').length;
  assert.ok(lineCount < 1000, `work-record-supersession-index.js has ${lineCount} lines`);
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

test('public planning ignores finalizer-only record injection while internal record planning works', () => {
  assert.equal(Object.hasOwn(publicWorkRecord, 'planWorkRecordSourceSupersessionFromRecords'), false);

  const indexRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'aos-work-record-supersession-index-internal-plan-'));
  const { outputRoot, replacementPath, writerResult } = writeReplacement({
    proposedIdSeed: 'work-record:supersession-index-internal-plan-replacement',
  });
  const sourceRead = readWorkRecord(repairableFixture, { repoRoot });
  const replacementRecord = JSON.parse(fs.readFileSync(replacementPath, 'utf8'));

  const publicRecordOnly = planWorkRecordSourceSupersession({
    sourceRecord: sourceRead.record,
    replacementRecord,
    sourcePath: repairableFixture,
    replacementPath,
    indexRoot,
    writerResult,
    repoRoot,
  });
  assert.equal(publicRecordOnly.status, 'blocked_invalid_source');

  const internalPlan = planWorkRecordSourceSupersessionFromRecords({
    sourceRef: repairableFixture,
    replacementRef: replacementPath,
    sourceRecord: sourceRead.record,
    replacementRecord,
    sourcePath: repairableFixture,
    replacementPath,
    indexRoot,
    sourceRoots: [path.dirname(repairableFixture)],
    replacementRoots: [outputRoot],
    writerResult,
    repoRoot,
  });
  assert.equal(internalPlan.status, 'dry_run', JSON.stringify(internalPlan.diagnostics, null, 2));
  assert.equal(internalPlan.source_work_record.id, sourceRead.record.id);
  assert.equal(internalPlan.replacement_work_record.id, replacementRecord.id);
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
  assert.deepEqual(result.recommended_next.argv, [
    './aos',
    'work-record',
    'supersession',
    'lookup',
    '--source',
    result.source_work_record.id,
    '--index-root',
    indexRoot,
    '--json',
  ]);
  assert.equal(result.recommended_next.command_hint, commandHintFromArgv(result.recommended_next.argv));
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
    replacementRoots: [outputRoot],
    repoRoot,
  });
  assert.equal(lookup.status, 'active', JSON.stringify(lookup.diagnostics, null, 2));
  assert.equal(lookup.entries.length, 1);
  assert.equal(lookup.entries[0].replacement_work_record.id, writerResult.written_replacement_work_record.id);
  assert.equal(lookup.entries[0].replacement_readback.status, 'readable');
  assert.equal(lookup.entries[0].replacement_readback.read_proven, true);
  assert.equal(lookup.entries[0].replacement_readback.resolved_root, outputRoot);
  assert.deepEqual(lookup.entries[0].recommended_next.argv, [
    './aos',
    'work-record',
    'read',
    writerResult.written_replacement_work_record.id,
    '--root',
    outputRoot,
    '--json',
  ]);
  assert.equal(lookup.entries[0].recommended_next.command_hint, commandHintFromArgv(lookup.entries[0].recommended_next.argv));
  assert.match(lookup.entries[0].recommended_next.command_hint, /aos work-record read/);
  assert.match(lookup.entries[0].recommended_next.command_hint, new RegExp(`--root ${outputRoot.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`));
  const recommendedRead = runAos([
    'work-record',
    'read',
    writerResult.written_replacement_work_record.id,
    '--root',
    outputRoot,
    '--json',
  ]);
  assert.equal(recommendedRead.status, 0, recommendedRead.stderr);
  assert.equal(JSON.parse(recommendedRead.stdout).record.id, writerResult.written_replacement_work_record.id);

  const indexOnly = lookupWorkRecordSourceSupersession({
    sourceRef: repairableFixture,
    sourceRoots: [path.dirname(repairableFixture)],
    indexRoot,
    repoRoot,
  });
  assert.equal(indexOnly.status, 'active');
  assert.equal(indexOnly.entries[0].replacement_readback.status, 'index_only');
  assert.equal(indexOnly.entries[0].replacement_readback.read_proven, false);
  assert.deepEqual(indexOnly.entries[0].recommended_next.argv, []);
  assert.equal(indexOnly.entries[0].recommended_next.command_hint, '');

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

test('lookup replacement-root readback fails closed for missing, digest mismatch, and wrong replacement id', () => {
  const indexRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'aos-work-record-supersession-index-readback-'));
  const { outputRoot, replacementPath, writerResult } = writeReplacement({
    proposedIdSeed: 'work-record:supersession-index-readback-replacement',
  });
  const result = writeWorkRecordSourceSupersessionIndex({
    sourceRef: repairableFixture,
    replacementRef: replacementPath,
    replacementRoots: [outputRoot],
    indexRoot,
    repoRoot,
    writerResultPath: writeTempJson(writerResult),
  });
  assert.equal(result.status, 'written', JSON.stringify(result.diagnostics, null, 2));
  const sourceBefore = fs.readFileSync(repairableFixture, 'utf8');
  const replacementBefore = fs.readFileSync(replacementPath, 'utf8');

  const wrongRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'aos-work-record-supersession-missing-root-'));
  const missing = lookupWorkRecordSourceSupersession({
    sourceRef: repairableFixture,
    sourceRoots: [path.dirname(repairableFixture)],
    indexRoot,
    replacementRoots: [wrongRoot],
    repoRoot,
  });
  assert.equal(missing.status, 'blocked_invalid_replacement');
  assert.equal(missing.entries[0].replacement_readback.status, 'not_found');
  assert.deepEqual(missing.entries[0].recommended_next.argv, []);
  assert.equal(missing.entries[0].recommended_next.command_hint, '');

  const entry = JSON.parse(fs.readFileSync(result.output.index_path, 'utf8'));
  entry.replacement_work_record.digest = 'sha256:not-current';
  fs.writeFileSync(result.output.index_path, `${JSON.stringify(entry, null, 2)}\n`);
  const digestMismatch = lookupWorkRecordSourceSupersession({
    sourceRef: repairableFixture,
    sourceRoots: [path.dirname(repairableFixture)],
    indexRoot,
    replacementRoots: [outputRoot],
    repoRoot,
  });
  assert.equal(digestMismatch.status, 'blocked_invalid_replacement');
  assert.equal(digestMismatch.entries[0].replacement_readback.status, 'digest_mismatch');
  assert.ok(digestMismatch.diagnostics.some((diagnostic) => diagnostic.code === 'SUPERSESSION_LOOKUP_REPLACEMENT_DIGEST_MISMATCH'));

  entry.replacement_work_record.digest = writerResult.written_replacement_work_record.digest;
  entry.replacement_work_record.id = 'work-record:not-the-written-replacement';
  fs.writeFileSync(result.output.index_path, `${JSON.stringify(entry, null, 2)}\n`);
  const wrongId = lookupWorkRecordSourceSupersession({
    sourceRef: repairableFixture,
    sourceRoots: [path.dirname(repairableFixture)],
    indexRoot,
    replacementRoots: [outputRoot],
    repoRoot,
  });
  assert.equal(wrongId.status, 'blocked_invalid_replacement');
  assert.equal(wrongId.entries[0].replacement_readback.status, 'not_found');
  assert.equal(fs.readFileSync(repairableFixture, 'utf8'), sourceBefore);
  assert.equal(fs.readFileSync(replacementPath, 'utf8'), replacementBefore);
});

test('supersession recommendations preserve shell metacharacter roots as argv elements', () => {
  const indexRoot = fs.mkdtempSync(path.join(os.tmpdir(), "aos supersession index ; quoted '$INDEX-"));
  const replacementRoot = fs.mkdtempSync(path.join(os.tmpdir(), "aos supersession replacement ; quoted '$ROOT-"));
  const { outputRoot, replacementPath, writerResult } = writeReplacement({
    proposedIdSeed: 'work-record:supersession-index-special-root-replacement',
    outputRoot: replacementRoot,
  });
  assert.equal(outputRoot, replacementRoot);

  const write = writeWorkRecordSourceSupersessionIndex({
    sourceRef: repairableFixture,
    replacementRef: replacementPath,
    replacementRoots: [replacementRoot],
    indexRoot,
    repoRoot,
    writerResultPath: writeTempJson(writerResult),
  });
  assert.equal(write.status, 'written', JSON.stringify(write.diagnostics, null, 2));
  assert.deepEqual(write.recommended_next.argv, [
    './aos',
    'work-record',
    'supersession',
    'lookup',
    '--source',
    write.source_work_record.id,
    '--index-root',
    indexRoot,
    '--json',
  ]);
  assert.equal(write.recommended_next.command_hint, commandHintFromArgv(write.recommended_next.argv));
  assert.ok(write.recommended_next.command_hint.includes(`--index-root '${indexRoot.replace(/'/g, "'\\''")}'`));
  assert.ok(!write.recommended_next.command_hint.includes(`--index-root ${indexRoot} --json`));

  const lookup = lookupWorkRecordSourceSupersession({
    sourceRef: repairableFixture,
    sourceRoots: [path.dirname(repairableFixture)],
    indexRoot,
    replacementRoots: [replacementRoot],
    repoRoot,
  });
  assert.equal(lookup.status, 'active', JSON.stringify(lookup.diagnostics, null, 2));
  const recommendation = lookup.entries[0].recommended_next;
  assert.deepEqual(recommendation.argv, [
    './aos',
    'work-record',
    'read',
    writerResult.written_replacement_work_record.id,
    '--root',
    replacementRoot,
    '--json',
  ]);
  assert.equal(recommendation.argv[5], replacementRoot);
  assert.equal(recommendation.command_hint, commandHintFromArgv(recommendation.argv));
  assert.ok(recommendation.command_hint.includes(`--root '${replacementRoot.replace(/'/g, "'\\''")}'`));
  assert.ok(!recommendation.command_hint.includes(`--root ${replacementRoot} --json`));

  const directRead = spawnSync(recommendation.argv[0], recommendation.argv.slice(1), {
    cwd: repoRoot,
    encoding: 'utf8',
  });
  assert.equal(directRead.status, 0, directRead.stderr);
  assert.equal(JSON.parse(directRead.stdout).record.id, writerResult.written_replacement_work_record.id);
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
  assert.ok(lookupForm.args.some((arg) => arg.id === 'replacement-root' && arg.token === '--replacement-root'));
  assert.equal(validateForm.execution.read_only, true);

  const indexRoot = fs.mkdtempSync(path.join(os.tmpdir(), "aos supersession lookup ; quoted '$INDEX-cli-"));
  const replacementOutputRoot = fs.mkdtempSync(path.join(os.tmpdir(), "aos supersession lookup ; quoted '$ROOT-cli-"));
  const { outputRoot, replacementPath, writerResult } = writeReplacement({
    proposedIdSeed: 'work-record:supersession-index-cli-replacement',
    outputRoot: replacementOutputRoot,
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
  assert.equal(writeJson.recommended_next.argv[7], indexRoot);
  assert.equal(writeJson.recommended_next.command_hint, commandHintFromArgv(writeJson.recommended_next.argv));
  assert.ok(!writeJson.recommended_next.command_hint.includes(`--index-root ${indexRoot} --json`));
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
    '--replacement-root',
    outputRoot,
    '--json',
  ]);
  assert.equal(lookup.status, 0, lookup.stderr);
  const lookupJson = JSON.parse(lookup.stdout);
  assert.equal(lookupJson.status, 'active');
  assert.deepEqual(lookupJson.roots.replacement_roots, [outputRoot]);
  assert.equal(lookupJson.entries[0].replacement_readback.status, 'readable');
  assert.equal(lookupJson.entries[0].replacement_readback.resolved_root, outputRoot);
  assert.equal(lookupJson.entries[0].recommended_next.argv[5], outputRoot);
  assert.equal(lookupJson.entries[0].recommended_next.command_hint, commandHintFromArgv(lookupJson.entries[0].recommended_next.argv));
  assert.ok(!lookupJson.entries[0].recommended_next.command_hint.includes(`--root ${outputRoot} --json`));
  const argvRead = spawnSync(lookupJson.entries[0].recommended_next.argv[0], lookupJson.entries[0].recommended_next.argv.slice(1), {
    cwd: repoRoot,
    encoding: 'utf8',
  });
  assert.equal(argvRead.status, 0, argvRead.stderr);
  assert.equal(JSON.parse(argvRead.stdout).record.id, lookupJson.entries[0].replacement_work_record.id);

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
