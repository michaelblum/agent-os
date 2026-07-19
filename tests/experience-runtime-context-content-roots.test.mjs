import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { buildExperienceRuntimeContext } from '../scripts/lib/experience-runtime-context.mjs';
import {
  baseResponses,
  readFakeAosCalls,
  runContext,
  runNode,
  toolkitRoot,
  writeCwdRecordingFakeAos,
  writeExperienceManifestFixture,
  writeFakeAos,
  writeJSON,
  writeMutableFakeAos,
  writeRuntimeStateFixture,
  writeSigtermIgnoringFakeAos,
} from './lib/experience-runtime-fixtures.mjs';

test('experience status reports missing content root and uninitialized pending state', async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'aos-experience-context-drift-'));
  await writeJSON(path.join(tmp, 'repo', 'experience-state.json'), {
    active_experience: 'runtime-context-fixture',
    exclusive: true,
  });
  await writeJSON(path.join(tmp, 'repo', 'config.json'), {
    content: {
      roots: {
        toolkit: path.join(tmp, 'stale-toolkit'),
      },
    },
  });

  const { payload } = await runContext(tmp, 'runtime-context-fixture', baseResponses(tmp, {
    contentRoots: {},
  }));

  assert.equal(payload.status, 'degraded');
  assert.equal(payload.content_roots.roots[0].configured_status, 'stale');
  assert.equal(payload.content_roots.roots[0].live_status, 'missing');
  assert.equal(payload.pending_annotations.status, 'not_initialized');
  assert(payload.recommended_next.some((item) => item.id === 'activate-requested-experience'));
  assert(payload.recommended_next.some((item) => (
    item.id === 'pending-annotation-create-display-only'
    && item.display_only === true
  )));
});

test('experience status recommends activation for repairable content-root drift', async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'aos-experience-context-root-repairable-'));
  const tempRepoRoot = path.join(tmp, 'repo-root');
  const experiencesRoot = path.join(tmp, 'experiences');
  const stateRoot = path.join(tmp, 'state');
  const id = 'repairable-root-fixture';
  const contentRoot = path.join(tempRepoRoot, 'content-root');
  const staleRoot = path.join(tempRepoRoot, 'stale-content-root');
  const expectedURL = 'aos://repairroot/runtime/index.html';
  await fs.mkdir(contentRoot, { recursive: true });
  await writeExperienceManifestFixture({
    experiencesRoot,
    id,
    title: 'Repairable Root Fixture',
    contentRootId: 'repairroot',
    contentRootPath: 'content-root',
    surfaceId: 'repair-root-surface',
    expectedURL,
  });
  await writeRuntimeStateFixture({
    stateRoot,
    id,
    contentRootKey: 'repairroot',
    contentRootPath: staleRoot,
  });
  const responses = baseResponses(stateRoot, {
    contentRoots: {},
  });
  const { fake, log } = await writeFakeAos(tmp, responses);
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
  const root = payload.content_roots.roots[0];
  assert.equal(root.declared_path_status, 'current');
  assert.equal(root.configured_status, 'stale');
  assert.equal(root.live_status, 'missing');
  assert.equal(root.repair_action, 'activate_experience');
  const configDiagnostic = payload.diagnostics.find((item) => item.id === 'content-root-config-drift:repairroot');
  const liveDiagnostic = payload.diagnostics.find((item) => item.id === 'content-root-live-drift:repairroot');
  assert.equal(configDiagnostic?.repair_action, 'activate_experience');
  assert.equal(liveDiagnostic?.repair_action, 'activate_experience');
  assert.equal(configDiagnostic?.recommended_next_id, 'activate-requested-experience');
  assert.equal(liveDiagnostic?.recommended_next_id, 'activate-requested-experience');
  assert(payload.recommended_next.some((item) => item.id === 'activate-requested-experience'), payload.recommended_next);
});

test('experience status does not mark a regular file content root current', async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'aos-experience-context-file-root-'));
  const tempRepoRoot = path.join(tmp, 'repo-root');
  const experiencesRoot = path.join(tmp, 'experiences');
  const stateRoot = path.join(tmp, 'state');
  const id = 'file-root-fixture';
  const rootFile = path.join(tempRepoRoot, 'content-root-file');
  const expectedURL = 'aos://badroot/runtime/file-root.html';
  await fs.mkdir(tempRepoRoot, { recursive: true });
  await fs.writeFile(rootFile, 'not a directory\n', 'utf8');
  await writeExperienceManifestFixture({
    experiencesRoot,
    id,
    title: 'File Root Fixture',
    contentRootId: 'badroot',
    contentRootPath: 'content-root-file',
    surfaceId: 'file-root-surface',
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
  const { fake, log } = await writeFakeAos(tmp, responses);
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
  const root = payload.content_roots.roots[0];
  assert.equal(payload.status, 'degraded');
  assert.equal(root.declared_path, rootFile);
  assert.equal(root.declared_path_status, 'not_directory');
  assert.equal(root.declared_path_type, 'file');
  assert.equal(root.configured_status, 'current');
  assert.equal(root.live_status, 'current');
  assert.equal(root.repair_action, 'fix_declared_path');
  assert.equal(root.status, 'not_directory');
  assert.notEqual(payload.content_roots.status, 'current');
  assert(!payload.diagnostics.some((item) => item.id.startsWith('content-root:')), payload.diagnostics);
  assert(payload.diagnostics.some((item) => (
    item.id === 'content-root-declared-path-invalid:badroot'
    && item.repair_action === 'fix_declared_path'
    && item.recommended_next_id === undefined
  )), payload.diagnostics);
  assert(!payload.recommended_next.some((item) => (
    item.id === 'activate-requested-experience'
    && item.argv.join(' ') === './aos experience activate file-root-fixture --json --allow-start'
  )), payload.recommended_next);
});
