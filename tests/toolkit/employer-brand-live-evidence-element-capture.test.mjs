import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  checkEmployerBrandPlaywrightBrowserReadiness,
  executeEmployerBrandReviewedLiveElementCapture,
  captureEmployerBrandLiveEvidenceSlotsWithNodeApi,
  smokeEmployerBrandLiveEvidenceSlotCaptureRunner,
  validateEmployerBrandLiveEvidenceElementClipManifest,
  verifyEmployerBrandRepairedLiveEvidenceElementClipManifestObjective,
  verifyEmployerBrandLiveEvidenceElementClipManifestObjective,
} from '../../packages/toolkit/workbench/_reference/employer-brand/employer-brand-live-evidence-element-capture.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../..');
const fixtureRoot = path.join(
  repoRoot,
  'docs/design/fixtures/aos-artifacts/employer-brand-comparative-audit',
);
const capturePlanPath = path.join(fixtureRoot, 'live-evidence-reviewed-locator-capture-plan.json');
const schemaPath = path.join(repoRoot, 'shared/schemas/employer-brand-live-evidence-element-clip-manifest-v0.schema.json');
const liveManifestPath = path.join(fixtureRoot, 'source-artifacts/live-evidence-element-clip-manifest.json');

const tinyPng = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAFgwJ/lUH6JwAAAABJRU5ErkJggg==',
  'base64',
);

function fakeSmokePlaywrightModule() {
  let browserClosed = false;
  const locator = {
    count: async () => 1,
    first() {
      return this;
    },
    innerText: async () => 'Local runner smoke target Element clip and text extract fixture.',
    screenshot: async ({ path: screenshotPath }) => {
      await fs.writeFile(screenshotPath, tinyPng);
    },
  };
  return {
    chromium: {
      launch: async () => ({
        newPage: async () => ({
          setContent: async () => {},
          locator: () => locator,
        }),
        close: async () => {
          browserClosed = true;
        },
      }),
    },
    get browserClosed() {
      return browserClosed;
    },
  };
}

function fakeBrowserReadinessPlaywrightModule({ executablePath = '/tmp/ms-playwright/chromium_headless_shell-999/chrome-headless-shell', launchError = null } = {}) {
  let browserClosed = false;
  return {
    chromium: {
      executablePath: () => executablePath,
      launch: async () => {
        if (launchError) throw launchError;
        return {
          newPage: async () => ({
            close: async () => {},
          }),
          close: async () => {
            browserClosed = true;
          },
        };
      },
    },
    get browserClosed() {
      return browserClosed;
    },
  };
}

function fakeCapturePlaywrightModule() {
  let browserClosed = false;
  let currentUrl = 'about:blank';
  const operations = [];
  const element = {
    count: async () => 1,
    first() {
      return this;
    },
    nth() {
      return this;
    },
    waitFor: async () => {
      operations.push('waitFor');
    },
    scrollIntoViewIfNeeded: async () => {
      operations.push('scrollIntoViewIfNeeded');
    },
    isVisible: async () => {
      operations.push('isVisible');
      return true;
    },
    boundingBox: async () => ({ x: 10, y: 20, width: 300, height: 120 }),
    innerText: async () => 'Fixture capture headline with useful text.',
    textContent: async () => 'Fixture capture headline with useful text.',
    locator: () => ({
      evaluateAll: async () => ['https://example.com/citation'],
    }),
    screenshot: async ({ path: screenshotPath }) => {
      await fs.writeFile(screenshotPath, tinyPng);
    },
  };
  return {
    chromium: {
      launch: async () => ({
        newPage: async () => ({
          goto: async (url) => {
            operations.push('goto');
            currentUrl = url;
          },
          waitForLoadState: async () => {},
          setViewportSize: async () => {
            operations.push('setViewportSize');
          },
          locator: (selector) => {
            if (selector === 'body') return { innerText: async () => 'Fixture body text.' };
            if (selector === 'section#fixture-target') return element;
            return { count: async () => 0 };
          },
          url: () => currentUrl,
          title: async () => 'Fixture target',
        }),
        close: async () => {
          browserClosed = true;
        },
      }),
    },
    get browserClosed() {
      return browserClosed;
    },
    get operations() {
      return operations;
    },
  };
}

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

test('Reviewed live element capture requires the explicit execution gate', async () => {
  const plan = await readJson(capturePlanPath);
  await assert.rejects(
    executeEmployerBrandReviewedLiveElementCapture(plan, {
      fixtureRoot,
      captureBackend: async () => ({ status: 'captured', current_url: 'https://www.example.com/', slot_results: [] }),
    }),
    /Refusing live capture without an approved execution gate/,
  );
});

