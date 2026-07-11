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
    'node scripts/aos-dev-build.mjs build --no-restart --json',
  );
  assert.equal(
    rules.get('swift-core')?.verification?.[0]?.command,
    './aos ready --post-permission',
  );
  assert.ok(
    rules.get('swift-core')?.notes?.some((note) =>
      note.includes('bash build.sh --force --no-restart') && note.includes('exits 137'),
    ),
  );
  assert.ok(
    rules.get('swift-core')?.notes?.some((note) =>
      note.includes('direct build.sh swiftc output only') && note.includes('spctl launch gate'),
    ),
  );
  assert.deepEqual(
    rules.get('repo-build-tooling')?.commands?.map((step) => step.command),
    ['bash tests/build-rebuild-policy.sh'],
  );
  assert.ok(rules.get('repo-build-tooling')?.patterns?.includes('build.sh'));
  assert.ok(rules.get('repo-build-tooling')?.patterns?.includes('tests/build-rebuild-policy.sh'));
  assert.ok(
    rules.get('repo-build-tooling')?.notes?.some((note) =>
      note.includes('bash build.sh --force --no-restart') && note.includes('post-build codesign'),
    ),
  );
  assert.ok(
    rules.get('repo-build-tooling')?.notes?.some((note) =>
      note.includes('spctl rejection is expected') && note.includes('launchability'),
    ),
  );
  assert.deepEqual(
    rules.get('root-skill-packages')?.commands?.map((step) => step.command),
    [
      'node scripts/aos-skills-validate.mjs --json',
      'node --test tests/aos-skills-registry.test.mjs',
    ],
  );
  assert.ok(rules.get('root-skill-packages')?.patterns?.includes('skills/**'));
  assert.equal(
    rules.get('command-contract-docs')?.commands?.[0]?.command,
    'bash tests/help-contract.sh',
  );
  assert.deepEqual(
    rules.get('visual-harness-primitives')?.commands?.map((step) => step.command),
    [
      'bash tests/visual-harness-boundary.sh',
      'bash tests/visual-harness-canonical-url-primitives.sh',
      'bash tests/visual-harness-content-preflight.sh',
      'bash tests/harness-composability-contracts.sh',
    ],
  );
  assert.ok(rules.get('visual-harness-primitives')?.patterns?.includes('tests/lib/visual-harness.sh'));
  assert.deepEqual(
    rules.get('command-surface-manifests')?.commands?.map((step) => step.command),
    [
      'bash tests/command-manifest-generation.sh',
      'node --test tests/schemas/aos-external-command-manifest-v0.test.mjs',
      'bash tests/external-command-dispatch.sh',
      'node --test tests/aos-dev-gh-help-parity.test.mjs',
      'bash tests/help-contract.sh',
    ],
  );
  assert.ok(rules.get('command-surface-manifests')?.patterns?.includes('manifests/commands/*.json'));
  assert.ok(rules.get('command-surface-manifests')?.patterns?.includes('manifests/commands/source/**'));
  assert.ok(rules.get('command-surface-manifests')?.patterns?.includes('scripts/generate-command-manifests.mjs'));
  assert.ok(rules.get('command-surface-manifests')?.patterns?.includes('manifests/commands/*.json'));
  assert.ok(rules.get('command-surface-manifests')?.patterns?.includes('tests/command-manifest-generation.sh'));
  assert.ok(rules.get('command-surface-manifests')?.patterns?.includes('shared/schemas/aos-external-command-manifest-v0.schema.json'));
  assert.ok(rules.get('command-surface-manifests')?.patterns?.includes('tests/aos-dev-gh-help-parity.test.mjs'));
  assert.deepEqual(
    rules.get('command-surface-implementations')?.commands?.map((step) => step.command),
    [
      'bash tests/external-command-dispatch.sh',
      'bash tests/external-parser-flags.sh',
      'node --test tests/aos-dev-gh-help-parity.test.mjs',
      'bash tests/help-contract.sh',
    ],
  );
  assert.ok(rules.get('command-surface-implementations')?.patterns?.includes('scripts/aos-*.mjs'));
  assert.ok(rules.get('command-surface-implementations')?.patterns?.includes('scripts/aos-*'));
  assert.equal(rules.get('command-surface-implementations')?.hot_swappable, true);
  assert.equal(rules.get('command-surface-implementations')?.tcc_identity_sensitive, false);
  assert.deepEqual(
    rules.get('dev-gh-helper')?.commands?.map((step) => step.command),
    [
      'node --test tests/aos-dev-gh-contract.test.mjs',
      'node --test tests/aos-dev-gh-help-parity.test.mjs',
    ],
  );
  assert.ok(rules.get('dev-gh-helper')?.patterns?.includes('scripts/aos-dev-gh.mjs'));
  assert.ok(rules.get('dev-gh-helper')?.patterns?.includes('scripts/aos-dev-gh-spec.mjs'));
  assert.ok(rules.get('dev-gh-helper')?.patterns?.includes('tests/aos-dev-gh-contract.test.mjs'));
  assert.equal(rules.has('aos-agent-runner'), false);
  assert.equal(rules.get('toolkit-components')?.hot_swappable, true);
  assert.equal(rules.get('schemas')?.commands?.[0]?.command, 'node --test tests/schemas/*.test.mjs');
  assert.deepEqual(
    rules.get('dev-workflow-manifest')?.commands?.map((step) => step.command),
    [
      'node --test tests/schemas/dev-test-proof-registry.test.mjs',
      'node --test tests/schemas/dev-workflow-rules.test.mjs',
      'node --test tests/schemas/dev-active-profile.test.mjs',
      'node --test tests/schemas/dev-workflow-profiles.test.mjs',
      'bash tests/dev-workflow-router.sh',
      'bash tests/dev-audit.sh',
      'bash tests/dev-situation.sh',
      'bash tests/dev-drift-lint.sh',
    ],
  );
  assert.ok(rules.get('dev-workflow-manifest')?.patterns?.includes('scripts/aos-dev-workflow.mjs'));
  assert.ok(rules.get('dev-workflow-manifest')?.patterns?.includes('scripts/aos-dev-situation.mjs'));
  assert.ok(rules.get('dev-workflow-manifest')?.patterns?.includes('scripts/aos-dev-drift-lint.mjs'));
  assert.ok(rules.get('dev-workflow-manifest')?.patterns?.includes('scripts/lib/dev-test-proof-registry.mjs'));
  assert.ok(rules.get('dev-workflow-manifest')?.patterns?.includes('tests/dev-situation.sh'));
  assert.ok(rules.get('dev-workflow-manifest')?.patterns?.includes('tests/dev-drift-lint.sh'));
  assert.ok(rules.get('dev-workflow-manifest')?.patterns?.includes('docs/dev/test-proof-registry.json'));
  assert.ok(rules.get('dev-workflow-manifest')?.patterns?.includes('docs/dev/test-proof-registry.d/**'));
  assert.ok(rules.get('dev-workflow-manifest')?.patterns?.includes('shared/schemas/dev-test-proof-registry.schema.json'));
  assert.ok(rules.get('dev-workflow-manifest')?.patterns?.includes('shared/schemas/fixtures/dev-test-proof-registry/**'));
  assert.ok(rules.get('dev-workflow-manifest')?.patterns?.includes('tests/schemas/dev-test-proof-registry.test.mjs'));
  assert.ok(rules.get('dev-workflow-manifest')?.patterns?.includes('docs/dev/workflow-profiles.json'));
  assert.ok(rules.get('dev-workflow-manifest')?.patterns?.includes('docs/dev/active-profile.json'));
  assert.ok(rules.get('dev-workflow-manifest')?.patterns?.includes('tests/schemas/dev-active-profile.test.mjs'));
  assert.ok(rules.get('dev-workflow-manifest')?.patterns?.includes('tests/schemas/dev-workflow-profiles.test.mjs'));
  assert.equal(
    rules.get('agent-capability-manifest')?.commands?.[0]?.command,
    'node --test tests/schemas/aos-agent-capability-manifest-v0.test.mjs',
  );
  assert.ok(rules.get('agent-capability-manifest')?.patterns?.includes('docs/dev/agent-capabilities.json'));
  assert.equal(rules.has('dock-profiles'), false);
  assert.equal(rules.has('aos-agent-runner-team'), false);
  assert.ok(rules.get('app-subtree-local-contract')?.notes?.[0]?.includes('nearest subtree AGENTS.md'));
});
