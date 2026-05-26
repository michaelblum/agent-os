import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../..');
const schemaPath = path.join(repoRoot, 'shared/schemas/aos-experience-v0.schema.json');
const sigilManifestPath = path.join(repoRoot, 'experiences/sigil/aos-experience.json');

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

test('Sigil experience manifest validates against the experience schema', () => {
  const result = validate(sigilManifestPath);
  assert.equal(result.status, 0, `${result.stdout}${result.stderr}`);
});

test('Sigil experience is exclusive and status-item-first', async () => {
  const manifest = JSON.parse(await fs.readFile(sigilManifestPath, 'utf8'));
  assert.equal(manifest.id, 'sigil');
  assert.equal(manifest.exclusive, true);
  assert.equal(manifest.default_activation.kind, 'status_item');
  assert.equal(manifest.default_activation.status_item_first, true);
  assert.equal(manifest.default_activation.avatar_entry, 'avatar');
  assert.equal(manifest.status_item.toggle_surface.id, 'avatar-main');
  assert.equal(manifest.branding.display_name, 'Sigil');
  assert.deepEqual(manifest.vanilla_fallback.tools, ['avatar-terminal', 'graph-wiki', 'inspectors']);
  assert.equal(manifest.surfaces['legacy-workbench'].legacy, true);
});
