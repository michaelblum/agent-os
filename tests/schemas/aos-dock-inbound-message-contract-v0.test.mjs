import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../..');
const schemaPath = path.join(repoRoot, 'shared/schemas/aos-dock-inbound-message-contract-v0.schema.json');
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
      clipboard_payload_policy: 'plain_handoff',
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

function formatPayload(targetDock, payload) {
  const result = spawnSync(
    path.join(repoRoot, 'scripts/dock-inbound-message-contract'),
    ['--target-dock', targetDock, '--provider', 'codex', '--payload', payload, '--json'],
    { encoding: 'utf8' },
  );
  return {
    status: result.status,
    stdout: result.stdout,
    stderr: result.stderr,
    json: result.stdout ? JSON.parse(result.stdout) : null,
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

test('retired GDI and Operator inbound message targets fail closed', () => {
  for (const dock of ['gdi', 'operator']) {
    const result = formatPayload(dock, 'follow the instructions in docs/design/work-cards/example-v0.md');
    assert.equal(result.status, 2, result.stderr);
    assert.match(result.stderr, new RegExp(`\\.docks/${dock}/inbound-contract\\.json`));
  }
});

test('Foreman no longer exposes clipboard inbound-contract formatting', () => {
  const result = formatPayload('foreman', 'continue from the successor note');
  assert.equal(result.status, 2, result.stderr);
  assert.match(result.stderr, /\.docks\/foreman\/inbound-contract\.json/);
});
