import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fsSync from 'node:fs';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  applyEmployerBrandLiveEvidenceHumanLocatorApprovalPatch,
  loadEmployerBrandLiveEvidenceHumanLocatorApprovalPatch,
  validateEmployerBrandLiveEvidenceHumanLocatorApprovalPatch,
} from '../../packages/toolkit/workbench/_reference/employer-brand/employer-brand-live-evidence-human-locator-approval-patch.js';
import {
  validateEmployerBrandLiveEvidenceLocatorReadiness,
} from '../../packages/toolkit/workbench/_reference/employer-brand/employer-brand-live-evidence-locator-readiness.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../..');
const fixtureRoot = path.join(repoRoot, 'docs/design/fixtures/aos-artifacts/employer-brand-comparative-audit');
const patchPath = path.join(fixtureRoot, 'live-evidence-human-locator-approval-patch.json');
const readinessPath = path.join(fixtureRoot, 'live-evidence-locator-readiness.reviewed.json');
const patchSchemaPath = path.join(repoRoot, 'shared/schemas/employer-brand-live-evidence-human-locator-approval-patch-v0.schema.json');
const readinessSchemaPath = path.join(repoRoot, 'shared/schemas/employer-brand-live-evidence-locator-readiness-v0.schema.json');

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

test('Employer Brand Human Locator Approval Patch fixture validates and is generator-stable', async () => {
  assert.equal(validateSchema(patchSchemaPath, patchPath).status, 0);
  assert.equal(validateSchema(readinessSchemaPath, readinessPath).status, 0);

  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'aos-human-locator-approval-patch-'));
  const patchOut = path.join(tmp, 'live-evidence-human-locator-approval-patch.json');
  const readinessOut = path.join(tmp, 'live-evidence-locator-readiness.reviewed.json');
  try {
    const result = spawnSync(
      process.execPath,
      [
        'scripts/employer-brand-live-evidence-human-locator-approval-patch.mjs',
        '--patch-out',
        patchOut,
        '--readiness-out',
        readinessOut,
      ],
      { cwd: repoRoot, encoding: 'utf8' },
    );
    assert.equal(result.status, 0, `${result.stdout}${result.stderr}`);
    assert.equal(await fs.readFile(patchOut, 'utf8'), await fs.readFile(patchPath, 'utf8'));
    assert.equal(await fs.readFile(readinessOut, 'utf8'), await fs.readFile(readinessPath, 'utf8'));
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
});

test('Employer Brand Human Locator Approval Patch supports all reviewed operator decisions', () => {
  const patch = loadEmployerBrandLiveEvidenceHumanLocatorApprovalPatch({ fixtureRoot });
  assert.deepEqual(
    [...new Set(patch.decisions.map((decision) => decision.decision))].sort(),
    [
      'approve_selector',
      'edit_selector',
      'keep_draft',
      'mark_blocked',
      'provide_playwright_locator',
      'provide_xpath',
      'refine_natural_language_target',
      'reject_target',
    ].sort(),
  );
  assert.ok(Object.values(patch.controls).every((value) => value === false));
});

test('Employer Brand Human Locator Approval Patch validates target and work-unit identity and rejects fake or empty approvals', () => {
  const reviewPack = readJson(path.join(fixtureRoot, 'live-evidence-human-locator-review-pack.json'));
  const patch = loadEmployerBrandLiveEvidenceHumanLocatorApprovalPatch({ fixtureRoot });
  assert.deepEqual(validateEmployerBrandLiveEvidenceHumanLocatorApprovalPatch(patch, reviewPack), { valid: true, errors: [] });

  const emptyApproval = clone(patch);
  emptyApproval.decisions[0].locator.selector = '';
  assert.equal(validateEmployerBrandLiveEvidenceHumanLocatorApprovalPatch(emptyApproval, reviewPack).valid, false);

  const fakeTarget = clone(patch);
  fakeTarget.decisions[0].target_id = 'live-target:fake';
  assert.equal(validateEmployerBrandLiveEvidenceHumanLocatorApprovalPatch(fakeTarget, reviewPack).valid, false);

  const wrongWorkUnit = clone(patch);
  wrongWorkUnit.decisions[0].work_unit_id = 'live-locator-work-unit:wrong';
  assert.equal(validateEmployerBrandLiveEvidenceHumanLocatorApprovalPatch(wrongWorkUnit, reviewPack).valid, false);

  const nonGoalControl = clone(patch);
  nonGoalControl.controls.url_opening = true;
  assert.equal(validateEmployerBrandLiveEvidenceHumanLocatorApprovalPatch(nonGoalControl, reviewPack).valid, false);
});

test('Employer Brand Human Locator Approval Patch is the only promotion path for locator_ready', () => {
  const reviewPack = readJson(path.join(fixtureRoot, 'live-evidence-human-locator-review-pack.json'));
  const patch = loadEmployerBrandLiveEvidenceHumanLocatorApprovalPatch({ fixtureRoot });
  const baseReadiness = readJson(path.join(fixtureRoot, 'live-evidence-locator-readiness.json'));
  const derived = applyEmployerBrandLiveEvidenceHumanLocatorApprovalPatch(baseReadiness, patch, {
    reviewPackInput: reviewPack,
    derivedAt: '2026-05-08T00:00:00Z',
  });

  assert.deepEqual(validateEmployerBrandLiveEvidenceLocatorReadiness(derived), { valid: true, errors: [] });
  assert.equal(baseReadiness.summary.locator_ready_count, 0);
  assert.ok(baseReadiness.targets.every((target) => Object.values(target.locator_placeholders).every((value) => value === null)));
  assert.equal(derived.summary.locator_ready_count, 4);
  assert.equal(derived.summary.needs_locator_count, 11);
  assert.equal(derived.summary.needs_human_locator_review_count, 1);
  assert.equal(derived.summary.blocked_count, 1);
  assert.equal(derived.summary.rejected_count, 1);
  assert.equal(derived.summary.expected_ready_clip_count, 5);
  assert.equal(derived.targets.some((target) => target.target_id === 'live-target:radancy:linkedin-presence'), false);
  assert.ok(derived.targets.filter((target) => target.readiness_state === 'locator_ready').every((target) => (
    target.provenance.source_human_locator_approval_patch_path === 'live-evidence-human-locator-approval-patch.json'
      && ['approve_selector', 'edit_selector', 'provide_xpath', 'provide_playwright_locator'].includes(target.provenance.human_locator_decision)
  )));
});

test('Employer Brand Human Locator Approval Patch refuses unconfirmed candidate self-promotion', () => {
  const reviewed = readJson(readinessPath);
  const machinePromoted = clone(reviewed);
  const target = machinePromoted.targets.find((item) => item.target_id === 'live-target:radancy:social-campaigns');
  target.readiness_state = 'locator_ready';
  target.locator_placeholders.selector = '.machine-candidate-only';
  target.provenance.source_human_locator_approval_patch_path = null;
  target.provenance.human_locator_decision = null;
  assert.equal(validateEmployerBrandLiveEvidenceLocatorReadiness(machinePromoted).valid, false);
});
