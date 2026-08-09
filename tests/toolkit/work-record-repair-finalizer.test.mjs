import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { installWorkRecordAtomicPublishTestHook } from '../../packages/toolkit/workbench/work-record-atomic-publish.js';
import { finalizeWorkRecordRepair } from '../../packages/toolkit/workbench/work-record-repair-finalizer.js';
import { materializeReplacementWorkRecord, writeReplacementWorkRecord } from '../../packages/toolkit/workbench/work-record-replacement-writer.js';
import { buildWorkRecordRepairAttemptArtifact } from '../../packages/toolkit/workbench/work-record-repair-attempt-artifact.js';
import {
  planWorkRecordRepair,
  planWorkRecordRepairAttempt,
} from '../../packages/toolkit/workbench/work-record.js';
import { attemptPlan, repairableWorkRecordPath, replacementProposal, repoRoot, successfulAttemptArtifact } from '../lib/work-record-v1-fixtures.mjs';

function withAtomicPublishHook(callback, run) {
  const restore = installWorkRecordAtomicPublishTestHook(callback);
  try {
    return run();
  } finally {
    restore();
  }
}

function fixtureSet(plan = attemptPlan()) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aos-finalizer-v1-'));
  const artifact = successfulAttemptArtifact(plan);
  const attemptPlanPath = path.join(root, 'attempt-plan.json');
  const attemptArtifactPath = path.join(root, 'attempt-artifact.json');
  fs.writeFileSync(attemptPlanPath, `${JSON.stringify(plan, null, 2)}\n`);
  fs.writeFileSync(attemptArtifactPath, `${JSON.stringify(artifact, null, 2)}\n`);
  return {
    root,
    attemptPlanPath,
    attemptArtifactPath,
    replacementRoot: path.join(root, 'records'),
    indexRoot: path.join(root, 'index'),
  };
}

function artifactWithoutCandidatePatchOutcome(plan) {
  const baseline = successfulAttemptArtifact(plan);
  return buildWorkRecordRepairAttemptArtifact({
    repair_attempt_plan: plan,
    status: baseline.status,
    outcome_source: baseline.outcome_source,
    timing: baseline.timing,
    operation_outcomes: baseline.operation_outcomes,
    candidate_patch_outcomes: [],
    recommended_command_outcomes: baseline.recommended_command_outcomes,
    evidence_refs: baseline.evidence_refs,
    verifier_before: baseline.verifier_before,
    verifier_after: baseline.verifier_after,
    postcondition_results: baseline.postcondition_results,
    cleanup_results: baseline.cleanup_results,
    rollback_results: baseline.rollback_results,
    source_work_record_mutation_check: baseline.source_work_record_mutation_check,
    source_work_record_mutated: baseline.source_work_record_mutated,
  });
}

test('Finalizer V1 validates exact preflight then writes replacement and supersession atomically', () => {
  const paths = fixtureSet();
  const options = {
    sourceRef: repairableWorkRecordPath,
    ...paths,
    proposedIdSeed: 'work-record:finalized-replacement-v1',
    repoRoot,
  };
  const preview = finalizeWorkRecordRepair({ ...options, dryRun: true });
  assert.equal(preview.status, 'dry_run');
  const result = finalizeWorkRecordRepair(options);
  assert.equal(result.status, 'finalized');
  assert.equal(result.source_work_record.immutable, true);
  assert.equal(result.repair_attempt_plan.validation.status, 'passed');
  assert.equal(result.repair_attempt_artifact.validation.status, 'passed');
  assert.equal(result.readback.supersession_entry_validation.status, 'passed');
  assert.match(result.replacement_writer_result.atomic_write.destination_identity.dev, /^\d+$/);
  assert.match(result.replacement_writer_result.atomic_write.destination_identity.ino, /^\d+$/);
  assert.equal(result.replacement_writer_result.atomic_write.destination_identity.nlink, '1');
  assert.match(result.supersession_index_result.atomic_write.destination_identity.dev, /^\d+$/);
  assert.match(result.supersession_index_result.atomic_write.destination_identity.ino, /^\d+$/);
  assert.equal(result.supersession_index_result.atomic_write.destination_identity.nlink, '1');
  assert.equal(finalizeWorkRecordRepair(options).status, 'already_finalized');
  assert.doesNotMatch(JSON.stringify(result), /authorization|approval|required_gate|automatic_replay/);
});

