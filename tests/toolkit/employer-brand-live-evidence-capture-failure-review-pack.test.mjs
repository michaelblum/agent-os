import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  loadEmployerBrandLiveEvidenceCaptureFailureReviewPack,
  normalizeEmployerBrandLiveEvidenceCaptureFailureReviewPack,
  validateEmployerBrandLiveEvidenceCaptureFailureReviewPack,
} from '../../packages/toolkit/workbench/_reference/employer-brand/employer-brand-live-evidence-capture-failure-review-pack.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../..');
const fixtureRoot = path.join(
  repoRoot,
  'docs/design/fixtures/aos-artifacts/employer-brand-comparative-audit',
);
const schemaPath = path.join(
  repoRoot,
  'shared/schemas/employer-brand-live-evidence-capture-failure-review-pack-v0.schema.json',
);
const reviewPackPath = path.join(fixtureRoot, 'live-evidence-capture-failure-review-pack.json');

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

test('Employer Brand Live Evidence Capture Failure Review Pack fixture validates and is generator-stable', async () => {
  const schemaValidation = validateSchema(schemaPath, reviewPackPath);
  assert.equal(schemaValidation.status, 0, `${schemaValidation.stdout}${schemaValidation.stderr}`);

  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'aos-employer-brand-capture-failure-review-pack-'));
  const out = path.join(tmp, 'live-evidence-capture-failure-review-pack.json');
  try {
    const result = spawnSync(
      process.execPath,
      ['scripts/employer-brand-live-evidence-capture-failure-review-pack.mjs', '--out', out],
      { cwd: repoRoot, encoding: 'utf8' },
    );
    assert.equal(result.status, 0, `${result.stdout}${result.stderr}`);
    assert.equal(await fs.readFile(out, 'utf8'), await fs.readFile(reviewPackPath, 'utf8'));
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
});

test('Employer Brand Live Evidence Capture Failure Review Pack reconciles manifest counts', () => {
  const pack = loadEmployerBrandLiveEvidenceCaptureFailureReviewPack({ fixtureRoot });
  const normalized = normalizeEmployerBrandLiveEvidenceCaptureFailureReviewPack(pack);

  assert.deepEqual(validateEmployerBrandLiveEvidenceCaptureFailureReviewPack(pack), { valid: true, errors: [] });
  assert.equal(normalized.summary.executable_unit_count, 4);
  assert.equal(normalized.summary.planned_output_slot_count, 5);
  assert.equal(normalized.summary.accepted_capture_count, 0);
  assert.equal(normalized.summary.failed_executable_slot_count, 5);
  assert.equal(normalized.summary.non_executable_context_count, 14);
  assert.equal(normalized.summary.full_page_grab_count, 0);
  assert.equal(normalized.failures.length, 5);
  assert.equal(normalized.non_executable_context.length, 14);
  assert.ok(normalized.failures.every((failure) => failure.full_page_grab === false));
  assert.ok(normalized.non_executable_context.every((entry) => entry.actionable_repair_item === false));
});

test('Employer Brand Live Evidence Capture Failure Review Pack classifies blockers distinctly', () => {
  const pack = loadEmployerBrandLiveEvidenceCaptureFailureReviewPack({ fixtureRoot });
  const normalized = normalizeEmployerBrandLiveEvidenceCaptureFailureReviewPack(pack);

  assert.equal(normalized.summary.zero_match_locator_failure_count, 4);
  assert.equal(normalized.summary.login_or_sign_in_blocker_count, 1);
  assert.equal(normalized.summary.blocker_reason_counts.reviewed_locator_matches_zero_elements, 4);
  assert.equal(normalized.summary.blocker_reason_counts.login_required, 1);
  assert.equal(normalized.summary.recommended_next_action_counts.needs_operator_locator_repair, 4);
  assert.equal(normalized.summary.recommended_next_action_counts.needs_human_source_decision, 1);

  const linkedinFailure = normalized.failures.find((failure) => failure.blocker_reason === 'login_required');
  assert.equal(linkedinFailure.company, 'Symphony Talent');
  assert.equal(linkedinFailure.source_category, 'linkedin_presence');
  assert.equal(linkedinFailure.blocker_class, 'login_or_sign_in_blocker');
  assert.equal(linkedinFailure.recommended_next_action, 'needs_human_source_decision');
  assert.equal(linkedinFailure.operator_outcome_notes.operator_visual_review.decision, 'reject_capture_as_login_gate');
});

test('Employer Brand Live Evidence Capture Failure Review Pack preserves target context and leaves repairs null', () => {
  const pack = loadEmployerBrandLiveEvidenceCaptureFailureReviewPack({ fixtureRoot });
  const normalized = normalizeEmployerBrandLiveEvidenceCaptureFailureReviewPack(pack);

  for (const failure of normalized.failures) {
    assert.ok(failure.target_context.natural_language_target);
    assert.ok(failure.target_context.evidence_goal);
    assert.ok(failure.target_context.page_name);
    assert.ok(failure.target_context.expected_clip_count >= 1);
    assert.ok(failure.target_context.kilos_relevance.length >= 1);
    assert.ok(failure.reviewed_locator.selector || failure.reviewed_locator.xpath || failure.reviewed_locator.playwright_locator);
    assert.ok(failure.url_open_provenance.source_url_open_run_path);
    assert.equal(failure.url_open_provenance.read_only, true);
    assert.deepEqual(failure.repair, {
      proposed_selector: null,
      proposed_xpath: null,
      proposed_playwright_locator: null,
      refined_natural_language_target: null,
      replacement_url: null,
      repair_decision: null,
      repair_notes: null,
      reviewed_by: null,
    });
  }
});

test('Employer Brand Live Evidence Capture Failure Review Pack validation rejects fabricated repairs', () => {
  const pack = clone(loadEmployerBrandLiveEvidenceCaptureFailureReviewPack({ fixtureRoot }));
  pack.repair_queue.groups[0].failures[0].repair.proposed_selector = '.invented';
  assert.equal(validateEmployerBrandLiveEvidenceCaptureFailureReviewPack(pack).valid, false);
});
