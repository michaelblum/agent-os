import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../..');
const schemaPath = path.join(repoRoot, 'shared/schemas/aos-playbook-step-v0.schema.json');
const fixtureRoot = path.join(repoRoot, 'shared/schemas/fixtures/aos-playbook-step-v0');

async function jsonFiles(dir) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
    .map((entry) => path.join(dir, entry.name))
    .sort();
}

async function loadJson(file) {
  return JSON.parse(await fs.readFile(file, 'utf8'));
}

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

function assertInternalRefs(step, fixture) {
  const preconditionIds = new Set(step.preconditions.map((condition) => condition.id));
  const postconditionIds = new Set(step.postconditions.map((condition) => condition.id));
  const gateRefs = new Set(step.workflow_gates.gate_refs || []);

  assert.equal(
    step.target_resolution.dialect,
    step.target_dialect,
    `${fixture}: target_resolution dialect must match the step target_dialect`,
  );
  assert.equal(
    step.action.target,
    step.target_resolution.target_with_ref,
    `${fixture}: action target must be the resolved Target-with-Ref`,
  );
  assert.equal(
    step.workflow_gates.replay_requires_workflow_gate,
    true,
    `${fixture}: replay must stay workflow-gated`,
  );
  assert.equal(
    step.workflow_gates.repair_requires_workflow_gate,
    true,
    `${fixture}: repair must stay workflow-gated`,
  );

  for (const hint of step.repair_hints) {
    if (hint.gate_ref) {
      assert.ok(gateRefs.has(hint.gate_ref), `${fixture}: repair hint gate_ref must resolve`);
    }
  }

  assert.ok(preconditionIds.size > 0, `${fixture}: expected at least one precondition`);
  for (const promotion of step.claim_promotions) {
    assert.ok(
      postconditionIds.has(promotion.postcondition_ref),
      `${fixture}: claim promotion ${promotion.id} references unknown postcondition ${promotion.postcondition_ref}`,
    );
    assert.equal(promotion.scope, 'run', `${fixture}: v0 promoted claims are run-scoped`);
  }
}

test('valid Playbook step v0 fixtures match the schema and resolve internal ids', async () => {
  const fixtures = await jsonFiles(path.join(fixtureRoot, 'valid'));
  assert.ok(fixtures.length >= 1, 'expected valid Playbook step fixtures');

  for (const fixture of fixtures) {
    const result = validate(fixture);
    assert.equal(
      result.status,
      0,
      `${path.relative(repoRoot, fixture)} should validate\n${result.stdout}${result.stderr}`,
    );

    const step = await loadJson(fixture);
    assertInternalRefs(step, path.relative(repoRoot, fixture));
  }
});

test('invalid Playbook step v0 fixtures are rejected by the schema', async () => {
  const fixtures = await jsonFiles(path.join(fixtureRoot, 'invalid'));
  assert.ok(fixtures.length >= 1, 'expected invalid Playbook step fixtures');

  for (const fixture of fixtures) {
    const result = validate(fixture);
    assert.notEqual(result.status, 0, `${path.relative(repoRoot, fixture)} should fail validation`);
  }
});
