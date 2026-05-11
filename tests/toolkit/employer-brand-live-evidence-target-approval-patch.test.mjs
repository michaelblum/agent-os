import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fsSync from 'node:fs';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  loadEmployerBrandLiveEvidenceTargetPlan,
  validateEmployerBrandLiveEvidenceTargetPlan,
} from '../../packages/toolkit/workbench/employer-brand-live-evidence-target-plan.js';
import {
  loadEmployerBrandLiveEvidenceTargetReviewPack,
} from '../../packages/toolkit/workbench/employer-brand-live-evidence-target-review-pack.js';
import {
  applyEmployerBrandLiveEvidenceTargetApprovalPatch,
  loadEmployerBrandLiveEvidenceTargetApprovalPatch,
  validateEmployerBrandLiveEvidenceTargetApprovalPatch,
} from '../../packages/toolkit/workbench/employer-brand-live-evidence-target-approval-patch.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../..');
const fixtureRoot = path.join(
  repoRoot,
  'docs/design/fixtures/aos-artifacts/employer-brand-comparative-audit',
);
const patchSchemaPath = path.join(
  repoRoot,
  'shared/schemas/employer-brand-live-evidence-target-approval-patch-v0.schema.json',
);
const planSchemaPath = path.join(repoRoot, 'shared/schemas/employer-brand-live-evidence-target-plan-v0.schema.json');
const patchPath = path.join(fixtureRoot, 'live-evidence-target-approval-patch.json');
const reviewedPlanPath = path.join(fixtureRoot, 'live-evidence-reviewed-target-plan.json');

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

async function readJson(file) {
  return JSON.parse(await fs.readFile(file, 'utf8'));
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

test('Employer Brand Live Evidence Target Approval Patch fixture validates and is generator-stable', async () => {
  const patchSchemaValidation = validateSchema(patchSchemaPath, patchPath);
  assert.equal(patchSchemaValidation.status, 0, `${patchSchemaValidation.stdout}${patchSchemaValidation.stderr}`);
  const reviewedPlanSchemaValidation = validateSchema(planSchemaPath, reviewedPlanPath);
  assert.equal(reviewedPlanSchemaValidation.status, 0, `${reviewedPlanSchemaValidation.stdout}${reviewedPlanSchemaValidation.stderr}`);

  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'aos-employer-brand-live-target-approval-patch-'));
  const patchOut = path.join(tmp, 'live-evidence-target-approval-patch.json');
  const reviewedOut = path.join(tmp, 'live-evidence-reviewed-target-plan.json');
  try {
    const result = spawnSync(
      process.execPath,
      [
        'scripts/employer-brand-live-evidence-target-approval-patch.mjs',
        '--patch-out',
        patchOut,
        '--reviewed-out',
        reviewedOut,
      ],
      { cwd: repoRoot, encoding: 'utf8' },
    );
    assert.equal(result.status, 0, `${result.stdout}${result.stderr}`);
    assert.equal(await fs.readFile(patchOut, 'utf8'), await fs.readFile(patchPath, 'utf8'));
    assert.equal(await fs.readFile(reviewedOut, 'utf8'), await fs.readFile(reviewedPlanPath, 'utf8'));
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
});

test('Employer Brand Live Evidence Target Approval Patch applies decisions without mutating the original target plan', async () => {
  const plan = loadEmployerBrandLiveEvidenceTargetPlan({ fixtureRoot });
  const reviewPack = loadEmployerBrandLiveEvidenceTargetReviewPack({ fixtureRoot });
  const patch = loadEmployerBrandLiveEvidenceTargetApprovalPatch({ fixtureRoot });
  const originalPlan = clone(plan);
  const reviewedFixture = await readJson(reviewedPlanPath);
  const reviewedPlan = applyEmployerBrandLiveEvidenceTargetApprovalPatch(plan, patch, {
    reviewPackInput: reviewPack,
    derivedAt: '2026-05-08T00:00:00Z',
  });

  assert.deepEqual(validateEmployerBrandLiveEvidenceTargetApprovalPatch(patch), { valid: true, errors: [] });
  assert.deepEqual(validateEmployerBrandLiveEvidenceTargetPlan(reviewedPlan), { valid: true, errors: [] });
  assert.deepEqual(plan, originalPlan);
  assert.deepEqual(reviewedPlan, reviewedFixture);
});

