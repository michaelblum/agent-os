import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fsSync from 'node:fs';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  loadEmployerBrandRepairedCaptureVisibilityReviewPack,
  validateEmployerBrandRepairedCaptureVisibilityReviewPack,
} from '../../packages/toolkit/workbench/employer-brand-repaired-capture-visibility-review-pack.js';
import {
  VISIBILITY_REPAIR_DECISIONS,
  applyEmployerBrandRepairedCaptureVisibilityRepairPatch,
  loadEmployerBrandRepairedCaptureVisibilityRepairPatch,
  loadEmployerBrandRepairedCaptureVisibilityRepairPatchApplication,
  validateEmployerBrandRepairedCaptureVisibilityRepairPatch,
} from '../../packages/toolkit/workbench/employer-brand-repaired-capture-visibility-repair-patch.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../..');
const fixtureRoot = path.join(repoRoot, 'docs/design/fixtures/aos-artifacts/employer-brand-comparative-audit');
const reviewPackPath = path.join(fixtureRoot, 'live-evidence-repaired-capture-visibility-review-pack.json');
const patchPath = path.join(fixtureRoot, 'live-evidence-repaired-capture-visibility-repair-patch.json');
const applicationPath = path.join(fixtureRoot, 'live-evidence-repaired-capture-visibility-repair-patch.application.json');
const manifestPath = path.join(fixtureRoot, 'source-artifacts/live-evidence-element-clip-manifest.json');
const reviewPackSchemaPath = path.join(repoRoot, 'shared/schemas/employer-brand-repaired-capture-visibility-review-pack-v0.schema.json');
const patchSchemaPath = path.join(repoRoot, 'shared/schemas/employer-brand-repaired-capture-visibility-repair-patch-v0.schema.json');

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

test('Employer Brand repaired capture visibility fixtures validate and generator stays bounded', async () => {
  const reviewSchemaValidation = validateSchema(reviewPackSchemaPath, reviewPackPath);
  assert.equal(reviewSchemaValidation.status, 0, `${reviewSchemaValidation.stdout}${reviewSchemaValidation.stderr}`);
  const patchSchemaValidation = validateSchema(patchSchemaPath, patchPath);
  assert.equal(patchSchemaValidation.status, 0, `${patchSchemaValidation.stdout}${patchSchemaValidation.stderr}`);

  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'aos-repaired-visibility-'));
  const reviewOut = path.join(tmp, 'live-evidence-repaired-capture-visibility-review-pack.json');
  const patchOut = path.join(tmp, 'live-evidence-repaired-capture-visibility-repair-patch.json');
  const applicationOut = path.join(tmp, 'live-evidence-repaired-capture-visibility-repair-patch.application.json');
  try {
    const result = spawnSync(
      process.execPath,
      [
        'scripts/employer-brand-repaired-capture-visibility-review-and-patch.mjs',
        '--review-pack-out',
        reviewOut,
        '--patch-out',
        patchOut,
        '--application-out',
        applicationOut,
      ],
      { cwd: repoRoot, encoding: 'utf8' },
    );
    assert.equal(result.status, 0, `${result.stdout}${result.stderr}`);
    assert.equal(await fs.readFile(reviewOut, 'utf8'), await fs.readFile(reviewPackPath, 'utf8'));
    const generatedPatch = JSON.parse(await fs.readFile(patchOut, 'utf8'));
    assert.deepEqual(validateEmployerBrandRepairedCaptureVisibilityRepairPatch(generatedPatch, readJson(reviewOut)), {
      valid: true,
      errors: [],
    });
    assert.equal(generatedPatch.status, 'unfilled_template');
    assert.equal(generatedPatch.summary.filled_visibility_repair_decision_count, 0);
    assert.equal(generatedPatch.summary.all_repair_fields_null, true);
    assert.equal(await fs.readFile(applicationOut, 'utf8'), await fs.readFile(applicationPath, 'utf8'));
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
});

test('Employer Brand repaired capture visibility review pack classifies only visibility failures', () => {
  const reviewPack = loadEmployerBrandRepairedCaptureVisibilityReviewPack({ fixtureRoot });
  const validation = validateEmployerBrandRepairedCaptureVisibilityReviewPack(reviewPack);

  assert.deepEqual(validation, { valid: true, errors: [] });
  assert.equal(reviewPack.summary.actionable_visibility_failure_count, 4);
  assert.equal(reviewPack.summary.accepted_capture_count, 0);
  assert.equal(reviewPack.summary.actual_clip_asset_count, 0);
  assert.equal(reviewPack.summary.actual_text_asset_count, 0);
  assert.equal(reviewPack.summary.full_page_grab_count, 0);
  assert.equal(reviewPack.summary.runtime_preflight_failure_count, 0);
  assert.equal(reviewPack.summary.zero_match_locator_failure_count, 0);
  assert.equal(reviewPack.summary.ambiguous_multi_match_failure_count, 0);
  assert.equal(reviewPack.summary.source_unavailable_blocker_count, 1);
  assert.equal(reviewPack.summary.failed_phase_counts.element_visibility_check, 4);
  assert.equal(reviewPack.summary.runner_type_counts.playwright_node_api, 4);
  assert.equal(reviewPack.summary.match_count_counts['1'], 4);
  assert.equal(reviewPack.non_actionable_context.filter((entry) => entry.context_kind === 'source_unavailable').length, 1);
  assert.ok(reviewPack.visibility_failures.every((failure) => failure.blocker_reason === 'reviewed_locator_element_not_visible'));
  assert.ok(reviewPack.visibility_failures.every((failure) => failure.failed_phase === 'element_visibility_check'));
  assert.ok(reviewPack.visibility_failures.every((failure) => failure.match_count === 1));
  assert.ok(reviewPack.visibility_failures.every((failure) => failure.full_page_grab === false));
});

