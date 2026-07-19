import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { buildExperienceRuntimeContext } from '../../scripts/lib/experience-runtime-context.mjs';
import {
  baseResponses,
  runContext,
  testExperiencesRoot,
  toolkitRoot,
  validateJSONAgainstSchema,
  rejectJSONAgainstSchema,
  writeExperienceManifestFixture,
  writeFakeAos,
  writeJSON,
  writeRuntimeStateFixture,
  writeTempRuntimeContextPayload,
} from '../lib/experience-runtime-fixtures.mjs';

async function validatePayload(payload, prefix) {
  const instancePath = await writeTempRuntimeContextPayload(payload, prefix);
  validateJSONAgainstSchema(instancePath);
  return instancePath;
}

async function writeRuntimeContextFixtureState(tmp) {
  await writeJSON(path.join(tmp, 'repo', 'experience-state.json'), {
    active_experience: 'runtime-context-fixture',
    exclusive: true,
  });
  await writeJSON(path.join(tmp, 'repo', 'config.json'), {
    content: {
      roots: {
        toolkit: toolkitRoot,
      },
    },
  });
}

test('experience runtime context schema accepts a healthy status envelope', async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'aos-runtime-context-schema-healthy-'));
  await writeRuntimeContextFixtureState(tmp);
  await fs.mkdir(path.join(tmp, 'repo', 'pending-annotations', 'records'), { recursive: true });

  const { payload } = await runContext(tmp, 'runtime-context-fixture', baseResponses(tmp));

  assert.equal(payload.status, 'ok');
  assert.match(payload.collected_at, /^\d{4}-\d{2}-\d{2}T/);
  await validatePayload(payload, 'aos-runtime-context-schema-healthy-instance-');
});

test('experience runtime context schema accepts a degraded status envelope', async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'aos-runtime-context-schema-degraded-'));
  await writeRuntimeContextFixtureState(tmp);
  await fs.mkdir(path.join(tmp, 'repo', 'pending-annotations', 'records'), { recursive: true });

  const { payload } = await runContext(tmp, 'runtime-context-fixture', baseResponses(tmp, {
    service: {
      status: 'degraded',
      running: true,
      target_matches_expected: true,
      reason: 'log_path_mismatch',
      log_path_matches_expected: false,
      actual_log_path: path.join(tmp, 'wrong.log'),
      expected_log_path: path.join(tmp, 'repo', 'aos.err.log'),
      notes: ['Launch agent log path differs from the expected repo state directory.'],
    },
  }));

  assert.equal(payload.status, 'degraded');
  await validatePayload(payload, 'aos-runtime-context-schema-degraded-instance-');
});

test('experience runtime context schema validates normalized fallback runtime mode', async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'aos-runtime-context-schema-invalid-mode-'));
  await writeRuntimeContextFixtureState(tmp);
  await fs.mkdir(path.join(tmp, 'repo', 'pending-annotations', 'records'), { recursive: true });
  const responses = baseResponses(tmp);
  const { fake, log } = await writeFakeAos(tmp);
  const env = {
    ...process.env,
    AOS_STATE_ROOT: tmp,
    AOS_EXPERIENCES_DIR: testExperiencesRoot,
    AOS_PATH: fake,
    AOS_RUNTIME_MODE: 'bogus',
    FAKE_AOS_LOG: log,
    FAKE_AOS_RESPONSES: JSON.stringify(responses),
  };

  const payload = await buildExperienceRuntimeContext('runtime-context-fixture', { env });
  assert.equal(payload.runtime.mode, 'repo');
  await validatePayload(payload, 'aos-runtime-context-schema-invalid-mode-instance-');
});

test('experience runtime context schema accepts unsupported annotation status without store internals', async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'aos-runtime-context-schema-no-annotation-'));
  const tempRepoRoot = path.join(tmp, 'repo-root');
  const experiencesRoot = path.join(tmp, 'experiences');
  const stateRoot = path.join(tmp, 'state');
  const id = 'non-annotation-schema-fixture';
  const contentRoot = path.join(tempRepoRoot, 'content-root');
  const expectedURL = 'aos://plain/runtime/schema.html';
  await fs.mkdir(contentRoot, { recursive: true });
  await writeExperienceManifestFixture({
    experiencesRoot,
    id,
    title: 'Non Annotation Schema Fixture',
    contentRootId: 'plainroot',
    contentRootPath: 'content-root',
    surfaceId: 'plain-schema-surface',
    expectedURL,
    menu: [{
      id: 'plain-tool',
      label: 'Plain Tool',
      kind: 'future_tool',
      tool: 'plain',
    }],
  });
  await writeRuntimeStateFixture({
    stateRoot,
    id,
    contentRootKey: 'plainroot',
    contentRootPath: contentRoot,
  });
  await fs.writeFile(path.join(stateRoot, 'repo', 'pending-annotations'), 'corrupt if inspected\n', 'utf8');
  const responses = baseResponses(stateRoot, {
    contentRoots: { plainroot: contentRoot },
  });
  const { fake, log } = await writeFakeAos(tmp);
  const env = {
    ...process.env,
    AOS_STATE_ROOT: stateRoot,
    AOS_EXPERIENCES_DIR: experiencesRoot,
    AOS_PATH: fake,
    AOS_RUNTIME_MODE: 'repo',
    FAKE_AOS_LOG: log,
    FAKE_AOS_RESPONSES: JSON.stringify(responses),
  };

  const payload = await buildExperienceRuntimeContext(id, { env, repoRoot: tempRepoRoot });
  assert.deepEqual(payload.pending_annotations, {
    status: 'not_applicable',
    supported: false,
  });
  assert.equal(Object.hasOwn(payload.state, 'pending_annotations_root'), false);
  await validatePayload(payload, 'aos-runtime-context-schema-no-annotation-instance-');

  const invalidPendingInternals = JSON.parse(JSON.stringify(payload));
  invalidPendingInternals.pending_annotations.root = path.join(stateRoot, 'repo', 'pending-annotations');
  rejectJSONAgainstSchema(await writeTempRuntimeContextPayload(
    invalidPendingInternals,
    'aos-runtime-context-schema-no-annotation-pending-leak-instance-',
  ));

  const invalidStateInternals = JSON.parse(JSON.stringify(payload));
  invalidStateInternals.state.pending_annotations_root = path.join(stateRoot, 'repo', 'pending-annotations');
  rejectJSONAgainstSchema(await writeTempRuntimeContextPayload(
    invalidStateInternals,
    'aos-runtime-context-schema-no-annotation-state-leak-instance-',
  ));
});

