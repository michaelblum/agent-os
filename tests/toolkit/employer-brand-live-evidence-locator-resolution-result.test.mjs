import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fsSync from 'node:fs';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  buildEmployerBrandLiveEvidenceLocatorResolutionResult,
  loadEmployerBrandLiveEvidenceLocatorResolutionResult,
  resolveLocatorFromDurableUrlOpenMetadata,
  validateEmployerBrandLiveEvidenceLocatorResolutionResult,
} from '../../packages/toolkit/workbench/employer-brand-live-evidence-locator-resolution-result.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../..');
const fixtureRoot = path.join(
  repoRoot,
  'docs/design/fixtures/aos-artifacts/employer-brand-comparative-audit',
);
const schemaPath = path.join(repoRoot, 'shared/schemas/employer-brand-live-evidence-locator-resolution-result-v0.schema.json');
const resultPath = path.join(fixtureRoot, 'live-evidence-locator-resolution-result.json');

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

function recomputeUrlOpenSummary(run) {
  const statuses = [
    'reachable',
    'redirected',
    'login_required',
    'paywall',
    'captcha',
    'consent_required',
    'network_error',
    'timeout',
    'safety_gate_blocked',
    'not_run',
  ];
  for (const status of statuses) {
    run.summary[`${status}_count`] = run.results.filter((result) => result.status === status).length;
  }
  run.summary.supervised_locator_work_unit_count = run.results.length;
  run.summary.executable_target_count = run.results.filter((result) => result.executable).length;
  run.summary.opened_count = run.results.filter((result) => result.opened).length;
  run.summary.same_domain_confirmed_count = run.results.filter((result) => result.same_domain === true).length;
  run.summary.same_domain_blocked_count = run.results.filter((result) => result.status === 'safety_gate_blocked' && result.same_domain === false).length;
  run.summary.non_executable_preserved_count = run.results.filter((result) => !result.executable).length;
  return run;
}

function openRunWithResult(index, patch) {
  const run = clone(readJson(path.join(fixtureRoot, 'live-evidence-url-open-run.planned.json')));
  run.status = 'completed_with_blockers';
  run.controls.bounded_target_url_open_authorized = true;
  run.controls.dry_run_only = false;
  run.results[index] = {
    ...run.results[index],
    opened: true,
    checked_at: '2026-05-08T00:00:00Z',
    final_url: run.results[index].original_url,
    same_domain: true,
    ...patch,
  };
  return recomputeUrlOpenSummary(run);
}

test('Employer Brand Live Evidence Locator Resolution Result fixture validates and is generator-stable', async () => {
  const schemaValidation = validateSchema(schemaPath, resultPath);
  assert.equal(schemaValidation.status, 0, `${schemaValidation.stdout}${schemaValidation.stderr}`);

  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'aos-employer-brand-live-evidence-locator-resolution-'));
  const out = path.join(tmp, 'live-evidence-locator-resolution-result.json');
  try {
    const result = spawnSync(
      process.execPath,
      ['scripts/employer-brand-live-evidence-locator-resolution-result.mjs', '--execute', '--out', out],
      { cwd: repoRoot, encoding: 'utf8' },
    );
    assert.equal(result.status, 0, `${result.stdout}${result.stderr}`);
    assert.equal(await fs.readFile(out, 'utf8'), await fs.readFile(resultPath, 'utf8'));
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
});

