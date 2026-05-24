import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
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

function validSleepLease(overrides = {}) {
  return {
    lease_id: 'sleep-lease-test',
    authorized_by: 'local-human',
    authorized_at: '2026-05-22T19:30:00.000Z',
    expires_at: '2026-05-22T21:00:00.000Z',
    max_wall_clock_minutes: 90,
    max_provider_launches: 0,
    provider_budget: {
      status: 'not_enforceable_yet',
      declared_ceiling: '0 live launches in dry-run',
    },
    allowed_docks: ['gdi'],
    allowed_providers: ['codex'],
    allowed_work_refs: ['docs/design/work-cards/afk-dev-session-trigger-dry-run-command-v0.md'],
    allowed_branch_policy: {
      create_branch: true,
      branch_prefix: 'gdi/',
      allow_main_mutation: false,
    },
    allow_branch_push: false,
    external_publication_policy: 'none',
    result_route: 'stdout',
    stop_conditions: ['human_judgment_needed', 'provider_auth_prompt', 'token_budget_reached', 'cleanup_unverified'],
    ...overrides,
  };
}

async function writeSleepLease(lease = validSleepLease()) {
  return writeJsonFixture('afk-sleep-lease-', 'lease.json', lease);
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

test('accepts sleep lease dry-run receipt for an allowed work card', async () => {
  const packetPath = await writePacket(validPacket());
  const leasePath = await writeSleepLease();
  const result = runPrototype([
    '--packet',
    packetPath,
    '--provider',
    'codex',
    '--dock',
    'gdi',
    '--sleep-lease',
    leasePath,
    '--dry-run',
    '--json',
    '--timestamp',
    fixedTimestamp,
  ]);

  assert.equal(result.status, 0, result.stderr);
  const receipt = JSON.parse(result.stdout);
  assert.equal(receipt.status, 'dry_run_ready');
  assert.equal(receipt.dispatch.provider_launch_allowed, false);
  assert.equal(receipt.scheduler.lease.status, 'accepted');
  assert.equal(receipt.scheduler.lease.lease_id, 'sleep-lease-test');
  assert.equal(receipt.sleep_lease.status, 'accepted');
  assert.equal(receipt.sleep_lease.lease_id, 'sleep-lease-test');
  assert.equal(receipt.sleep_lease.provider_budget.status, 'not_enforceable_yet');
  assert.equal(receipt.sleep_lease.provider_budget_enforcement, 'informational');
  assert.deepEqual(receipt.sleep_lease.allowed_docks, ['gdi']);
  assert.deepEqual(receipt.sleep_lease.allowed_providers, ['codex']);
  assert.deepEqual(receipt.sleep_lease.allowed_work_refs, ['docs/design/work-cards/afk-dev-session-trigger-dry-run-command-v0.md']);
  assert.deepEqual(receipt.sleep_lease.diagnostics, []);
  assert.deepEqual(receipt.mismatches, []);
  assert.equal(receipt.terminal_substrate.status, 'not_attempted');
});

test('accepts AFK authorization as the primary dry-run flag spelling', async () => {
  const packetPath = await writePacket(validPacket());
  const authorizationPath = await writeSleepLease();
  const result = runPrototype([
    '--packet',
    packetPath,
    '--provider',
    'codex',
    '--dock',
    'gdi',
    '--afk-authorization',
    authorizationPath,
    '--dry-run',
    '--json',
    '--timestamp',
    fixedTimestamp,
  ]);

  assert.equal(result.status, 0, result.stderr);
  const receipt = JSON.parse(result.stdout);
  assert.equal(receipt.status, 'dry_run_ready');
  assert.equal(receipt.scheduler.lease.status, 'accepted');
  assert.equal(receipt.scheduler.lease.lease_id, 'sleep-lease-test');
  assert.equal(receipt.sleep_lease.status, 'accepted');
  assert.deepEqual(receipt.mismatches, []);
});

test('accepts sleep lease stdout route-object shorthands for local routes', async () => {
  for (const resultRoute of [
    'stdout',
    { kind: 'stdout' },
    { ref: 'stdout' },
    { path: 'stdout' },
    { artifact_path: 'stdout' },
    { kind: 'local_artifact_path', ref: 'stdout' },
  ]) {
    const packetPath = await writePacket(validPacket({
      result_route: resultRoute,
    }));
    const leasePath = await writeSleepLease();
    const result = runPrototype([
      '--packet',
      packetPath,
      '--provider',
      'codex',
      '--dock',
      'gdi',
      '--sleep-lease',
      leasePath,
      '--dry-run',
      '--json',
      '--timestamp',
      fixedTimestamp,
    ]);

    assert.equal(result.status, 0, result.stderr);
    const receipt = JSON.parse(result.stdout);
    assert.equal(receipt.status, 'dry_run_ready');
    assert.equal(receipt.scheduler.lease.status, 'accepted');
    assert.equal(receipt.sleep_lease.status, 'accepted');
    assert.equal(receipt.result_route.status, 'completed');
    assert.deepEqual(receipt.mismatches, []);
  }
});

test('rejects sleep lease when stdout ref is on unsupported external route object', async () => {
  const packetPath = await writePacket(validPacket({
    result_route: { kind: 'gateway_notifier', ref: 'stdout' },
  }));
  const leasePath = await writeSleepLease();
  const result = runPrototype([
    '--packet',
    packetPath,
    '--provider',
    'codex',
    '--dock',
    'gdi',
    '--sleep-lease',
    leasePath,
    '--dry-run',
    '--json',
    '--timestamp',
    fixedTimestamp,
  ]);

  assert.equal(result.status, 1);
  const receipt = JSON.parse(result.stdout);
  assert.equal(receipt.status, 'rejected');
  assert.equal(receipt.scheduler.lease.status, 'rejected');
  assert.equal(receipt.sleep_lease.status, 'rejected');
  assert.equal(receipt.dispatch.provider_launch_allowed, false);
  assert.equal(receipt.terminal_substrate.status, 'not_attempted');
  assert.equal(receipt.result_route.status, 'unsupported');
  assert.equal(receipt.result_route.failure[0].code, 'result_route_unsupported');
  assert.ok(receipt.mismatches.some((item) => item.class === 'sleep_lease_result_route_mismatch'));
});

test('rejects expired sleep lease dry-run', async () => {
  const packetPath = await writePacket(validPacket());
  const leasePath = await writeSleepLease(validSleepLease({
    expires_at: '2026-05-22T19:59:00.000Z',
  }));
  const result = runPrototype([
    '--packet',
    packetPath,
    '--provider',
    'codex',
    '--dock',
    'gdi',
    '--sleep-lease',
    leasePath,
    '--dry-run',
    '--json',
    '--timestamp',
    fixedTimestamp,
  ]);

  assert.equal(result.status, 1);
  const receipt = JSON.parse(result.stdout);
  assert.equal(receipt.status, 'rejected');
  assert.equal(receipt.dispatch.provider_launch_allowed, false);
  assert.equal(receipt.scheduler.lease.status, 'expired');
  assert.equal(receipt.sleep_lease.status, 'expired');
  assert.ok(receipt.mismatches.some((item) => item.class === 'sleep_lease_expired'));
});

test('rejects sleep lease when selected provider or dock is not allowed', async () => {
  const packetPath = await writePacket(validPacket());
  const leasePath = await writeSleepLease(validSleepLease({
    allowed_docks: ['foreman'],
    allowed_providers: ['gemini'],
  }));
  const result = runPrototype([
    '--packet',
    packetPath,
    '--provider',
    'codex',
    '--dock',
    'gdi',
    '--sleep-lease',
    leasePath,
    '--dry-run',
    '--json',
    '--timestamp',
    fixedTimestamp,
  ]);

  assert.equal(result.status, 1);
  const receipt = JSON.parse(result.stdout);
  assert.equal(receipt.status, 'rejected');
  assert.equal(receipt.dispatch.provider_launch_allowed, false);
  const mismatchClasses = new Set(receipt.mismatches.map((item) => item.class));
  assert.ok(mismatchClasses.has('sleep_lease_dock_not_allowed'), receipt.mismatches);
  assert.ok(mismatchClasses.has('sleep_lease_provider_not_allowed'), receipt.mismatches);
});

test('rejects sleep lease when selected work ref is not allowed', async () => {
  const packetPath = await writePacket(validPacket());
  const leasePath = await writeSleepLease(validSleepLease({
    allowed_work_refs: ['docs/design/work-cards/other-card.md'],
  }));
  const result = runPrototype([
    '--packet',
    packetPath,
    '--provider',
    'codex',
    '--dock',
    'gdi',
    '--sleep-lease',
    leasePath,
    '--dry-run',
    '--json',
    '--timestamp',
    fixedTimestamp,
  ]);

  assert.equal(result.status, 1);
  const receipt = JSON.parse(result.stdout);
  assert.equal(receipt.status, 'rejected');
  assert.equal(receipt.dispatch.provider_launch_allowed, false);
  assert.ok(receipt.mismatches.some((item) => item.class === 'sleep_lease_work_ref_not_allowed'));
});

test('rejects sleep lease external publication policy other than none', async () => {
  const packetPath = await writePacket(validPacket());
  const leasePath = await writeSleepLease(validSleepLease({
    external_publication_policy: 'github-pr',
  }));
  const result = runPrototype([
    '--packet',
    packetPath,
    '--provider',
    'codex',
    '--dock',
    'gdi',
    '--sleep-lease',
    leasePath,
    '--dry-run',
    '--json',
    '--timestamp',
    fixedTimestamp,
  ]);

  assert.equal(result.status, 1);
  const receipt = JSON.parse(result.stdout);
  assert.equal(receipt.status, 'rejected');
  assert.equal(receipt.dispatch.provider_launch_allowed, false);
  assert.ok(receipt.mismatches.some((item) => item.class === 'sleep_lease_external_publication_forbidden'));
});

test('rejects sleep lease outside dry-run json mode', async () => {
  const packetPath = await writePacket(validPacket());
  const leasePath = await writeSleepLease();
  const supervised = runPrototype([
    '--packet',
    packetPath,
    '--provider',
    'codex',
    '--dock',
    'gdi',
    '--sleep-lease',
    leasePath,
    '--supervised-live-launch',
    '--i-am-present',
    '--json',
    '--timestamp',
    fixedTimestamp,
  ]);
  assert.equal(supervised.status, 1);
  let receipt = JSON.parse(supervised.stdout);
  assert.equal(receipt.dispatch.provider_launch_allowed, false);
  assert.ok(receipt.mismatches.some((item) => item.class === 'sleep_lease_provider_launches_exhausted'));

  const warm = runPrototype([
    '--packet',
    packetPath,
    '--provider',
    'codex',
    '--dock',
    'gdi',
    '--sleep-lease',
    leasePath,
    '--warm-dock-tui-reuse',
    '--json',
    '--timestamp',
    fixedTimestamp,
  ]);
  assert.equal(warm.status, 1);
  receipt = JSON.parse(warm.stdout);
  assert.equal(receipt.dispatch.provider_launch_allowed, false);
  assert.ok(receipt.mismatches.some((item) => item.class === 'sleep_lease_warm_reuse_forbidden'));

  const providerLaunchDryRun = runPrototype([
    '--packet',
    packetPath,
    '--provider',
    'codex',
    '--dock',
    'gdi',
    '--sleep-lease',
    leasePath,
    '--dry-run',
    '--provider-launch-dry-run',
    '--json',
    '--timestamp',
    fixedTimestamp,
  ]);
  assert.equal(providerLaunchDryRun.status, 1);
  receipt = JSON.parse(providerLaunchDryRun.stdout);
  assert.equal(receipt.dispatch.provider_launch_allowed, false);
  assert.ok(receipt.mismatches.some((item) => item.class === 'sleep_lease_provider_launch_dry_run_forbidden'));

  const missingJson = runPrototype([
    '--packet',
    packetPath,
    '--provider',
    'codex',
    '--dock',
    'gdi',
    '--sleep-lease',
    leasePath,
    '--dry-run',
    '--timestamp',
    fixedTimestamp,
  ]);
  assert.equal(missingJson.status, 1);
  receipt = JSON.parse(missingJson.stdout);
  assert.equal(receipt.dispatch.provider_launch_allowed, false);
  assert.ok(receipt.mismatches.some((item) => item.class === 'sleep_lease_requires_guarded_json_action'));
});

test('accepts sleep lease for guarded supervised-live when launch count and human gate allow it', async () => {
  const packetPath = await writePacket(validPacket());
  const leasePath = await writeSleepLease(validSleepLease({
    max_provider_launches: 1,
    provider_budget: {
      status: 'not_enforceable_yet',
      declared_ceiling: '1 supervised live launch for awake proof',
    },
  }));
  const bridgeFixture = await writeBridgeVisibilityFixture();
  const cleanupFixture = await writeCleanupProofFixture();
  const result = runPrototype([
    '--packet',
    packetPath,
    '--provider',
    'codex',
    '--dock',
    'gdi',
    '--sleep-lease',
    leasePath,
    '--supervised-live-launch',
    '--i-am-present',
    '--json',
    '--timestamp',
    fixedTimestamp,
    '--idempotence-salt',
    'sleep-lease-guarded-live',
    '--bridge-visibility-fixture',
    bridgeFixture,
    '--cleanup-proof-fixture',
    cleanupFixture,
  ]);

  assert.equal(result.status, 0, result.stderr);
  const receipt = JSON.parse(result.stdout);
  assert.equal(receipt.record_type, 'aos.afk_session_trigger_supervised_live');
  assert.equal(receipt.status, 'completed');
  assert.equal(receipt.scheduler.lease.status, 'accepted');
  assert.equal(receipt.sleep_lease.status, 'accepted');
  assert.equal(receipt.sleep_lease.max_provider_launches, 1);
  assert.equal(receipt.sleep_lease.provider_budget.status, 'not_enforceable_yet');
  assert.equal(receipt.sleep_lease.provider_budget_enforcement, 'informational');
  assert.equal(receipt.dispatch.provider_launch_allowed, true);
  assert.deepEqual(receipt.dispatch.human_supervision, { required: true, i_am_present: true });
  assert.equal(receipt.terminal_substrate.status, 'observed');
  assert.equal(receipt.cleanup.status, 'verified');
  assert.equal(receipt.result_route.status, 'completed');
  assert.deepEqual(receipt.mismatches, []);
});

test('rejects sleep lease guarded supervised-live when max provider launches is zero', async () => {
  const packetPath = await writePacket(validPacket());
  const leasePath = await writeSleepLease();
  const result = runPrototype([
    '--packet',
    packetPath,
    '--provider',
    'codex',
    '--dock',
    'gdi',
    '--sleep-lease',
    leasePath,
    '--supervised-live-launch',
    '--i-am-present',
    '--json',
    '--timestamp',
    fixedTimestamp,
  ]);

  assert.equal(result.status, 1);
  const receipt = JSON.parse(result.stdout);
  assert.equal(receipt.record_type, 'aos.afk_session_trigger_supervised_live');
  assert.equal(receipt.status, 'rejected');
  assert.equal(receipt.scheduler.lease.status, 'rejected');
  assert.equal(receipt.sleep_lease.status, 'rejected');
  assert.equal(receipt.dispatch.provider_launch_allowed, false);
  assert.equal(receipt.terminal_substrate.status, 'not_attempted');
  assert.ok(receipt.mismatches.some((item) => item.class === 'sleep_lease_provider_launches_exhausted'));
});

test('includes sleep lease identity in idempotence material', async () => {
  const packetPath = await writePacket(validPacket());
  const leaseOnePath = await writeSleepLease(validSleepLease({
    lease_id: 'sleep-lease-one',
  }));
  const leaseTwoPath = await writeSleepLease(validSleepLease({
    lease_id: 'sleep-lease-two',
  }));
  const baseArgs = [
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
    'sleep-lease-idempotence',
  ];

  const first = runPrototype([...baseArgs, '--sleep-lease', leaseOnePath]);
  const firstAgain = runPrototype([...baseArgs, '--sleep-lease', leaseOnePath]);
  const second = runPrototype([...baseArgs, '--sleep-lease', leaseTwoPath]);

  assert.equal(first.status, 0, first.stderr);
  assert.equal(firstAgain.status, 0, firstAgain.stderr);
  assert.equal(second.status, 0, second.stderr);
  const firstReceipt = JSON.parse(first.stdout);
  const firstAgainReceipt = JSON.parse(firstAgain.stdout);
  const secondReceipt = JSON.parse(second.stdout);
  assert.equal(firstReceipt.scheduler.idempotence_key, firstAgainReceipt.scheduler.idempotence_key);
  assert.notEqual(firstReceipt.scheduler.idempotence_key, secondReceipt.scheduler.idempotence_key);
  assert.equal(firstReceipt.scheduler.lease.lease_id, 'sleep-lease-one');
  assert.equal(secondReceipt.scheduler.lease.lease_id, 'sleep-lease-two');
});

test('rejects sleep-lease live launch when combined with human-present or dry-run flags', async () => {
  const packetPath = await writePacket(validPacket({ required_start_ref: 'HEAD' }));
  const leasePath = await writeSleepLease(validSleepLease({ max_provider_launches: 1 }));
  const outPath = join(await mkdtemp(join(tmpdir(), 'afk-sleep-live-combo-')), 'receipt.json');
  const result = runPrototype([
    '--packet',
    packetPath,
    '--provider',
    'codex',
    '--dock',
    'gdi',
    '--sleep-lease',
    leasePath,
    '--sleep-lease-live-launch',
    '--i-am-present',
    '--json',
    '--out',
    outPath,
    '--timestamp',
    fixedTimestamp,
  ]);

  assert.equal(result.status, 1);
  const receipt = JSON.parse(result.stdout);
  assert.equal(receipt.record_type, 'aos.afk_session_trigger_sleep_lease_live');
  assert.equal(receipt.dispatch.provider_launch_allowed, false);
  assert.equal(receipt.terminal_substrate.status, 'not_attempted');
  assert.ok(receipt.mismatches.some((item) => item.class === 'i_am_present_forbidden_for_sleep_lease_live'));

  const dryRunCombo = runPrototype([
    '--packet',
    packetPath,
    '--provider',
    'codex',
    '--dock',
    'gdi',
    '--sleep-lease',
    leasePath,
    '--sleep-lease-live-launch',
    '--dry-run',
    '--json',
    '--out',
    outPath,
    '--timestamp',
    fixedTimestamp,
  ]);
  assert.equal(dryRunCombo.status, 1);
  assert.ok(JSON.parse(dryRunCombo.stdout).mismatches.some((item) => item.class === 'conflicting_action_flags'));
});

test('rejects sleep-lease live launch without required sleep lease json out contract', async () => {
  const packetPath = await writePacket(validPacket({ required_start_ref: 'HEAD' }));
  const result = runPrototype([
    '--packet',
    packetPath,
    '--provider',
    'codex',
    '--dock',
    'gdi',
    '--sleep-lease-live-launch',
    '--timestamp',
    fixedTimestamp,
  ]);

  assert.equal(result.status, 1);
  const receipt = JSON.parse(result.stdout);
  const mismatchClasses = new Set(receipt.mismatches.map((item) => item.class));
  assert.ok(mismatchClasses.has('sleep_lease_live_requires_sleep_lease'), receipt.mismatches);
  assert.ok(mismatchClasses.has('json_required_for_sleep_lease_live'), receipt.mismatches);
  assert.ok(mismatchClasses.has('out_required_for_sleep_lease_live'), receipt.mismatches);
});

test('rejects sleep-lease live launch for start-gate mismatches before launch attempt', async () => {
  const packetPath = await writePacket(validPacket({
    required_start_ref: 'HEAD~1',
    result_route: { kind: 'gateway_notifier', ref: 'stdout' },
  }));
  const leasePath = await writeSleepLease(validSleepLease({
    max_provider_launches: 1,
    max_wall_clock_minutes: 0,
    allow_branch_push: true,
    result_route: 'stdout',
  }));
  const outPath = join(await mkdtemp(join(tmpdir(), 'afk-sleep-live-reject-')), 'receipt.json');
  const result = runPrototype([
    '--packet',
    packetPath,
    '--provider',
    'gemini',
    '--dock',
    'foreman',
    '--sleep-lease',
    leasePath,
    '--sleep-lease-live-launch',
    '--json',
    '--out',
    outPath,
    '--timestamp',
    fixedTimestamp,
  ]);

  assert.equal(result.status, 1);
  const receipt = JSON.parse(result.stdout);
  assert.equal(receipt.status, 'rejected');
  assert.equal(receipt.dispatch.provider_launch_allowed, false);
  assert.equal(receipt.terminal_substrate.status, 'not_attempted');
  const mismatchClasses = new Set(receipt.mismatches.map((item) => item.class));
  assert.ok(mismatchClasses.has('sleep_lease_wall_clock_minutes_exhausted'), receipt.mismatches);
  assert.ok(mismatchClasses.has('sleep_lease_branch_push_forbidden'), receipt.mismatches);
  assert.ok(mismatchClasses.has('provider_mismatch_for_sleep_lease_live'), receipt.mismatches);
  assert.ok(mismatchClasses.has('dock_mismatch_for_sleep_lease_live'), receipt.mismatches);
  assert.ok(mismatchClasses.has('sleep_lease_live_result_route_unsupported'), receipt.mismatches);
  assert.ok(mismatchClasses.has('sleep_lease_live_start_ref_mismatch'), receipt.mismatches);
  assert.equal(receipt.result_route.status, 'unsupported');
});

test('rejects sleep-lease live launch when the current worktree is dirty', async () => {
  const dirtyPath = join(repoRoot, `.afk-sleep-lease-dirty-${process.pid}`);
  const packetPath = await writePacket(validPacket({ required_start_ref: 'HEAD' }));
  const leasePath = await writeSleepLease(validSleepLease({ max_provider_launches: 1 }));
  const outPath = join(await mkdtemp(join(tmpdir(), 'afk-sleep-live-dirty-')), 'receipt.json');
  await writeFile(dirtyPath, 'temporary dirty worktree sentinel\n', 'utf8');
  try {
    const result = runPrototype([
      '--packet',
      packetPath,
      '--provider',
      'codex',
      '--dock',
      'gdi',
      '--sleep-lease',
      leasePath,
      '--sleep-lease-live-launch',
      '--json',
      '--out',
      outPath,
      '--timestamp',
      fixedTimestamp,
      '--idempotence-salt',
      'sleep-lease-live-dirty',
    ]);

    assert.equal(result.status, 1);
    const receipt = JSON.parse(result.stdout);
    assert.ok(receipt.mismatches.some((item) => item.class === 'sleep_lease_live_worktree_dirty'), receipt.mismatches);
    assert.equal(receipt.dispatch.provider_launch_allowed, false);
    assert.equal(receipt.terminal_substrate.status, 'not_attempted');
  } finally {
    await rm(dirtyPath, { force: true });
  }
});

test('runs fixture-backed sleep-lease live launch with pre-launch and final out receipts', async () => {
  const packetPath = await writePacket(validPacket({ required_start_ref: 'HEAD' }));
  const leasePath = await writeSleepLease(validSleepLease({
    max_provider_launches: 1,
    provider_budget: {
      status: 'not_enforceable_yet',
      declared_ceiling: '1 unattended sleep-lease fixture launch',
    },
  }));
  const bridgeFixture = await writeBridgeVisibilityFixture();
  const cleanupFixture = await writeCleanupProofFixture();
  const outPath = join(await mkdtemp(join(tmpdir(), 'afk-sleep-live-out-')), 'receipt.json');
  const result = runPrototype([
    '--packet',
    packetPath,
    '--provider',
    'codex',
    '--dock',
    'gdi',
    '--sleep-lease',
    leasePath,
    '--sleep-lease-live-launch',
    '--json',
    '--out',
    outPath,
    '--timestamp',
    fixedTimestamp,
    '--idempotence-salt',
    'sleep-lease-live-accepted',
    '--bridge-visibility-fixture',
    bridgeFixture,
    '--cleanup-proof-fixture',
    cleanupFixture,
  ]);

  assert.equal(result.status, 0, result.stderr);
  const receipt = JSON.parse(result.stdout);
  assert.deepEqual(JSON.parse(await readFile(outPath, 'utf8')), receipt);
  assert.equal(receipt.record_type, 'aos.afk_session_trigger_sleep_lease_live');
  assert.equal(receipt.status, 'completed');
  assert.equal(receipt.packet.validation_status, 'valid');
  assert.equal(receipt.scheduler.selected_action, 'sleep-lease-live-launch');
  assert.equal(receipt.scheduler.lifecycle_state, 'completed');
  assert.equal(receipt.scheduler.lease.status, 'accepted');
  assert.equal(receipt.sleep_lease.status, 'accepted');
  assert.deepEqual(receipt.dispatch.human_supervision, { required: false, i_am_present: false });
  assert.equal(receipt.dispatch.provider_launch_allowed, true);
  assert.equal(receipt.sleep_lease_live_start_gates.dirty_state.status, 'clean');
  assert.equal(receipt.sleep_lease_live_start_gates.current_head, receipt.sleep_lease_live_start_gates.required_start_sha);
  assert.equal(receipt.sleep_lease_live_start_gates.branch_push_policy.allow_branch_push, false);
  assert.equal(receipt.sleep_lease_live_start_gates.branch_push_policy.allow_main_mutation, false);
  assert.equal(receipt.sleep_lease_live_start_gates.provider_launch_count_budget, 1);
  assert.equal(receipt.sleep_lease_live_start_gates.selected_dock, 'gdi');
  assert.equal(receipt.sleep_lease_live_start_gates.selected_provider, 'codex');
  assert.equal(receipt.terminal_substrate.status, 'observed');
  assert.equal(receipt.provider_acceptance.status, 'provider_session_observed');
  assert.equal(receipt.cleanup.status, 'verified');
  assert.equal(receipt.result_route.status, 'completed');
  assert.deepEqual(receipt.mismatches, []);
});

test('runs fixture-backed AFK live launch with primary AFK flag spellings', async () => {
  const packetPath = await writePacket(validPacket({ required_start_ref: 'HEAD' }));
  const authorizationPath = await writeSleepLease(validSleepLease({
    max_provider_launches: 1,
    provider_budget: {
      status: 'not_enforceable_yet',
      declared_ceiling: '1 AFK live launch fixture',
    },
  }));
  const bridgeFixture = await writeBridgeVisibilityFixture();
  const cleanupFixture = await writeCleanupProofFixture();
  const outPath = join(await mkdtemp(join(tmpdir(), 'afk-live-out-')), 'receipt.json');
  const result = runPrototype([
    '--packet',
    packetPath,
    '--provider',
    'codex',
    '--dock',
    'gdi',
    '--afk-authorization',
    authorizationPath,
    '--afk-live-launch',
    '--json',
    '--out',
    outPath,
    '--timestamp',
    fixedTimestamp,
    '--idempotence-salt',
    'afk-live-accepted',
    '--bridge-visibility-fixture',
    bridgeFixture,
    '--cleanup-proof-fixture',
    cleanupFixture,
  ]);

  assert.equal(result.status, 0, result.stderr);
  const receipt = JSON.parse(result.stdout);
  assert.deepEqual(JSON.parse(await readFile(outPath, 'utf8')), receipt);
  assert.equal(receipt.record_type, 'aos.afk_session_trigger_sleep_lease_live');
  assert.equal(receipt.status, 'completed');
  assert.equal(receipt.scheduler.selected_action, 'sleep-lease-live-launch');
  assert.equal(receipt.scheduler.lease.status, 'accepted');
  assert.equal(receipt.sleep_lease.status, 'accepted');
  assert.equal(receipt.dispatch.provider_launch_allowed, true);
  assert.deepEqual(receipt.mismatches, []);
});

test('runs fixture-backed sleep-lease live launch with matching local artifact route', async () => {
  const outPath = join(await mkdtemp(join(tmpdir(), 'afk-sleep-live-local-route-')), 'receipt.json');
  const packetPath = await writePacket(validPacket({
    required_start_ref: 'HEAD',
    result_route: { kind: 'local_artifact_path', ref: outPath },
  }));
  const leasePath = await writeSleepLease(validSleepLease({
    max_provider_launches: 1,
    provider_budget: {
      status: 'not_enforceable_yet',
      declared_ceiling: '1 unattended sleep-lease fixture launch',
    },
    result_route: outPath,
  }));
  const bridgeFixture = await writeBridgeVisibilityFixture();
  const cleanupFixture = await writeCleanupProofFixture();
  const result = runPrototype([
    '--packet',
    packetPath,
    '--provider',
    'codex',
    '--dock',
    'gdi',
    '--sleep-lease',
    leasePath,
    '--sleep-lease-live-launch',
    '--json',
    '--out',
    outPath,
    '--timestamp',
    fixedTimestamp,
    '--idempotence-salt',
    'sleep-lease-live-local-artifact-accepted',
    '--bridge-visibility-fixture',
    bridgeFixture,
    '--cleanup-proof-fixture',
    cleanupFixture,
  ]);

  assert.equal(result.status, 0, result.stderr);
  const receipt = JSON.parse(result.stdout);
  assert.deepEqual(JSON.parse(await readFile(outPath, 'utf8')), receipt);
  assert.equal(receipt.status, 'completed');
  assert.equal(receipt.dispatch.provider_launch_allowed, true);
  assert.equal(receipt.result_route.status, 'completed');
  assert.equal(receipt.result_route.delivered_refs[0].ref, outPath);
  assert.equal(receipt.result_route.delivered_refs[0].resolved_path, outPath);
  assert.deepEqual(receipt.mismatches, []);
});

test('rejects sleep-lease live launch before provider attempt when local artifact route differs from out', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'afk-sleep-live-route-mismatch-'));
  const outPath = join(dir, 'receipt.json');
  const routePath = join(dir, 'not-output.json');
  const packetPath = await writePacket(validPacket({
    required_start_ref: 'HEAD',
    result_route: { kind: 'local_artifact_path', ref: routePath },
  }));
  const leasePath = await writeSleepLease(validSleepLease({
    max_provider_launches: 1,
    provider_budget: {
      status: 'not_enforceable_yet',
      declared_ceiling: '1 unattended sleep-lease fixture launch',
    },
    result_route: routePath,
  }));
  const bridgeFixture = await writeBridgeVisibilityFixture();
  const cleanupFixture = await writeCleanupProofFixture();
  const result = runPrototype([
    '--packet',
    packetPath,
    '--provider',
    'codex',
    '--dock',
    'gdi',
    '--sleep-lease',
    leasePath,
    '--sleep-lease-live-launch',
    '--json',
    '--out',
    outPath,
    '--timestamp',
    fixedTimestamp,
    '--idempotence-salt',
    'sleep-lease-live-local-artifact-rejected',
    '--bridge-visibility-fixture',
    bridgeFixture,
    '--cleanup-proof-fixture',
    cleanupFixture,
  ]);

  assert.equal(result.status, 1);
  const receipt = JSON.parse(result.stdout);
  assert.deepEqual(JSON.parse(await readFile(outPath, 'utf8')), receipt);
  assert.equal(receipt.status, 'rejected');
  assert.equal(receipt.scheduler.lease.status, 'rejected');
  assert.equal(receipt.dispatch.provider_launch_allowed, false);
  assert.equal(receipt.dispatch.launch_attempt_id, 'not_attempted');
  assert.equal(receipt.terminal_substrate.status, 'not_attempted');
  assert.equal(receipt.provider_acceptance.status, 'not_attempted');
  assert.equal(receipt.result_route.status, 'failed');
  assert.equal(receipt.result_route.failure[0].code, 'result_route_write_not_confirmed');
  assert.ok(receipt.mismatches.some((item) => item.class === 'sleep_lease_live_result_route_undeliverable'));
});

