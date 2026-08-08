import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  materializeReplacementWorkRecord,
  writeReplacementWorkRecord,
} from '../../packages/toolkit/workbench/work-record-replacement-writer.js';
import {
  buildWorkRecordRepairAttemptArtifact,
  validateWorkRecordRepairAttemptArtifact,
} from '../../packages/toolkit/workbench/work-record-repair-attempt-artifact.js';
import {
  planWorkRecordRepair,
  planWorkRecordRepairAttempt,
} from '../../packages/toolkit/workbench/work-record.js';
import {
  attemptPlan,
  readJson,
  repairableWorkRecordPath,
  replacementProposal,
  repoRoot,
  successfulAttemptArtifact,
} from '../lib/work-record-v1-fixtures.mjs';
import { validateJsonSchema } from '../lib/json-schema-validation.mjs';
import { installWorkRecordAtomicPublishTestHook } from '../../packages/toolkit/workbench/work-record-atomic-publish.js';

function withAtomicPublishHook(callback, run) {
  const restore = installWorkRecordAtomicPublishTestHook(callback);
  try {
    return run();
  } finally {
    restore();
  }
}

function rebuildArtifact(plan, baseline, overrides = {}) {
  return buildWorkRecordRepairAttemptArtifact({
    repair_attempt_plan: plan,
    status: baseline.status,
    outcome_source: baseline.outcome_source,
    timing: baseline.timing,
    operation_outcomes: baseline.operation_outcomes,
    candidate_patch_outcomes: baseline.candidate_patch_outcomes,
    recommended_command_outcomes: baseline.recommended_command_outcomes,
    evidence_refs: baseline.evidence_refs,
    verifier_before: baseline.verifier_before,
    verifier_after: baseline.verifier_after,
    postcondition_results: baseline.postcondition_results,
    cleanup_results: baseline.cleanup_results,
    rollback_results: baseline.rollback_results,
    source_work_record_mutation_check: baseline.source_work_record_mutation_check,
    source_work_record_mutated: baseline.source_work_record_mutated,
    ...overrides,
  });
}

test('Replacement Writer V1 dry-runs then atomically writes a valid V1 record', () => {
  const outputRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'aos-replacement-v1-'));
  const proposal = replacementProposal();
  const preview = writeReplacementWorkRecord({ proposal, outputRoot, dryRun: true });
  assert.equal(preview.status, 'dry_run');
  assert.equal(fs.existsSync(preview.output.output_path), false);
  const written = writeReplacementWorkRecord({ proposal, outputRoot });
  assert.equal(written.status, 'written');
  assert.equal(written.source_immutability_check.status, 'passed');
  const record = JSON.parse(fs.readFileSync(written.output.output_path, 'utf8'));
  const source = readJson(repairableWorkRecordPath);
  assert.deepEqual(record.metadata.generated_by, source.metadata.generated_by);
  assert.deepEqual(record.metadata.evidence_source_id, source.metadata.evidence_source_id);
  assert.deepEqual(record.claims, source.claims);
  assert.deepEqual(record.origin, source.origin);
  assert.deepEqual(record.intent, source.intent);
  assert.deepEqual(validateJsonSchema(path.join(repoRoot, 'shared/schemas/aos-work-record-v1.schema.json'), record), []);
  assert.deepEqual(JSON.parse(JSON.stringify(materializeReplacementWorkRecord(proposal))), record);
  assert.equal(writeReplacementWorkRecord({ proposal, outputRoot }).status, 'already_exists');
});