test('Finalizer V1 fails closed on stale Attempt Plan digest', () => {
  const paths = fixtureSet();
  const artifact = JSON.parse(fs.readFileSync(paths.attemptArtifactPath, 'utf8'));
  artifact.repair_attempt_plan.digest = 'stale';
  fs.writeFileSync(paths.attemptArtifactPath, `${JSON.stringify(artifact, null, 2)}\n`);
  const result = finalizeWorkRecordRepair({ sourceRef: repairableWorkRecordPath, ...paths, repoRoot, dryRun: true });
  assert.equal(result.status, 'blocked_invalid_attempt_artifact');
});

test('Finalizer returns typed failures for pre-publication source digest I/O', () => {
  for (const [failingRead, expectedStatus, expectedCode] of [
    [2, 'blocked_invalid_source', 'REPAIR_FINALIZATION_SOURCE_DIGEST_READ_FAILED'],
    [3, 'blocked_source_mutated', 'REPAIR_FINALIZATION_SOURCE_DIGEST_READBACK_FAILED'],
  ]) {
    const paths = fixtureSet();
    const originalReadFileSync = fs.readFileSync;
    let sourceReads = 0;
    fs.readFileSync = (file, ...args) => {
      if (path.resolve(String(file)) === path.resolve(repairableWorkRecordPath)) {
        sourceReads += 1;
        if (sourceReads === failingRead) {
          const error = new Error('injected pre-publication source digest failure');
          error.code = 'EIO';
          throw error;
        }
      }
      return originalReadFileSync(file, ...args);
    };
    let result;
    try {
      result = finalizeWorkRecordRepair({
        sourceRef: repairableWorkRecordPath,
        ...paths,
        repoRoot,
        dryRun: true,
      });
    } finally {
      fs.readFileSync = originalReadFileSync;
    }
    assert.equal(result.status, expectedStatus);
    assert.ok(result.diagnostics.some((item) => item.code === expectedCode));
    assert.deepEqual(result.side_effects, []);
  }
});

test('Finalizer rejects a successful Artifact missing the planned candidate patch outcome', () => {
  const plan = attemptPlan();
  const paths = fixtureSet(plan);
  fs.writeFileSync(paths.attemptArtifactPath, `${JSON.stringify(artifactWithoutCandidatePatchOutcome(plan), null, 2)}\n`);
  const result = finalizeWorkRecordRepair({ sourceRef: repairableWorkRecordPath, ...paths, repoRoot, dryRun: true });
  assert.equal(result.status, 'blocked_invalid_attempt_artifact');
  assert.equal(result.writes_replacement_record, false);
});

test('Finalizer V1 rejects a source whose raw bytes changed after planning', () => {
  const sourceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'aos-finalizer-source-v1-'));
  const sourceRef = path.join(sourceRoot, 'source.json');
  fs.copyFileSync(repairableWorkRecordPath, sourceRef);
  const repairPlan = planWorkRecordRepair(sourceRef, { repoRoot, roots: [sourceRoot] });
  const plan = planWorkRecordRepairAttempt(sourceRef, { repoRoot, roots: [sourceRoot], repairPlan });
  const paths = fixtureSet(plan);

  const changedSource = JSON.parse(fs.readFileSync(sourceRef, 'utf8'));
  changedSource.label = `${changedSource.label} changed after planning`;
  fs.writeFileSync(sourceRef, `${JSON.stringify(changedSource, null, 2)}\n`);

  const result = finalizeWorkRecordRepair({
    sourceRef,
    roots: [sourceRoot],
    ...paths,
    repoRoot,
    dryRun: true,
  });
  assert.equal(result.status, 'stale');
  assert.equal(result.writes_replacement_record, false);
  assert.equal(result.writes_supersession_index_entry, false);
});

test('Finalizer rejects an identical source copy at a different path', () => {
  const paths = fixtureSet();
  const cloneRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'aos-finalizer-source-clone-v1-'));
  const clonePath = path.join(cloneRoot, 'source-clone.json');
  fs.copyFileSync(repairableWorkRecordPath, clonePath);
  const result = finalizeWorkRecordRepair({
    sourceRef: clonePath,
    roots: [cloneRoot],
    ...paths,
    repoRoot,
    dryRun: true,
  });
  assert.equal(result.status, 'mismatch');
  assert.equal(result.writes_replacement_record, false);
  assert.equal(result.writes_supersession_index_entry, false);
});

