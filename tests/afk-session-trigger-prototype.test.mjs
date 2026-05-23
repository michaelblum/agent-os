import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
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

async function writeJsonFixture(prefix, name, value) {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  const fixturePath = join(dir, name);
  await writeFile(fixturePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  return fixturePath;
}

async function writeBridgeVisibilityFixture(providerSessionId = '019e5107-5456-7f22-b08b-b977df1b35f4') {
  const overrides = typeof providerSessionId === 'object' && providerSessionId !== null ? providerSessionId : {};
  const sessionId = typeof providerSessionId === 'string'
    ? providerSessionId
    : (overrides.providerSessionId ?? '019e5107-5456-7f22-b08b-b977df1b35f4');
  return writeJsonFixture('afk-session-trigger-bridge-', 'bridge.json', {
    response_marker: 'live-codex-session-trigger-supervised-bridge-launch',
    bridge: {
      supervised_live: true,
      health: {
        ok: true,
        defaultSession: 'afk-session-trigger-supervised-bridge-launch',
        defaultCwd: join(repoRoot, '.docks/gdi'),
        driver: 'process',
        terminal: { cols: 80, rows: 24 },
      },
      ensure: {
        ok: true,
        session: 'afk-session-trigger-supervised-bridge-launch',
        cwd: join(repoRoot, '.docks/gdi'),
        created: true,
        driver: 'process',
      },
      command: 'codex --no-alt-screen',
      resize: {
        cols: 100,
        rows: 31,
        resize_accepted: true,
        terminal: { cols: 100, rows: 31 },
      },
      input: {
        driver: 'process',
        session_exists: true,
        text_bytes: 120,
        text_accepted: true,
        provider_prompt_mode: 'codex_goal',
        provider_prompt_prefix: '/goal ',
        enter_sent: true,
        enter_bytes: 1,
        enter_accepted: true,
      },
      typed_observed: true,
      submitted_observed: true,
      snapshot: {
        session: 'afk-session-trigger-supervised-bridge-launch',
        driver: 'process',
        command: 'codex --no-alt-screen',
        terminal: { cols: 100, rows: 31 },
        text: [
          'Codex CLI 0.133.0',
          `provider_session_id: ${sessionId}`,
          'cwd /Users/Michael/Code/agent-os/.docks/gdi',
          'branch gdi/afk-dev-session-trigger-supervised-bridge-launch-v0',
          'model gpt-5.5',
          'head a38d0da6',
          'live-codex-session-trigger-supervised-bridge-launch',
        ].join('\n'),
      },
      ...(overrides.bridge ?? {}),
    },
    ...(overrides.cleanup ? { cleanup: overrides.cleanup } : {}),
  });
}

async function writeCleanupProofFixture(status = 'verified') {
  return writeJsonFixture('afk-session-trigger-cleanup-', 'cleanup.json', {
    status,
    proof: [
      'bridge health endpoint unreachable',
      'no matching codex --no-alt-screen process',
      'no matching pty-proxy.py process',
      'no matching bridge server process',
    ],
  });
}

async function createCodexHomeFixture(sessions) {
  const codexHome = await mkdtemp(join(tmpdir(), 'afk-session-trigger-codex-home-'));
  await writeFile(
    join(codexHome, '.codex-global-state.json'),
    `${JSON.stringify({
      'thread-titles': {
        titles: Object.fromEntries(sessions.map((session) => [session.id, session.title ?? `Fixture ${session.id}`])),
        order: sessions.map((session) => session.id),
      },
    }, null, 2)}\n`,
    'utf8',
  );
  for (const session of sessions) {
    const timestamp = session.timestamp;
    const file = join(
      codexHome,
      'sessions',
      timestamp.slice(0, 4),
      timestamp.slice(5, 7),
      timestamp.slice(8, 10),
      `rollout-${timestamp.slice(0, 19).replaceAll(':', '-')}-${session.id}.jsonl`,
    );
    await mkdir(dirname(file), { recursive: true });
    await writeFile(
      file,
      `${JSON.stringify({
        timestamp,
        type: 'session_meta',
        payload: {
          id: session.id,
          cwd: session.cwd,
          timestamp,
        },
      })}\n`,
      'utf8',
    );
  }
  return codexHome;
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
  assert.equal(receipt.result_route.status, 'completed');
  assert.deepEqual(receipt.result_route.refs, [{ kind: 'local_artifact_path', ref: 'stdout' }]);
  assert.deepEqual(receipt.result_route.attempt_refs, [{ kind: 'local_artifact_path', ref: 'stdout' }]);
  assert.deepEqual(receipt.result_route.delivered_refs, [{ kind: 'local_artifact_path', ref: 'stdout' }]);
  assert.equal(receipt.result_route.failure, 'not_observed');
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

test('normalizes --result-route stdout override as a local artifact route', async () => {
  const packetPath = await writePacket(validPacket({
    result_route: undefined,
    result_routes: undefined,
  }));
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
    '--result-route',
    'stdout',
  ]);

  assert.equal(result.status, 0, result.stderr);
  const receipt = JSON.parse(result.stdout);
  assert.equal(receipt.status, 'dry_run_ready');
  assert.equal(receipt.scheduler.lifecycle_state, 'accepted');
  assert.equal(receipt.result_route.status, 'completed');
  assert.deepEqual(receipt.result_route.refs, [{ kind: 'local_artifact_path', ref: 'stdout' }]);
  assert.deepEqual(receipt.result_route.attempt_refs, [{ kind: 'local_artifact_path', ref: 'stdout' }]);
  assert.deepEqual(receipt.result_route.delivered_refs, [{ kind: 'local_artifact_path', ref: 'stdout' }]);
  assert.equal(receipt.result_route.failure, 'not_observed');
});