test('Replacement Writer preserves historical failures and upgrades only exact caller-mapped results', () => {
  const plan = attemptPlan();
  const baseline = successfulAttemptArtifact(plan);
  const mappedEvidenceId = 'caller-evidence:after-value';
  const rawEvidencePath = '/tmp/aos  caller  evidence.json';
  const evidenceRefs = baseline.evidence_refs.map((ref) => (
    ref.id === mappedEvidenceId ? { ...ref, path: rawEvidencePath } : ref
  ));
  const artifact = rebuildArtifact(plan, baseline, {
    evidence_refs: evidenceRefs,
  });
  assert.equal(validateWorkRecordRepairAttemptArtifact(artifact).status, 'passed');
  const proposal = replacementProposal(plan, artifact);
  assert.equal(proposal.status, 'proposed');
  const mapped = proposal.new_evidence.find((item) => item.artifact_evidence_id === mappedEvidenceId);
  assert.equal(mapped.artifact_path, rawEvidencePath);
  assert.deepEqual(mapped.postcondition_refs, ['postcondition:repairable-stale-saved-ref-after-value']);

  const replacement = materializeReplacementWorkRecord(proposal);
  const source = readJson(repairableWorkRecordPath);
  assert.deepEqual(replacement.metadata.replacement_writer.historical_source_claim_results, source.claim_results);
  assert.ok(replacement.metadata.replacement_writer.historical_source_claim_results.every((result) => result.status === 'failed'));
  const historicalActionResults = replacement.metadata.replacement_writer.historical_source_claim_results
    .flatMap((result) => result.postcondition_results)
    .filter((result) => /dry-run|action-executed/.test(result.postcondition_id));
  assert.ok(historicalActionResults.length >= 2);
  assert.ok(historicalActionResults.every((result) => result.status === 'failed'));
  const materializedEvidence = replacement.evidence.find((item) => item.id === mapped.new_record_evidence_id);
  assert.equal(materializedEvidence.uri, rawEvidencePath);
  assert.equal(materializedEvidence.created_at, artifact.timing.finished_at);
  assert.deepEqual(materializedEvidence.metadata, mapped.metadata);

  const activeResults = new Map(replacement.claim_results.map((result) => [result.claim_id, result]));
  const multiPostcondition = activeResults.get('claim:repairable-stale-saved-ref-2026-07-04-see-do-see-captured');
  assert.equal(multiPostcondition.status, 'verified');
  const newDryRun = multiPostcondition.postcondition_results.find((result) => /dry-run$/.test(result.postcondition_id));
  const newAction = multiPostcondition.postcondition_results.find((result) => /action-executed$/.test(result.postcondition_id));
  assert.equal(newDryRun.status, 'passed');
  assert.equal(newAction.status, 'passed');
  assert.deepEqual(newDryRun.evidence_refs, ['replacement:caller-evidence:dry-run-resolved']);
  assert.deepEqual(newAction.evidence_refs, ['replacement:caller-evidence:action-succeeded']);
  const exactMapped = activeResults.get('claim:repairable-stale-saved-ref-2026-07-04-post-action-state-observed');
  assert.equal(exactMapped.status, 'verified');
  assert.equal(exactMapped.postcondition_results[0].status, 'passed');
});

test('Replacement Writer rejects evidence policy tamper bound by Proposal identity', () => {
  for (const mutate of [
    (proposal) => { proposal.new_evidence[0].digest = 'sha256:tampered'; },
    (proposal) => { proposal.new_evidence[0].artifact_path = '/tmp/tampered-evidence'; },
    (proposal) => { proposal.carried_forward_evidence[0].carry_reason = 'tampered-reason'; },
  ]) {
    const proposal = structuredClone(replacementProposal());
    mutate(proposal);
    const result = writeReplacementWorkRecord({
      proposal,
      outputRoot: fs.mkdtempSync(path.join(os.tmpdir(), 'aos-replacement-tamper-v1-')),
      dryRun: true,
    });
    assert.equal(result.status, 'blocked_invalid_proposal');
  }
});