test('planning and finalization preserve repeated whitespace in raw source paths', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aos-finalizer-spaced-v1-'));
  const sourceRoot = path.join(root, 'aos  path  review');
  fs.mkdirSync(sourceRoot);
  const sourceRef = path.join(sourceRoot, 'source  record.json');
  fs.copyFileSync(repairableWorkRecordPath, sourceRef);
  const expectedDigest = crypto.createHash('sha256').update(fs.readFileSync(sourceRef)).digest('hex');
  const repairPlan = planWorkRecordRepair(sourceRef, { repoRoot, roots: [sourceRoot] });
  assert.equal(repairPlan.source_work_record.path, sourceRef);
  assert.equal(repairPlan.source_work_record.digest, expectedDigest);
  const plan = planWorkRecordRepairAttempt(sourceRef, { repoRoot, roots: [sourceRoot], repairPlan });
  assert.equal(plan.source_work_record.path, sourceRef);
  const paths = fixtureSet(plan);
  const result = finalizeWorkRecordRepair({
    sourceRef,
    roots: [sourceRoot],
    ...paths,
    repoRoot,
    dryRun: true,
  });
  assert.equal(result.status, 'dry_run');
  assert.equal(result.source_work_record.path, sourceRef);
  const materialized = materializeReplacementWorkRecord(replacementProposal(plan, successfulAttemptArtifact(plan), sourceRef));
  const source = JSON.parse(fs.readFileSync(sourceRef, 'utf8'));
  const sourceEvidenceIds = new Set(source.evidence.map((item) => item.id));
  assert.deepEqual(materialized.evidence.filter((item) => sourceEvidenceIds.has(item.id)), source.evidence);
});

test('finalizer receipts preserve repeated whitespace in plan and artifact paths', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aos-finalizer-spaced-input-v1-'));
  const plan = attemptPlan();
  const artifact = successfulAttemptArtifact(plan);
  const attemptPlanPath = path.join(root, 'attempt  plan.json');
  const attemptArtifactPath = path.join(root, 'attempt  artifact.json');
  fs.writeFileSync(attemptPlanPath, `${JSON.stringify(plan, null, 2)}\n`);
  fs.writeFileSync(attemptArtifactPath, `${JSON.stringify(artifact, null, 2)}\n`);
  const result = finalizeWorkRecordRepair({
    sourceRef: repairableWorkRecordPath,
    attemptPlanPath,
    attemptArtifactPath,
    replacementRoot: path.join(root, 'records'),
    indexRoot: path.join(root, 'index'),
    repoRoot,
    dryRun: true,
  });
  assert.equal(result.status, 'dry_run');
  assert.equal(result.repair_attempt_plan.path, attemptPlanPath);
  assert.equal(result.repair_attempt_artifact.path, attemptArtifactPath);
  assert.equal(fs.existsSync(result.repair_attempt_plan.path), true);
  assert.equal(fs.existsSync(result.repair_attempt_artifact.path), true);
});

test('Finalizer dry-run and write preserve repeated-space replacement/index identities', () => {
  const paths = fixtureSet();
  paths.replacementRoot = path.join(paths.root, 'replacement  records');
  paths.indexRoot = path.join(paths.root, 'supersession  index');
  const options = {
    sourceRef: repairableWorkRecordPath,
    ...paths,
    proposedIdSeed: 'work-record:spaced-finalized-replacement-v1',
    repoRoot,
  };
  const preview = finalizeWorkRecordRepair({ ...options, dryRun: true });
  assert.equal(preview.status, 'dry_run');
  assert.equal(preview.supersession_index_result.replacement_work_record.path, preview.replacement_writer_result.output.output_path);
  const written = finalizeWorkRecordRepair(options);
  assert.equal(written.status, 'finalized');
  assert.equal(written.supersession_index_result.replacement_work_record.path, preview.supersession_index_result.replacement_work_record.path);
  assert.equal(written.supersession_index_result.supersession_entry.digest, preview.supersession_index_result.supersession_entry.digest);
});

