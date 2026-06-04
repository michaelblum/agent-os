import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fsSync from 'node:fs';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  buildEmployerBrandLiveEvidenceLocatorReadiness,
  loadEmployerBrandLiveEvidenceLocatorReadiness,
  validateEmployerBrandLiveEvidenceLocatorReadiness,
} from '../../packages/toolkit/workbench/_reference/employer-brand/employer-brand-live-evidence-locator-readiness.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../..');
const fixtureRoot = path.join(
  repoRoot,
  'docs/design/fixtures/aos-artifacts/employer-brand-comparative-audit',
);
const schemaPath = path.join(repoRoot, 'shared/schemas/employer-brand-live-evidence-locator-readiness-v0.schema.json');
const readinessPath = path.join(fixtureRoot, 'live-evidence-locator-readiness.json');

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

test('Employer Brand Live Evidence Locator Readiness fixture validates and is generator-stable', async () => {
  const schemaValidation = validateSchema(schemaPath, readinessPath);
  assert.equal(schemaValidation.status, 0, `${schemaValidation.stdout}${schemaValidation.stderr}`);

  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'aos-employer-brand-live-evidence-locator-readiness-'));
  const out = path.join(tmp, 'live-evidence-locator-readiness.json');
  try {
    const result = spawnSync(
      process.execPath,
      ['scripts/employer-brand-live-evidence-locator-readiness.mjs', '--out', out],
      { cwd: repoRoot, encoding: 'utf8' },
    );
    assert.equal(result.status, 0, `${result.stdout}${result.stderr}`);
    assert.equal(await fs.readFile(out, 'utf8'), await fs.readFile(readinessPath, 'utf8'));
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
});

test('Employer Brand Live Evidence Locator Readiness uses reviewed plan as the source and excludes rejected targets', () => {
  const reviewedPlan = readJson(path.join(fixtureRoot, 'live-evidence-reviewed-target-plan.json'));
  const approvalPatch = readJson(path.join(fixtureRoot, 'live-evidence-target-approval-patch.json'));
  const readiness = loadEmployerBrandLiveEvidenceLocatorReadiness({ fixtureRoot });
  const rejectedIds = approvalPatch.decisions
    .filter((decision) => decision.decision === 'reject')
    .map((decision) => decision.target_id);

  assert.deepEqual(validateEmployerBrandLiveEvidenceLocatorReadiness(readiness), { valid: true, errors: [] });
  assert.equal(readiness.provenance.reviewed_plan_is_input_source, true);
  assert.equal(readiness.source_refs.reviewed_target_plan_id, reviewedPlan.id);
  assert.equal(readiness.source_refs.reviewed_target_plan_path, 'live-evidence-target-plan.reviewed.json');
  assert.equal(readiness.summary.source_target_count, 21);
  assert.equal(readiness.summary.excluded_rejected_count, 3);
  assert.equal(readiness.targets.length, reviewedPlan.targets.length);
  assert.equal(readiness.targets.some((target) => rejectedIds.includes(target.target_id)), false);
  assert.equal(readiness.targets.some((target) => target.readiness_state === 'rejected_excluded'), false);
});

test('Employer Brand Live Evidence Locator Readiness preserves nullable locator fields and consumes URL-open reachability', () => {
  const readiness = loadEmployerBrandLiveEvidenceLocatorReadiness({ fixtureRoot });

  assert.equal(readiness.summary.locator_ready_count, 0);
  assert.equal(readiness.summary.needs_locator_count, 16);
  assert.equal(readiness.summary.needs_human_target_review_count, 2);
  assert.equal(readiness.summary.url_not_checked_count, 0);
  assert.equal(readiness.targets.filter((target) => target.url_reachability === 'reachable').length, 5);
  assert.equal(readiness.targets.filter((target) => target.url_reachability === 'redirected').length, 2);
  assert.equal(readiness.targets.filter((target) => target.url_reachability === 'network_error').length, 9);
  assert.ok(readiness.targets.every((target) => Object.values(target.locator_placeholders).every((value) => value === null)));
});

test('Employer Brand Live Evidence Locator Readiness classifies blockers deterministically from review status and approval decision', () => {
  const readiness = loadEmployerBrandLiveEvidenceLocatorReadiness({ fixtureRoot });
  const approved = readiness.targets.find((target) => target.target_id === 'live-target:symphony-talent:careers-site');
  const draft = readiness.targets.find((target) => target.approval_decision === 'keep_draft');

  assert.equal(approved.review_status, 'approved');
  assert.equal(approved.approval_decision, 'approve');
  assert.equal(approved.readiness_state, 'needs_locator');
  assert.deepEqual(approved.blockers, ['locator_placeholders_unresolved']);
  assert.equal(draft.review_status, 'draft');
  assert.equal(draft.readiness_state, 'needs_human_target_review');
  assert.deepEqual(draft.blockers, ['target_review_status_not_approved', 'locator_placeholders_unresolved', 'url_reachability_safety_gate_blocked']);
});

