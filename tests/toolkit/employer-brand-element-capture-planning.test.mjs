import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  loadEmployerBrandElementCapturePlanningBundle,
  loadEmployerBrandElementCapturePlanningInputs,
  normalizeEmployerBrandElementCapturePlanningBundle,
  normalizeEmployerBrandElementClipManifest,
  validateEmployerBrandElementCapturePlanningBundle,
} from '../../packages/toolkit/workbench/employer-brand-element-capture-planning.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../..');
const fixtureRoot = path.join(
  repoRoot,
  'docs/design/fixtures/aos-artifacts/employer-brand-comparative-audit',
);
const planningSchemaPath = path.join(
  repoRoot,
  'shared/schemas/employer-brand-element-capture-planning-bundle-v0.schema.json',
);
const manifestSchemaPath = path.join(
  repoRoot,
  'shared/schemas/employer-brand-element-clip-manifest-v0.schema.json',
);
const planningBundlePath = path.join(fixtureRoot, 'source-artifacts/element-capture-planning-bundle.json');
const clipManifestPath = path.join(fixtureRoot, 'source-artifacts/element-clip-manifest.planned.json');
const populatedClipManifestPath = path.join(fixtureRoot, 'source-artifacts/element-clip-manifest.json');

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

async function readJson(file) {
  return JSON.parse(await fs.readFile(file, 'utf8'));
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function retargetForCompanies(inputs, companyNames) {
  const next = clone(inputs);
  const companies = companyNames.map((name, index) => ({
    company_ref_id: `company:${name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')}`,
    name,
    slug: name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, ''),
    role: index === 0 ? 'client' : 'competitor',
  }));
  for (const target of next.targetPlan.targets) {
    if ([
      'target:spa-company-deep-dive-cards',
      'target:spa-evidence-gallery-active-frames',
    ].includes(target.target_id)) {
      target.expected_clip_count = companies.length;
    }
  }
  next.targetPlan.expected_totals.expected_clip_count = next.targetPlan.targets
    .reduce((count, target) => count + target.expected_clip_count, 0);
  return { inputs: next, companies };
}

test('Employer Brand Element Capture Planning fixture and clip manifest validate and are generator-stable', async () => {
  const planningValidation = validateSchema(planningSchemaPath, planningBundlePath);
  const manifestValidation = validateSchema(manifestSchemaPath, clipManifestPath);
  assert.equal(planningValidation.status, 0, `${planningValidation.stdout}${planningValidation.stderr}`);
  assert.equal(manifestValidation.status, 0, `${manifestValidation.stdout}${manifestValidation.stderr}`);

  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'aos-employer-brand-element-planning-'));
  const out = path.join(tmp, 'planning.json');
  const manifestOut = path.join(tmp, 'manifest.json');
  try {
    const result = spawnSync(
      process.execPath,
      [
        'scripts/employer-brand-element-capture-planning-bundle.mjs',
        '--out',
        out,
        '--manifest-out',
        manifestOut,
      ],
      { cwd: repoRoot, encoding: 'utf8' },
    );
    assert.equal(result.status, 0, `${result.stdout}${result.stderr}`);
    assert.equal(await fs.readFile(out, 'utf8'), await fs.readFile(planningBundlePath, 'utf8'));
    assert.equal(await fs.readFile(manifestOut, 'utf8'), await fs.readFile(clipManifestPath, 'utf8'));
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
});

