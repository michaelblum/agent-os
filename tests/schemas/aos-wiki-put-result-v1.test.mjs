import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const schemaPath = path.join(repoRoot, 'shared/schemas/aos-wiki-put-result-v1.schema.json');
const fixtureRoot = path.join(repoRoot, 'shared/schemas/fixtures/aos-wiki-put-result-v1');

async function jsonFiles(directory) {
  return (await fs.readdir(directory, { withFileTypes: true }))
    .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
    .map((entry) => path.join(directory, entry.name))
    .sort();
}

function validate(fixturePath) {
  return spawnSync('python3', [
    '-c',
    `
import json, sys
from pathlib import Path
from jsonschema import Draft202012Validator

schema = json.loads(Path(sys.argv[1]).read_text())
instance = json.loads(Path(sys.argv[2]).read_text())
Draft202012Validator.check_schema(schema)
errors = sorted(Draft202012Validator(schema).iter_errors(instance), key=lambda error: list(error.path))
if errors:
    for error in errors[:8]:
        print(error.message)
    sys.exit(1)
`,
    schemaPath,
    fixturePath,
  ], { encoding: 'utf8' });
}

test('valid wiki put results match the canonical schema', async () => {
  for (const fixture of await jsonFiles(path.join(fixtureRoot, 'valid'))) {
    const result = validate(fixture);
    assert.equal(result.status, 0, `${path.relative(repoRoot, fixture)}\n${result.stdout}${result.stderr}`);
  }
});

test('wiki put result schema rejects leaks and inconsistent create metadata', async () => {
  for (const fixture of await jsonFiles(path.join(fixtureRoot, 'invalid'))) {
    const result = validate(fixture);
    assert.notEqual(result.status, 0, `${path.relative(repoRoot, fixture)} unexpectedly validated`);
  }
});
