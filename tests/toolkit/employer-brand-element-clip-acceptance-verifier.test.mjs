import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  buildEmployerBrandElementClipAcceptanceReport,
  loadEmployerBrandElementClipAcceptanceReport,
  validateEmployerBrandElementClipAcceptanceReport,
} from '../../packages/toolkit/workbench/_reference/employer-brand/employer-brand-element-clip-acceptance-verifier.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../..');
const fixtureRoot = path.join(
  repoRoot,
  'docs/design/fixtures/aos-artifacts/employer-brand-comparative-audit',
);
const schemaPath = path.join(
  repoRoot,
  'shared/schemas/employer-brand-element-clip-acceptance-report-v0.schema.json',
);
const reportPath = path.join(fixtureRoot, 'source-artifacts/element-clip-acceptance-report.json');
const planningBundlePath = path.join(fixtureRoot, 'source-artifacts/element-capture-planning-bundle.json');
const clipManifestPath = path.join(fixtureRoot, 'source-artifacts/element-clip-manifest.json');
const plannedClipManifestPath = path.join(fixtureRoot, 'source-artifacts/element-clip-manifest.planned.json');

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

test('Employer Brand Element Clip Acceptance report fixture validates and is generator-stable', async () => {
  const schemaValidation = validateSchema(schemaPath, reportPath);
  assert.equal(schemaValidation.status, 0, `${schemaValidation.stdout}${schemaValidation.stderr}`);

  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'aos-employer-brand-element-clip-acceptance-'));
  const out = path.join(tmp, 'report.json');
  try {
    const result = spawnSync(
      process.execPath,
      [
        'scripts/employer-brand-element-clip-acceptance-report.mjs',
        '--out',
        out,
      ],
      { cwd: repoRoot, encoding: 'utf8' },
    );
    assert.equal(result.status, 0, `${result.stdout}${result.stderr}`);
    assert.equal(await fs.readFile(out, 'utf8'), await fs.readFile(reportPath, 'utf8'));
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
});

test('Employer Brand Element Clip Acceptance accepts populated local SPv5 manifest with preserved blocked slots', async () => {
  const report = loadEmployerBrandElementClipAcceptanceReport({
    fixtureRoot,
    createdAt: '2026-05-08T00:00:00Z',
  });
  const validation = validateEmployerBrandElementClipAcceptanceReport(report);

  assert.deepEqual(validation, { valid: true, errors: [] });
  assert.deepEqual(report.summary, {
    target_count: 13,
    work_unit_count: 37,
    expected_clip_count: 44,
    captured_count: 16,
    blocked_count: 21,
    failed_count: 0,
    not_run_count: 0,
    total_result_count: 37,
    accepted: true,
    manifest_count_checks_passed: true,
  });
  assert.equal(report.status, 'accepted_with_blockers');
  assert.equal(report.results.filter((result) => result.status === 'captured').length, 16);
  assert.equal(report.results.filter((result) => result.status === 'blocked').length, 21);
  assert.ok(report.results.some((result) => result.source_artifact_kind === 'pdf' && result.status === 'blocked'));
  assert.ok(report.results.some((result) => result.source_artifact_kind === 'pptx' && result.status === 'blocked'));
  assert.ok(report.results.some((result) => result.target_id === 'target:spa-evidence-gallery-active-frames' && result.status === 'blocked'));
  assert.ok(report.results.every((result) => result.checks.every((check) => check.status !== 'fail')));
  assert.ok(report.manifest_count_checks.every((check) => check.status === 'pass'));

  const matrix = report.results.find((result) => result.work_unit_id === 'work-unit:spa-kilos-matrix');
  assert.equal(matrix.status, 'captured');
  assert.equal(matrix.checks.find((check) => check.name === 'text_extract_present').status, 'pass');
  assert.equal(matrix.checks.find((check) => check.name === 'image_dimensions_available').status, 'pass');
  assert.equal(matrix.checks.find((check) => check.name === 'full_page_grab_false').status, 'pass');

  for (const key of [
    'capture_execution_authorized',
    'live_browser_collection_authorized',
    'remote_web_collection_authorized',
    'pdf_capture_execution_authorized',
    'pptx_capture_execution_authorized',
    'report_renderer_authorized',
    'export_execution_authorized',
    'workflow_engine_authorized',
    'full_page_grabs_authorized',
  ]) {
    assert.equal(report.controls[key], false);
  }
  assert.equal(report.provenance.no_capture_performed, true);
  assert.equal(report.provenance.no_report_rendering_performed, true);
});

