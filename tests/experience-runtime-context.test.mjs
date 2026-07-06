import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { buildExperienceRuntimeContext } from '../scripts/lib/experience-runtime-context.mjs';
import {
  baseResponses,
  dryRunToggleURL,
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

test('experience status id path treats placeholder state root as legacy fallback', async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'aos-experience-context-placeholder-'));
  const home = path.join(tmp, 'home');
  const stateRoot = path.join(home, '.config', 'aos');
  const expectedStatePath = path.join(stateRoot, 'repo', 'experience-state.json');
  await writeJSON(expectedStatePath, {
    active_experience: 'operator-fixture',
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
  assert.equal(JSON.parse(legacy.stdout).active_experience, 'operator-fixture');

  const context = runNode(['scripts/aos-experience.mjs', 'status', 'operator-fixture', '--json'], env);
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
    'show list --json',
  ].sort());
});

test('experience status normalizes invalid runtime mode to repo before public JSON', async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'aos-experience-context-invalid-mode-'));
  const expectedURL = dryRunToggleURL('operator-fixture', {
    AOS_STATE_ROOT: tmp,
    AOS_RUNTIME_MODE: 'bogus',
  });
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
  await fs.mkdir(path.join(tmp, 'repo', 'pending-annotations', 'records'), { recursive: true });

  const responses = baseResponses(tmp, {
    canvases: [{
      id: 'operator-fixture-surface',
      url: expectedURL,
      lifecycleState: 'active',
      suspended: false,
    }],
  });
  const { fake, log } = await writeFakeAos(tmp, responses);
  const result = runNode(['scripts/aos-experience.mjs', 'status', 'operator-fixture', '--json'], {
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
    canvases: [],
  });
  const { fake, log } = await writeMutableFakeAos(tmp, responses);
  const env = {
    AOS_STATE_ROOT: tmp,
    AOS_PATH: fake,
    FAKE_AOS_LOG: log,
    FAKE_AOS_RESPONSES: JSON.stringify(responses),
  };

  const activate = runNode(['scripts/aos-experience.mjs', 'activate', 'operator-fixture', '--json', '--allow-start'], env);
  assert.equal(activate.status, 0, `${activate.stdout}${activate.stderr}`);
  const activationPayload = JSON.parse(activate.stdout);
  assert.equal(activationPayload.active_experience, 'operator-fixture');

  const expectedStatePath = path.join(tmp, 'repo', 'experience-state.json');
  assert.deepEqual(JSON.parse(await fs.readFile(expectedStatePath, 'utf8')), {
    active_experience: 'operator-fixture',
    exclusive: true,
  });

  const context = runNode(['scripts/aos-experience.mjs', 'status', 'operator-fixture', '--json'], env);
  assert.equal(context.status, 0, `${context.stdout}${context.stderr}`);
  const payload = JSON.parse(context.stdout);
  assert.equal(payload.runtime.state_root, tmp);
  assert.equal(payload.runtime.state_dir, path.join(tmp, 'repo'));
  assert.equal(payload.state.experience_state_path, expectedStatePath);
  assert.equal(payload.active_experience.source_path, expectedStatePath);
  assert.equal(payload.active_experience.status, 'current');
});

test('experience status reports healthy operator fixture runtime context without mutation', async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'aos-experience-context-healthy-'));
  const expectedURL = dryRunToggleURL('operator-fixture', { AOS_STATE_ROOT: tmp });
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
  await fs.mkdir(path.join(tmp, 'repo', 'pending-annotations', 'records'), { recursive: true });

  const { payload, calls } = await runContext(tmp, 'operator-fixture', baseResponses(tmp, {
    canvases: [{
      id: 'operator-fixture-surface',
      url: expectedURL,
      lifecycleState: 'active',
      suspended: false,
    }],
  }));

  assert.equal(payload.schema_version, 'aos.experience-runtime-context.v0');
  assert.match(payload.collected_at, /^\d{4}-\d{2}-\d{2}T/);
  assert.equal(payload.status, 'ok');
  assert.equal(payload.experience.id, 'operator-fixture');
  assert.equal(payload.active_experience.status, 'current');
  assert.equal(payload.content_roots.status, 'current');
  assert.equal(payload.status_item.target.status, 'current');
  assert.equal(payload.status_item.mounted_surface.status, 'current');
  assert.equal(payload.status_item.menu_projection.status, 'current');
  assert.equal(payload.pending_annotations.status, 'initialized');
  assert.equal(payload.runtime.readiness.ready, true);
  assert.equal(payload.capabilities.annotation.status, 'ready');
  assert.deepEqual(payload.recommended_next, []);

  const callText = calls.map((args) => args.join(' '));
  assert.deepEqual(callText.sort(), [
    'content status --json',
    'permissions check --json',
    'service status --mode repo --json',
    'show list --json',
  ].sort());
});

