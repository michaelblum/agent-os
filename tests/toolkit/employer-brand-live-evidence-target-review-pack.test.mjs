import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  buildDraftEmployerBrandLiveEvidenceTargetPlanFromProject,
} from '../../packages/toolkit/workbench/_reference/employer-brand/employer-brand-live-evidence-target-plan.js';
import {
  buildEmployerBrandLiveEvidenceTargetReviewPackFromPlan,
  loadEmployerBrandLiveEvidenceTargetReviewPack,
  normalizeEmployerBrandLiveEvidenceTargetReviewPack,
  validateEmployerBrandLiveEvidenceTargetReviewPack,
} from '../../packages/toolkit/workbench/_reference/employer-brand/employer-brand-live-evidence-target-review-pack.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../..');
const fixtureRoot = path.join(
  repoRoot,
  'docs/design/fixtures/aos-artifacts/employer-brand-comparative-audit',
);
const schemaPath = path.join(
  repoRoot,
  'shared/schemas/employer-brand-live-evidence-target-review-pack-v0.schema.json',
);
const reviewPackPath = path.join(fixtureRoot, 'live-evidence-target-review-pack.json');
const projectPath = path.join(fixtureRoot, 'intake/project.json');

async function readJson(file) {
  return JSON.parse(await fs.readFile(file, 'utf8'));
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

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function addFourthCompany(project) {
  const next = clone(project);
  next.intake.competitor_companies.push({
    name: 'Acme Talent',
    role: 'competitor',
    website_url: 'https://example.com/acme-talent',
    notes: 'Synthetic fourth company for arbitrary-n live evidence review pack coverage.',
  });
  return next;
}

test('Employer Brand Live Evidence Target Review Pack fixture validates and is generator-stable', async () => {
  const schemaValidation = validateSchema(schemaPath, reviewPackPath);
  assert.equal(schemaValidation.status, 0, `${schemaValidation.stdout}${schemaValidation.stderr}`);

  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'aos-employer-brand-live-target-review-pack-'));
  const out = path.join(tmp, 'live-evidence-target-review-pack.json');
  try {
    const result = spawnSync(
      process.execPath,
      ['scripts/employer-brand-live-evidence-target-review-pack.mjs', '--out', out],
      { cwd: repoRoot, encoding: 'utf8' },
    );
    assert.equal(result.status, 0, `${result.stdout}${result.stderr}`);
    assert.equal(await fs.readFile(out, 'utf8'), await fs.readFile(reviewPackPath, 'utf8'));
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
});

test('Employer Brand Live Evidence Target Review Pack groups review items by company and source category', () => {
  const pack = loadEmployerBrandLiveEvidenceTargetReviewPack({ fixtureRoot });
  const normalized = normalizeEmployerBrandLiveEvidenceTargetReviewPack(pack);

  assert.deepEqual(validateEmployerBrandLiveEvidenceTargetReviewPack(pack), { valid: true, errors: [] });
  assert.equal(normalized.summary.company_count, 3);
  assert.equal(normalized.summary.source_category_count, 7);
  assert.equal(normalized.summary.page_count, 21);
  assert.equal(normalized.summary.target_count, 21);
  assert.equal(normalized.summary.expected_clip_count, 21);
  assert.equal(normalized.summary.locator_ready_count, 0);
  assert.equal(normalized.summary.review_status_counts.human_review_required, 21);
  assert.equal(normalized.summary.approval_decision_counts.null, 21);
  assert.deepEqual(normalized.groups.map((group) => group.company), [
    'Symphony Talent',
    'Phenom',
    'Radancy',
  ]);

  for (const companyGroup of normalized.groups) {
    assert.equal(companyGroup.target_count, 7);
    assert.equal(companyGroup.expected_clip_count, 7);
    assert.equal(companyGroup.locator_ready_count, 0);
    assert.deepEqual(companyGroup.source_categories.map((group) => group.source_category), [
      'careers_site',
      'employer_brand_pages',
      'linkedin_presence',
      'review_platforms',
      'social_campaigns',
      'awards_recognition',
      'employee_stories',
    ]);
    assert.ok(companyGroup.source_categories.every((group) => group.review_items.length === 1));
  }
});

