import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../..');
const schemaPath = path.join(repoRoot, 'shared/schemas/dev-workflow-profiles.schema.json');
const canonicalPath = path.join(repoRoot, 'docs/dev/workflow-profiles.json');
const fixtureRoot = path.join(repoRoot, 'shared/schemas/fixtures/dev-workflow-profiles');

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

test('canonical dev workflow profiles manifest matches the schema', () => {
  const result = validate(canonicalPath);
  assert.equal(result.status, 0, `${result.stdout}${result.stderr}`);
});

test('valid dev workflow profile fixtures match the schema', async () => {
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

test('invalid dev workflow profile fixtures are rejected by the schema', async () => {
  const fixtures = await jsonFiles(path.join(fixtureRoot, 'invalid'));
  assert.ok(fixtures.length >= 1, 'expected invalid fixtures');
  for (const fixture of fixtures) {
    const result = validate(fixture);
    assert.notEqual(result.status, 0, `${path.relative(repoRoot, fixture)} should fail validation`);
  }
});

test('canonical profiles preserve the expected built-in examples', async () => {
  const manifest = JSON.parse(await fs.readFile(canonicalPath, 'utf8'));
  const profiles = new Map(manifest.profiles.map((profile) => [profile.id, profile]));

  assert.equal(profiles.size, 5);
  assert.ok(profiles.has('agentic_relay'));
  assert.ok(profiles.has('local_relay'));
  assert.ok(profiles.has('hybrid_trunk'));
  assert.ok(profiles.has('github_flow'));
  assert.ok(profiles.has('gitflow'));
  assert.equal(profiles.get('agentic_relay')?.direct_main_default, false);
  assert.equal(profiles.get('agentic_relay')?.pull_request_required, false);
  assert.equal(profiles.get('agentic_relay')?.default_work_surface, 'short-lived topic branch from main');
  assert.equal(profiles.get('agentic_relay')?.commit_strategy, 'scoped commits on a gdi/<slug> branch; push branch to origin at completion');
  assert.equal(profiles.get('agentic_relay')?.branch_naming_convention, 'gdi/<work-card-slug>');
  assert.equal(profiles.get('agentic_relay')?.gdi_push_authority, true);
  assert.equal(profiles.get('local_relay')?.direct_main_default, false);
  assert.equal(profiles.get('local_relay')?.pull_request_required, false);
  assert.equal(profiles.get('local_relay')?.gdi_push_authority, false);
  assert.ok(profiles.get('local_relay')?.branch_strategy.includes('never create linked git worktrees'));
  assert.equal(profiles.get('hybrid_trunk')?.direct_main_default, true);
  assert.equal(profiles.get('hybrid_trunk')?.pull_request_required, false);
  assert.equal(profiles.get('github_flow')?.pull_request_required, true);
  assert.equal(profiles.get('gitflow')?.release_branching, true);
  assert.ok(manifest.axes?.dock?.includes('role'));
  assert.ok(manifest.axes?.entry_path?.includes('capability'));
  assert.ok(manifest.axes?.workflow_profile?.includes('Development'));
});