test('Reviewed live element capture builds a scoped manifest from injectable capture results', async () => {
  const plan = await readJson(capturePlanPath);
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'aos-live-element-capture-'));
  try {
    const manifest = await executeEmployerBrandReviewedLiveElementCapture(plan, {
      fixtureRoot: tmp,
      capturedAt: '2026-05-08T00:00:00Z',
      executionGate: 'execute-reviewed-live-element-capture-v0',
      captureBackend: async ({ unit, slots }) => {
        for (const slot of slots) {
          await fs.mkdir(path.dirname(slot.clip_absolute_path), { recursive: true });
          await fs.writeFile(slot.clip_absolute_path, tinyPng);
        }
        return {
          status: 'captured',
          blocker_reason: null,
          current_url: unit.final_url,
          title: `${unit.company} fixture`,
          match_count: unit.expected_clip_count,
          slot_results: slots.map((slot) => ({
            slot_id: slot.slot_id,
            status: 'captured',
            text: `${unit.company} ${unit.source_category} text`,
            citation_refs: [unit.final_url],
            bounding_box: { x: 10, y: 20, width: 300, height: 120 },
          })),
        };
      },
    });

    assert.deepEqual(validateEmployerBrandLiveEvidenceElementClipManifest(manifest), { valid: true, errors: [] });
    assert.equal(manifest.summary.executable_unit_count, 4);
    assert.equal(manifest.summary.planned_output_slot_count, 5);
    assert.equal(manifest.summary.captured_slot_count, 5);
    assert.equal(manifest.summary.blocked_not_run_count, 14);
    assert.equal(manifest.summary.full_page_grab_count, 0);
    assert.equal(manifest.summary.text_extract_required_count, 5);
    assert.equal(manifest.summary.text_extract_present_count, 5);
    assert.equal(manifest.acceptance.count_reconciliation_passed, true);
    assert.equal(manifest.entries.filter((entry) => entry.status === 'captured').length, 5);
    assert.equal(manifest.entries.filter((entry) => entry.status === 'blocked_not_run').length, 14);
    assert.ok(manifest.entries.every((entry) => entry.full_page_grab === false));
    assert.ok(manifest.entries.filter((entry) => entry.status === 'captured').every((entry) => entry.locator_provenance));
    assert.ok(manifest.entries.filter((entry) => entry.status === 'captured').every((entry) => entry.kilos_relevance.length > 0));
    assert.deepEqual(verifyEmployerBrandLiveEvidenceElementClipManifestObjective(manifest, { fixtureRoot: tmp }), {
      status: 'passed',
      passed: true,
      diagnostics: [],
      summary: manifest.summary,
    });

    const manifestPath = path.join(tmp, 'source-artifacts/live-evidence-element-clip-manifest.json');
    await fs.mkdir(path.dirname(manifestPath), { recursive: true });
    await fs.writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
    const schemaValidation = validateSchema(schemaPath, manifestPath);
    assert.equal(schemaValidation.status, 0, `${schemaValidation.stdout}${schemaValidation.stderr}`);
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
});

test('Live evidence slot capture runner local fixture smoke captures element clip and text', async () => {
  const playwrightModule = fakeSmokePlaywrightModule();
  const result = await smokeEmployerBrandLiveEvidenceSlotCaptureRunner({
    timeoutMs: 10_000,
    playwrightModule,
  });

  assert.equal(result.status, 0, `${result.stdout}${result.stderr}`);
  assert.equal(playwrightModule.browserClosed, true);
  assert.equal(result.runtime_metadata.runner_type, 'playwright_node_api');
  assert.equal(result.smoke.match_count, 1);
  assert.ok(result.smoke.clip_bytes > 0);
  assert.match(result.smoke.text, /Local runner smoke target/);
  assert.equal(result.smoke.text_extracted, true);
  assert.equal(result.smoke.browser_closed, true);
  assert.equal(result.smoke.full_page_grab, false);
  assert.ok(result.runtime_metadata.completed_phases.includes('runner_preflight'));
  assert.ok(result.runtime_metadata.completed_phases.includes('browser_readiness'));
  assert.ok(result.runtime_metadata.completed_phases.includes('browser_launch'));
  assert.ok(result.runtime_metadata.completed_phases.includes('page_navigation'));
  assert.ok(result.runtime_metadata.completed_phases.includes('locator_evaluation'));
  assert.ok(result.runtime_metadata.completed_phases.includes('element_screenshot'));
  assert.ok(result.runtime_metadata.completed_phases.includes('text_extraction'));
  assert.ok(result.runtime_metadata.completed_phases.includes('browser_close'));
});

