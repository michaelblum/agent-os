import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  EMPLOYER_BRAND_ELEMENT_CLIP_MANIFEST_SCHEMA_VERSION,
  EMPLOYER_BRAND_ELEMENT_CLIP_MANIFEST_TYPE,
} from './employer-brand-element-capture-planning.js';

export const EMPLOYER_BRAND_ELEMENT_CAPTURE_EXECUTOR_VERSION = '2026-05-employer-brand-local-spv5-element-capture-v0';

const DEFAULT_VIEWPORT = {
  width: 1440,
  height: 900,
};

const NON_GOAL_FLAGS = [
  'live_browser_collection',
  'remote_web_collection',
  'pdf_capture_execution',
  'pptx_capture_execution',
  'report_renderer',
  'html_css_polish',
  'pdf_export',
  'docx_export',
  'workflow_engine',
  'full_page_grabs',
];

function arrayValue(value) {
  return Array.isArray(value) ? value : [];
}

function objectValue(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function text(value, fallback = '') {
  const normalized = String(value ?? '').replace(/\s+/g, ' ').trim();
  return normalized || fallback;
}

function slug(value = '', fallback = 'capture') {
  return text(value, fallback)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 120) || fallback;
}

function toPosix(relativePath) {
  return relativePath.split(path.sep).join('/');
}

function runPlaywright(playwrightCli, args, { timeout = 45_000 } = {}) {
  const result = spawnSync(playwrightCli, args, {
    encoding: 'utf8',
    timeout,
    maxBuffer: 20 * 1024 * 1024,
  });
  if (result.error) {
    return {
      status: result.status ?? 1,
      stdout: result.stdout || '',
      stderr: result.stderr || result.error.message,
      error: result.error,
    };
  }
  return result;
}

