import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { test } from 'node:test';

const repoRoot = resolve(new URL('..', import.meta.url).pathname);
const scriptPath = join(repoRoot, 'scripts', 'afk-session-trigger-prototype.mjs');
const fixedTimestamp = '2026-05-22T20:00:00.000Z';

function runPrototype(args) {
  return spawnSync(process.execPath, [scriptPath, ...args], {
    cwd: repoRoot,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

async function writePacket(packet) {
  const dir = await mkdtemp(join(tmpdir(), 'afk-session-trigger-packet-'));
  const packetPath = join(dir, 'packet.json');
  await writeFile(packetPath, `${JSON.stringify(packet, null, 2)}\n`, 'utf8');
  return packetPath;
}

function validPacket(overrides = {}) {
  return {
    packet_id: 'manual-afk-session-trigger-test',
    source_artifact: 'docs/design/work-cards/afk-dev-session-trigger-dry-run-command-v0.md',
    requested_recipient: 'gdi',
    cwd: repoRoot,
    worktree: repoRoot,
    required_start_ref: 'docs/durable-agent-cognition-v0',
    provider_hint: 'codex',
    result_route: [
      {
        kind: 'local_artifact_path',
        ref: 'stdout',
      },
    ],
    external_publication_policy: 'local-only',
    goal: 'create dry-run scheduler and dispatch intent receipt',
    ...overrides,
  };
}

test('creates a dry-run-ready scheduler and dispatch receipt without launch side effects', async () => {
  const packetPath = await writePacket(validPacket());
  const result = runPrototype([
    '--packet',
    packetPath,
    '--provider',
    'codex',
    '--dock',
    'gdi',
    '--dry-run',
    '--json',
    '--timestamp',
    fixedTimestamp,
    '--idempotence-salt',
    'stable-test',
  ]);

  assert.equal(result.status, 0, result.stderr);
  const receipt = JSON.parse(result.stdout);
  assert.equal(receipt.record_type, 'aos.afk_session_trigger_dry_run');
  assert.equal(receipt.schema_status, 'not_a_schema');
  assert.equal(receipt.status, 'dry_run_ready');
  assert.equal(receipt.created_at, fixedTimestamp);
  assert.equal(receipt.packet.packet_id, 'manual-afk-session-trigger-test');
  assert.equal(receipt.packet.source_artifact, 'docs/design/work-cards/afk-dev-session-trigger-dry-run-command-v0.md');
  assert.equal(receipt.packet.validation_status, 'valid');
  assert.match(receipt.scheduler.scheduler_run_id, /^scheduler-[a-f0-9]{16}$/);
  assert.match(receipt.scheduler.idempotence_key, /^[a-f0-9]{32}$/);
  assert.equal(receipt.scheduler.lifecycle_state, 'accepted');
  assert.equal(receipt.scheduler.selected_action, 'dry-run');
  assert.equal(receipt.scheduler.lease, 'not_enforced');
  assert.match(receipt.dispatch.dispatch_attempt_id, /^dispatch-[a-f0-9]{16}$/);
  assert.equal(receipt.dispatch.selected_provider, 'codex');
  assert.equal(receipt.dispatch.selected_dock, 'gdi');
  assert.equal(receipt.dispatch.dock_profile_ref, '.docks/gdi/dock.json');
  assert.equal(receipt.dispatch.launch_root, '.docks/gdi');
  assert.equal(receipt.dispatch.action, 'dry-run');
  assert.equal(receipt.dispatch.provider_launch_allowed, false);
  assert.deepEqual(receipt.terminal_substrate, {
    status: 'not_attempted',
    reason: 'dry-run-only',
  });
  assert.equal(receipt.result_route.status, 'not_attempted');
  assert.deepEqual(receipt.result_route.refs, [{ kind: 'local_artifact_path', ref: 'stdout' }]);
  assert.deepEqual(receipt.mismatches, []);
});

test('rejects invalid current-state facts with named mismatch classes', async () => {
  const packetPath = await writePacket(validPacket({
    source_artifact: 'docs/design/work-cards/no-such-card.md',
    requested_recipient: 'no-such-dock',
    provider_hint: 'not-a-provider',
    required_start_ref: 'no-such-ref',
    result_route: undefined,
  }));
  const result = runPrototype([
    '--packet',
    packetPath,
    '--dry-run',
    '--json',
    '--timestamp',
    fixedTimestamp,
  ]);

  assert.equal(result.status, 1);
  const receipt = JSON.parse(result.stdout);
  assert.equal(receipt.status, 'rejected');
  assert.equal(receipt.packet.validation_status, 'invalid');
  const mismatchClasses = new Set(receipt.mismatches.map((item) => item.class));
  assert.ok(mismatchClasses.has('missing_source_artifact'), receipt.mismatches);
  assert.ok(mismatchClasses.has('unknown_dock'), receipt.mismatches);
  assert.ok(mismatchClasses.has('provider_unsupported'), receipt.mismatches);
  assert.ok(mismatchClasses.has('required_start_ref_unresolved'), receipt.mismatches);
  assert.ok(mismatchClasses.has('result_route_missing'), receipt.mismatches);
});

test('writes the same dry-run receipt to --out', async () => {
  const packetPath = await writePacket(validPacket());
  const dir = await mkdtemp(join(tmpdir(), 'afk-session-trigger-out-'));
  const outPath = join(dir, 'receipt.json');
  const result = runPrototype([
    '--packet',
    packetPath,
    '--provider',
    'codex',
    '--dock',
    'gdi',
    '--dry-run',
    '--json',
    '--timestamp',
    fixedTimestamp,
    '--out',
    outPath,
  ]);

  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(await readFile(outPath, 'utf8')), JSON.parse(result.stdout));
});

test('creates a guarded supervised-live Codex receipt without launching provider work', async () => {
  const packetPath = await writePacket(validPacket());
  const result = runPrototype([
    '--packet',
    packetPath,
    '--provider',
    'codex',
    '--dock',
    'gdi',
    '--supervised-live-launch',
    '--i-am-present',
    '--json',
    '--timestamp',
    fixedTimestamp,
    '--idempotence-salt',
    'stable-live-test',
  ]);

  assert.equal(result.status, 0, result.stderr);
  const receipt = JSON.parse(result.stdout);
  assert.equal(receipt.record_type, 'aos.afk_session_trigger_supervised_live');
  assert.equal(receipt.schema_status, 'not_a_schema');
  assert.equal(receipt.status, 'supervised_live_launch_ready');
  assert.equal(receipt.packet.validation_status, 'valid');
  assert.equal(receipt.scheduler.selected_action, 'supervised-live-launch');
  assert.equal(receipt.scheduler.lifecycle_state, 'accepted_pre_launch');
  assert.match(receipt.scheduler.idempotence_key, /^[a-f0-9]{32}$/);
  assert.equal(receipt.dispatch.selected_provider, 'codex');
  assert.equal(receipt.dispatch.selected_dock, 'gdi');
  assert.equal(receipt.dispatch.launch_root, '.docks/gdi');
  assert.equal(receipt.dispatch.provider_launch_allowed, true);
  assert.deepEqual(receipt.dispatch.human_supervision, { required: true, i_am_present: true });
  assert.deepEqual(receipt.terminal_substrate, {
    status: 'not_attempted',
    reason: 'guarded-source-slice-no-live-provider',
  });
  assert.equal(receipt.provider_acceptance.status, 'not_attempted');
  assert.deepEqual(receipt.cleanup, {
    owner: 'afk-session-trigger-prototype',
    status: 'not_attempted',
    proof: 'not_attempted',
    reason: 'guarded-source-slice-no-live-provider',
  });
  assert.equal(receipt.codex_adapter.status, 'not_attempted');
  assert.equal(receipt.catalog.status, 'not_attempted');
  assert.equal(receipt.telemetry.status, 'not_attempted');
  assert.equal(receipt.result_route.status, 'not_attempted');
  assert.equal(receipt.work_receipt.status, 'not_attempted');
  assert.equal(receipt.evidence.transcript_body_copied, false);
  assert.deepEqual(receipt.mismatches, []);
});

test('rejects supervised-live pre-launch guard failures before side effects', async () => {
  const packetPath = await writePacket(validPacket());
  const result = runPrototype([
    '--packet',
    packetPath,
    '--provider',
    'claude',
    '--dock',
    'operator',
    '--supervised-live-launch',
    '--timestamp',
    fixedTimestamp,
  ]);

  assert.equal(result.status, 1);
  const receipt = JSON.parse(result.stdout);
  assert.equal(receipt.record_type, 'aos.afk_session_trigger_supervised_live');
  assert.equal(receipt.status, 'rejected');
  assert.equal(receipt.dispatch.provider_launch_allowed, false);
  assert.equal(receipt.terminal_substrate.status, 'not_attempted');
  assert.deepEqual(new Set(receipt.mismatches.map((item) => item.class)), new Set([
    'human_presence_required',
    'json_required_for_supervised_live',
    'provider_unsupported_for_supervised_live',
    'dock_mismatch_for_supervised_live',
  ]));
});

test('rejects ambiguous or conflicting live launch flags', async () => {
  const packetPath = await writePacket(validPacket());
  const alias = runPrototype([
    '--packet',
    packetPath,
    '--provider',
    'codex',
    '--dock',
    'gdi',
    '--live',
    '--json',
  ]);
  assert.equal(alias.status, 1);
  assert.match(alias.stderr, /Unexpected|Unknown|Missing value|live/);

  const conflicting = runPrototype([
    '--packet',
    packetPath,
    '--provider',
    'codex',
    '--dock',
    'gdi',
    '--dry-run',
    '--supervised-live-launch',
    '--i-am-present',
    '--json',
  ]);
  assert.equal(conflicting.status, 1);
  const receipt = JSON.parse(conflicting.stdout);
  assert.equal(receipt.status, 'rejected');
  assert.ok(receipt.mismatches.some((item) => item.class === 'conflicting_action_flags'));
});

test('returns duplicate state from a receipt-backed supervised-live attempt', async () => {
  const packetPath = await writePacket(validPacket());
  const baseArgs = [
    '--packet',
    packetPath,
    '--provider',
    'codex',
    '--dock',
    'gdi',
    '--supervised-live-launch',
    '--i-am-present',
    '--json',
    '--timestamp',
    fixedTimestamp,
    '--idempotence-salt',
    'duplicate-live-test',
  ];
  const first = runPrototype(baseArgs);
  assert.equal(first.status, 0, first.stderr);
  const firstReceipt = JSON.parse(first.stdout);
  const dir = await mkdtemp(join(tmpdir(), 'afk-session-trigger-existing-'));
  const existingPath = join(dir, 'existing.json');
  await writeFile(existingPath, `${JSON.stringify({
    record_type: 'aos.afk_session_trigger_supervised_live',
    scheduler: {
      idempotence_key: firstReceipt.scheduler.idempotence_key,
      lifecycle_state: 'running',
    },
  }, null, 2)}\n`, 'utf8');

  const duplicate = runPrototype([...baseArgs, '--existing-receipt', existingPath]);
  assert.equal(duplicate.status, 0, duplicate.stderr);
  const receipt = JSON.parse(duplicate.stdout);
  assert.equal(receipt.status, 'duplicate');
  assert.equal(receipt.scheduler.lifecycle_state, 'duplicate');
  assert.equal(receipt.scheduler.duplicate_handling.duplicate, true);
  assert.equal(receipt.scheduler.duplicate_handling.reused_state, true);
  assert.equal(receipt.dispatch.provider_launch_allowed, false);
});

test('treats accepted live receipt states as non-launching duplicates', async () => {
  const packetPath = await writePacket(validPacket());
  const baseArgs = [
    '--packet',
    packetPath,
    '--provider',
    'codex',
    '--dock',
    'gdi',
    '--supervised-live-launch',
    '--i-am-present',
    '--json',
    '--timestamp',
    fixedTimestamp,
    '--idempotence-salt',
    'accepted-live-duplicate-test',
  ];
  const first = runPrototype(baseArgs);
  assert.equal(first.status, 0, first.stderr);
  const firstReceipt = JSON.parse(first.stdout);
  const dir = await mkdtemp(join(tmpdir(), 'afk-session-trigger-live-states-'));

  for (const state of ['terminal_started', 'provider_acceptance_unobserved', 'provider_session_observed', 'completed', 'running']) {
    const existingPath = join(dir, `${state}.json`);
    await writeFile(existingPath, `${JSON.stringify({
      scheduler: {
        idempotence_key: firstReceipt.scheduler.idempotence_key,
        lifecycle_state: state,
      },
    }, null, 2)}\n`, 'utf8');

    const duplicate = runPrototype([...baseArgs, '--existing-receipt', existingPath]);
    assert.equal(duplicate.status, 0, `${state}: ${duplicate.stderr}`);
    const receipt = JSON.parse(duplicate.stdout);
    assert.equal(receipt.status, 'duplicate', state);
    assert.equal(receipt.scheduler.lifecycle_state, 'duplicate', state);
    assert.equal(receipt.scheduler.duplicate_handling.duplicate, true, state);
    assert.equal(receipt.scheduler.duplicate_handling.existing_state, state);
    assert.equal(receipt.scheduler.duplicate_handling.reused_state, true, state);
    assert.equal(receipt.dispatch.provider_launch_allowed, false, state);
  }
});

test('blocks relaunch after rejected or failed receipt unless replacement is explicit', async () => {
  const packetPath = await writePacket(validPacket());
  const baseArgs = [
    '--packet',
    packetPath,
    '--provider',
    'codex',
    '--dock',
    'gdi',
    '--supervised-live-launch',
    '--i-am-present',
    '--json',
    '--timestamp',
    fixedTimestamp,
    '--idempotence-salt',
    'blocked-live-test',
  ];
  const first = runPrototype(baseArgs);
  assert.equal(first.status, 0, first.stderr);
  const firstReceipt = JSON.parse(first.stdout);
  const dir = await mkdtemp(join(tmpdir(), 'afk-session-trigger-rejected-'));
  for (const state of ['rejected', 'failed']) {
    const existingPath = join(dir, `${state}.json`);
    await writeFile(existingPath, `${JSON.stringify({
      scheduler: {
        idempotence_key: firstReceipt.scheduler.idempotence_key,
        lifecycle_state: state,
      },
    }, null, 2)}\n`, 'utf8');

    const blocked = runPrototype([...baseArgs, '--existing-receipt', existingPath]);
    assert.equal(blocked.status, 1, state);
    const receipt = JSON.parse(blocked.stdout);
    assert.equal(receipt.status, 'blocked', state);
    assert.equal(receipt.dispatch.provider_launch_allowed, false, state);
    assert.equal(receipt.scheduler.duplicate_handling.relaunch_requires_replacement, true, state);
    assert.ok(receipt.mismatches.some((item) => item.class === 'replacement_required_for_prior_attempt'), state);
  }
});

test('classifies deterministic cleanup proof failure as cleanup_unverified without launch mutation', async () => {
  const packetPath = await writePacket(validPacket());
  const dir = await mkdtemp(join(tmpdir(), 'afk-session-trigger-cleanup-'));
  const cleanupFixture = join(dir, 'cleanup.json');
  await writeFile(cleanupFixture, `${JSON.stringify({
    status: 'missing',
    proof: [],
    reason: 'test fixture intentionally omits cleanup proof',
  }, null, 2)}\n`, 'utf8');

  const result = runPrototype([
    '--packet',
    packetPath,
    '--provider',
    'codex',
    '--dock',
    'gdi',
    '--supervised-live-launch',
    '--i-am-present',
    '--json',
    '--timestamp',
    fixedTimestamp,
    '--cleanup-proof-fixture',
    cleanupFixture,
  ]);

  assert.equal(result.status, 1);
  const receipt = JSON.parse(result.stdout);
  assert.equal(receipt.status, 'cleanup_unverified');
  assert.equal(receipt.scheduler.lifecycle_state, 'rejected');
  assert.equal(receipt.dispatch.provider_launch_allowed, false);
  assert.equal(receipt.terminal_substrate.status, 'not_attempted');
  assert.equal(receipt.provider_acceptance.status, 'not_attempted');
  assert.equal(receipt.catalog.status, 'not_attempted');
  assert.equal(receipt.evidence.transcript_body_copied, false);
  assert.equal(receipt.cleanup.owner, 'afk-session-trigger-prototype');
  assert.equal(receipt.cleanup.status, 'cleanup_unverified');
  assert.deepEqual(receipt.cleanup.proof, []);
  assert.ok(receipt.mismatches.some((item) => item.class === 'cleanup_unverified'));
});
