import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fsSync from 'node:fs';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  buildEmployerBrandLiveEvidenceSupervisedLocatorPlan,
  loadEmployerBrandLiveEvidenceSupervisedLocatorPlan,
  validateEmployerBrandLiveEvidenceSupervisedLocatorPlan,
} from '../../packages/toolkit/workbench/employer-brand-live-evidence-supervised-locator-plan.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../..');
const fixtureRoot = path.join(
  repoRoot,
  'docs/design/fixtures/aos-artifacts/employer-brand-comparative-audit',
);
const schemaPath = path.join(repoRoot, 'shared/schemas/employer-brand-live-evidence-supervised-locator-plan-v0.schema.json');
const planPath = path.join(fixtureRoot, 'live-evidence-supervised-locator-plan.json');

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

test('Employer Brand Live Evidence Supervised Locator Plan fixture validates and is generator-stable', async () => {
  const schemaValidation = validateSchema(schemaPath, planPath);
  assert.equal(schemaValidation.status, 0, `${schemaValidation.stdout}${schemaValidation.stderr}`);

  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'aos-employer-brand-live-evidence-supervised-locator-plan-'));
  const out = path.join(tmp, 'live-evidence-supervised-locator-plan.json');
  try {
    const result = spawnSync(
      process.execPath,
      ['scripts/employer-brand-live-evidence-supervised-locator-plan.mjs', '--out', out],
      { cwd: repoRoot, encoding: 'utf8' },
    );
    assert.equal(result.status, 0, `${result.stdout}${result.stderr}`);
    assert.equal(await fs.readFile(out, 'utf8'), await fs.readFile(planPath, 'utf8'));
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
});

test('Employer Brand Live Evidence Supervised Locator Plan only makes approved needs_locator targets executable', () => {
  const readiness = readJson(path.join(fixtureRoot, 'live-evidence-locator-readiness.json'));
  const plan = loadEmployerBrandLiveEvidenceSupervisedLocatorPlan({ fixtureRoot });
  const executableTargetIds = plan.work_units.filter((unit) => unit.executable).map((unit) => unit.target_id);
  const expectedExecutableIds = readiness.targets
    .filter((target) => target.approval_decision === 'approve' && target.readiness_state === 'needs_locator')
    .map((target) => target.target_id);

  assert.deepEqual(validateEmployerBrandLiveEvidenceSupervisedLocatorPlan(plan), { valid: true, errors: [] });
  assert.deepEqual(executableTargetIds, expectedExecutableIds);
  assert.equal(plan.summary.readiness_input_count, 18);
  assert.equal(plan.summary.executable_locator_unit_count, 16);
  assert.equal(plan.summary.blocked_non_executable_count, 2);
  assert.equal(plan.summary.needs_human_target_review_count, 2);
  assert.equal(plan.summary.locator_ready_count, 0);
  assert.equal(plan.summary.url_checks_performed, false);
});

test('Employer Brand Live Evidence Supervised Locator Plan keeps draft targets blocked and rejected targets excluded', () => {
  const approvalPatch = readJson(path.join(fixtureRoot, 'live-evidence-target-approval-patch.json'));
  const plan = loadEmployerBrandLiveEvidenceSupervisedLocatorPlan({ fixtureRoot });
  const rejectedIds = approvalPatch.decisions
    .filter((decision) => decision.decision === 'reject')
    .map((decision) => decision.target_id);
  const blocked = plan.work_units.filter((unit) => unit.blocked);

  assert.equal(blocked.length, 2);
  assert.ok(blocked.every((unit) => unit.executable === false));
  assert.ok(blocked.every((unit) => unit.blockers.includes('non_executable_until_human_target_review')));
  assert.equal(plan.work_units.some((unit) => rejectedIds.includes(unit.target_id)), false);
});