test('experience status preserves degraded service status even when service is running', async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'aos-experience-context-service-degraded-'));
  const expectedURL = dryRunToggleURL('operator-fixture', { AOS_STATE_ROOT: tmp });
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
  assert.equal(payload.runtime.service.status, 'degraded');
  assert.equal(payload.runtime.service.canonical_status, 'degraded');
  assert.equal(payload.runtime.service.reason, 'log_path_mismatch');
  assert.equal(payload.runtime.service.log_path_matches_expected, false);
  assert.equal(payload.runtime.readiness.ready, false);
  assert(payload.runtime.readiness.blockers.some((item) => (
    item.id === 'service_not_ready' && item.status === 'degraded'
  )), payload.runtime.readiness);
});

test('experience status trusts canonical permission readiness over true CLI booleans', async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'aos-experience-context-permissions-degraded-'));
  const expectedURL = dryRunToggleURL('operator-fixture', { AOS_STATE_ROOT: tmp });
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
  await fs.mkdir(path.join(tmp, 'repo', 'pending-annotations', 'records'), { recursive: true });

  const { payload } = await runContext(tmp, 'operator-fixture', baseResponses(tmp, {
    canvases: [{
      id: 'operator-fixture-surface',
      url: expectedURL,
      lifecycleState: 'active',
      suspended: false,
    }],
    permissions: {
      status: 'degraded',
      ready_for_testing: false,
      ready_source: 'daemon',
      daemon_view: {
        reachable: true,
        accessibility: true,
        input_tap: {
          status: 'retrying',
          attempts: 3,
          listen_access: false,
          post_access: false,
        },
      },
      missing_permissions: ['listen_access', 'post_access'],
      notes: ['Input tap is not active.'],
    },
  }));

  assert.equal(payload.status, 'blocked');
  assert.equal(payload.runtime.permissions.status, 'degraded');
  assert.equal(payload.runtime.permissions.canonical_status, 'degraded');
  assert.equal(payload.runtime.permissions.ready_for_testing, false);
  assert.equal(payload.runtime.permissions.ready_source, 'daemon');
  assert.equal(payload.runtime.permissions.permissions.accessibility, true);
  assert.equal(payload.runtime.permissions.permissions.listen_access, true);
  assert.equal(payload.runtime.permissions.permissions.post_access, true);
  assert.equal(payload.runtime.permissions.daemon_view.input_tap.status, 'retrying');
  assert(payload.runtime.readiness.blockers.some((item) => item.id === 'permissions_not_ready'), payload.runtime.readiness);
  assert.equal(payload.capabilities.perception.status, 'blocked');
  assert.equal(payload.capabilities.annotation.status, 'degraded');
  assert.equal(payload.capabilities.saved_ref_action.status, 'blocked');
  assert(payload.capabilities.saved_ref_action.blockers.includes('permissions_not_ready'), payload.capabilities.saved_ref_action);
});