test('Employer Brand Live Evidence Locator Resolution fixture attempts only eligible executed URL-open targets', () => {
  const result = loadEmployerBrandLiveEvidenceLocatorResolutionResult({ fixtureRoot });
  const attempted = result.results.filter((item) => item.attempted);
  const blocked = result.results.filter((item) => item.resolution_status === 'blocked');

  assert.deepEqual(validateEmployerBrandLiveEvidenceLocatorResolutionResult(result), { valid: true, errors: [] });
  assert.equal(result.summary.result_count, 18);
  assert.equal(result.summary.attempted_count, 7);
  assert.equal(result.summary.locator_ready_count, 0);
  assert.equal(result.summary.eligible_target_count, 7);
  assert.equal(result.summary.ambiguous_count, 7);
  assert.equal(result.summary.blocked_count, 11);
  assert.equal(result.summary.needs_human_locator_review_count, 2);
  assert.equal(result.summary.not_run_count, 0);
  assert.equal(result.summary.rejected_exclusion_count, 3);
  assert.ok(result.rejected_exclusions.every((item) => item.resolution_status === 'not_run'));
  assert.deepEqual(attempted.map((item) => item.target_id), [
    'live-target:symphony-talent:careers-site',
    'live-target:symphony-talent:linkedin-presence',
    'live-target:phenom:careers-site',
    'live-target:radancy:careers-site',
    'live-target:radancy:linkedin-presence',
    'live-target:radancy:social-campaigns',
    'live-target:radancy:awards-recognition',
  ]);
  assert.ok(attempted.every((item) => item.resolution_status === 'ambiguous'));
  assert.ok(attempted.every((item) => item.selector_candidates.length === 1));
  assert.ok(attempted.every((item) => item.selector_candidates[0].selector === null));
  assert.ok(attempted.every((item) => item.selector_candidates[0].playwright_locator === null));
  assert.ok(attempted.every((item) => item.preferred_selector === null));
  assert.ok(attempted.every((item) => item.playwright_locator_candidate === null));
  assert.ok(attempted.every((item) => item.confidence === 0.1));
  assert.ok(attempted.every((item) => item.resolved_at === '2026-05-08T00:00:00Z'));
  assert.ok(attempted.every((item) => item.reviewed_by === 'gdi-supervised-locator-resolution-v0'));
  assert.ok(blocked.every((item) => item.attempted === false));
  assert.ok(blocked.every((item) => item.resolved_at === null));
});

test('Employer Brand Live Evidence Locator Resolution attempts only reachable same-domain URL-open targets', async () => {
  const supervisedLocatorPlan = readJson(path.join(fixtureRoot, 'live-evidence-supervised-locator-plan.json'));
  const urlOpenRun = openRunWithResult(0, {
    status: 'reachable',
    final_url: 'https://www.symphonytalent.com/',
    same_domain: true,
    title: 'Symphony Talent',
  });
  let callCount = 0;

  const result = await buildEmployerBrandLiveEvidenceLocatorResolutionResult({
    supervisedLocatorPlan,
    urlOpenRun,
    execute: true,
    resolvedAt: '2026-05-08T00:00:00Z',
    reviewedBy: 'fixture-operator',
    resolveLocator: async ({ workUnit, urlOpenResult }) => {
      callCount += 1;
      assert.equal(workUnit.target_id, 'live-target:symphony-talent:careers-site');
      assert.equal(urlOpenResult.status, 'reachable');
      return {
        selector_candidates: [{
          selector: '[data-testid="careers-hero"]',
          playwright_locator: 'page.locator("[data-testid=\\"careers-hero\\"]")',
          selector_type: 'css',
          confidence: 0.92,
          rationale: 'Stable data-testid supplied by supervised fixture resolver.',
          provenance: 'mock_supervised_locator_resolution',
        }],
        preferred_selector: '[data-testid="careers-hero"]',
        playwright_locator_candidate: 'page.locator("[data-testid=\\"careers-hero\\"]")',
        confidence: 0.92,
        locator_provenance: 'mock_supervised_locator_resolution',
      };
    },
  });

  const resolved = result.results.find((item) => item.target_id === 'live-target:symphony-talent:careers-site');
  assert.equal(callCount, 1);
  assert.equal(result.summary.eligible_target_count, 1);
  assert.equal(result.summary.attempted_count, 1);
  assert.equal(result.summary.locator_ready_count, 1);
  assert.equal(resolved.resolution_status, 'resolved');
  assert.equal(resolved.preferred_selector, '[data-testid="careers-hero"]');
  assert.equal(resolved.reviewed_by, 'fixture-operator');
  assert.deepEqual(validateEmployerBrandLiveEvidenceLocatorResolutionResult(result), { valid: true, errors: [] });
});

