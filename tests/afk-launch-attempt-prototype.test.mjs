import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { test } from 'node:test';

const repoRoot = resolve(new URL('..', import.meta.url).pathname);
const scriptPath = join(repoRoot, 'scripts', 'afk-launch-attempt-prototype.mjs');
const fixedTimestamp = '2026-05-22T02:00:00.000Z';
const operatorLaunchObservedAt = '2026-05-22T12:58:00.000Z';

function runPrototype(args) {
  return spawnSync(process.execPath, [scriptPath, ...args], {
    cwd: repoRoot,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

async function writePacket(packet) {
  const dir = await mkdtemp(join(tmpdir(), 'afk-launch-attempt-packet-'));
  const packetPath = join(dir, 'packet.json');
  await writeFile(packetPath, `${JSON.stringify(packet, null, 2)}\n`, 'utf8');
  return packetPath;
}

async function writeCatalogFixture(fixture) {
  const dir = await mkdtemp(join(tmpdir(), 'afk-launch-attempt-catalog-'));
  const fixturePath = join(dir, 'catalog.json');
  await writeFile(fixturePath, `${JSON.stringify(fixture, null, 2)}\n`, 'utf8');
  return fixturePath;
}

function validPacket(overrides = {}) {
  return {
    packet_id: 'manual-afk-launch-attempt-test',
    source_artifact: 'docs/design/work-cards/afk-launch-attempt-prototype-no-provider-v0.md',
    requested_recipient: 'gdi',
    cwd: repoRoot,
    worktree: repoRoot,
    branch_policy: 'keep local-only',
    required_start_ref: 'docs/durable-agent-cognition-v0',
    provider_hint: 'codex',
    result_route: [
      {
        kind: 'local_artifact_path',
        ref: 'stdout',
      },
    ],
    external_publication_policy: 'local-only',
    timeout_or_lease: {
      lease: 'current launch-attempt prototype invocation',
      heartbeat: 'not_applicable',
    },
    goal: 'create no-provider launch attempt with bridge substrate proof',
    ...overrides,
  };
}

test('creates a no-provider launch-attempt record with process bridge substrate facts', async () => {
  const packetPath = await writePacket(validPacket());
  const result = runPrototype([
    '--packet',
    packetPath,
    '--provider',
    'codex',
    '--dock',
    'gdi',
    '--json',
    '--timestamp',
    fixedTimestamp,
  ]);

  assert.equal(result.status, 0, result.stderr);
  const record = JSON.parse(result.stdout);
  assert.equal(record.record_type, 'aos.afk_launch_attempt');
  assert.equal(record.schema_status, 'not_a_schema');
  assert.equal(record.created_at, fixedTimestamp);
  assert.equal(record.lifecycle_state, 'provider_acceptance_unobserved');
  assert.match(record.launch_attempt_id, /^launch-attempt-[a-f0-9]{16}$/);
  assert.match(record.scheduler_run_id, /^prototype-scheduler-[a-f0-9]{16}$/);
  assert.match(record.dispatch_attempt_id, /^prototype-dispatch-[a-f0-9]{16}$/);
  assert.match(record.idempotence_key, /^[a-f0-9]{32}$/);
  assert.equal(record.transfer.packet_id_or_ref, 'manual-afk-launch-attempt-test');
  assert.equal(record.transfer.source_event_or_artifact, 'docs/design/work-cards/afk-launch-attempt-prototype-no-provider-v0.md');
  assert.equal(record.transfer.required_start_ref, 'docs/durable-agent-cognition-v0');
  assert.match(record.transfer.start_ref_sha, /^[a-f0-9]{40}$/);
  assert.equal(record.transfer.external_publication_policy, 'local-only');
  assert.deepEqual(record.selection, {
    selected_provider: 'codex',
    provider_selection_source: 'explicit_option',
    selected_dock: 'gdi',
    dock_role_kind: 'gdi',
    dock_profile_ref: '.docks/gdi/dock.json',
    launch_root: '.docks/gdi',
  });
  assert.equal(record.launch_intent.action, 'start');
  assert.equal(record.launch_intent.intended_worktree, repoRoot);
  assert.equal(record.launch_intent.intended_launch_cwd, join(repoRoot, '.docks/gdi'));
  assert.equal(record.launch_intent.launch_requested, true);
  assert.equal(record.launch_intent.launch_performed, true);
  assert.equal(record.launch_intent.provider_launch_performed, false);
  assert.doesNotMatch(record.launch_intent.command, /\b(codex|claude|gemini)\b/i);
  assert.deepEqual(record.launch_intent.command_argv, [
    'node',
    '-e',
    '<harmless marker command>',
  ]);
  assert.equal(record.terminal_substrate.status, 'observed');
  assert.equal(record.terminal_substrate.driver, 'process');
  assert.match(record.terminal_substrate.session_handle, /^afk-launch-[a-f0-9]{12}$/);
  assert.equal(record.terminal_substrate.cwd, join(repoRoot, '.docks/gdi'));
  assert.equal(record.terminal_substrate.command, record.launch_intent.command);
  assert.equal(record.terminal_substrate.snapshot_ref, 'inline:terminal_substrate.snapshot_summary');
  assert.equal(record.terminal_substrate.snapshot_summary.includes_marker, true);
  assert.match(record.terminal_substrate.snapshot_summary.text_excerpt, /afk-launch-attempt-marker/);
  assert.equal(record.terminal_substrate.bridge_health.driver, 'process');
  assert.equal(record.provider_acceptance.status, 'not_applicable: no-provider-launch');
  assert.equal(record.provider_acceptance.provider_session_id, 'not_applicable: no-provider-launch');
  assert.equal(record.catalog.status, 'not_observed');
  assert.equal(record.catalog.catalog_record_refs, 'not_observed');
  assert.equal(record.telemetry.status, 'not_observed');
  assert.equal(record.telemetry.telemetry_event_refs, 'not_observed');
  assert.equal(record.result_route.status, 'not_attempted');
  assert.deepEqual(record.mismatches, []);
  assert.deepEqual(record.evidence.observed_refs, ['inline:terminal_substrate.snapshot_summary']);
  assert.equal(record.duplicate_handling.bridge_session_started, true);
  assert.ok(record.validations.every((validation) => validation.status === 'passed'));
});

test('reuses the in-process attempt for a duplicate idempotence key', async () => {
  const packetPath = await writePacket(validPacket());
  const result = runPrototype([
    '--packet',
    packetPath,
    '--provider',
    'codex',
    '--dock',
    'gdi',
    '--json',
    '--timestamp',
    fixedTimestamp,
    '--duplicate-in-process',
  ]);

  assert.equal(result.status, 0, result.stderr);
  const bundle = JSON.parse(result.stdout);
  assert.equal(bundle.type, 'aos.afk_launch_attempt.prototype_duplicate_check');
  assert.equal(bundle.bridge_sessions_started, 1);
  assert.equal(bundle.first.idempotence_key, bundle.duplicate.idempotence_key);
  assert.equal(bundle.first.launch_attempt_id, bundle.duplicate.launch_attempt_id);
  assert.equal(bundle.first.duplicate_handling.duplicate, false);
  assert.equal(bundle.first.duplicate_handling.bridge_session_started, true);
  assert.equal(bundle.duplicate.duplicate_handling.duplicate, true);
  assert.equal(bundle.duplicate.duplicate_handling.bridge_session_started, false);
  assert.equal(bundle.duplicate.duplicate_handling.reused_launch_attempt_id, bundle.first.launch_attempt_id);
  assert.equal(bundle.duplicate.lifecycle_state, 'provider_acceptance_unobserved');
});

test('rejects unsupported provider before terminal substrate work', async () => {
  const packetPath = await writePacket(validPacket());
  const result = runPrototype([
    '--packet',
    packetPath,
    '--provider',
    'unsupported-provider',
    '--dock',
    'gdi',
    '--json',
    '--timestamp',
    fixedTimestamp,
  ]);

  assert.equal(result.status, 1);
  assert.equal(result.stderr, '');
  const record = JSON.parse(result.stdout);
  assert.equal(record.lifecycle_state, 'rejected');
  assert.equal(record.selection.selected_provider, 'unsupported-provider');
  assert.equal(record.terminal_substrate.status, 'not_observed');
  assert.equal(record.launch_intent.launch_performed, false);
  assert.equal(record.launch_intent.provider_launch_performed, false);
  assert.deepEqual(record.mismatches.map((mismatch) => mismatch.code), ['unsupported_provider']);
  assert.equal(
    record.validations.find((validation) => validation.name === 'selected_provider_supported_without_launch').status,
    'failed',
  );
});

test('rejects missing packet facts and current-state mismatches before bridge start', async () => {
  const missingPath = join(tmpdir(), 'aos-afk-launch-missing-worktree-never-exists');
  const packetPath = await writePacket(validPacket({
    packet_id: undefined,
    source_artifact: 'docs/design/work-cards/missing-launch-attempt-card.md',
    cwd: missingPath,
    worktree: missingPath,
    required_start_ref: 'missing/ref/for-launch-attempt-test',
  }));
  const result = runPrototype([
    '--packet',
    packetPath,
    '--provider',
    'codex',
    '--dock',
    'gdi',
    '--json',
    '--timestamp',
    fixedTimestamp,
  ]);

  assert.equal(result.status, 1);
  assert.equal(result.stderr, '');
  const record = JSON.parse(result.stdout);
  assert.equal(record.lifecycle_state, 'rejected');
  assert.equal(record.terminal_substrate.status, 'not_observed');
  assert.equal(record.duplicate_handling.bridge_session_started, false);
  assert.equal(
    record.validations.find((validation) => validation.name === 'packet_id_or_ref_present').status,
    'failed',
  );
  assert.equal(
    record.validations.find((validation) => validation.name === 'source_artifact_exists_when_repo_path').status,
    'failed',
  );
  assert.equal(
    record.validations.find((validation) => validation.name === 'cwd_resolves_to_repo_root').status,
    'failed',
  );
  assert.equal(
    record.validations.find((validation) => validation.name === 'worktree_exists').status,
    'failed',
  );
  assert.equal(
    record.validations.find((validation) => validation.name === 'required_start_ref_resolves').status,
    'failed',
  );
});

test('writes an explicit local output path without creating committed artifacts', async () => {
  const packetPath = await writePacket(validPacket());
  const dir = await mkdtemp(join(tmpdir(), 'afk-launch-attempt-output-'));
  const outPath = join(dir, 'launch-attempt.json');
  const result = runPrototype([
    '--packet',
    packetPath,
    '--provider',
    'codex',
    '--dock',
    'gdi',
    '--json',
    '--timestamp',
    fixedTimestamp,
    '--out',
    outPath,
  ]);

  assert.equal(result.status, 0, result.stderr);
  assert.equal(existsSync(outPath), true);
  const fromStdout = JSON.parse(result.stdout);
  const fromFile = JSON.parse(await readFile(outPath, 'utf8'));
  assert.deepEqual(fromFile, fromStdout);
});

test('classifies stale catalog session as current launch not observed', async () => {
  const packetPath = await writePacket(validPacket());
  const launchCwd = join(repoRoot, '.docks/gdi');
  const catalogPath = await writeCatalogFixture({
    sessions: [
      {
        provider: 'codex',
        session_id: '019e4e49-9d18-7531-9859-3b834f034d14',
        cwd: launchCwd,
        updated_at: '2026-05-22T06:11:41.000Z',
        source_file: '/tmp/stale-codex-session.jsonl',
        resume_command: 'codex resume 019e4e49-9d18-7531-9859-3b834f034d14',
        telemetry_observed: true,
        telemetry_event_refs: ['inline:stale-telemetry-must-not-bind'],
      },
    ],
  });

  const result = runPrototype([
    '--packet',
    packetPath,
    '--provider',
    'codex',
    '--dock',
    'gdi',
    '--json',
    '--timestamp',
    fixedTimestamp,
    '--launch-observed-at',
    operatorLaunchObservedAt,
    '--catalog-fixture',
    catalogPath,
  ]);

  assert.equal(result.status, 0, result.stderr);
  const record = JSON.parse(result.stdout);
  assert.equal(record.catalog.status, 'catalog_current_launch_not_observed');
  assert.deepEqual(record.catalog.catalog_record_refs, ['codex:019e4e49-9d18-7531-9859-3b834f034d14']);
  assert.equal(record.catalog.match_count, 0);
  assert.equal(record.catalog.matched_session_id, 'not_observed');
  assert.equal(record.catalog.launch_observed_at, operatorLaunchObservedAt);
  assert.equal(record.telemetry.status, 'telemetry_current_launch_not_observed');
  assert.equal(record.telemetry.telemetry_event_refs, 'not_observed');
  assert.deepEqual(record.mismatches.map((mismatch) => mismatch.code), ['catalog_current_launch_not_observed']);
});

test('classifies empty provider cwd catalog as not observed with telemetry not attempted', async () => {
  const packetPath = await writePacket(validPacket());
  const catalogPath = await writeCatalogFixture({ sessions: [] });

  const result = runPrototype([
    '--packet',
    packetPath,
    '--provider',
    'codex',
    '--dock',
    'gdi',
    '--json',
    '--timestamp',
    fixedTimestamp,
    '--launch-observed-at',
    operatorLaunchObservedAt,
    '--catalog-fixture',
    catalogPath,
  ]);

  assert.equal(result.status, 0, result.stderr);
  const record = JSON.parse(result.stdout);
  assert.equal(record.catalog.status, 'catalog_not_observed');
  assert.equal(record.catalog.catalog_record_refs, 'not_observed');
  assert.equal(record.catalog.match_count, 0);
  assert.equal(record.telemetry.status, 'telemetry_not_attempted_no_catalog_match');
  assert.equal(record.telemetry.telemetry_event_refs, 'not_observed');
  assert.deepEqual(record.mismatches, []);
});

test('classifies one current catalog candidate without known provider session id', async () => {
  const packetPath = await writePacket(validPacket());
  const launchCwd = join(repoRoot, '.docks/gdi');
  const catalogPath = await writeCatalogFixture({
    sessions: [
      {
        provider: 'codex',
        session_id: 'candidate-current-session',
        cwd: launchCwd,
        updated_at: '2026-05-22T12:58:30.000Z',
        telemetry_observed: false,
      },
    ],
  });

  const result = runPrototype([
    '--packet',
    packetPath,
    '--provider',
    'codex',
    '--dock',
    'gdi',
    '--json',
    '--timestamp',
    fixedTimestamp,
    '--launch-observed-at',
    operatorLaunchObservedAt,
    '--catalog-fixture',
    catalogPath,
  ]);

  assert.equal(result.status, 0, result.stderr);
  const record = JSON.parse(result.stdout);
  assert.equal(record.catalog.status, 'catalog_candidate_current_launch_observed');
  assert.equal(record.catalog.match_count, 1);
  assert.equal(record.catalog.matched_session_id, 'candidate-current-session');
  assert.equal(record.telemetry.status, 'telemetry_not_observed');
  assert.equal(record.telemetry.telemetry_event_refs, 'not_observed');
  assert.deepEqual(record.mismatches, []);
});

test('classifies exact catalog match with telemetry when provider session id is known', async () => {
  const packetPath = await writePacket(validPacket());
  const launchCwd = join(repoRoot, '.docks/gdi');
  const catalogPath = await writeCatalogFixture({
    sessions: [
      {
        provider: 'codex',
        session_id: 'current-known-session',
        cwd: launchCwd,
        updated_at: '2026-05-22T12:59:00.000Z',
        source_file: '/tmp/current-known-session.jsonl',
        resume_command: 'codex resume current-known-session',
        telemetry_observed: true,
        telemetry_event_refs: ['inline:current-known-session:tokens'],
      },
    ],
  });

  const result = runPrototype([
    '--packet',
    packetPath,
    '--provider',
    'codex',
    '--dock',
    'gdi',
    '--json',
    '--timestamp',
    fixedTimestamp,
    '--launch-observed-at',
    operatorLaunchObservedAt,
    '--provider-session-id',
    'current-known-session',
    '--catalog-fixture',
    catalogPath,
  ]);

  assert.equal(result.status, 0, result.stderr);
  const record = JSON.parse(result.stdout);
  assert.equal(record.catalog.status, 'catalog_matched');
  assert.equal(record.catalog.match_count, 1);
  assert.equal(record.catalog.matched_session_id, 'current-known-session');
  assert.equal(record.catalog.source_file, '/tmp/current-known-session.jsonl');
  assert.equal(record.telemetry.status, 'telemetry_observed');
  assert.deepEqual(record.telemetry.telemetry_event_refs, ['inline:current-known-session:tokens']);
  assert.deepEqual(record.mismatches, []);
});

test('classifies multiple current catalog candidates as ambiguous', async () => {
  const packetPath = await writePacket(validPacket());
  const launchCwd = join(repoRoot, '.docks/gdi');
  const catalogPath = await writeCatalogFixture({
    sessions: [
      {
        provider: 'codex',
        session_id: 'candidate-one',
        cwd: launchCwd,
        updated_at: '2026-05-22T12:58:30.000Z',
      },
      {
        provider: 'codex',
        session_id: 'candidate-two',
        cwd: launchCwd,
        updated_at: '2026-05-22T12:59:00.000Z',
      },
    ],
  });

  const result = runPrototype([
    '--packet',
    packetPath,
    '--provider',
    'codex',
    '--dock',
    'gdi',
    '--json',
    '--timestamp',
    fixedTimestamp,
    '--launch-observed-at',
    operatorLaunchObservedAt,
    '--catalog-fixture',
    catalogPath,
  ]);

  assert.equal(result.status, 0, result.stderr);
  const record = JSON.parse(result.stdout);
  assert.equal(record.catalog.status, 'multiple_catalog_candidates');
  assert.equal(record.catalog.match_count, 2);
  assert.equal(record.catalog.matched_session_id, 'not_observed');
  assert.equal(record.telemetry.status, 'telemetry_current_launch_not_observed');
  assert.deepEqual(record.mismatches.map((mismatch) => mismatch.code), ['multiple_catalog_candidates']);
});
