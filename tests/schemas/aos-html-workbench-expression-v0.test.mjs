import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../..');
const schemaPath = path.join(repoRoot, 'shared/schemas/aos-html-workbench-expression-v0.schema.json');
const fixturePaths = [
  'docs/design/fixtures/aos-html-workbench-expression-v0/expression.json',
];

for (const fixturePath of fixturePaths) {
  test(`${fixturePath} matches the canonical schema`, () => {
    const result = spawnSync(
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
    for error in errors[:12]:
        print(error.message)
    sys.exit(1)
`,
        schemaPath,
        path.join(repoRoot, fixturePath),
      ],
      { encoding: 'utf8' },
    );

    assert.equal(result.status, 0, `${result.stdout}${result.stderr}`);
  });
}
