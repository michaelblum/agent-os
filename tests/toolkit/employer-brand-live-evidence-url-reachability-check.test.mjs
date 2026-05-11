import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fsSync from 'node:fs';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  buildEmployerBrandLiveEvidenceUrlReachabilityCheck,
  loadEmployerBrandLiveEvidenceUrlReachabilityCheck,
  validateEmployerBrandLiveEvidenceUrlReachabilityCheck,
} from '../../packages/toolkit/workbench/employer-brand-live-evidence-url-reachability-check.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../..');
const fixtureRoot = path.join(
  repoRoot,
  'docs/design/fixtures/aos-artifacts/employer-brand-comparative-audit',
);
const schemaPath = path.join(repoRoot, 'shared/schemas/employer-brand-live-evidence-url-reachability-check-v0.schema.json');
const checkPath = path.join(fixtureRoot, 'live-evidence-url-reachability-check.json');

function readJson(file) {
  return JSON.parse(fsSync.readFileSync(file, 'utf8'));
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function validateSchema(schema, instance) {
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
    for error in errors[:12]:
        print(error.message)
    sys.exit(1)
`,
      schema,
      instance,
    ],
    { encoding: 'utf8' },
  );
}

test('Employer Brand Live Evidence URL Reachability Check executed fixture validates and is generator-stable', async () => {
  const schemaValidation = validateSchema(schemaPath, checkPath);
  assert.equal(schemaValidation.status, 0, `${schemaValidation.stdout}${schemaValidation.stderr}`);

  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'aos-employer-brand-url-reachability-check-'));
  const out = path.join(tmp, 'live-evidence-url-reachability-check.json');
  try {
    const result = spawnSync(
      process.execPath,
      ['scripts/employer-brand-live-evidence-url-reachability-check.mjs', '--out', out],
      { cwd: repoRoot, encoding: 'utf8' },
    );
    assert.equal(result.status, 0, `${result.stdout}${result.stderr}`);
    assert.equal(await fs.readFile(out, 'utf8'), await fs.readFile(checkPath, 'utf8'));
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
});

test('Employer Brand Live Evidence URL Reachability Check filters executable targets and excludes rejected targets', () => {
  const supervisedPlan = readJson(path.join(fixtureRoot, 'live-evidence-supervised-locator-plan.json'));
  const approvalPatch = readJson(path.join(fixtureRoot, 'live-evidence-target-approval-patch.json'));
  const check = loadEmployerBrandLiveEvidenceUrlReachabilityCheck({ fixtureRoot });
  const expectedExecutableIds = supervisedPlan.work_units
    .filter((unit) => unit.executable)
    .map((unit) => unit.target_id);
  const rejectedIds = approvalPatch.decisions
    .filter((decision) => decision.decision === 'reject')
    .map((decision) => decision.target_id);

  assert.deepEqual(validateEmployerBrandLiveEvidenceUrlReachabilityCheck(check), { valid: true, errors: [] });
  assert.deepEqual(
    check.results.filter((result) => result.executable).map((result) => result.target_id),
    expectedExecutableIds,
  );
  assert.equal(check.results.some((result) => rejectedIds.includes(result.target_id)), false);
  assert.equal(check.summary.executable_target_count, 16);
  assert.equal(check.summary.supervised_locator_work_unit_count, 18);
  assert.equal(check.status, 'checked_with_blockers');
  assert.equal(check.controls.url_opening_performed, true);
  assert.equal(check.provenance.url_open_run_is_input_source, true);
});

test('Employer Brand Live Evidence URL Reachability Check preserves blocked drafts as non-executed safety-gated entries', () => {
  const check = loadEmployerBrandLiveEvidenceUrlReachabilityCheck({ fixtureRoot });
  const blocked = check.results.filter((result) => !result.executable);

  assert.equal(blocked.length, 2);
  assert.ok(blocked.every((result) => result.executed === false));
  assert.ok(blocked.every((result) => result.non_executed === true));
  assert.ok(blocked.every((result) => result.status === 'safety_gate_blocked'));
  assert.ok(blocked.every((result) => result.blocker_reason.includes('non_executable_target_not_opened')));
  assert.equal(check.summary.non_executed_blocked_target_count, 2);
  assert.equal(check.summary.blocked_count, 2);
  assert.equal(check.summary.safety_gate_blocked_count, 2);
});

test('Employer Brand Live Evidence URL Reachability Check still supports dry-run same-domain gates without opening URLs', () => {
  const supervisedPlan = readJson(path.join(fixtureRoot, 'live-evidence-supervised-locator-plan.json'));
  const check = buildEmployerBrandLiveEvidenceUrlReachabilityCheck({
    supervisedLocatorPlan: supervisedPlan,
    createdAt: '2026-05-08T00:00:00Z',
  });
  const symphony = check.results.find((result) => result.target_id === 'live-target:symphony-talent:careers-site');

  assert.equal(symphony.url, 'https://www.symphonytalent.com/');
  assert.equal(symphony.status, 'not_checked');
  assert.equal(symphony.executed, false);
  assert.equal(symphony.same_domain_gate.same_domain_required, true);
  assert.equal(symphony.same_domain_gate.requested_origin, 'https://www.symphonytalent.com');
  assert.equal(symphony.same_domain_gate.expected_origin, 'https://www.symphonytalent.com');
  assert.equal(symphony.same_domain_gate.same_domain, null);
  assert.ok(symphony.safety_gates.includes('same_domain_constraint'));
  assert.equal(check.summary.same_domain_confirmed_count, 0);
  assert.equal(check.summary.same_domain_unknown_count, 18);
  assert.equal(check.controls.url_opening_performed, false);
  assert.equal(check.provenance.dry_run_not_checked_fixture, true);
});

test('Employer Brand Live Evidence URL Reachability Check reconciles executed URL-open counts and metadata', () => {
  const check = loadEmployerBrandLiveEvidenceUrlReachabilityCheck({ fixtureRoot });

  assert.equal(check.summary.checked_count, 16);
  assert.equal(check.summary.reachable_count, 5);
  assert.equal(check.summary.redirected_count, 2);
  assert.equal(check.summary.network_error_count, 9);
  assert.equal(check.summary.not_checked_count, 0);
  assert.equal(check.summary.same_domain_confirmed_count, 16);
  assert.ok(check.results.filter((result) => result.executable).every((result) => result.checked_at !== null));
  assert.ok(check.results.filter((result) => result.executable).every((result) => result.final_url !== null));
  assert.ok(check.results.filter((result) => result.executable).every((result) => result.http.headers_observed === true));
});

test('Employer Brand Live Evidence URL Reachability Check keeps non-goal controls closed', () => {
  const check = loadEmployerBrandLiveEvidenceUrlReachabilityCheck({ fixtureRoot });

  assert.equal(check.controls.dry_run_only, false);
  assert.equal(check.controls.human_approval_required, true);
  for (const [key, value] of Object.entries(check.controls)) {
    if (key === 'url_opening_performed') assert.equal(value, true, key);
    else if (!['dry_run_only', 'human_approval_required'].includes(key)) assert.equal(value, false, key);
  }
  for (const nonGoal of ['locator_resolution', 'locator_codegen_execution', 'screenshots', 'clip_generation', 'workflow_automation', 'full_page_grabs', 'element_identification']) {
    assert.ok(check.provenance.non_goals.includes(nonGoal), `missing non-goal: ${nonGoal}`);
  }
});

test('Employer Brand Live Evidence URL Reachability Check supports arbitrary n-company count reconciliation', () => {
  const supervisedPlan = readJson(path.join(fixtureRoot, 'live-evidence-supervised-locator-plan.json'));
  const withoutRadancy = supervisedPlan.work_units.filter((unit) => unit.company !== 'Radancy');
  const check = buildEmployerBrandLiveEvidenceUrlReachabilityCheck({
    supervisedLocatorPlan: {
      ...clone(supervisedPlan),
      work_units: withoutRadancy,
      summary: {
        ...supervisedPlan.summary,
        readiness_input_count: 12,
        executable_locator_unit_count: 10,
        blocked_non_executable_count: 2,
        expected_clip_count_for_executable_units: 11,
      },
    },
    createdAt: '2026-05-08T00:00:00Z',
  });

  assert.equal(check.results.length, 12);
  assert.equal(check.summary.executable_target_count, 10);
  assert.equal(check.summary.non_executed_blocked_target_count, 2);
  assert.equal(check.summary.checked_count, 0);
  assert.equal(check.summary.reachable_count, 0);
  assert.equal(check.summary.blocked_count, 2);
});
