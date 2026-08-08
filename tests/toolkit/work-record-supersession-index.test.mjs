import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  buildWorkRecordReplacementProposal,
  lookupWorkRecordSourceSupersession,
  planWorkRecordRepair,
  planWorkRecordRepairAttempt,
  validateWorkRecordSourceSupersessionEntry,
  writeReplacementWorkRecord,
  writeWorkRecordSourceSupersessionIndex,
} from '../../packages/toolkit/workbench/work-record.js';
import { planWorkRecordSourceSupersessionFromRecords } from '../../packages/toolkit/workbench/work-record-supersession-plan.js';
import {
  readJson,
  repairableWorkRecordPath,
  replacementProposal,
  repoRoot,
  successfulAttemptArtifact,
} from '../lib/work-record-v1-fixtures.mjs';
import { installWorkRecordAtomicPublishTestHook } from '../../packages/toolkit/workbench/work-record-atomic-publish.js';

function withAtomicPublishHook(callback, run) {
  const restore = installWorkRecordAtomicPublishTestHook(callback);
  try {
    return run();
  } finally {
    restore();
  }
}

function replacementProposalWithSeed(seed) {
  const repairPlan = planWorkRecordRepair(repairableWorkRecordPath, { repoRoot });
  const plan = planWorkRecordRepairAttempt(repairableWorkRecordPath, { repoRoot, repairPlan });
  const artifact = successfulAttemptArtifact(plan);
  const digest = crypto.createHash('sha256').update(fs.readFileSync(repairableWorkRecordPath)).digest('hex');
  return buildWorkRecordReplacementProposal({
    source_work_record: {
      ...plan.source_work_record,
      path: repairableWorkRecordPath,
      requested_ref: repairableWorkRecordPath,
      digest,
      record: readJson(repairableWorkRecordPath),
    },
    repair_attempt_plan: plan,
    repair_attempt_artifact: artifact,
    source_work_record_digest_after: digest,
    proposed_id_seed: seed,
  });
}

test('Source Supersession V1 writes exact external relationship without mutating either record', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aos-supersession-v1-'));
  const replacementRoot = path.join(root, 'records');
  const indexRoot = path.join(root, 'index');
  const writer = writeReplacementWorkRecord({ proposal: replacementProposal(), outputRoot: replacementRoot });
  assert.equal(writer.status, 'written');
  const result = writeWorkRecordSourceSupersessionIndex({
    sourceRef: repairableWorkRecordPath,
    replacementRef: writer.output.output_path,
    indexRoot,
    replacementRoots: [replacementRoot],
    writerResult: writer,
    repoRoot,
  });
  assert.equal(result.status, 'written');
  const serializedDigest = crypto.createHash('sha256').update(fs.readFileSync(result.output.index_path)).digest('hex');
  assert.equal(result.output.digest, serializedDigest);
  assert.notEqual(result.output.digest, result.supersession_entry.digest);
  const entry = JSON.parse(fs.readFileSync(result.output.index_path, 'utf8'));
  assert.equal(validateWorkRecordSourceSupersessionEntry(entry).status, 'passed');
  assert.deepEqual(Object.keys(entry.replacement_proposal).sort(), ['digest', 'id', 'schema_version']);
  assert.equal(Object.hasOwn(entry.replacement_writer_result, 'status'), false);
  const lookup = lookupWorkRecordSourceSupersession({
    sourceRef: repairableWorkRecordPath,
    indexRoot,
    replacementRoots: [replacementRoot],
    repoRoot,
  });
  assert.equal(lookup.status, 'active');
  assert.equal(lookup.entries[0].replacement_readback.readable, true);
  assert.doesNotMatch(JSON.stringify(result), /authorization|approval|required_gate|automatic_replay/);

  const sourceFlagIndex = result.recommended_next.argv.indexOf('--source');
  const recommendedLookup = lookupWorkRecordSourceSupersession({
    sourceRef: result.recommended_next.argv[sourceFlagIndex + 1],
    sourceRoots: [path.dirname(repairableWorkRecordPath)],
    indexRoot,
    replacementRoots: [replacementRoot],
    repoRoot,
  });
  assert.equal(recommendedLookup.status, 'active');
  assert.equal(recommendedLookup.entries.length, 1);

  const clonedSource = path.join(root, 'identical-source-clone.json');
  fs.copyFileSync(repairableWorkRecordPath, clonedSource);
  const cloneLookup = lookupWorkRecordSourceSupersession({
    sourceRef: clonedSource,
    indexRoot,
    replacementRoots: [replacementRoot],
    repoRoot,
  });
  assert.equal(cloneLookup.status, 'not_found');
  assert.equal(cloneLookup.entries.length, 0);

  for (const mutate of [
    (candidate) => { candidate.id = 'source-supersession-entry:tampered'; },
    (candidate) => { candidate.source_work_record.digest = 'tampered-source'; },
    (candidate) => { candidate.replacement_work_record.id = 'work-record:tampered-replacement'; },
    (candidate) => { candidate.supersession_entry_identity.identity_core = {}; },
    (candidate) => { candidate.status = 'conflict'; },
    (candidate) => { candidate.relationship_status = 'not_found'; },
    (candidate) => { candidate.replacement_writer_result.digest = 'sha256:fabricated-writer-result'; },
    (candidate) => { candidate.replacement_writer_result.status = 'blocked_conflict'; },
    (candidate) => { candidate.replacement_writer_result.output.temp_file_leftover = true; },
    (candidate) => { candidate.replacement_proposal.digest = 'sha256:fabricated-proposal'; },
    (candidate) => { candidate.replacement_proposal.status = 'blocked_attempt_failed'; },
    (candidate) => { candidate.replacement_writer_result.replacement_proposal.digest = 'sha256:fabricated-proposal'; },
  ]) {
    const candidate = structuredClone(entry);
    mutate(candidate);
    assert.equal(validateWorkRecordSourceSupersessionEntry(candidate).status, 'failed');
  }

  const malformed = structuredClone(entry);
  malformed.status = 'conflict';
  malformed.relationship_status = 'not_found';
  fs.writeFileSync(result.output.index_path, `${JSON.stringify(malformed, null, 2)}\n`);
  const malformedLookup = lookupWorkRecordSourceSupersession({
    sourceRef: repairableWorkRecordPath,
    indexRoot,
    replacementRoots: [replacementRoot],
    repoRoot,
  });
  assert.equal(malformedLookup.status, 'malformed_index');
  assert.equal(malformedLookup.entries.length, 0);

  const malformedProvenance = structuredClone(entry);
  malformedProvenance.replacement_proposal.digest = 'sha256:fabricated-proposal';
  fs.writeFileSync(result.output.index_path, `${JSON.stringify(malformedProvenance, null, 2)}\n`);
  const malformedProvenanceLookup = lookupWorkRecordSourceSupersession({
    sourceRef: repairableWorkRecordPath,
    indexRoot,
    replacementRoots: [replacementRoot],
    repoRoot,
  });
  assert.equal(malformedProvenanceLookup.status, 'malformed_index');
  assert.equal(malformedProvenanceLookup.entries.length, 0);
});

