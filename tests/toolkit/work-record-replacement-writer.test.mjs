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
  planWorkRecordRepair,
  planWorkRecordRepairAttempt,
  readWorkRecord,
  writeReplacementWorkRecord,
  WORK_RECORD_REPLACEMENT_WRITER_RESULT_SCHEMA_VERSION,
  WORK_RECORD_REPLACEMENT_WRITER_STATUSES,
} from '../../packages/toolkit/workbench/work-record.js';
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

function writeTempJson(value, prefix = 'aos-work-record-replacement-writer-') {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  const file = path.join(dir, 'payload.json');
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
  return file;
}

function digestFile(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function validateWorkRecordSchema(file) {
  return spawnSync(
    'python3',
    [
      '-c',
      `
import json, sys
from pathlib import Path
from jsonschema import Draft202012Validator

schema = json.loads(Path(sys.argv[1]).read_text())
instance = json.loads(Path(sys.argv[2]).read_text())
validator = Draft202012Validator(schema)
errors = sorted(validator.iter_errors(instance), key=lambda e: list(e.path))
if errors:
    for error in errors[:8]:
        print(error.message)
    sys.exit(1)
`,
      path.join(repoRoot, 'shared/schemas/aos-work-record-v0.schema.json'),
      file,
    ],
    { encoding: 'utf8' },
  );
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
      before_digest: digestFile(repairableFixture),
      after_digest: digestFile(repairableFixture),
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
    digest: digestFile(repairableFixture),
  };
}

function buildProposal({ proposedIdSeed = 'work-record:repairable-stale-saved-ref-writer-test', artifactInput = successArtifactInput(), proposalPatch = {} } = {}) {
  const artifact = buildWorkRecordRepairAttemptArtifact(artifactInput);
  return {
    ...buildWorkRecordReplacementProposal({
      source_work_record: sourceInput(),
      repair_attempt_plan: artifactInput.repair_attempt_plan,
      repair_attempt_artifact: artifact,
      source_work_record_digest_after: digestFile(repairableFixture),
      proposed_id_seed: proposedIdSeed,
    }),
    ...proposalPatch,
  };
}

test('Replacement Writer statuses are declared', () => {
  for (const status of [
    'dry_run',
    'written',
    'already_exists',
    'blocked_invalid_proposal',
    'blocked_invalid_replacement_record',
    'blocked_source_changed',
    'blocked_output_escape',
    'blocked_conflict',
    'blocked_write_failed',
    'blocked_cleanup_failed',
    'unsupported',
  ]) {
    assert.ok(WORK_RECORD_REPLACEMENT_WRITER_STATUSES.includes(status));
  }
});

test('dry-run reports exact output and does not write', () => {
  const outputRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'aos-work-record-writer-dry-run-'));
  const proposal = buildProposal();
  const result = writeReplacementWorkRecord({ proposal, outputRoot, dryRun: true });

  assert.equal(result.schema_version, WORK_RECORD_REPLACEMENT_WRITER_RESULT_SCHEMA_VERSION);
  assert.equal(result.status, 'dry_run');
  assert.equal(result.mode, 'dry_run');
  assert.equal(result.writes_replacement_record, false);
  assert.equal(result.would_write_replacement_record, true);
  assert.equal(result.mutates_source_record, false);
  assert.equal(result.executes_repair, false);
  assert.equal(result.executes_actions, false);
  assert.equal(result.applies_patches, false);
  assert.equal(result.automatic_replay_allowed, false);
  assert.equal(result.idempotency.status, 'new');
  assert.equal(result.source_immutability_check.status, 'passed');
  assert.equal(path.basename(result.output.output_path), 'work-record:repairable-stale-saved-ref-writer-test.json');
  assert.equal(fs.existsSync(result.output.output_path), false);
});

