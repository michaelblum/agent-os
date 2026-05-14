import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../..');
const schemaPath = path.join(repoRoot, 'shared/schemas/dev-workflow-rules.schema.json');
const canonicalPath = path.join(repoRoot, 'docs/dev/workflow-rules.json');
const fixtureRoot = path.join(repoRoot, 'shared/schemas/fixtures/dev-workflow-rules');

async function jsonFiles(dir) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
    .map((entry) => path.join(dir, entry.name))
    .sort();
}

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

test('canonical dev workflow manifest matches the schema', () => {
  const result = validate(canonicalPath);
  assert.equal(result.status, 0, `${result.stdout}${result.stderr}`);
});

test('valid dev workflow fixtures match the schema', async () => {
  const fixtures = await jsonFiles(path.join(fixtureRoot, 'valid'));
  assert.ok(fixtures.length >= 1, 'expected valid fixtures');
  for (const fixture of fixtures) {
    const result = validate(fixture);
    assert.equal(
      result.status,
      0,
      `${path.relative(repoRoot, fixture)} should validate\n${result.stdout}${result.stderr}`,
    );
  }
});

test('invalid dev workflow fixtures are rejected by the schema', async () => {
  const fixtures = await jsonFiles(path.join(fixtureRoot, 'invalid'));
  assert.ok(fixtures.length >= 1, 'expected invalid fixtures');
  for (const fixture of fixtures) {
    const result = validate(fixture);
    assert.notEqual(result.status, 0, `${path.relative(repoRoot, fixture)} should fail validation`);
  }
});

test('canonical rules preserve the expected V0 routing contracts', async () => {
  const manifest = JSON.parse(await fs.readFile(canonicalPath, 'utf8'));
  const rules = new Map(manifest.rules.map((rule) => [rule.id, rule]));

  assert.equal(rules.get('swift-core')?.tcc_identity_sensitive, true);
  assert.equal(
    rules.get('swift-core')?.commands?.[0]?.command,
    './aos dev build',
  );
  assert.equal(
    rules.get('command-contract-docs')?.commands?.[0]?.command,
    'bash tests/help-contract.sh',
  );
  assert.equal(rules.get('toolkit-components')?.hot_swappable, true);
  assert.equal(rules.get('schemas')?.commands?.[0]?.command, 'node --test tests/schemas/*.test.mjs');
  assert.deepEqual(
    rules.get('dev-workflow-manifest')?.commands?.map((step) => step.command),
    [
      'node --test tests/schemas/dev-workflow-rules.test.mjs',
      'bash tests/dev-workflow-router.sh',
      'bash tests/dev-audit.sh',
    ],
  );
  assert.ok(rules.get('dev-workflow-manifest')?.patterns?.includes('src/commands/dev.swift'));
  assert.ok(rules.get('dev-workflow-manifest')?.patterns?.includes('src/shared/command-registry-data.swift'));
  assert.equal(
    rules.get('agent-capability-manifest')?.commands?.[0]?.command,
    'node --test tests/schemas/aos-agent-capability-manifest-v0.test.mjs',
  );
  assert.ok(rules.get('agent-capability-manifest')?.patterns?.includes('docs/dev/agent-capabilities.json'));
  assert.equal(
    rules.get('dock-profiles')?.commands?.[0]?.command,
    'node --test tests/schemas/aos-dock-profile-v0.test.mjs',
  );
  assert.ok(rules.get('dock-profiles')?.patterns?.includes('.docks/*/dock.json'));
  assert.ok(rules.get('app-subtree-local-contract')?.notes?.[0]?.includes('nearest subtree AGENTS.md'));
});