test('Employer Brand Live Evidence Supervised Locator Plan carries required fields, gates, stop conditions, and null output slots', () => {
  const plan = loadEmployerBrandLiveEvidenceSupervisedLocatorPlan({ fixtureRoot });
  const unit = plan.work_units.find((item) => item.target_id === 'live-target:symphony-talent:careers-site');
  const requiredGates = [
    'human_approval_required',
    'same_domain_constraint',
    'no_autonomous_crawl',
    'no_full_page_screenshots',
    'no_live_capture',
    'stop_on_login_paywall_captcha_or_consent_blockers',
    'stop_on_unexpected_redirects',
    'stop_when_target_element_cannot_be_identified_without_guessing',
  ];

  assert.equal(unit.company_role, 'client');
  assert.equal(unit.source_category, 'careers_site');
  assert.equal(unit.page_name, 'Symphony Talent Careers or jobs site');
  assert.equal(unit.url, 'https://www.symphonytalent.com/');
  assert.ok(unit.desired_element.includes('employer promise'));
  assert.ok(unit.evidence_goal.includes('KILOS scoring'));
  assert.deepEqual(unit.kilos_relevance, ['impact', 'opportunity']);
  assert.equal(unit.capture_type, 'element_clip_and_text_extract');
  assert.equal(unit.expected_clip_count, 2);
  assert.ok(unit.acceptance_criteria.length > 0);
  assert.ok(requiredGates.every((gate) => unit.safety_gates.includes(gate)));
  assert.ok(unit.stop_conditions.includes('unexpected_redirect'));
  assert.ok(Object.values(unit.current_locator_placeholders).every((value) => value === null));
  assert.deepEqual(Object.keys(unit.allowed_outputs), [
    'selector',
    'xpath',
    'playwright_locator',
    'codegen_trace_path',
    'locator_notes',
    'confidence',
    'reviewer_metadata',
    'operator_metadata',
  ]);
  assert.ok(Object.values(unit.allowed_outputs).every((value) => value === null));
});

test('Employer Brand Live Evidence Supervised Locator Plan supports arbitrary n-company grouping and propagates KILOS and clip counts', () => {
  const readiness = readJson(path.join(fixtureRoot, 'live-evidence-locator-readiness.json'));
  const reviewedPlan = readJson(path.join(fixtureRoot, 'live-evidence-target-plan.reviewed.json'));
  const withoutRadancy = new Set(readiness.targets.filter((target) => target.company === 'Radancy').map((target) => target.target_id));
  const plan = buildEmployerBrandLiveEvidenceSupervisedLocatorPlan({
    locatorReadiness: {
      ...clone(readiness),
      targets: readiness.targets.filter((target) => !withoutRadancy.has(target.target_id)),
      summary: {
        ...readiness.summary,
        source_target_count: 14,
        excluded_rejected_count: 2,
        needs_locator_count: 10,
        needs_human_target_review_count: 2,
        url_not_checked_count: 0,
        expected_clip_count_for_included_targets: 13,
      },
    },
    reviewedTargetPlan: {
      ...clone(reviewedPlan),
      targets: reviewedPlan.targets.filter((target) => !withoutRadancy.has(target.target_id)),
      review_decision_summary: {
        ...reviewedPlan.review_decision_summary,
        total_targets: 14,
        rejected_count: 2,
      },
    },
    createdAt: '2026-05-08T00:00:00Z',
  });

  assert.equal(plan.summary.readiness_input_count, 12);
  assert.equal(plan.summary.executable_locator_unit_count, 10);
  assert.equal(plan.summary.blocked_non_executable_count, 2);
  assert.equal(plan.summary.expected_clip_count_for_executable_units, 11);
  assert.deepEqual(plan.summary.grouped_by_company, {
    'Symphony Talent': 6,
    Phenom: 6,
  });
  assert.deepEqual(plan.summary.executable_grouped_by_company, {
    'Symphony Talent': 5,
    Phenom: 5,
  });
  assert.deepEqual(
    plan.work_units.find((unit) => unit.target_id === 'live-target:symphony-talent:careers-site').kilos_relevance,
    ['impact', 'opportunity'],
  );
});

test('Employer Brand Live Evidence Supervised Locator Plan keeps non-goal controls false', () => {
  const plan = loadEmployerBrandLiveEvidenceSupervisedLocatorPlan({ fixtureRoot });

  assert.equal(plan.controls.human_approval_required, true);
  for (const [key, value] of Object.entries(plan.controls)) {
    if (key !== 'human_approval_required') assert.equal(value, false, key);
  }
  assert.equal(plan.provenance.allowed_outputs_unfilled, true);
  assert.equal(plan.provenance.planning_metadata_only, true);
  assert.ok(plan.provenance.non_goals.includes('url_reachability_checks'));
  assert.ok(plan.provenance.non_goals.includes('full_page_grabs'));
});