test('Source Supersession treats exact-identity entries with different serialized bytes as conflicts', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aos-supersession-byte-conflict-v1-'));
  const replacementRoot = path.join(root, 'records');
  const indexRoot = path.join(root, 'index');
  const writer = writeReplacementWorkRecord({ proposal: replacementProposal(), outputRoot: replacementRoot });
  const options = {
    sourceRef: repairableWorkRecordPath,
    replacementRef: writer.output.output_path,
    indexRoot,
    replacementRoots: [replacementRoot],
    writerResult: writer,
    repoRoot,
  };
  const written = writeWorkRecordSourceSupersessionIndex(options);
  assert.equal(written.status, 'written');
  const acceptedButDifferent = JSON.parse(fs.readFileSync(written.output.index_path, 'utf8'));
  acceptedButDifferent.metadata = { note: 'serialized bytes differ from the canonical publication' };
  const differentBytes = `${JSON.stringify(acceptedButDifferent, null, 2)}\n`;
  fs.writeFileSync(written.output.index_path, differentBytes);
  assert.equal(validateWorkRecordSourceSupersessionEntry(acceptedButDifferent).status, 'passed');

  const conflict = writeWorkRecordSourceSupersessionIndex(options);
  assert.equal(conflict.status, 'conflict');
  assert.equal(conflict.idempotency.status, 'conflict');
  assert.notEqual(conflict.idempotency.existing_digest, conflict.idempotency.expected_digest);
  assert.ok(conflict.diagnostics.some((item) => item.code === 'SUPERSESSION_INDEX_ENTRY_PATH_CONFLICT'));
  assert.equal(fs.readFileSync(written.output.index_path, 'utf8'), differentBytes);
});

test('Source Supersession rejects a valid relationship copied to a noncanonical index path', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aos-supersession-path-binding-v1-'));
  const replacementRoot = path.join(root, 'records');
  const indexRoot = path.join(root, 'index');
  const writer = writeReplacementWorkRecord({ proposal: replacementProposal(), outputRoot: replacementRoot });
  const written = writeWorkRecordSourceSupersessionIndex({
    sourceRef: repairableWorkRecordPath,
    replacementRef: writer.output.output_path,
    indexRoot,
    replacementRoots: [replacementRoot],
    writerResult: writer,
    repoRoot,
  });
  assert.equal(written.status, 'written');
  const alternate = path.join(indexRoot, 'source-supersession', 'v1', 'alternate.json');
  const copied = JSON.parse(fs.readFileSync(written.output.index_path, 'utf8'));
  copied.metadata = { note: 'different serialized bytes at a noncanonical path' };
  fs.writeFileSync(alternate, `${JSON.stringify(copied, null, 2)}\n`);

  const lookup = lookupWorkRecordSourceSupersession({
    sourceRef: repairableWorkRecordPath,
    indexRoot,
    replacementRoots: [replacementRoot],
    repoRoot,
  });
  assert.equal(lookup.status, 'malformed_index');
  assert.equal(lookup.entries.length, 1);
  assert.equal(lookup.malformed_entries.length, 1);
  assert.ok(lookup.malformed_entries[0].diagnostics
    .some((item) => item.code === 'SUPERSESSION_INDEX_ENTRY_PHYSICAL_PATH_MISMATCH'));
});

