import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  buildEmployerBrandLiveEvidenceHumanLocatorReviewPack,
  loadEmployerBrandLiveEvidenceHumanLocatorReviewPack,
  validateEmployerBrandLiveEvidenceHumanLocatorPatch,
  validateEmployerBrandLiveEvidenceHumanLocatorReviewPack,
} from '../../packages/toolkit/workbench/employer-brand-live-evidence-human-locator-review-pack.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../..');
const fixtureRoot = path.join(repoRoot, 'docs/design/fixtures/aos-artifacts/employer-brand-comparative-audit');
const schemaPath = path.join(repoRoot, 'shared/schemas/employer-brand-live-evidence-human-locator-review-pack-v0.schema.json');
const reviewPackPath = path.join(fixtureRoot, 'live-evidence-human-locator-review-pack.json');

async function readJson(file) {
  return JSON.parse(await fs.readFile(file, 'utf8'));
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
errors = sorted(Draft202012Validator(schema).iter_errors(instance), key=lambda e: list(e.path))
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

async function inputs() {
  return {
    locatorResolutionResult: await readJson(path.join(fixtureRoot, 'live-evidence-locator-resolution-result.json')),
    locatorReadiness: await readJson(path.join(fixtureRoot, 'live-evidence-locator-readiness.json')),
    supervisedLocatorPlan: await readJson(path.join(fixtureRoot, 'live-evidence-supervised-locator-plan.json')),
    reviewedTargetPlan: await readJson(path.join(fixtureRoot, 'live-evidence-target-plan.reviewed.json')),
  };
}

function basePatch(pack) {
  return {
    type: 'aos.employer_brand_live_evidence_human_locator_patch',
    schema_version: '2026-05-employer-brand-live-evidence-human-locator-patch-v0',
    id: 'human-locator-patch:test',
    review_pack_ref: {
      review_pack_id: pack.id,
      review_pack_path: 'live-evidence-human-locator-review-pack.json',
    },
    decisions: [],
    controls: {
      locator_execution: false,
      codegen_execution: false,
      url_opening: false,
      screenshot_capture: false,
      element_clip_generation: false,
      capture_execution: false,
      report_rendering: false,
      export_execution: false,
      workflow_engine: false,
      full_page_grabs: false,
      autonomous_crawling: false,
      bypasses: false,
    },
  };
}

test('Employer Brand Human Locator Review Pack fixture validates and is generator-stable', async () => {
  const schemaValidation = validateSchema(schemaPath, reviewPackPath);
  assert.equal(schemaValidation.status, 0, `${schemaValidation.stdout}${schemaValidation.stderr}`);

  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'aos-human-locator-review-pack-'));
  const out = path.join(tmp, 'live-evidence-human-locator-review-pack.json');
  try {
    const result = spawnSync(
      process.execPath,
      ['scripts/employer-brand-live-evidence-human-locator-review-pack.mjs', '--out', out],
      { cwd: repoRoot, encoding: 'utf8' },
    );
    assert.equal(result.status, 0, `${result.stdout}${result.stderr}`);
    assert.equal(await fs.readFile(out, 'utf8'), await fs.readFile(reviewPackPath, 'utf8'));
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
});

test('Employer Brand Human Locator Review Pack includes ambiguous attempts and human-target-review items', async () => {
  const pack = buildEmployerBrandLiveEvidenceHumanLocatorReviewPack({
    ...(await inputs()),
    createdAt: '2026-05-08T00:00:00Z',
  });
  assert.deepEqual(validateEmployerBrandLiveEvidenceHumanLocatorReviewPack(pack), { valid: true, errors: [] });
  assert.equal(pack.summary.review_item_count, 9);
  assert.equal(pack.summary.ambiguous_locator_attempt_count, 7);
  assert.equal(pack.summary.needs_human_target_review_count, 2);
  assert.equal(pack.summary.locator_ready_count, 0);

  const reviewItems = pack.groups.flatMap((group) => group.source_categories.flatMap((source) => source.review_items));
  assert.equal(reviewItems.filter((item) => item.review_source === 'ambiguous_locator_attempt').length, 7);
  assert.equal(reviewItems.filter((item) => item.review_source === 'needs_human_target_review').length, 2);
  assert.deepEqual(
    reviewItems.filter((item) => item.review_source === 'needs_human_target_review').map((item) => item.target_id).sort(),
    [
      'live-target:phenom:employee-stories',
      'live-target:symphony-talent:employee-stories',
    ],
  );
});