test('write is atomic, idempotent, discoverable, and source-immutable', () => {
  const outputRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'aos-work-record-writer-write-'));
  const sourceBefore = fs.readFileSync(repairableFixture, 'utf8');
  const proposal = buildProposal();
  const result = writeReplacementWorkRecord({ proposal, outputRoot });

  assert.equal(result.status, 'written', JSON.stringify(result.diagnostics, null, 2));
  assert.equal(result.writes_replacement_record, true);
  assert.equal(result.output.temp_file_leftover, false);
  assert.equal(fs.existsSync(result.atomic_write.temp_file), false);
  assert.equal(fs.readFileSync(repairableFixture, 'utf8'), sourceBefore);

  const written = JSON.parse(fs.readFileSync(result.output.output_path, 'utf8'));
  const schemaCheck = validateWorkRecordSchema(result.output.output_path);
  assert.equal(schemaCheck.status, 0, `${schemaCheck.stdout}${schemaCheck.stderr}`);
  assert.equal(written.id, 'work-record:repairable-stale-saved-ref-writer-test');
  assert.equal(written.metadata.replacement_writer.supersedes_source.source_work_record_id, proposal.source_work_record.id);
  assert.equal(written.metadata.replacement_writer.supersedes_source.source_record_edited, false);
  assert.equal(written.metadata.replacement_writer.executes_repair, false);
  assert.equal(written.metadata.replacement_writer.executes_actions, false);
  assert.equal(written.metadata.replacement_writer.applies_patches, false);

  const list = runAos(['work-record', 'list', '--root', outputRoot, '--json']);
  assert.equal(list.status, 0, list.stderr);
  assert.ok(JSON.parse(list.stdout).records.some((record) => record.id === written.id));

  const read = runAos(['work-record', 'read', written.id, '--root', outputRoot, '--json']);
  assert.equal(read.status, 0, read.stderr);
  assert.equal(JSON.parse(read.stdout).record.id, written.id);

  const repeat = writeReplacementWorkRecord({ proposal, outputRoot });
  assert.equal(repeat.status, 'already_exists');
  assert.equal(repeat.idempotency.status, 'identical_existing');
});

test('writer read follow-up is argv-backed and preserves shell metacharacter roots', () => {
  const outputRoot = fs.mkdtempSync(path.join(os.tmpdir(), "aos writer root ; quoted '$ROOT-"));
  const proposal = buildProposal({
    proposedIdSeed: 'work-record:repairable-stale-saved-ref-writer-special-root',
  });
  const result = writeReplacementWorkRecord({ proposal, outputRoot });
  assert.equal(result.status, 'written', JSON.stringify(result.diagnostics, null, 2));
  assert.deepEqual(result.recommended_next.argv, [
    './aos',
    'work-record',
    'read',
    result.written_replacement_work_record.id,
    '--root',
    outputRoot,
    '--json',
  ]);
  assert.equal(result.recommended_next.argv[5], outputRoot);
  assert.equal(result.recommended_next.command_hint, commandHintFromArgv(result.recommended_next.argv));
  assert.ok(result.recommended_next.command_hint.includes(`--root '${outputRoot.replace(/'/g, "'\\''")}'`));
  assert.ok(!result.recommended_next.command_hint.includes(`--root ${outputRoot} --json`));

  const read = spawnSync(result.recommended_next.argv[0], result.recommended_next.argv.slice(1), {
    cwd: repoRoot,
    encoding: 'utf8',
  });
  assert.equal(read.status, 0, read.stderr);
  assert.equal(JSON.parse(read.stdout).record.id, result.written_replacement_work_record.id);
});

