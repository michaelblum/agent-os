import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs/promises';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../..');
const fixtureRoot = path.join(
  repoRoot,
  'docs/design/fixtures/aos-artifacts/employer-brand-comparative-audit',
);
const targetPlanSchemaPath = path.join(
  repoRoot,
  'shared/schemas/employer-brand-source-artifact-target-plan-v0.schema.json',
);
const dataBundleSchemaPath = path.join(
  repoRoot,
  'shared/schemas/employer-brand-source-artifact-data-bundle-v0.schema.json',
);
const targetPlanPath = path.join(fixtureRoot, 'source-artifacts/target-plan.json');
const dataBundlePath = path.join(fixtureRoot, 'source-artifacts/data-bundle.json');

function validate(schemaPath, instancePath) {
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
    for error in errors[:8]:
        print(error.message)
    sys.exit(1)
`,
      schemaPath,
      instancePath,
    ],
    { encoding: 'utf8' },
  );
}

async function readJson(file) {
  return JSON.parse(await fs.readFile(file, 'utf8'));
}

test('Employer Brand source artifact target plan validates precise element targets only', async () => {
  const validation = validate(targetPlanSchemaPath, targetPlanPath);
  assert.equal(validation.status, 0, `${validation.stdout}${validation.stderr}`);

  const plan = await readJson(targetPlanPath);
  assert.equal(plan.type, 'aos.employer_brand_source_artifact_target_plan');
  assert.equal(plan.capture_scope.capture_unit, 'page_element');
  assert.equal(plan.capture_scope.full_page_grabs, false);
  assert.ok(plan.capture_scope.non_goals.includes('full_page_grabs'));
  assert.ok(plan.capture_scope.non_goals.includes('report_renderer'));
  assert.equal(plan.controls.full_page_capture_authorized, false);
  assert.equal(plan.controls.report_renderer_authorized, false);
  assert.equal(plan.controls.export_execution_authorized, false);
  assert.equal(plan.controls.workflow_engine_authorized, false);

  assert.deepEqual(plan.source_artifact_refs.map((ref) => ref.path), [
    '/Users/Michael/Documents/DownloadedDecks/KILOS comp audit template.pptx',
    '/Users/Michael/Documents/DownloadedDecks/KILOS comp audit template.pdf',
    '/Users/Michael/Desktop/SPv5.html',
  ]);
  assert.equal(plan.expected_totals.target_count, plan.targets.length);
  assert.equal(
    plan.expected_totals.expected_clip_count,
    plan.targets.reduce((count, target) => count + target.expected_clip_count, 0),
  );
  assert.equal(plan.expected_totals.target_count, 13);
  assert.equal(plan.expected_totals.expected_clip_count, 44);

  for (const target of plan.targets) {
    assert.doesNotMatch(target.page_element_target.natural_language_target, /full[- ]page grab/i);
    assert.equal(target.locator_placeholders.selector, null);
    assert.equal(target.locator_placeholders.xpath, null);
    assert.equal(target.locator_placeholders.playwright_locator, null);
    assert.equal(target.locator_placeholders.codegen_hint, null);
    assert.ok(target.acceptance_criteria.length >= 1);
  }

  const repeatedCompanyTarget = plan.targets.find((target) => target.target_id === 'target:spa-company-deep-dive-cards');
  assert.ok(repeatedCompanyTarget);
  assert.equal(repeatedCompanyTarget.expected_clip_count, 13);
  assert.match(repeatedCompanyTarget.notes, /arbitrary-n company/);
});

test('Employer Brand source artifact data bundle validates and links the target plan before report artifacts', async () => {
  const validation = validate(dataBundleSchemaPath, dataBundlePath);
  assert.equal(validation.status, 0, `${validation.stdout}${validation.stderr}`);

  const bundle = await readJson(dataBundlePath);
  const plan = await readJson(path.join(fixtureRoot, bundle.target_plan.path));

  assert.equal(bundle.type, 'aos.employer_brand_source_artifact_data_bundle');
  assert.equal(bundle.status, 'data_bundle_ready');
  assert.equal(bundle.target_plan.schema, 'shared/schemas/employer-brand-source-artifact-target-plan-v0.schema.json');
  assert.equal(bundle.target_plan.target_count, plan.expected_totals.target_count);
  assert.equal(bundle.target_plan.expected_clip_count, plan.expected_totals.expected_clip_count);
  assert.equal(bundle.target_plan.full_page_grabs, false);
  assert.equal(bundle.target_plan.selectors_ready, false);
  assert.equal(bundle.target_plan.xpath_ready, false);
  assert.equal(bundle.target_plan.playwright_ready, false);
  assert.equal(bundle.target_plan.codegen_ready, false);
  assert.equal(bundle.controls.report_renderer_authorized, false);
  assert.equal(bundle.controls.report_artifact_authorized, false);
  assert.equal(bundle.controls.export_execution_authorized, false);
  assert.equal(bundle.controls.remote_web_collection_authorized, false);
  assert.equal(bundle.controls.workflow_engine_authorized, false);
  assert.ok(bundle.provenance.non_goals.includes('report_renderer'));
  assert.ok(bundle.provenance.non_goals.includes('full_page_grabs'));
  assert.deepEqual(bundle.source_artifacts.map((artifact) => artifact.path), [
    '/Users/Michael/Documents/DownloadedDecks/KILOS comp audit template.pptx',
    '/Users/Michael/Documents/DownloadedDecks/KILOS comp audit template.pdf',
    '/Users/Michael/Desktop/SPv5.html',
  ]);
});
