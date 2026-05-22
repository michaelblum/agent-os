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
