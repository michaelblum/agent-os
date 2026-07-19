import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const v0Path = path.join(repoRoot, 'shared/schemas/aos-experience-runtime-context-v0.schema.json');
const v1Path = path.join(repoRoot, 'shared/schemas/aos-experience-runtime-context-v1.schema.json');

test('runtime-context v0 stays frozen with status_item while v1 removes that projection', async () => {
  const [v0, v1] = await Promise.all([
    fs.readFile(v0Path, 'utf8').then(JSON.parse),
    fs.readFile(v1Path, 'utf8').then(JSON.parse),
  ]);

  assert.equal(v0.properties.schema_version.const, 'aos.experience-runtime-context.v0');
  assert(v0.required.includes('status_item'));
  assert.equal(Object.hasOwn(v0.properties, 'status_item'), true);
  assert.equal(Object.hasOwn(v0.$defs, 'status_item'), true);

  assert.equal(v1.properties.schema_version.const, 'aos.experience-runtime-context.v1');
  assert.equal(v1.required.includes('status_item'), false);
  assert.equal(Object.hasOwn(v1.properties, 'status_item'), false);
  assert.equal(Object.hasOwn(v1.$defs, 'status_item'), false);

  const result = spawnSync('python3', ['-c', `
import json, sys
from pathlib import Path
from jsonschema import Draft202012Validator
for schema_path in sys.argv[1:]:
    Draft202012Validator.check_schema(json.loads(Path(schema_path).read_text()))
`, v0Path, v1Path], { encoding: 'utf8' });
  assert.equal(result.status, 0, `${result.stdout}${result.stderr}`);
});
