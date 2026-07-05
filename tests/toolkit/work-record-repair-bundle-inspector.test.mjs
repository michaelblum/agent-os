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
  WORK_RECORD_REPAIR_BUNDLE_INSPECTION_SCHEMA_VERSION,
  WORK_RECORD_REPAIR_BUNDLE_INSPECTION_TYPE,
  WORK_RECORD_REPAIR_BUNDLE_LIFECYCLE_STATUS_SCHEMA_VERSION,
  WORK_RECORD_REPAIR_BUNDLE_LIFECYCLE_STATUS_TYPE,
} from '../../packages/toolkit/workbench/work-record.js';
import {
  WORK_RECORD_REPAIR_BUNDLE_NON_EXECUTION_FLAGS,
  WORK_RECORD_REPAIR_BUNDLE_REQUIRED_MANIFEST_NON_EXECUTION_FLAGS,
} from '../../packages/toolkit/workbench/work-record-repair-bundle-policy.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../..');
const repairableFixture = path.join(repoRoot, 'shared/schemas/fixtures/aos-work-record-v0/valid/repairable-stale-saved-ref.json');

function tempDir(prefix = 'aos-work-record-repair-bundle-inspect-test-') {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function digestBytes(bytes) {
  return `sha256:${crypto.createHash('sha256').update(bytes).digest('hex')}`;
}

function digestFile(file) {
  return digestBytes(fs.readFileSync(file));
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
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

function inspect(root) {
  return inspectWorkRecordRepairBundle({ bundleRoot: root });
}

function assertInspection(envelope, status) {
  assert.equal(envelope.type, WORK_RECORD_REPAIR_BUNDLE_INSPECTION_TYPE);
  assert.equal(envelope.schema_version, WORK_RECORD_REPAIR_BUNDLE_INSPECTION_SCHEMA_VERSION);
  assert.equal(envelope.status, status);
  assert.deepEqual(envelope.non_execution_flags, WORK_RECORD_REPAIR_BUNDLE_NON_EXECUTION_FLAGS);
}

function assertLifecycleStatus(envelope, status = 'success') {
  assert.equal(envelope.type, WORK_RECORD_REPAIR_BUNDLE_LIFECYCLE_STATUS_TYPE);
  assert.equal(envelope.schema_version, WORK_RECORD_REPAIR_BUNDLE_LIFECYCLE_STATUS_SCHEMA_VERSION);
  assert.equal(envelope.status, status);
  assert.deepEqual(envelope.non_execution_flags, WORK_RECORD_REPAIR_BUNDLE_NON_EXECUTION_FLAGS);
}

function manifest(root) {
  return readJson(path.join(root, 'bundle-manifest.json'));
}

function writeManifest(root, value) {
  writeJson(path.join(root, 'bundle-manifest.json'), value);
}

function canonicalFlagKeys() {
  return Object.keys(WORK_RECORD_REPAIR_BUNDLE_NON_EXECUTION_FLAGS).sort();
}

function refreshManifestDigest(root, relativePath) {
  const data = manifest(root);
  const artifact = data.artifacts.find((item) => item.relative_path === relativePath);
  assert.ok(artifact, relativePath);
  artifact.digest = digestFile(path.join(root, relativePath));
  writeManifest(root, data);
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

function runAos(args) {
  return spawnSync('./aos', args, {
    cwd: repoRoot,
    encoding: 'utf8',
  });
}

test('inspecting a valid bundle returns stable JSON and continuation', () => {
  const root = createBundle();
  const result = inspect(root);

  assertInspection(result, 'valid');
  assert.equal(result.bundle_root, root);
  assert.equal(result.canonical_bundle_root, fs.realpathSync(root));
  assert.equal(result.manifest.type, 'work_record.repair_recovery_bundle_manifest');
  assert.equal(result.guide_report.type, 'work_record.repair_guided_recovery');
  assert.equal(result.continuation.current_guide_stage, 'gate_required');
  assert.equal(result.continuation.safe_next_descriptor_id, 'work-record-gate-request');
  assert.deepEqual(result.continuation.argv.slice(0, 3), ['./aos', 'work-record', 'gate-request']);
  assert.equal(result.continuation.required_saved_outputs_present, true);
  assert.equal(result.continuation.inspector_ran_command, false);
});

test('missing bundle-manifest.json fails closed', () => {
  const root = createBundle();
  fs.rmSync(path.join(root, 'bundle-manifest.json'));

  assertInspection(inspect(root), 'blocked_missing_manifest');
});

test('invalid manifest JSON fails closed', () => {
  const root = createBundle();
  fs.writeFileSync(path.join(root, 'bundle-manifest.json'), '{not json\n');

  assertInspection(inspect(root), 'blocked_invalid_manifest');
});

test('missing guide-report.json fails closed', () => {
  const root = createBundle();
  fs.rmSync(path.join(root, 'guide-report.json'));

  assertInspection(inspect(root), 'blocked_missing_artifact');
});

test('missing descriptor file fails closed', () => {
  const root = createBundle();
  fs.rmSync(descriptor(root, 'work-record-gate-request'));

  const result = inspect(root);
  assertInspection(result, 'blocked_missing_artifact');
  assert.ok(result.diagnostics.some((item) => item.code === 'WORK_RECORD_REPAIR_BUNDLE_INSPECT_MISSING_DESCRIPTOR'));
});

test('missing materialized artifact fails closed', () => {
  const root = createBundle();
  fs.rmSync(path.join(root, 'artifacts/gate-request.json'));

  const result = inspect(root);
  assertInspection(result, 'blocked_missing_artifact');
  assert.ok(result.diagnostics.some((item) => item.code === 'WORK_RECORD_REPAIR_BUNDLE_INSPECT_MISSING_ARTIFACT'));
});

test('digest mismatch fails closed', () => {
  const root = createBundle();
  fs.writeFileSync(path.join(root, 'artifacts/gate-request.json'), '{"changed":true}\n');

  const result = inspect(root);
  assertInspection(result, 'blocked_digest_mismatch');
  assert.ok(result.artifacts.some((item) => item.relative_path === 'artifacts/gate-request.json' && item.status === 'digest_mismatch'));
});

test('manifest artifact path traversal fails closed', () => {
  const root = createBundle();
  const data = manifest(root);
  data.artifacts[0].relative_path = '../outside.json';
  writeManifest(root, data);

  assertInspection(inspect(root), 'blocked_path_escape');
});

test('manifest absolute path escape fails closed', () => {
  const root = createBundle();
  const data = manifest(root);
  data.artifacts[0].path = '/tmp/outside-bundle.json';
  writeManifest(root, data);

  const result = inspect(root);
  assertInspection(result, 'blocked_path_escape');
  assert.ok(result.diagnostics.some((item) => item.code === 'WORK_RECORD_REPAIR_BUNDLE_INSPECT_MANIFEST_PATH_ESCAPE'));
});

test('tampered manifest artifact path mismatch fails closed', () => {
  const root = createBundle();
  const data = manifest(root);
  const artifact = data.artifacts.find((item) => item.relative_path === 'commands/work-record-gate-request.json');
  assert.ok(artifact);
  artifact.path = 'bundle-manifest.json';
  writeManifest(root, data);

  const result = inspect(root);
  assertInspection(result, 'blocked_path_escape');
  assert.ok(result.diagnostics.some((item) => item.code === 'WORK_RECORD_REPAIR_BUNDLE_INSPECT_MANIFEST_PATH_MISMATCH'));
});

test('tampered manifest execution flags fail closed with offending flags', () => {
  const root = createBundle();
  const data = manifest(root);
  data.non_execution_flags.executes_repair = true;
  data.non_execution_flags.writes_replacement_record = true;
  writeManifest(root, data);

  const result = inspect(root);
  assertInspection(result, 'blocked_invalid_manifest');
  const diagnostics = result.diagnostics.filter((item) => item.code === 'WORK_RECORD_REPAIR_BUNDLE_INSPECT_MANIFEST_EXECUTION_FLAG');
  assert.deepEqual(diagnostics.map((item) => item.flag).sort(), ['executes_repair', 'writes_replacement_record']);
  assert.deepEqual(diagnostics.map((item) => item.value), [true, true]);
});

for (const flag of ['mutates_record', 'writes_bundle', 'repairs_bundle']) {
  test(`same-schema manifest missing canonical ${flag} flag fails closed`, () => {
    const root = createBundle();
    const data = manifest(root);
    delete data.non_execution_flags[flag];
    writeManifest(root, data);

    const result = inspect(root);
    assertInspection(result, 'blocked_invalid_manifest');
    assert.ok(result.diagnostics.some((item) => (
      item.code === 'WORK_RECORD_REPAIR_BUNDLE_INSPECT_MANIFEST_EXECUTION_FLAG_MISSING'
      && item.flag === flag
    )), flag);
  });
}

test('same-schema generated bundle missing all canonical write and repair flags fails closed', () => {
  const root = createBundle();
  const data = manifest(root);
  delete data.non_execution_flags.mutates_record;
  delete data.non_execution_flags.writes_bundle;
  delete data.non_execution_flags.repairs_bundle;
  writeManifest(root, data);

  const result = inspect(root);
  assertInspection(result, 'blocked_invalid_manifest');
  const missing = result.diagnostics
    .filter((item) => item.code === 'WORK_RECORD_REPAIR_BUNDLE_INSPECT_MANIFEST_EXECUTION_FLAG_MISSING')
    .map((item) => item.flag)
    .sort();
  assert.deepEqual(missing, ['mutates_record', 'repairs_bundle', 'writes_bundle']);
});

test('missing required manifest non-execution flag fails closed', () => {
  const root = createBundle();
  const data = manifest(root);
  delete data.non_execution_flags.executes_actions;
  writeManifest(root, data);

  const result = inspect(root);
  assertInspection(result, 'blocked_invalid_manifest');
  assert.ok(result.diagnostics.some((item) => (
    item.code === 'WORK_RECORD_REPAIR_BUNDLE_INSPECT_MANIFEST_EXECUTION_FLAG_MISSING'
    && item.flag === 'executes_actions'
  )));
});

test('every emitted manifest non-execution flag is required', () => {
  const baselineRoot = createBundle();
  const flags = Object.keys(manifest(baselineRoot).non_execution_flags).sort();

  assert.deepEqual(flags, canonicalFlagKeys());
  assert.deepEqual(WORK_RECORD_REPAIR_BUNDLE_REQUIRED_MANIFEST_NON_EXECUTION_FLAGS.slice().sort(), canonicalFlagKeys());

  for (const flag of flags) {
    const root = createBundle();
    const data = manifest(root);
    delete data.non_execution_flags[flag];
    writeManifest(root, data);

    const result = inspect(root);
    assertInspection(result, 'blocked_invalid_manifest');
    assert.ok(result.diagnostics.some((item) => (
      item.code === 'WORK_RECORD_REPAIR_BUNDLE_INSPECT_MANIFEST_EXECUTION_FLAG_MISSING'
      && item.flag === flag
    )), flag);
  }
});

test('missing manifest non-execution flags object fails closed', () => {
  const root = createBundle();
  const data = manifest(root);
  delete data.non_execution_flags;
  writeManifest(root, data);

  const result = inspect(root);
  assertInspection(result, 'blocked_invalid_manifest');
  assert.ok(result.diagnostics.some((item) => (
    item.code === 'WORK_RECORD_REPAIR_BUNDLE_INSPECT_MANIFEST_EXECUTION_FLAG_MISSING'
    && item.flag === 'non_execution_flags'
  )));
});

test('non-boolean manifest non-execution flag fails closed', () => {
  const root = createBundle();
  const data = manifest(root);
  data.non_execution_flags.uses_browser = 'false';
  writeManifest(root, data);

  const result = inspect(root);
  assertInspection(result, 'blocked_invalid_manifest');
  assert.ok(result.diagnostics.some((item) => (
    item.code === 'WORK_RECORD_REPAIR_BUNDLE_INSPECT_MANIFEST_EXECUTION_FLAG'
    && item.flag === 'uses_browser'
    && item.value === 'false'
  )));
});

test('unknown non-boolean manifest flag fails closed', () => {
  const root = createBundle();
  const data = manifest(root);
  data.non_execution_flags.live_replay_mode = 'enabled';
  writeManifest(root, data);

  const result = inspect(root);
  assertInspection(result, 'blocked_invalid_manifest');
  assert.ok(result.diagnostics.some((item) => (
    item.code === 'WORK_RECORD_REPAIR_BUNDLE_INSPECT_MANIFEST_EXECUTION_FLAG_UNKNOWN'
    && item.flag === 'live_replay_mode'
    && item.value === 'enabled'
  )));
});

test('unknown false manifest non-execution flags are permitted', () => {
  const root = createBundle();
  const data = manifest(root);
  data.non_execution_flags.future_read_only_claim = false;
  writeManifest(root, data);

  assertInspection(inspect(root), 'valid');
});

test('unknown true execution-like manifest flag fails closed', () => {
  const root = createBundle();
  const data = manifest(root);
  data.non_execution_flags.writes_index_entry = true;
  writeManifest(root, data);

  const result = inspect(root);
  assertInspection(result, 'blocked_invalid_manifest');
  assert.ok(result.diagnostics.some((item) => (
    item.code === 'WORK_RECORD_REPAIR_BUNDLE_INSPECT_MANIFEST_EXECUTION_FLAG_UNKNOWN'
    && item.flag === 'writes_index_entry'
    && item.value === true
  )));
});

test('symlinked bundle-root ancestor fails closed', () => {
  const root = tempDir('aos-work-record-inspect-ancestor-');
  const real = path.join(root, 'real');
  const container = path.join(root, 'container');
  fs.mkdirSync(real);
  fs.mkdirSync(container);
  const bundle = createBundle({ outputRoot: path.join(real, 'bundle') });
  fs.symlinkSync(real, path.join(container, 'link'));

  assertInspection(inspect(path.join(container, 'link', path.basename(bundle))), 'blocked_path_escape');
});

test('symlinked bundle root fails closed', () => {
  const root = createBundle();
  const link = path.join(tempDir('aos-work-record-inspect-root-link-'), 'bundle-link');
  fs.symlinkSync(root, link);

  assertInspection(inspect(link), 'blocked_path_escape');
});

test('symlinked artifact file fails closed', () => {
  const root = createBundle();
  const artifact = path.join(root, 'artifacts/gate-request.json');
  const outside = path.join(tempDir('aos-work-record-inspect-artifact-link-'), 'gate-request.json');
  fs.copyFileSync(artifact, outside);
  fs.rmSync(artifact);
  fs.symlinkSync(outside, artifact);

  assertInspection(inspect(root), 'blocked_path_escape');
});

test('symlinked descriptor file fails closed', () => {
  const root = createBundle();
  const file = descriptor(root, 'work-record-gate-request');
  const outside = path.join(tempDir('aos-work-record-inspect-descriptor-link-'), 'descriptor.json');
  fs.copyFileSync(file, outside);
  fs.rmSync(file);
  fs.symlinkSync(outside, file);

  assertInspection(inspect(root), 'blocked_path_escape');
});

test('forbidden finalization and supersession report files block the bundle', () => {
  const root = createBundle();
  writeJson(path.join(root, 'reports/finalization-dry-run.json'), { type: 'forbidden' });
  writeJson(path.join(root, 'reports/supersession-lookup.json'), { type: 'forbidden' });

  const result = inspect(root);
  assertInspection(result, 'blocked_forbidden_artifact');
  assert.ok(result.diagnostics[0].relative_paths.includes('reports/finalization-dry-run.json'));
});

test('forbidden replacement and gate outputs block the bundle', () => {
  const root = createBundle();
  writeJson(path.join(root, 'replacement-records/replacement.json'), {});
  writeJson(path.join(root, 'gate-record.json'), {});

  assertInspection(inspect(root), 'blocked_forbidden_artifact');
});

test('descriptor requiring a saved output reports it present when artifact is present', () => {
  const root = createBundle();
  const result = inspect(root);
  const descriptorSummary = result.descriptors.find((item) => item.id === 'aos-gate-ask');

  assert.equal(descriptorSummary.required_saved_outputs_present, true);
  assert.deepEqual(descriptorSummary.missing_saved_outputs, []);
});

test('descriptor requiring a saved output reports missing saved output when absent', () => {
  const root = createBundle();
  fs.rmSync(path.join(root, 'artifacts/gate-request.json'));

  const result = inspect(root);
  const descriptorSummary = result.descriptors.find((item) => item.id === 'aos-gate-ask');
  assert.equal(descriptorSummary.required_saved_outputs_present, false);
  assert.deepEqual(descriptorSummary.missing_saved_outputs, ['artifacts/gate-request.json']);
});

test('materialized descriptor without matching artifact is blocked', () => {
  const root = createBundle();
  fs.rmSync(path.join(root, 'artifacts/gate-request.json'));

  const result = inspect(root);
  assertInspection(result, 'blocked_missing_artifact');
  assert.ok(result.diagnostics.some((item) => item.code === 'WORK_RECORD_REPAIR_BUNDLE_INSPECT_DESCRIPTOR_MATERIALIZED_MISSING'));
});

test('planned_only descriptor does not require the artifact file', () => {
  const root = createBundle();
  const file = descriptor(root, 'work-record-gate-request');
  const data = readJson(file);
  data.bundle_artifact_status = 'planned_only';
  fs.rmSync(path.join(root, 'artifacts/gate-request.json'));
  writeJson(file, data);
  refreshManifestDigest(root, 'commands/work-record-gate-request.json');
  const dataManifest = manifest(root);
  dataManifest.artifacts = dataManifest.artifacts.filter((item) => item.relative_path !== 'artifacts/gate-request.json');
  writeManifest(root, dataManifest);

  const result = inspect(root);
  assertInspection(result, 'valid');
});

test('planned_only descriptor is blocked when the artifact file exists', () => {
  const root = createBundle();
  const file = descriptor(root, 'work-record-gate-request');
  const data = readJson(file);
  data.bundle_artifact_status = 'planned_only';
  writeJson(file, data);
  refreshManifestDigest(root, 'commands/work-record-gate-request.json');

  const result = inspect(root);
  assertInspection(result, 'blocked_descriptor_mismatch');
  assert.ok(result.diagnostics.some((item) => item.code === 'WORK_RECORD_REPAIR_BUNDLE_INSPECT_DESCRIPTOR_PLANNED_ONLY_PRESENT'));
});

test('inspector does not write or modify bundle files', () => {
  const root = createBundle();
  const before = snapshotBundle(root);
  const result = inspect(root);
  const after = snapshotBundle(root);

  assertInspection(result, 'valid');
  assert.deepEqual(after, before);
});

test('lifecycle status summarizes explicit roots through inspector output', () => {
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
  assert.deepEqual(result.roots.supplied_bundle_roots, [root]);
  assert.deepEqual(result.roots.supplied_bundle_parents, []);
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

test('lifecycle status keeps missing and invalid bundles in one report', () => {
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
  const expectedCanonicalRoots = [
    fs.realpathSync(invalidRoot),
    missingRoot,
    fs.realpathSync(validRoot),
  ].map((item) => path.resolve(item)).sort((a, b) => a.localeCompare(b));
  assert.deepEqual(result.bundles.map((bundle) => bundle.canonical_bundle_root), expectedCanonicalRoots);
  assert.ok(result.bundles.some((bundle) => bundle.lifecycle_status === 'missing'));
  assert.ok(result.bundles.some((bundle) => bundle.inspection_status === 'blocked_missing_manifest'));
});

test('lifecycle status parent scan is explicit, bounded, and non-recursive', () => {
  const parent = tempDir('aos-work-record-status-parent-');
  const child = createBundle({ outputRoot: path.join(parent, 'child-bundle') });
  const nestedContainer = path.join(parent, 'nested-container');
  const nested = createBundle({ outputRoot: path.join(nestedContainer, 'nested-bundle') });

  const result = statusWorkRecordRepairBundles({ bundleParents: [parent] });

  assertLifecycleStatus(result);
  assert.equal(result.bundle_count, 1);
  assert.equal(result.bundles[0].bundle_root, child);
  assert.equal(result.roots.derived_bundle_roots[0].bundle_parent, parent);
  assert.equal(result.roots.derived_bundle_roots[0].bundle_root, child);
  assert.equal(result.bundles.some((bundle) => bundle.bundle_root === nested), false);
});

test('lifecycle status reports missing input as structured failure', () => {
  const result = statusWorkRecordRepairBundles();

  assertLifecycleStatus(result, 'failed');
  assert.equal(result.bundle_count, 0);
  assert.ok(result.diagnostics.some((item) => item.code === 'WORK_RECORD_REPAIR_BUNDLE_STATUS_INPUT_REQUIRED'));
});

test('lifecycle status does not write or modify bundle files', () => {
  const root = createBundle();
  const before = snapshotBundle(root);
  const result = statusWorkRecordRepairBundles({ bundleRoots: [root] });
  const after = snapshotBundle(root);

  assertLifecycleStatus(result);
  assert.deepEqual(after, before);
});

test('public CLI valid and invalid smokes return structured JSON', () => {
  const root = createBundle();
  const valid = runAos(['work-record', 'repair', 'bundle', 'inspect', root, '--json']);
  assert.equal(valid.status, 0, valid.stderr);
  assertInspection(JSON.parse(valid.stdout), 'valid');

  const invalid = runAos(['work-record', 'repair', 'bundle', 'inspect', '/tmp/does-not-exist', '--json']);
  assert.notEqual(invalid.status, 0);
  assertInspection(JSON.parse(invalid.stderr), 'blocked_missing_manifest');
});

test('public CLI lifecycle status returns structured JSON and missing-input failure', () => {
  const root = createBundle();
  const valid = runAos(['work-record', 'repair', 'bundle', 'status', '--bundle-root', root, '--json']);
  assert.equal(valid.status, 0, valid.stderr);
  const validJson = JSON.parse(valid.stdout);
  assertLifecycleStatus(validJson);
  assert.equal(validJson.bundle_count, 1);
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

test('public CLI help resolves work-record repair bundle inspect', () => {
  const help = runAos(['help', 'work-record', 'repair', 'bundle', 'inspect', '--json']);
  assert.equal(help.status, 0, help.stderr);
  const helpJson = JSON.parse(help.stdout);
  assert.deepEqual(helpJson.path, ['work-record', 'repair', 'bundle', 'inspect']);
  assert.ok(helpJson.forms.some((form) => form.id === 'work-record-repair-bundle-inspect'));
});

test('parser does not treat inspect as source ref for bundle writer', () => {
  const result = runAos(['work-record', 'repair', 'bundle', 'inspect', '--output-root', tempDir(), '--json']);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /repair bundle inspect requires <bundle-root>/);
  assert.doesNotMatch(result.stderr, /repair bundle requires a Work Record id or path/);
});

test('docs, schema, and skill describe inspect as read-only validation, not repair', () => {
  const apiDoc = fs.readFileSync(path.join(repoRoot, 'docs/api/aos.md'), 'utf8');
  const schemaDoc = fs.readFileSync(path.join(repoRoot, 'shared/schemas/aos-work-record-v0.md'), 'utf8');
  const skill = fs.readFileSync(path.join(repoRoot, 'skills/aos-agent-workspace/SKILL.md'), 'utf8');
  for (const text of [apiDoc, schemaDoc, skill]) {
    assert.match(text, /repair bundle inspect/);
    assert.match(text, /read-only|without writing/);
    assert.match(text, /explicit bundle root/);
    assert.match(text, /validates?|checks? .*manifest/s);
    assert.match(text, /does not run|never .*executes? repair|without .*executing repair/s);
    assert.match(text, /exact (next )?`?argv`?|exact next command/s);
    assert.match(text, /saved outputs? (are )?present|required saved-output presence/s);
    assert.match(text, /repair bundle status/);
    assert.match(text, /--bundle-root/);
    assert.match(text, /--bundle-parent/);
    assert.match(text, /ready|blocked|stale|next/);
    assert.match(text, /non-recursive|immediate children/);
    assert.match(text, /live UI|TCC/);
  }
});