test('Finalizer receipts a scrubbed replacement staging file when publication fails', () => {
  const paths = fixtureSet();
  let publicationFailureInjected = false;
  const result = withAtomicPublishHook((event) => {
    if (!publicationFailureInjected && event.operation === 'publish' && event.phase === 'before_publish_link') {
      publicationFailureInjected = true;
      return { fail_operation: 'link_destination' };
    }
    return undefined;
  }, () => finalizeWorkRecordRepair({
      sourceRef: repairableWorkRecordPath,
      ...paths,
      repoRoot,
    }));
  assert.equal(publicationFailureInjected, true);
  assert.equal(result.status, 'blocked_replacement_write');
  assert.equal(result.replacement_writer_result.status, 'blocked_write_failed');
  assert.equal(result.writes_replacement_record, false);
  assert.equal(result.wrote_replacement_record, false);
  assert.equal(result.writes_supersession_index_entry, false);
  assert.equal(result.replacement_writer_result.atomic_write.published, false);
  assert.equal(result.replacement_writer_result.atomic_write.content_scrubbed, true);
  assert.equal(result.replacement_writer_result.atomic_write.temp_file_leftover, true);
  assert.equal(fs.existsSync(result.replacement_writer_result.atomic_write.temp_file), true);
  assert.equal(fs.statSync(result.replacement_writer_result.atomic_write.temp_file).size, 0);
  assert.equal(result.recovery.action, 'inspect_replacement_publication_receipt');
  assert.equal(result.recovery.content_scrubbed, true);
  assert.equal(result.recovery.temp_file_leftover, true);
  assert.equal(result.recovery.destination_file_leftover, false);
  assert.equal(JSON.stringify(result.recovery).includes('write_source_supersession_entry'), false);
  fs.rmSync(result.replacement_writer_result.atomic_write.temp_file, { force: true });
});

test('Finalizer points recovery at a scrubbed replacement destination receipt', () => {
  const paths = fixtureSet();
  const leaked = path.join(paths.root, 'replacement-hard-link-receipt');
  let injected = false;
  const result = withAtomicPublishHook((event) => {
    if (!injected && event.operation === 'publish' && event.phase === 'after_publish_link') {
      injected = true;
      fs.linkSync(event.destination_path, leaked);
    }
  }, () => finalizeWorkRecordRepair({
      sourceRef: repairableWorkRecordPath,
      ...paths,
      repoRoot,
    }));
  assert.equal(injected, true);
  assert.equal(result.status, 'blocked_replacement_write');
  assert.equal(result.replacement_writer_result.status, 'blocked_write_failed');
  assert.equal(result.replacement_writer_result.atomic_write.published, false);
  assert.equal(result.replacement_writer_result.atomic_write.content_scrubbed, true);
  assert.equal(result.replacement_writer_result.atomic_write.temp_file_leftover, false);
  assert.equal(result.replacement_writer_result.atomic_write.destination_file_leftover, true);
  assert.equal(result.recovery.action, 'inspect_replacement_publication_receipt');
  assert.equal(result.recovery.content_scrubbed, true);
  assert.equal(result.recovery.temp_file_leftover, false);
  assert.equal(result.recovery.destination_file_leftover, true);
  assert.equal(fs.statSync(result.replacement_writer_result.output.output_path).size, 0);
  assert.equal(fs.statSync(leaked).size, 0);
});

test('Finalizer surfaces an idempotent-race receipt after successful finalization', () => {
  const paths = fixtureSet();
  let injected = false;
  const result = withAtomicPublishHook((event) => {
    if (!injected && event.operation === 'publish' && event.phase === 'before_publish_link') {
      injected = true;
      fs.writeFileSync(event.destination_path, fs.readFileSync(event.temp_file), { flag: 'wx' });
    }
  }, () => finalizeWorkRecordRepair({
      sourceRef: repairableWorkRecordPath,
      ...paths,
      repoRoot,
    }));
  assert.equal(injected, true);
  assert.equal(result.status, 'finalized');
  assert.equal(result.replacement_writer_result.status, 'already_exists');
  assert.equal(result.replacement_writer_result.atomic_write.content_scrubbed, true);
  assert.equal(result.replacement_writer_result.atomic_write.temp_file_leftover, true);
  assert.equal(result.recovery.action, 'lookup_or_read_replacement');
  assert.equal(result.recovery.publication_receipts.length, 1);
  assert.equal(result.recovery.publication_receipts[0].action, 'inspect_replacement_publication_receipt');
  assert.equal(result.recovery.publication_receipts[0].content_scrubbed, true);
  assert.equal(result.recovery.publication_receipts[0].temp_file_leftover, true);
  assert.equal(result.recovery.publication_receipts[0].destination_file_leftover, false);
  assert.ok(result.recovery.recommendations.some((item) => item.action === 'inspect_replacement_publication_receipt'));
  assert.equal(fs.existsSync(result.replacement_writer_result.atomic_write.temp_file), true);
  assert.equal(fs.statSync(result.replacement_writer_result.atomic_write.temp_file).size, 0);
  fs.rmSync(result.replacement_writer_result.atomic_write.temp_file, { force: true });
});

