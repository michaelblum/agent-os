import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateDockInboundMessage } from '../../scripts/lib/dock-inbound-message-contract.mjs';

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

function legacyRuntimeContract(dock) {
  return {
    type: 'aos.dock_inbound_message_contract',
    schema_version: '2026-05-dock-inbound-message-contract-v0',
    dock,
    role: dock,
    providers: {
      codex: {
        provider: 'codex',
        context_reset_command: '/clear',
        stale_goal_recovery_command: null,
        clipboard_payload_policy: 'plain_handoff',
        provider_entry_prefix: '/goal ',
        allowed_payloads: [],
        forbidden_prompt_shapes: [],
      },
    },
  };
}

async function pathExists(targetPath) {
  try {
    await fs.stat(targetPath);
    return true;
  } catch (error) {
    if (error.code === 'ENOENT') {
      return false;
    }
    throw error;
  }
}

async function removeIfCreated(targetPath, existedBefore) {
  if (existedBefore) {
    return;
  }
  try {
    await fs.rmdir(targetPath);
  } catch (error) {
    if (error.code !== 'ENOENT' && error.code !== 'ENOTEMPTY') {
      throw error;
    }
  }
}

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

test('active inbound-message library fails closed even when a legacy contract reappears', async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'aos-dock-contract-'));
  try {
    const contractPath = path.join(tempRoot, '.docks/gdi/inbound-contract.json');
    await fs.mkdir(path.dirname(contractPath), { recursive: true });
    await fs.writeFile(contractPath, JSON.stringify(legacyRuntimeContract('gdi'), null, 2));

    assert.throws(
      () => validateDockInboundMessage({
        repoRoot: tempRoot,
        targetDock: 'gdi',
        provider: 'codex',
        payload: '/goal continue',
      }),
      (error) => {
        assert.equal(error.code, 'DOCK_INBOUND_CONTRACTS_RETIRED');
        assert.equal(error.contractPath, '.docks/gdi/inbound-contract.json');
        assert.match(error.message, /not an active runtime contract/);
        return true;
      },
    );
  } finally {
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
});

test('active inbound-message CLI fails closed even when a legacy contract reappears', async () => {
  const docksDir = path.join(repoRoot, '.docks');
  const dockDir = path.join(docksDir, 'gdi');
  const contractPath = path.join(dockDir, 'inbound-contract.json');
  const docksDirExisted = await pathExists(docksDir);
  const dockDirExisted = await pathExists(dockDir);

  await assert.rejects(
    fs.stat(contractPath),
    { code: 'ENOENT' },
    `${path.relative(repoRoot, contractPath)} should be absent before the reappearance regression test`,
  );

  try {
    await fs.mkdir(dockDir, { recursive: true });
    await fs.writeFile(contractPath, JSON.stringify(legacyRuntimeContract('gdi'), null, 2));

    const result = formatPayload('gdi', '/goal continue');
    assert.equal(result.status, 2, result.stderr);
    assert.equal(result.stdout, '');
    assert.match(result.stderr, /DOCK_INBOUND_CONTRACTS_RETIRED/);
    assert.match(result.stderr, /not an active runtime contract/);
    assert.match(result.stderr, /\.docks\/gdi\/inbound-contract\.json/);
  } finally {
    await fs.rm(contractPath, { force: true });
    await removeIfCreated(dockDir, dockDirExisted);
    await removeIfCreated(docksDir, docksDirExisted);
  }
});

test('retired GDI and Operator inbound message targets fail closed', () => {
  for (const dock of ['gdi', 'operator']) {
    const result = formatPayload(dock, 'follow the instructions in docs/design/work-cards/example-v0.md');
    assert.equal(result.status, 2, result.stderr);
    assert.equal(result.stdout, '');
    assert.match(result.stderr, /DOCK_INBOUND_CONTRACTS_RETIRED/);
    assert.match(result.stderr, /active dock handoff routing is disabled/);
    assert.match(result.stderr, new RegExp(`\\.docks/${dock}/inbound-contract\\.json`));
  }
});

test('Foreman no longer exposes clipboard inbound-contract formatting', () => {
  const result = formatPayload('foreman', 'continue from the successor note');
  assert.equal(result.status, 2, result.stderr);
  assert.equal(result.stdout, '');
  assert.match(result.stderr, /DOCK_INBOUND_CONTRACTS_RETIRED/);
  assert.match(result.stderr, /active dock handoff routing is disabled/);
  assert.match(result.stderr, /\.docks\/foreman\/inbound-contract\.json/);
});