test('normalizes matching --result-route path override as confirmed --out delivery', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'afk-session-trigger-route-override-'));
  const outPath = join(dir, 'receipt.json');
  const packetPath = await writePacket(validPacket({
    result_route: undefined,
    result_routes: undefined,
  }));
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
    '--result-route',
    outPath,
  ]);

  assert.equal(result.status, 0, result.stderr);
  const receipt = JSON.parse(result.stdout);
  assert.deepEqual(JSON.parse(await readFile(outPath, 'utf8')), receipt);
  assert.equal(receipt.status, 'dry_run_ready');
  assert.equal(receipt.scheduler.lifecycle_state, 'accepted');
  assert.equal(receipt.result_route.status, 'completed');
  assert.deepEqual(receipt.result_route.refs, [{ kind: 'local_artifact_path', ref: outPath }]);
  assert.equal(receipt.result_route.delivered_refs[0].ref, outPath);
  assert.equal(receipt.result_route.delivered_refs[0].resolved_path, outPath);
  assert.equal(receipt.result_route.failure, 'not_observed');
});

test('accounts for explicit --out local artifact delivery after confirmed file write', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'afk-session-trigger-local-route-'));
  const outPath = join(dir, 'receipt.json');
  const packetPath = await writePacket(validPacket({
    result_route: [
      { kind: 'local_artifact_path', ref: outPath },
    ],
  }));
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
  const receipt = JSON.parse(result.stdout);
  assert.deepEqual(JSON.parse(await readFile(outPath, 'utf8')), receipt);
  assert.equal(receipt.status, 'dry_run_ready');
  assert.equal(receipt.scheduler.lifecycle_state, 'accepted');
  assert.equal(receipt.result_route.status, 'completed');
  assert.equal(receipt.result_route.delivered_refs[0].ref, outPath);
  assert.equal(receipt.result_route.delivered_refs[0].resolved_path, outPath);
  assert.equal(receipt.result_route.failure, 'not_observed');
});

test('keeps unsupported result routes explicit and non-completed', async () => {
  const packetPath = await writePacket(validPacket({
    result_route: [
      { kind: 'gateway_notifier', ref: 'slack-thread-123' },
    ],
  }));
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
  ]);

  assert.equal(result.status, 0, result.stderr);
  const receipt = JSON.parse(result.stdout);
  assert.equal(receipt.status, 'dry_run_ready');
  assert.equal(receipt.result_route.status, 'unsupported');
  assert.deepEqual(receipt.result_route.delivered_refs, []);
  assert.equal(receipt.result_route.failure[0].code, 'result_route_unsupported');
});

