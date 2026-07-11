import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../..');
const schemaPath = path.join(repoRoot, 'shared/schemas/aos-app-v0.schema.json');
const legacySigilManifestPath = path.join(repoRoot, 'apps/sigil/aos-app.fixture.json');

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

test('legacy Sigil fixture manifest validates against the generic app schema', () => {
  const result = validate(legacySigilManifestPath);
  assert.equal(result.status, 0, `${result.stdout}${result.stderr}`);
});

test('legacy Sigil fixture preserves its frozen launch-policy shape', async () => {
  const manifest = JSON.parse(await fs.readFile(legacySigilManifestPath, 'utf8'));
  assert.equal(manifest.id, 'sigil');
  assert.equal(manifest.default_entry, 'avatar');
  assert.deepEqual(Object.keys(manifest.entries).sort(), ['agent-terminal', 'avatar', 'legacy-workbench']);
  assert.ok(manifest.content_roots.every((root) => root.branch_scoped === true));
  assert.equal(manifest.status_item.toggle_entry, 'avatar');
  assert.equal(manifest.entries['legacy-workbench'].requires_entries[0], 'avatar');
});

test('legacy Sigil is absent from active app discovery', () => {
  const result = spawnSync('node', ['scripts/aos-launch.mjs', 'sigil', '--dry-run', '--json'], {
    cwd: repoRoot,
    encoding: 'utf8',
  });
  assert.equal(result.status, 1, result.stdout);
  const payload = JSON.parse(result.stderr);
  assert.equal(payload.status, 'failure');
  assert.equal(payload.code, 'APP_NOT_FOUND');
});