test('Source Supersession readback rejects an identical replacement clone at a different path', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aos-supersession-replacement-clone-v1-'));
  const replacementRoot = path.join(root, 'records');
  const cloneRoot = path.join(root, 'clone');
  const indexRoot = path.join(root, 'index');
  fs.mkdirSync(cloneRoot);
  const writer = writeReplacementWorkRecord({ proposal: replacementProposal(), outputRoot: replacementRoot });
  const written = writeWorkRecordSourceSupersessionIndex({
    sourceRef: repairableWorkRecordPath,
    replacementRef: writer.output.output_path,
    indexRoot,
    replacementRoots: [replacementRoot],
    writerResult: writer,
    repoRoot,
  });
  assert.equal(written.status, 'written');
  const clonePath = path.join(cloneRoot, 'clone.json');
  fs.copyFileSync(writer.output.output_path, clonePath);

  const lookup = lookupWorkRecordSourceSupersession({
    sourceRef: repairableWorkRecordPath,
    indexRoot,
    replacementRoots: [cloneRoot, root],
    repoRoot,
  });
  assert.equal(lookup.status, 'blocked_invalid_replacement');
  assert.equal(lookup.entries[0].replacement_readback.status, 'path_mismatch');
  assert.equal(lookup.entries[0].replacement_readback.readable, false);
  assert.ok(lookup.entries[0].replacement_readback.diagnostics
    .some((item) => item.code === 'SUPERSESSION_LOOKUP_REPLACEMENT_PATH_MISMATCH'));
  assert.deepEqual(lookup.entries[0].recommended_next.argv, []);
});

test('Source Supersession lookup rejects an indexed replacement leaf changed to an identical symlink clone', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aos-supersession-replacement-symlink-clone-v1-'));
  const replacementRoot = path.join(root, 'records');
  const indexRoot = path.join(root, 'index');
  const writer = writeReplacementWorkRecord({ proposal: replacementProposal(), outputRoot: replacementRoot });
  const written = writeWorkRecordSourceSupersessionIndex({
    sourceRef: repairableWorkRecordPath,
    replacementRef: writer.output.output_path,
    indexRoot,
    replacementRoots: [replacementRoot],
    writerResult: writer,
    repoRoot,
  });
  assert.equal(written.status, 'written');
  const cloneRoot = path.join(replacementRoot, 'clone');
  fs.mkdirSync(cloneRoot);
  const clonePath = path.join(cloneRoot, 'identical-replacement-clone.json');
  fs.copyFileSync(writer.output.output_path, clonePath);
  fs.unlinkSync(writer.output.output_path);
  fs.symlinkSync(clonePath, writer.output.output_path);
  const lookup = lookupWorkRecordSourceSupersession({
    sourceRef: repairableWorkRecordPath,
    indexRoot,
    replacementRoots: [replacementRoot],
    repoRoot,
  });
  assert.equal(lookup.status, 'blocked_invalid_replacement');
  assert.equal(lookup.entries[0].replacement_readback.readable, false);
  assert.ok(lookup.diagnostics.some((item) => item.code === 'SUPERSESSION_INDEX_REPLACEMENT_DIGEST_READ_FAILED'));
});

test('Source Supersession rejects traversal outside explicit index root', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aos-supersession-escape-'));
  const replacementRoot = path.join(root, 'records');
  const writer = writeReplacementWorkRecord({ proposal: replacementProposal(), outputRoot: replacementRoot });
  const result = writeWorkRecordSourceSupersessionIndex({
    sourceRef: repairableWorkRecordPath,
    replacementRef: writer.output.output_path,
    indexRoot: '../escape',
    replacementRoots: [replacementRoot],
    writerResult: writer,
    repoRoot,
    dryRun: true,
  });
  assert.equal(result.status, 'blocked_index_escape');
});

test('Source Supersession rejects an index root nested under a regular file', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aos-supersession-root-ancestor-file-v1-'));
  const ancestor = path.join(root, 'not-a-directory');
  const indexRoot = path.join(ancestor, 'index');
  const replacementRoot = path.join(root, 'records');
  fs.writeFileSync(ancestor, 'existing file\n');
  const writer = writeReplacementWorkRecord({ proposal: replacementProposal(), outputRoot: replacementRoot });
  for (const dryRun of [true, false]) {
    const result = writeWorkRecordSourceSupersessionIndex({
      sourceRef: repairableWorkRecordPath,
      replacementRef: writer.output.output_path,
      indexRoot,
      replacementRoots: [replacementRoot],
      writerResult: writer,
      repoRoot,
      dryRun,
    });
    assert.equal(result.status, 'blocked_index_escape');
    assert.ok(result.diagnostics.some((item) => item.code === 'SUPERSESSION_INDEX_ROOT_ANCESTOR_NOT_DIRECTORY'));
  }
});