test('Employer Brand Live Evidence Locator Readiness supports arbitrary n-company grouping and propagates KILOS and expected clip counts', () => {
  const reviewedPlan = readJson(path.join(fixtureRoot, 'live-evidence-reviewed-target-plan.json'));
  const approvalPatch = readJson(path.join(fixtureRoot, 'live-evidence-target-approval-patch.json'));
  const readiness = buildEmployerBrandLiveEvidenceLocatorReadiness({
    reviewedTargetPlan: {
      ...clone(reviewedPlan),
      targets: reviewedPlan.targets.filter((target) => target.company !== 'Radancy'),
      review_decision_summary: {
        ...reviewedPlan.review_decision_summary,
        total_targets: 14,
        rejected_count: 2,
      },
    },
    approvalPatch: {
      ...clone(approvalPatch),
      decisions: approvalPatch.decisions.filter((decision) => !decision.target_id.startsWith('live-target:radancy:')),
    },
    createdAt: '2026-05-08T00:00:00Z',
  });

  assert.deepEqual(readiness.summary.grouped_by_company, {
    'Symphony Talent': 6,
    Phenom: 6,
  });
  assert.equal(readiness.summary.source_target_count, 14);
  assert.equal(readiness.summary.excluded_rejected_count, 2);
  assert.equal(readiness.summary.expected_clip_count_for_included_targets, 13);
  const symphonyCareers = readiness.targets.find((target) => target.target_id === 'live-target:symphony-talent:careers-site');
  assert.deepEqual(symphonyCareers.kilos_relevance, ['impact', 'opportunity']);
  assert.equal(symphonyCareers.expected_clip_count, 2);
});

test('Employer Brand Live Evidence Locator Readiness keeps non-goal controls false and is wired into planning provenance', () => {
  const readiness = loadEmployerBrandLiveEvidenceLocatorReadiness({ fixtureRoot });
  const dataBundle = readJson(path.join(fixtureRoot, 'data-bundle.json'));
  const sources = readJson(path.join(fixtureRoot, 'sources.json'));
  const subject = readJson(path.join(fixtureRoot, 'subject.json'));

  assert.ok(Object.values(readiness.controls).every((value) => value === false));
  assert.doesNotThrow(() => readJson(path.join(fixtureRoot, 'live-evidence-target-plan.reviewed.json')));
  assert.equal(dataBundle.inputs.live_evidence_locator_readiness_path, 'live-evidence-locator-readiness.json');
  assert.equal(dataBundle.live_evidence_targets.locator_readiness_path, 'live-evidence-locator-readiness.json');
  assert.equal(dataBundle.live_evidence_targets.readiness_summary.needs_locator_count, 16);
  assert.equal(readiness.provenance.url_reachability_check_path, 'live-evidence-url-reachability-check.json');
  assert.equal(readiness.provenance.url_reachability_check_read_only_planning_evidence, true);
  assert.ok(readiness.targets.every((target) => target.provenance.source_url_reachability_check_path === 'live-evidence-url-reachability-check.json'));
  assert.equal(sources.live_evidence_locator_readiness.path, 'live-evidence-locator-readiness.json');
  assert.equal(sources.live_evidence_locator_readiness.reviewed_target_plan_path, 'live-evidence-target-plan.reviewed.json');
  assert.equal(sources.live_evidence_locator_readiness.url_reachability_check_path, 'live-evidence-url-reachability-check.json');
  assert.equal(sources.live_evidence_locator_readiness.url_not_checked_count, 0);
  assert.equal(sources.live_evidence_locator_readiness.url_reachability_checked_count, 16);
  assert.ok(subject.subject_references.some((item) => item.id === 'live-evidence-locator-readiness'));
  assert.equal(
    subject.subject_references.find((item) => item.id === 'live-evidence-locator-readiness').metadata.reviewed_target_plan_path,
    'live-evidence-target-plan.reviewed.json',
  );
  assert.equal(
    subject.subject_references.find((item) => item.id === 'live-evidence-locator-readiness').metadata.url_reachability_check_path,
    'live-evidence-url-reachability-check.json',
  );
  assert.equal(subject.metadata.live_evidence_locator_readiness_v0.path, 'live-evidence-locator-readiness.json');
  assert.equal(subject.metadata.live_evidence_locator_readiness_v0.url_reachability_check_path, 'live-evidence-url-reachability-check.json');
  assert.equal(subject.metadata.live_evidence_locator_readiness_v0.url_not_checked_count, 0);
});