test('Employer Brand Element Capture Planning expands targets into deterministic work units with readiness and locator integrity', () => {
  const bundle = loadEmployerBrandElementCapturePlanningBundle({
    fixtureRoot,
    createdAt: '2026-05-08T00:00:00Z',
  });
  const validation = validateEmployerBrandElementCapturePlanningBundle(bundle);

  assert.deepEqual(validation, { valid: true, errors: [] });
  assert.equal(bundle.source_plan.target_count, 13);
  assert.equal(bundle.source_plan.expected_clip_count, 44);
  assert.equal(bundle.expansion.company_count, 13);
  assert.equal(bundle.expansion.work_unit_count, 37);
  assert.equal(bundle.expansion.expected_clip_count, 44);
  assert.equal(bundle.expansion.expected_clip_count_preserved, true);
  assert.equal(bundle.readiness.locator_ready_count, 16);
  assert.equal(bundle.readiness.blocked_count, 21);
  assert.ok(bundle.readiness.blockers.includes('pdf_crop_coordinates_unresolved'));
  assert.ok(bundle.readiness.blockers.includes('pptx_object_parser_needed'));
  assert.ok(bundle.readiness.blockers.includes('stable_spv5_selector_not_identified'));

  const matrix = bundle.work_units.find((unit) => unit.target_id === 'target:spa-kilos-matrix');
  assert.equal(matrix.locator_hints.selector, '#kilos-matrix');
  assert.equal(matrix.locator_hints.playwright_locator, "page.locator('#kilos-matrix')");
  assert.equal(matrix.readiness_state, 'locator_ready');

  const pdf = bundle.work_units.find((unit) => unit.target_id === 'target:pdf-kilos-top-themes-matrix');
  assert.equal(pdf.locator_hints.selector, null);
  assert.equal(pdf.locator_hints.playwright_locator, null);
  assert.deepEqual(pdf.blockers, ['pdf_crop_coordinates_unresolved', 'pdf_text_region_parser_needed']);

  const evidenceGallery = bundle.work_units.find((unit) => unit.target_id === 'target:spa-evidence-gallery-active-frames');
  assert.equal(evidenceGallery.locator_hints.selector, null);
  assert.deepEqual(evidenceGallery.blockers, ['stable_spv5_selector_not_identified']);

  const sanofiCard = bundle.work_units.find((unit) => unit.id === 'work-unit:spa-company-deep-dive-cards:sanofi');
  assert.equal(sanofiCard.company_ref.name, 'Sanofi');
  assert.equal(sanofiCard.expected_clip_count, 1);
  assert.equal(sanofiCard.locator_hints.selector, '#sanofi');
  assert.deepEqual(sanofiCard.kilos_relevance, ['kinship', 'impact', 'lifestyle', 'opportunity', 'status']);

  for (const key of [
    'live_browser_collection_authorized',
    'screenshot_generation_authorized',
    'element_clip_generation_authorized',
    'report_renderer_authorized',
    'export_execution_authorized',
    'workflow_engine_authorized',
    'full_page_grabs_authorized',
  ]) {
    assert.equal(bundle.controls[key], false);
  }
});

test('Employer Brand Element Capture Planning handles arbitrary n-company expansion when the source plan count changes', () => {
  const { inputs, companies } = retargetForCompanies(
    loadEmployerBrandElementCapturePlanningInputs({ fixtureRoot }),
    ['Acme Bio', 'Beta Labs', 'Gamma Health', 'Delta Pharma'],
  );
  const bundle = normalizeEmployerBrandElementCapturePlanningBundle({
    ...inputs,
    companies,
    createdAt: '2026-05-08T00:00:00Z',
  });
  const validation = validateEmployerBrandElementCapturePlanningBundle(bundle);

  assert.deepEqual(validation, { valid: true, errors: [] });
  assert.equal(bundle.expansion.company_count, 4);
  assert.equal(bundle.expansion.work_unit_count, 19);
  assert.equal(bundle.source_plan.expected_clip_count, 26);
  assert.equal(bundle.expansion.expected_clip_count, 26);
  assert.equal(bundle.expansion.expected_clip_count_preserved, true);
  assert.equal(
    bundle.work_units.filter((unit) => unit.target_id === 'target:spa-company-deep-dive-cards').length,
    4,
  );
  assert.equal(
    bundle.work_units.filter((unit) => unit.target_id === 'target:spa-evidence-gallery-active-frames').length,
    4,
  );
});

test('Employer Brand Element Clip Manifest skeleton carries planned slots but no actual captures', async () => {
  const planningBundle = await readJson(planningBundlePath);
  const manifest = normalizeEmployerBrandElementClipManifest({
    planningBundle,
    createdAt: '2026-05-08T00:00:00Z',
  });

  assert.deepEqual(manifest, await readJson(clipManifestPath));
  assert.equal(manifest.clips.length, 0);
  assert.equal(manifest.controls.contains_actual_captures, false);
  assert.equal(manifest.planned_slots.length, planningBundle.expansion.work_unit_count);
  assert.equal(manifest.expected.expected_clip_count, planningBundle.expansion.expected_clip_count);
  assert.ok(manifest.planned_slots.every((slot) => slot.clip_path === null));
  assert.ok(manifest.planned_slots.every((slot) => slot.text_extract_path === null));
  assert.ok(manifest.planned_slots.every((slot) => slot.acceptance_result.status === 'not_run'));
});

