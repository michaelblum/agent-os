import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createWorkbenchSubject } from '../../packages/toolkit/workbench/subject.js';
import { buildMarkdownWorkbenchSubject, createMarkdownWorkbenchState } from '../../packages/toolkit/components/markdown-workbench/model.js';
import { buildRadialItemWorkbenchSubject, createRadialItemEditorState } from '../../apps/sigil/radial-item-editor/model.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../..');
const schemaPath = path.join(repoRoot, 'shared/schemas/aos-workbench-subject.schema.json');

async function validate(instance) {
  const result = spawnSync(
    'python3',
    [
      '-c',
      `
import json, sys
from pathlib import Path
from jsonschema import Draft202012Validator

schema = json.loads(Path(sys.argv[1]).read_text())
instance = json.loads(sys.argv[2])
Draft202012Validator.check_schema(schema)
errors = sorted(Draft202012Validator(schema).iter_errors(instance), key=lambda e: list(e.path))
if errors:
    for error in errors[:8]:
        print(error.message)
    sys.exit(1)
`,
      schemaPath,
      JSON.stringify(instance),
    ],
    { encoding: 'utf8' },
  );
  assert.equal(result.status, 0, `${result.stdout}${result.stderr}`);
}

test('toolkit workbench subject helper emits schema-valid descriptors', async () => {
  await fs.access(schemaPath);
  await validate(createWorkbenchSubject({
    id: 'file:docs/example.md',
    type: 'markdown.document',
    label: 'example.md',
    owner: 'markdown-workbench',
  }));
});

test('current workbench adopters emit schema-valid subject descriptors', async () => {
  await validate(buildMarkdownWorkbenchSubject(createMarkdownWorkbenchState({
    path: 'docs/example.md',
    content: '# Example',
  })));
  await validate(buildRadialItemWorkbenchSubject(createRadialItemEditorState({
    itemId: 'wiki-graph',
    canvasId: 'preview',
  })));
});
