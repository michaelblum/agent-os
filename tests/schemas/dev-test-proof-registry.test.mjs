import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { evaluateProofWorth } from '../../scripts/lib/dev-test-proof-registry.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../..');
const schemaPath = path.join(repoRoot, 'shared/schemas/dev-test-proof-registry.schema.json');
const canonicalPath = path.join(repoRoot, 'docs/dev/test-proof-registry.json');
const fixtureRoot = path.join(repoRoot, 'shared/schemas/fixtures/dev-test-proof-registry');

async function jsonFiles(dir) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
    .map((entry) => path.join(dir, entry.name))
    .sort();
}

async function loadJson(file) {
  return JSON.parse(await fs.readFile(file, 'utf8'));
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

test('canonical dev test proof registry matches the schema', () => {
  const result = validate(canonicalPath);
  assert.equal(result.status, 0, `${result.stdout}${result.stderr}`);
});

test('valid dev test proof registry fixtures match the schema', async () => {
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

test('invalid dev test proof registry fixtures are rejected by the schema', async () => {
  const fixtures = await jsonFiles(path.join(fixtureRoot, 'invalid'));
  assert.ok(fixtures.length >= 1, 'expected invalid fixtures');
  for (const fixture of fixtures) {
    const result = validate(fixture);
    assert.notEqual(result.status, 0, `${path.relative(repoRoot, fixture)} should fail validation`);
  }
});

test('canonical registry entries keep ids unique and commands exact', async () => {
  const registry = await loadJson(canonicalPath);
  const ids = registry.entries.map((entry) => entry.id);
  assert.equal(new Set(ids).size, ids.length, 'registry ids must be unique');
  for (const entry of registry.entries) {
    assert.ok(entry.path_patterns.length >= 1, `${entry.id} must cover at least one path pattern`);
    assert.doesNotMatch(entry.command, /<changed-test>/, `${entry.id} must not use the generic changed-test placeholder`);
    if (entry.status === 'active') {
      assert.equal(entry.guard.length > 0, true, `${entry.id} must declare its guard posture`);
    }
  }
});

test('proof-worth evaluator accepts registered tests and fixtures with exact commands', async () => {
  const registry = await loadJson(canonicalPath);
  const result = evaluateProofWorth({
    changedFiles: [
      'tests/schemas/dev-test-proof-registry.test.mjs',
      'shared/schemas/fixtures/dev-test-proof-registry/valid/minimal.json',
    ],
    repoRoot,
    registry,
    registryPath: 'docs/dev/test-proof-registry.json',
  });

  assert.equal(result.status, 'passed', result);
  assert.equal(result.commands.length, 1, result);
  assert.equal(result.commands[0].command, 'node --test tests/schemas/dev-test-proof-registry.test.mjs');
  assert.deepEqual(result.commands[0].source_entries, ['dev-test-proof-registry-schema']);
  assert.equal(result.assets.length, 2, result);
});

test('proof-worth evaluator fails existing unregistered tests and allows deleted cleanup', () => {
  const missing = evaluateProofWorth({
    changedFiles: ['tests/dev-workflow-router.sh'],
    repoRoot,
    registry: { entries: [] },
    registryPath: 'fixture.json',
  });
  assert.equal(missing.status, 'failed', missing);
  assert.equal(missing.failures[0].reason, 'missing_registry_entry');

  const deleted = evaluateProofWorth({
    changedFiles: ['tests/.deleted-proof-worth-cleanup.sh'],
    repoRoot,
    registry: { entries: [] },
    registryPath: 'fixture.json',
  });
  assert.equal(deleted.status, 'passed', deleted);
  assert.equal(deleted.assets[0].coverage, 'deleted_unregistered_cleanup');
});

test('proof-worth evaluator reports guarded entries without default commands', async () => {
  const registry = await loadJson(canonicalPath);
  const result = evaluateProofWorth({
    changedFiles: ['tests/manual/native-ax-saved-ref-live-proof.sh'],
    repoRoot,
    registry,
    registryPath: 'docs/dev/test-proof-registry.json',
  });

  assert.equal(result.status, 'passed', result);
  assert.equal(result.commands.length, 0, result);
  assert.equal(result.guarded.length, 1, result);
  assert.equal(result.guarded[0].entry, 'native-ax-saved-ref-live-proof');
  assert.match(result.guarded[0].guard, /real-input approval/);
});

test('proof-worth evaluator treats toolkit component launchers as guarded proof assets', async () => {
  const registry = await loadJson(canonicalPath);
  const result = evaluateProofWorth({
    changedFiles: ['packages/toolkit/components/surface-inspector/launch.sh'],
    repoRoot,
    registry,
    registryPath: 'docs/dev/test-proof-registry.json',
  });

  assert.equal(result.status, 'passed', result);
  assert.equal(result.assets.length, 1, result);
  assert.equal(result.assets[0].kind, 'proof_launcher', result);
  assert.equal(result.assets[0].coverage, 'guarded', result);
  assert.equal(result.commands.length, 0, result);
  assert.equal(result.guarded[0].entry, 'surface-inspector-launcher-smoke');
  assert.match(result.guarded[0].guard, /not part of broad default loops/);
});

test('proof-worth evaluator treats real-input surface helper as guarded proof asset', async () => {
  const registry = await loadJson(canonicalPath);
  const result = evaluateProofWorth({
    changedFiles: ['tests/lib/real-input-surface-harness.sh'],
    repoRoot,
    registry,
    registryPath: 'docs/dev/test-proof-registry.json',
  });

  assert.equal(result.status, 'passed', result);
  assert.equal(result.assets.length, 1, result);
  assert.equal(result.assets[0].kind, 'helper', result);
  assert.equal(result.assets[0].coverage, 'guarded', result);
  assert.equal(result.commands.length, 0, result);
  assert.equal(result.guarded[0].entry, 'real-input-surface-harness-helper');
  assert.match(result.guarded[0].guard, /real-input approval/);
});

test('proof-worth evaluator routes skills efficacy fixture through test and CLI proofs', async () => {
  const registry = await loadJson(canonicalPath);
  const result = evaluateProofWorth({
    changedFiles: ['tests/fixtures/aos-skills/agentic-efficacy-eval-v0.json'],
    repoRoot,
    registry,
    registryPath: 'docs/dev/test-proof-registry.json',
  });

  assert.equal(result.status, 'passed', result);
  assert.equal(result.assets.length, 1, result);
  assert.equal(result.assets[0].kind, 'fixture', result);
  assert.deepEqual(result.commands.map((item) => item.command), [
    'node --test tests/aos-skills-eval.test.mjs',
    'node scripts/aos-skills-eval.mjs --fixture tests/fixtures/aos-skills/agentic-efficacy-eval-v0.json --json',
  ]);
});

test('proof-worth evaluator fails touched retired entries but allows their deletion', () => {
  const registry = {
    entries: [
      {
        id: 'retired-router-proof',
        path_patterns: ['tests/dev-workflow-router.sh', 'tests/.retired-proof-worth-cleanup.sh'],
        owner: 'dev-workflow',
        harness_level: 'shell_router',
        proof_kind: 'router_contract',
        contract: 'Retired router proof.',
        worth: 'Retired proof should not be edited in place.',
        command: 'retired',
        replaces: ['tests/schemas/dev-test-proof-registry.test.mjs'],
        guard: 'retired',
        status: 'retired',
      },
    ],
  };

  const touched = evaluateProofWorth({
    changedFiles: ['tests/dev-workflow-router.sh'],
    repoRoot,
    registry,
    registryPath: 'fixture.json',
  });
  assert.equal(touched.status, 'failed', touched);
  assert.equal(touched.failures[0].reason, 'retired_proof_touched');

  const deleted = evaluateProofWorth({
    changedFiles: ['tests/.retired-proof-worth-cleanup.sh'],
    repoRoot,
    registry,
    registryPath: 'fixture.json',
  });
  assert.equal(deleted.status, 'passed', deleted);
  assert.equal(deleted.assets[0].coverage, 'deleted_registered_cleanup');
});

test('proof-worth evaluator rejects active entries without exact default commands', () => {
  const registry = {
    entries: [
      {
        id: 'placeholder-command-proof',
        path_patterns: ['tests/dev-workflow-router.sh'],
        owner: 'dev-workflow',
        harness_level: 'shell_router',
        proof_kind: 'router_contract',
        contract: 'Placeholder command proof.',
        worth: 'Placeholder commands are not runnable proof.',
        command: 'bash <changed-test>',
        replaces: [],
        guard: 'none',
        status: 'active',
      },
    ],
  };

  const result = evaluateProofWorth({
    changedFiles: ['tests/dev-workflow-router.sh'],
    repoRoot,
    registry,
    registryPath: 'fixture.json',
  });
  assert.equal(result.status, 'failed', result);
  assert.equal(result.failures[0].reason, 'missing_default_command');
});