test('Source Supersession rejects a non-system symlink ancestor before planning or write', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aos-supersession-root-ancestor-symlink-v1-'));
  const lexicalParent = path.join(root, 'lexical-parent');
  const outside = path.join(root, 'outside');
  const replacementRoot = path.join(root, 'records');
  fs.mkdirSync(lexicalParent);
  fs.mkdirSync(outside);
  fs.symlinkSync(outside, path.join(lexicalParent, 'link'));
  const indexRoot = path.join(lexicalParent, 'link', 'index');
  const writer = writeReplacementWorkRecord({ proposal: replacementProposal(), outputRoot: replacementRoot });
  for (const dryRun of [true, false]) {
    const result = writeWorkRecordSourceSupersessionIndex({
      sourceRef: repairableWorkRecordPath,
      replacementRef: writer.output.output_path,
      indexRoot,
      replacementRoots: [replacementRoot],
      writerResult: writer,
      repoRoot,
      dryRun,
    });
    assert.equal(result.status, 'blocked_index_escape');
    assert.ok(result.diagnostics.some((item) => item.code === 'SUPERSESSION_INDEX_ROOT_SYMLINK_ANCESTOR'));
  }
  assert.equal(fs.existsSync(path.join(outside, 'index')), false);
});

test('Source Supersession planner returns typed preflight failure when root containment I/O fails', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aos-supersession-root-realpath-failure-v1-'));
  const replacementRoot = path.join(root, 'records');
  const indexRoot = path.join(root, 'index');
  const writer = writeReplacementWorkRecord({ proposal: replacementProposal(), outputRoot: replacementRoot });
  const sourceRecord = readJson(repairableWorkRecordPath);
  const replacementRecord = JSON.parse(fs.readFileSync(writer.output.output_path, 'utf8'));
  const originalRealpathSync = fs.realpathSync;
  fs.realpathSync = (target, ...args) => {
    if (path.resolve(String(target)) === path.resolve(root)) {
      const error = new Error('injected index root containment failure');
      error.code = 'EIO';
      throw error;
    }
    return originalRealpathSync(target, ...args);
  };
  let result;
  try {
    result = planWorkRecordSourceSupersessionFromRecords({
      sourceRef: repairableWorkRecordPath,
      sourceRecord,
      sourcePath: repairableWorkRecordPath,
      replacementRef: writer.output.output_path,
      replacementRecord,
      replacementPath: writer.output.output_path,
      indexRoot,
      replacementRoots: [replacementRoot],
      writerResult: writer,
      repoRoot,
    });
  } finally {
    fs.realpathSync = originalRealpathSync;
  }
  assert.equal(result.status, 'blocked_write_failed');
  assert.ok(result.diagnostics.some((item) => item.code === 'SUPERSESSION_INDEX_ROOT_UNREADABLE'));
});

test('Source Supersession never overwrites an index entry created during publication', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aos-supersession-race-v1-'));
  const replacementRoot = path.join(root, 'records');
  const indexRoot = path.join(root, 'index');
  const writer = writeReplacementWorkRecord({ proposal: replacementProposal(), outputRoot: replacementRoot });
  const options = {
    sourceRef: repairableWorkRecordPath,
    replacementRef: writer.output.output_path,
    indexRoot,
    replacementRoots: [replacementRoot],
    writerResult: writer,
    repoRoot,
  };
  const preview = writeWorkRecordSourceSupersessionIndex({ ...options, dryRun: true });
  const racedBytes = 'concurrent supersession bytes\n';
  let injected = false;
  const result = withAtomicPublishHook((event) => {
    if (!injected && event.operation === 'publish' && event.phase === 'before_publish_link') {
      injected = true;
      fs.writeFileSync(event.destination_path, racedBytes, { flag: 'wx' });
    }
  }, () => writeWorkRecordSourceSupersessionIndex(options));
  assert.equal(result.status, 'conflict');
  assert.equal(result.atomic_write.raced, true);
  assert.equal(fs.readFileSync(preview.output.index_path, 'utf8'), racedBytes);
  assert.equal(fs.existsSync(result.atomic_write.temp_file), false);
});

test('Source Supersession rejects an incomplete supplied Replacement Writer Result', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aos-supersession-writer-result-v1-'));
  const replacementRoot = path.join(root, 'records');
  const writer = writeReplacementWorkRecord({ proposal: replacementProposal(), outputRoot: replacementRoot });
  const result = writeWorkRecordSourceSupersessionIndex({
    sourceRef: repairableWorkRecordPath,
    replacementRef: writer.output.output_path,
    indexRoot: path.join(root, 'index'),
    replacementRoots: [replacementRoot],
    writerResult: {
      type: writer.type,
      schema_version: writer.schema_version,
      status: 'written',
    },
    repoRoot,
    dryRun: true,
  });
  assert.equal(result.status, 'blocked_invalid_replacement');
  assert.ok(result.diagnostics.some((item) => item.code === 'SUPERSESSION_INDEX_WRITER_RESULT_INCOMPLETE'));
});