test('drives fixture-backed supervised-live Codex bridge/provider acceptance and requires cleanup before completion', async () => {
  const packetPath = await writePacket(validPacket());
  const bridgeFixture = await writeBridgeVisibilityFixture();
  const cleanupFixture = await writeCleanupProofFixture();
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
    '--bridge-visibility-fixture',
    bridgeFixture,
    '--cleanup-proof-fixture',
    cleanupFixture,
  ]);

  assert.equal(result.status, 0, result.stderr);
  const receipt = JSON.parse(result.stdout);
  assert.equal(receipt.record_type, 'aos.afk_session_trigger_supervised_live');
  assert.equal(receipt.schema_status, 'not_a_schema');
  assert.equal(receipt.status, 'completed');
  assert.equal(receipt.packet.validation_status, 'valid');
  assert.equal(receipt.scheduler.selected_action, 'supervised-live-launch');
  assert.equal(receipt.scheduler.lifecycle_state, 'completed');
  assert.match(receipt.scheduler.idempotence_key, /^[a-f0-9]{32}$/);
  assert.equal(receipt.dispatch.selected_provider, 'codex');
  assert.equal(receipt.dispatch.selected_dock, 'gdi');
  assert.equal(receipt.dispatch.launch_root, '.docks/gdi');
  assert.equal(receipt.dispatch.provider_launch_allowed, true);
  assert.match(receipt.dispatch.launch_attempt_id, /^launch-attempt-[a-f0-9]{16}$/);
  assert.deepEqual(receipt.dispatch.human_supervision, { required: true, i_am_present: true });
  assert.equal(receipt.terminal_substrate.status, 'observed');
  assert.equal(receipt.terminal_substrate.driver, 'process');
  assert.equal(receipt.terminal_substrate.geometry.cols, 100);
  assert.equal(receipt.terminal_substrate.input_submission.provider_prompt_mode, 'codex_goal');
  assert.equal(receipt.terminal_substrate.input_submission.provider_prompt_prefix, '/goal ');
  assert.equal(receipt.provider_acceptance.status, 'provider_session_observed');
  assert.equal(receipt.provider_acceptance.provider_reported_cwd, '/Users/Michael/Code/agent-os/.docks/gdi');
  assert.equal(receipt.cleanup.status, 'verified');
  assert.equal(receipt.codex_adapter.status, 'not_attempted_no_codex_home_fixture');
  assert.equal(receipt.catalog.status, 'not_observed');
  assert.equal(receipt.telemetry.status, 'not_observed');
  assert.equal(receipt.result_route.status, 'completed');
  assert.equal(receipt.work_receipt.status, 'not_attempted');
  assert.equal(receipt.evidence.transcript_body_copied, false);
  assert.deepEqual(receipt.mismatches, []);
});

test('selects provider-shaped Codex command for accepted no-fixture supervised launch without executing provider in tests', async () => {
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
    'no-fixture-provider-command-test',
    '--provider-launch-dry-run',
  ]);

  assert.equal(result.status, 1);
  const receipt = JSON.parse(result.stdout);
  assert.equal(receipt.dispatch.provider_launch_allowed, true);
  assert.equal(receipt.status, 'provider_acceptance_unobserved');
  assert.equal(receipt.packet.validation_status, 'valid');
  assert.equal(receipt.terminal_substrate.status, 'observed');
  assert.equal(receipt.terminal_substrate.command, 'codex --no-alt-screen');
  assert.equal(receipt.provider_acceptance.status, 'provider_acceptance_unobserved');
  assert.equal(receipt.cleanup.status, 'verified');
  assert.equal(receipt.cleanup.source_ref, 'inline:launch_attempt.cleanup');
  assert.equal(receipt.terminal_substrate.cleanup_status, 'verified');
  assert.ok(receipt.mismatches.some((item) => item.class === 'provider_acceptance_unobserved'));
  assert.equal(receipt.mismatches.some((item) => item.class === 'cleanup_unverified'), false);
});