test('Replacement Writer rejects and never materializes caller-supplied Claim Results', () => {
  const proposal = structuredClone(replacementProposal());
  proposal.proposed_replacement_work_record.claim_results = [{
    id: 'claim-result:fabricated',
    claim_id: proposal.proposed_replacement_work_record.claims[0].id,
    status: 'verified',
    confidence: 1,
    reason: 'fabricated caller assertion',
    evidence_refs: ['evidence:repairable-stale-saved-ref-after-see'],
    postcondition_results: [],
  }];
  const materialized = materializeReplacementWorkRecord(proposal);
  assert.doesNotMatch(JSON.stringify(materialized.claim_results), /fabricated caller assertion/);
  const result = writeReplacementWorkRecord({
    proposal,
    outputRoot: fs.mkdtempSync(path.join(os.tmpdir(), 'aos-replacement-claim-tamper-v1-')),
    dryRun: true,
  });
  assert.equal(result.status, 'blocked_invalid_proposal');
  assert.ok(result.diagnostics.some((item) => item.code === 'REPLACEMENT_PROPOSAL_CLAIM_RESULTS_FORBIDDEN'));
});

test('Replacement Writer rejects path escape', () => {
  const outputRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'aos-replacement-root-'));
  const result = writeReplacementWorkRecord({ proposal: replacementProposal(), outputRoot, outputPath: '../outside.json', dryRun: true });
  assert.equal(result.status, 'blocked_output_escape');
});

test('Replacement Writer rejects a regular file output root before dry-run or write', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aos-replacement-root-file-v1-'));
  const outputRoot = path.join(root, 'not-a-directory');
  fs.writeFileSync(outputRoot, 'existing file\n');
  const proposal = replacementProposal();
  for (const dryRun of [true, false]) {
    const result = writeReplacementWorkRecord({ proposal, outputRoot, dryRun });
    assert.equal(result.status, 'blocked_output_escape');
    assert.equal(result.writes_replacement_record, false);
    assert.ok(result.diagnostics.some((item) => item.code === 'REPLACEMENT_WRITER_OUTPUT_ROOT_NOT_DIRECTORY'));
  }
  assert.equal(fs.readFileSync(outputRoot, 'utf8'), 'existing file\n');
});

test('Replacement Writer rejects an output root nested under a regular file', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aos-replacement-root-ancestor-file-v1-'));
  const ancestor = path.join(root, 'not-a-directory');
  const outputRoot = path.join(ancestor, 'records');
  fs.writeFileSync(ancestor, 'existing file\n');
  for (const dryRun of [true, false]) {
    const result = writeReplacementWorkRecord({ proposal: replacementProposal(), outputRoot, dryRun });
    assert.equal(result.status, 'blocked_output_escape');
    assert.ok(result.diagnostics.some((item) => item.code === 'REPLACEMENT_WRITER_OUTPUT_ROOT_ANCESTOR_NOT_DIRECTORY'));
  }
  assert.equal(fs.readFileSync(ancestor, 'utf8'), 'existing file\n');
});

test('Replacement Writer rejects a non-system symlink ancestor before dry-run or write', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aos-replacement-root-ancestor-symlink-v1-'));
  const lexicalParent = path.join(root, 'lexical-parent');
  const outside = path.join(root, 'outside');
  fs.mkdirSync(lexicalParent);
  fs.mkdirSync(outside);
  fs.symlinkSync(outside, path.join(lexicalParent, 'link'));
  const outputRoot = path.join(lexicalParent, 'link', 'records');
  for (const dryRun of [true, false]) {
    const result = writeReplacementWorkRecord({ proposal: replacementProposal(), outputRoot, dryRun });
    assert.equal(result.status, 'blocked_output_escape');
    assert.ok(result.diagnostics.some((item) => item.code === 'REPLACEMENT_WRITER_OUTPUT_ROOT_SYMLINK_ANCESTOR'));
  }
  assert.equal(fs.existsSync(path.join(outside, 'records')), false);
});

