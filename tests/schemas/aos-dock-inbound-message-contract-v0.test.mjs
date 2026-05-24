import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../..');
const schemaPath = path.join(repoRoot, 'shared/schemas/aos-dock-inbound-message-contract-v0.schema.json');
const canonicalContractPaths = [
  path.join(repoRoot, '.docks/foreman/inbound-contract.json'),
  path.join(repoRoot, '.docks/gdi/inbound-contract.json'),
  path.join(repoRoot, '.docks/operator/inbound-contract.json'),
];
const warmDockInlineValidationPayload = 'Warm dock TUI reuse validation only. Do not run shell commands, edit files, read provider transcript files, open GitHub, create branches, commit, push, or route follow-up work. Reply with a concise confirmation that this prompt was accepted in the current warm GDI terminal and whether stale-goal or repeated-completion behavior occurred.';

function validate(instancePath) {
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
validator = Draft202012Validator(schema)
errors = sorted(validator.iter_errors(instance), key=lambda e: list(e.path))
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

test('canonical inbound contracts match the schema', () => {
  for (const contractPath of canonicalContractPaths) {
    const result = validate(contractPath);
    assert.equal(
      result.status,
      0,
      `${path.relative(repoRoot, contractPath)} should validate\n${result.stdout}${result.stderr}`,
    );
  }
});

test('canonical contract dock names match their directories', async () => {
  for (const contractPath of canonicalContractPaths) {
    const contract = JSON.parse(await fs.readFile(contractPath, 'utf8'));
    assert.equal(contract.dock, path.basename(path.dirname(contractPath)));
    assert.ok(contract.providers.codex, `${contract.dock} should declare codex`);
  }
});

test('GDI transfer packet pointers format as plain clipboard payloads with goal entry preview', () => {
  const payload = 'follow the transfer packet in .docks/foreman/packets/to-gdi-example-v0.json; start from origin/main';
  const result = formatPayload('gdi', payload);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.json.ok, true);
  assert.equal(result.json.clipboard_payload, payload);
  assert.equal(result.json.provider_entry_prefix, '/goal ');
  assert.equal(result.json.provider_entry_preview, `/goal ${payload}`);
  assert.equal(result.json.context_reset_command, '/clear');
  assert.equal(result.json.stale_goal_recovery_command, '/goal clear');
});

test('GDI work-card pointers format as plain clipboard payloads with goal entry preview', () => {
  const payload = 'follow the instructions in docs/design/work-cards/example-v0.md; start from origin/main';
  const result = formatPayload('gdi', payload);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.json.ok, true);
  assert.equal(result.json.clipboard_payload, payload);
  assert.equal(result.json.provider_entry_preview, `/goal ${payload}`);
});

test('GDI declares the warm-dock validation inline instruction payload kind', async () => {
  const contract = JSON.parse(await fs.readFile(canonicalContractPaths[1], 'utf8'));
  const payloadKind = contract.providers.codex.allowed_payloads.find(
    (payload) => payload.kind === 'warm_dock_validation_inline_instruction',
  );
  assert.ok(payloadKind);
  assert.match(payloadKind.description, /validation-only/);
  assert.deepEqual(payloadKind.examples, [warmDockInlineValidationPayload]);
});

test('GDI warm-dock inline validation payload is accepted without loop-risk warnings', () => {
  const result = formatPayload('gdi', warmDockInlineValidationPayload);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.json.ok, true);
  assert.equal(result.json.clipboard_payload, warmDockInlineValidationPayload);
  assert.equal(result.json.provider_entry_prefix, '/goal ');
  assert.equal(result.json.provider_entry_preview, `/goal ${warmDockInlineValidationPayload}`);
  assert.deepEqual(result.json.diagnostics, []);
});

test('GDI strips accidental goal prefix as compatibility cleanup', () => {
  const result = formatPayload('gdi', '/goal follow the instructions in docs/design/work-cards/example-v0.md');
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.json.clipboard_payload, 'follow the instructions in docs/design/work-cards/example-v0.md');
  assert.equal(result.json.diagnostics[0].code, 'legacy_provider_entry_prefix_stripped');
  assert.equal(result.json.diagnostics[0].severity, 'warning');
});

test('GDI warns on reply-exactly one-shot proof goals without blanket rejection', () => {
  const result = formatPayload('gdi', 'Warm TUI reuse live proof only. Reply with exactly: PASS');
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.json.ok, true);
  assert.ok(result.json.diagnostics.some((diagnostic) => diagnostic.code === 'gdi_one_shot_reply_exactly_risk'));
  assert.ok(result.json.diagnostics.some((diagnostic) => diagnostic.code === 'repeated_completion_loop_risk'));
  assert.ok(result.json.diagnostics.every((diagnostic) => diagnostic.severity === 'warning'));
});

test('GDI still rejects true dock-boundary self-acceptance prompts', () => {
  const result = formatPayload('gdi', 'GDI should self-accept this architecture decision and report done.');
  assert.equal(result.status, 1);
  assert.equal(result.json.ok, false);
  assert.ok(result.json.diagnostics.some((diagnostic) => diagnostic.code === 'gdi_self_acceptance_risk'));
});

test('Operator pointer payloads stay plain and do not receive a goal prefix', () => {
  const payload = 'follow the instructions in docs/design/work-cards/operator-example-v0.md';
  const result = formatPayload('operator', payload);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.json.ok, true);
  assert.equal(result.json.clipboard_payload, payload);
  assert.equal(result.json.provider_entry_prefix, '');
  assert.equal(result.json.provider_entry_preview, payload);
  assert.equal(result.json.context_reset_command, '/clear');
  assert.equal(result.json.stale_goal_recovery_command, null);
});