test('writer materializes distinct evidence refs per postcondition', () => {
  const source = sourceInput();
  const [firstPostcondition, secondPostcondition] = source.record.execution_map.postconditions;
  const baseInput = successArtifactInput();
  const artifactInput = successArtifactInput({
    overrides: {
      evidence_refs: [
        ...baseInput.evidence_refs,
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
  const outputRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'aos-work-record-writer-postconditions-'));
  const proposal = buildProposal({
    proposedIdSeed: 'work-record:writer-postcondition-evidence-test',
    artifactInput,
  });
  const result = writeReplacementWorkRecord({ proposal, outputRoot });
  assert.equal(result.status, 'written', JSON.stringify(result.diagnostics, null, 2));

  const written = JSON.parse(fs.readFileSync(result.output.output_path, 'utf8'));
  const firstWritten = written.execution_map.postconditions.find((item) => item.id === firstPostcondition.id);
  const secondWritten = written.execution_map.postconditions.find((item) => item.id === secondPostcondition.id);
  assert.deepEqual(firstWritten.evidence_refs, ['replacement:evidence:postcondition-one']);
  assert.deepEqual(secondWritten.evidence_refs, ['replacement:evidence:postcondition-two']);
  assert.notDeepEqual(firstWritten.evidence_refs, secondWritten.evidence_refs);
});

test('writer blocks conflicts, invalid inputs, source drift, traversal, and symlink escape', () => {
  const proposal = buildProposal({ proposedIdSeed: 'work-record:writer-negative-test' });
  const outputRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'aos-work-record-writer-negative-'));

  const invalidProposal = writeReplacementWorkRecord({
    proposal: { ...proposal, writes_replacement_record: true },
    outputRoot,
  });
  assert.equal(invalidProposal.status, 'blocked_invalid_proposal');

  const invalidReplacement = writeReplacementWorkRecord({
    proposal: {
      ...proposal,
      proposed_replacement_work_record: {
        ...proposal.proposed_replacement_work_record,
        execution_map: {
          ...proposal.proposed_replacement_work_record.execution_map,
          replay_policy: {
            ...proposal.proposed_replacement_work_record.execution_map.replay_policy,
            repair_requires_workflow_gate: false,
          },
        },
      },
    },
    outputRoot,
  });
  assert.equal(invalidReplacement.status, 'blocked_invalid_replacement_record');

  const changedSource = writeReplacementWorkRecord({
    proposal: {
      ...proposal,
      source_work_record: {
        ...proposal.source_work_record,
        digest: 'sha256:not-the-current-source-digest',
      },
    },
    outputRoot,
  });
  assert.equal(changedSource.status, 'blocked_source_changed');

  const traversal = writeReplacementWorkRecord({
    proposal,
    outputRoot,
    outputPath: path.join(outputRoot, '..', 'work-record:writer-negative-test.json'),
  });
  assert.equal(traversal.status, 'blocked_output_escape');

  const external = fs.mkdtempSync(path.join(os.tmpdir(), 'aos-work-record-writer-external-'));
  const symlinkPath = path.join(outputRoot, 'work-record:writer-negative-test.json');
  fs.writeFileSync(path.join(external, 'escaped.json'), '{}\n');
  fs.symlinkSync(path.join(external, 'escaped.json'), symlinkPath);
  const symlinkEscape = writeReplacementWorkRecord({
    proposal,
    outputRoot,
    outputPath: symlinkPath,
  });
  assert.equal(symlinkEscape.status, 'blocked_output_escape');
});

test('writer refuses overwriting different existing content', () => {
  const outputRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'aos-work-record-writer-conflict-'));
  const proposal = buildProposal({ proposedIdSeed: 'work-record:writer-conflict-test' });
  const first = writeReplacementWorkRecord({ proposal, outputRoot });
  assert.equal(first.status, 'written');

  fs.writeFileSync(first.output.output_path, '{"type":"aos.work_record","id":"different"}\n');
  const conflict = writeReplacementWorkRecord({ proposal, outputRoot });
  assert.equal(conflict.status, 'blocked_conflict');
  assert.equal(conflict.idempotency.status, 'conflict');
});

test('public replacement-proposal write command exposes stable JSON and never runs repair', () => {
  const help = runAos(['help', 'work-record', '--json']);
  assert.equal(help.status, 0, help.stderr);
  const helpJson = JSON.parse(help.stdout);
  const form = helpJson.forms.find((item) => item.id === 'work-record-replacement-proposal-write');
  assert.ok(form, 'help should expose work-record-replacement-proposal-write');
  assert.equal(form.execution.read_only, false);
  assert.equal(form.execution.mutates_state, true);
  assert.equal(form.execution.supports_dry_run, true);
  assert.equal(form.execution.writes_replacement_record, true);
  assert.equal(form.execution.mutates_source_record, false);
  assert.equal(form.execution.executes_repair, false);
  assert.equal(form.execution.executes_actions, false);
  assert.equal(form.execution.applies_patches, false);
  assert.equal(form.execution.automatic_replay_allowed, false);

  const outputRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'aos-work-record-writer-cli-'));
  const proposalPath = writeTempJson(buildProposal({ proposedIdSeed: 'work-record:writer-cli-test' }));
  const dryRun = runAos([
    'work-record',
    'replacement-proposal',
    'write',
    proposalPath,
    '--output-root',
    outputRoot,
    '--dry-run',
    '--json',
  ]);
  assert.equal(dryRun.status, 0, dryRun.stderr);
  assert.equal(JSON.parse(dryRun.stdout).status, 'dry_run');

  const write = runAos([
    'work-record',
    'replacement-proposal',
    'write',
    proposalPath,
    '--output-root',
    outputRoot,
    '--json',
  ]);
  assert.equal(write.status, 0, write.stderr);
  const writeJson = JSON.parse(write.stdout);
  assert.equal(writeJson.status, 'written');
  assert.equal(writeJson.mutates_source_record, false);
  assert.equal(writeJson.executes_repair, false);
  assert.equal(writeJson.executes_actions, false);
  assert.equal(writeJson.applies_patches, false);
  assert.equal(writeJson.automatic_replay_allowed, false);
});