test('Replacement Writer rejects symlink and non-file destination leaves before idempotency', () => {
  const proposal = replacementProposal();
  for (const leafKind of ['symlink', 'directory']) {
    const outputRoot = fs.mkdtempSync(path.join(os.tmpdir(), `aos-replacement-${leafKind}-leaf-v1-`));
    const preview = writeReplacementWorkRecord({ proposal, outputRoot, dryRun: true });
    const outputPath = preview.output.output_path;
    if (leafKind === 'symlink') {
      const identicalTarget = path.join(outputRoot, 'identical-replacement.blob');
      fs.writeFileSync(identicalTarget, `${JSON.stringify(materializeReplacementWorkRecord(proposal), null, 2)}\n`);
      fs.symlinkSync(identicalTarget, outputPath);
    } else {
      fs.mkdirSync(outputPath);
    }
    for (const dryRun of [true, false]) {
      const result = writeReplacementWorkRecord({ proposal, outputRoot, dryRun });
      assert.equal(result.status, 'blocked_conflict');
      assert.equal(result.idempotency.status, 'conflict');
      assert.equal(result.idempotency.existing_kind, leafKind === 'symlink' ? 'symlink' : 'non_file');
      assert.equal(result.writes_replacement_record, false);
      assert.ok(result.diagnostics.some((item) => item.code === 'REPLACEMENT_WRITER_OUTPUT_NOT_REGULAR_FILE'));
    }
    assert.equal(fs.lstatSync(outputPath).isSymbolicLink(), leafKind === 'symlink');
  }
});

test('Replacement Writer returns a typed preflight failure when root containment I/O fails', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aos-replacement-root-realpath-failure-v1-'));
  const outputRoot = path.join(root, 'records');
  const originalRealpathSync = fs.realpathSync;
  fs.realpathSync = (target, ...args) => {
    if (path.resolve(String(target)) === path.resolve(root)) {
      const error = new Error('injected output root containment failure');
      error.code = 'EIO';
      throw error;
    }
    return originalRealpathSync(target, ...args);
  };
  let result;
  try {
    result = writeReplacementWorkRecord({ proposal: replacementProposal(), outputRoot, dryRun: true });
  } finally {
    fs.realpathSync = originalRealpathSync;
  }
  assert.equal(result.status, 'blocked_write_failed');
  assert.ok(result.diagnostics.some((item) => item.code === 'REPLACEMENT_WRITER_OUTPUT_ROOT_UNREADABLE'));
});

test('Replacement Writer never overwrites a destination created during publication', () => {
  const outputRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'aos-replacement-race-v1-'));
  const proposal = replacementProposal();
  const preview = writeReplacementWorkRecord({ proposal, outputRoot, dryRun: true });
  const racedBytes = 'concurrent replacement bytes\n';
  let injected = false;
  const result = withAtomicPublishHook((event) => {
    if (event.operation === 'publish' && event.phase === 'before_publish_link' && !injected) {
      injected = true;
      fs.writeFileSync(event.destination_path, racedBytes, { flag: 'wx' });
    }
  }, () => writeReplacementWorkRecord({ proposal, outputRoot }));
  assert.equal(result.status, 'blocked_conflict');
  assert.equal(result.atomic_write.raced, true);
  assert.equal(fs.readFileSync(preview.output.output_path, 'utf8'), racedBytes);
  assert.equal(fs.existsSync(result.atomic_write.temp_file), false);
});

test('Replacement Writer treats identical bytes created during publication as idempotent', () => {
  const outputRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'aos-replacement-identical-race-v1-'));
  const proposal = replacementProposal();
  let injected = false;
  const result = withAtomicPublishHook((event) => {
    if (event.operation === 'publish' && event.phase === 'before_publish_link' && !injected) {
      injected = true;
      fs.writeFileSync(event.destination_path, fs.readFileSync(event.temp_file), { flag: 'wx' });
    }
  }, () => writeReplacementWorkRecord({ proposal, outputRoot }));
  assert.equal(result.status, 'already_exists');
  assert.equal(result.atomic_write.raced, true);
  assert.equal(fs.existsSync(result.atomic_write.temp_file), false);
});

