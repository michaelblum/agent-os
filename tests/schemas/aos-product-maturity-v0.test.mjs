import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../..');
const schemaPath = path.join(repoRoot, 'shared/schemas/aos-product-maturity-v0.schema.json');
const declarationPath = path.join(repoRoot, 'docs/dev/product-maturity.json');

function validate(instancePath) {
  return spawnSync('python3', [
    '-c',
    `
import json, sys
from pathlib import Path
from jsonschema import Draft202012Validator

schema = json.loads(Path(sys.argv[1]).read_text())
instance = json.loads(Path(sys.argv[2]).read_text())
Draft202012Validator.check_schema(schema)
errors = sorted(Draft202012Validator(schema).iter_errors(instance), key=lambda e: list(e.path))
if errors:
    for error in errors[:8]:
        print(error.message)
    sys.exit(1)
`,
    schemaPath,
    instancePath,
  ], { encoding: 'utf8' });
}

test('canonical product maturity declaration matches its schema', () => {
  const result = validate(declarationPath);
  assert.equal(result.status, 0, `${result.stdout}${result.stderr}`);
});

test('product maturity schema rejects compatibility exceptions without removal ownership', async () => {
  const tmp = await mkdtemp(path.join(os.tmpdir(), 'aos-product-maturity-schema-'));
  try {
    const invalidPath = path.join(tmp, 'invalid.json');
    const invalid = JSON.parse(await readFile(declarationPath, 'utf8'));
    invalid.compatibility_exceptions = [{
      id: 'missing-removal',
      owner: 'AOS maintainers',
      justification: 'Schema rejection fixture.',
      evidence: {
        kind: 'persisted_data_dependency',
        reference: 'tests/fixtures/example.json',
      },
      active_paths: ['scripts/example.mjs'],
      removal: {},
      regression_tests: ['tests/example.test.mjs'],
    }];
    await writeFile(invalidPath, `${JSON.stringify(invalid, null, 2)}\n`);
    const result = validate(invalidPath);
    assert.notEqual(result.status, 0, 'missing removal condition or milestone must fail');
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
});
