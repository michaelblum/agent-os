import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
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
});

test('status keeps missing and invalid bundles in one report', () => {
  const validRoot = createBundle();
  const invalidRoot = createBundle();
  fs.rmSync(path.join(invalidRoot, 'bundle-manifest.json'));
  const missingRoot = path.join(tempDir('aos-work-record-status-missing-'), 'missing-bundle');

  const result = statusWorkRecordRepairBundles({ bundleRoots: [missingRoot, validRoot, invalidRoot] });

  assertLifecycleStatus(result);
  assert.equal(result.bundle_count, 3);
  assert.equal(result.ready_count, 1);
  assert.equal(result.blocked_count, 1);
  assert.equal(result.missing_count, 1);
  assert.equal(result.invalid_count, 0);
  assertLifecycleCounts(result, { ready_count: 1, blocked_count: 1, missing_count: 1 });
  const expectedCanonicalRoots = [
    fs.realpathSync(invalidRoot),
    missingRoot,
    fs.realpathSync(validRoot),
  ].map((item) => path.resolve(item)).sort((a, b) => a.localeCompare(b));
  assert.deepEqual(result.bundles.map((bundle) => bundle.canonical_bundle_root), expectedCanonicalRoots);
  assert.ok(result.bundles.some((bundle) => bundle.lifecycle_status === 'missing'));
  assert.ok(result.bundles.some((bundle) => bundle.inspection_status === 'blocked_missing_manifest'));
});

test('status parent scan is explicit, bounded, and non-recursive', () => {
  const parent = tempDir('aos-work-record-status-parent-');
  const child = createBundle({ outputRoot: path.join(parent, 'child-bundle') });
  const nestedContainer = path.join(parent, 'nested-container');
  const nested = createBundle({ outputRoot: path.join(nestedContainer, 'nested-bundle') });

  const result = statusWorkRecordRepairBundles({ bundleParents: [parent] });

  assertLifecycleStatus(result);
  assert.equal(result.bundle_count, 1);
  assertLifecycleCounts(result, { ready_count: 1 });
  assert.equal(result.bundles[0].bundle_root, child);
  assert.equal(result.roots.derived_bundle_roots[0].bundle_parent, parent);
  assert.equal(result.roots.derived_bundle_roots[0].bundle_root, child);
  assert.equal(result.bundles.some((bundle) => bundle.bundle_root === nested), false);
});

test('status reports missing input as structured failure', () => {
  const result = statusWorkRecordRepairBundles();

  assertLifecycleStatus(result, 'failed');
  assert.equal(result.bundle_count, 0);
  assertLifecycleCounts(result, {});
  assert.ok(result.diagnostics.some((item) => item.code === 'WORK_RECORD_REPAIR_BUNDLE_STATUS_INPUT_REQUIRED'));
});

test('status counts finalized lifecycle rows from saved guide state', () => {
  const root = createBundle();
  markGuideFinalized(root);

  const result = statusWorkRecordRepairBundles({ bundleRoots: [root] });

  assertLifecycleStatus(result);
  assert.equal(result.bundle_count, 1);
  assert.equal(result.bundles[0].lifecycle_status, 'finalized');
  assert.equal(result.finalized_count, 1);
  assertLifecycleCounts(result, { finalized_count: 1 });
});

test('status does not write or modify bundle files', () => {
  const root = createBundle();
  const before = snapshotBundle(root);
  const result = statusWorkRecordRepairBundles({ bundleRoots: [root] });
  const after = snapshotBundle(root);

  assertLifecycleStatus(result);
  assert.deepEqual(after, before);
});

test('public CLI status returns structured JSON and missing-input failure', () => {
  const root = createBundle();
  const valid = runAos(['work-record', 'repair', 'bundle', 'status', '--bundle-root', root, '--json']);
  assert.equal(valid.status, 0, valid.stderr);
  const validJson = JSON.parse(valid.stdout);
  assertLifecycleStatus(validJson);
  assert.equal(validJson.bundle_count, 1);
  assertLifecycleCounts(validJson, { ready_count: 1 });
  assert.equal(validJson.bundles[0].lifecycle_status, 'ready');

  const missing = runAos(['work-record', 'repair', 'bundle', 'status', '--json']);
  assert.notEqual(missing.status, 0);
  const missingJson = JSON.parse(missing.stderr);
  assertLifecycleStatus(missingJson, 'failed');
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