test('Employer Brand Element Clip Acceptance detects missing and invalid clip assets in memory/temp fixtures', async () => {
  const planningBundle = await readJson(planningBundlePath);
  const manifest = await readJson(clipManifestPath);
  const plannedManifest = await readJson(plannedClipManifestPath);

  const missingManifest = clone(manifest);
  missingManifest.clips[0].clip_path = 'source-artifacts/element-clips/spv5/shared/missing.png';
  const missingReport = buildEmployerBrandElementClipAcceptanceReport({
    planningBundle,
    clipManifest: missingManifest,
    plannedClipManifest: plannedManifest,
    fixtureRoot,
    createdAt: '2026-05-08T00:00:00Z',
  });
  assert.equal(missingReport.status, 'not_accepted');
  assert.ok(missingReport.summary.failed_count >= 1);
  assert.equal(missingReport.results.find((result) => result.work_unit_id === missingManifest.clips[0].work_unit_id).status, 'failed');
  assert.equal(
    missingReport.results
      .find((result) => result.work_unit_id === missingManifest.clips[0].work_unit_id)
      .checks.find((check) => check.name === 'clip_asset_exists')
      .status,
    'fail',
  );

  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'aos-employer-brand-invalid-clip-'));
  try {
    await fs.cp(fixtureRoot, tmp, { recursive: true });
    const invalidManifest = clone(manifest);
    invalidManifest.clips[0].clip_path = 'source-artifacts/element-clips/spv5/shared/empty.png';
    await fs.writeFile(path.join(tmp, invalidManifest.clips[0].clip_path), '');
    const invalidReport = buildEmployerBrandElementClipAcceptanceReport({
      planningBundle,
      clipManifest: invalidManifest,
      plannedClipManifest: plannedManifest,
      fixtureRoot: tmp,
      createdAt: '2026-05-08T00:00:00Z',
    });
    const invalidResult = invalidReport.results.find((result) => result.work_unit_id === invalidManifest.clips[0].work_unit_id);
    assert.equal(invalidReport.status, 'not_accepted');
    assert.equal(invalidResult.status, 'failed');
    assert.equal(invalidResult.checks.find((check) => check.name === 'clip_asset_non_empty').status, 'fail');
    assert.equal(invalidResult.checks.find((check) => check.name === 'image_dimensions_available').status, 'fail');
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
});

test('Employer Brand Element Clip Acceptance detects missing required text extracts and not-run ready units', async () => {
  const planningBundle = await readJson(planningBundlePath);
  const manifest = await readJson(clipManifestPath);
  const plannedManifest = await readJson(plannedClipManifestPath);

  const missingTextManifest = clone(manifest);
  const textClip = missingTextManifest.clips.find((clip) => clip.work_unit_id === 'work-unit:spa-kilos-matrix');
  textClip.text_extract_path = null;
  textClip.text_extract_content = null;
  const missingTextReport = buildEmployerBrandElementClipAcceptanceReport({
    planningBundle,
    clipManifest: missingTextManifest,
    plannedClipManifest: plannedManifest,
    fixtureRoot,
    createdAt: '2026-05-08T00:00:00Z',
  });
  const matrix = missingTextReport.results.find((result) => result.work_unit_id === 'work-unit:spa-kilos-matrix');
  assert.equal(missingTextReport.status, 'not_accepted');
  assert.equal(matrix.status, 'failed');
  assert.equal(matrix.checks.find((check) => check.name === 'text_extract_present').status, 'fail');

  const plannedOnlyReport = buildEmployerBrandElementClipAcceptanceReport({
    planningBundle,
    clipManifest: plannedManifest,
    plannedClipManifest: plannedManifest,
    fixtureRoot,
    createdAt: '2026-05-08T00:00:00Z',
  });
  assert.equal(plannedOnlyReport.status, 'not_accepted');
  assert.equal(plannedOnlyReport.summary.captured_count, 0);
  assert.equal(plannedOnlyReport.summary.not_run_count, 16);
  assert.equal(plannedOnlyReport.summary.blocked_count, 21);
  assert.ok(plannedOnlyReport.results.some((result) => result.status === 'not_run'));
});

test('Employer Brand Element Clip Acceptance verifier path is read-only and does not include capture/render execution hooks', async () => {
  const source = await fs.readFile(
    path.join(repoRoot, 'packages/toolkit/workbench/_reference/employer-brand/employer-brand-element-clip-acceptance-verifier.js'),
    'utf8',
  );
  assert.equal(source.includes('playwright'), false);
  assert.equal(source.includes('spawn'), false);
  assert.equal(source.includes('employer-brand-element-capture-executor'), false);

  const report = await readJson(reportPath);
  assert.equal(report.controls.verifier_only, true);
  assert.equal(report.controls.capture_execution_authorized, false);
  assert.equal(report.controls.report_renderer_authorized, false);
  assert.ok(report.non_goal_flags.includes('new_captures'));
  assert.ok(report.non_goal_flags.includes('report_renderer'));
});