test('completes when metadata-backed provider acceptance and cleanup proof are present', async () => {
  const packetPath = await writePacket(validPacket());
  const intendedLaunchCwd = join(repoRoot, '.docks/gdi');
  const threadId = '019e7100-dddd-7222-8333-444444444444';
  const bridgeFixture = await writeBridgeVisibilityFixture({
    providerSessionId: 'not_observed',
    bridge: {
      snapshot: {
        session: 'afk-session-trigger-supervised-bridge-launch',
        driver: 'process',
        command: 'codex --no-alt-screen',
        terminal: { cols: 100, rows: 31 },
        text: [
          'Codex CLI 0.133.0',
          'cwd /Users/Michael/Code/agent-os/.docks/gdi',
          'branch gdi/afk-dev-session-trigger-supervised-bridge-launch-v0',
          'model gpt-5.5',
          'head a38d0da6',
          'live-codex-session-trigger-supervised-bridge-launch',
        ].join('\n'),
      },
    },
  });
  const cleanupFixture = await writeCleanupProofFixture();
  const codexHome = await createCodexHomeFixture([
    {
      id: threadId,
      cwd: intendedLaunchCwd,
      timestamp: '2026-05-22T20:00:30.000Z',
      title: 'Session trigger metadata acceptance',
    },
  ]);
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
    '2026-05-22T20:01:00.000Z',
    '--launch-observed-at',
    fixedTimestamp,
    '--idempotence-salt',
    'metadata-provider-acceptance-test',
    '--bridge-visibility-fixture',
    bridgeFixture,
    '--cleanup-proof-fixture',
    cleanupFixture,
    '--codex-home-fixture',
    codexHome,
  ]);

  assert.equal(result.status, 0, result.stderr);
  const receipt = JSON.parse(result.stdout);
  assert.equal(receipt.status, 'completed');
  assert.equal(receipt.scheduler.lifecycle_state, 'completed');
  assert.equal(receipt.provider_acceptance.status, 'provider_session_observed');
  assert.equal(receipt.provider_acceptance.provider_session_id, threadId);
  assert.equal(receipt.provider_acceptance.observation_source, 'codex_adapter_metadata');
  assert.equal(receipt.cleanup.status, 'verified');
  assert.equal(receipt.codex_adapter.correlation_status, 'matched_by_cwd_time_window');
  assert.equal(receipt.codex_adapter.matched_thread_id, threadId);
  assert.deepEqual(receipt.mismatches, []);
});

test('completes warm dock TUI reuse without source-owned provider teardown', async () => {
  const previousSessionId = '019e7300-aaaa-7222-8333-444444444444';
  const newSessionId = '019e7300-bbbb-7222-8333-444444444444';
  const packetPath = await writePacket(validPacket({
    previous_provider_session_id: previousSessionId,
  }));
  const intendedLaunchCwd = join(repoRoot, '.docks/gdi');
  const bridgeFixture = await writeBridgeVisibilityFixture({
    providerSessionId: newSessionId,
    bridge: {
      provider_launch_performed: false,
      ensure: {
        session: 'gdi-warm-codex',
        cwd: intendedLaunchCwd,
        driver: 'manual_tui',
      },
      input: {
        text_accepted: true,
        enter_accepted: true,
      },
    },
    cleanup: undefined,
  });
  const result = runPrototype([
    '--packet',
    packetPath,
    '--provider',
    'codex',
    '--dock',
    'gdi',
    '--warm-dock-tui-reuse',
    '--json',
    '--timestamp',
    '2026-05-22T20:10:00.000Z',
    '--idempotence-salt',
    'warm-tui-reuse-session-trigger',
    '--bridge-visibility-fixture',
    bridgeFixture,
  ]);

  assert.equal(result.status, 0, result.stderr);
  const receipt = JSON.parse(result.stdout);
  assert.equal(receipt.record_type, 'aos.afk_session_trigger_warm_dock_tui_reuse');
  assert.equal(receipt.status, 'completed');
  assert.equal(receipt.scheduler.selected_action, 'warm-dock-tui-reuse');
  assert.equal(receipt.scheduler.lifecycle_state, 'completed');
  assert.equal(receipt.dispatch.provider_launch_allowed, true);
  assert.equal(receipt.terminal_substrate.owner, 'aos.dock_terminal_session');
  assert.match(receipt.terminal_substrate.dock_terminal_session_id, /^dock-terminal:gdi:[a-f0-9]{16}$/);
  assert.equal(receipt.terminal_substrate.status, 'warm_tui_reused');
  assert.equal(receipt.terminal_substrate.cwd, intendedLaunchCwd);
  assert.deepEqual(receipt.terminal_substrate.geometry, { cols: 100, rows: 31 });
  assert.equal(receipt.terminal_substrate.lease_disposition, 'returned_to_idle');
  assert.equal(receipt.terminal_substrate.input_submission.context_reset_command, '/clear');
  assert.equal(receipt.terminal_substrate.input_submission.provider_prompt_prefix, '/goal ');
  assert.equal(receipt.terminal_substrate.input_submission.provider_prompt_contract_path, '.docks/gdi/inbound-contract.json');
  assert.match(receipt.terminal_substrate.input_submission.provider_entry_preview, /^\/goal Your work card is at /);
  assert.deepEqual(receipt.terminal_substrate.input_submission.provider_prompt_diagnostics, []);
  assert.equal(receipt.terminal_substrate.input_submission.stale_goal_recovery_command, '/goal clear');
  assert.equal(receipt.provider_acceptance.status, 'provider_session_observed');
  assert.equal(receipt.provider_acceptance.provider_session_id, newSessionId);
  assert.equal(receipt.cleanup.status, 'returned_to_idle');
  assert.equal(receipt.cleanup.proof[0].kind, 'warm_tui_lease_disposition');
  assert.equal(receipt.warm_tui_reuse.status, 'context_boundary_observed');
  assert.equal(receipt.warm_tui_reuse.provider_session_changed, true);
  assert.equal(receipt.result_route.status, 'completed');
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
  assert.equal(receipt.packet.validation_status, 'invalid');
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
  const bridgeFixture = await writeBridgeVisibilityFixture();
  const cleanupFixture = await writeCleanupProofFixture();
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
    '--bridge-visibility-fixture',
    bridgeFixture,
    '--cleanup-proof-fixture',
    cleanupFixture,
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
  const bridgeFixture = await writeBridgeVisibilityFixture();
  const cleanupFixture = await writeCleanupProofFixture();
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
    '--bridge-visibility-fixture',
    bridgeFixture,
    '--cleanup-proof-fixture',
    cleanupFixture,
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
    assert.equal(receipt.packet.validation_status, 'valid', state);
    assert.equal(receipt.scheduler.lifecycle_state, 'duplicate', state);
    assert.equal(receipt.scheduler.duplicate_handling.duplicate, true, state);
    assert.equal(receipt.scheduler.duplicate_handling.existing_state, state);
    assert.equal(receipt.scheduler.duplicate_handling.reused_state, true, state);
    assert.equal(receipt.dispatch.provider_launch_allowed, false, state);
  }
});