test('Employer Brand Live Evidence Target Review Pack carries required review fields without implying review happened', () => {
  const pack = loadEmployerBrandLiveEvidenceTargetReviewPack({ fixtureRoot });
  const normalized = normalizeEmployerBrandLiveEvidenceTargetReviewPack(pack);

  for (const item of normalized.review_items) {
    for (const field of [
      'target_id',
      'company',
      'company_role',
      'source_category',
      'page_name',
      'url',
      'desired_element',
      'evidence_goal',
      'kilos_relevance',
      'capture_type',
      'expected_clip_count',
      'acceptance_criteria',
      'review_status',
      'approval_status',
      'locator_readiness_summary',
      'notes',
      'non_goal_flags',
      'reviewer_notes',
      'suggested_target_edits',
      'approval_decision',
      'decision_timestamp',
    ]) {
      assert.notEqual(item[field], undefined, `${item.target_id} missing ${field}`);
    }
    assert.equal(item.review_status, 'human_review_required');
    assert.equal(item.approval_status, 'not_reviewed');
    assert.equal(item.reviewer_notes, null);
    assert.equal(item.suggested_target_edits, null);
    assert.equal(item.approval_decision, null);
    assert.equal(item.decision_timestamp, null);
    assert.ok(item.kilos_relevance.every((dimension) => ['kinship', 'impact', 'lifestyle', 'opportunity', 'status'].includes(dimension)));
    assert.equal(item.locator_readiness.locator_ready, false);
    assert.deepEqual(item.locator_readiness.locator_placeholders, {
      selector: null,
      xpath: null,
      playwright_locator: null,
      codegen_hint: null,
      crawl_discovery_notes: null,
      capture_script_slot: null,
    });
    assert.ok(Object.values(item.non_goal_flags).every((value) => value === false));
  }

  assert.equal(pack.provenance.human_review_affordances_empty, true);
  assert.equal(pack.provenance.live_evidence_collected, false);
  assert.equal(pack.provenance.url_reachability_checked, false);
  assert.equal(pack.provenance.locator_codegen_executed, false);
  assert.equal(pack.provenance.screenshots_captured, false);
  assert.equal(pack.provenance.clips_generated, false);
});

test('Employer Brand Live Evidence Target Review Pack supports arbitrary n companies', async () => {
  const project = addFourthCompany(await readJson(projectPath));
  const plan = buildDraftEmployerBrandLiveEvidenceTargetPlanFromProject(project, {
    createdAt: '2026-05-08T00:00:00Z',
  });
  const pack = buildEmployerBrandLiveEvidenceTargetReviewPackFromPlan(plan, {
    createdAt: '2026-05-08T00:00:00Z',
  });
  const normalized = normalizeEmployerBrandLiveEvidenceTargetReviewPack(pack);

  assert.deepEqual(validateEmployerBrandLiveEvidenceTargetReviewPack(pack), { valid: true, errors: [] });
  assert.equal(normalized.summary.company_count, 4);
  assert.equal(normalized.summary.source_category_count, 7);
  assert.equal(normalized.summary.target_count, 28);
  assert.equal(normalized.summary.expected_clip_count, 28);
  assert.equal(normalized.summary.locator_ready_count, 0);
  assert.equal(normalized.groups.find((group) => group.company === 'Acme Talent').target_count, 7);
});

test('Employer Brand Live Evidence Target Review Pack normalizer handles review status counts and validation guards', () => {
  const pack = clone(loadEmployerBrandLiveEvidenceTargetReviewPack({ fixtureRoot }));
  const first = pack.groups[0].source_categories[0].review_items[0];
  const second = pack.groups[0].source_categories[1].review_items[0];
  first.review_status = 'approved';
  first.approval_status = 'reviewed';
  first.reviewer_notes = 'Looks right for later locator work.';
  first.approval_decision = 'approved';
  first.decision_timestamp = '2026-05-08T12:00:00Z';
  second.review_status = 'rejected';

  const normalized = normalizeEmployerBrandLiveEvidenceTargetReviewPack(pack);
  assert.equal(normalized.summary.review_status_counts.approved, 1);
  assert.equal(normalized.summary.review_status_counts.rejected, 1);
  assert.equal(normalized.summary.review_status_counts.human_review_required, 19);
  assert.equal(normalized.summary.approval_decision_counts.approved, 1);
  assert.equal(normalized.summary.approval_decision_counts.null, 20);
  assert.deepEqual(validateEmployerBrandLiveEvidenceTargetReviewPack(pack), { valid: true, errors: [] });

  const invalidLocator = clone(pack);
  invalidLocator.groups[0].source_categories[0].review_items[0].locator_readiness.locator_placeholders.selector = '.hero';
  assert.equal(validateEmployerBrandLiveEvidenceTargetReviewPack(invalidLocator).valid, false);

  const invalidNonGoal = clone(pack);
  invalidNonGoal.groups[0].source_categories[0].review_items[0].non_goal_flags.screenshot_capture = true;
  assert.equal(validateEmployerBrandLiveEvidenceTargetReviewPack(invalidNonGoal).valid, false);
});
