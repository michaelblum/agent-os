import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fsSync from 'node:fs';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  buildEmployerBrandLiveEvidenceVisibilityAdjustedCapturePlan,
  loadEmployerBrandLiveEvidenceVisibilityAdjustedCapturePlan,
  loadEmployerBrandLiveEvidenceVisibilityAdjustedCapturePlanInputs,
  validateEmployerBrandLiveEvidenceVisibilityAdjustedCapturePlan,
} from '../../packages/toolkit/workbench/employer-brand-live-evidence-visibility-adjusted-capture-plan.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../..');
const fixtureRoot = path.join(repoRoot, 'docs/design/fixtures/aos-artifacts/employer-brand-comparative-audit');
const planPath = path.join(fixtureRoot, 'live-evidence-visibility-adjusted-capture-plan.json');
const schemaPath = path.join(repoRoot, 'shared/schemas/employer-brand-live-evidence-visibility-adjusted-capture-plan-v0.schema.json');

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

test('Visibility-adjusted capture plan fixture validates and preserves approved preconditions', () => {
  const plan = loadEmployerBrandLiveEvidenceVisibilityAdjustedCapturePlan({ fixtureRoot });
  const patch = readJson(path.join(fixtureRoot, 'live-evidence-repaired-capture-visibility-repair-patch.json'));
  const repairedPlan = readJson(path.join(fixtureRoot, 'live-evidence-repaired-locator-capture-plan.json'));
  const schemaValidation = validateSchema(schemaPath, planPath);

  assert.equal(schemaValidation.status, 0, `${schemaValidation.stdout}${schemaValidation.stderr}`);
  assert.deepEqual(validateEmployerBrandLiveEvidenceVisibilityAdjustedCapturePlan(plan), {
    valid: true,
    errors: [],
  });
  assert.equal(plan.summary.visibility_adjusted_executable_slot_count, 4);
  assert.equal(plan.summary.accepted_capture_count, 0);
  assert.equal(plan.summary.actual_clip_asset_count, 0);
  assert.equal(plan.summary.actual_text_asset_count, 0);
  assert.equal(plan.summary.planned_output_slot_count, 4);
  assert.equal(plan.summary.scroll_strategy_count, 1);
  assert.equal(plan.summary.wait_condition_count, 3);
  assert.equal(plan.summary.viewport_hint_count, 0);
  assert.equal(plan.unavailable_source_slots[0].target_id, 'live-target:symphony-talent:linkedin-presence');
  assert.equal(plan.non_executable_context.length, 14);
  assert.equal(plan.read_only_visibility_context.length, 15);
  assert.ok(plan.repaired_capture_slots.every((slot) => slot.full_page_grab === false));
  assert.ok(plan.planned_output_manifest.slots.every((slot) => slot.clip_path === null && slot.text_extract_path === null));

  const patchBySlot = new Map(patch.repair_items.map((item) => [item.slot_id, item]));
  const repairedBySlot = new Map(repairedPlan.repaired_capture_slots.map((slot) => [slot.slot_id, slot]));
  for (const slot of plan.repaired_capture_slots) {
    const patchItem = patchBySlot.get(slot.slot_id);
    const repairedSlot = repairedBySlot.get(slot.slot_id);
    assert.ok(patchItem);
    assert.ok(repairedSlot);
    assert.equal(slot.target_id, patchItem.target_id);
    assert.equal(slot.work_unit_id, patchItem.work_unit_id);
    assert.equal(slot.company, patchItem.company);
    assert.equal(slot.source_category, patchItem.source_category);
    assert.equal(slot.final_url, patchItem.final_url);
    assert.equal(slot.natural_language_target, patchItem.original_natural_language_target);
    assert.deepEqual(slot.kilos_relevance, patchItem.kilos_relevance);
    assert.equal(slot.evidence_goal, patchItem.evidence_goal);
    assert.equal(slot.expected_clip_count, patchItem.expected_clip_count);
    assert.deepEqual(slot.repaired_locator, repairedSlot.repaired_locator);
    assert.equal(slot.visibility_precondition.capture_precondition, patchItem.repair.capture_precondition);
    assert.equal(slot.visibility_precondition.scroll_strategy, patchItem.repair.scroll_strategy);
    assert.equal(slot.visibility_precondition.wait_condition, patchItem.repair.wait_condition);
    assert.equal(slot.visibility_precondition.viewport_hint, patchItem.repair.viewport_hint);
    assert.equal(slot.visibility_precondition.operator_repair_notes, patchItem.repair.repair_notes);
    assert.equal(slot.visibility_failure_provenance.blocker_reason, patchItem.blocker_reason);
  }
});

test('Visibility-adjusted capture plan generator is deterministic and does not create assets', async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'aos-visibility-adjusted-plan-'));
  const out = path.join(tmp, 'live-evidence-visibility-adjusted-capture-plan.json');
  try {
    const result = spawnSync(
      process.execPath,
      [
        'scripts/employer-brand-live-evidence-visibility-adjusted-capture-plan.mjs',
        '--out',
        out,
      ],
      { cwd: repoRoot, encoding: 'utf8' },
    );
    assert.equal(result.status, 0, `${result.stdout}${result.stderr}`);
    assert.equal(await fs.readFile(out, 'utf8'), await fs.readFile(planPath, 'utf8'));

    const rebuilt = buildEmployerBrandLiveEvidenceVisibilityAdjustedCapturePlan(
      loadEmployerBrandLiveEvidenceVisibilityAdjustedCapturePlanInputs({ fixtureRoot }),
      { createdAt: '2026-05-09T00:00:00Z' },
    );
    assert.deepEqual(rebuilt, readJson(planPath));
    assert.equal(rebuilt.provenance.no_urls_opened, true);
    assert.equal(rebuilt.provenance.no_browser_capture_run, true);
    assert.equal(rebuilt.provenance.no_capture_assets_produced, true);
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
});
