import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { buildExperienceRuntimeContext } from '../../scripts/lib/experience-runtime-context.mjs';
import {
  baseResponses,
  dryRunToggleURL,
  runContext,
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

async function writeOperatorFixtureState(tmp, expectedURL) {
  await writeJSON(path.join(tmp, 'repo', 'experience-state.json'), {
    active_experience: 'operator-fixture',
    exclusive: true,
  });
  await writeJSON(path.join(tmp, 'repo', 'config.json'), {
    content: {
      roots: {
        toolkit: toolkitRoot,
      },
    },
    status_item: {
      enabled: true,
      toggle_id: 'operator-fixture-surface',
      toggle_url: expectedURL,
      toggle_track: 'union',
      icon: 'aos',
    },
  });
}

test('experience runtime context schema accepts a healthy status envelope', async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'aos-runtime-context-schema-healthy-'));
  const expectedURL = dryRunToggleURL('operator-fixture', { AOS_STATE_ROOT: tmp });
  await writeOperatorFixtureState(tmp, expectedURL);
  await fs.mkdir(path.join(tmp, 'repo', 'pending-annotations', 'records'), { recursive: true });

  const { payload } = await runContext(tmp, 'operator-fixture', baseResponses(tmp, {
    canvases: [{
      id: 'operator-fixture-surface',
      url: expectedURL,
      lifecycleState: 'active',
      suspended: false,
    }],
  }));

  assert.equal(payload.status, 'ok');
  assert.match(payload.collected_at, /^\d{4}-\d{2}-\d{2}T/);
  await validatePayload(payload, 'aos-runtime-context-schema-healthy-instance-');
});

test('experience runtime context schema accepts a degraded status envelope', async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'aos-runtime-context-schema-degraded-'));
  const expectedURL = dryRunToggleURL('operator-fixture', { AOS_STATE_ROOT: tmp });
  await writeOperatorFixtureState(tmp, expectedURL);
  await fs.mkdir(path.join(tmp, 'repo', 'pending-annotations', 'records'), { recursive: true });

  const { payload } = await runContext(tmp, 'operator-fixture', baseResponses(tmp, {
    canvases: [{
      id: 'operator-fixture-surface',
      url: expectedURL,
      lifecycleState: 'active',
      suspended: false,
    }],
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

test('experience runtime context schema accepts corrupt pending annotation state', async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'aos-runtime-context-schema-corrupt-pending-'));
  const expectedURL = dryRunToggleURL('operator-fixture', { AOS_STATE_ROOT: tmp });
  await writeOperatorFixtureState(tmp, expectedURL);
  const corruptRecordPath = path.join(tmp, 'repo', 'pending-annotations', 'records', 'ann-bad-json.json');
  await fs.mkdir(path.dirname(corruptRecordPath), { recursive: true });
  await fs.writeFile(corruptRecordPath, '{bad json', 'utf8');

  const { payload } = await runContext(tmp, 'operator-fixture', baseResponses(tmp, {
    canvases: [{
      id: 'operator-fixture-surface',
      url: expectedURL,
      lifecycleState: 'active',
      suspended: false,
    }],
  }));

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
    surfaceId: 'file-root-schema-surface',
    expectedURL,
  });
  const responses = baseResponses(stateRoot, {
    contentRoots: { badroot: rootFile },
    canvases: [{
      id: 'file-root-schema-surface',
      url: expectedURL,
      lifecycleState: 'active',
      suspended: false,
    }],
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
  await validatePayload(payload, 'aos-runtime-context-schema-file-root-instance-');
});

test('experience runtime context schema rejects non-status command argv', async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'aos-runtime-context-schema-invalid-command-'));
  const expectedURL = dryRunToggleURL('operator-fixture', { AOS_STATE_ROOT: tmp });
  await writeOperatorFixtureState(tmp, expectedURL);
  await fs.mkdir(path.join(tmp, 'repo', 'pending-annotations', 'records'), { recursive: true });
  const { payload } = await runContext(tmp, 'operator-fixture', baseResponses(tmp, {
    canvases: [{
      id: 'operator-fixture-surface',
      url: expectedURL,
      lifecycleState: 'active',
      suspended: false,
    }],
  }));
  const invalid = JSON.parse(JSON.stringify(payload));
  invalid.command.argv = ['./aos', 'experience', 'activate', 'operator-fixture', '--json'];
  const instancePath = await writeTempRuntimeContextPayload(invalid, 'aos-runtime-context-schema-invalid-command-instance-');
  rejectJSONAgainstSchema(instancePath);
});