test('experience status does not treat Sigil state as operator fixture success', async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'aos-experience-context-cross-app-'));
  const sigilURL = dryRunToggleURL('sigil', { AOS_STATE_ROOT: tmp });
  await writeJSON(path.join(tmp, 'repo', 'experience-state.json'), {
    active_experience: 'sigil',
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
      toggle_id: 'avatar-main',
      toggle_url: sigilURL,
      toggle_track: 'union',
      icon: 'sigil',
    },
  });

  const { payload } = await runContext(tmp, 'operator-fixture', baseResponses(tmp, {
    canvases: [{
      id: 'avatar-main',
      url: sigilURL,
      lifecycleState: 'active',
    }],
  }));

  assert.equal(payload.status, 'degraded');
  assert.equal(payload.active_experience.id, 'sigil');
  assert.equal(payload.active_experience.status, 'mismatch');
  assert.equal(payload.status_item.target.status, 'wrong_surface');
  assert.equal(payload.status_item.mounted_surface.status, 'missing');
  assert.equal(payload.capabilities.annotation.status, 'degraded');
  assert(payload.recommended_next.some((item) => (
    item.id === 'activate-requested-experience'
    && item.argv.join(' ') === './aos experience activate operator-fixture --json --allow-start'
  )), payload.recommended_next);
});

test('experience status omits pending annotation store internals for non-annotation fixtures', async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'aos-experience-context-no-annotation-'));
  const tempRepoRoot = path.join(tmp, 'repo-root');
  const experiencesRoot = path.join(tmp, 'experiences');
  const stateRoot = path.join(tmp, 'state');
  const id = 'non-annotation-fixture';
  const contentRoot = path.join(tempRepoRoot, 'content-root');
  const expectedURL = 'aos://plain/runtime/index.html';
  await fs.mkdir(contentRoot, { recursive: true });
  await writeExperienceManifestFixture({
    experiencesRoot,
    id,
    title: 'Non Annotation Fixture',
    contentRootId: 'plainroot',
    contentRootPath: 'content-root',
    surfaceId: 'plain-surface',
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
    surfaceId: 'plain-surface',
    expectedURL,
  });
  await fs.writeFile(path.join(stateRoot, 'repo', 'pending-annotations'), 'corrupt if inspected\n', 'utf8');

  const responses = baseResponses(stateRoot, {
    contentRoots: { plainroot: contentRoot },
    canvases: [{
      id: 'plain-surface',
      url: expectedURL,
      lifecycleState: 'active',
      suspended: false,
    }],
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
  assert.equal(payload.status, 'ok');
  assert.deepEqual(payload.pending_annotations, {
    status: 'not_applicable',
    supported: false,
  });
  for (const key of ['root', 'records_dir', 'index_path', 'lock', 'root_status', 'records_status', 'index_status', 'record_count']) {
    assert.equal(Object.hasOwn(payload.pending_annotations, key), false, key);
  }
  assert.equal(Object.hasOwn(payload.state, 'pending_annotations_root'), false);
  assert.equal(payload.capabilities.annotation.status, 'unsupported');
  assert.deepEqual(payload.capabilities.annotation.blockers, []);
  assert(!payload.diagnostics.some((item) => item.id.startsWith('pending-annotation')), payload.diagnostics);

  const callText = (await fs.readFile(log, 'utf8'))
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line).join(' '));
  assert.deepEqual(callText.sort(), [
    'content status --json',
    'permissions check --json',
    'service status --mode repo --json',
    'show list --json',
  ].sort());
});

