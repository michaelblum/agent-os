import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  baseResponses,
  dryRunToggleURL,
  readFakeAosCalls,
  runNode,
  toolkitRoot,
  writeFakeAos,
  writeRuntimeStateFixture,
} from './lib/experience-runtime-fixtures.mjs';

async function assertParserFailure(args, code) {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'aos-experience-menu-parser-'));
  const { fake, log } = await writeFakeAos(tmp);
  const result = runNode(args, {
    AOS_STATE_ROOT: tmp,
    AOS_PATH: fake,
    FAKE_AOS_LOG: log,
    FAKE_AOS_RESPONSES: JSON.stringify({}),
  });

  assert.notEqual(result.status, 0);
  assert.equal(result.stdout, '');
  assert.equal(JSON.parse(result.stderr).code, code);
  assert.deepEqual(await readFakeAosCalls(log), []);
}

test('experience menu invoke dry-run resolves projected status-item action', async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'aos-experience-menu-dry-run-'));
  const expectedURL = dryRunToggleURL('operator-fixture', { AOS_STATE_ROOT: tmp });
  await writeRuntimeStateFixture({
    stateRoot: tmp,
    id: 'operator-fixture',
    contentRootKey: 'toolkit',
    contentRootPath: toolkitRoot,
    surfaceId: 'operator-fixture-surface',
    expectedURL,
  });
  const { fake, log } = await writeFakeAos(tmp);
  const responses = baseResponses(tmp, {
    canvases: [{
      id: 'operator-fixture-surface',
      url: expectedURL,
      lifecycleState: 'active',
      suspended: false,
    }],
  });
  const result = runNode([
    'scripts/aos-experience.mjs',
    'menu',
    'invoke',
    'operator-fixture',
    '--item',
    'annotate-visible-target',
    '--dry-run',
    '--json',
  ], {
    AOS_STATE_ROOT: tmp,
    AOS_PATH: fake,
    FAKE_AOS_LOG: log,
    FAKE_AOS_RESPONSES: JSON.stringify(responses),
  });

  assert.equal(result.status, 0, `${result.stdout}${result.stderr}`);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.status, 'dry_run');
  assert.equal(payload.dry_run, true);
  assert.equal(payload.experience.id, 'operator-fixture');
  assert.equal(payload.status_item.surface_id, 'operator-fixture-surface');
  assert.equal(payload.status_item.menu_item_id, 'annotate-visible-target');
  assert.equal(payload.status_item.action_id, 'aos.operator_fixture.annotation');
  assert.equal(payload.event.type, 'status_item.menu_action');
  assert.equal(payload.event.id, 'aos.operator_fixture.annotation');
  assert.equal(payload.event.action_id, 'aos.operator_fixture.annotation');
  assert.equal(payload.event.menu_item_id, 'annotate-visible-target');
  assert.equal(payload.event.experience_id, 'operator-fixture');
  assert.equal(payload.runtime_context.status, 'ok');
  assert.equal(payload.runtime_context.active_experience.status, 'current');
  assert.equal(payload.runtime_context.status_item.status, 'current');
  assert.equal(payload.runtime_context.status_item.mounted_surface.status, 'current');
  assert.equal(payload.runtime_context.status_item.menu_projection.status, 'current');
  const calls = await readFakeAosCalls(log);
  assert.equal(calls.some((args) => args[0] === 'show' && args[1] === 'post'), false);
});

test('experience menu invoke dry-run fails closed when mounted runtime is not current', async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'aos-experience-menu-dry-run-stale-'));
  const { fake, log } = await writeFakeAos(tmp);
  const result = runNode([
    'scripts/aos-experience.mjs',
    'menu',
    'invoke',
    'operator-fixture',
    '--item',
    'annotate-visible-target',
    '--dry-run',
    '--json',
  ], {
    AOS_STATE_ROOT: tmp,
    AOS_PATH: fake,
    FAKE_AOS_LOG: log,
    FAKE_AOS_RESPONSES: JSON.stringify(baseResponses(tmp)),
  });

  assert.notEqual(result.status, 0);
  assert.equal(result.stdout, '');
  const payload = JSON.parse(result.stderr);
  assert.equal(payload.code, 'STATUS_MENU_RUNTIME_NOT_CURRENT');
  assert.match(payload.error, /active_experience=mismatch/);
  assert.match(payload.error, /mounted_surface=missing/);
  assert.match(payload.error, /menu_projection=missing/);
  const calls = await readFakeAosCalls(log);
  assert.equal(calls.some((args) => args[0] === 'show' && args[1] === 'post'), false);
});