test('Live evidence Node API slot runner captures an injected local element without run-code', async () => {
  const playwrightModule = fakeCapturePlaywrightModule();
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'aos-live-evidence-node-runner-'));
  try {
    const clipPath = path.join(tmp, 'fixture-target.png');
    const result = await captureEmployerBrandLiveEvidenceSlotsWithNodeApi({
      playwrightModule,
      targetUrl: 'data:text/html,<section id="fixture-target">Fixture capture headline</section>',
      timeoutMs: 10_000,
      viewport: { width: 800, height: 600 },
      input: {
        locator_kind: 'selector',
        locator_value: 'section#fixture-target',
        expected_clip_count: 1,
        timeout_ms: 10_000,
        viewport: { width: 800, height: 600 },
        slots: [
          {
            slot_id: 'fixture-slot:1',
            ordinal: 1,
            clip_absolute_path: clipPath,
          },
        ],
      },
    });

    assert.equal(result.status, 'captured');
    assert.equal(playwrightModule.browserClosed, true);
    assert.equal(result.match_count, 1);
    assert.equal(result.full_page_grab, false);
    assert.match(result.slot_results[0].text, /Fixture capture headline/);
    assert.deepEqual(result.slot_results[0].citation_refs, ['https://example.com/citation']);
    assert.ok((await fs.stat(clipPath)).size > 0);
    assert.equal(result.runtime_metadata.runner_type, 'playwright_node_api');
    assert.ok(result.runtime_metadata.completed_phases.includes('runner_preflight'));
    assert.ok(result.runtime_metadata.completed_phases.includes('browser_readiness'));
    assert.ok(result.runtime_metadata.completed_phases.includes('browser_launch'));
    assert.ok(result.runtime_metadata.completed_phases.includes('page_navigation'));
    assert.ok(result.runtime_metadata.completed_phases.includes('locator_evaluation'));
    assert.ok(result.runtime_metadata.completed_phases.includes('element_screenshot'));
    assert.ok(result.runtime_metadata.completed_phases.includes('text_extraction'));
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
});

test('Live evidence Node API slot runner applies visibility preconditions before visibility check', async () => {
  const playwrightModule = fakeCapturePlaywrightModule();
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'aos-live-evidence-preconditions-'));
  try {
    const clipPath = path.join(tmp, 'fixture-target.png');
    const result = await captureEmployerBrandLiveEvidenceSlotsWithNodeApi({
      playwrightModule,
      targetUrl: 'data:text/html,<section id="fixture-target">Fixture capture headline</section>',
      timeoutMs: 10_000,
      viewport: { width: 800, height: 600 },
      input: {
        locator_kind: 'selector',
        locator_value: 'section#fixture-target',
        expected_clip_count: 1,
        timeout_ms: 10_000,
        viewport: { width: 800, height: 600 },
        visibility_precondition: {
          capture_precondition: 'Wait, then scroll before visibility check.',
          wait_condition: 'page.locator("section#fixture-target").waitFor({ state: "visible" }) after page navigation settles',
          scroll_strategy: 'Use locator.scrollIntoViewIfNeeded() on section#fixture-target after page load, then re-check visibility before capture.',
          viewport_hint: '1024x768',
        },
        slots: [
          {
            slot_id: 'fixture-slot:1',
            ordinal: 1,
            clip_absolute_path: clipPath,
          },
        ],
      },
    });

    assert.equal(result.status, 'captured');
    assert.deepEqual(
      playwrightModule.operations.filter((operation) => [
        'setViewportSize',
        'goto',
        'waitFor',
        'scrollIntoViewIfNeeded',
        'isVisible',
      ].includes(operation)),
      ['setViewportSize', 'goto', 'waitFor', 'scrollIntoViewIfNeeded', 'isVisible'],
    );
    assert.ok(result.runtime_metadata.completed_phases.includes('visibility_viewport_precondition'));
    assert.ok(result.runtime_metadata.completed_phases.includes('visibility_wait_precondition'));
    assert.ok(result.runtime_metadata.completed_phases.includes('visibility_scroll_precondition'));
    assert.deepEqual(result.runtime_metadata.visibility_preconditions, {
      viewport_applied: { width: 1024, height: 768 },
      wait_condition_applied: true,
      scroll_strategy_applied: true,
    });
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
});

