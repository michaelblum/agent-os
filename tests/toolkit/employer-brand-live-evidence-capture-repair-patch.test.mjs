import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fsSync from 'node:fs';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  CAPTURE_REPAIR_DECISIONS,
  applyEmployerBrandLiveEvidenceCaptureRepairPatch,
  loadEmployerBrandLiveEvidenceCaptureRepairPatch,
  loadEmployerBrandLiveEvidenceCaptureRepairPatchApplication,
  validateEmployerBrandLiveEvidenceCaptureRepairPatch,
} from '../../packages/toolkit/workbench/_reference/employer-brand/employer-brand-live-evidence-capture-repair-patch.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../..');
const fixtureRoot = path.join(repoRoot, 'docs/design/fixtures/aos-artifacts/employer-brand-comparative-audit');
const patchPath = path.join(fixtureRoot, 'live-evidence-capture-repair-patch.json');
const applicationPath = path.join(fixtureRoot, 'live-evidence-capture-repair-patch.application.json');
const failureReviewPackPath = path.join(fixtureRoot, 'live-evidence-capture-failure-review-pack.json');
const reviewedLocatorReadinessPath = path.join(fixtureRoot, 'live-evidence-locator-readiness.reviewed.json');
const manifestPath = path.join(fixtureRoot, 'source-artifacts/live-evidence-element-clip-manifest.json');
const patchSchemaPath = path.join(repoRoot, 'shared/schemas/employer-brand-live-evidence-capture-repair-patch-v0.schema.json');

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

test('Employer Brand Live Evidence Capture Repair Patch fixture validates and template generator stays bounded', async () => {
  const schemaValidation = validateSchema(patchSchemaPath, patchPath);
  assert.equal(schemaValidation.status, 0, `${schemaValidation.stdout}${schemaValidation.stderr}`);

  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'aos-capture-repair-patch-'));
  const patchOut = path.join(tmp, 'live-evidence-capture-repair-patch.json');
  const applicationOut = path.join(tmp, 'live-evidence-capture-repair-patch.application.json');
  try {
    const result = spawnSync(
      process.execPath,
      [
        'scripts/employer-brand-live-evidence-capture-repair-patch.mjs',
        '--patch-out',
        patchOut,
        '--application-out',
        applicationOut,
      ],
      { cwd: repoRoot, encoding: 'utf8' },
    );
    assert.equal(result.status, 0, `${result.stdout}${result.stderr}`);
    const generatedPatch = JSON.parse(await fs.readFile(patchOut, 'utf8'));
    const generatedApplication = JSON.parse(await fs.readFile(applicationOut, 'utf8'));
    assert.equal(generatedPatch.status, 'unfilled_template');
    assert.equal(generatedPatch.summary.all_repair_fields_null, true);
    assert.equal(generatedApplication.status, 'no_op_unfilled_template');
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
});

test('Employer Brand Live Evidence Capture Repair Patch preserves failed slots and read-only context', () => {
  const patch = loadEmployerBrandLiveEvidenceCaptureRepairPatch({ fixtureRoot });
  const failureReviewPack = readJson(failureReviewPackPath);
  const validation = validateEmployerBrandLiveEvidenceCaptureRepairPatch(patch, failureReviewPack);

  assert.deepEqual(validation, { valid: true, errors: [] });
  assert.equal(patch.summary.patchable_repair_item_count, 5);
  assert.equal(patch.summary.read_only_context_entry_count, 14);
  assert.equal(patch.repair_items.length, 5);
  assert.equal(patch.read_only_context.length, 14);
  assert.deepEqual(patch.allowed_repair_decisions, CAPTURE_REPAIR_DECISIONS);
  assert.ok(patch.repair_items.every((item) => item.allowed_repair_decisions.join('|') === CAPTURE_REPAIR_DECISIONS.join('|')));
  assert.ok(patch.read_only_context.every((entry) => entry.read_only_context === true && entry.actionable_repair_item === false));

  const failureSlots = failureReviewPack.repair_queue.groups.flatMap((group) => group.failures).map((failure) => failure.slot_id).sort();
  const repairSlots = patch.repair_items.map((item) => item.slot_id).sort();
  assert.deepEqual(repairSlots, failureSlots);
});