test('blocks relaunch after rejected or failed receipt unless replacement is explicit', async () => {
  const packetPath = await writePacket(validPacket());
  const bridgeFixture = await writeBridgeVisibilityFixture();
  const cleanupFixture = await writeCleanupProofFixture();
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
    '--bridge-visibility-fixture',
    bridgeFixture,
    '--cleanup-proof-fixture',
    cleanupFixture,
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

test('classifies deterministic cleanup proof failure as cleanup_unverified after bridge/provider evidence', async () => {
  const packetPath = await writePacket(validPacket());
  const bridgeFixture = await writeBridgeVisibilityFixture();
  const cleanupFixture = await writeJsonFixture('afk-session-trigger-cleanup-', 'cleanup.json', {
    status: 'missing',
    proof: [],
    reason: 'test fixture intentionally omits cleanup proof',
  });

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
    '--bridge-visibility-fixture',
    bridgeFixture,
    '--cleanup-proof-fixture',
    cleanupFixture,
  ]);

  assert.equal(result.status, 1);
  const receipt = JSON.parse(result.stdout);
  assert.equal(receipt.status, 'cleanup_unverified');
  assert.equal(receipt.packet.validation_status, 'valid');
  assert.equal(receipt.scheduler.lifecycle_state, 'rejected');
  assert.equal(receipt.dispatch.provider_launch_allowed, true);
  assert.equal(receipt.terminal_substrate.status, 'observed');
  assert.equal(receipt.provider_acceptance.status, 'provider_session_observed');
  assert.equal(receipt.catalog.status, 'not_observed');
  assert.equal(receipt.evidence.transcript_body_copied, false);
  assert.equal(receipt.cleanup.owner, 'afk-session-trigger-prototype');
  assert.equal(receipt.cleanup.status, 'cleanup_unverified');
  assert.deepEqual(receipt.cleanup.proof, []);
  assert.ok(receipt.mismatches.some((item) => item.class === 'cleanup_unverified'));
});

