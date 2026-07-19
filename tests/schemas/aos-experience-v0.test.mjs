import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { discoverExperience } from '../../scripts/lib/experience-manifest.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const schemaPath = path.join(repoRoot, 'shared/schemas/aos-experience-v0.schema.json');
const fixturePath = path.join(repoRoot, 'tests/fixtures/legacy-sigil/aos-experience.fixture.json');

test('legacy v0 experience fixture remains schema-valid', () => {
  const result = spawnSync('python3', ['-c', `
import json, sys
from pathlib import Path
from jsonschema import Draft202012Validator

schema = json.loads(Path(sys.argv[1]).read_text())
instance = json.loads(Path(sys.argv[2]).read_text())
Draft202012Validator.check_schema(schema)
errors = sorted(Draft202012Validator(schema).iter_errors(instance), key=lambda error: list(error.path))
if errors:
    for error in errors:
        print(error.message)
    sys.exit(1)
`, schemaPath, fixturePath], { encoding: 'utf8' });
  assert.equal(result.status, 0, `${result.stdout}${result.stderr}`);
});

test('discovery normalizes legacy v0 status-item fields into the active v1 manifest', async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'aos-experience-v0-adapter-'));
  const experienceDir = path.join(tmp, 'sigil');
  await fs.mkdir(experienceDir, { recursive: true });
  await fs.copyFile(fixturePath, path.join(experienceDir, 'aos-experience.json'));

  const manifest = discoverExperience('sigil', { experiencesRoot: tmp });
  assert.equal(manifest.schema_version, 1);
  assert.equal(Object.hasOwn(manifest, '$schema'), false);
  assert.equal(Object.hasOwn(manifest, 'default_activation'), false);
  assert.equal(Object.hasOwn(manifest, 'status_item'), false);
  assert.deepEqual(manifest.vanilla_fallback, {
    tools: ['avatar-terminal', 'graph-wiki', 'inspectors'],
  });
  assert.equal(manifest.menu.find((item) => item.id === 'annotate-this-thing')?.surface, 'avatar-main');
  assert.equal(manifest.surfaces['avatar-main']?.summary.length > 0, true);
  assert.equal(manifest.hooks[0]?.phase, 'before_activate');
});