test('experience status reports stale target, missing content root, and uninitialized pending state', async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'aos-experience-context-drift-'));
  await writeJSON(path.join(tmp, 'repo', 'experience-state.json'), {
    active_experience: 'operator-fixture',
    exclusive: true,
  });
  await writeJSON(path.join(tmp, 'repo', 'config.json'), {
    content: {
      roots: {
        toolkit: path.join(tmp, 'stale-toolkit'),
      },
    },
    status_item: {
      enabled: true,
      toggle_id: 'operator-fixture-surface',
      toggle_url: 'aos://toolkit/runtime/_smoke/stale.html',
      toggle_track: 'union',
      icon: 'aos',
    },
  });

  const { payload } = await runContext(tmp, 'operator-fixture', baseResponses(tmp, {
    contentRoots: {},
    canvases: [{
      id: 'operator-fixture-surface',
      url: 'aos://toolkit/runtime/_smoke/stale.html',
      lifecycleState: 'active',
    }],
  }));

  assert.equal(payload.status, 'degraded');
  assert.equal(payload.content_roots.roots[0].configured_status, 'stale');
  assert.equal(payload.content_roots.roots[0].live_status, 'missing');
  assert.equal(payload.status_item.target.status, 'drift');
  assert.equal(payload.status_item.mounted_surface.status, 'stale');
  assert.equal(payload.pending_annotations.status, 'not_initialized');
  assert(payload.recommended_next.some((item) => item.id === 'activate-requested-experience'));
  assert(payload.recommended_next.some((item) => item.id === 'remove-stale-mounted-surface'));
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
    surfaceId: 'repair-root-surface',
    expectedURL,
  });
  const responses = baseResponses(stateRoot, {
    contentRoots: {},
    canvases: [{
      id: 'repair-root-surface',
      url: expectedURL,
      lifecycleState: 'active',
      suspended: false,
    }],
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

test('experience status blocks corrupt pending state and reports passive readiness blockers', async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'aos-experience-context-corrupt-'));
  const expectedURL = dryRunToggleURL('operator-fixture', { AOS_STATE_ROOT: tmp });
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
  await fs.mkdir(path.join(tmp, 'repo'), { recursive: true });
  await fs.writeFile(path.join(tmp, 'repo', 'pending-annotations'), 'not a directory\n', 'utf8');

  const { payload } = await runContext(tmp, 'operator-fixture', baseResponses(tmp, {
    canvases: [{
      id: 'operator-fixture-surface',
      url: expectedURL,
      lifecycleState: 'active',
    }],
    service: {
      status: 'degraded',
      running: false,
      pid: null,
      notes: ['Service is not running.'],
    },
    permissions: {
      permissions: {
        screen_recording: false,
      },
      missing_permissions: ['screen_recording'],
      ready_for_testing: false,
      notes: ['Screen Recording permission is not granted.'],
    },
  }));

  assert.equal(payload.status, 'blocked');
  assert.equal(payload.pending_annotations.status, 'corrupt');
  assert.equal(payload.runtime.readiness.ready, false);
  assert(payload.runtime.readiness.blockers.some((item) => item.id === 'service_not_ready'), payload.runtime.readiness);
  assert(payload.runtime.readiness.blockers.some((item) => item.id === 'permission:screen_recording'), payload.runtime.readiness);
  assert.equal(payload.capabilities.perception.status, 'blocked');
  assert.equal(payload.capabilities.evidence_handoff.status, 'blocked');
  assert(payload.recommended_next.some((item) => item.id === 'check-runtime-readiness'));
  assert(payload.recommended_next.some((item) => item.id === 'permissions-setup'));
});

test('experience status blocks annotation capability on corrupt pending record', async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'aos-experience-context-corrupt-record-'));
  const expectedURL = dryRunToggleURL('operator-fixture', { AOS_STATE_ROOT: tmp });
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
  assert.equal(payload.pending_annotations.status, 'corrupt');
  assert.equal(payload.pending_annotations.records_status, 'corrupt');
  assert.equal(payload.pending_annotations.records_error_storage_status, 'corrupt_json');
  assert.equal(payload.pending_annotations.record_count, 0);
  assert.equal(payload.pending_annotations.records_error_path, corruptRecordPath);
  assert.equal(payload.capabilities.annotation.status, 'blocked');
  assert(payload.capabilities.annotation.blockers.includes('pending_annotation_state_corrupt'), payload.capabilities.annotation);
  assert.equal(payload.capabilities.evidence_handoff.status, 'blocked');
  assert(payload.diagnostics.some((item) => item.id === 'pending-annotation-state-corrupt'), payload.diagnostics);
});