test('Replacement Writer returns typed failure when an existing output is unreadable', () => {
  const outputRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'aos-replacement-existing-read-v1-'));
  const proposal = replacementProposal();
  const written = writeReplacementWorkRecord({ proposal, outputRoot });
  assert.equal(written.status, 'written');
  const result = withAtomicPublishHook((event) => {
    if (event.operation === 'inspect' && event.phase === 'after_leaf_open') {
      throw new Error('injected existing output inspection failure');
    }
  }, () => writeReplacementWorkRecord({ proposal, outputRoot }));
  assert.equal(result.status, 'blocked_write_failed');
  assert.equal(result.idempotency.status, 'unreadable_existing');
  assert.equal(result.writes_replacement_record, false);
  assert.ok(result.diagnostics.some((item) => item.code === 'REPLACEMENT_WRITER_EXISTING_OUTPUT_INSPECTION_FAILED'));
});

test('Replacement Writer rejects a leaf swapped to a symlink between inspection and open', () => {
  const outputRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'aos-replacement-open-race-v1-'));
  const proposal = replacementProposal();
  const written = writeReplacementWorkRecord({ proposal, outputRoot });
  assert.equal(written.status, 'written');
  const identicalTarget = path.join(outputRoot, 'identical-replacement.blob');
  fs.copyFileSync(written.output.output_path, identicalTarget);
  let swapped = false;
  const result = withAtomicPublishHook((event) => {
    if (!swapped && event.operation === 'inspect' && event.phase === 'after_leaf_open') {
      swapped = true;
      fs.unlinkSync(written.output.output_path);
      fs.symlinkSync(identicalTarget, written.output.output_path);
    }
  }, () => writeReplacementWorkRecord({ proposal, outputRoot }));
  assert.equal(swapped, true);
  assert.equal(result.status, 'blocked_conflict');
  assert.equal(result.idempotency.existing_kind, 'symlink');
  assert.equal(result.writes_replacement_record, false);
});

test('Replacement Writer rejects a newly published leaf swapped away from the linked inode', () => {
  const outputRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'aos-replacement-linked-inode-race-v1-'));
  const proposal = replacementProposal();
  const preview = writeReplacementWorkRecord({ proposal, outputRoot, dryRun: true });
  const identicalTarget = path.join(outputRoot, 'identical-replacement.blob');
  fs.writeFileSync(identicalTarget, `${JSON.stringify(materializeReplacementWorkRecord(proposal), null, 2)}\n`);
  let swapped = false;
  const result = withAtomicPublishHook((event) => {
    if (!swapped && event.operation === 'publish' && event.phase === 'after_publish_link') {
      swapped = true;
      fs.unlinkSync(event.destination_path);
      fs.symlinkSync(identicalTarget, event.destination_path);
    }
  }, () => writeReplacementWorkRecord({ proposal, outputRoot }));
  assert.equal(result.status, 'blocked_conflict');
  assert.equal(result.atomic_write.published, false);
  assert.equal(result.writes_replacement_record, false);
  assert.ok(result.diagnostics.some((item) => item.code === 'REPLACEMENT_WRITER_OUTPUT_CONFLICT'));
  assert.equal(fs.lstatSync(preview.output.output_path).isSymbolicLink(), true);
});

test('Replacement Writer blocks publication when the pinned parent is swapped to a symlink', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aos-replacement-parent-race-v1-'));
  const outputRoot = path.join(root, 'records');
  const displacedRoot = path.join(root, 'records-displaced');
  const outsideRoot = path.join(root, 'outside');
  fs.mkdirSync(outputRoot);
  fs.mkdirSync(outsideRoot);
  const proposal = replacementProposal();
  let swapped = false;
  const result = withAtomicPublishHook((event) => {
    if (!swapped && event.operation === 'publish' && event.phase === 'before_temp_open') {
      swapped = true;
      fs.renameSync(outputRoot, displacedRoot);
      fs.symlinkSync(outsideRoot, outputRoot);
    }
  }, () => writeReplacementWorkRecord({ proposal, outputRoot }));
  assert.equal(swapped, true);
  assert.equal(result.status, 'blocked_write_failed');
  assert.equal(result.writes_replacement_record, false);
  assert.deepEqual(fs.readdirSync(outsideRoot), []);
});