test('Source Supersession planning returns typed failure when the index cannot be scanned', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aos-supersession-scan-failure-v1-'));
  const replacementRoot = path.join(root, 'records');
  const indexRoot = path.join(root, 'index');
  const indexBase = path.join(indexRoot, 'source-supersession', 'v1');
  fs.mkdirSync(indexBase, { recursive: true });
  const writer = writeReplacementWorkRecord({ proposal: replacementProposal(), outputRoot: replacementRoot });
  const originalReaddirSync = fs.readdirSync;
  fs.readdirSync = (dir, ...args) => {
    if (path.resolve(String(dir)) === path.resolve(indexBase)) {
      const error = new Error('injected index scan failure');
      error.code = 'EIO';
      throw error;
    }
    return originalReaddirSync(dir, ...args);
  };
  let result;
  try {
    result = writeWorkRecordSourceSupersessionIndex({
      sourceRef: repairableWorkRecordPath,
      replacementRef: writer.output.output_path,
      indexRoot,
      replacementRoots: [replacementRoot],
      writerResult: writer,
      repoRoot,
      dryRun: true,
    });
  } finally {
    fs.readdirSync = originalReaddirSync;
  }
  assert.equal(result.status, 'blocked_write_failed');
  assert.equal(result.writes_index_entry, false);
  assert.ok(result.diagnostics.some((item) => item.code === 'SUPERSESSION_INDEX_SCAN_FAILED'));
});

test('Source Supersession binds supplied Writer Result to embedded replacement proposal provenance', () => {
  for (const field of ['id', 'digest']) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aos-supersession-proposal-binding-v1-'));
    const replacementRoot = path.join(root, 'records');
    const writer = writeReplacementWorkRecord({ proposal: replacementProposal(), outputRoot: replacementRoot });
    const tampered = structuredClone(writer);
    tampered.replacement_proposal[field] = `forged-${field}`;
    const result = writeWorkRecordSourceSupersessionIndex({
      sourceRef: repairableWorkRecordPath,
      replacementRef: writer.output.output_path,
      indexRoot: path.join(root, 'index'),
      replacementRoots: [replacementRoot],
      writerResult: tampered,
      repoRoot,
      dryRun: true,
    });
    assert.equal(result.status, 'blocked_relationship_mismatch');
    assert.ok(result.diagnostics.some((item) => item.code === 'SUPERSESSION_INDEX_WRITER_RESULT_PROPOSAL_MISMATCH'));
  }
});

test('Source Supersession rejects forged supplied Proposal type and status provenance', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aos-supersession-proposal-shape-v1-'));
  const replacementRoot = path.join(root, 'records');
  const writer = writeReplacementWorkRecord({ proposal: replacementProposal(), outputRoot: replacementRoot });
  for (const [field, forged, code] of [
    ['type', 'work_record.replacement_proposal.forged', 'SUPERSESSION_INDEX_WRITER_RESULT_PROPOSAL_TYPE_INVALID'],
    ['status', 'blocked_attempt_failed', 'SUPERSESSION_INDEX_WRITER_RESULT_PROPOSAL_STATUS_INVALID'],
  ]) {
    const tampered = structuredClone(writer);
    tampered.replacement_proposal[field] = forged;
    const result = writeWorkRecordSourceSupersessionIndex({
      sourceRef: repairableWorkRecordPath,
      replacementRef: writer.output.output_path,
      indexRoot: path.join(root, 'index'),
      replacementRoots: [replacementRoot],
      writerResult: tampered,
      repoRoot,
      dryRun: true,
    });
    assert.equal(result.status, 'blocked_invalid_replacement');
    assert.ok(result.diagnostics.some((item) => item.code === code));
  }
});

test('Source Supersession validates structured-record and serialized-output digests independently', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aos-supersession-digest-binding-v1-'));
  const replacementRoot = path.join(root, 'records');
  const writer = writeReplacementWorkRecord({ proposal: replacementProposal(), outputRoot: replacementRoot });
  for (const mutate of [
    (candidate) => { candidate.written_replacement_work_record.digest = 'forged-record-digest'; },
    (candidate) => { candidate.output.digest = 'forged-output-digest'; },
  ]) {
    const tampered = structuredClone(writer);
    mutate(tampered);
    const result = writeWorkRecordSourceSupersessionIndex({
      sourceRef: repairableWorkRecordPath,
      replacementRef: writer.output.output_path,
      indexRoot: path.join(root, 'index'),
      replacementRoots: [replacementRoot],
      writerResult: tampered,
      repoRoot,
      dryRun: true,
    });
    assert.equal(result.status, 'blocked_source_changed');
    assert.ok(result.diagnostics.some((item) => [
      'SUPERSESSION_INDEX_WRITER_RESULT_RECORD_DIGEST_MISMATCH',
      'SUPERSESSION_INDEX_WRITER_RESULT_OUTPUT_DIGEST_MISMATCH',
    ].includes(item.code)));
  }
});

test('Source Supersession binds the Writer digest to exact serialized replacement bytes', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aos-supersession-serialized-bytes-v1-'));
  const replacementRoot = path.join(root, 'records');
  const writer = writeReplacementWorkRecord({ proposal: replacementProposal(), outputRoot: replacementRoot });
  const replacement = JSON.parse(fs.readFileSync(writer.output.output_path, 'utf8'));
  fs.writeFileSync(writer.output.output_path, JSON.stringify(replacement));
  const result = writeWorkRecordSourceSupersessionIndex({
    sourceRef: repairableWorkRecordPath,
    replacementRef: writer.output.output_path,
    indexRoot: path.join(root, 'index'),
    replacementRoots: [replacementRoot],
    writerResult: writer,
    repoRoot,
    dryRun: true,
  });
  assert.equal(result.status, 'blocked_source_changed');
  assert.ok(result.diagnostics.some((item) => item.code === 'SUPERSESSION_INDEX_WRITER_RESULT_OUTPUT_DIGEST_MISMATCH'));
});