test('Finalizer retains replacement receipt when post-publication source digest readback fails', () => {
  const paths = fixtureSet();
  const originalReadFileSync = fs.readFileSync;
  let publicationCalls = 0;
  let replacementPublished = false;
  fs.readFileSync = (file, ...args) => {
    if (replacementPublished && path.resolve(String(file)) === path.resolve(repairableWorkRecordPath)) {
      const error = new Error('injected finalizer source digest read failure');
      error.code = 'EIO';
      throw error;
    }
    return originalReadFileSync(file, ...args);
  };
  let result;
  try {
    result = withAtomicPublishHook((event) => {
      if (event.operation === 'publish' && event.phase === 'after_native_publish' && event.published) {
        publicationCalls += 1;
        if (publicationCalls === 1) replacementPublished = true;
      }
    }, () => finalizeWorkRecordRepair({
      sourceRef: repairableWorkRecordPath,
      ...paths,
      repoRoot,
    }));
  } finally {
    fs.readFileSync = originalReadFileSync;
  }
  assert.equal(publicationCalls, 1);
  assert.equal(result.status, 'partial_finalized');
  assert.equal(result.wrote_replacement_record, true);
  assert.equal(result.replacement_writer_result.atomic_write.published, true);
  assert.ok(result.diagnostics.some((item) => item.code === 'REPLACEMENT_WRITER_SOURCE_DIGEST_READ_FAILED'));
});

test('Finalizer retains replacement receipt when supersession planning cannot scan', () => {
  const paths = fixtureSet();
  const indexBase = path.join(paths.indexRoot, 'source-supersession', 'v1');
  fs.mkdirSync(indexBase, { recursive: true });
  const originalReaddirSync = fs.readdirSync;
  let publicationCalls = 0;
  let replacementPublished = false;
  fs.readdirSync = (dir, ...args) => {
    if (replacementPublished && path.resolve(String(dir)) === path.resolve(indexBase)) {
      const error = new Error('injected supersession plan scan failure');
      error.code = 'EIO';
      throw error;
    }
    return originalReaddirSync(dir, ...args);
  };
  let result;
  try {
    result = withAtomicPublishHook((event) => {
      if (event.operation === 'publish' && event.phase === 'after_native_publish' && event.published) {
        publicationCalls += 1;
        if (publicationCalls === 1) replacementPublished = true;
      }
    }, () => finalizeWorkRecordRepair({
      sourceRef: repairableWorkRecordPath,
      ...paths,
      repoRoot,
    }));
  } finally {
    fs.readdirSync = originalReaddirSync;
  }
  assert.equal(publicationCalls, 1);
  assert.equal(result.status, 'partial_finalized');
  assert.equal(result.wrote_replacement_record, true);
  assert.equal(result.replacement_writer_result.atomic_write.published, true);
  assert.equal(result.supersession_index_result.status, 'blocked_write_failed');
  assert.ok(result.diagnostics.some((item) => item.code === 'SUPERSESSION_INDEX_SCAN_FAILED'));
});

