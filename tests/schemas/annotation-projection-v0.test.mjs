import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  buildAnnotationProjectionResult,
  buildBrowserContentSeamAdapterResult,
} from '../../packages/toolkit/workbench/annotation-projection.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../..');
const schemaPath = path.join(repoRoot, 'shared/schemas/annotation-projection-v0.schema.json');
const fixturePath = path.join(repoRoot, 'docs/design/fixtures/annotation-projection-v0/markdown-workbench-line-text.json');

function validateInstance(instance) {
  return spawnSync(
    'python3',
    [
      '-c',
      `
import json, sys
from pathlib import Path
from jsonschema import Draft202012Validator

schema = json.loads(Path(sys.argv[1]).read_text())
instance = json.loads(sys.stdin.read())
Draft202012Validator.check_schema(schema)
validator = Draft202012Validator(schema)
errors = sorted(validator.iter_errors(instance), key=lambda e: list(e.path))
if errors:
    for error in errors[:8]:
        print(error.message)
    sys.exit(1)
`,
      schemaPath,
    ],
    { encoding: 'utf8', input: JSON.stringify(instance) },
  );
}

function validateFixture() {
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

test('markdown workbench annotation projection fixture matches the canonical schema', () => {
  const result = validateFixture();
  assert.equal(result.status, 0, `${result.stdout}${result.stderr}`);
});

test('generated adapter results match the canonical annotation projection schema', () => {
  const projection = buildAnnotationProjectionResult({
    surface_binding: {
      surface_id: 'browser-shell',
      surface_type: 'browser_page',
    },
    viewport: {
      width: 800,
      height: 600,
    },
    annotations: [],
    adapter_projections: [
      buildBrowserContentSeamAdapterResult({
        id: 'local-session',
        headless: false,
        browser_window_id: 7,
      }),
    ],
  });

  assert.equal(projection.adapter_results.length, 1);
  assert.equal(projection.adapter_results[0].coordinate_space, 'native_display');

  const result = validateInstance(projection);
  assert.equal(result.status, 0, `${result.stdout}${result.stderr}`);
});