test('experience menu invoke posts exact status-item action to mounted surface', async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'aos-experience-menu-live-'));
  const expectedURL = dryRunToggleURL('operator-fixture', { AOS_STATE_ROOT: tmp });
  await writeRuntimeStateFixture({
    stateRoot: tmp,
    id: 'operator-fixture',
    contentRootKey: 'toolkit',
    contentRootPath: toolkitRoot,
    surfaceId: 'operator-fixture-surface',
    expectedURL,
  });
  const { fake, log } = await writeFakeAos(tmp);
  const expectedEvent = {
    type: 'status_item.menu_action',
    id: 'aos.operator_fixture.annotation',
    action_id: 'aos.operator_fixture.annotation',
    menu_item_id: 'annotate-visible-target',
    source: 'status_item',
    invoked_by: 'aos.experience.menu.invoke',
    experience_id: 'operator-fixture',
    origin_x: null,
    origin_y: null,
    modifiers: [],
  };
  const responses = {
    ...baseResponses(tmp, {
      canvases: [{
        id: 'operator-fixture-surface',
        url: expectedURL,
        lifecycleState: 'active',
        suspended: false,
      }],
    }),
    [`show post --id operator-fixture-surface --event ${JSON.stringify(expectedEvent)}`]: {
      value: { status: 'success' },
    },
  };

  const result = runNode([
    'scripts/aos-experience.mjs',
    'menu',
    'invoke',
    'operator-fixture',
    '--item',
    'aos.operator_fixture.annotation',
    '--json',
  ], {
    AOS_STATE_ROOT: tmp,
    AOS_PATH: fake,
    FAKE_AOS_LOG: log,
    FAKE_AOS_RESPONSES: JSON.stringify(responses),
  });

  assert.equal(result.status, 0, `${result.stdout}${result.stderr}`);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.status, 'success');
  assert.equal(payload.dry_run, false);
  assert.equal(payload.status_item.menu_item_id, 'annotate-visible-target');
  assert.equal(payload.status_item.action_id, 'aos.operator_fixture.annotation');
  assert.equal(payload.runtime_context.status, 'ok');
  const calls = await readFakeAosCalls(log);
  assert.equal(calls.filter((args) => args[0] === 'show' && args[1] === 'post').length, 1);
  assert.deepEqual(calls.at(-1), [
    'show',
    'post',
    '--id',
    'operator-fixture-surface',
    '--event',
    JSON.stringify(expectedEvent),
  ]);
});

test('experience menu invoke fails closed for unknown status-item menu item', async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'aos-experience-menu-missing-'));
  const { fake, log } = await writeFakeAos(tmp);
  const result = runNode([
    'scripts/aos-experience.mjs',
    'menu',
    'invoke',
    'operator-fixture',
    '--item',
    'missing-action',
    '--dry-run',
    '--json',
  ], {
    AOS_STATE_ROOT: tmp,
    AOS_PATH: fake,
    FAKE_AOS_LOG: log,
    FAKE_AOS_RESPONSES: JSON.stringify({}),
  });

  assert.notEqual(result.status, 0);
  assert.equal(result.stdout, '');
  assert.equal(JSON.parse(result.stderr).code, 'MENU_ITEM_NOT_FOUND');
  assert.deepEqual(await readFakeAosCalls(log), []);
});

test('experience menu invoke rejects malformed parser shapes before AOS calls', async () => {
  await assertParserFailure([
    'scripts/aos-experience.mjs',
    'menu',
    'invoke',
    '--item',
    'annotate-visible-target',
    '--json',
  ], 'MISSING_ARG');

  await assertParserFailure([
    'scripts/aos-experience.mjs',
    'menu',
    'invoke',
    'operator-fixture',
    '--json',
  ], 'MISSING_ARG');

  await assertParserFailure([
    'scripts/aos-experience.mjs',
    'menu',
    'preview',
    'operator-fixture',
    '--json',
  ], 'MISSING_SUBCOMMAND');

  await assertParserFailure([
    'scripts/aos-experience.mjs',
    'menu',
    'invoke',
    'operator-fixture',
    '--item',
    'annotate-visible-target',
    '--bogus',
  ], 'UNKNOWN_FLAG');
});
