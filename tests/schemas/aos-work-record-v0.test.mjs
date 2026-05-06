import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../..');
const schemaPath = path.join(repoRoot, 'shared/schemas/aos-work-record-v0.schema.json');
const fixtureRoot = path.join(repoRoot, 'shared/schemas/fixtures/aos-work-record-v0');

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

function assertKnownIds(record, fixture) {
  const claimIds = new Set(record.claims.map((claim) => claim.id));
  const postconditionIds = new Set(
    record.execution_map.postconditions.map((postcondition) => postcondition.id),
  );
  const evidenceIds = new Set(record.evidence.map((evidence) => evidence.id));
  const claimResultClaimIds = new Set(record.claim_results.map((result) => result.claim_id));

  for (const claimRef of record.intent.claim_refs || []) {
    assert.ok(claimIds.has(claimRef), `${fixture}: intent claim_ref ${claimRef} must resolve`);
  }

  for (const claim of record.claims) {
    for (const postconditionRef of claim.postcondition_refs) {
      assert.ok(
        postconditionIds.has(postconditionRef),
        `${fixture}: claim ${claim.id} references unknown postcondition ${postconditionRef}`,
      );
    }
  }

  for (const postcondition of record.execution_map.postconditions) {
    for (const evidenceRef of postcondition.evidence_refs || []) {
      assert.ok(
        evidenceIds.has(evidenceRef),
        `${fixture}: postcondition ${postcondition.id} references unknown evidence ${evidenceRef}`,
      );
    }
  }

  assert.equal(
    claimResultClaimIds.size,
    claimIds.size,
    `${fixture}: expected one claim_result per claim`,
  );
  for (const claimId of claimIds) {
    assert.ok(claimResultClaimIds.has(claimId), `${fixture}: missing claim_result for ${claimId}`);
  }

  for (const result of record.claim_results) {
    assert.ok(claimIds.has(result.claim_id), `${fixture}: result ${result.id} has unknown claim_id`);
    for (const evidenceRef of result.evidence_refs) {
      assert.ok(
        evidenceIds.has(evidenceRef),
        `${fixture}: result ${result.id} references unknown evidence ${evidenceRef}`,
      );
    }
    for (const postconditionResult of result.postcondition_results) {
      assert.ok(
        postconditionIds.has(postconditionResult.postcondition_id),
        `${fixture}: result ${result.id} references unknown postcondition ${postconditionResult.postcondition_id}`,
      );
      for (const evidenceRef of postconditionResult.evidence_refs) {
        assert.ok(
          evidenceIds.has(evidenceRef),
          `${fixture}: postcondition result for ${result.id} references unknown evidence ${evidenceRef}`,
        );
      }
    }
  }

  for (const evidenceRef of record.verifier_report.evidence_refs) {
    assert.ok(
      evidenceIds.has(evidenceRef),
      `${fixture}: verifier_report references unknown evidence ${evidenceRef}`,
    );
  }

  assert.equal(
    record.health.verifier_report_id,
    record.verifier_report.id,
    `${fixture}: health must point at the embedded verifier_report`,
  );
}

function assertDerivedIndexes(record, fixture) {
  const expected = {
    verified: [],
    failed: [],
    unverified: [],
  };
  for (const result of record.claim_results) {
    expected[result.status].push(result.claim_id);
  }

  for (const status of Object.keys(expected)) {
    assert.deepEqual(
      [...record.verifier_report.derived_indexes[status]].sort(),
      expected[status].sort(),
      `${fixture}: derived ${status} index must match claim_results[]`,
    );
  }
}

test('valid Work Record v0 fixtures match the schema and resolve internal ids', async () => {
  const fixtures = await jsonFiles(path.join(fixtureRoot, 'valid'));
  assert.ok(fixtures.length >= 2, 'expected valid Work Record fixtures');

  for (const fixture of fixtures) {
    const result = validate(fixture);
    assert.equal(
      result.status,
      0,
      `${path.relative(repoRoot, fixture)} should validate\n${result.stdout}${result.stderr}`,
    );

    const record = await loadJson(fixture);
    const relative = path.relative(repoRoot, fixture);
    assertKnownIds(record, relative);
    assertDerivedIndexes(record, relative);
  }
});

test('invalid Work Record v0 fixtures are rejected by the schema', async () => {
  const fixtures = await jsonFiles(path.join(fixtureRoot, 'invalid'));
  assert.ok(fixtures.length >= 1, 'expected invalid Work Record fixtures');

  for (const fixture of fixtures) {
    const result = validate(fixture);
    assert.notEqual(result.status, 0, `${path.relative(repoRoot, fixture)} should fail validation`);
  }
});