test('Finalizer receipts a scrubbed supersession staging file when publication fails', () => {
  const paths = fixtureSet();
  let publicationCalls = 0;
  const result = withAtomicPublishHook((event) => {
    if (event.operation === 'publish' && event.phase === 'before_publish_link') {
      publicationCalls += 1;
      if (publicationCalls === 2) return { fail_operation: 'link_destination' };
    }
    return undefined;
  }, () => finalizeWorkRecordRepair({
      sourceRef: repairableWorkRecordPath,
      ...paths,
      repoRoot,
    }));
  assert.equal(result.status, 'partial_finalized');
  assert.equal(result.replacement_writer_result.status, 'written');
  assert.equal(result.writes_supersession_index_entry, false);
  assert.equal(result.wrote_supersession_index_entry, false);
  assert.equal(result.supersession_index_result.status, 'blocked_write_failed');
  assert.equal(result.supersession_index_result.atomic_write.published, false);
  assert.equal(result.supersession_index_result.atomic_write.content_scrubbed, true);
  assert.equal(result.supersession_index_result.atomic_write.temp_file_leftover, true);
  assert.equal(fs.existsSync(result.supersession_index_result.atomic_write.temp_file), true);
  assert.equal(fs.statSync(result.supersession_index_result.atomic_write.temp_file).size, 0);
  assert.equal(result.recovery.action, 'inspect_supersession_publication_receipt');
  assert.equal(result.recovery.content_scrubbed, true);
  assert.equal(result.recovery.temp_file_leftover, true);
  assert.equal(result.recovery.destination_file_leftover, false);
  fs.rmSync(result.supersession_index_result.atomic_write.temp_file, { force: true });
});

test('Finalizer receipts a scrubbed supersession staging file when replacement already exists', () => {
  const paths = fixtureSet();
  const proposedIdSeed = 'work-record:repairable-stale-saved-ref-replacement-v1';
  const prewritten = writeReplacementWorkRecord({
    proposal: replacementProposal(),
    outputRoot: paths.replacementRoot,
  });
  assert.equal(prewritten.status, 'written');
  let publicationFailureInjected = false;
  const result = withAtomicPublishHook((event) => {
    if (!publicationFailureInjected && event.operation === 'publish' && event.phase === 'before_publish_link') {
      publicationFailureInjected = true;
      return { fail_operation: 'link_destination' };
    }
    return undefined;
  }, () => finalizeWorkRecordRepair({
      sourceRef: repairableWorkRecordPath,
      ...paths,
      proposedIdSeed,
      repoRoot,
    }));
  assert.equal(publicationFailureInjected, true);
  assert.equal(result.replacement_writer_result.status, 'already_exists');
  assert.equal(result.replacement_record_already_existed, true);
  assert.equal(result.wrote_replacement_record, false);
  assert.equal(result.supersession_index_result.status, 'blocked_write_failed');
  assert.equal(result.supersession_index_result.atomic_write.published, false);
  assert.equal(result.supersession_index_result.atomic_write.content_scrubbed, true);
  assert.equal(result.supersession_index_result.atomic_write.temp_file_leftover, true);
  assert.equal(result.status, 'blocked_supersession_write');
  assert.equal(result.wrote_supersession_index_entry, false);
  assert.equal(result.recovery.action, 'inspect_supersession_publication_receipt');
  assert.equal(result.recovery.content_scrubbed, true);
  assert.equal(result.recovery.temp_file_leftover, true);
  assert.equal(result.recovery.destination_file_leftover, false);
  assert.equal(fs.existsSync(result.supersession_index_result.atomic_write.temp_file), true);
  assert.equal(fs.statSync(result.supersession_index_result.atomic_write.temp_file).size, 0);
  fs.rmSync(result.supersession_index_result.atomic_write.temp_file, { force: true });
});

test('Finalizer rejects a replacement leaf changed to an identical symlink clone during supersession publication', () => {
  const paths = fixtureSet();
  let publicationCalls = 0;
  let replacementPath = '';
  let clonePath = '';
  const result = withAtomicPublishHook((event) => {
    if (event.operation !== 'publish' || event.phase !== 'after_native_publish' || !event.published) return;
    publicationCalls += 1;
    if (publicationCalls === 1) {
      replacementPath = event.destination_path;
      clonePath = path.join(path.dirname(replacementPath), 'identical-replacement-clone.json');
      fs.copyFileSync(replacementPath, clonePath);
    }
    if (publicationCalls === 2) {
      fs.unlinkSync(replacementPath);
      fs.symlinkSync(clonePath, replacementPath);
    }
  }, () => finalizeWorkRecordRepair({
      sourceRef: repairableWorkRecordPath,
      ...paths,
      proposedIdSeed: 'work-record:replacement-readback-race-v1',
      repoRoot,
    }));
  assert.equal(publicationCalls, 2);
  assert.equal(result.status, 'partial_finalized');
  assert.ok(result.diagnostics.some((item) => item.code === 'SUPERSESSION_INDEX_REPLACEMENT_DIGEST_READ_FAILED'));
  assert.notEqual(result.readback.source.status, 'active');
});