test('Employer Brand Live Evidence Capture Repair Patch keeps classifications and next decisions distinct', () => {
  const patch = loadEmployerBrandLiveEvidenceCaptureRepairPatch({ fixtureRoot });
  assert.equal(patch.summary.zero_match_locator_failure_count, 4);
  assert.equal(patch.summary.login_or_sign_in_blocker_count, 1);
  assert.equal(patch.summary.blocker_reason_counts.reviewed_locator_matches_zero_elements, 4);
  assert.equal(patch.summary.blocker_reason_counts.login_required, 1);
  assert.equal(patch.summary.recommended_next_action_counts.needs_operator_locator_repair, 4);
  assert.equal(patch.summary.recommended_next_action_counts.needs_human_source_decision, 1);

  const loginItem = patch.repair_items.find((item) => item.blocker_reason === 'login_required');
  assert.equal(loginItem.blocker_class, 'login_or_sign_in_blocker');
  assert.equal(loginItem.recommended_next_action, 'needs_human_source_decision');
  assert.equal(loginItem.company, 'Symphony Talent');
  assert.equal(loginItem.source_category, 'linkedin_presence');
});

test('Employer Brand Live Evidence Capture Repair Patch checked-in reviewed patch carries Operator decisions', () => {
  const patch = loadEmployerBrandLiveEvidenceCaptureRepairPatch({ fixtureRoot });
  assert.equal(patch.status, 'repair_reviewed');
  assert.equal(patch.summary.filled_repair_decision_count, 5);
  assert.equal(patch.summary.proposed_locator_count, 4);
  assert.equal(patch.summary.replacement_url_count, 0);
  assert.equal(patch.summary.source_unavailable_count, 1);
  assert.equal(patch.summary.all_repair_fields_null, false);
  assert.equal(patch.repair_items.filter((item) => item.repair.repair_decision === 'approve_repaired_locator').length, 4);
  assert.equal(patch.repair_items.filter((item) => item.repair.repair_decision === 'mark_source_unavailable').length, 1);
});

test('Employer Brand Live Evidence Capture Repair Patch reviewed application remains pending execution', () => {
  const patch = loadEmployerBrandLiveEvidenceCaptureRepairPatch({ fixtureRoot });
  const failureReviewPack = readJson(failureReviewPackPath);
  const reviewedLocatorReadiness = readJson(reviewedLocatorReadinessPath);
  const manifest = readJson(manifestPath);
  const application = applyEmployerBrandLiveEvidenceCaptureRepairPatch({
    patchInput: patch,
    failureReviewPackInput: failureReviewPack,
    reviewedLocatorReadinessInput: reviewedLocatorReadiness,
    elementClipManifestInput: manifest,
    appliedAt: '2026-05-08T00:00:00Z',
  });
  const fixtureApplication = loadEmployerBrandLiveEvidenceCaptureRepairPatchApplication({ fixtureRoot });

  assert.deepEqual(application, fixtureApplication);
  assert.equal(application.status, 'repair_decisions_pending_execution');
  assert.equal(application.summary.prior_accepted_capture_count, 0);
  assert.equal(application.summary.post_accepted_capture_count, 0);
  assert.equal(application.summary.prior_failed_executable_slot_count, 5);
  assert.equal(application.summary.post_failed_executable_slot_count, 5);
  assert.equal(application.summary.unresolved_failed_executable_slot_count, 5);
  assert.equal(application.summary.prior_locator_ready_count, 4);
  assert.equal(application.summary.post_locator_ready_count, 4);
  assert.equal(application.summary.new_locator_ready_slot_count, 0);
  assert.equal(application.summary.promoted_capture_count, 0);
  assert.equal(application.summary.filled_repair_decision_count, 5);
  assert.equal(application.summary.source_unavailable_count, 1);
  assert.equal(application.summary.no_op, false);
  assert.ok(application.repair_results.every((result) => result.applied === false));
});

test('Employer Brand Live Evidence Capture Repair Patch rejects fabricated or incomplete repairs', () => {
  const patch = loadEmployerBrandLiveEvidenceCaptureRepairPatch({ fixtureRoot });
  const failureReviewPack = readJson(failureReviewPackPath);

  const fabricated = clone(patch);
  fabricated.repair_items[0].slot_id = 'live-reviewed-capture-work-unit:fake:slot:1';
  assert.equal(validateEmployerBrandLiveEvidenceCaptureRepairPatch(fabricated, failureReviewPack).valid, false);

  const incompleteLocator = clone(patch);
  incompleteLocator.repair_items[0].repair.repair_decision = 'approve_repaired_locator';
  incompleteLocator.repair_items[0].repair.proposed_selector = null;
  incompleteLocator.repair_items[0].repair.proposed_xpath = null;
  incompleteLocator.repair_items[0].repair.proposed_playwright_locator = null;
  assert.equal(validateEmployerBrandLiveEvidenceCaptureRepairPatch(incompleteLocator, failureReviewPack).valid, false);

  const blockedControl = clone(patch);
  blockedControl.controls.open_urls = true;
  assert.equal(validateEmployerBrandLiveEvidenceCaptureRepairPatch(blockedControl, failureReviewPack).valid, false);
});