test('Employer Brand Human Locator Review Pack keeps unconfirmed candidates metadata-only and locators null', () => {
  const pack = loadEmployerBrandLiveEvidenceHumanLocatorReviewPack({ fixtureRoot });
  const items = pack.groups.flatMap((group) => group.source_categories.flatMap((source) => source.review_items));
  assert.equal(items.reduce((count, item) => count + item.unconfirmed_selector_candidates.length, 0), 7);
  for (const item of items) {
    assert.equal(item.locator_ready, false);
    assert.deepEqual(item.human_locator, { selector: null, xpath: null, playwright_locator: null });
    assert.equal(item.required_human_decision.status, 'pending');
    assert.deepEqual(item.required_human_decision.allowed_decisions, [
      'approve_selector',
      'edit_selector',
      'provide_xpath',
      'provide_playwright_locator',
      'refine_natural_language_target',
      'mark_blocked',
      'keep_draft',
      'reject_target',
    ]);
    for (const candidate of item.unconfirmed_selector_candidates) {
      assert.equal(candidate.selector_type, 'unconfirmed_metadata_only');
      assert.equal(candidate.metadata_only, true);
    }
  }
});

test('Employer Brand Human Locator Review Pack rejects premature locator readiness and non-goal openings', () => {
  const pack = clone(loadEmployerBrandLiveEvidenceHumanLocatorReviewPack({ fixtureRoot }));
  const item = pack.groups[0].source_categories[0].review_items[0];
  item.human_locator.selector = '.hero';
  item.locator_ready = true;
  assert.equal(validateEmployerBrandLiveEvidenceHumanLocatorReviewPack(pack).valid, false);

  const opened = clone(loadEmployerBrandLiveEvidenceHumanLocatorReviewPack({ fixtureRoot }));
  opened.controls.screenshot_capture = true;
  assert.equal(validateEmployerBrandLiveEvidenceHumanLocatorReviewPack(opened).valid, false);
});

test('Employer Brand Human Locator Patch validation rejects fake and empty approvals', () => {
  const pack = loadEmployerBrandLiveEvidenceHumanLocatorReviewPack({ fixtureRoot });
  const empty = basePatch(pack);
  assert.equal(validateEmployerBrandLiveEvidenceHumanLocatorPatch(empty, pack).valid, false);

  const fakeTarget = basePatch(pack);
  fakeTarget.decisions.push({
    target_id: 'live-target:fake',
    decision: 'approve_selector',
    locator: { selector: '.hero' },
  });
  assert.equal(validateEmployerBrandLiveEvidenceHumanLocatorPatch(fakeTarget, pack).valid, false);

  const emptyApproval = basePatch(pack);
  emptyApproval.decisions.push({
    target_id: pack.groups[0].source_categories[0].review_items[0].target_id,
    decision: 'approve_selector',
    locator: { selector: '' },
  });
  assert.equal(validateEmployerBrandLiveEvidenceHumanLocatorPatch(emptyApproval, pack).valid, false);

  const valid = basePatch(pack);
  valid.decisions.push({
    target_id: pack.groups[0].source_categories[0].review_items[0].target_id,
    decision: 'provide_playwright_locator',
    locator: { playwright_locator: "page.getByRole('heading', { name: /talent/i })" },
  });
  assert.deepEqual(validateEmployerBrandLiveEvidenceHumanLocatorPatch(valid, pack), { valid: true, errors: [] });
});

test('Employer Brand Human Locator Review Pack count reconciliation excludes hard-blocked context from queue', async () => {
  const pack = loadEmployerBrandLiveEvidenceHumanLocatorReviewPack({ fixtureRoot });
  const resolution = await readJson(path.join(fixtureRoot, 'live-evidence-locator-resolution-result.json'));
  const readiness = await readJson(path.join(fixtureRoot, 'live-evidence-locator-readiness.json'));
  assert.equal(pack.summary.ambiguous_locator_attempt_count, resolution.summary.ambiguous_count);
  assert.equal(pack.summary.needs_human_target_review_count, readiness.summary.needs_human_target_review_count);
  assert.equal(pack.summary.review_item_count, 9);
  assert.equal(pack.excluded_context.hard_blocked_targets_outside_queue.length, 9);
  assert.equal(pack.excluded_context.rejected_exclusion_count, 3);
});