test('Source Supersession receipts a published entry when replacement identity changes during publication', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aos-supersession-replacement-race-v1-'));
  const replacementRoot = path.join(root, 'records');
  const indexRoot = path.join(root, 'index');
  const writer = writeReplacementWorkRecord({ proposal: replacementProposal(), outputRoot: replacementRoot });
  const replacement = JSON.parse(fs.readFileSync(writer.output.output_path, 'utf8'));
  let injected = false;
  const result = withAtomicPublishHook((event) => {
    if (!injected && event.operation === 'publish' && event.phase === 'after_publish_link') {
      injected = true;
      fs.writeFileSync(writer.output.output_path, JSON.stringify(replacement));
    }
  }, () => writeWorkRecordSourceSupersessionIndex({
      sourceRef: repairableWorkRecordPath,
      replacementRef: writer.output.output_path,
      indexRoot,
      replacementRoots: [replacementRoot],
      writerResult: writer,
      repoRoot,
    }));
  assert.equal(result.status, 'blocked_source_changed');
  assert.equal(result.atomic_write.published, true);
  assert.equal(result.writes_index_entry, true);
  assert.ok(result.diagnostics.some((item) => item.code === 'SUPERSESSION_INDEX_REPLACEMENT_CHANGED_AFTER_PUBLICATION'));
  const lookup = lookupWorkRecordSourceSupersession({
    sourceRef: repairableWorkRecordPath,
    indexRoot,
    replacementRoots: [replacementRoot],
    repoRoot,
  });
  assert.notEqual(lookup.status, 'active');
});

test('Source Supersession atomically admits only one active replacement per source identity', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aos-supersession-single-active-v1-'));
  const replacementRoot = path.join(root, 'records');
  const indexRoot = path.join(root, 'index');
  const writerA = writeReplacementWorkRecord({
    proposal: replacementProposalWithSeed('work-record:concurrent-replacement-a-v1'),
    outputRoot: replacementRoot,
  });
  const writerB = writeReplacementWorkRecord({
    proposal: replacementProposalWithSeed('work-record:concurrent-replacement-b-v1'),
    outputRoot: replacementRoot,
  });
  const optionsA = {
    sourceRef: repairableWorkRecordPath,
    replacementRef: writerA.output.output_path,
    indexRoot,
    replacementRoots: [replacementRoot],
    writerResult: writerA,
    repoRoot,
  };
  const optionsB = {
    ...optionsA,
    replacementRef: writerB.output.output_path,
    writerResult: writerB,
  };
  let nested = false;
  let resultB;
  const resultA = withAtomicPublishHook((event) => {
    if (event.operation === 'publish' && event.phase === 'before_publish_link' && !nested) {
      nested = true;
      resultB = writeWorkRecordSourceSupersessionIndex(optionsB);
      nested = false;
    }
  }, () => writeWorkRecordSourceSupersessionIndex(optionsA));
  assert.equal(resultB.status, 'written');
  assert.equal(resultA.status, 'conflict');
  assert.equal(resultA.atomic_write.raced, true);
  const lookup = lookupWorkRecordSourceSupersession({
    sourceRef: repairableWorkRecordPath,
    indexRoot,
    replacementRoots: [replacementRoot],
    repoRoot,
  });
  assert.equal(lookup.status, 'active');
  assert.equal(lookup.entries.length, 1);
  assert.equal(lookup.entries[0].replacement_work_record.id, writerB.written_replacement_work_record.id);
});

test('Source Supersession lookup rejects a competing entry swapped and restored during descriptor readback', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aos-supersession-entry-swap-restore-v1-'));
  const replacementRoot = path.join(root, 'records');
  const indexRoot = path.join(root, 'index');
  const writerA = writeReplacementWorkRecord({
    proposal: replacementProposalWithSeed('work-record:durable-replacement-a-v1'),
    outputRoot: replacementRoot,
  });
  const writerB = writeReplacementWorkRecord({
    proposal: replacementProposalWithSeed('work-record:transient-replacement-b-v1'),
    outputRoot: replacementRoot,
  });
  const common = {
    sourceRef: repairableWorkRecordPath,
    indexRoot,
    replacementRoots: [replacementRoot],
    repoRoot,
  };
  const transient = writeWorkRecordSourceSupersessionIndex({
    ...common,
    replacementRef: writerB.output.output_path,
    writerResult: writerB,
  });
  assert.equal(transient.status, 'written');
  const competingEntry = path.join(root, 'competing-valid-entry.json');
  fs.copyFileSync(transient.output.index_path, competingEntry);
  fs.unlinkSync(transient.output.index_path);
  const durable = writeWorkRecordSourceSupersessionIndex({
    ...common,
    replacementRef: writerA.output.output_path,
    writerResult: writerA,
  });
  assert.equal(durable.status, 'written');

  let injected = false;
  const parked = `${durable.output.index_path}.parked`;
  const lookup = withAtomicPublishHook((event) => {
    if (event.operation !== 'inspect'
      || event.phase !== 'after_leaf_open'
      || path.resolve(event.destination_path) !== path.resolve(durable.output.index_path)
      || injected) return;
    injected = true;
    fs.renameSync(durable.output.index_path, parked);
    fs.symlinkSync(competingEntry, durable.output.index_path);
    fs.unlinkSync(durable.output.index_path);
    fs.renameSync(parked, durable.output.index_path);
  }, () => lookupWorkRecordSourceSupersession({
    sourceRef: repairableWorkRecordPath,
    indexRoot,
    replacementRoots: [replacementRoot],
    repoRoot,
  }));
  assert.equal(injected, true);
  assert.equal(lookup.status, 'malformed_index');
  assert.equal(lookup.entries.length, 0);
  assert.equal(
    JSON.parse(fs.readFileSync(durable.output.index_path, 'utf8')).replacement_work_record.id,
    writerA.written_replacement_work_record.id,
  );
});

