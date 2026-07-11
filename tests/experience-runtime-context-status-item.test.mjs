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

async function buildContextWithStaleProjectedMenu(caseName, mutateMenu) {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), `aos-experience-context-menu-${caseName}-`));
  const tempRepoRoot = path.join(tmp, 'repo-root');
  const experiencesRoot = path.join(tmp, 'experiences');
  const stateRoot = path.join(tmp, 'state');
  const id = `projection-${caseName}`;
  const contentRootId = 'projectionroot';
  const contentRoot = path.join(tempRepoRoot, 'content-root');
  const surfaceId = 'projection-surface';
  const baseURL = `aos://${contentRootId}/runtime/index.html`;
  const baseMenu = [{
    id: 'annotate-projection-target',
    label: 'Annotate Projection Target',
    kind: 'operator_annotation',
    surface: surfaceId,
    action_id: 'aos.operator_fixture.annotation',
    mode: 'selection_annotation',
    create_pending_annotation: true,
  }];
  await fs.mkdir(contentRoot, { recursive: true });
  await writeExperienceManifestFixture({
    experiencesRoot,
    id,
    title: `Projection ${caseName}`,
    contentRootId,
    contentRootPath: 'content-root',
    surfaceId,
    expectedURL: baseURL,
    menu: baseMenu,
  });
  const staleURL = dryRunToggleURL(id, {
    AOS_STATE_ROOT: stateRoot,
    AOS_EXPERIENCES_DIR: experiencesRoot,
  });
  await writeExperienceManifestFixture({
    experiencesRoot,
    id,
    title: `Projection ${caseName}`,
    contentRootId,
    contentRootPath: 'content-root',
    surfaceId,
    expectedURL: baseURL,
    menu: mutateMenu(JSON.parse(JSON.stringify(baseMenu))),
  });
  await writeRuntimeStateFixture({
    stateRoot,
    id,
    contentRootKey: contentRootId,
    contentRootPath: contentRoot,
    surfaceId,
    expectedURL: staleURL,
  });
  await fs.mkdir(path.join(stateRoot, 'repo', 'pending-annotations', 'records'), { recursive: true });
  const responses = baseResponses(stateRoot, {
    contentRoots: { [contentRootId]: contentRoot },
    canvases: [{
      id: surfaceId,
      url: staleURL,
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
  return buildExperienceRuntimeContext(id, { env, repoRoot: tempRepoRoot });
}

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

test('experience status does not treat unrelated experience state as operator fixture success', async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'aos-experience-context-cross-app-'));
  const unrelatedURL = 'aos://toolkit/runtime/_smoke/unrelated-experience.html';
  await writeJSON(path.join(tmp, 'repo', 'experience-state.json'), {
    active_experience: 'unrelated-experience',
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
      toggle_id: 'unrelated-surface',
      toggle_url: unrelatedURL,
      toggle_track: 'union',
      icon: 'fixture',
    },
  });

  const { payload } = await runContext(tmp, 'operator-fixture', baseResponses(tmp, {
    canvases: [{
      id: 'unrelated-surface',
      url: unrelatedURL,
      lifecycleState: 'active',
    }],
  }));

  assert.equal(payload.status, 'degraded');
  assert.equal(payload.active_experience.id, 'unrelated-experience');
  assert.equal(payload.active_experience.status, 'mismatch');
  assert.equal(payload.status_item.target.status, 'wrong_surface');
  assert.equal(payload.status_item.mounted_surface.status, 'missing');
  assert.equal(payload.capabilities.annotation.status, 'degraded');
  assert(payload.recommended_next.some((item) => (
    item.id === 'activate-requested-experience'
    && item.argv.join(' ') === './aos experience activate operator-fixture --json --allow-start'
  )), payload.recommended_next);
});

test('experience status marks mounted-surface menu projection stale on full payload drift', async () => {
  const cases = [
    {
      name: 'label',
      mutateMenu(menu) {
        menu[0].label = 'Annotate Changed Label';
        return menu;
      },
    },
    {
      name: 'action-id',
      mutateMenu(menu) {
        menu[0].action_id = 'aos.operator_fixture.changed_annotation';
        return menu;
      },
    },
    {
      name: 'payload',
      mutateMenu(menu) {
        menu[0].create_pending_annotation = false;
        menu[0].mode = 'selection_review';
        return menu;
      },
    },
  ];

  for (const item of cases) {
    const payload = await buildContextWithStaleProjectedMenu(item.name, item.mutateMenu);
    assert.equal(payload.status, 'degraded', item.name);
    assert.equal(payload.status_item.target.status, 'drift', item.name);
    assert.equal(payload.status_item.mounted_surface.status, 'stale', item.name);
    assert.equal(payload.status_item.menu_projection.status, 'stale', item.name);
    assert.equal(payload.status_item.menu_projection.status_item_target.status, 'stale', item.name);
    assert.equal(payload.status_item.menu_projection.mounted_surface.status, 'stale', item.name);
    assert.deepEqual(payload.status_item.menu_projection.expected_menu_ids, ['annotate-projection-target']);
  }
});