test('Replacement Writer receipts a published replacement when its source changes during publication', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aos-replacement-source-race-v1-'));
  const sourcePath = path.join(root, 'source.json');
  fs.copyFileSync(repairableWorkRecordPath, sourcePath);
  const repairPlan = planWorkRecordRepair(sourcePath, { repoRoot });
  const plan = planWorkRecordRepairAttempt(sourcePath, { repoRoot, repairPlan });
  const artifact = successfulAttemptArtifact(plan);
  const proposal = replacementProposal(plan, artifact, sourcePath);
  const outputRoot = path.join(root, 'records');
  let injected = false;
  const result = withAtomicPublishHook((event) => {
    if (!injected && event.operation === 'publish' && event.phase === 'after_publish_link') {
      injected = true;
      fs.appendFileSync(sourcePath, ' ');
    }
  }, () => writeReplacementWorkRecord({ proposal, outputRoot }));
  assert.equal(result.status, 'blocked_source_changed');
  assert.equal(result.atomic_write.published, true);
  assert.equal(result.writes_replacement_record, true);
  assert.equal(result.source_immutability_check.status, 'failed');
  assert.ok(result.diagnostics.some((item) => item.code === 'REPLACEMENT_WRITER_SOURCE_DIGEST_CHANGED'));
  assert.equal(fs.existsSync(result.output.output_path), true);
});

test('Replacement Writer receipts a published replacement when source digest readback fails', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aos-replacement-source-readback-v1-'));
  const sourcePath = path.join(root, 'source.json');
  fs.copyFileSync(repairableWorkRecordPath, sourcePath);
  const repairPlan = planWorkRecordRepair(sourcePath, { repoRoot });
  const plan = planWorkRecordRepairAttempt(sourcePath, { repoRoot, repairPlan });
  const artifact = successfulAttemptArtifact(plan);
  const proposal = replacementProposal(plan, artifact, sourcePath);
  const originalReadFileSync = fs.readFileSync;
  let published = false;
  fs.readFileSync = (file, ...args) => {
    if (published && path.resolve(String(file)) === path.resolve(sourcePath)) {
      const error = new Error('injected source digest read failure');
      error.code = 'EIO';
      throw error;
    }
    return originalReadFileSync(file, ...args);
  };
  try {
    const result = withAtomicPublishHook((event) => {
      if (event.operation === 'publish' && event.phase === 'after_publish_link') published = true;
    }, () => writeReplacementWorkRecord({ proposal, outputRoot: path.join(root, 'records') }));
    assert.equal(result.status, 'blocked_source_changed');
    assert.equal(result.atomic_write.published, true);
    assert.equal(result.writes_replacement_record, true);
    assert.ok(result.diagnostics.some((item) => item.code === 'REPLACEMENT_WRITER_SOURCE_DIGEST_READ_FAILED'));
  } finally {
    fs.readFileSync = originalReadFileSync;
  }
});

test('Replacement Writer receipts a published destination when temp cleanup fails', () => {
  const outputRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'aos-replacement-cleanup-v1-'));
  const proposal = replacementProposal();
  const preview = writeReplacementWorkRecord({ proposal, outputRoot, dryRun: true });
  const result = withAtomicPublishHook((event) => (
    event.operation === 'publish' && event.phase === 'before_temp_unlink'
      ? { fail_operation: 'unlink_temp' }
      : undefined
  ), () => writeReplacementWorkRecord({ proposal, outputRoot }));
  assert.equal(result.status, 'blocked_cleanup_failed');
  assert.equal(result.atomic_write.published, true);
  assert.equal(result.writes_replacement_record, true);
  assert.deepEqual(result.side_effects, ['write_replacement_work_record']);
  assert.equal(result.recommended_next.action, 'inspect_published_replacement_and_cleanup_temp');
  assert.equal(fs.existsSync(preview.output.output_path), true);
  assert.ok(result.output.digest);
  fs.rmSync(result.atomic_write.temp_file, { force: true });
});