test('Source Supersession receipts publication when the index disappears before readback', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aos-supersession-index-readback-v1-'));
  const replacementRoot = path.join(root, 'records');
  const writer = writeReplacementWorkRecord({ proposal: replacementProposal(), outputRoot: replacementRoot });
  let injected = false;
  const result = withAtomicPublishHook((event) => {
    if (!injected && event.operation === 'publish' && event.phase === 'after_native_publish' && event.published) {
      injected = true;
      fs.unlinkSync(event.destination_path);
    }
  }, () => writeWorkRecordSourceSupersessionIndex({
      sourceRef: repairableWorkRecordPath,
      replacementRef: writer.output.output_path,
      indexRoot: path.join(root, 'index'),
      replacementRoots: [replacementRoot],
      writerResult: writer,
      repoRoot,
    }));
  assert.equal(result.status, 'blocked_write_failed');
  assert.equal(result.atomic_write.published, true);
  assert.equal(result.writes_index_entry, true);
  assert.ok(result.diagnostics.some((item) => item.code === 'SUPERSESSION_INDEX_PUBLISHED_READBACK_FAILED'));
});

test('Source Supersession receipts publication when source digest readback fails', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aos-supersession-source-readback-v1-'));
  const replacementRoot = path.join(root, 'records');
  const writer = writeReplacementWorkRecord({ proposal: replacementProposal(), outputRoot: replacementRoot });
  let published = false;
  const result = withAtomicPublishHook((event) => {
    if (event.operation === 'publish' && event.phase === 'after_native_publish' && event.published) published = true;
    if (published && event.operation === 'inspect' && event.phase === 'after_leaf_open'
      && path.resolve(event.destination_path) === path.resolve(repairableWorkRecordPath)) {
      throw new Error('injected source digest read failure');
    }
  }, () => writeWorkRecordSourceSupersessionIndex({
      sourceRef: repairableWorkRecordPath,
      replacementRef: writer.output.output_path,
      indexRoot: path.join(root, 'index'),
      replacementRoots: [replacementRoot],
      writerResult: writer,
      repoRoot,
    }));
  assert.equal(result.status, 'blocked_source_changed');
  assert.equal(result.atomic_write.published, true);
  assert.equal(result.writes_index_entry, true);
  assert.ok(result.diagnostics.some((item) => item.code === 'SUPERSESSION_INDEX_SOURCE_DIGEST_READ_FAILED'));
});

test('Source Supersession lookup returns typed failure when source digest readback fails', () => {
  const result = withAtomicPublishHook((event) => {
    if (event.operation === 'inspect' && event.phase === 'after_leaf_open'
      && path.resolve(event.destination_path) === path.resolve(repairableWorkRecordPath)) {
      throw new Error('injected lookup source digest read failure');
    }
  }, () => lookupWorkRecordSourceSupersession({
      sourceRef: repairableWorkRecordPath,
      indexRoot: path.join(os.tmpdir(), 'aos-supersession-lookup-readback-unused'),
      repoRoot,
    }));
  assert.equal(result.status, 'blocked_invalid_source');
  assert.ok(result.diagnostics.some((item) => item.code === 'SUPERSESSION_INDEX_SOURCE_DIGEST_READ_FAILED'));
});

test('Source Supersession lookup returns typed failure when replacement containment cannot resolve', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aos-supersession-containment-readback-v1-'));
  const replacementRoot = path.join(root, 'records');
  const indexRoot = path.join(root, 'index');
  const writer = writeReplacementWorkRecord({ proposal: replacementProposal(), outputRoot: replacementRoot });
  const written = writeWorkRecordSourceSupersessionIndex({
    sourceRef: repairableWorkRecordPath,
    replacementRef: writer.output.output_path,
    indexRoot,
    replacementRoots: [replacementRoot],
    writerResult: writer,
    repoRoot,
  });
  assert.equal(written.status, 'written');
  const originalRealpathSync = fs.realpathSync;
  fs.realpathSync = (target, ...args) => {
    if (path.resolve(String(target)) === path.resolve(replacementRoot)) {
      const error = new Error('injected replacement root containment failure');
      error.code = 'EIO';
      throw error;
    }
    return originalRealpathSync(target, ...args);
  };
  let result;
  try {
    result = lookupWorkRecordSourceSupersession({
      sourceRef: repairableWorkRecordPath,
      indexRoot,
      replacementRoots: [replacementRoot],
      repoRoot,
    });
  } finally {
    fs.realpathSync = originalRealpathSync;
  }
  assert.equal(result.status, 'malformed_index');
  assert.ok(result.diagnostics.some((item) => item.code === 'SUPERSESSION_LOOKUP_REPLACEMENT_READBACK_FAILED'));
});