test('rejects malformed sleep lease authorization fields', async () => {
  const packetPath = await writePacket(validPacket());
  const leasePath = await writeSleepLease(validSleepLease({
    expires_at: '4 hours from now',
    max_wall_clock_minutes: -1,
    max_provider_launches: -1,
    provider_budget: undefined,
    allowed_work_refs: ['*'],
    allowed_branch_policy: {
      create_branch: true,
      branch_prefix: 'gdi/',
      allow_main_mutation: true,
    },
  }));
  const result = runPrototype([
    '--packet',
    packetPath,
    '--provider',
    'codex',
    '--dock',
    'gdi',
    '--sleep-lease',
    leasePath,
    '--dry-run',
    '--json',
    '--timestamp',
    fixedTimestamp,
  ]);

  assert.equal(result.status, 1);
  const receipt = JSON.parse(result.stdout);
  assert.equal(receipt.status, 'rejected');
  assert.equal(receipt.dispatch.provider_launch_allowed, false);
  const mismatchClasses = new Set(receipt.mismatches.map((item) => item.class));
  assert.ok(mismatchClasses.has('sleep_lease_expires_at_relative_or_local'), receipt.mismatches);
  assert.ok(mismatchClasses.has('sleep_lease_max_wall_clock_minutes_invalid'), receipt.mismatches);
  assert.ok(mismatchClasses.has('sleep_lease_max_provider_launches_invalid'), receipt.mismatches);
  assert.ok(mismatchClasses.has('sleep_lease_provider_budget_invalid'), receipt.mismatches);
  assert.ok(mismatchClasses.has('sleep_lease_allowed_work_refs_broad'), receipt.mismatches);
  assert.ok(mismatchClasses.has('sleep_lease_main_mutation_forbidden'), receipt.mismatches);
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

test('normalizes stdout route-object shorthands as local artifact routes', async () => {
  for (const resultRoute of [
    { kind: 'stdout' },
    { ref: 'stdout' },
    { path: 'stdout' },
    { artifact_path: 'stdout' },
  ]) {
    const packetPath = await writePacket(validPacket({
      result_route: resultRoute,
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
    assert.equal(receipt.result_route.status, 'completed');
    assert.deepEqual(receipt.result_route.refs, [{ ...resultRoute, kind: 'local_artifact_path', ref: 'stdout' }]);
    assert.deepEqual(receipt.result_route.attempt_refs, [{ ...resultRoute, kind: 'local_artifact_path', ref: 'stdout' }]);
    assert.deepEqual(receipt.result_route.delivered_refs, [{ ...resultRoute, kind: 'local_artifact_path', ref: 'stdout' }]);
    assert.equal(receipt.result_route.failure, 'not_observed');
  }
});

test('keeps arbitrary non-stdout route objects unsupported', async () => {
  const packetPath = await writePacket(validPacket({
    result_route: [
      { ref: 'slack-thread-123' },
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
  assert.equal(receipt.result_route.status, 'unsupported');
  assert.deepEqual(receipt.result_route.delivered_refs, []);
  assert.equal(receipt.result_route.failure[0].code, 'result_route_unsupported');
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
  assert.equal(receipt.terminal_substrate.driver, 'manual_tui');
  assert.equal(receipt.terminal_substrate.session_handle, 'gdi-warm-codex');
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

test('preserves Agent Terminal dock session fixture facts in warm dock TUI reuse receipt', async () => {
  const previousSessionId = '019e7300-cccc-7222-8333-444444444444';
  const newSessionId = '019e7300-dddd-7222-8333-444444444444';
  const packetPath = await writePacket(validPacket({
    previous_provider_session_id: previousSessionId,
  }));
  const intendedLaunchCwd = join(repoRoot, '.docks/gdi');
  const bridgeFixture = await writeJsonFixture('afk-session-trigger-bridge-', 'bridge.json', {
    providerSessionId: newSessionId,
    warm_tui_reuse: {
      previous_provider_session_id: previousSessionId,
      new_provider_session_id: newSessionId,
    },
    dock_terminal_session: {
      record_type: 'aos.dock_terminal_session',
      dock: 'gdi',
      dock_terminal_session_id: 'dock-terminal:gdi:session-trigger-agent-terminal',
      cwd: intendedLaunchCwd,
      provider: 'codex',
      provider_command: ['node', '-e', 'setTimeout(() => {}, 100)'],
      pty: {
        driver: 'aos_pty_process_fixture',
        handle: 'sigil-agent-terminal-test',
        cols: 132,
        rows: 43,
      },
      lifecycle: { state: 'running' },
      lease: {
        holder: 'agent_terminal',
        purpose: 'observation',
        disposition: 'returned_to_idle',
      },
    },
    agent_terminal_observation: {
      record_type: 'aos.agent_terminal_observation',
      dock_terminal_session_id: 'dock-terminal:gdi:session-trigger-agent-terminal',
      dock: 'gdi',
      rendered_by: 'agent_terminal',
      attach_state: 'attached',
      cwd: intendedLaunchCwd,
      command: ['node', '-e', 'setTimeout(() => {}, 100)'],
      geometry: { cols: 132, rows: 43 },
      acceptance_role: 'human_observability_only',
      provider_acceptance: {
        status: 'provider_session_observed',
        provider_session_id: newSessionId,
        reason: 'Agent Terminal visual state is not provider acceptance evidence',
      },
    },
    bridge: {
      provider_launch_performed: false,
      input: {
        text_accepted: true,
        enter_accepted: true,
      },
    },
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
    '2026-05-22T20:20:00.000Z',
    '--idempotence-salt',
    'warm-tui-reuse-agent-terminal-session-trigger',
    '--bridge-visibility-fixture',
    bridgeFixture,
  ]);

  assert.equal(result.status, 0, result.stderr);
  const receipt = JSON.parse(result.stdout);
  assert.equal(receipt.status, 'completed');
  assert.equal(receipt.terminal_substrate.owner, 'aos.dock_terminal_session');
  assert.equal(receipt.terminal_substrate.dock_terminal_session_id, 'dock-terminal:gdi:session-trigger-agent-terminal');
  assert.equal(receipt.terminal_substrate.driver, 'aos_pty_process_fixture');
  assert.equal(receipt.terminal_substrate.session_handle, 'sigil-agent-terminal-test');
  assert.deepEqual(receipt.terminal_substrate.geometry, { cols: 132, rows: 43 });
  assert.deepEqual(receipt.terminal_substrate.provider_command, ['node', '-e', 'setTimeout(() => {}, 100)']);
  assert.equal(receipt.terminal_substrate.command, 'warm-dock-tui-reuse');
  assert.equal(receipt.terminal_substrate.agent_terminal_observation.acceptance_role, 'human_observability_only');
  assert.equal(receipt.terminal_substrate.agent_terminal_observation.provider_acceptance.status, 'not_evidence');
  assert.equal(
    receipt.terminal_substrate.agent_terminal_observation.provider_acceptance.reason,
    'Agent Terminal visual state is not provider acceptance evidence',
  );
  assert.equal(receipt.provider_acceptance.status, 'provider_session_observed');
  assert.equal(receipt.provider_acceptance.provider_session_id, newSessionId);
  assert.equal(receipt.warm_tui_reuse.provider_session_changed, true);
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