test('Employer Brand Live Evidence Locator Resolution accepts reviewed-safe same-domain redirects', async () => {
  const supervisedLocatorPlan = readJson(path.join(fixtureRoot, 'live-evidence-supervised-locator-plan.json'));
  const urlOpenRun = openRunWithResult(1, {
    status: 'redirected',
    final_url: 'https://www.symphonytalent.com/employer-brand/',
    same_domain: true,
    redirect_chain: [{
      from_url: 'https://www.symphonytalent.com/employer-branding/',
      to_url: 'https://www.symphonytalent.com/employer-brand/',
      status_code: 301,
    }],
  });

  const result = await buildEmployerBrandLiveEvidenceLocatorResolutionResult({
    supervisedLocatorPlan,
    urlOpenRun,
    execute: true,
    resolvedAt: '2026-05-08T00:00:00Z',
    resolveLocator: async () => ({
      selector_candidates: [{
        selector: 'main [data-proof="evp"]',
        playwright_locator: 'page.locator("main [data-proof=\\"evp\\"]")',
        selector_type: 'css',
        confidence: 0.86,
        rationale: 'Same-domain redirect preserved the approved target host.',
        provenance: 'mock_supervised_locator_resolution',
      }],
      preferred_selector: 'main [data-proof="evp"]',
      playwright_locator_candidate: 'page.locator("main [data-proof=\\"evp\\"]")',
      confidence: 0.86,
      locator_provenance: 'mock_supervised_locator_resolution',
    }),
  });

  const redirected = result.results.find((item) => item.target_id === 'live-target:symphony-talent:employer-brand-pages');
  assert.equal(redirected.resolution_status, 'resolved');
  assert.equal(redirected.same_domain, true);
  assert.equal(result.summary.locator_ready_count, 1);
});

test('Employer Brand Live Evidence Locator Resolution preserves blocked and cross-domain URL-open statuses', async () => {
  const supervisedLocatorPlan = readJson(path.join(fixtureRoot, 'live-evidence-supervised-locator-plan.json'));
  const urlOpenRun = openRunWithResult(2, {
    status: 'login_required',
    blocker_reason: 'authentication required',
    final_url: 'https://www.linkedin.com/company/symphony-talent/',
    same_domain: true,
  });
  urlOpenRun.results[3] = {
    ...urlOpenRun.results[3],
    opened: true,
    status: 'safety_gate_blocked',
    final_url: 'https://unexpected.example/campaigns',
    same_domain: false,
    checked_at: '2026-05-08T00:00:00Z',
    blocker_reason: 'Redirect left approved target domain',
  };
  urlOpenRun.results[4] = {
    ...urlOpenRun.results[4],
    opened: true,
    status: 'paywall',
    final_url: 'https://www.symphonytalent.com/news',
    same_domain: true,
    checked_at: '2026-05-08T00:00:00Z',
    blocker_reason: 'subscription required',
  };
  urlOpenRun.results[8] = {
    ...urlOpenRun.results[8],
    opened: true,
    status: 'captcha',
    final_url: 'https://www.linkedin.com/company/phenom/',
    same_domain: true,
    checked_at: '2026-05-08T00:00:00Z',
    blocker_reason: 'human verification required',
  };
  recomputeUrlOpenSummary(urlOpenRun);
  let callCount = 0;

  const result = await buildEmployerBrandLiveEvidenceLocatorResolutionResult({
    supervisedLocatorPlan,
    urlOpenRun,
    execute: true,
    resolveLocator: async () => {
      callCount += 1;
      return {};
    },
  });

  assert.equal(callCount, 0);
  assert.equal(result.results.find((item) => item.target_id === 'live-target:symphony-talent:linkedin-presence').resolution_status, 'blocked');
  assert.equal(result.results.find((item) => item.target_id === 'live-target:symphony-talent:social-campaigns').resolution_status, 'blocked');
  assert.equal(result.results.find((item) => item.target_id === 'live-target:symphony-talent:awards-recognition').blocker_reason, 'subscription required');
  assert.equal(result.results.find((item) => item.target_id === 'live-target:phenom:linkedin-presence').blocker_reason, 'human verification required');
  assert.equal(result.summary.blocked_count, 6);
  assert.equal(result.summary.needs_human_locator_review_count, 2);
  assert.equal(result.summary.locator_ready_count, 0);
});

