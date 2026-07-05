import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  inspectWorkRecordRepairBundle,
  statusWorkRecordRepairBundles,
  writeWorkRecordRepairBundle,
  WORK_RECORD_REPAIR_BUNDLE_LIFECYCLE_STATUS_SCHEMA_VERSION,
  WORK_RECORD_REPAIR_BUNDLE_LIFECYCLE_STATUS_TYPE,
} from '../../packages/toolkit/workbench/work-record.js';
import {
  WORK_RECORD_REPAIR_BUNDLE_NON_EXECUTION_FLAGS,
} from '../../packages/toolkit/workbench/work-record-repair-bundle-policy.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../..');
const repairableFixture = path.join(repoRoot, 'shared/schemas/fixtures/aos-work-record-v0/valid/repairable-stale-saved-ref.json');

function tempDir(prefix = 'aos-work-record-repair-bundle-status-test-') {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function digestFile(file) {
  return `sha256:${crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')}`;
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function writeJson(file, value) {
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

function createBundle(options = {}) {
  const outputRoot = options.outputRoot || tempDir();
  const result = writeWorkRecordRepairBundle({
    sourceRef: repairableFixture,
    outputRoot,
    repoRoot,
    ...options,
  });
  assert.equal(result.status, 'written');
  return outputRoot;
}

function refreshManifestDigest(root, relativePath) {
  const manifestPath = path.join(root, 'bundle-manifest.json');
  const data = readJson(manifestPath);
  const artifact = data.artifacts.find((item) => item.relative_path === relativePath);
  assert.ok(artifact, relativePath);
  artifact.digest = digestFile(path.join(root, relativePath));
  writeJson(manifestPath, data);
}

function markGuideFinalized(root) {
  const guidePath = path.join(root, 'guide-report.json');
  const guide = readJson(guidePath);
  guide.current_stage = 'finalized';
  guide.stage_status = 'completed';
  writeJson(guidePath, guide);
  refreshManifestDigest(root, 'guide-report.json');
}

function statusRow(result, root) {
  const canonical = fs.existsSync(root) ? fs.realpathSync(root) : path.resolve(root);
  const row = result.bundles.find((bundle) => bundle.canonical_bundle_root === canonical);
  assert.ok(row, root);
  return row;
}

function descriptor(root, id) {
  return path.join(root, 'commands', `${id}.json`);
}

function snapshotBundle(root) {
  const files = [];
  function walk(current) {
    for (const name of fs.readdirSync(current)) {
      const file = path.join(current, name);
      const stat = fs.lstatSync(file);
      if (stat.isDirectory()) walk(file);
      else files.push({
        relative: path.relative(root, file),
        size: stat.size,
        mtimeMs: stat.mtimeMs,
        digest: stat.isFile() ? digestFile(file) : '',
      });
    }
  }
  walk(root);
  return files.sort((a, b) => a.relative.localeCompare(b.relative));
}

function assertLifecycleStatus(envelope, status = 'success') {
  assert.equal(envelope.type, WORK_RECORD_REPAIR_BUNDLE_LIFECYCLE_STATUS_TYPE);
  assert.equal(envelope.schema_version, WORK_RECORD_REPAIR_BUNDLE_LIFECYCLE_STATUS_SCHEMA_VERSION);
  assert.equal(envelope.status, status);
  assert.deepEqual(envelope.non_execution_flags, WORK_RECORD_REPAIR_BUNDLE_NON_EXECUTION_FLAGS);
}

function assertRowRecoverySummary(row) {
  assert.ok(row.recovery_summary);
  assert.equal(row.recovery_summary.state, row.lifecycle_status);
  assert.equal(row.recovery_summary.bundle_root, row.bundle_root);
  assert.equal(row.recovery_summary.guide_stage, row.guide_stage);
  assert.equal(row.recovery_summary.guide_stage_status, row.guide_stage_status);
  assert.equal(row.recovery_summary.next.command_id, row.next_command_id || '');
  assert.deepEqual(row.recovery_summary.next.argv, row.next_argv || []);
  assert.deepEqual(row.recovery_summary.next.persistence, row.next_persistence || emptyPersistence());
  assert.deepEqual(row.recovery_summary.next.missing_inputs, row.missing_inputs || []);
  assert.equal(row.recovery_summary.safety.inspector_ran_command, false);
  assert.equal(row.recovery_summary.safety.uses_live_ui, false);
  assert.equal(row.recovery_summary.safety.automatic_replay_allowed, false);
}

function assertAttentionQueue(envelope) {
  assert.ok(Array.isArray(envelope.attention_queue));
  assert.equal(envelope.attention_queue.length, envelope.bundle_count);
  assert.ok(envelope.attention_summary);
  const expectedSummary = {
    ready: envelope.ready_count,
    blocked: envelope.blocked_count,
    invalid: envelope.invalid_count,
    missing: envelope.missing_count,
    unsupported: envelope.unsupported_count,
    finalized: envelope.finalized_count,
    unknown: envelope.unknown_count,
  };
  for (const [field, value] of Object.entries(expectedSummary)) {
    assert.equal(envelope.attention_summary[field], value, field);
  }
  for (const item of envelope.attention_queue) {
    const row = envelope.bundles.find((bundle) => bundle.canonical_bundle_root === item.canonical_bundle_root);
    assert.ok(row, item.canonical_bundle_root);
    assert.equal(item.state, row.lifecycle_status);
    assert.deepEqual(item.source_work_record, row.source_work_record);
    assert.equal(item.guide_stage, row.guide_stage);
    assert.equal(item.guide_stage_status, row.guide_stage_status);
    assert.deepEqual(item.next.missing_inputs, row.missing_inputs || []);
    assert.deepEqual(item.next.missing_saved_outputs, row.missing_saved_outputs || []);
    const expectedArgv = row.lifecycle_status === 'ready'
      && row.continuation_ready === true
      && row.required_saved_outputs_present === true
      ? row.next_argv || []
      : [];
    assert.deepEqual(item.next.argv, expectedArgv);
    if (expectedArgv.length === 0) {
      assert.equal(item.next.command_id, '');
      assert.equal(item.next.mutates_state, false);
      assert.equal(item.next.requires_user_approval, false);
      assert.deepEqual(item.next.persistence, emptyPersistence());
    } else {
      assert.equal(item.next.command_id, row.next_command_id);
      assert.equal(item.next.mutates_state, row.next_command_mutates_state);
      assert.equal(item.next.requires_user_approval, row.requires_user_approval);
      assert.deepEqual(item.next.persistence, row.recovery_summary.next.persistence);
    }
    assert.deepEqual(
      item.diagnostic_codes,
      (row.diagnostics || []).map((diagnostic) => diagnostic.code).filter(Boolean),
    );
  }
  if (envelope.attention_queue[0]) {
    assert.equal(envelope.attention_summary.next_bundle_root, envelope.attention_queue[0].bundle_root);
    assert.equal(envelope.attention_summary.next_state, envelope.attention_queue[0].state);
    assert.equal(envelope.attention_summary.next_attention, envelope.attention_queue[0].attention);
  }
}

function emptyPersistence() {
  return {
    stdout_required: false,
    stdout_artifact: {},
    save_stdout_to: '',
    requires_saved_output_from: [],
    persistence_command: '',
  };
}

function assertLifecycleCounts(envelope, expected) {
  const defaults = {
    ready_count: 0,
    blocked_count: 0,
    invalid_count: 0,
    missing_count: 0,
    unsupported_count: 0,
    finalized_count: 0,
    unknown_count: 0,
  };
  const counts = { ...defaults, ...expected };
  for (const [field, value] of Object.entries(counts)) {
    assert.equal(envelope[field], value, field);
  }
  const countedTotal = Object.values(counts).reduce((sum, value) => sum + value, 0);
  assert.equal(envelope.bundle_count, countedTotal);
}

function runAos(args) {
  return spawnSync('./aos', args, {
    cwd: repoRoot,
    encoding: 'utf8',
  });
}

function sectionBetween(text, startPattern, endPattern) {
  const start = text.search(startPattern);
  assert.notEqual(start, -1, String(startPattern));
  const remainder = text.slice(start);
  const end = remainder.search(endPattern);
  assert.notEqual(end, -1, String(endPattern));
  return remainder.slice(0, end);
}

function skillCommandBullet(skill, command) {
  const startText = `- \`${command}`;
  const start = skill.indexOf(startText);
  assert.notEqual(start, -1, command);
  const rest = skill.slice(start);
  const nextBullet = rest.indexOf('\n- `', 1);
  const nextHeading = rest.search(/\n##? /);
  const candidates = [nextBullet, nextHeading].filter((index) => index !== -1);
  const end = candidates.length > 0 ? Math.min(...candidates) : rest.length;
  return rest.slice(0, end);
}

test('status summarizes explicit bundle roots through the inspector', () => {
  const root = createBundle();
  const result = statusWorkRecordRepairBundles({ bundleRoots: [root] });

  assertLifecycleStatus(result);
  assertAttentionQueue(result);
  assert.equal(result.bundle_count, 1);
  assert.equal(result.valid_count, 1);
  assert.equal(result.ready_count, 1);
  assert.equal(result.blocked_count, 0);
  assert.equal(result.invalid_count, 0);
  assert.equal(result.missing_count, 0);
  assert.equal(result.unsupported_count, 0);
  assert.equal(result.finalized_count, 0);
  assert.equal(result.unknown_count, 0);
  assertLifecycleCounts(result, { ready_count: 1 });
  assert.deepEqual(result.roots.supplied_bundle_roots, [root]);
  assert.equal(result.roots.discovery.global_search, false);
  assert.equal(result.roots.discovery.recursive_parent_scan, false);

  const [bundle] = result.bundles;
  assert.equal(bundle.bundle_root, root);
  assert.equal(bundle.canonical_bundle_root, fs.realpathSync(root));
  assert.equal(bundle.inspection_status, 'valid');
  assert.equal(bundle.lifecycle_status, 'ready');
  assert.equal(bundle.source_work_record.id, 'work-record:repairable-stale-saved-ref-2026-07-04');
  assert.equal(bundle.guide_stage, 'gate_required');
  assert.equal(bundle.guide_stage_status, 'blocked');
  assert.equal(bundle.continuation_ready, true);
  assert.equal(bundle.next_command_id, 'work-record-gate-request');
  assert.deepEqual(bundle.next_argv.slice(0, 3), ['./aos', 'work-record', 'gate-request']);
  assert.equal(bundle.next_command_mutates_state, false);
  assert.equal(bundle.requires_user_approval, false);
  assert.deepEqual(bundle.missing_inputs, ['workflow_gate_authorization']);
  assert.equal(bundle.required_saved_outputs_present, true);
  assert.deepEqual(bundle.missing_saved_outputs, []);
  assertRowRecoverySummary(bundle);
  assert.equal(result.attention_queue[0].state, 'ready');
  assert.equal(result.attention_queue[0].attention, 'continue');
  assert.deepEqual(result.attention_queue[0].next.argv, bundle.next_argv);
});

test('status keeps missing and invalid bundles in one report', () => {
  const validRoot = createBundle();
  const invalidRoot = createBundle();
  fs.rmSync(path.join(invalidRoot, 'bundle-manifest.json'));
  const missingRoot = path.join(tempDir('aos-work-record-status-missing-'), 'missing-bundle');

  const result = statusWorkRecordRepairBundles({ bundleRoots: [missingRoot, validRoot, invalidRoot] });

  assertLifecycleStatus(result);
  assertAttentionQueue(result);
  assert.equal(result.bundle_count, 3);
  assert.equal(result.ready_count, 1);
  assert.equal(result.blocked_count, 0);
  assert.equal(result.missing_count, 2);
  assert.equal(result.invalid_count, 0);
  assertLifecycleCounts(result, { ready_count: 1, missing_count: 2 });
  const expectedCanonicalRoots = [
    fs.realpathSync(invalidRoot),
    missingRoot,
    fs.realpathSync(validRoot),
  ].map((item) => path.resolve(item)).sort((a, b) => a.localeCompare(b));
  assert.deepEqual(result.bundles.map((bundle) => bundle.canonical_bundle_root), expectedCanonicalRoots);
  assert.ok(result.bundles.some((bundle) => bundle.lifecycle_status === 'missing'));
  assert.ok(result.bundles.some((bundle) => bundle.inspection_status === 'blocked_missing_manifest'));
  for (const bundle of result.bundles) assertRowRecoverySummary(bundle);
  const readyRow = statusRow(result, validRoot);
  const missingItems = result.attention_queue.filter((item) => item.state === 'missing');
  assert.equal(result.attention_queue[0].canonical_bundle_root, readyRow.canonical_bundle_root);
  assert.deepEqual(result.attention_queue[0].next.argv, readyRow.next_argv);
  assert.equal(missingItems.length, 2);
  assert.ok(missingItems.every((item) => item.next.argv.length === 0));
});

test('status and inspect agree that digest mismatch is invalid and non-continuable', () => {
  const root = createBundle();
  fs.writeFileSync(path.join(root, 'artifacts/gate-request.json'), '{"changed":true}\n');

  const inspection = inspectWorkRecordRepairBundle({ bundleRoot: root });
  const result = statusWorkRecordRepairBundles({ bundleRoots: [root] });
  const [bundle] = result.bundles;

  assertAttentionQueue(result);
  assert.equal(inspection.status, 'blocked_digest_mismatch');
  assert.equal(inspection.recovery_summary.state, 'invalid');
  assert.equal(inspection.continuation.safe_next_descriptor_id, '');
  assert.deepEqual(inspection.continuation.argv, []);
  assert.equal(inspection.continuation.command, '');
  assert.equal(inspection.continuation.requires_human_approval, false);
  assert.equal(inspection.continuation.would_mutate_state, false);
  assert.deepEqual(inspection.recovery_summary.next.argv, []);
  assert.equal(bundle.inspection_status, 'blocked_digest_mismatch');
  assert.equal(bundle.lifecycle_status, 'invalid');
  assert.equal(bundle.recovery_summary.state, 'invalid');
  assert.equal(bundle.next_command_id, '');
  assert.deepEqual(bundle.next_argv, []);
  assert.deepEqual(bundle.recovery_summary.next.argv, []);
  assertLifecycleCounts(result, { invalid_count: 1 });
  assert.deepEqual(result.attention_queue[0].next.argv, []);
});

test('status and inspect agree that descriptor mismatch is invalid and non-continuable', () => {
  const root = createBundle();
  const file = descriptor(root, 'work-record-gate-request');
  const data = readJson(file);
  data.bundle_artifact_status = 'planned_only';
  writeJson(file, data);
  refreshManifestDigest(root, 'commands/work-record-gate-request.json');

  const inspection = inspectWorkRecordRepairBundle({ bundleRoot: root });
  const result = statusWorkRecordRepairBundles({ bundleRoots: [root] });
  const [bundle] = result.bundles;

  assertAttentionQueue(result);
  assert.equal(inspection.status, 'blocked_descriptor_mismatch');
  assert.equal(inspection.recovery_summary.state, 'invalid');
  assert.equal(inspection.continuation.safe_next_descriptor_id, '');
  assert.deepEqual(inspection.continuation.argv, []);
  assert.equal(inspection.continuation.command, '');
  assert.equal(inspection.continuation.requires_human_approval, false);
  assert.equal(inspection.continuation.would_mutate_state, false);
  assert.deepEqual(inspection.recovery_summary.next.argv, []);
  assert.equal(bundle.inspection_status, 'blocked_descriptor_mismatch');
  assert.equal(bundle.lifecycle_status, 'invalid');
  assert.equal(bundle.recovery_summary.state, 'invalid');
  assert.equal(bundle.next_command_id, '');
  assert.deepEqual(bundle.next_argv, []);
  assert.deepEqual(bundle.recovery_summary.next.argv, []);
  assertLifecycleCounts(result, { invalid_count: 1 });
  assert.deepEqual(result.attention_queue[0].next.argv, []);
});

test('attention queue ranks mixed lifecycle rows deterministically and fail-closed', () => {
  const parent = tempDir('aos-work-record-status-mixed-');
  const readyRootA = createBundle({ outputRoot: path.join(parent, 'a-ready') });
  const readyRootZ = createBundle({ outputRoot: path.join(parent, 'z-ready') });
  const finalizedRoot = createBundle({ outputRoot: path.join(parent, 'y-finalized') });
  markGuideFinalized(finalizedRoot);
  const invalidRoot = createBundle({ outputRoot: path.join(parent, 'm-invalid') });
  fs.writeFileSync(path.join(invalidRoot, 'artifacts/gate-request.json'), '{"changed":true}\n');
  const missingRoot = path.join(parent, 'b-missing');

  const before = new Map([readyRootA, readyRootZ, finalizedRoot, invalidRoot].map((root) => [root, snapshotBundle(root)]));
  const result = statusWorkRecordRepairBundles({
    bundleRoots: [finalizedRoot, missingRoot, readyRootZ, invalidRoot, readyRootA],
  });
  const after = new Map([readyRootA, readyRootZ, finalizedRoot, invalidRoot].map((root) => [root, snapshotBundle(root)]));

  assertLifecycleStatus(result);
  assertAttentionQueue(result);
  assertLifecycleCounts(result, {
    ready_count: 2,
    invalid_count: 1,
    missing_count: 1,
    finalized_count: 1,
  });
  assert.deepEqual(after, before);

  const readyRowA = statusRow(result, readyRootA);
  const readyRowZ = statusRow(result, readyRootZ);
  const finalizedRow = statusRow(result, finalizedRoot);
  const invalidRow = statusRow(result, invalidRoot);
  const missingRow = statusRow(result, missingRoot);

  assert.deepEqual(
    result.attention_queue.map((item) => item.state),
    ['ready', 'ready', 'missing', 'invalid', 'finalized'],
  );
  assert.equal(result.attention_queue[0].canonical_bundle_root, readyRowA.canonical_bundle_root);
  assert.equal(result.attention_queue[1].canonical_bundle_root, readyRowZ.canonical_bundle_root);
  assert.equal(result.attention_summary.next_bundle_root, readyRowA.bundle_root);
  assert.equal(result.attention_summary.next_state, 'ready');
  assert.equal(result.attention_summary.next_attention, 'continue');
  assert.deepEqual(result.attention_queue[0].next.argv, readyRowA.next_argv);
  assert.deepEqual(result.attention_queue[1].next.argv, readyRowZ.next_argv);
  assert.deepEqual(result.attention_queue.find((item) => item.canonical_bundle_root === finalizedRow.canonical_bundle_root).next.argv, []);
  assert.deepEqual(result.attention_queue.find((item) => item.canonical_bundle_root === invalidRow.canonical_bundle_root).next.argv, []);
  assert.deepEqual(result.attention_queue.find((item) => item.canonical_bundle_root === missingRow.canonical_bundle_root).next.argv, []);
});

test('status parent scan is explicit, bounded, and non-recursive', () => {
  const parent = tempDir('aos-work-record-status-parent-');
  const child = createBundle({ outputRoot: path.join(parent, 'child-bundle') });
  const nestedContainer = path.join(parent, 'nested-container');
  const nested = createBundle({ outputRoot: path.join(nestedContainer, 'nested-bundle') });

  const result = statusWorkRecordRepairBundles({ bundleParents: [parent] });

  assertLifecycleStatus(result);
  assertAttentionQueue(result);
  assert.equal(result.bundle_count, 1);
  assertLifecycleCounts(result, { ready_count: 1 });
  assert.equal(result.bundles[0].bundle_root, child);
  assertRowRecoverySummary(result.bundles[0]);
  assert.equal(result.roots.derived_bundle_roots[0].bundle_parent, parent);
  assert.equal(result.roots.derived_bundle_roots[0].bundle_root, child);
  assert.equal(result.bundles.some((bundle) => bundle.bundle_root === nested), false);
});

test('status reports missing input as structured failure', () => {
  const result = statusWorkRecordRepairBundles();

  assertLifecycleStatus(result, 'failed');
  assertAttentionQueue(result);
  assert.equal(result.bundle_count, 0);
  assertLifecycleCounts(result, {});
  assert.ok(result.diagnostics.some((item) => item.code === 'WORK_RECORD_REPAIR_BUNDLE_STATUS_INPUT_REQUIRED'));
});

test('status counts finalized lifecycle rows from saved guide state', () => {
  const root = createBundle();
  markGuideFinalized(root);

  const result = statusWorkRecordRepairBundles({ bundleRoots: [root] });

  assertLifecycleStatus(result);
  assertAttentionQueue(result);
  assert.equal(result.bundle_count, 1);
  assert.equal(result.bundles[0].lifecycle_status, 'finalized');
  assertRowRecoverySummary(result.bundles[0]);
  assert.equal(result.finalized_count, 1);
  assertLifecycleCounts(result, { finalized_count: 1 });
});

test('status does not write or modify bundle files', () => {
  const root = createBundle();
  const before = snapshotBundle(root);
  const result = statusWorkRecordRepairBundles({ bundleRoots: [root] });
  const after = snapshotBundle(root);

  assertLifecycleStatus(result);
  assertAttentionQueue(result);
  assert.deepEqual(after, before);
});

test('public CLI status returns structured JSON and missing-input failure', () => {
  const root = createBundle();
  const valid = runAos(['work-record', 'repair', 'bundle', 'status', '--bundle-root', root, '--json']);
  assert.equal(valid.status, 0, valid.stderr);
  const validJson = JSON.parse(valid.stdout);
  assertLifecycleStatus(validJson);
  assertAttentionQueue(validJson);
  assert.equal(validJson.bundle_count, 1);
  assertLifecycleCounts(validJson, { ready_count: 1 });
  assert.equal(validJson.bundles[0].lifecycle_status, 'ready');

  const missing = runAos(['work-record', 'repair', 'bundle', 'status', '--json']);
  assert.notEqual(missing.status, 0);
  const missingJson = JSON.parse(missing.stderr);
  assertLifecycleStatus(missingJson, 'failed');
  assertAttentionQueue(missingJson);
  assert.ok(missingJson.diagnostics.some((item) => item.code === 'WORK_RECORD_REPAIR_BUNDLE_STATUS_INPUT_REQUIRED'));
});

test('public CLI help resolves work-record repair bundle status', () => {
  const help = runAos(['help', 'work-record', 'repair', 'bundle', 'status', '--json']);
  assert.equal(help.status, 0, help.stderr);
  const helpJson = JSON.parse(help.stdout);
  assert.deepEqual(helpJson.path, ['work-record', 'repair', 'bundle', 'status']);
  assert.ok(helpJson.forms.some((form) => form.id === 'work-record-repair-bundle-status'));
});

test('docs, schema, and skill describe repair bundle status lifecycle contract', () => {
  const apiDoc = fs.readFileSync(path.join(repoRoot, 'docs/api/aos.md'), 'utf8');
  const schemaDoc = fs.readFileSync(path.join(repoRoot, 'shared/schemas/aos-work-record-v0.md'), 'utf8');
  const skill = fs.readFileSync(path.join(repoRoot, 'skills/aos-agent-workspace/SKILL.md'), 'utf8');

  const apiStatus = sectionBetween(apiDoc, /`repair bundle status`/, /\n`repair bundle inspect`/);
  const schemaStatus = sectionBetween(schemaDoc, /^## Repair Recovery Bundle Lifecycle Status V0$/m, /^## Repair Recovery Bundle Inspection V0$/m);
  const skillStatus = skillCommandBullet(skill, 'aos work-record repair bundle status');

  for (const text of [apiStatus, schemaStatus, skillStatus]) {
    assert.match(text, /repair bundle status/);
    assert.match(text, /--bundle-root/);
    assert.match(text, /--bundle-parent/);
    assert.match(text, /read-only|without writing/);
    assert.match(text, /explicit/);
    assert.match(text, /immediate\s+children/);
    assert.match(text, /non-recursive/);
    assert.match(text, /does not .*run recovery|executes?\s+no\s+commands|without .*executing/s);
    assert.match(text, /exact next (command id\/)?`argv`|exact next command id\/`argv`/);
    assert.match(text, /recovery_summary/);
    assert.match(text, /attention_queue/);
    assert.match(text, /attention_summary/);
    assert.match(text, /ready.*blocked.*missing.*invalid.*unsupported.*unknown.*finalized/s);
    assert.match(text, /empty `next\.argv`|expose an empty `next\.argv`|expose empty `next\.argv`/);
    assert.match(text, /ready.*blocked.*invalid.*missing.*unsupported.*finalized.*unknown/s);
    assert.match(text, /finalized_count/);
  }

  assert.match(schemaStatus, /ready_count/);
  assert.match(schemaStatus, /blocked_count/);
  assert.match(schemaStatus, /invalid_count/);
  assert.match(schemaStatus, /missing_count/);
  assert.match(schemaStatus, /unsupported_count/);
  assert.match(schemaStatus, /unknown_count/);
});