test('experience status reports symlinked pending index through store-owned status without mutation', async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'aos-experience-context-index-symlink-'));
  const outside = await fs.mkdtemp(path.join(os.tmpdir(), 'aos-experience-context-index-outside-'));
  const expectedURL = dryRunToggleURL('operator-fixture', { AOS_STATE_ROOT: tmp });
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
  const pendingRoot = path.join(tmp, 'repo', 'pending-annotations');
  await fs.mkdir(path.join(pendingRoot, 'records'), { recursive: true });
  const outsideIndex = path.join(outside, 'index.json');
  await writeJSON(outsideIndex, {
    schema_version: 'aos.pending-annotation.v0',
    runtime_mode: 'repo',
    state_root: tmp,
    created_at: '2026-07-06T00:00:00Z',
    updated_at: '2026-07-06T00:00:00Z',
    annotations: [],
  });
  await fs.symlink(outsideIndex, path.join(pendingRoot, 'index.json'));

  const { payload, calls } = await runContext(tmp, 'operator-fixture', baseResponses(tmp, {
    canvases: [{
      id: 'operator-fixture-surface',
      url: expectedURL,
      lifecycleState: 'active',
      suspended: false,
    }],
  }));

  assert.equal(payload.status, 'blocked');
  assert.equal(payload.pending_annotations.status, 'corrupt');
  assert.equal(payload.pending_annotations.index_status, 'symlink');
  assert.equal(payload.pending_annotations.index_error_storage_status, 'symlink');
  assert.equal(payload.pending_annotations.index_error_path_status, 'symlink');
  assert.equal(payload.capabilities.evidence_handoff.status, 'blocked');
  assert(payload.diagnostics.some((item) => item.id === 'pending-annotation-state-corrupt'), payload.diagnostics);

  const callText = calls.map((args) => args.join(' '));
  assert.deepEqual(callText.sort(), [
    'content status --json',
    'permissions check --json',
    'service status --mode repo --json',
    'show list --json',
  ].sort());
});

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
    surfaceId: 'cwd-root-surface',
    expectedURL,
  });

  const responses = baseResponses(stateRoot, {
    contentRoots: { cwdroot: contentRoot },
    canvases: [{
      id: 'cwd-root-surface',
      url: expectedURL,
      lifecycleState: 'active',
      suspended: false,
    }],
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
    'show list --json',
  ].sort());
  assert.deepEqual([...new Set(calls.map((entry) => entry.cwd))], [expectedCwd]);
});

test('experience status hard-bounds passive AOS probes that ignore SIGTERM', async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'aos-experience-context-timeout-'));
  const expectedURL = dryRunToggleURL('operator-fixture', { AOS_STATE_ROOT: tmp });
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
  await fs.mkdir(path.join(tmp, 'repo', 'pending-annotations', 'records'), { recursive: true });

  const { fake, log } = await writeSigtermIgnoringFakeAos(tmp);
  const startedAt = Date.now();
  const result = runNode(['scripts/aos-experience.mjs', 'status', 'operator-fixture', '--json'], {
    AOS_STATE_ROOT: tmp,
    AOS_PATH: fake,
    AOS_EXPERIENCE_RUNTIME_PROBE_TIMEOUT_MS: '300',
    AOS_EXPERIENCE_RUNTIME_PROBE_KILL_GRACE_MS: '50',
    FAKE_AOS_LOG: log,
  });
  const elapsedMs = Date.now() - startedAt;

  assert.equal(result.status, 0, `${result.stdout}${result.stderr}`);
  assert(elapsedMs < 3000, `status took ${elapsedMs}ms`);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.runtime.service.command_status, 'timeout');
  assert.equal(payload.runtime.permissions.command_status, 'timeout');
  assert.equal(payload.content_roots.command_status, 'timeout');
  assert.equal(payload.status_item.mounted_surface.show_list_status, 'timeout');
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
    'show list --json',
  ].sort());
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
    surfaceId: 'file-root-surface',
    expectedURL,
  });
  const responses = baseResponses(stateRoot, {
    contentRoots: { badroot: rootFile },
    canvases: [{
      id: 'file-root-surface',
      url: expectedURL,
      lifecycleState: 'active',
      suspended: false,
    }],
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