test('Finalizer returns receipted partial result when published index readback is malformed', () => {
  const paths = fixtureSet();
  let publicationCalls = 0;
  let indexReads = 0;
  let injected = false;
  const result = withAtomicPublishHook((event) => {
    if (event.operation === 'publish' && event.phase === 'after_native_publish' && event.published) {
      publicationCalls += 1;
      return;
    }
    if (event.operation === 'inspect'
      && event.phase === 'after_leaf_open'
      && event.destination_path.includes(path.join('source-supersession', 'v1'))) {
      indexReads += 1;
      if (!injected && indexReads === 2) {
        injected = true;
        fs.writeFileSync(event.destination_path, '{');
      }
    }
  }, () => finalizeWorkRecordRepair({
    sourceRef: repairableWorkRecordPath,
    ...paths,
    proposedIdSeed: 'work-record:malformed-index-readback-v1',
    repoRoot,
  }));
  assert.equal(publicationCalls, 2);
  assert.ok(indexReads >= 2);
  assert.equal(injected, true);
  assert.equal(result.status, 'partial_finalized');
  assert.equal(result.wrote_replacement_record, true);
  assert.equal(result.wrote_supersession_index_entry, true);
  assert.ok(result.diagnostics.some((item) => item.code === 'REPAIR_FINALIZATION_SUPERSESSION_ENTRY_READBACK_FAILED'));
});

test('Finalizer rejects an identical symlink clone at the inode-bound supersession readback', () => {
  const paths = fixtureSet();
  let publicationCalls = 0;
  let indexReads = 0;
  let injected = false;
  const result = withAtomicPublishHook((event) => {
    if (event.operation === 'publish' && event.phase === 'after_native_publish' && event.published) {
      publicationCalls += 1;
      return;
    }
    if (event.operation === 'inspect'
      && event.phase === 'after_leaf_open'
      && event.destination_path.includes(path.join('source-supersession', 'v1'))) {
      indexReads += 1;
      if (!injected && indexReads === 2) {
        injected = true;
        const clone = path.join(paths.root, 'identical-index-clone.json');
        fs.copyFileSync(event.destination_path, clone);
        fs.unlinkSync(event.destination_path);
        fs.symlinkSync(clone, event.destination_path);
      }
    }
  }, () => finalizeWorkRecordRepair({
    sourceRef: repairableWorkRecordPath,
    ...paths,
    proposedIdSeed: 'work-record:index-inode-readback-race-v1',
    repoRoot,
  }));
  assert.equal(publicationCalls, 2);
  assert.equal(indexReads, 2);
  assert.equal(injected, true);
  assert.equal(result.status, 'partial_finalized');
  assert.equal(result.wrote_replacement_record, true);
  assert.equal(result.wrote_supersession_index_entry, true);
  assert.ok(result.diagnostics.some((item) => item.code === 'REPAIR_FINALIZATION_SUPERSESSION_ENTRY_READBACK_FAILED'));
});

test('Finalizer returns receipted partial result when post-publication lookup cannot scan', () => {
  const paths = fixtureSet();
  const originalReaddirSync = fs.readdirSync;
  let publicationCalls = 0;
  let published = false;
  fs.readdirSync = (dir, ...args) => {
    if (published && String(dir).includes(path.join('source-supersession', 'v1'))) {
      const error = new Error('injected index scan failure');
      error.code = 'EIO';
      throw error;
    }
    return originalReaddirSync(dir, ...args);
  };
  let result;
  try {
    result = withAtomicPublishHook((event) => {
      if (event.operation === 'publish' && event.phase === 'after_native_publish' && event.published) {
        publicationCalls += 1;
        if (publicationCalls === 2) published = true;
      }
    }, () => finalizeWorkRecordRepair({
      sourceRef: repairableWorkRecordPath,
      ...paths,
      proposedIdSeed: 'work-record:lookup-readback-failure-v1',
      repoRoot,
    }));
  } finally {
    fs.readdirSync = originalReaddirSync;
  }
  assert.equal(publicationCalls, 2);
  assert.equal(result.status, 'partial_finalized');
  assert.equal(result.wrote_replacement_record, true);
  assert.equal(result.wrote_supersession_index_entry, true);
  assert.ok(result.diagnostics.some((item) => item.code === 'SUPERSESSION_LOOKUP_INDEX_READ_FAILED'));
});
