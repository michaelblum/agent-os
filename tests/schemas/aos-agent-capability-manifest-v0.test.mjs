import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../..');
const schemaPath = path.join(repoRoot, 'shared/schemas/aos-agent-capability-manifest-v0.schema.json');
const canonicalPath = path.join(repoRoot, 'docs/dev/agent-capabilities.json');
const fixtureRoot = path.join(repoRoot, 'shared/schemas/fixtures/aos-agent-capability-manifest-v0');

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

test('valid agent capability manifests match the schema', async () => {
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

test('canonical agent capability manifest matches the schema', () => {
  const result = validate(canonicalPath);
  assert.equal(result.status, 0, `${result.stdout}${result.stderr}`);
});

test('invalid agent capability manifests are rejected by the schema', async () => {
  const fixtures = await jsonFiles(path.join(fixtureRoot, 'invalid'));
  assert.ok(fixtures.length >= 1, 'expected invalid fixtures');
  for (const fixture of fixtures) {
    const result = validate(fixture);
    assert.notEqual(result.status, 0, `${path.relative(repoRoot, fixture)} should fail validation`);
  }
});

test('node and python adapters cannot avoid raw-process constraints', () => {
  for (const fixtureName of [
    'node-adapter-raw-process-false.json',
    'python-adapter-raw-process-false.json',
  ]) {
    const fixture = path.join(fixtureRoot, 'invalid', fixtureName);
    const result = validate(fixture);
    assert.notEqual(result.status, 0, `${fixtureName} should fail validation`);
    assert.match(
      `${result.stdout}${result.stderr}`,
      /True was expected/,
      `${fixtureName} should fail because raw_process must be true`,
    );
  }
});

test('raw process capabilities remain developer/testing scoped', async () => {
  const fixtures = await jsonFiles(path.join(fixtureRoot, 'valid'));
  for (const fixture of fixtures) {
    const manifest = await loadJson(fixture);
    for (const capability of manifest.capabilities) {
      if (capability.execution.raw_process !== true) {
        continue;
      }
      assert.ok(
        capability.entry_paths.every((entryPath) => ['aos_developer', 'testing', 'break_glass'].includes(entryPath)),
        `${path.relative(repoRoot, fixture)}:${capability.id} raw_process entry paths must stay developer/testing scoped`,
      );
      assert.equal(
        capability.mutability.requires_explicit_assignment,
        true,
        `${path.relative(repoRoot, fixture)}:${capability.id} raw_process must require explicit assignment`,
      );
      assert.notEqual(
        capability.execution.audit,
        'none',
        `${path.relative(repoRoot, fixture)}:${capability.id} raw_process must be auditable`,
      );
      assert.equal(
        typeof capability.execution.timeout_seconds,
        'number',
        `${path.relative(repoRoot, fixture)}:${capability.id} raw_process must have timeout`,
      );
    }
  }
});

test('typed GitHub maintainer capabilities use direct node helpers and explicit assignment', async () => {
  const manifest = await loadJson(canonicalPath);
  const capabilities = new Map(manifest.capabilities.map((capability) => [capability.id, capability]));

  const context = capabilities.get('dev.github.context');
  assert.equal(context.adapter.kind, 'node');
  assert.deepEqual(context.adapter.command.slice(0, 2), ['node', 'scripts/aos-dev-gh.mjs']);
  assert.equal(context.execution.raw_process, true);
  assert.equal(context.mutability.class, 'read_only');
  assert.equal(context.mutability.requires_explicit_assignment, true);

  for (const id of [
    'dev.github.issue_list',
    'dev.github.issue_view',
    'dev.github.label_list',
    'dev.github.pr_list',
    'dev.github.pr_view',
    'dev.github.pr_checks',
  ]) {
    const capability = capabilities.get(id);
    assert.equal(capability.adapter.kind, 'node');
    assert.deepEqual(capability.adapter.command.slice(0, 2), ['node', 'scripts/aos-dev-gh.mjs']);
    assert.equal(capability.execution.raw_process, true);
    assert.equal(capability.mutability.class, 'read_only');
    assert.equal(capability.mutability.requires_explicit_assignment, true);
    assert.equal(capability.failure_policy.bubble_up, true);
  }

  for (const id of [
    'dev.github.issue_comment',
    'dev.github.issue_create',
    'dev.github.issue_close',
    'dev.github.issue_edit',
    'dev.github.pr_create',
    'dev.github.pr_comment',
    'dev.github.pr_merge',
  ]) {
    const write = capabilities.get(id);
    assert.equal(write.adapter.kind, 'node');
    assert.deepEqual(write.adapter.command.slice(0, 2), ['node', 'scripts/aos-dev-gh.mjs']);
    assert.equal(write.execution.raw_process, true);
    assert.equal(write.mutability.class, 'external_write');
    assert.equal(write.mutability.requires_explicit_assignment, true);
    assert.equal(write.failure_policy.bubble_up, true);
  }

  assert.equal(capabilities.get('dev.github.issue_comment').mutability.requires_body_file, true);
  assert.equal(capabilities.get('dev.github.issue_create').mutability.requires_body_file, true);
  assert.equal(capabilities.get('dev.github.issue_close').mutability.requires_body_file, false);
  assert.equal(capabilities.get('dev.github.issue_edit').mutability.requires_body_file, false);
  assert.equal(capabilities.get('dev.github.pr_create').mutability.requires_body_file, true);
  assert.equal(capabilities.get('dev.github.pr_comment').mutability.requires_body_file, true);
  assert.equal(capabilities.get('dev.github.pr_merge').mutability.requires_body_file, false);
});

test('canonical manifest includes the initial developer capability set', async () => {
  const manifest = await loadJson(canonicalPath);
  const capabilities = new Map(manifest.capabilities.map((capability) => [capability.id, capability]));

  for (const id of [
    'dev.github.context',
    'dev.github.issue_list',
    'dev.github.issue_view',
    'dev.github.issue_comment',
    'dev.github.issue_create',
    'dev.github.issue_close',
    'dev.github.issue_edit',
    'dev.github.label_list',
    'dev.github.pr_list',
    'dev.github.pr_view',
    'dev.github.pr_checks',
    'dev.github.pr_create',
    'dev.github.pr_comment',
    'dev.github.pr_merge',
    'dev.github.ci_inspect',
    'dev.github.review_comments',
    'dev.build.aos',
    'dev.test.schema_node',
  ]) {
    assert.ok(capabilities.has(id), `canonical manifest should include ${id}`);
  }

  assert.equal(capabilities.get('dev.build.aos').adapter.kind, 'node');
  assert.deepEqual(capabilities.get('dev.build.aos').adapter.command.slice(0, 2), ['node', 'scripts/aos-dev-build.mjs']);
  assert.equal(capabilities.get('dev.build.aos').execution.raw_process, true);
  assert.equal(capabilities.get('dev.build.aos').mutability.class, 'host_write');
  assert.equal(capabilities.get('dev.test.schema_node').adapter.kind, 'node');
  assert.equal(capabilities.get('dev.test.schema_node').execution.raw_process, true);
});
