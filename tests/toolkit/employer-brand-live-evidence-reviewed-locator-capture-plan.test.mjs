import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fsSync from 'node:fs';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  loadEmployerBrandLiveEvidenceReviewedLocatorCapturePlan,
  validateEmployerBrandLiveEvidenceReviewedLocatorCapturePlan,
} from '../../packages/toolkit/workbench/_reference/employer-brand/employer-brand-live-evidence-reviewed-locator-capture-plan.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../..');
const fixtureRoot = path.join(
  repoRoot,
  'docs/design/fixtures/aos-artifacts/employer-brand-comparative-audit',
);
const schemaPath = path.join(repoRoot, 'shared/schemas/employer-brand-live-evidence-reviewed-locator-capture-plan-v0.schema.json');
const planPath = path.join(fixtureRoot, 'live-evidence-reviewed-locator-capture-plan.json');

function readJson(file) {
  return JSON.parse(fsSync.readFileSync(file, 'utf8'));
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

test('Employer Brand Reviewed Locator Capture Plan fixture validates and is generator-stable', async () => {
  const schemaValidation = validateSchema(schemaPath, planPath);
  assert.equal(schemaValidation.status, 0, `${schemaValidation.stdout}${schemaValidation.stderr}`);

  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'aos-employer-brand-reviewed-locator-capture-plan-'));
  const out = path.join(tmp, 'live-evidence-reviewed-locator-capture-plan.json');
  try {
    const result = spawnSync(
      process.execPath,
      ['scripts/employer-brand-live-evidence-reviewed-locator-capture-plan.mjs', '--out', out],
      { cwd: repoRoot, encoding: 'utf8' },
    );
    assert.equal(result.status, 0, `${result.stdout}${result.stderr}`);
    assert.equal(await fs.readFile(out, 'utf8'), await fs.readFile(planPath, 'utf8'));
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
});

test('Employer Brand Reviewed Locator Capture Plan only makes reviewed locator_ready targets executable', () => {
  const readiness = readJson(path.join(fixtureRoot, 'live-evidence-locator-readiness.reviewed.json'));
  const plan = loadEmployerBrandLiveEvidenceReviewedLocatorCapturePlan({ fixtureRoot });
  const readyIds = readiness.targets
    .filter((target) => target.readiness_state === 'locator_ready')
    .map((target) => target.target_id);
  const executableIds = plan.executable_units.map((unit) => unit.target_id);

  assert.deepEqual(validateEmployerBrandLiveEvidenceReviewedLocatorCapturePlan(plan), { valid: true, errors: [] });
  assert.deepEqual(executableIds, readyIds);
  assert.equal(plan.summary.executable_unit_count, 4);
  assert.equal(plan.summary.expected_ready_clip_count, 5);
  assert.equal(plan.summary.planned_output_slot_count, 5);
  assert.equal(plan.summary.needs_locator_count, 11);
  assert.equal(plan.summary.needs_human_locator_review_count, 1);
  assert.equal(plan.summary.blocked_count, 1);
  assert.equal(plan.summary.rejected_count, 1);
});

test('Employer Brand Reviewed Locator Capture Plan preserves unresolved targets as non-executable context', () => {
  const plan = loadEmployerBrandLiveEvidenceReviewedLocatorCapturePlan({ fixtureRoot });
  const grouped = plan.summary.grouped_non_executable_by_category;
  const contextIds = new Set(plan.non_executable_context.map((entry) => entry.target_id));

  assert.deepEqual(grouped, {
    needs_locator: 11,
    blocked: 1,
    needs_human_locator_review: 1,
    rejected: 1,
  });
  assert.equal(plan.non_executable_context.length, 14);
  assert.ok(contextIds.has('live-target:radancy:linkedin-presence'));
  assert.ok(plan.non_executable_context.every((entry) => entry.executable === false));
  assert.ok(plan.non_executable_context.every((entry) => entry.output_manifest_slot_ids.length === 0));
});

