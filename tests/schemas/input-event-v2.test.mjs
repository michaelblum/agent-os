import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import validateGeneratedInputEvent from '../../packages/toolkit/runtime/input-event-validator.generated.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../..');
const schemaPath = path.join(repoRoot, 'shared/schemas/input-event-v2.schema.json');
const fixtureRoot = path.join(repoRoot, 'shared/schemas/fixtures/input-event-v2');
const generatorPath = path.join(repoRoot, 'scripts/generate-input-event-validator.mjs');
const generatedValidatorPath = path.join(repoRoot, 'packages/toolkit/runtime/input-event-validator.generated.js');

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

test('browser-safe input validator is compiled from the canonical schema', async () => {
  const result = spawnSync('node', [generatorPath, '--check'], { encoding: 'utf8' });
  assert.equal(result.status, 0, `${result.stdout}${result.stderr}`);

  const source = await fs.readFile(generatedValidatorPath, 'utf8');
  assert.match(source, /Compiled with Ajv standalone/);
  assert.doesNotMatch(source, /^\s*import\s/m);
  assert.doesNotMatch(source, /\brequire\s*\(/);
  assert.doesNotMatch(source, /json-schema-validator/);
});

test('valid input-event v2 fixtures match the canonical schema', async () => {
  const fixtures = await jsonFiles(path.join(fixtureRoot, 'valid'));
  assert.ok(fixtures.length >= 1, 'expected valid fixtures');
  for (const fixture of fixtures) {
    const instance = JSON.parse(await fs.readFile(fixture, 'utf8'));
    const result = runJsonschema(fixture);
    assert.equal(
      result.status,
      0,
      `${path.relative(repoRoot, fixture)} should validate\n${result.stdout}${result.stderr}`,
    );
    assert.equal(
      validateGeneratedInputEvent(instance),
      true,
      `${path.relative(repoRoot, fixture)} should pass generated validation: ${JSON.stringify(validateGeneratedInputEvent.errors)}`,
    );
  }
});

test('invalid input-event v2 fixtures are rejected by the canonical schema', async () => {
  const fixtures = await jsonFiles(path.join(fixtureRoot, 'invalid'));
  assert.ok(fixtures.length >= 1, 'expected invalid fixtures');
  for (const fixture of fixtures) {
    const instance = JSON.parse(await fs.readFile(fixture, 'utf8'));
    const result = runJsonschema(fixture);
    assert.notEqual(result.status, 0, `${path.relative(repoRoot, fixture)} should fail validation`);
    assert.equal(validateGeneratedInputEvent(instance), false, `${path.relative(repoRoot, fixture)} should fail generated validation`);
  }
});

test('mixed-source ordering fixture keeps synthetic cancel causally inserted', async () => {
  const fixturePath = path.join(fixtureRoot, 'sequences/mixed-source-ordering.json');
  const fixture = JSON.parse(await fs.readFile(fixturePath, 'utf8'));

  for (const event of fixture.events) {
    const tmpPath = path.join(
      repoRoot,
      `.tmp-input-event-${event.sequence.source}-${event.sequence.value}.json`,
    );
    await fs.writeFile(tmpPath, JSON.stringify(event));
    try {
      const result = runJsonschema(tmpPath);
      assert.equal(result.status, 0, `sequence event should validate: ${result.stdout}${result.stderr}`);
    } finally {
      await fs.rm(tmpPath, { force: true });
    }
  }

  const actualOrder = fixture.events.map((event) => `${event.sequence.source}:${event.sequence.value}`);
  assert.deepEqual(actualOrder, fixture.expected_order);

  const syntheticIndex = fixture.events.findIndex((event) => event.sequence.synthetic);
  assert.ok(syntheticIndex > 0, 'expected a synthetic event after its cause');
  const synthetic = fixture.events[syntheticIndex];
  const cause = fixture.events[syntheticIndex - 1];
  assert.deepEqual(synthetic.caused_by_sequence, cause.sequence);
  assert.equal(fixture.events[syntheticIndex + 1].sequence.source, 'daemon');
  assert.equal(fixture.events[syntheticIndex + 1].sequence.value, 102);
});
