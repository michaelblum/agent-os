import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';

const repoRoot = resolve(new URL('..', import.meta.url).pathname);
const scriptPath = join(repoRoot, 'scripts', 'afk-dry-run-prototype.mjs');
const fixedTimestamp = '2026-05-22T00:00:00.000Z';

function runPrototype(args) {
  return spawnSync(process.execPath, [scriptPath, ...args], {
    cwd: repoRoot,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

async function writePacket(packet) {
  const dir = await mkdtemp(join(tmpdir(), 'afk-dry-run-prototype-'));
  const packetPath = join(dir, 'packet.json');
  await writeFile(packetPath, `${JSON.stringify(packet, null, 2)}\n`, 'utf8');
  return packetPath;
}

function validPacket(overrides = {}) {
  return {
    packet_id: 'manual-afk-packet-test',
    source_artifact: 'docs/design/work-cards/afk-dry-run-prototype-v0.md',
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
    evidence_requirements: [
      'node --test tests/afk-dry-run-prototype.test.mjs',
      'git diff --check',
    ],
    stop_conditions: [
      'provider launch requested',
      'missing source artifact',
    ],
    external_publication_policy: 'no GitHub mutation; keep checkpoint local unless explicitly asked',
    timeout_or_lease: {
      lease: 'current dry-run invocation',
      heartbeat: 'not_applicable',
    },
    goal: 'validate manual packet and emit receipt bundle',
    ...overrides,
  };
}

test('emits deterministic receipt bundle for a valid dry run without provider launch', async () => {
  const packetPath = await writePacket(validPacket());
  const args = [
    '--packet',
    packetPath,
    '--provider',
    'codex',
    '--dock',
    'gdi',
    '--json',
    '--timestamp',
    fixedTimestamp,
  ];

  const first = runPrototype(args);
  const second = runPrototype(args);

  assert.equal(first.status, 0, first.stderr);
  assert.equal(second.status, 0, second.stderr);
  assert.equal(first.stdout, second.stdout);

  const receipt = JSON.parse(first.stdout);
  assert.equal(receipt.experimental, true);
  assert.equal(receipt.schema_status, 'not_a_schema');
  assert.equal(receipt.final_status, 'completed');
  assert.equal(receipt.created_at, fixedTimestamp);
  assert.equal(receipt.updated_at, fixedTimestamp);
  assert.equal(receipt.transfer.packet_id_or_ref, 'manual-afk-packet-test');
  assert.equal(receipt.transfer.source_artifact_status.status, 'present');
  assert.equal(receipt.transfer.required_start_ref, 'docs/durable-agent-cognition-v0');
  assert.match(receipt.transfer.start_ref_sha, /^[a-f0-9]{40}$/);
  assert.equal(receipt.dispatch.selected_provider, 'codex');
  assert.equal(receipt.dispatch.provider_selection.launch_performed, false);
  assert.equal(receipt.dispatch.provider_session_id, 'not_applicable: dry-run/no-provider-launch');
  assert.equal(receipt.dispatch.selected_dock_profile.dock, 'gdi');
  assert.equal(receipt.dispatch.selected_dock_profile.role, 'gdi');
  assert.equal(receipt.dispatch.selected_dock_profile.default_entry_path, 'aos_developer');
  assert.ok(receipt.dispatch.selected_dock_profile.allowed_entry_paths.includes('testing'));
  assert.equal(receipt.dispatch.selected_dock_profile.launch_root, '.docks/gdi');
  assert.deepEqual(receipt.scheduler.lifecycle_state_transitions, [
    'queued',
    'accepted',
    'launching',
    'completed',
  ]);
  assert.deepEqual(receipt.work.changed_paths, []);
  assert.ok(receipt.work.artifacts_deliberately_not_created.includes('provider session'));
  assert.ok(receipt.evidence.missing_evidence_explanations.some((entry) => entry.includes('never launches')));
  assert.ok(receipt.validations.every((validation) => validation.status === 'passed'));
});

test('uses packet provider hint when no provider option is supplied', async () => {
  const packetPath = await writePacket(validPacket({ provider_hint: 'gemini' }));
  const result = runPrototype([
    '--packet',
    packetPath,
    '--dock',
    'gdi',
    '--json',
    '--timestamp',
    fixedTimestamp,
  ]);

  assert.equal(result.status, 0, result.stderr);
  const receipt = JSON.parse(result.stdout);
  assert.equal(receipt.dispatch.selected_provider, 'gemini');
  assert.equal(receipt.dispatch.provider_selection.selection_source, 'packet_provider_hint');
  assert.equal(receipt.dispatch.provider_selection.availability_status, 'selected_dry_run_not_launched');
});

test('fails honestly when required packet facts or current-state validations are missing', async () => {
  const packetPath = await writePacket(validPacket({
    packet_id: undefined,
    source_artifact: 'docs/design/work-cards/missing-afk-card.md',
    required_start_ref: 'missing/ref/for-afk-dry-run-test',
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
  const receipt = JSON.parse(result.stdout);
  assert.equal(receipt.final_status, 'failed');
  assert.equal(receipt.scheduler.intake_decision, 'rejected');
  assert.equal(receipt.work.blocker_class, 'validation_failed');
  assert.equal(
    receipt.validations.find((validation) => validation.name === 'packet_id_or_ref_present').status,
    'failed',
  );
  assert.equal(
    receipt.validations.find((validation) => validation.name === 'source_artifact_exists_when_repo_path').status,
    'failed',
  );
  assert.equal(
    receipt.validations.find((validation) => validation.name === 'required_start_ref_resolves').status,
    'failed',
  );
});

test('emits structured failed receipt for missing cwd and worktree paths', async () => {
  const missingPath = join(tmpdir(), 'aos-afk-missing-cwd-never-exists');
  const packetPath = await writePacket(validPacket({
    packet_id: 'bad-cwd',
    cwd: missingPath,
    worktree: missingPath,
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
  const receipt = JSON.parse(result.stdout);
  assert.equal(receipt.type, 'aos.afk_dry_run_receipt_bundle.prototype');
  assert.notEqual(receipt.type, 'aos.afk_dry_run_receipt_bundle.prototype_error');
  assert.equal(receipt.final_status, 'failed');
  assert.equal(receipt.scheduler.intake_decision, 'rejected');
  assert.equal(receipt.work.blocker_class, 'validation_failed');

  const cwdValidation = receipt.validations.find((validation) => validation.name === 'cwd_resolves_to_repo_root');
  assert.equal(cwdValidation.status, 'failed');
  assert.equal(cwdValidation.cwd, missingPath);
  assert.match(cwdValidation.reason, /cwd path does not exist/);

  const worktreeValidation = receipt.validations.find((validation) => validation.name === 'worktree_exists');
  assert.equal(worktreeValidation.status, 'failed');
  assert.equal(worktreeValidation.path, missingPath);
  assert.match(worktreeValidation.reason, /worktree_exists path does not exist/);
});

test('rejects explicit provider launch requests before dispatch facts can imply execution', async () => {
  const packetPath = await writePacket(validPacket());
  const result = runPrototype([
    '--packet',
    packetPath,
    '--provider',
    'codex',
    '--dock',
    'gdi',
    '--json',
    '--allow-provider-launch',
  ]);

  assert.equal(result.status, 1);
  assert.equal(result.stdout, '');
  const error = JSON.parse(result.stderr);
  assert.equal(error.final_status, 'failed');
  assert.match(error.error, /Provider launch is outside this dry-run prototype/);
});

test('can write an explicit local output path without creating committed artifacts', async () => {
  const packetPath = await writePacket(validPacket());
  const dir = await mkdtemp(join(tmpdir(), 'afk-dry-run-output-'));
  const outPath = join(dir, 'receipt.json');
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
  assert.deepEqual(fromFile.work.artifacts_created, [outPath]);
});