test('Source Supersession lookup rejects a symlinked index tree outside index_root', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aos-supersession-index-symlink-v1-'));
  const outsideRoot = path.join(root, 'outside-index');
  const insideRoot = path.join(root, 'inside-index');
  const replacementRoot = path.join(root, 'records');
  const writer = writeReplacementWorkRecord({ proposal: replacementProposal(), outputRoot: replacementRoot });
  const written = writeWorkRecordSourceSupersessionIndex({
    sourceRef: repairableWorkRecordPath,
    replacementRef: writer.output.output_path,
    indexRoot: outsideRoot,
    replacementRoots: [replacementRoot],
    writerResult: writer,
    repoRoot,
  });
  assert.equal(written.status, 'written');
  fs.mkdirSync(insideRoot, { recursive: true });
  fs.symlinkSync(path.join(outsideRoot, 'source-supersession'), path.join(insideRoot, 'source-supersession'));
  const result = lookupWorkRecordSourceSupersession({
    sourceRef: repairableWorkRecordPath,
    indexRoot: insideRoot,
    replacementRoots: [replacementRoot],
    repoRoot,
  });
  assert.equal(result.status, 'malformed_index');
  assert.equal(result.entries.length, 0);
  assert.ok(result.diagnostics.some((item) => item.code === 'SUPERSESSION_LOOKUP_INDEX_READ_FAILED'));
});

test('Source Supersession lookup rejects a symlinked explicit index root', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aos-supersession-root-symlink-v1-'));
  const outsideRoot = path.join(root, 'outside-index');
  const linkedRoot = path.join(root, 'linked-index');
  const replacementRoot = path.join(root, 'records');
  const writer = writeReplacementWorkRecord({ proposal: replacementProposal(), outputRoot: replacementRoot });
  const written = writeWorkRecordSourceSupersessionIndex({
    sourceRef: repairableWorkRecordPath,
    replacementRef: writer.output.output_path,
    indexRoot: outsideRoot,
    replacementRoots: [replacementRoot],
    writerResult: writer,
    repoRoot,
  });
  assert.equal(written.status, 'written');
  fs.symlinkSync(outsideRoot, linkedRoot);
  const result = lookupWorkRecordSourceSupersession({
    sourceRef: repairableWorkRecordPath,
    indexRoot: linkedRoot,
    replacementRoots: [replacementRoot],
    repoRoot,
  });
  assert.equal(result.status, 'malformed_index');
  assert.equal(result.entries.length, 0);
  assert.ok(result.diagnostics.some((item) => item.code === 'SUPERSESSION_LOOKUP_INDEX_READ_FAILED'));
});

test('Source Supersession lookup rejects a symlinked explicit empty index root', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aos-supersession-empty-root-symlink-v1-'));
  const outsideRoot = path.join(root, 'outside-index');
  const linkedRoot = path.join(root, 'linked-index');
  fs.mkdirSync(outsideRoot);
  fs.symlinkSync(outsideRoot, linkedRoot);
  const result = lookupWorkRecordSourceSupersession({
    sourceRef: repairableWorkRecordPath,
    indexRoot: linkedRoot,
    repoRoot,
  });
  assert.equal(result.status, 'malformed_index');
  assert.equal(result.entries.length, 0);
  assert.ok(result.diagnostics.some((item) => item.code === 'SUPERSESSION_LOOKUP_INDEX_READ_FAILED'));
});

test('Source Supersession receipts a published entry when temp cleanup fails', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aos-supersession-cleanup-v1-'));
  const replacementRoot = path.join(root, 'records');
  const writer = writeReplacementWorkRecord({ proposal: replacementProposal(), outputRoot: replacementRoot });
  const options = {
    sourceRef: repairableWorkRecordPath,
    replacementRef: writer.output.output_path,
    indexRoot: path.join(root, 'index'),
    replacementRoots: [replacementRoot],
    writerResult: writer,
    repoRoot,
  };
  const preview = writeWorkRecordSourceSupersessionIndex({ ...options, dryRun: true });
  let injected = false;
  const result = withAtomicPublishHook((event) => {
    if (!injected && event.operation === 'publish' && event.phase === 'before_temp_unlink') {
      injected = true;
      return { fail_operation: 'unlink_temp' };
    }
    return undefined;
  }, () => writeWorkRecordSourceSupersessionIndex(options));
  assert.equal(result.status, 'blocked_cleanup_failed');
  assert.equal(result.atomic_write.published, true);
  assert.equal(result.writes_index_entry, true);
  assert.deepEqual(result.side_effects, ['write_source_supersession_index_entry']);
  assert.equal(result.recommended_next.action, 'inspect_published_index_and_cleanup_temp');
  assert.equal(fs.existsSync(preview.output.index_path), true);
  assert.ok(result.output.digest);
  fs.rmSync(result.atomic_write.temp_file, { force: true });
});
