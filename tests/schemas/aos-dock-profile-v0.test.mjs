import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../..');
const schemaPath = path.join(repoRoot, 'shared/schemas/aos-dock-profile-v0.schema.json');
const fixtureRoot = path.join(repoRoot, 'shared/schemas/fixtures/aos-dock-profile-v0');
const capabilityManifestPath = path.join(repoRoot, 'docs/dev/agent-capabilities.json');
const canonicalDockPaths = [
  path.join(repoRoot, '.docks/foreman/dock.json'),
  path.join(repoRoot, '.docks/gdi/dock.json'),
  path.join(repoRoot, '.docks/operator/dock.json'),
];

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

test('valid dock profile fixtures match the schema', async () => {
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

test('canonical dock profiles match the schema', () => {
  for (const dockPath of canonicalDockPaths) {
    const result = validate(dockPath);
    assert.equal(
      result.status,
      0,
      `${path.relative(repoRoot, dockPath)} should validate\n${result.stdout}${result.stderr}`,
    );
  }
});

test('invalid dock profile fixtures are rejected by the schema', async () => {
  const fixtures = await jsonFiles(path.join(fixtureRoot, 'invalid'));
  assert.ok(fixtures.length >= 1, 'expected invalid fixtures');
  for (const fixture of fixtures) {
    const result = validate(fixture);
    assert.notEqual(result.status, 0, `${path.relative(repoRoot, fixture)} should fail validation`);
  }
});

test('canonical dock profiles resolve against the agent capability manifest', async () => {
  const manifest = await loadJson(capabilityManifestPath);
  const capabilities = new Map(manifest.capabilities.map((capability) => [capability.id, capability]));

  for (const dockPath of canonicalDockPaths) {
    const profile = await loadJson(dockPath);
    const dockName = path.basename(path.dirname(dockPath));
    assert.equal(profile.name, dockName, `${path.relative(repoRoot, dockPath)} name should match directory`);
    assert.equal(profile.capability_manifest, 'docs/dev/agent-capabilities.json');
    assert.ok(
      profile.allowed_entry_paths.includes(profile.default_entry_path),
      `${profile.name} default entry path must be allowed`,
    );

    for (const capabilityID of profile.allowed_capabilities) {
      const capability = capabilities.get(capabilityID);
      assert.ok(capability, `${profile.name} references unknown capability ${capabilityID}`);

      const roles = capability.roles ?? [];
      assert.ok(
        roles.length === 0 || roles.includes(profile.role),
        `${profile.name} allows ${capabilityID}, but capability roles are ${roles.join(',')}`,
      );

      const capabilityClass = capability.mutability.class;
      assert.ok(
        profile.allowed_capability_classes.includes(capabilityClass),
        `${profile.name} allows ${capabilityID}, but not class ${capabilityClass}`,
      );

      assert.ok(
        capability.entry_paths.some((entryPath) => profile.allowed_entry_paths.includes(entryPath)),
        `${profile.name} allows ${capabilityID}, but entry paths do not intersect`,
      );
    }
  }
});

test('role envelopes preserve the intended coordination boundaries', async () => {
  const profiles = new Map(
    await Promise.all(canonicalDockPaths.map(async (dockPath) => {
      const profile = await loadJson(dockPath);
      return [profile.name, profile];
    })),
  );

  assert.ok(profiles.get('foreman').allowed_capabilities.includes('dev.github.issue_comment'));
  assert.ok(!profiles.get('gdi').allowed_capabilities.includes('dev.github.issue_comment'));
  assert.ok(!profiles.get('operator').allowed_capabilities.includes('dev.github.issue_comment'));
  assert.ok(profiles.get('foreman').allowed_capabilities.includes('dev.github.issue_create'));
  assert.ok(!profiles.get('gdi').allowed_capabilities.includes('dev.github.issue_create'));
  assert.ok(!profiles.get('operator').allowed_capabilities.includes('dev.github.issue_create'));
  assert.ok(profiles.get('foreman').allowed_capabilities.includes('dev.github.issue_close'));
  assert.ok(!profiles.get('gdi').allowed_capabilities.includes('dev.github.issue_close'));
  assert.ok(!profiles.get('operator').allowed_capabilities.includes('dev.github.issue_close'));
  assert.ok(profiles.get('foreman').allowed_capabilities.includes('dev.github.issue_edit'));
  assert.ok(!profiles.get('gdi').allowed_capabilities.includes('dev.github.issue_edit'));
  assert.ok(!profiles.get('operator').allowed_capabilities.includes('dev.github.issue_edit'));
  assert.ok(profiles.get('foreman').allowed_capabilities.includes('dev.github.pr_comment'));
  assert.ok(!profiles.get('gdi').allowed_capabilities.includes('dev.github.pr_comment'));
  assert.ok(!profiles.get('operator').allowed_capabilities.includes('dev.github.pr_comment'));
  assert.ok(profiles.get('foreman').allowed_capabilities.includes('dev.github.pr_merge'));
  assert.ok(!profiles.get('gdi').allowed_capabilities.includes('dev.github.pr_merge'));
  assert.ok(!profiles.get('operator').allowed_capabilities.includes('dev.github.pr_merge'));

  for (const profileName of ['foreman', 'gdi', 'operator']) {
    const allowed = profiles.get(profileName).allowed_capabilities;
    assert.ok(allowed.includes('dev.github.issue_list'), `${profileName} should allow issue inventory`);
    assert.ok(allowed.includes('dev.github.issue_view'), `${profileName} should allow issue reads`);
    assert.ok(allowed.includes('dev.github.label_list'), `${profileName} should allow label inventory`);
    assert.ok(allowed.includes('dev.github.pr_list'), `${profileName} should allow PR inventory`);
    assert.ok(allowed.includes('dev.github.pr_view'), `${profileName} should allow PR reads`);
    assert.ok(allowed.includes('dev.github.pr_checks'), `${profileName} should allow PR check reads`);
  }

  assert.equal(profiles.get('operator').default_entry_path, 'agent_harness');
  assert.ok(!profiles.get('operator').allowed_capability_classes.includes('external_write'));
  assert.ok(!profiles.get('operator').allowed_capability_classes.includes('host_write'));

  assert.ok(profiles.get('foreman').allowed_capabilities.includes('dev.test.schema_node'));
  assert.ok(profiles.get('gdi').allowed_capabilities.includes('dev.test.schema_node'));
  assert.ok(!profiles.get('operator').allowed_capabilities.includes('dev.test.schema_node'));
});