test('Employer Brand Live Evidence Target Approval Patch records decision counts and excludes rejected targets from readiness totals', () => {
  const patch = loadEmployerBrandLiveEvidenceTargetApprovalPatch({ fixtureRoot });
  const reviewedPlan = JSON.parse(fsSync.readFileSync(reviewedPlanPath, 'utf8'));
  const summary = reviewedPlan.review_decision_summary;

  assert.equal(summary.total_targets, 21);
  assert.equal(summary.approved_count, 16);
  assert.equal(summary.rejected_count, 3);
  assert.equal(summary.draft_count, 2);
  assert.equal(summary.edited_count, 3);
  assert.equal(summary.unchanged_count, 18);
  assert.equal(summary.expected_clip_count_after_rejected_targets_excluded, 19);
  assert.equal(summary.reviewer.reviewer_id, 'reviewer:gdi-fixture');
  assert.equal(reviewedPlan.expected_totals.target_count, 18);
  assert.equal(reviewedPlan.expected_totals.expected_clip_count, 19);
  assert.equal(reviewedPlan.targets.some((target) => target.source_category === 'review_platforms'), false);
  assert.equal(reviewedPlan.provenance.rejected_targets_excluded_from_readiness, true);
  assert.equal(patch.decisions.filter((decision) => decision.decision === 'reject').length, 3);
});

test('Employer Brand Live Evidence Target Approval Patch applies editable fields and preserves KILOS, null locators, and false non-goal controls', () => {
  const patch = loadEmployerBrandLiveEvidenceTargetApprovalPatch({ fixtureRoot });
  const reviewedPlan = JSON.parse(fsSync.readFileSync(reviewedPlanPath, 'utf8'));
  const symphonyCareers = reviewedPlan.targets.find((target) => target.target_id === 'live-target:symphony-talent:careers-site');
  const phenomLinkedIn = reviewedPlan.targets.find((target) => target.target_id === 'live-target:phenom:linkedin-presence');

  assert.match(symphonyCareers.target_element, /careers homepage hero or EVP proof block/);
  assert.match(symphonyCareers.evidence_goal, /Symphony Talent career-site positioning/);
  assert.deepEqual(symphonyCareers.kilos_relevance, ['impact', 'opportunity']);
  assert.equal(symphonyCareers.expected_clip_count, 2);
  assert.equal(symphonyCareers.acceptance_criteria.length, 3);
  assert.equal(symphonyCareers.review_status, 'approved');
  assert.deepEqual(phenomLinkedIn.kilos_relevance, ['status', 'impact', 'opportunity']);

  assert.deepEqual(
    [...new Set(reviewedPlan.targets.map((target) => target.review_status))].sort(),
    ['approved', 'draft'],
  );
  assert.ok(reviewedPlan.targets.every((target) => Object.values(target.locator_placeholders).every((value) => value === null)));
  assert.deepEqual(reviewedPlan.controls, {
    full_page_grabs: false,
    autonomous_browsing_authorized: false,
    live_collection_authorized: false,
    report_renderer_authorized: false,
    export_execution_authorized: false,
    workflow_engine_authorized: false,
  });
  assert.ok(Object.values(patch.controls).every((value) => value === false));
});

test('Employer Brand Live Evidence Target Approval Patch validation rejects invalid decisions and non-goal authorization', () => {
  const patch = clone(loadEmployerBrandLiveEvidenceTargetApprovalPatch({ fixtureRoot }));

  const invalidDecision = clone(patch);
  invalidDecision.decisions[0].decision = 'capture_now';
  assert.equal(validateEmployerBrandLiveEvidenceTargetApprovalPatch(invalidDecision).valid, false);

  const invalidKilos = clone(patch);
  invalidKilos.decisions[0].edits.kilos_relevance = ['speed'];
  assert.equal(validateEmployerBrandLiveEvidenceTargetApprovalPatch(invalidKilos).valid, false);

  const invalidControl = clone(patch);
  invalidControl.controls.screenshot_capture = true;
  assert.equal(validateEmployerBrandLiveEvidenceTargetApprovalPatch(invalidControl).valid, false);
});