test('Employer Brand Reviewed Locator Capture Plan carries reviewed locator provenance and source metadata', () => {
  const plan = loadEmployerBrandLiveEvidenceReviewedLocatorCapturePlan({ fixtureRoot });
  const symphonyCareers = plan.executable_units.find((unit) => unit.target_id === 'live-target:symphony-talent:careers-site');
  const symphonyLinkedIn = plan.executable_units.find((unit) => unit.target_id === 'live-target:symphony-talent:linkedin-presence');
  const phenomCareers = plan.executable_units.find((unit) => unit.target_id === 'live-target:phenom:careers-site');
  const radancyCareers = plan.executable_units.find((unit) => unit.target_id === 'live-target:radancy:careers-site');

  assert.equal(symphonyCareers.reviewed_locator.selector, '[data-testid="hero-employer-brand"], main section.hero');
  assert.equal(symphonyCareers.locator_review.decision, 'approve_selector');
  assert.equal(symphonyLinkedIn.reviewed_locator.playwright_locator, "page.getByRole('heading', { name: /Symphony Talent/i }).first()");
  assert.equal(symphonyLinkedIn.locator_review.decision, 'provide_playwright_locator');
  assert.equal(phenomCareers.reviewed_locator.selector, 'main [data-component="hero"], main .hero');
  assert.equal(phenomCareers.locator_review.decision, 'edit_selector');
  assert.equal(radancyCareers.reviewed_locator.xpath, "//main//*[self::section or self::div][.//*[contains(normalize-space(.), 'Talent Acquisition')]][1]");
  assert.equal(radancyCareers.locator_review.decision, 'provide_xpath');
  assert.equal(symphonyCareers.citation_source_metadata.data_bundle_id, 'employer-brand-comparative-audit-data-bundle:symphony-talent-phenom-radancy');
  assert.equal(symphonyCareers.citation_source_metadata.citation.provenance_only, true);
});

test('Employer Brand Reviewed Locator Capture Plan planned output slots reconcile and produce no assets', () => {
  const plan = loadEmployerBrandLiveEvidenceReviewedLocatorCapturePlan({ fixtureRoot });
  const unitSlotIds = new Set(plan.executable_units.flatMap((unit) => unit.output_manifest_slot_ids));
  const manifestSlotIds = new Set(plan.planned_output_manifest.slots.map((slot) => slot.slot_id));

  assert.equal(plan.planned_output_manifest.expected_clip_count, 5);
  assert.equal(plan.planned_output_manifest.expected_text_extract_count, 5);
  assert.equal(plan.planned_output_manifest.slots.length, 5);
  assert.deepEqual(unitSlotIds, manifestSlotIds);
  assert.equal(plan.planned_output_manifest.contains_actual_captures, false);
  assert.ok(plan.planned_output_manifest.slots.every((slot) => slot.clip_path === null));
  assert.ok(plan.planned_output_manifest.slots.every((slot) => slot.text_extract_path === null));
  assert.ok(plan.planned_output_manifest.slots.every((slot) => slot.acceptance_status === 'not_run'));
});

test('Employer Brand Reviewed Locator Capture Plan keeps non-goal controls closed', () => {
  const plan = loadEmployerBrandLiveEvidenceReviewedLocatorCapturePlan({ fixtureRoot });

  assert.equal(plan.controls.pre_capture_plan_only, true);
  assert.equal(plan.controls.human_approved_locators_required, true);
  for (const [key, value] of Object.entries(plan.controls)) {
    if (!['pre_capture_plan_only', 'human_approved_locators_required'].includes(key)) {
      assert.equal(value, false, key);
    }
  }
  assert.equal(plan.retry_policy.automatic_retries_authorized, false);
  assert.equal(plan.retry_policy.retry_requires_human_reapproval, true);
  assert.ok(plan.provenance.non_goals.includes('capture_execution'));
  assert.ok(plan.provenance.non_goals.includes('full_page_grabs'));
  assert.equal(plan.provenance.no_capture_assets_produced, true);
});
