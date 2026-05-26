import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../..');
const schemaPath = path.join(repoRoot, 'shared/schemas/aos-app-v0.schema.json');
const sigilManifestPath = path.join(repoRoot, 'apps/sigil/aos-app.json');

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

test('Sigil app manifest validates against the generic app schema', () => {
  const result = validate(sigilManifestPath);
  assert.equal(result.status, 0, `${result.stdout}${result.stderr}`);
});

test('Sigil manifest keeps launch policy data-owned', async () => {
  const manifest = JSON.parse(await fs.readFile(sigilManifestPath, 'utf8'));
  assert.equal(manifest.id, 'sigil');
  assert.equal(manifest.default_entry, 'workbench');
  assert.deepEqual(Object.keys(manifest.entries).sort(), ['agent-terminal', 'avatar', 'workbench']);
  assert.ok(manifest.content_roots.every((root) => root.branch_scoped === true));
  assert.equal(manifest.status_item.toggle_entry, 'avatar');
  assert.doesNotMatch(JSON.stringify(manifest), /studio/i);
});