test('Playwright browser readiness reports present Chromium for the Node API runner', async () => {
  const playwrightModule = fakeBrowserReadinessPlaywrightModule();
  const result = await checkEmployerBrandPlaywrightBrowserReadiness({
    playwrightModule,
    playwrightCommand: 'playwright',
    timeoutMs: 10_000,
  });

  assert.equal(result.status, 0, `${result.stdout}${result.stderr}`);
  assert.equal(playwrightModule.browserClosed, true);
  assert.equal(result.readiness.ready, true);
  assert.equal(result.readiness.browser_executable_path, '/tmp/ms-playwright/chromium_headless_shell-999/chrome-headless-shell');
  assert.equal(result.readiness.repair_command, null);
  assert.equal(result.runtime_metadata.error_code, null);
  assert.ok(result.runtime_metadata.completed_phases.includes('browser_readiness'));
  assert.ok(result.runtime_metadata.completed_phases.includes('browser_close'));
});

test('Playwright browser readiness reports missing executable path and repair command', async () => {
  const missingPath = '/Users/Michael/Library/Caches/ms-playwright/chromium_headless_shell-1217/chrome-headless-shell-mac-arm64/chrome-headless-shell';
  const playwrightModule = fakeBrowserReadinessPlaywrightModule({
    launchError: Object.assign(new Error(`browserType.launch: Executable doesn't exist at ${missingPath}`), {
      code: 'ENOENT',
    }),
  });
  const result = await checkEmployerBrandPlaywrightBrowserReadiness({
    playwrightModule,
    playwrightCommand: 'playwright',
    timeoutMs: 10_000,
  });

  assert.equal(result.status, 1);
  assert.match(result.stderr, /Playwright Chromium executable missing/);
  assert.equal(result.runtime_metadata.error_code, 'PLAYWRIGHT_BROWSER_EXECUTABLE_MISSING');
  assert.equal(result.runtime_metadata.execution_phase, 'browser_readiness');
  assert.equal(result.runtime_metadata.failed_phase, 'browser_readiness');
  assert.equal(result.runtime_metadata.missing_browser_executable_path, missingPath);
  assert.equal(
    result.runtime_metadata.browser_cache_path,
    '/Users/Michael/Library/Caches/ms-playwright/chromium_headless_shell-1217',
  );
  assert.equal(result.runtime_metadata.repair_command, 'playwright install chromium-headless-shell');
});

test('Repaired live element clip manifest fixture records bounded real-run evidence', async () => {
  const manifest = await readJson(liveManifestPath);
  const schemaValidation = validateSchema(schemaPath, liveManifestPath);

  assert.equal(schemaValidation.status, 0, `${schemaValidation.stdout}${schemaValidation.stderr}`);
  assert.deepEqual(validateEmployerBrandLiveEvidenceElementClipManifest(manifest), { valid: true, errors: [] });
  assert.equal(manifest.status, 'not_accepted');
  assert.equal(manifest.summary.executable_unit_count, 4);
  assert.equal(manifest.summary.planned_output_slot_count, 4);
  assert.equal(manifest.summary.captured_slot_count, 0);
  assert.equal(manifest.summary.failed_slot_count, 4);
  assert.equal(manifest.summary.blocked_not_run_count, 15);
  assert.equal(manifest.summary.full_page_grab_count, 0);
  assert.equal(manifest.summary.text_extract_required_count, 4);
  assert.equal(manifest.summary.text_extract_present_count, 0);
  assert.equal(manifest.acceptance.full_page_grab_false, true);
  assert.equal(manifest.acceptance.target_work_unit_linkage_present, true);
  assert.equal(manifest.acceptance.locator_provenance_present, true);
  assert.equal(manifest.acceptance.kilos_citation_metadata_present, true);
  assert.equal(manifest.controls.reviewed_locator_only, true);
  assert.equal(manifest.controls.full_page_grabs_authorized, false);
  assert.equal(manifest.controls.autonomous_crawl_authorized, false);
  assert.equal(manifest.controls.report_renderer_authorized, false);
  assert.equal(manifest.controls.workflow_engine_authorized, false);

  const captured = manifest.entries.filter((entry) => entry.status === 'captured');
  const failed = manifest.entries.filter((entry) => entry.status === 'failed');
  const blocked = manifest.entries.filter((entry) => entry.status === 'blocked_not_run');
  assert.equal(captured.length, 0);
  assert.equal(failed.length, 4);
  assert.equal(blocked.length, 15);
  assert.ok(manifest.entries.every((entry) => entry.full_page_grab === false));
  assert.ok(failed.every((entry) => entry.blocker_reason === 'reviewed_locator_element_not_visible'));
  assert.ok(failed.every((entry) => entry.capture_metadata.runner_type === 'playwright_node_api'));
  assert.ok(failed.every((entry) => entry.capture_metadata.match_count === 1));
  assert.ok(failed.every((entry) => entry.capture_metadata.current_url));
  assert.ok(failed.every((entry) => entry.capture_metadata.started_phases.includes('element_visibility_check')));
  assert.ok(failed.every((entry) => entry.capture_metadata.completed_phases.includes('locator_evaluation')));
  assert.ok(failed.every((entry) => entry.capture_metadata.started_phases.includes('runner_preflight')));
  assert.ok(failed.every((entry) => entry.capture_metadata.completed_phases.includes('runner_preflight')));
  assert.ok(failed.every((entry) => entry.required_next_action === 'review_capture_blocker_before_retry'));
  assert.ok(blocked.every((entry) => entry.clip_path === null && entry.text_extract_path === null));

  const unavailableLinkedIn = blocked.find((entry) => entry.target_id === 'live-target:symphony-talent:linkedin-presence');
  assert.ok(unavailableLinkedIn);
  assert.equal(unavailableLinkedIn.status, 'blocked_not_run');
  assert.equal(unavailableLinkedIn.blocker_reason, 'source_unavailable');
  assert.equal(unavailableLinkedIn.clip_path, null);
  assert.equal(unavailableLinkedIn.text_extract_path, null);

  const objectiveVerification = verifyEmployerBrandRepairedLiveEvidenceElementClipManifestObjective(manifest, { fixtureRoot });
  assert.equal(objectiveVerification.status, 'passed');
  assert.equal(objectiveVerification.passed, true);
  assert.deepEqual(objectiveVerification.diagnostics, []);
});

