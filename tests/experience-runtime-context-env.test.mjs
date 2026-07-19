import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { experienceRuntimeEnv } from '../scripts/lib/experience-runtime-env.mjs';
import { buildExperienceRuntimeContext } from '../scripts/lib/experience-runtime-context.mjs';
import {
  baseResponses,
  readFakeAosCalls,
  repoRoot,
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

test('experience runtime child env preserves only explicit state root overrides', async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'aos-experience-runtime-env-'));
  const home = path.join(tmp, 'home');
  const defaultRuntime = experienceRuntimeEnv({
    env: { HOME: home },
    repoRoot,
  });
  assert.equal(defaultRuntime.stateRoot, path.join(os.homedir(), '.config', 'aos'));
  assert.equal(Object.hasOwn(defaultRuntime.env, 'AOS_STATE_ROOT'), false);

  const placeholderRuntime = experienceRuntimeEnv({
    env: { HOME: home, AOS_STATE_ROOT: '$AOS_STATE_ROOT' },
    repoRoot,
  });
  assert.equal(placeholderRuntime.stateRoot, path.join(os.homedir(), '.config', 'aos'));
  assert.equal(Object.hasOwn(placeholderRuntime.env, 'AOS_STATE_ROOT'), false);

  const explicitStateRoot = path.join(tmp, 'state');
  const explicitRuntime = experienceRuntimeEnv({
    env: { HOME: home, AOS_STATE_ROOT: explicitStateRoot },
    repoRoot,
  });
  assert.equal(explicitRuntime.stateRoot, explicitStateRoot);
  assert.equal(explicitRuntime.env.AOS_STATE_ROOT, explicitStateRoot);
});

test('experience status rejects invalid id before passive fake AOS probes', async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'aos-experience-context-invalid-id-'));
  const { fake, log } = await writeFakeAos(tmp, {});

  const result = runNode(['scripts/aos-experience.mjs', 'status', 'missing-experience', '--json'], {
    AOS_STATE_ROOT: tmp,
    AOS_PATH: fake,
    FAKE_AOS_LOG: log,
    FAKE_AOS_RESPONSES: JSON.stringify({}),
  });

  assert.notEqual(result.status, 0);
  assert.equal(JSON.parse(result.stderr).code, 'EXPERIENCE_NOT_FOUND');
  assert.deepEqual(await readFakeAosCalls(log), []);
});

test('experience status rejects lifecycle flags before runtime context readback', async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'aos-experience-context-status-flags-'));
  const { fake, log } = await writeFakeAos(tmp, {});
  const env = {
    AOS_STATE_ROOT: tmp,
    AOS_PATH: fake,
    FAKE_AOS_LOG: log,
    FAKE_AOS_RESPONSES: JSON.stringify({}),
  };

  for (const flag of ['--dry-run', '--allow-start']) {
    const result = runNode(['scripts/aos-experience.mjs', 'status', 'runtime-context-fixture', '--json', flag], env);
    assert.notEqual(result.status, 0);
    assert.equal(result.stdout, '');
    const error = JSON.parse(result.stderr);
    assert.equal(error.code, 'INVALID_ARG');
    assert.equal(Object.hasOwn(error, 'command'), false);
    assert.equal(Object.hasOwn(error, 'argv'), false);
  }

  assert.deepEqual(await readFakeAosCalls(log), []);
});