test('Employer Brand Live Evidence Locator Resolution keeps ambiguous and fake selector outputs unresolved', async () => {
  const supervisedLocatorPlan = readJson(path.join(fixtureRoot, 'live-evidence-supervised-locator-plan.json'));
  const ambiguousRun = openRunWithResult(0, {
    status: 'reachable',
    final_url: 'https://www.symphonytalent.com/',
    same_domain: true,
  });
  const fakeRun = openRunWithResult(0, {
    status: 'reachable',
    final_url: 'https://www.symphonytalent.com/',
    same_domain: true,
  });

  const ambiguous = await buildEmployerBrandLiveEvidenceLocatorResolutionResult({
    supervisedLocatorPlan,
    urlOpenRun: ambiguousRun,
    execute: true,
    resolveLocator: async () => ({
      selector_candidates: [{
        selector: 'main section',
        playwright_locator: null,
        selector_type: 'css',
        confidence: 0.52,
        rationale: 'Multiple plausible sections matched the requested element.',
        provenance: 'mock_supervised_locator_resolution',
      }],
      confidence: 0.52,
      blocker_reason: 'target_element_ambiguous_without_guessing',
    }),
  });
  const fake = await buildEmployerBrandLiveEvidenceLocatorResolutionResult({
    supervisedLocatorPlan,
    urlOpenRun: fakeRun,
    execute: true,
    resolveLocator: async () => ({
      selector_candidates: [{
        selector: '.known-real-candidate',
        playwright_locator: null,
        selector_type: 'css',
        confidence: 0.91,
        rationale: 'Candidate returned by resolver.',
        provenance: 'mock_supervised_locator_resolution',
      }],
      preferred_selector: '.invented-selector-not-in-candidates',
      confidence: 0.91,
    }),
  });

  const ambiguousResult = ambiguous.results[0];
  const fakeResult = fake.results[0];
  assert.equal(ambiguousResult.resolution_status, 'ambiguous');
  assert.equal(ambiguousResult.preferred_selector, null);
  assert.equal(ambiguousResult.resolved_at, null);
  assert.equal(fakeResult.resolution_status, 'ambiguous');
  assert.equal(fakeResult.preferred_selector, null);
  assert.equal(fakeResult.resolved_at, null);
  assert.equal(fake.summary.locator_ready_count, 0);
});

test('Employer Brand Live Evidence Locator Resolution does not attempt planned or not-run URL-open fixture entries', async () => {
  const supervisedLocatorPlan = readJson(path.join(fixtureRoot, 'live-evidence-supervised-locator-plan.json'));
  const plannedUrlOpenRun = readJson(path.join(fixtureRoot, 'live-evidence-url-open-run.planned.json'));
  let callCount = 0;

  const result = await buildEmployerBrandLiveEvidenceLocatorResolutionResult({
    supervisedLocatorPlan,
    urlOpenRun: plannedUrlOpenRun,
    execute: true,
    resolvedAt: '2026-05-08T00:00:00Z',
    resolveLocator: async () => {
      callCount += 1;
      return resolveLocatorFromDurableUrlOpenMetadata();
    },
  });

  assert.equal(callCount, 0);
  assert.equal(result.summary.eligible_target_count, 0);
  assert.equal(result.summary.attempted_count, 0);
  assert.equal(result.summary.not_run_count, 16);
  assert.equal(result.summary.blocked_count, 2);
  assert.equal(result.summary.needs_human_locator_review_count, 2);
  assert.ok(result.results.every((item) => item.resolved_at === null));
  assert.deepEqual(validateEmployerBrandLiveEvidenceLocatorResolutionResult(result), { valid: true, errors: [] });
});

test('Employer Brand Live Evidence Locator Resolution keeps non-goal controls false', () => {
  const result = loadEmployerBrandLiveEvidenceLocatorResolutionResult({ fixtureRoot });

  assert.equal(result.controls.screenshots_authorized, false);
  assert.equal(result.controls.element_clips_authorized, false);
  assert.equal(result.controls.text_extraction_authorized, false);
  assert.equal(result.controls.report_renderer_authorized, false);
  assert.equal(result.controls.export_execution_authorized, false);
  assert.equal(result.controls.workflow_engine_authorized, false);
  assert.equal(result.controls.full_page_grabs_authorized, false);
  assert.equal(result.controls.autonomous_crawl_authorized, false);
  assert.equal(result.controls.login_bypass_authorized, false);
  assert.equal(result.controls.paywall_bypass_authorized, false);
  assert.equal(result.controls.captcha_bypass_authorized, false);
  assert.equal(result.controls.consent_bypass_authorized, false);
});