test('classifies missing source-owned cleanup proof as cleanup_unverified after no-fixture bridge/provider evidence', async () => {
  const packetPath = await writePacket(validPacket());
  const bridgeFixture = await writeBridgeVisibilityFixture();

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
    '--bridge-visibility-fixture',
    bridgeFixture,
  ]);

  assert.equal(result.status, 1);
  const receipt = JSON.parse(result.stdout);
  assert.equal(receipt.status, 'cleanup_unverified');
  assert.equal(receipt.dispatch.provider_launch_allowed, true);
  assert.equal(receipt.terminal_substrate.status, 'observed');
  assert.equal(receipt.provider_acceptance.status, 'provider_session_observed');
  assert.equal(receipt.cleanup.status, 'cleanup_unverified');
  assert.equal(receipt.cleanup.source_ref, 'inline:launch_attempt.cleanup');
  assert.equal(receipt.cleanup.reason, 'cleanup proof must include helper-owned bridge and child/session teardown');
  assert.ok(receipt.mismatches.some((item) => item.class === 'cleanup_unverified'));
});

test('classifies failed source-owned cleanup proof as cleanup_unverified without fixture override', async () => {
  const packetPath = await writePacket(validPacket());
  const bridgeFixture = await writeBridgeVisibilityFixture({
    cleanup: {
      status: 'cleanup_unverified',
      reason: 'owned bridge health endpoint still responded',
      proof: [
        {
          kind: 'owned_bridge_health_unreachable_after_teardown',
          port: 48123,
          unreachable: false,
        },
      ],
    },
  });

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
    '--bridge-visibility-fixture',
    bridgeFixture,
  ]);

  assert.equal(result.status, 1);
  const receipt = JSON.parse(result.stdout);
  assert.equal(receipt.status, 'cleanup_unverified');
  assert.equal(receipt.cleanup.status, 'cleanup_unverified');
  assert.equal(receipt.cleanup.source_ref, 'inline:launch_attempt.cleanup');
  assert.equal(receipt.cleanup.reason, 'owned bridge health endpoint still responded');
  assert.ok(receipt.mismatches.some((item) => item.class === 'cleanup_unverified'));
});

test('provider acceptance timeout returns non-completed state even with cleanup proof', async () => {
  const packetPath = await writePacket(validPacket());
  const cleanupFixture = await writeCleanupProofFixture();
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
    'provider-timeout-test',
    '--provider-launch-dry-run',
    '--cleanup-proof-fixture',
    cleanupFixture,
  ]);

  assert.equal(result.status, 1);
  const receipt = JSON.parse(result.stdout);
  assert.equal(receipt.status, 'provider_acceptance_unobserved');
  assert.equal(receipt.packet.validation_status, 'valid');
  assert.equal(receipt.scheduler.lifecycle_state, 'rejected');
  assert.equal(receipt.terminal_substrate.status, 'observed');
  assert.notEqual(receipt.provider_acceptance.status, 'provider_session_observed');
  assert.equal(receipt.cleanup.status, 'verified');
  assert.ok(receipt.cleanup.proof.some((item) => String(item).includes('bridge health endpoint unreachable')));
  assert.ok(receipt.cleanup.proof.some((item) => String(item).includes('pty-proxy.py process')));
  assert.ok(receipt.mismatches.some((item) => item.class === 'provider_acceptance_unobserved'));
});

test('provider acceptance timeout with failed cleanup reports cleanup_unverified', async () => {
  const packetPath = await writePacket(validPacket());
  const cleanupFixture = await writeJsonFixture('afk-session-trigger-cleanup-', 'cleanup.json', {
    status: 'cleanup_unverified',
    reason: 'owned process-driver child still observable after bridge teardown',
    proof: [
      { kind: 'owned_bridge_process_exit', exit_observed: true },
      { kind: 'owned_bridge_health_unreachable_after_teardown', unreachable: true },
      { kind: 'owned_process_driver_child_exit', exit_observed: false },
    ],
  });
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
    'provider-timeout-cleanup-failed-test',
    '--provider-launch-dry-run',
    '--cleanup-proof-fixture',
    cleanupFixture,
  ]);

  assert.equal(result.status, 1);
  const receipt = JSON.parse(result.stdout);
  assert.equal(receipt.status, 'cleanup_unverified');
  assert.equal(receipt.packet.validation_status, 'valid');
  assert.equal(receipt.scheduler.lifecycle_state, 'rejected');
  assert.equal(receipt.provider_acceptance.status, 'provider_acceptance_unobserved');
  assert.equal(receipt.cleanup.status, 'cleanup_unverified');
  assert.equal(receipt.cleanup.reason, 'owned process-driver child still observable after bridge teardown');
  assert.ok(receipt.mismatches.some((item) => item.class === 'cleanup_unverified'));
});
