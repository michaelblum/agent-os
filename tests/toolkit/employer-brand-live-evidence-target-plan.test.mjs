import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  buildDraftEmployerBrandLiveEvidenceTargetPlanFromProject,
  loadEmployerBrandLiveEvidenceTargetPlan,
  normalizeEmployerBrandLiveEvidenceTargetPlan,
  validateEmployerBrandLiveEvidenceTargetPlan,
} from '../../packages/toolkit/workbench/employer-brand-live-evidence-target-plan.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../..');
const fixtureRoot = path.join(
  repoRoot,
  'docs/design/fixtures/aos-artifacts/employer-brand-comparative-audit',
);
const schemaPath = path.join(repoRoot, 'shared/schemas/employer-brand-live-evidence-target-plan-v0.schema.json');
const planPath = path.join(fixtureRoot, 'live-evidence-target-plan.json');
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
    notes: 'Synthetic fourth company for arbitrary-n live target plan coverage.',
  });
  return next;
}

test('Employer Brand Live Evidence Target Plan fixture validates and is generator-stable', async () => {
  const schemaValidation = validateSchema(schemaPath, planPath);
  assert.equal(schemaValidation.status, 0, `${schemaValidation.stdout}${schemaValidation.stderr}`);

  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'aos-employer-brand-live-target-plan-'));
  const out = path.join(tmp, 'live-evidence-target-plan.json');
  try {
    const result = spawnSync(
      process.execPath,
      ['scripts/employer-brand-live-evidence-target-plan.mjs', '--out', out],
      { cwd: repoRoot, encoding: 'utf8' },
    );
    assert.equal(result.status, 0, `${result.stdout}${result.stderr}`);
    assert.equal(await fs.readFile(out, 'utf8'), await fs.readFile(planPath, 'utf8'));
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
});

test('Employer Brand Live Evidence Target Plan records required human target fields without locators or execution authority', () => {
  const plan = loadEmployerBrandLiveEvidenceTargetPlan({ fixtureRoot });
  const normalized = normalizeEmployerBrandLiveEvidenceTargetPlan(plan);
  const validation = validateEmployerBrandLiveEvidenceTargetPlan(plan);

  assert.deepEqual(validation, { valid: true, errors: [] });
  assert.equal(normalized.expected_totals.company_count, 3);
  assert.equal(normalized.expected_totals.source_category_count, 7);
  assert.equal(normalized.expected_totals.target_count, 21);
  assert.equal(normalized.expected_totals.expected_clip_count, 21);
  assert.equal(normalized.summary.target_count, 21);
  assert.equal(normalized.summary.expected_clip_count, 21);
  assert.deepEqual([...new Set(normalized.targets.map((target) => target.company))], [
    'Symphony Talent',
    'Phenom',
    'Radancy',
  ]);
  assert.deepEqual([...new Set(normalized.targets.map((target) => target.source_category))], [
    'careers_site',
    'employer_brand_pages',
    'linkedin_presence',
    'review_platforms',
    'social_campaigns',
    'awards_recognition',
    'employee_stories',
  ]);
  assert.equal(normalized.summary.review_status_counts.human_review_required, 21);
  assert.ok(normalized.summary.kilos_dimensions.every((row) => row.target_count > 0));
  assert.equal(normalized.summary.grouped_by_company['company:symphony-talent'], 7);
  assert.equal(normalized.summary.grouped_by_source_category.careers_site, 3);
  assert.ok(Object.keys(normalized.summary.grouped_by_url_source_category).length >= 7);

  for (const target of normalized.targets) {
    for (const field of [
      'target_id',
      'company_id',
      'company',
      'company_role',
      'source_category',
      'page_name',
      'url',
      'target_element',
      'evidence_goal',
      'capture_type',
      'expected_clip_count',
      'acceptance_criteria',
      'review_status',
      'locator_placeholders',
      'notes',
    ]) {
      assert.notEqual(target[field], undefined, `${target.target_id} missing ${field}`);
    }
    assert.equal(target.review_status, 'human_review_required');
    assert.equal(target.expected_clip_count, 1);
    assert.ok(target.acceptance_criteria.length > 0);
    assert.ok(target.kilos_relevance.every((dimension) => ['kinship', 'impact', 'lifestyle', 'opportunity', 'status'].includes(dimension)));
    assert.deepEqual(target.locator_placeholders, {
      selector: null,
      xpath: null,
      playwright_locator: null,
      codegen_hint: null,
      crawl_discovery_notes: null,
      capture_script_slot: null,
    });
  }

  assert.deepEqual(normalized.controls, {
    full_page_grabs: false,
    autonomous_browsing_authorized: false,
    live_collection_authorized: false,
    report_renderer_authorized: false,
    export_execution_authorized: false,
    workflow_engine_authorized: false,
  });
  assert.equal(normalized.provenance.live_evidence_collected, false);
  assert.equal(normalized.provenance.selectors_resolved, false);
});

test('Employer Brand Live Evidence Target Plan builder supports arbitrary n-company projects', async () => {
  const project = addFourthCompany(await readJson(projectPath));
  const plan = buildDraftEmployerBrandLiveEvidenceTargetPlanFromProject(project, {
    createdAt: '2026-05-08T00:00:00Z',
  });
  const normalized = normalizeEmployerBrandLiveEvidenceTargetPlan(plan);

  assert.deepEqual(validateEmployerBrandLiveEvidenceTargetPlan(plan), { valid: true, errors: [] });
  assert.equal(normalized.expected_totals.company_count, 4);
  assert.equal(normalized.expected_totals.source_category_count, 7);
  assert.equal(normalized.expected_totals.target_count, 28);
  assert.equal(normalized.expected_totals.expected_clip_count, 28);
  assert.equal(normalized.summary.grouped_by_company['company:acme-talent'], 7);
  assert.equal(normalized.summary.grouped_by_source_category.review_platforms, 4);
  assert.ok(normalized.targets.some((target) => target.company === 'Acme Talent' && target.source_category === 'careers_site'));
});
