import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fsSync from 'node:fs';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  buildEmployerBrandLiveEvidenceUrlOpenRun,
  loadEmployerBrandLiveEvidenceUrlOpenRun,
  validateEmployerBrandLiveEvidenceUrlOpenRun,
} from '../../packages/toolkit/workbench/employer-brand-live-evidence-url-open-run.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../..');
const fixtureRoot = path.join(
  repoRoot,
  'docs/design/fixtures/aos-artifacts/employer-brand-comparative-audit',
);
const schemaPath = path.join(repoRoot, 'shared/schemas/employer-brand-live-evidence-url-open-run-v0.schema.json');
const runPath = path.join(fixtureRoot, 'live-evidence-url-open-run.json');
const plannedRunPath = path.join(fixtureRoot, 'live-evidence-url-open-run.planned.json');

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

function subsetPlan(targetIds) {
  const plan = readJson(path.join(fixtureRoot, 'live-evidence-supervised-locator-plan.json'));
  const workUnits = plan.work_units.filter((unit) => targetIds.includes(unit.target_id));
  const executable = workUnits.filter((unit) => unit.executable);
  const blocked = workUnits.filter((unit) => unit.blocked);
  return {
    ...clone(plan),
    work_units: workUnits,
    summary: {
      ...plan.summary,
      readiness_input_count: workUnits.length,
      executable_locator_unit_count: executable.length,
      blocked_non_executable_count: blocked.length,
      needs_human_target_review_count: blocked.length,
      expected_clip_count_for_executable_units: executable.reduce((sum, unit) => sum + unit.expected_clip_count, 0),
      grouped_by_company: {},
      executable_grouped_by_company: {},
    },
  };
}

function find(run, targetId) {
  return run.results.find((result) => result.target_id === targetId);
}

function allKeys(value, keys = []) {
  if (Array.isArray(value)) {
    for (const item of value) allKeys(item, keys);
  } else if (value && typeof value === 'object') {
    for (const [key, child] of Object.entries(value)) {
      keys.push(key);
      allKeys(child, keys);
    }
  }
  return keys;
}

test('Employer Brand Live Evidence URL Open Run executed fixture validates', async () => {
  const schemaValidation = validateSchema(schemaPath, runPath);
  assert.equal(schemaValidation.status, 0, `${schemaValidation.stdout}${schemaValidation.stderr}`);

  const run = loadEmployerBrandLiveEvidenceUrlOpenRun({ fixtureRoot });
  assert.deepEqual(validateEmployerBrandLiveEvidenceUrlOpenRun(run), { valid: true, errors: [] });
  assert.equal(run.status, 'completed_with_blockers');
  assert.equal(run.controls.dry_run_only, false);
  assert.equal(run.summary.opened_count, 16);
  assert.equal(run.summary.not_run_count, 0);
  assert.equal(run.summary.non_executable_preserved_count, 2);
});

test('Employer Brand Live Evidence URL Open Run preserves the planned not-run fixture and generator stability', async () => {
  const schemaValidation = validateSchema(schemaPath, plannedRunPath);
  assert.equal(schemaValidation.status, 0, `${schemaValidation.stdout}${schemaValidation.stderr}`);
  const plannedRun = readJson(plannedRunPath);
  assert.equal(plannedRun.status, 'not_run_fixture');
  assert.equal(plannedRun.controls.dry_run_only, true);
  assert.equal(plannedRun.controls.bounded_target_url_open_authorized, false);

  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'aos-employer-brand-url-open-run-'));
  const out = path.join(tmp, 'live-evidence-url-open-run.json');
  try {
    const result = spawnSync(
      process.execPath,
      ['scripts/employer-brand-live-evidence-url-open-run.mjs', '--out', out],
      { cwd: repoRoot, encoding: 'utf8' },
    );
    assert.equal(result.status, 0, `${result.stdout}${result.stderr}`);
    assert.equal(await fs.readFile(out, 'utf8'), await fs.readFile(plannedRunPath, 'utf8'));
    assert.match(result.stdout, /network execution skipped/);
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
});