function sleep(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function startLocalFileServer(filePath) {
  const port = 47000 + (process.pid % 1000);
  const directory = path.dirname(filePath);
  const server = spawn('python3', [
    '-m',
    'http.server',
    String(port),
    '--bind',
    '127.0.0.1',
    '--directory',
    directory,
  ], {
    stdio: 'ignore',
  });
  sleep(500);
  return {
    url: `http://127.0.0.1:${port}/${encodeURIComponent(path.basename(filePath))}`,
    close() {
      server.kill();
    },
  };
}

function parseRunCodeResult(stdout) {
  const marker = '### Result\n';
  const start = stdout.indexOf(marker);
  if (start < 0) throw new Error('playwright-cli run-code did not return a result block');
  const rest = stdout.slice(start + marker.length);
  const end = rest.indexOf('\n### ');
  return JSON.parse((end >= 0 ? rest.slice(0, end) : rest).trim());
}

function selectorViewState(unit) {
  if (unit.target_id === 'target:spa-competition-logo-grid') {
    return { activeView: 'competition', activeDeepDive: null, showDeepDiveNav: false };
  }
  if (unit.target_id === 'target:spa-kilos-matrix') {
    return { activeView: 'competition', activeDeepDive: null, showDeepDiveNav: false };
  }
  if (unit.target_id === 'target:spa-company-deep-dive-cards') {
    return {
      activeView: 'deepdives',
      activeDeepDive: unit.company_ref?.slug || null,
      showDeepDiveNav: true,
    };
  }
  return { activeView: 'overview', activeDeepDive: null, showDeepDiveNav: false };
}

function captureScript(input) {
  return `async page => {
  const input = ${JSON.stringify(input)};
  await page.setViewportSize(input.viewport).catch(() => null);
  await page.waitForLoadState('domcontentloaded', { timeout: input.timeout_ms }).catch(() => null);
  await page.waitForFunction(() => document.body && document.body._x_dataStack && document.body._x_dataStack[0], null, { timeout: Math.min(input.timeout_ms, 5000) }).catch(() => null);
  await page.evaluate(({ viewState }) => {
    const app = document.body?._x_dataStack?.[0];
    if (app) {
      app.activeView = viewState.activeView;
      app.activeDeepDive = viewState.activeDeepDive;
      app.showDeepDiveNav = viewState.showDeepDiveNav;
    }
    window.scrollTo(0, 0);
  }, { viewState: input.view_state }).catch(() => null);
  await page.waitForTimeout(250);

  const locator = page.locator(input.selector).first();
  const matchCount = await page.locator(input.selector).count().catch(() => 0);
  if (matchCount < 1) {
    return {
      status: 'blocked_selector_unresolved',
      text: null,
      citation_refs: [],
      bounding_box: null,
      viewport: input.viewport,
      screenshot_written: false,
      error: { code: 'selector_not_found', message: 'Ready SPv5 selector did not resolve.' },
    };
  }

  await locator.scrollIntoViewIfNeeded({ timeout: input.timeout_ms }).catch(() => null);
  const visible = await locator.isVisible({ timeout: input.timeout_ms }).catch(() => false);
  const boundingBox = await locator.boundingBox().catch(() => null);
  let extractedText = '';
  try {
    extractedText = await locator.innerText({ timeout: input.timeout_ms });
  } catch {
    extractedText = await locator.textContent({ timeout: input.timeout_ms }).catch(() => '') || '';
  }
  extractedText = extractedText.replace(/\\s+/g, ' ').trim();
  const citationRefs = await locator.locator('a[href]').evaluateAll(anchors => [...new Set(anchors.map(anchor => anchor.href).filter(Boolean))]).catch(() => []);

  await locator.screenshot({ path: input.clip_absolute_path, timeout: input.timeout_ms });
  return {
    status: 'captured',
    text: extractedText || null,
    citation_refs: citationRefs,
    bounding_box: boundingBox,
    viewport: input.viewport,
    visible,
    screenshot_written: true,
    error: null,
  };
}`;
}

function readySpv5Units(planningBundle) {
  return arrayValue(planningBundle.work_units).filter((unit) => (
    unit.readiness_state === 'locator_ready'
    && unit.source_artifact?.id === 'source:spv5-html'
    && unit.source_artifact?.kind === 'html_spa'
  ));
}

function assetPathsForUnit(unit, { fixtureRoot, clipRoot, textRoot }) {
  const unitSlug = slug(unit.id.replace(/^work-unit:/, ''), 'work-unit');
  const companySlug = unit.company_ref?.slug || 'shared';
  const clipRelativePath = path.posix.join(clipRoot, companySlug, `${unitSlug}.png`);
  const textRelativePath = path.posix.join(textRoot, companySlug, `${unitSlug}.txt`);
  return {
    clip_path: clipRelativePath,
    clip_absolute_path: path.join(fixtureRoot, clipRelativePath),
    text_extract_path: textRelativePath,
    text_extract_absolute_path: path.join(fixtureRoot, textRelativePath),
  };
}

function shouldExtractText(unit) {
  return ['element_text_extract', 'element_clip_and_text_extract'].includes(unit.capture_type);
}

function clipEntryForCapture(unit, result, paths, { capturedAt, playwrightCli, viewport }) {
  const hasText = shouldExtractText(unit);
  const clipStats = fs.statSync(paths.clip_absolute_path);
  return {
    target_id: unit.target_id,
    work_unit_id: unit.id,
    company: cloneJson(unit.company_ref),
    source_artifact: cloneJson(unit.source_artifact),
    capture_type: unit.capture_type,
    clip_path: paths.clip_path,
    text_extract_path: hasText ? paths.text_extract_path : null,
    text_extract_content: hasText ? result.text : null,
    citation_refs: arrayValue(result.citation_refs),
    kilos_relevance: cloneJson(unit.kilos_relevance),
    acceptance_result: {
      status: result.status,
      criteria: cloneJson(unit.acceptance_criteria),
      notes: result.visible === false ? 'Captured element resolved, but Playwright reported it was not visible.' : null,
    },
    capture_metadata: {
      executor: EMPLOYER_BRAND_ELEMENT_CAPTURE_EXECUTOR_VERSION,
      backend: 'playwright-cli',
      backend_command: playwrightCli,
      source_url_kind: 'local_file_data_url',
      local_spv5_html_only: true,
      live_browser_collection: false,
      remote_web_collection: false,
      full_page_grab: false,
      selector: unit.locator_hints?.selector || null,
      locator_integrity: unit.locator_hints?.integrity || null,
      captured_at: capturedAt,
      viewport,
      bounding_box: result.bounding_box || null,
      clip_bytes: clipStats.size,
    },
    provenance: {
      planned_only: false,
      read_only: true,
      non_goal_flags: cloneJson(NON_GOAL_FLAGS),
    },
  };
}

function plannedSlotForUnit(unit, clip = null) {
  const captured = Boolean(clip);
  return {
    target_id: unit.target_id,
    work_unit_id: unit.id,
    company: cloneJson(unit.company_ref),
    source_artifact: cloneJson(unit.source_artifact),
    capture_type: unit.capture_type,
    clip_path: clip?.clip_path || null,
    text_extract_path: clip?.text_extract_path || null,
    text_extract_content: clip?.text_extract_content || null,
    citation_refs: clip?.citation_refs || [],
    kilos_relevance: cloneJson(unit.kilos_relevance),
    acceptance_result: {
      status: captured ? 'captured' : 'not_run',
      criteria: cloneJson(unit.acceptance_criteria),
      notes: captured ? null : text(arrayValue(unit.blockers).join(', '), null),
    },
    provenance: {
      planned_only: !captured,
      read_only: true,
      non_goal_flags: cloneJson(NON_GOAL_FLAGS),
    },
  };
}

export function executeEmployerBrandLocalSpv5ElementCapture(planningBundle, {
  fixtureRoot,
  manifestPath = 'source-artifacts/element-clip-manifest.json',
  clipRoot = 'source-artifacts/element-clips/spv5',
  textRoot = 'source-artifacts/text-extracts/spv5',
  playwrightCli = 'playwright-cli',
  timeoutMs = 45_000,
  viewport = DEFAULT_VIEWPORT,
  createdAt = new Date().toISOString(),
} = {}) {
  if (!fixtureRoot) throw new Error('fixtureRoot is required');
  const unitsToCapture = readySpv5Units(planningBundle);
  const sourcePath = planningBundle.inputs?.spv5_html_path || '/Users/Michael/Desktop/SPv5.html';
  const sourceUrl = pathToFileURL(sourcePath).href;
  const localServer = startLocalFileServer(sourcePath);
  const browserUrl = localServer.url;
  const session = `employer-brand-spv5-${process.pid}`;
  const clips = [];
  const clipByWorkUnit = new Map();
  const capturedAt = createdAt;

  const open = runPlaywright(playwrightCli, [
    `-s=${session}`,
    'open',
    browserUrl,
  ], { timeout: timeoutMs });
  if (open.status !== 0) {
    throw new Error(`Unable to open local SPv5 HTML with playwright-cli: ${text(open.stderr || open.stdout)}`);
  }

  try {
    for (const unit of unitsToCapture) {
      const selector = unit.locator_hints?.selector;
      if (!selector) continue;
      const paths = assetPathsForUnit(unit, { fixtureRoot, clipRoot, textRoot });
      fs.mkdirSync(path.dirname(paths.clip_absolute_path), { recursive: true });
      if (shouldExtractText(unit)) fs.mkdirSync(path.dirname(paths.text_extract_absolute_path), { recursive: true });

      const runCode = runPlaywright(playwrightCli, [
        `-s=${session}`,
        'run-code',
        captureScript({
          selector,
          view_state: selectorViewState(unit),
          clip_absolute_path: paths.clip_absolute_path,
          timeout_ms: timeoutMs,
          viewport,
        }),
      ], { timeout: timeoutMs });
      if (runCode.status !== 0) {
        throw new Error(`Capture failed for ${unit.id}: ${text(runCode.stderr || runCode.stdout)}`);
      }
      const result = parseRunCodeResult(runCode.stdout || '');
      if (result.status !== 'captured') {
        throw new Error(`Capture did not complete for ${unit.id}: ${JSON.stringify(result.error || result)}`);
      }
      if (shouldExtractText(unit)) {
        fs.writeFileSync(paths.text_extract_absolute_path, `${result.text || ''}\n`);
      }
      const clip = clipEntryForCapture(unit, result, paths, {
        capturedAt,
        playwrightCli,
        viewport,
      });
      clips.push(clip);
      clipByWorkUnit.set(unit.id, clip);
    }
  } finally {
    runPlaywright(playwrightCli, [`-s=${session}`, 'close'], { timeout: 15_000 });
    localServer.close();
  }

  const plannedSlots = arrayValue(planningBundle.work_units).map((unit) => plannedSlotForUnit(unit, clipByWorkUnit.get(unit.id)));
  const blockedSlots = plannedSlots.filter((slot) => slot.acceptance_result.status !== 'captured');
  const manifest = {
    type: EMPLOYER_BRAND_ELEMENT_CLIP_MANIFEST_TYPE,
    schema_version: EMPLOYER_BRAND_ELEMENT_CLIP_MANIFEST_SCHEMA_VERSION,
    id: `element-clip-manifest:${planningBundle.id || 'local-spv5'}`,
    label: 'Employer Brand Element Clip Manifest V0 Local SPv5 Capture',
    status: blockedSlots.length ? 'captured_with_blockers' : 'captured',
    planning_bundle: {
      id: planningBundle.id || null,
      path: 'source-artifacts/element-capture-planning-bundle.json',
      schema: 'shared/schemas/employer-brand-element-capture-planning-bundle-v0.schema.json',
    },
    expected: {
      target_count: planningBundle.source_plan?.target_count ?? 0,
      work_unit_count: planningBundle.expansion?.work_unit_count ?? 0,
      expected_clip_count: planningBundle.expansion?.expected_clip_count ?? 0,
      locator_ready_spv5_work_unit_count: unitsToCapture.length,
      captured_work_unit_count: clips.length,
      blocked_work_unit_count: blockedSlots.length,
    },
    clips,
    planned_slots: plannedSlots,
    controls: {
      contains_actual_captures: true,
      local_spv5_html_only: true,
      live_browser_collection_authorized: false,
      remote_web_collection_authorized: false,
      pdf_capture_execution_authorized: false,
      pptx_capture_execution_authorized: false,
      screenshot_generation_authorized: false,
      element_clip_generation_authorized: true,
      report_renderer_authorized: false,
      export_execution_authorized: false,
      workflow_engine_authorized: false,
      full_page_grabs_authorized: false,
    },
    provenance: {
      created_at: createdAt,
      planning_bundle_id: planningBundle.id || null,
      planning_bundle_path: 'source-artifacts/element-capture-planning-bundle.json',
      manifest_path: toPosix(manifestPath),
      source_spv5_html_path: sourcePath,
      source_spv5_html_url: sourceUrl,
      executor: EMPLOYER_BRAND_ELEMENT_CAPTURE_EXECUTOR_VERSION,
      read_only: true,
      planned_only: false,
      local_fixture_evidence_only: true,
      non_goals: cloneJson(NON_GOAL_FLAGS),
    },
  };

  return manifest;
}

export function writeEmployerBrandElementClipManifest(manifest, { fixtureRoot, manifestPath }) {
  const absolutePath = path.join(fixtureRoot, manifestPath);
  fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
  fs.writeFileSync(absolutePath, `${JSON.stringify(manifest, null, 2)}\n`);
  return absolutePath;
}
