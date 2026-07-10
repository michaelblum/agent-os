import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');

async function text(relativePath) {
  return readFile(path.join(repoRoot, relativePath), 'utf8');
}

async function json(relativePath) {
  return JSON.parse(await text(relativePath));
}

function validateRecipeManifest(recipe) {
  const result = spawnSync(
    'python3',
    [
      '-c',
      `
import json
import sys
from pathlib import Path
from jsonschema import Draft202012Validator

schema = json.loads(Path(sys.argv[1]).read_text())
instance = json.loads(sys.stdin.read())
Draft202012Validator.check_schema(schema)
Draft202012Validator(schema).validate(instance)
`,
      path.join(repoRoot, 'shared/schemas/recipe.schema.json'),
    ],
    {
      input: JSON.stringify(recipe),
      encoding: 'utf8',
    },
  );
  assert.equal(result.status, 0, `${result.stdout}${result.stderr}`);
}

test('source-backed recipes can carry compact saved-ref diff postconditions', async () => {
  const registry = await json('manifests/commands/aos-commands.json');
  const see = registry.commands.find((command) => command.path.join(' ') === 'see');
  const seeRefs = see.forms.find((form) => form.id === 'see-refs');
  assert.ok(seeRefs, 'see command must expose see-refs form');
  assert.equal(seeRefs.execution.read_only, true);
  assert.equal(seeRefs.execution.mutates_state, false);
  assert.match(seeRefs.usage, /--expect-ref <ref>=added\|removed\|changed\|unchanged\|present\|missing]\.\.\./);

  const recipe = {
    id: 'fixture/ref-postcondition',
    version: 1,
    summary: 'Observe twice and gate one saved ref with a compact refs diff postcondition.',
    scope: 'source',
    mutates: true,
    requires: ['see'],
    steps: [
      {
        id: 'before-capture',
        command: { path: ['see'], form_id: 'see-capture-save' },
        argv: ['capture', 'browser:todo', '--save', '--mode', 'ax', '--workspace', 'recipe-ref-postcondition', '--name', 'before', '--query', 'Click me'],
        timeout_ms: 10000,
        assertions: [{ path: ['status'], equals: 'success' }],
      },
      {
        id: 'after-capture',
        command: { path: ['see'], form_id: 'see-capture-save' },
        argv: ['capture', 'browser:todo', '--save', '--mode', 'ax', '--workspace', 'recipe-ref-postcondition', '--name', 'after', '--query', 'Click me'],
        timeout_ms: 10000,
        assertions: [{ path: ['status'], equals: 'success' }],
      },
      {
        id: 'ref-postcondition',
        command: { path: ['see'], form_id: 'see-refs' },
        argv: ['refs', '--workspace', 'recipe-ref-postcondition', '--diff', 'before..after', '--expect-ref', 'r2=unchanged', '--expect-ref', 'r4=present', '--json'],
        timeout_ms: 10000,
        mutates: false,
        assertions: [
          { path: ['status'], equals: 'success' },
          { path: ['diff', 'ref_expectations', '0', 'status'], equals: 'passed' },
          { path: ['diff', 'ref_expectations', '0', 'actual_state'], equals: 'unchanged' },
          { path: ['diff', 'ref_expectations', '1', 'status'], equals: 'passed' },
        ],
      },
    ],
  };
  validateRecipeManifest(recipe);

  const postcondition = recipe.steps[2];
  assert.deepEqual(postcondition.command, { path: ['see'], form_id: 'see-refs' });
  assert.ok(postcondition.argv.includes('--expect-ref'));
  assert.equal(postcondition.argv.filter((item) => item === '--expect-ref').length, 2);
  assert.ok(postcondition.assertions.some((item) => item.path.join('.') === 'diff.ref_expectations.0.status'));
});

test('recipe ref postconditions stay evidence, not Work Record replay authority', async () => {
  const api = await text('docs/api/aos.md');
  const workRecord = await text('shared/schemas/aos-work-record-v0.md');

  assert.match(api, /Recipes may use repeatable\s+`aos see refs --diff <from>\.\.<to> --expect-ref <ref>=\.\.\.`/);
  assert.match(api, /recipe assertions can inspect\s+`diff\.ref_expectation` or `diff\.ref_expectations\[\]`/);
  assert.match(api, /immutable evidence rather than treating the recipe as\s+replay or repair authority/);

  assert.match(workRecord, /source-backed recipe uses repeatable\s+`aos see refs --diff <from>\.\.<to> --expect-ref <ref>=\.\.\.`/);
  assert.match(workRecord, /reference the expected `diff\.ref_expectation` or `diff\.ref_expectations\[\]`\s+fields/);
  assert.match(workRecord, /must not\s+treat the recipe step as a\s+portable replay instruction/);
});
