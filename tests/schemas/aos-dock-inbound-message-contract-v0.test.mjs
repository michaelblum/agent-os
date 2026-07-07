import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { dockInboundContractsRetiredError } from '../../scripts/lib/dock-inbound-message-contract.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../..');
const schemaPath = path.join(repoRoot, 'shared/schemas/aos-dock-inbound-message-contract-v0.schema.json');
const clipboardPayloadPolicyKey = ['clipboard', 'payload', 'policy'].join('_');
const retiredContractPaths = [
  path.join(repoRoot, '.docks/foreman/inbound-contract.json'),
  path.join(repoRoot, '.docks/gdi/inbound-contract.json'),
  path.join(repoRoot, '.docks/operator/inbound-contract.json'),
];

const historicalFixture = {
  type: 'aos.dock_inbound_message_contract',
  schema_version: '2026-05-dock-inbound-message-contract-v0',
  dock: 'foreman',
  role: 'foreman',
  providers: {
    codex: {
      provider: 'codex',
      context_reset_command: '/clear',
      stale_goal_recovery_command: null,
      [clipboardPayloadPolicyKey]: 'plain_handoff',
      provider_entry_prefix: '',
      allowed_payloads: [
        {
          kind: 'successor_handoff',
          description: 'Plain successor handoff payload.',
          examples: ['Continue from the successor note.'],
        },
      ],
      forbidden_prompt_shapes: [
        {
          code: 'legacy_goal_prefix',
          severity: 'warning',
          description: 'Retired goal-command prefix.',
          match: '^/goal\\s+',
        },
      ],
      loop_recovery_guidance: [
        'Historical guidance retained for fixture validation only.',
      ],
    },
  },
};

function validateObject(instance) {
  return spawnSync(
    'python3',
    [
      '-c',
      `
import json, sys
from pathlib import Path
from jsonschema import Draft202012Validator

schema = json.loads(Path(sys.argv[1]).read_text())
instance = json.loads(sys.stdin.read())
Draft202012Validator.check_schema(schema)
validator = Draft202012Validator(schema)
errors = sorted(validator.iter_errors(instance), key=lambda e: list(e.path))
if errors:
    for error in errors[:8]:
        print(error.message)
    sys.exit(1)
`,
      schemaPath,
    ],
    { encoding: 'utf8', input: JSON.stringify(instance) },
  );
}

function runContractCli(args, options = {}) {
  const result = spawnSync(
    path.join(repoRoot, 'scripts/dock-inbound-message-contract'),
    args,
    { encoding: 'utf8', ...options },
  );
  return {
    status: result.status,
    stdout: result.stdout,
    stderr: result.stderr,
  };
}

test('retained inbound-message schema still validates a historical contract shape', () => {
  const result = validateObject(historicalFixture);
  assert.equal(result.status, 0, `${result.stdout}${result.stderr}`);
});

test('retired dock inbound contracts are not canonical runtime files', async () => {
  for (const contractPath of retiredContractPaths) {
    await assert.rejects(
      fs.stat(contractPath),
      { code: 'ENOENT' },
      `${path.relative(repoRoot, contractPath)} should stay retired`,
    );
  }
});

test('retired inbound-message library reports the dormant .docks path even when a legacy contract reappears', async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'aos-dock-contract-'));
  try {
    const contractPath = path.join(tempRoot, '.docks/gdi/inbound-contract.json');
    await fs.mkdir(path.dirname(contractPath), { recursive: true });
    await fs.writeFile(contractPath, '{}\n');

    const error = dockInboundContractsRetiredError(tempRoot, 'gdi');
    assert.equal(error.code, 'DOCK_INBOUND_CONTRACTS_RETIRED');
    assert.equal(error.contractPath, '.docks/gdi/inbound-contract.json');
    assert.match(error.message, /not an active runtime contract/);
  } finally {
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
});

test('active inbound-message CLI fails closed before stdin or legacy payload handling', () => {
  const stdinResult = runContractCli(
    ['--target-dock', 'gdi', '--json'],
    { input: 'ignored stdin payload' },
  );
  assert.equal(stdinResult.status, 1, stdinResult.stderr);
  assert.equal(stdinResult.stdout, '');
  assert.match(stdinResult.stderr, /DOCK_INBOUND_CONTRACTS_RETIRED/);
  assert.match(stdinResult.stderr, /not an active runtime contract/);
  assert.match(stdinResult.stderr, /\.docks\/gdi\/inbound-contract\.json/);
  assert.match(stdinResult.stderr, /Usage:/);
  assert.doesNotMatch(stdinResult.stderr, /ignored stdin payload/);

  const payloadResult = runContractCli([
    '--target-dock',
    'gdi',
    '--provider',
    'codex',
    '--payload',
    '/goal continue',
    '--json',
  ]);
  assert.equal(payloadResult.status, 1, payloadResult.stderr);
  assert.equal(payloadResult.stdout, '');
  assert.match(payloadResult.stderr, /DOCK_INBOUND_CONTRACTS_RETIRED/);
  assert.match(payloadResult.stderr, /\.docks\/gdi\/inbound-contract\.json/);
  assert.doesNotMatch(payloadResult.stderr, /\/goal continue/);
});

test('retired inbound-message CLI keeps help read-only', () => {
  const result = runContractCli(['--help']);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Usage:/);
  assert.match(result.stdout, /retired/);
  assert.equal(result.stderr, '');
});

test('retired GDI and Operator inbound message targets fail closed', () => {
  for (const dock of ['gdi', 'operator']) {
    const result = runContractCli([
      '--target-dock',
      dock,
      '--provider',
      'codex',
      '--payload',
      'follow the instructions in docs/design/work-cards/example-v0.md',
      '--json',
    ]);
    assert.equal(result.status, 1, result.stderr);
    assert.equal(result.stdout, '');
    assert.match(result.stderr, /DOCK_INBOUND_CONTRACTS_RETIRED/);
    assert.match(result.stderr, /active dock handoff routing is disabled/);
    assert.match(result.stderr, new RegExp(`\\.docks/${dock}/inbound-contract\\.json`));
  }
});

test('Foreman no longer exposes clipboard inbound-contract formatting', () => {
  const result = runContractCli([
    '--target-dock',
    'foreman',
    '--provider',
    'codex',
    '--payload',
    'continue from the successor note',
    '--json',
  ]);
  assert.equal(result.status, 1, result.stderr);
  assert.equal(result.stdout, '');
  assert.match(result.stderr, /DOCK_INBOUND_CONTRACTS_RETIRED/);
  assert.match(result.stderr, /active dock handoff routing is disabled/);
  assert.match(result.stderr, /\.docks\/foreman\/inbound-contract\.json/);
});
