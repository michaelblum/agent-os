import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { evaluateProofWorth, loadProofRegistry } from '../../scripts/lib/dev-test-proof-registry.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../..');
const schemaPath = path.join(repoRoot, 'shared/schemas/dev-test-proof-registry.schema.json');
const canonicalPath = path.join(repoRoot, 'docs/dev/test-proof-registry.json');
const fragmentRoot = path.join(repoRoot, 'docs/dev/test-proof-registry.d');
const fixtureRoot = path.join(repoRoot, 'shared/schemas/fixtures/dev-test-proof-registry');

async function jsonFiles(dir, recursive = false) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory() && recursive) files.push(...await jsonFiles(full, true));
    else if (entry.isFile() && entry.name.endsWith('.json')) files.push(full);
  }
  return files.sort();
}

async function loadJson(file) {
  return JSON.parse(await fs.readFile(file, 'utf8'));
}

function loadCanonicalRegistry() {
  return loadProofRegistry({ repoRoot, registryPath: 'docs/dev/test-proof-registry.json' }).registry;
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

test('canonical dev test proof registry index matches the schema', () => {
  const result = validate(canonicalPath);
  assert.equal(result.status, 0, `${result.stdout}${result.stderr}`);
});

test('dev test proof registry fragments match the schema', async () => {
  const fragments = await jsonFiles(fragmentRoot);
  assert.ok(fragments.length >= 1, 'expected proof registry fragments');
  for (const fragment of fragments) {
    const result = validate(fragment);
    assert.equal(
      result.status,
      0,
      `${path.relative(repoRoot, fragment)} should validate\n${result.stdout}${result.stderr}`,
    );
  }
});

test('dev test proof registry source files stay decomposed', async () => {
  const files = [canonicalPath, ...await jsonFiles(fragmentRoot)];
  for (const file of files) {
    const lineCount = (await fs.readFile(file, 'utf8')).split(/\r?\n/).length - 1;
    assert.ok(lineCount < 1000, `${path.relative(repoRoot, file)} must stay under 1000 lines; saw ${lineCount}`);
  }
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
  const registry = loadCanonicalRegistry();
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
  const registry = loadCanonicalRegistry();
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

test('proof-worth evaluator routes every embedded Sigil path to the frozen fixture proof', () => {
  const registry = loadCanonicalRegistry();
  const result = evaluateProofWorth({
    changedFiles: [
      'apps/sigil/renderer/state.js',
      'apps/sigil/legacy-fixture.json',
    ],
    repoRoot,
    registry,
    registryPath: 'docs/dev/test-proof-registry.json',
  });

  assert.equal(result.status, 'passed', result);
  assert.equal(result.assets.length, 2, result);
  assert.deepEqual(result.assets.map((asset) => asset.kind), ['fixture', 'fixture']);
  assert.deepEqual(result.assets.map((asset) => asset.coverage), ['active', 'active']);
  assert.deepEqual(result.commands.map((item) => item.command), [
    'node --test tests/legacy-sigil-fixture.test.mjs tests/schemas/aos-app-v0.test.mjs tests/schemas/aos-experience-v0.test.mjs',
  ]);
  assert.deepEqual(result.commands[0].source_entries, ['legacy-sigil-fixture-proof']);
});

test('proof-worth evaluator routes deleted embedded Sigil bytes to the surviving fixture proof', () => {
  const registry = loadCanonicalRegistry();
  const result = evaluateProofWorth({
    changedFiles: ['apps/sigil/renderer/deleted-fixture-byte.js'],
    repoRoot,
    registry,
    registryPath: 'docs/dev/test-proof-registry.json',
  });

  assert.equal(result.status, 'passed', result);
  assert.equal(result.assets.length, 1, result);
  assert.equal(result.assets[0].kind, 'fixture');
  assert.equal(result.assets[0].deleted, true);
  assert.equal(result.assets[0].coverage, 'deleted_registered_cleanup');
  assert.deepEqual(result.commands.map((item) => item.command), [
    'node --test tests/legacy-sigil-fixture.test.mjs tests/schemas/aos-app-v0.test.mjs tests/schemas/aos-experience-v0.test.mjs',
  ]);
  assert.deepEqual(result.commands[0].source_entries, ['legacy-sigil-fixture-proof']);
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
  const registry = loadCanonicalRegistry();
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
  const registry = loadCanonicalRegistry();
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

test('proof-worth evaluator routes process-cleanup isolation through both consumers and its lock proof', () => {
  const registry = loadCanonicalRegistry();
  const result = evaluateProofWorth({
    changedFiles: ['tests/lib/process-cleanup-serial.sh'],
    repoRoot,
    registry,
    registryPath: 'docs/dev/test-proof-registry.json',
  });

  assert.equal(result.passed, true, result.failures?.[0]?.message);
  assert.deepEqual(
    result.commands.map((item) => item.command).sort(),
    [
      'bash tests/external-command-dispatch.sh',
      'bash tests/process-cleanup-serial.sh',
      'bash tests/ready-explicit-repair-flow.sh',
    ],
  );
});

test('proof-worth evaluator routes skills efficacy fixture through test and CLI proofs', async () => {
  const registry = loadCanonicalRegistry();
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

test('proof-worth evaluator routes root skills command and forward proofs', async () => {
  const registry = loadCanonicalRegistry();
  const result = evaluateProofWorth({
    changedFiles: [
      'tests/aos-skills-command.test.mjs',
      'tests/aos-skills-companion.test.mjs',
      'tests/fixtures/aos-skills/cold-agent-forward-proof-v0.json',
    ],
    repoRoot,
    registry,
    registryPath: 'docs/dev/test-proof-registry.json',
  });

  assert.equal(result.status, 'passed', result);
  assert.deepEqual(result.commands.map((item) => item.command), [
    'node --test tests/aos-skills-command.test.mjs',
    'node --test tests/aos-skills-companion.test.mjs',
    'node --test tests/aos-skills-forward-proof.test.mjs',
  ]);
  assert.ok(result.guarded.some((item) => item.entry === 'cross-backend-saved-ref-manual-proof'));
});

test('proof-worth evaluator routes voice proof family assets', async () => {
  const registry = loadCanonicalRegistry();
  const result = evaluateProofWorth({
    changedFiles: [
      'shared/schemas/fixtures/daemon-event/valid/voice-dictation-opened-phrase.json',
      'tests/toolkit/controls-dictation.test.mjs',
      'tests/voice-bind.sh',
      'tests/voice-cursor-rotation.sh',
      'tests/voice-external-parser.sh',
      'tests/voice-final-response.sh',
      'tests/voice-id-canonicalization.sh',
      'tests/voice-policy-reload.sh',
      'tests/voice-providers.sh',
      'tests/voice-registry-snapshot.sh',
      'tests/voice-session-allocation.sh',
      'tests/voice-telemetry.sh',
    ],
    repoRoot,
    registry,
    registryPath: 'docs/dev/test-proof-registry.json',
  });

  assert.equal(result.status, 'passed', result);
  assert.deepEqual(result.commands.map((item) => item.command).sort(), [
    'bash tests/voice-bind.sh',
    'bash tests/voice-cursor-rotation.sh',
    'bash tests/voice-external-parser.sh',
    'bash tests/voice-final-response.sh',
    'bash tests/voice-id-canonicalization.sh',
    'bash tests/voice-policy-reload.sh',
    'bash tests/voice-providers.sh',
    'bash tests/voice-registry-snapshot.sh',
    'bash tests/voice-session-allocation.sh',
    'bash tests/voice-telemetry.sh',
    'node --test tests/schemas/daemon-event.test.mjs',
    'node --test tests/toolkit/controls-dictation.test.mjs',
  ].sort());
});

test('proof-worth evaluator routes toolkit input identity normalization', async () => {
  const registry = loadCanonicalRegistry();
  const result = evaluateProofWorth({
    changedFiles: ['tests/toolkit/runtime-input-events.test.mjs'],
    repoRoot,
    registry,
    registryPath: 'docs/dev/test-proof-registry.json',
  });

  assert.equal(result.status, 'passed', result);
  assert.deepEqual(result.commands.map((item) => item.command), [
    'node --test tests/toolkit/runtime-input-events.test.mjs tests/toolkit/runtime-gesture-stream.test.mjs tests/toolkit/stage-affordance.test.mjs tests/toolkit/panel-chrome.test.mjs tests/toolkit/surface-inspector-mouse-effects.test.mjs tests/toolkit/passive-component-semantics.test.mjs',
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