test('Repaired live element clip objective verifier CLI is read-only and reports current repaired-run state', () => {
  const result = spawnSync(
    'node',
    [
      'scripts/employer-brand-repaired-live-evidence-element-clip-verify.mjs',
      '--json',
    ],
    {
      cwd: repoRoot,
      encoding: 'utf8',
    },
  );
  assert.equal(result.status, 0, `${result.stdout}${result.stderr}`);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.status, 'passed');
  assert.equal(payload.passed, true);
  assert.deepEqual(payload.diagnostics, []);
  assert.ok(!result.stderr);
});

test('Reviewed live element clip objective verifier CLI has no capture or browsing hooks', async () => {
  const verifierSource = await fs.readFile(
    path.join(repoRoot, 'scripts/employer-brand-live-evidence-element-clip-verify.mjs'),
    'utf8',
  );
  assert.doesNotMatch(verifierSource, /playwright-cli|run-code|spawnSync|locator\(|page\.|open,/);
  assert.match(verifierSource, /read-only/i);
});

test('Reviewed live element locator re-review helper is read-only and reports no locator failures for repaired timeout blockers', async () => {
  const scriptPath = path.join(repoRoot, 'scripts/employer-brand-live-evidence-locator-rereview-needed.mjs');
  const helperSource = await fs.readFile(scriptPath, 'utf8');
  assert.doesNotMatch(helperSource, /playwright-cli|run-code|spawnSync|locator\(|page\.|open,/);
  assert.match(helperSource, /read-only/i);

  const result = spawnSync(
    'node',
    [
      'scripts/employer-brand-live-evidence-locator-rereview-needed.mjs',
      '--json',
    ],
    {
      cwd: repoRoot,
      encoding: 'utf8',
    },
  );
  assert.equal(result.status, 0, `${result.stdout}${result.stderr}`);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.count, 0);
  assert.equal(payload.required_next_action, 'human_review_new_locator_required');
  assert.ok(payload.controls.no_locator_resolution);
  assert.ok(payload.controls.no_browsing);
  assert.deepEqual(payload.slots, []);
});

test('Reviewed live element capture rejects unsupported reviewed Playwright locator strings', async () => {
  const plan = await readJson(capturePlanPath);
  const altered = JSON.parse(JSON.stringify(plan));
  altered.executable_units[1].reviewed_locator.playwright_locator = "page.locator('h1').first()";
  await assert.rejects(
    executeEmployerBrandReviewedLiveElementCapture(altered, {
      fixtureRoot,
      executionGate: 'execute-reviewed-live-element-capture-v0',
      captureBackend: async () => ({ status: 'captured', current_url: 'https://www.example.com/', slot_results: [] }),
    }),
    /Unsupported reviewed Playwright locator/,
  );
});
