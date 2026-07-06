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
import {
  parseJSON as parsePendingAnnotationJSON,
  run as runPendingAnnotation,
} from './lib/pending-annotation-fixtures.mjs';

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

test('experience status counts durable pending annotation ids containing .tmp-', async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'aos-experience-context-tmp-id-record-'));
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
  const created = parsePendingAnnotationJSON(runPendingAnnotation([
    'create',
    '--id',
    'ann.tmp-final',
    '--target-kind',
    'region',
    '--target-summary',
    'Runtime context tmp id target',
    '--json',
  ], {
    AOS_STATE_ROOT: tmp,
    AOS_RUNTIME_MODE: 'repo',
  }));
  await fs.writeFile(`${created.annotation.path}.tmp-98765-abc123xy`, '{partial', 'utf8');

  const { payload } = await runContext(tmp, 'operator-fixture', baseResponses(tmp, {
    canvases: [{
      id: 'operator-fixture-surface',
      url: expectedURL,
      lifecycleState: 'active',
      suspended: false,
    }],
  }));

  assert.equal(payload.status, 'ok');
  assert.equal(payload.pending_annotations.status, 'initialized');
  assert.equal(payload.pending_annotations.record_count, 1);
  assert.equal(payload.capabilities.annotation.status, 'ready');
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