test('experience runtime context schema accepts corrupt pending annotation state', async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'aos-runtime-context-schema-corrupt-pending-'));
  await writeRuntimeContextFixtureState(tmp);
  const corruptRecordPath = path.join(tmp, 'repo', 'pending-annotations', 'records', 'ann-bad-json.json');
  await fs.mkdir(path.dirname(corruptRecordPath), { recursive: true });
  await fs.writeFile(corruptRecordPath, '{bad json', 'utf8');

  const { payload } = await runContext(tmp, 'runtime-context-fixture', baseResponses(tmp));

  assert.equal(payload.status, 'blocked');
  assert.equal(payload.pending_annotations.records_status, 'corrupt');
  assert.equal(payload.pending_annotations.records_error_storage_status, 'corrupt_json');
  await validatePayload(payload, 'aos-runtime-context-schema-corrupt-pending-instance-');
});

test('experience runtime context schema accepts invalid content root status output', async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'aos-runtime-context-schema-file-root-'));
  const tempRepoRoot = path.join(tmp, 'repo-root');
  const experiencesRoot = path.join(tmp, 'experiences');
  const stateRoot = path.join(tmp, 'state');
  const id = 'file-root-schema-fixture';
  const rootFile = path.join(tempRepoRoot, 'content-root-file');
  const expectedURL = 'aos://badroot/runtime/file-root.html';
  await fs.mkdir(tempRepoRoot, { recursive: true });
  await fs.writeFile(rootFile, 'not a directory\n', 'utf8');
  await writeExperienceManifestFixture({
    experiencesRoot,
    id,
    title: 'File Root Schema Fixture',
    contentRootId: 'badroot',
    contentRootPath: 'content-root-file',
    surfaceId: 'file-root-schema-surface',
    expectedURL,
  });
  await writeRuntimeStateFixture({
    stateRoot,
    id,
    contentRootKey: 'badroot',
    contentRootPath: rootFile,
  });
  const responses = baseResponses(stateRoot, {
    contentRoots: { badroot: rootFile },
  });
  const { fake, log } = await writeFakeAos(tmp);
  const env = {
    ...process.env,
    AOS_STATE_ROOT: stateRoot,
    AOS_EXPERIENCES_DIR: experiencesRoot,
    AOS_PATH: fake,
    AOS_RUNTIME_MODE: 'repo',
    FAKE_AOS_LOG: log,
    FAKE_AOS_RESPONSES: JSON.stringify(responses),
  };

  const payload = await buildExperienceRuntimeContext(id, { env, repoRoot: tempRepoRoot });
  assert.equal(payload.status, 'degraded');
  assert.equal(payload.content_roots.roots[0].declared_path_status, 'not_directory');
  assert.equal(payload.content_roots.roots[0].repair_action, 'fix_declared_path');
  await validatePayload(payload, 'aos-runtime-context-schema-file-root-instance-');

  const missingRepairAction = JSON.parse(JSON.stringify(payload));
  delete missingRepairAction.content_roots.roots[0].repair_action;
  rejectJSONAgainstSchema(await writeTempRuntimeContextPayload(
    missingRepairAction,
    'aos-runtime-context-schema-file-root-missing-repair-action-instance-',
  ));
});

test('experience runtime context schema rejects non-status command argv', async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'aos-runtime-context-schema-invalid-command-'));
  await writeRuntimeContextFixtureState(tmp);
  await fs.mkdir(path.join(tmp, 'repo', 'pending-annotations', 'records'), { recursive: true });
  const { payload } = await runContext(tmp, 'runtime-context-fixture', baseResponses(tmp));
  const invalid = JSON.parse(JSON.stringify(payload));
  invalid.command.argv = ['./aos', 'experience', 'activate', 'runtime-context-fixture', '--json'];
  const instancePath = await writeTempRuntimeContextPayload(invalid, 'aos-runtime-context-schema-invalid-command-instance-');
  rejectJSONAgainstSchema(instancePath);

  for (const flag of ['--dry-run', '--allow-start']) {
    const invalidFlag = JSON.parse(JSON.stringify(payload));
    invalidFlag.command.argv = ['./aos', 'experience', 'status', 'runtime-context-fixture', '--json', flag];
    rejectJSONAgainstSchema(await writeTempRuntimeContextPayload(
      invalidFlag,
      `aos-runtime-context-schema-invalid-command-${flag.slice(2)}-instance-`,
    ));
  }
});