test('Employer Brand local SPv5 populated clip manifest captures only ready HTML work units', async () => {
  const planningBundle = await readJson(planningBundlePath);
  const manifest = await readJson(populatedClipManifestPath);
  const validation = validateSchema(manifestSchemaPath, populatedClipManifestPath);
  assert.equal(validation.status, 0, `${validation.stdout}${validation.stderr}`);

  const readySpv5Units = planningBundle.work_units.filter((unit) => (
    unit.readiness_state === 'locator_ready'
    && unit.source_artifact.id === 'source:spv5-html'
  ));
  const blockedUnits = planningBundle.work_units.filter((unit) => unit.readiness_state !== 'locator_ready');
  const clipIds = new Set(manifest.clips.map((clip) => clip.work_unit_id));
  const slotIds = new Set(manifest.planned_slots.map((slot) => slot.work_unit_id));

  assert.equal(manifest.status, 'captured_with_blockers');
  assert.equal(manifest.controls.contains_actual_captures, true);
  assert.equal(manifest.controls.local_spv5_html_only, true);
  assert.equal(manifest.controls.remote_web_collection_authorized, false);
  assert.equal(manifest.controls.pdf_capture_execution_authorized, false);
  assert.equal(manifest.controls.pptx_capture_execution_authorized, false);
  assert.equal(manifest.controls.full_page_grabs_authorized, false);
  assert.equal(manifest.expected.work_unit_count, planningBundle.expansion.work_unit_count);
  assert.equal(manifest.expected.expected_clip_count, planningBundle.expansion.expected_clip_count);
  assert.equal(manifest.expected.locator_ready_spv5_work_unit_count, readySpv5Units.length);
  assert.equal(manifest.expected.captured_work_unit_count, readySpv5Units.length);
  assert.equal(manifest.expected.blocked_work_unit_count, blockedUnits.length);
  assert.equal(manifest.clips.length, 16);
  assert.equal(manifest.planned_slots.length, planningBundle.work_units.length);
  assert.deepEqual([...clipIds].sort(), readySpv5Units.map((unit) => unit.id).sort());
  assert.equal(slotIds.size, planningBundle.work_units.length);

  for (const clip of manifest.clips) {
    const unit = planningBundle.work_units.find((candidate) => candidate.id === clip.work_unit_id);
    assert.ok(unit, `missing planning unit for ${clip.work_unit_id}`);
    assert.equal(clip.target_id, unit.target_id);
    assert.equal(clip.source_artifact.id, 'source:spv5-html');
    assert.equal(clip.acceptance_result.status, 'captured');
    assert.equal(clip.capture_metadata.full_page_grab, false);
    assert.notDeepEqual(
      [
        Math.round(clip.capture_metadata.bounding_box.width),
        Math.round(clip.capture_metadata.bounding_box.height),
      ],
      [
        clip.capture_metadata.viewport.width,
        clip.capture_metadata.viewport.height,
      ],
    );
    assert.ok(clip.capture_metadata.clip_bytes > 0);
    assert.deepEqual(clip.kilos_relevance, unit.kilos_relevance);
    assert.ok(Array.isArray(clip.citation_refs));
    await fs.access(path.join(fixtureRoot, clip.clip_path));
  }

  const textClips = manifest.clips.filter((clip) => clip.capture_type.includes('text_extract'));
  assert.equal(textClips.length, 1);
  assert.equal(textClips[0].work_unit_id, 'work-unit:spa-kilos-matrix');
  assert.match(textClips[0].text_extract_content, /KILOS Messaging Matrix/);
  await fs.access(path.join(fixtureRoot, textClips[0].text_extract_path));

  for (const unit of blockedUnits) {
    assert.equal(clipIds.has(unit.id), false);
    const slot = manifest.planned_slots.find((candidate) => candidate.work_unit_id === unit.id);
    assert.equal(slot.acceptance_result.status, 'not_run');
    assert.equal(slot.clip_path, null);
    assert.equal(slot.provenance.planned_only, true);
    assert.deepEqual(slot.kilos_relevance, unit.kilos_relevance);
  }
});

