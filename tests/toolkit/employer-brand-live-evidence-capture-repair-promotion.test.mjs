import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fsSync from 'node:fs';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  loadEmployerBrandLiveEvidenceCaptureRepairPromotion,
  loadEmployerBrandLiveEvidenceRepairedLocatorCapturePlan,
  validateEmployerBrandLiveEvidenceCaptureRepairPromotion,
  validateEmployerBrandLiveEvidenceRepairedLocatorCapturePlan,
} from '../../packages/toolkit/workbench/_reference/employer-brand/employer-brand-live-evidence-capture-repair-promotion.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../..');
const fixtureRoot = path.join(repoRoot, 'docs/design/fixtures/aos-artifacts/employer-brand-comparative-audit');
const promotionPath = path.join(fixtureRoot, 'live-evidence-capture-repair-promotion.json');
const repairedPlanPath = path.join(fixtureRoot, 'live-evidence-repaired-locator-capture-plan.json');
const promotionSchemaPath = path.join(repoRoot, 'shared/schemas/employer-brand-live-evidence-capture-repair-promotion-v0.schema.json');
const repairedPlanSchemaPath = path.join(repoRoot, 'shared/schemas/employer-brand-live-evidence-repaired-locator-capture-plan-v0.schema.json');

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

test('Employer Brand Capture Repair Promotion fixtures validate and are generator-stable', async () => {
  const promotionSchemaValidation = validateSchema(promotionSchemaPath, promotionPath);
  assert.equal(promotionSchemaValidation.status, 0, `${promotionSchemaValidation.stdout}${promotionSchemaValidation.stderr}`);
  const repairedPlanSchemaValidation = validateSchema(repairedPlanSchemaPath, repairedPlanPath);
  assert.equal(repairedPlanSchemaValidation.status, 0, `${repairedPlanSchemaValidation.stdout}${repairedPlanSchemaValidation.stderr}`);

  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'aos-capture-repair-promotion-'));
  const promotionOut = path.join(tmp, 'live-evidence-capture-repair-promotion.json');
  const planOut = path.join(tmp, 'live-evidence-repaired-locator-capture-plan.json');
  try {
    const result = spawnSync(
      process.execPath,
      [
        'scripts/employer-brand-live-evidence-capture-repair-promotion.mjs',
        '--promotion-out',
        promotionOut,
        '--plan-out',
        planOut,
      ],
      { cwd: repoRoot, encoding: 'utf8' },
    );
    assert.equal(result.status, 0, `${result.stdout}${result.stderr}`);
    assert.equal(await fs.readFile(promotionOut, 'utf8'), await fs.readFile(promotionPath, 'utf8'));
    assert.equal(await fs.readFile(planOut, 'utf8'), await fs.readFile(repairedPlanPath, 'utf8'));
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
});

test('Employer Brand Capture Repair Promotion reconciles repair decisions without capture promotion', () => {
  const promotion = loadEmployerBrandLiveEvidenceCaptureRepairPromotion({ fixtureRoot });
  const plan = loadEmployerBrandLiveEvidenceRepairedLocatorCapturePlan({ fixtureRoot });

  assert.deepEqual(validateEmployerBrandLiveEvidenceCaptureRepairPromotion(promotion), { valid: true, errors: [] });
  assert.deepEqual(validateEmployerBrandLiveEvidenceRepairedLocatorCapturePlan(plan), { valid: true, errors: [] });
  assert.equal(promotion.summary.repaired_executable_slot_count, 4);
  assert.equal(promotion.summary.unavailable_source_slot_count, 1);
  assert.equal(promotion.summary.previous_failed_executable_slot_count, 5);
  assert.equal(promotion.summary.accepted_capture_count, 0);
  assert.equal(promotion.summary.promoted_capture_count, 0);
  assert.equal(promotion.summary.actual_capture_file_count, 0);
  assert.equal(plan.repaired_capture_slots.length, 4);
  assert.equal(plan.unavailable_source_slots.length, 1);
  assert.equal(plan.non_executable_context.length, 14);
  assert.equal(plan.planned_output_manifest.contains_actual_captures, false);
});

test('Employer Brand Capture Repair Promotion preserves Operator locators exactly', () => {
  const plan = readJson(repairedPlanPath);
  const locatorsBySlot = new Map(plan.repaired_capture_slots.map((slot) => [slot.slot_id, slot.repaired_locator]));

  assert.deepEqual(locatorsBySlot.get('live-reviewed-capture-work-unit:symphony-talent-careers-site:slot:1'), {
    selector: 'section#home-hero',
    xpath: null,
    playwright_locator: null,
  });
  assert.deepEqual(locatorsBySlot.get('live-reviewed-capture-work-unit:symphony-talent-careers-site:slot:2'), {
    selector: 'section#section-2-2583',
    xpath: null,
    playwright_locator: null,
  });
  assert.deepEqual(locatorsBySlot.get('live-reviewed-capture-work-unit:phenom-careers-site:slot:1'), {
    selector: null,
    xpath: null,
    playwright_locator: "page.locator('main section').filter({ hasText: /AI for Tomorrow.*Applied by Human Resources/ }).first()",
  });
  assert.deepEqual(locatorsBySlot.get('live-reviewed-capture-work-unit:radancy-careers-site:slot:1'), {
    selector: 'div.primary-hero',
    xpath: null,
    playwright_locator: null,
  });

  const unavailable = plan.unavailable_source_slots[0];
  assert.equal(unavailable.status, 'source_unavailable');
  assert.equal(unavailable.source_category, 'linkedin_presence');
  assert.equal(unavailable.repaired_locator.selector, null);
  assert.equal(unavailable.repaired_locator.xpath, null);
  assert.equal(unavailable.repaired_locator.playwright_locator, null);
});

test('Employer Brand Capture Repair Promotion keeps outputs null and full-page grabs disabled', () => {
  const plan = readJson(repairedPlanPath);
  const outputs = [
    ...plan.planned_output_manifest.slots,
    ...plan.repaired_capture_slots.flatMap((slot) => slot.planned_outputs),
  ];

  assert.ok(outputs.every((output) => output.clip_path === null));
  assert.ok(outputs.every((output) => output.text_extract_path === null));
  assert.ok(outputs.every((output) => output.full_page_grab === false));
  assert.ok(plan.repaired_capture_slots.every((slot) => slot.full_page_grab === false));
  assert.ok(plan.unavailable_source_slots.every((slot) => slot.full_page_grab === false));
  assert.ok(plan.non_executable_context.every((entry) => entry.full_page_grab === false));
  assert.ok(Object.values(plan.controls).every((value) => value === false));
});