test('Employer Brand repaired capture visibility patch records operator decisions', () => {
  const reviewPack = loadEmployerBrandRepairedCaptureVisibilityReviewPack({ fixtureRoot });
  const patch = loadEmployerBrandRepairedCaptureVisibilityRepairPatch({ fixtureRoot });
  const manifest = readJson(manifestPath);
  const validation = validateEmployerBrandRepairedCaptureVisibilityRepairPatch(patch, reviewPack);

  assert.deepEqual(validation, { valid: true, errors: [] });
  assert.deepEqual(patch.allowed_visibility_repair_decisions, VISIBILITY_REPAIR_DECISIONS);
  assert.equal(patch.status, 'repair_reviewed');
  assert.equal(patch.summary.patchable_visibility_repair_item_count, 4);
  assert.equal(patch.summary.read_only_context_entry_count, 15);
  assert.equal(patch.summary.filled_visibility_repair_decision_count, 4);
  assert.equal(patch.summary.proposed_locator_count, 0);
  assert.equal(patch.summary.scroll_strategy_count, 1);
  assert.equal(patch.summary.wait_condition_count, 3);
  assert.equal(patch.summary.viewport_hint_count, 0);
  assert.equal(patch.summary.all_repair_fields_null, false);
  assert.equal(
    patch.repair_items.filter((item) => item.repair.visibility_repair_decision === 'add_scroll_strategy').length,
    1,
  );
  assert.equal(
    patch.repair_items.filter((item) => item.repair.visibility_repair_decision === 'add_wait_condition').length,
    3,
  );
  assert.ok(patch.repair_items.every((item) => item.repair.reviewed_by === 'operator:gdi'));
  assert.ok(patch.repair_items.every((item) => item.repair.proposed_selector === null));
  assert.ok(patch.repair_items.every((item) => item.repair.proposed_xpath === null));
  assert.ok(patch.repair_items.every((item) => item.repair.proposed_playwright_locator === null));

  const application = applyEmployerBrandRepairedCaptureVisibilityRepairPatch({
    patchInput: patch,
    visibilityReviewPackInput: reviewPack,
    elementClipManifestInput: manifest,
    appliedAt: '2026-05-09T00:00:00Z',
  });
  assert.equal(application.status, 'visibility_repairs_pending_execution');
  assert.equal(loadEmployerBrandRepairedCaptureVisibilityRepairPatchApplication({ fixtureRoot }).status, 'no_op_unfilled_template');
  assert.equal(application.summary.post_accepted_capture_count, 0);
  assert.equal(application.summary.post_clip_asset_count, 0);
  assert.equal(application.summary.post_text_asset_count, 0);
  assert.equal(application.summary.promoted_capture_count, 0);
  assert.equal(application.summary.new_asset_count, 0);
  assert.ok(application.repair_results.every((result) => result.applied === false));
});

test('Employer Brand repaired capture visibility patch rejects fabricated or incomplete decisions', () => {
  const reviewPack = loadEmployerBrandRepairedCaptureVisibilityReviewPack({ fixtureRoot });
  const patch = loadEmployerBrandRepairedCaptureVisibilityRepairPatch({ fixtureRoot });

  const fabricated = clone(patch);
  fabricated.repair_items[0].slot_id = 'live-reviewed-capture-work-unit:fake:slot:1';
  assert.equal(validateEmployerBrandRepairedCaptureVisibilityRepairPatch(fabricated, reviewPack).valid, false);

  const incompleteScroll = clone(patch);
  incompleteScroll.repair_items[0].repair.visibility_repair_decision = 'add_scroll_strategy';
  assert.equal(validateEmployerBrandRepairedCaptureVisibilityRepairPatch(incompleteScroll, reviewPack).valid, false);

  const blockedControl = clone(patch);
  blockedControl.controls.open_urls = true;
  assert.equal(validateEmployerBrandRepairedCaptureVisibilityRepairPatch(blockedControl, reviewPack).valid, false);
});
