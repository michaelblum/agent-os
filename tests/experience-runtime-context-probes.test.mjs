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

test('experience runtime passive AOS readbacks run from normalized repo root', async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'aos-experience-context-cwd-'));
  const tempRepoRoot = path.join(tmp, 'repo-root');
  const experiencesRoot = path.join(tmp, 'experiences');
  const stateRoot = path.join(tmp, 'state');
  const id = 'cwd-root-fixture';
  const contentRoot = path.join(tempRepoRoot, 'content-root');
  const expectedURL = 'aos://cwdroot/runtime/index.html';
  assert.notEqual(tempRepoRoot, process.cwd());

  await fs.mkdir(contentRoot, { recursive: true });
  const expectedCwd = await fs.realpath(tempRepoRoot);
  await writeExperienceManifestFixture({
    experiencesRoot,
    id,
    title: 'Cwd Root Fixture',
    contentRootId: 'cwdroot',
    contentRootPath: 'content-root',
    surfaceId: 'cwd-root-surface',
    expectedURL,
  });
  await writeRuntimeStateFixture({
    stateRoot,
    id,
    contentRootKey: 'cwdroot',
    contentRootPath: contentRoot,
  });

  const responses = baseResponses(stateRoot, {
    contentRoots: { cwdroot: contentRoot },
  });
  const { fake, log } = await writeCwdRecordingFakeAos(tmp, responses);
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
  assert.equal(payload.active_experience.status, 'current');

  const calls = (await fs.readFile(log, 'utf8'))
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line));
  assert.deepEqual(calls.map((entry) => entry.args.join(' ')).sort(), [
    'content status --json',
    'permissions check --json',
    'service status --mode repo --json',
  ].sort());
  assert.deepEqual([...new Set(calls.map((entry) => entry.cwd))], [expectedCwd]);
});

test('experience status hard-bounds passive AOS probes that ignore SIGTERM', async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'aos-experience-context-timeout-'));
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
  await fs.mkdir(path.join(tmp, 'repo', 'pending-annotations', 'records'), { recursive: true });

  const { fake, log } = await writeSigtermIgnoringFakeAos(tmp);
  const startedAt = Date.now();
  const result = runNode(['scripts/aos-experience.mjs', 'status', 'runtime-context-fixture', '--json'], {
    AOS_STATE_ROOT: tmp,
    AOS_PATH: fake,
    AOS_EXPERIENCE_RUNTIME_PROBE_TIMEOUT_MS: '1000',
    AOS_EXPERIENCE_RUNTIME_PROBE_KILL_GRACE_MS: '100',
    FAKE_AOS_LOG: log,
  });
  const elapsedMs = Date.now() - startedAt;

  assert.equal(result.status, 0, `${result.stdout}${result.stderr}`);
  assert(elapsedMs < 5000, `status took ${elapsedMs}ms`);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.runtime.service.command_status, 'timeout');
  assert.equal(payload.runtime.permissions.command_status, 'timeout');
  assert.equal(payload.content_roots.command_status, 'timeout');
  assert.equal(payload.content_roots.roots[0].repair_action, 'inspect_runtime');
  assert(payload.diagnostics.some((item) => (
    item.id === 'content-root-live-readback-unknown:toolkit'
    && item.repair_action === 'inspect_runtime'
  )), payload.diagnostics);

  const calls = await readFakeAosCalls(log);
  assert.deepEqual(calls.filter(Array.isArray).map((args) => args.join(' ')).sort(), [
    'content status --json',
    'permissions check --json',
    'service status --mode repo --json',
  ].sort());
});