test('Employer Brand Element Capture Planning is discoverable as read-only artifact-bundle provenance', async () => {
  const subject = await readJson(path.join(fixtureRoot, 'subject.json'));
  const sources = await readJson(path.join(fixtureRoot, 'sources.json'));
  const report = subject.artifacts.find((artifact) => artifact.id === 'employer-brand-report');
  const planningFile = report.files.find((file) => file.role === 'element_capture_planning_bundle');
  const manifestFile = report.files.find((file) => file.role === 'element_clip_manifest');
  const acceptanceFile = report.files.find((file) => file.role === 'element_clip_acceptance_report');
  const planningRef = subject.subject_references.find((ref) => ref.id === 'employer-brand-element-capture-planning-bundle');
  const manifestRef = subject.subject_references.find((ref) => ref.id === 'employer-brand-element-clip-manifest');
  const acceptanceRef = subject.subject_references.find((ref) => ref.id === 'employer-brand-element-clip-acceptance-report');

  assert.equal(planningFile.path, 'source-artifacts/element-capture-planning-bundle.json');
  assert.equal(planningFile.schema, 'shared/schemas/employer-brand-element-capture-planning-bundle-v0.schema.json');
  assert.equal(planningFile.metadata.work_unit_count, 37);
  assert.equal(planningFile.metadata.element_clip_generation_authorized, false);
  assert.equal(manifestFile.path, 'source-artifacts/element-clip-manifest.json');
  assert.equal(manifestFile.schema, 'shared/schemas/employer-brand-element-clip-manifest-v0.schema.json');
  assert.equal(manifestFile.metadata.actual_clip_count, 16);
  assert.equal(manifestFile.metadata.blocked_work_unit_count, 21);
  assert.equal(manifestFile.metadata.planned_manifest_path, 'source-artifacts/element-clip-manifest.planned.json');

  assert.equal(planningRef.subject_type, 'aos.employer_brand_element_capture_planning_bundle');
  assert.equal(planningRef.metadata.read_only, true);
  assert.equal(planningRef.metadata.planned_only, true);
  assert.equal(manifestRef.subject_type, 'aos.employer_brand_element_clip_manifest');
  assert.equal(manifestRef.metadata.actual_clip_count, 16);
  assert.equal(manifestRef.metadata.planned_only, false);
  assert.equal(acceptanceFile.path, 'source-artifacts/element-clip-acceptance-report.json');
  assert.equal(acceptanceFile.schema, 'shared/schemas/employer-brand-element-clip-acceptance-report-v0.schema.json');
  assert.equal(acceptanceFile.metadata.status, 'accepted_with_blockers');
  assert.equal(acceptanceFile.metadata.failed_count, 0);
  assert.equal(acceptanceFile.metadata.report_renderer_authorized, false);
  assert.equal(acceptanceRef.subject_type, 'aos.employer_brand_element_clip_acceptance_report');
  assert.equal(acceptanceRef.metadata.verifier_only, true);

  assert.equal(sources.element_capture_planning_bundle.path, 'source-artifacts/element-capture-planning-bundle.json');
  assert.equal(sources.element_capture_planning_bundle.clip_manifest_path, 'source-artifacts/element-clip-manifest.json');
  assert.equal(sources.element_capture_planning_bundle.planned_clip_manifest_path, 'source-artifacts/element-clip-manifest.planned.json');
  assert.equal(sources.element_capture_planning_bundle.actual_clip_count, 16);
  assert.equal(sources.element_capture_planning_bundle.acceptance_report_path, 'source-artifacts/element-clip-acceptance-report.json');
  assert.equal(sources.element_capture_planning_bundle.acceptance_failed_count, 0);
  assert.equal(sources.element_capture_planning_bundle.element_clip_generation_authorized, true);
});