test('experience status id path treats placeholder state root as legacy fallback', async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'aos-experience-context-placeholder-'));
  const home = path.join(tmp, 'home');
  const stateRoot = path.join(home, '.config', 'aos');
  const expectedStatePath = path.join(stateRoot, 'repo', 'experience-state.json');
  await writeJSON(expectedStatePath, {
    active_experience: 'runtime-context-fixture',
    exclusive: true,
  });

  const { fake, log } = await writeFakeAos(tmp, baseResponses(stateRoot));
  const env = {
    HOME: home,
    AOS_STATE_ROOT: '$AOS_STATE_ROOT',
    AOS_RUNTIME_MODE: '$AOS_RUNTIME_MODE',
    AOS_PATH: fake,
    FAKE_AOS_LOG: log,
    FAKE_AOS_RESPONSES: JSON.stringify(baseResponses(stateRoot)),
  };

  const legacy = runNode(['scripts/aos-experience.mjs', 'status', '--json'], env);
  assert.equal(legacy.status, 0, `${legacy.stdout}${legacy.stderr}`);
  assert.equal(JSON.parse(legacy.stdout).active_experience, 'runtime-context-fixture');

  const context = runNode(['scripts/aos-experience.mjs', 'status', 'runtime-context-fixture', '--json'], env);
  assert.equal(context.status, 0, `${context.stdout}${context.stderr}`);
  const payload = JSON.parse(context.stdout);
  assert.equal(payload.runtime.mode, 'repo');
  assert.equal(payload.runtime.state_root, stateRoot);
  assert.equal(payload.runtime.state_root.includes('$AOS_STATE_ROOT'), false);
  assert.equal(payload.active_experience.source_path, expectedStatePath);
  assert.equal(payload.active_experience.status, 'current');
  assert.equal(payload.pending_annotations.root, path.join(stateRoot, 'repo', 'pending-annotations'));

  const callText = (await fs.readFile(log, 'utf8'))
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line).join(' '));
  assert.deepEqual(callText.sort(), [
    'content status --json',
    'permissions check --json',
    'service status --mode repo --json',
  ].sort());
});

test('experience status normalizes invalid runtime mode to repo before public JSON', async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'aos-experience-context-invalid-mode-'));
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

  const responses = baseResponses(tmp);
  const { fake, log } = await writeFakeAos(tmp, responses);
  const result = runNode(['scripts/aos-experience.mjs', 'status', 'runtime-context-fixture', '--json'], {
    AOS_STATE_ROOT: tmp,
    AOS_PATH: fake,
    AOS_RUNTIME_MODE: 'bogus',
    FAKE_AOS_LOG: log,
    FAKE_AOS_RESPONSES: JSON.stringify(responses),
  });

  assert.equal(result.status, 0, `${result.stdout}${result.stderr}`);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.runtime.mode, 'repo');
  assert.equal(payload.runtime.repo_mode, true);
  assert.equal(payload.runtime.installed_mode, false);
  assert.equal(payload.runtime.state_dir, path.join(tmp, 'repo'));
  assert.equal(payload.state.experience_state_path, path.join(tmp, 'repo', 'experience-state.json'));

  const callText = (await fs.readFile(log, 'utf8'))
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line).join(' '));
  assert(callText.includes('service status --mode repo --json'), callText);
  assert(!callText.some((line) => line.includes('--mode bogus')), callText);
});

test('experience activation and id status use the same normalized state paths', async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'aos-experience-context-shared-env-'));
  const responses = baseResponses(tmp, {
    contentRoots: { toolkit: toolkitRoot },
  });
  const { fake, log } = await writeMutableFakeAos(tmp, responses);
  const env = {
    AOS_STATE_ROOT: tmp,
    AOS_PATH: fake,
    FAKE_AOS_LOG: log,
    FAKE_AOS_RESPONSES: JSON.stringify(responses),
  };

  const activate = runNode(['scripts/aos-experience.mjs', 'activate', 'runtime-context-fixture', '--json', '--allow-start'], env);
  assert.equal(activate.status, 0, `${activate.stdout}${activate.stderr}`);
  const activationPayload = JSON.parse(activate.stdout);
  assert.equal(activationPayload.active_experience, 'runtime-context-fixture');

  const expectedStatePath = path.join(tmp, 'repo', 'experience-state.json');
  assert.deepEqual(JSON.parse(await fs.readFile(expectedStatePath, 'utf8')), {
    active_experience: 'runtime-context-fixture',
    exclusive: true,
  });

  const context = runNode(['scripts/aos-experience.mjs', 'status', 'runtime-context-fixture', '--json'], env);
  assert.equal(context.status, 0, `${context.stdout}${context.stderr}`);
  const payload = JSON.parse(context.stdout);
  assert.equal(payload.runtime.state_root, tmp);
  assert.equal(payload.runtime.state_dir, path.join(tmp, 'repo'));
  assert.equal(payload.state.experience_state_path, expectedStatePath);
  assert.equal(payload.active_experience.source_path, expectedStatePath);
  assert.equal(payload.active_experience.status, 'current');
  assert.deepEqual(payload.command.argv, ['./aos', 'experience', 'status', 'runtime-context-fixture', '--json']);
  assert.equal(payload.command.argv.includes('--dry-run'), false);
  assert.equal(payload.command.argv.includes('--allow-start'), false);
});
