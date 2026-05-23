import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { writeFile, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  createAgentTerminalObservation,
  createFixtureDockTerminalSessions,
} from '../../scripts/lib/dock-terminal-session-registry.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../..');
const schemaPath = path.join(repoRoot, 'shared/schemas/aos-dock-terminal-session-v0.schema.json');

async function validate(instance) {
  const dir = await mkdtemp(path.join(tmpdir(), 'dock-terminal-session-schema-'));
  const instancePath = path.join(dir, 'instance.json');
  await writeFile(instancePath, `${JSON.stringify(instance, null, 2)}\n`, 'utf8');
  return spawnSync(
    'python3',
    [
      '-c',
      `
import json, sys
from pathlib import Path
from jsonschema import Draft202012Validator

schema = json.loads(Path(sys.argv[1]).read_text())
instance = json.loads(Path(sys.argv[2]).read_text())
Draft202012Validator.check_schema(schema)
errors = sorted(Draft202012Validator(schema).iter_errors(instance), key=lambda e: list(e.path))
if errors:
    for error in errors[:8]:
        print(error.message)
    sys.exit(1)
`,
      schemaPath,
      instancePath,
    ],
    { encoding: 'utf8' },
  );
}

test('builds fixture-backed dock terminal session receipts for canonical docks', async () => {
  const receipts = createFixtureDockTerminalSessions({
    repoRoot,
    geometry: { cols: 100, rows: 31 },
    lifecycle: {
      state: 'running',
      started_at: '2026-05-23T00:00:00.000Z',
      last_attached_at: '2026-05-23T00:01:00.000Z',
    },
    lease: {
      holder: 'afk',
      purpose: 'dispatch',
      disposition: 'returned_to_idle',
    },
  });

  assert.deepEqual(Object.keys(receipts).sort(), ['foreman', 'gdi', 'operator']);
  for (const [dock, receipt] of Object.entries(receipts)) {
    assert.equal(receipt.record_type, 'aos.dock_terminal_session');
    assert.equal(receipt.dock, dock);
    assert.match(receipt.dock_terminal_session_id, new RegExp(`^dock-terminal:${dock}:[a-f0-9]{16}$`));
    assert.equal(receipt.cwd, path.join(repoRoot, '.docks', dock));
    assert.deepEqual(receipt.provider_command, ['codex', '--no-alt-screen']);
    assert.equal(receipt.pty.cols, 100);
    assert.equal(receipt.pty.rows, 31);
    assert.equal(receipt.lease.disposition, 'returned_to_idle');
    const result = await validate(receipt);
    assert.equal(result.status, 0, `${dock} receipt should validate\n${result.stdout}${result.stderr}`);
  }
});

test('Agent Terminal observation references dock terminal sessions without acceptance authority', () => {
  const receipt = createFixtureDockTerminalSessions({ repoRoot }).gdi;
  const observation = createAgentTerminalObservation(receipt, {
    selectedProviderSessionId: 'codex-session',
  });

  assert.equal(observation.record_type, 'aos.agent_terminal_observation');
  assert.equal(observation.dock_terminal_session_id, receipt.dock_terminal_session_id);
  assert.equal(observation.cwd, receipt.cwd);
  assert.deepEqual(observation.command, receipt.provider_command);
  assert.deepEqual(observation.geometry, { cols: 80, rows: 24 });
  assert.equal(observation.lease.disposition, 'returned_to_idle');
  assert.equal(observation.acceptance_role, 'human_observability_only');
  assert.equal(observation.provider_acceptance.status, 'not_evidence');
});
