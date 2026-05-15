import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../..');
const schemaPath = path.join(repoRoot, 'shared/schemas/dev-active-profile.schema.json');
const activeProfilePath = path.join(repoRoot, 'docs/dev/active-profile.json');
const profilesPath = path.join(repoRoot, 'docs/dev/workflow-profiles.json');

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

test('canonical active profile selector matches the schema', () => {
  const result = validate(activeProfilePath);
  assert.equal(result.status, 0, `${result.stdout}${result.stderr}`);
});

test('active profile is defined in the workflow profile manifest', () => {
  const result = spawnSync(
    'python3',
    [
      '-c',
      `
import json, sys
from pathlib import Path

active = json.loads(Path(sys.argv[1]).read_text())["active_profile"]
profiles = json.loads(Path(sys.argv[2]).read_text())["profiles"]
ids = {profile["id"] for profile in profiles}
assert active in ids, f"active profile {active!r} is not defined"
assert "active_profile" not in json.loads(Path(sys.argv[2]).read_text()), "workflow-profiles.json must not select the active profile"
`,
      activeProfilePath,
      profilesPath,
    ],
    { encoding: 'utf8' },
  );
  assert.equal(result.status, 0, `${result.stdout}${result.stderr}`);
});
