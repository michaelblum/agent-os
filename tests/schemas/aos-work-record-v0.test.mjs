import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../..');
const schemaPath = path.join(repoRoot, 'shared/schemas/aos-work-record-v0.schema.json');
const contractPath = path.join(repoRoot, 'shared/schemas/aos-work-record-v0.md');
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

test('report-only verifier failure fixtures are schema-valid Work Records', async () => {
  const fixtures = await jsonFiles(path.join(fixtureRoot, 'report-only-failures'));
  assert.ok(fixtures.length >= 1, 'expected report-only failure Work Record fixtures');

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

test('Work Record contract keeps saved refs, evidence, proof, and replay boundaries distinct', async () => {
  const contract = await fs.readFile(contractPath, 'utf8');
  const normalizedContract = contract.replace(/\s+/g, ' ').toLowerCase();

  for (const phrase of [
    'Saved Refs, Evidence, And Post-Action Proof',
    'Saved Ref is evidence provenance, not Work Record object identity.',
    'preserve both the Saved Ref and resolved underlying target metadata',
    'Post-action proof is the after-perception evidence',
    'post-action Postcondition',
    'claim_results[]',
    'do not invent a raw JSON diff protocol',
    'aos see refs --diff <from>..<to> --expect-ref <ref>=...',
    'diff.ref_expectation',
    'diff.ref_expectations[]',
    'must not treat the recipe step as a portable replay instruction',
    'repair the execution map under an explicit workflow/repair gate',
    'do not mutate `evidence[]`',
    'do not replay, repair, or macro-play back from a Work Record',
    'The v0 verifier and harness remain report-only.',
  ]) {
    assert.ok(
      normalizedContract.includes(phrase.toLowerCase()),
      `contract should include: ${phrase}`,
    );
  }

  const record = await loadJson(
    path.join(fixtureRoot, 'valid/aos-browser-click-status.json'),
  );
  const afterEvidence = record.evidence.find(
    (evidence) => evidence.id === 'evidence:aos-browser-click-status-after-see',
  );
  assert.ok(afterEvidence, 'fixture must include after-perception evidence');
  assert.equal(afterEvidence.metadata.phase, 'after');

  const postcondition = record.execution_map.postconditions.find(
    (item) => item.id === 'postcondition:aos-browser-click-status-after-status',
  );
  assert.ok(postcondition, 'fixture must include a post-action Postcondition');
  assert.deepEqual(postcondition.evidence_refs, [afterEvidence.id]);

  const claimResult = record.claim_results.find(
    (result) => result.claim_id === 'claim:aos-browser-click-status-2026-05-06-post-action-state-observed',
  );
  assert.ok(claimResult, 'fixture must include a Claim Result for the post-action Claim');
  assert.equal(claimResult.status, 'verified');
  assert.deepEqual(claimResult.evidence_refs, [afterEvidence.id]);
  assert.deepEqual(claimResult.postcondition_results, [
    {
      postcondition_id: postcondition.id,
      status: 'passed',
      evidence_refs: [afterEvidence.id],
      reason: 'The after perception semantic target e3 has value Action recorded.',
    },
  ]);

  assert.equal(record.execution_map.replay_policy.mode, 'report_only');
  assert.equal(record.execution_map.replay_policy.replay_requires_workflow_gate, true);
  assert.equal(record.execution_map.replay_policy.repair_requires_workflow_gate, true);
  assert.match(record.execution_map.replay_policy.notes, /does not authorize autonomous replay or repair/);
});