test('Employer Brand Live Evidence URL Open Run only executes approved executable targets', async () => {
  const plan = subsetPlan([
    'live-target:symphony-talent:careers-site',
    'live-target:symphony-talent:employee-stories',
  ]);
  const opened = [];
  const run = await buildEmployerBrandLiveEvidenceUrlOpenRun({
    supervisedLocatorPlan: plan,
    execute: true,
    checkedAt: '2026-05-08T12:00:00Z',
    navigate: async (url) => {
      opened.push(url);
      return { final_url: url, http_status: 200, title: 'Careers' };
    },
  });

  assert.deepEqual(opened, ['https://www.symphonytalent.com/']);
  assert.equal(find(run, 'live-target:symphony-talent:careers-site').status, 'reachable');
  assert.equal(find(run, 'live-target:symphony-talent:employee-stories').status, 'safety_gate_blocked');
  assert.equal(run.summary.executable_target_count, 1);
  assert.equal(run.summary.non_executable_preserved_count, 1);
  assert.deepEqual(validateEmployerBrandLiveEvidenceUrlOpenRun(run), { valid: true, errors: [] });
});

test('Employer Brand Live Evidence URL Open Run models same-domain redirect handling', async () => {
  const plan = subsetPlan(['live-target:symphony-talent:careers-site']);
  const run = await buildEmployerBrandLiveEvidenceUrlOpenRun({
    supervisedLocatorPlan: plan,
    execute: true,
    checkedAt: '2026-05-08T12:00:00Z',
    navigate: async (url) => ({
      final_url: 'https://www.symphonytalent.com/en/',
      redirect_chain: [{ from_url: url, to_url: 'https://www.symphonytalent.com/en/', status_code: 301 }],
      http_status: 200,
      title: 'Symphony Talent',
    }),
  });
  const result = find(run, 'live-target:symphony-talent:careers-site');

  assert.equal(result.status, 'redirected');
  assert.equal(result.same_domain, true);
  assert.deepEqual(result.redirect_chain, [
    { from_url: 'https://www.symphonytalent.com/', to_url: 'https://www.symphonytalent.com/en/', status_code: 301 },
  ]);
  assert.equal(result.title, 'Symphony Talent');
});

test('Employer Brand Live Evidence URL Open Run blocks cross-domain redirects at the safety gate', async () => {
  const plan = subsetPlan(['live-target:symphony-talent:careers-site']);
  const run = await buildEmployerBrandLiveEvidenceUrlOpenRun({
    supervisedLocatorPlan: plan,
    execute: true,
    checkedAt: '2026-05-08T12:00:00Z',
    navigate: async (url) => ({
      final_url: 'https://example.com/outside',
      redirect_chain: [{ from_url: url, to_url: 'https://example.com/outside', status_code: 302 }],
      http_status: 302,
    }),
  });
  const result = find(run, 'live-target:symphony-talent:careers-site');

  assert.equal(result.status, 'safety_gate_blocked');
  assert.equal(result.same_domain, false);
  assert.match(result.blocker_reason, /Redirect left approved target domain/);
});

