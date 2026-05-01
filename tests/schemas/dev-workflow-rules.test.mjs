import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../..');
const schemaPath = path.join(repoRoot, 'shared/schemas/dev-workflow-rules.schema.json');
const fixtureRoot = path.join(repoRoot, 'shared/schemas/fixtures/dev-workflow-rules');
const manifestPath = path.join(repoRoot, 'docs/reference/aos-dev-workflow-rules.json');

async function jsonFiles(dir) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
    .map((entry) => path.join(dir, entry.name))
    .sort();
}

function runJsonschema(fixturePath) {
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
      fixturePath,
    ],
    { encoding: 'utf8' },
  );
}

test('valid dev-workflow-rules fixtures match the canonical schema', async () => {
  const fixtures = await jsonFiles(path.join(fixtureRoot, 'valid'));
  assert.ok(fixtures.length >= 1, 'expected valid fixtures');
  for (const fixture of fixtures) {
    const result = runJsonschema(fixture);
    assert.equal(
      result.status,
      0,
      `${path.relative(repoRoot, fixture)} should validate\n${result.stdout}${result.stderr}`,
    );
  }
});

test('invalid dev-workflow-rules fixtures are rejected by the canonical schema', async () => {
  const fixtures = await jsonFiles(path.join(fixtureRoot, 'invalid'));
  assert.ok(fixtures.length >= 1, 'expected invalid fixtures');
  for (const fixture of fixtures) {
    const result = runJsonschema(fixture);
    assert.notEqual(result.status, 0, `${path.relative(repoRoot, fixture)} should fail validation`);
  }
});

test('canonical AOS dev workflow manifest validates and preserves core routing rules', async () => {
  const result = runJsonschema(manifestPath);
  assert.equal(result.status, 0, `manifest should validate\n${result.stdout}${result.stderr}`);

  const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
  const rules = new Map(manifest.rules.map((rule) => [rule.id, rule]));

  assert.equal(manifest.default_entry_path, 'agent/dev');
  assert.ok(rules.has('swift-binary-source'));
  assert.ok(rules.has('dev-build-surface'));
  assert.ok(rules.has('toolkit-canvas-surface'));
  assert.ok(rules.has('schema-contract'));

  const swiftRule = rules.get('swift-binary-source');
  assert.ok(swiftRule.risk_flags.includes('tcc_identity_sensitive'));
  assert.deepEqual(swiftRule.actions[0].command, ['./aos', 'dev', 'build', '--no-restart']);
  assert.deepEqual(
    swiftRule.actions[1].required_capabilities.map((capability) => capability.id),
    ['runtime.daemon', 'perception.ax', 'action.input'],
  );
  assert.deepEqual(swiftRule.human_handoff.resume_command, ['./aos', 'ready', '--post-permission']);

  const toolkitRule = rules.get('toolkit-canvas-surface');
  assert.equal(
    toolkitRule.actions.some((action) => action.kind === 'build'),
    false,
    'toolkit web assets should not require a Swift build by default',
  );
});