test('Employer Brand Live Evidence URL Open Run models timeout, network, and blocker statuses', async () => {
  const plan = subsetPlan([
    'live-target:symphony-talent:careers-site',
    'live-target:symphony-talent:employer-brand-pages',
    'live-target:symphony-talent:linkedin-presence',
    'live-target:phenom:careers-site',
    'live-target:radancy:careers-site',
    'live-target:radancy:employer-brand-pages',
  ]);
  const outcomes = new Map([
    ['https://www.symphonytalent.com/', () => {
      const error = new Error('navigation timeout');
      error.code = 'TimeoutError';
      throw error;
    }],
    ['https://www.symphonytalent.com/careers/culture', () => {
      throw new Error('DNS lookup failed');
    }],
    ['https://www.linkedin.com/company/symphony-talent/', () => ({
      final_url: 'https://www.linkedin.com/company/symphony-talent/',
      http_status: 401,
      title: 'Sign in',
    })],
    ['https://www.phenom.com/', () => ({
      final_url: 'https://www.phenom.com/',
      http_status: 200,
      title: 'Subscribe to continue',
    })],
    ['https://www.radancy.com/en/', () => ({
      final_url: 'https://www.radancy.com/en/',
      http_status: 200,
      title: 'Verify you are human',
    })],
    ['https://www.radancy.com/careers/culture', () => ({
      final_url: 'https://www.radancy.com/careers/culture',
      http_status: 200,
      title: 'Cookie consent required',
    })],
  ]);
  const run = await buildEmployerBrandLiveEvidenceUrlOpenRun({
    supervisedLocatorPlan: plan,
    execute: true,
    checkedAt: '2026-05-08T12:00:00Z',
    navigate: async (url) => outcomes.get(url)(),
  });

  assert.equal(find(run, 'live-target:symphony-talent:careers-site').status, 'timeout');
  assert.equal(find(run, 'live-target:symphony-talent:employer-brand-pages').status, 'network_error');
  assert.equal(find(run, 'live-target:symphony-talent:linkedin-presence').status, 'login_required');
  assert.equal(find(run, 'live-target:phenom:careers-site').status, 'paywall');
  assert.equal(find(run, 'live-target:radancy:careers-site').status, 'captcha');
  assert.equal(find(run, 'live-target:radancy:employer-brand-pages').status, 'consent_required');
});

test('Employer Brand Live Evidence URL Open Run preserves rejected exclusions separately from results', () => {
  const run = loadEmployerBrandLiveEvidenceUrlOpenRun({ fixtureRoot });
  const rejectedIds = readJson(path.join(fixtureRoot, 'live-evidence-target-approval-patch.json')).decisions
    .filter((decision) => decision.decision === 'reject')
    .map((decision) => decision.target_id);

  assert.deepEqual(run.rejected_exclusions.map((entry) => entry.target_id), rejectedIds);
  assert.equal(run.results.some((result) => rejectedIds.includes(result.target_id)), false);
  assert.equal(run.summary.rejected_exclusion_count, 3);
});

test('Employer Brand Live Evidence URL Open Run does not populate locator, codegen, capture, report, export, or workflow fields', async () => {
  const plan = subsetPlan(['live-target:symphony-talent:careers-site']);
  const run = await buildEmployerBrandLiveEvidenceUrlOpenRun({
    supervisedLocatorPlan: plan,
    execute: true,
    checkedAt: '2026-05-08T12:00:00Z',
    navigate: async (url) => ({ final_url: url, http_status: 200, title: 'Careers' }),
  });
  const forbiddenKeys = new Set([
    'selector',
    'xpath',
    'playwright_locator',
    'codegen_trace_path',
    'screenshot_path',
    'clip_path',
    'capture_path',
    'report_path',
    'export_path',
    'workflow_id',
    'full_page_grab_path',
    'extracted_text',
  ]);
  const keys = allKeys(run);

  assert.equal(keys.some((key) => forbiddenKeys.has(key)), false);
  assert.equal(run.controls.locator_resolution_authorized, false);
  assert.equal(run.controls.locator_codegen_executed, false);
  assert.equal(run.controls.element_identification_authorized, false);
  assert.equal(run.controls.screenshot_capture_authorized, false);
  assert.equal(run.controls.clip_generation_authorized, false);
  assert.equal(run.controls.full_page_grabs_authorized, false);
  assert.equal(run.controls.report_renderer_authorized, false);
  assert.equal(run.controls.export_execution_authorized, false);
  assert.equal(run.controls.workflow_engine_authorized, false);
});
