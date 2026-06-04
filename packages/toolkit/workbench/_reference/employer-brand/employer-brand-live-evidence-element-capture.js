import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL, URL } from 'node:url';
import {
  normalizeEmployerBrandLiveEvidenceReviewedLocatorCapturePlan,
} from './employer-brand-live-evidence-reviewed-locator-capture-plan.js';
import {
  normalizeEmployerBrandLiveEvidenceRepairedLocatorCapturePlan,
} from './employer-brand-live-evidence-capture-repair-promotion.js';

export const EMPLOYER_BRAND_LIVE_EVIDENCE_ELEMENT_CLIP_MANIFEST_TYPE =
  'aos.employer_brand_live_evidence_element_clip_manifest';
export const EMPLOYER_BRAND_LIVE_EVIDENCE_ELEMENT_CLIP_MANIFEST_SCHEMA_VERSION =
  '2026-05-employer-brand-live-evidence-element-clip-manifest-v0';
export const EMPLOYER_BRAND_LIVE_EVIDENCE_ELEMENT_CAPTURE_EXECUTOR_VERSION =
  '2026-05-employer-brand-reviewed-live-element-capture-v0';
export const EMPLOYER_BRAND_LIVE_EVIDENCE_SLOT_CAPTURE_RUNNER_VERSION =
  '2026-05-employer-brand-live-evidence-slot-capture-runner-v0';

const DEFAULT_VIEWPORT = { width: 1440, height: 900 };
const DEFAULT_CLIP_ROOT = 'source-artifacts/live-evidence-element-clips/reviewed-locator';
const DEFAULT_TEXT_ROOT = 'source-artifacts/live-evidence-text-extracts/reviewed-locator';
const DEFAULT_MANIFEST_PATH = 'source-artifacts/live-evidence-element-clip-manifest.json';
const EXECUTION_GATE = 'execute-reviewed-live-element-capture-v0';
const REPAIRED_EXECUTION_GATE = 'execute-repaired-live-element-capture-v0';
const REVIEWED_LINKEDIN_LOCATOR =
  "page.getByRole('heading', { name: /Symphony Talent/i }).first()";
const PHENOM_REPAIRED_HERO_LOCATOR =
  "page.locator('main section').filter({ hasText: /AI for Tomorrow.*Applied by Human Resources/ }).first()";
const APPROVED_PLAYWRIGHT_LOCATORS = new Set([
  REVIEWED_LINKEDIN_LOCATOR,
  PHENOM_REPAIRED_HERO_LOCATOR,
]);
const NON_GOALS = [
  'autonomous_crawl',
  'autonomous_browsing',
  'locator_codegen',
  'locator_discovery',
  'unreviewed_locators',
  'full_page_grabs',
  'report_renderer',
  'html_css_polish',
  'pdf_export',
  'docx_export',
  'workflow_engine',
  'login_bypass',
  'paywall_bypass',
  'captcha_bypass',
  'consent_bypass',
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

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function text(value, fallback = '') {
  const normalized = String(value ?? '').replace(/\s+/g, ' ').trim();
  return normalized || fallback;
}

function slug(value, fallback = 'item') {
  return text(value, fallback)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 120) || fallback;
}

function toPosix(relativePath) {
  return relativePath.split(path.sep).join('/');
}

function sameOriginOrDomain(expectedUrl, actualUrl) {
  const expected = new URL(expectedUrl);
  const actual = new URL(actualUrl);
  return expected.hostname === actual.hostname || actual.hostname.endsWith(`.${expected.hostname}`);
}

function reviewedLocatorKind(locator) {
  if (locator?.selector) return 'selector';
  if (locator?.xpath) return 'xpath';
  if (locator?.playwright_locator) return 'playwright_locator';
  return null;
}

function ensureReviewedLocatorAllowed(locator) {
  const keys = ['selector', 'xpath', 'playwright_locator'].filter((key) => locator?.[key]);
  if (keys.length !== 1) {
    throw new Error('Each executable unit must carry exactly one reviewed locator value');
  }
  if (locator.playwright_locator && !APPROVED_PLAYWRIGHT_LOCATORS.has(locator.playwright_locator)) {
    throw new Error(`Unsupported reviewed Playwright locator: ${locator.playwright_locator}`);
  }
}

function pngDimensions(filePath) {
  const buffer = fs.readFileSync(filePath);
  if (buffer.length < 24 || buffer.toString('ascii', 1, 4) !== 'PNG') return null;
  return {
    width: buffer.readUInt32BE(16),
    height: buffer.readUInt32BE(20),
  };
}

function shellQuote(value) {
  return `'${String(value).replace(/'/g, "'\\''")}'`;
}

function resolveToolPath(command, { cwd = process.cwd() } = {}) {
  if (!command) return null;
  if (command.includes(path.sep)) return fs.existsSync(command) ? command : null;
  const result = spawnSync('/bin/sh', ['-lc', `command -v ${shellQuote(command)}`], {
    encoding: 'utf8',
    timeout: 2_000,
    cwd,
  });
  return result.status === 0 ? text(result.stdout).split(/\s+/)[0] || null : null;
}

function resolveCommandPath(command, { cwd = process.cwd() } = {}) {
  return resolveToolPath(command, { cwd });
}

function repairCommandForPlaywrightBrowser({ playwrightCommand = 'playwright', missingExecutablePath = null } = {}) {
  const browserName = String(missingExecutablePath || '').includes('chromium_headless_shell')
    ? 'chromium-headless-shell'
    : 'chromium';
  return `${playwrightCommand} install ${browserName}`;
}

function extractMissingPlaywrightExecutablePath(message) {
  const match = String(message || '').match(/Executable doesn't exist at ([^\n\r╔]+)/);
  return match ? match[1].trim() : null;
}

function playwrightCachePathFromExecutable(executablePath) {
  const marker = `${path.sep}ms-playwright${path.sep}`;
  const index = String(executablePath || '').indexOf(marker);
  if (index < 0) return null;
  const afterMarker = executablePath.slice(index + marker.length);
  const cacheEntry = afterMarker.split(path.sep)[0];
  return cacheEntry ? executablePath.slice(0, index + marker.length + cacheEntry.length) : null;
}

function stableCommandSurface(command, args) {
  if (args.includes('--help')) return `${command} --help`;
  if (args.includes('open')) return `${command} open`;
  if (args.includes('run-code')) return `${command} run-code`;
  if (args.includes('close')) return `${command} close`;
  return [command, ...args].join(' ');
}

function runPlaywright(playwrightCli, args, {
  timeout = 45_000,
  cwd = process.cwd(),
  executionPhase = 'unknown',
} = {}) {
  const toolPath = resolveToolPath(playwrightCli, { cwd });
  const result = spawnSync(playwrightCli, args, {
    encoding: 'utf8',
    timeout,
    cwd,
    maxBuffer: 20 * 1024 * 1024,
  });
  const metadata = {
    command: playwrightCli,
    args,
    command_surface: [playwrightCli, ...args].join(' '),
    command_surface_stable: stableCommandSurface(playwrightCli, args),
    execution_phase: executionPhase,
    tool_path: toolPath,
    timeout_ms: timeout,
    working_directory: cwd,
    exit_status: Number.isFinite(result.status) ? result.status : null,
    exit_signal: result.signal || null,
    error_code: result.error?.code || null,
    error_message: result.error?.message || null,
    timed_out: result.error?.code === 'ETIMEDOUT' || result.signal === 'SIGTERM',
    stdout_snippet: text(result.stdout).slice(0, 1000) || null,
    stderr_snippet: text(result.stderr).slice(0, 1000) || null,
  };
  if (result.error) {
    return {
      status: result.status ?? 1,
      stdout: result.stdout || '',
      stderr: result.stderr || result.error.message,
      error: result.error,
      runtime_metadata: metadata,
    };
  }
  return {
    ...result,
    runtime_metadata: metadata,
  };
}

function preflightPlaywright(playwrightCli, {
  timeout = 10_000,
  cwd = process.cwd(),
  runner = runPlaywright,
} = {}) {
  return runner(playwrightCli, ['--help'], { timeout, cwd, executionPhase: 'command_availability' });
}

function exactInvocationSmokeScript() {
  return `async page => {
  await page.setContent('<main data-aos-smoke="true">aos repaired capture smoke</main>');
  return {
    status: 'captured',
    current_url: page.url(),
    title: await page.title().catch(() => null),
    match_count: await page.locator('[data-aos-smoke="true"]').count(),
    smoke: true
  };
}`;
}

function exactInvocationSmokePlaywright(playwrightCli, {
  timeout = 10_000,
  cwd = process.cwd(),
  session = `ebr-smoke-${process.pid}`,
  runner = runPlaywright,
} = {}) {
  const open = runner(playwrightCli, [`-s=${session}`, 'open', 'about:blank'], {
    timeout,
    cwd,
    executionPhase: 'exact_invocation_smoke_open',
  });
  if (open.status !== 0) return open;
  try {
    return runner(playwrightCli, [`-s=${session}`, 'run-code', exactInvocationSmokeScript()], {
      timeout,
      cwd,
      executionPhase: 'exact_invocation_smoke_run_code',
    });
  } finally {
    runner(playwrightCli, [`-s=${session}`, 'close'], {
      timeout: Math.min(timeout, 5_000),
      cwd,
      executionPhase: 'exact_invocation_smoke_cleanup',
    });
  }
}

function parseRunCodeResult(stdout) {
  const marker = '### Result\n';
  const start = stdout.indexOf(marker);
  if (start < 0) throw new Error('playwright-cli run-code did not return a result block');
  const rest = stdout.slice(start + marker.length);
  const end = rest.indexOf('\n### ');
  return JSON.parse((end >= 0 ? rest.slice(0, end) : rest).trim());
}

function phaseTimeoutError(phase, timeoutMs) {
  const error = new Error(`${phase} timed out after ${timeoutMs}ms`);
  error.code = 'PHASE_TIMEOUT';
  return error;
}

async function runRunnerPhase(state, phase, timeoutMs, task) {
  const startedAt = Date.now();
  state.started_phases.push(phase);
  try {
    const value = await Promise.race([
      task(),
      new Promise((_, reject) => {
        setTimeout(() => reject(phaseTimeoutError(phase, timeoutMs)), timeoutMs);
      }),
    ]);
    state.completed_phases.push(phase);
    state.phase_timings_ms[phase] = Date.now() - startedAt;
    return value;
  } catch (caught) {
    state.failed_phase = phase;
    state.phase_timings_ms[phase] = Date.now() - startedAt;
    throw caught;
  }
}

function runnerRuntimeMetadata({
  runnerType = 'playwright_node_api',
  executionPhase,
  timeoutMs,
  startedPhases = [],
  completedPhases = [],
  phaseTimingsMs = {},
  error = null,
  toolPath = null,
  workingDirectory = process.cwd(),
  extra = {},
} = {}) {
  return {
    runner_type: runnerType,
    runner_version: EMPLOYER_BRAND_LIVE_EVIDENCE_SLOT_CAPTURE_RUNNER_VERSION,
    command: runnerType,
    command_surface: runnerType,
    command_surface_stable: runnerType,
    execution_phase: executionPhase,
    tool_path: toolPath,
    timeout_ms: timeoutMs,
    working_directory: workingDirectory,
    exit_status: error ? 1 : 0,
    exit_signal: null,
    error_code: error?.code || null,
    error_message: error?.message || null,
    timed_out: error?.code === 'PHASE_TIMEOUT',
    stdout_snippet: null,
    stderr_snippet: error?.message || null,
    started_phases: cloneJson(startedPhases),
    completed_phases: cloneJson(completedPhases),
    failed_phase: executionPhase || null,
    phase_timings_ms: cloneJson(phaseTimingsMs),
    phase_timeout_ms: timeoutMs,
    ...extra,
  };
}

function failedRunnerResult({ error, phase, state, timeoutMs, toolPath = null, extra = {} }) {
  return {
    status: 1,
    stdout: '',
    stderr: error?.message || String(error || 'unknown runner failure'),
    error,
    runtime_metadata: runnerRuntimeMetadata({
      executionPhase: phase,
      timeoutMs,
      toolPath,
      startedPhases: state?.started_phases || [],
      completedPhases: state?.completed_phases || [],
      phaseTimingsMs: state?.phase_timings_ms || {},
      error,
      extra,
    }),
  };
}

async function loadPlaywrightNodeApi({
  playwrightModule = null,
  playwrightCommand = 'playwright',
} = {}) {
  if (playwrightModule) return { api: playwrightModule.default || playwrightModule, toolPath: null };
  try {
    const direct = await import('playwright');
    return { api: direct.default || direct, toolPath: null };
  } catch (caught) {
    if (caught?.code !== 'ERR_MODULE_NOT_FOUND' && caught?.code !== 'MODULE_NOT_FOUND') throw caught;
  }

  const toolPath = resolveCommandPath(playwrightCommand);
  if (!toolPath) {
    const error = new Error(`Playwright Node API unavailable and ${playwrightCommand} was not found on PATH`);
    error.code = 'PLAYWRIGHT_NODE_API_UNAVAILABLE';
    throw error;
  }
  let realToolPath = toolPath;
  try {
    realToolPath = fs.realpathSync(toolPath);
  } catch {
    realToolPath = toolPath;
  }
  const packageRoot = path.dirname(realToolPath);
  const packageIndex = path.join(packageRoot, 'index.js');
  if (!fs.existsSync(packageIndex)) {
    const error = new Error(`Playwright Node API package index not found next to ${realToolPath}`);
    error.code = 'PLAYWRIGHT_NODE_API_UNAVAILABLE';
    throw error;
  }
  const imported = await import(pathToFileURL(packageIndex));
  return {
    api: imported.default || imported,
    toolPath: realToolPath,
  };
}

export async function checkEmployerBrandPlaywrightBrowserReadiness({
  playwrightModule = null,
  playwrightCommand = 'playwright',
  timeoutMs = 10_000,
  viewport = DEFAULT_VIEWPORT,
} = {}) {
  const state = { started_phases: [], completed_phases: [], phase_timings_ms: {}, failed_phase: null };
  let browser = null;
  let toolPath = null;
  try {
    const loaded = await runRunnerPhase(state, 'runner_preflight', timeoutMs, () => loadPlaywrightNodeApi({
      playwrightModule,
      playwrightCommand,
    }));
    const playwright = loaded.api;
    toolPath = loaded.toolPath;
    if (!playwright?.chromium?.launch) {
      const error = new Error('Loaded Playwright module does not expose chromium.launch');
      error.code = 'PLAYWRIGHT_NODE_API_INVALID';
      throw error;
    }
    const browserExecutablePath = typeof playwright.chromium.executablePath === 'function'
      ? playwright.chromium.executablePath()
      : null;
    browser = await runRunnerPhase(state, 'browser_readiness', timeoutMs, () => (
      playwright.chromium.launch({ headless: true })
    ));
    const page = await browser.newPage({ viewport }).catch(() => null);
    if (page?.close) await page.close().catch(() => null);
    await runRunnerPhase(state, 'browser_close', Math.min(timeoutMs, 10_000), () => browser.close());
    browser = null;
    return {
      status: 0,
      stdout: 'playwright browser readiness passed',
      stderr: '',
      readiness: {
        ready: true,
        runner_type: 'playwright_node_api',
        browser_name: 'chromium',
        headless: true,
        browser_executable_path: browserExecutablePath,
        missing_browser_executable_path: null,
        browser_cache_path: browserExecutablePath ? playwrightCachePathFromExecutable(browserExecutablePath) : null,
        repair_command: null,
      },
      runtime_metadata: runnerRuntimeMetadata({
        executionPhase: null,
        timeoutMs,
        toolPath,
        startedPhases: state.started_phases,
        completedPhases: state.completed_phases,
        phaseTimingsMs: state.phase_timings_ms,
        extra: {
          browser_readiness_check: true,
          browser_name: 'chromium',
          headless: true,
          browser_executable_path: browserExecutablePath,
          missing_browser_executable_path: null,
          browser_cache_path: browserExecutablePath ? playwrightCachePathFromExecutable(browserExecutablePath) : null,
          repair_command: null,
        },
      }),
    };
  } catch (caught) {
    const missingExecutablePath = extractMissingPlaywrightExecutablePath(caught?.message);
    const repairCommand = repairCommandForPlaywrightBrowser({
      playwrightCommand,
      missingExecutablePath,
    });
    const error = missingExecutablePath
      ? Object.assign(new Error(
        `Playwright Chromium executable missing at ${missingExecutablePath}. Run: ${repairCommand}`,
      ), { code: 'PLAYWRIGHT_BROWSER_EXECUTABLE_MISSING' })
      : caught;
    return failedRunnerResult({
      error,
      phase: state.failed_phase || 'runner_preflight',
      state,
      timeoutMs,
      toolPath,
      extra: {
        browser_readiness_check: true,
        browser_name: 'chromium',
        headless: true,
        missing_browser_executable_path: missingExecutablePath,
        browser_cache_path: missingExecutablePath ? playwrightCachePathFromExecutable(missingExecutablePath) : null,
        repair_command: repairCommand,
      },
    });
  } finally {
    if (browser) {
      await browser.close().catch(() => null);
    }
  }
}

function reviewedLocatorForPage(scope, locatorKind, locatorValue) {
  if (locatorKind === 'selector') return scope.locator(locatorValue);
  if (locatorKind === 'xpath') return scope.locator(`xpath=${locatorValue}`);
  if (locatorKind === 'playwright_locator' && locatorValue === REVIEWED_LINKEDIN_LOCATOR) {
    return scope.getByRole('heading', { name: /Symphony Talent/i }).first();
  }
  if (locatorKind === 'playwright_locator' && locatorValue === PHENOM_REPAIRED_HERO_LOCATOR) {
    return scope.locator('main section').filter({ hasText: /AI for Tomorrow.*Applied by Human Resources/ }).first();
  }
  return null;
}

function parseViewportHint(viewportHint) {
  if (!viewportHint) return null;
  if (typeof viewportHint === 'object') {
    const width = Number(viewportHint.width);
    const height = Number(viewportHint.height);
    return Number.isFinite(width) && Number.isFinite(height) ? { width, height } : null;
  }
  const match = String(viewportHint).match(/(\d{3,5})\s*[xX, ]\s*(\d{3,5})/);
  if (!match) return null;
  return { width: Number(match[1]), height: Number(match[2]) };
}

async function applyVisibilityViewportPrecondition(page, visibilityPrecondition, timeoutMs) {
  const viewport = parseViewportHint(visibilityPrecondition?.viewport_hint);
  if (!viewport) return null;
  await page.setViewportSize(viewport, { timeout: timeoutMs });
  return viewport;
}

async function applyVisibilityWaitPrecondition(locator, visibilityPrecondition, timeoutMs) {
  if (!visibilityPrecondition?.wait_condition) return false;
  await locator.first().waitFor({ state: 'visible', timeout: timeoutMs });
  return true;
}

async function applyVisibilityScrollPrecondition(element, visibilityPrecondition, timeoutMs) {
  if (!visibilityPrecondition?.scroll_strategy) return false;
  await element.scrollIntoViewIfNeeded({ timeout: timeoutMs });
  return true;
}

async function browserBlockerState(page, timeoutMs) {
  const bodyText = await page.locator('body').innerText({ timeout: Math.min(timeoutMs, 3_000) }).catch(() => '');
  const lowered = String(bodyText || '').replace(/\s+/g, ' ').trim().toLowerCase();
  return [
    ['captcha_encountered', ['captcha', 'verify you are human']],
    ['login_required', ['sign in to continue', 'log in to continue', 'join linkedin to view']],
    ['paywall_encountered', ['subscribe to continue', 'subscription required']],
  ].find(([, needles]) => needles.some((needle) => lowered.includes(needle)))?.[0] || null;
}

export async function captureEmployerBrandLiveEvidenceSlotsWithNodeApi({
  playwrightModule = null,
  playwrightCommand = 'playwright',
  targetUrl,
  input,
  timeoutMs,
  viewport,
} = {}) {
  const state = { started_phases: [], completed_phases: [], phase_timings_ms: {}, failed_phase: null };
  let browser = null;
  let toolPath = null;
  try {
    const loaded = await runRunnerPhase(state, 'runner_preflight', timeoutMs, () => loadPlaywrightNodeApi({
      playwrightModule,
      playwrightCommand,
    }));
    const playwright = loaded.api;
    toolPath = loaded.toolPath;
    if (!playwright?.chromium?.launch) {
      const error = new Error('Loaded Playwright module does not expose chromium.launch');
      error.code = 'PLAYWRIGHT_NODE_API_INVALID';
      throw error;
    }
    const readiness = await runRunnerPhase(state, 'browser_readiness', timeoutMs, () => (
      checkEmployerBrandPlaywrightBrowserReadiness({
        playwrightModule: playwright,
        playwrightCommand,
        timeoutMs,
        viewport,
      })
    ));
    if (readiness.status !== 0) {
      state.failed_phase = 'browser_readiness';
      const error = new Error(text(readiness.stderr || readiness.stdout));
      error.code = readiness.runtime_metadata?.error_code || 'PLAYWRIGHT_BROWSER_READINESS_FAILED';
      throw Object.assign(error, {
        runtime_metadata: readiness.runtime_metadata,
      });
    }
    browser = await runRunnerPhase(state, 'browser_launch', timeoutMs, () => playwright.chromium.launch({ headless: true }));
    const page = await browser.newPage({ viewport });
    const phaseMetadata = (executionPhase) => runnerRuntimeMetadata({
      executionPhase,
      timeoutMs,
      toolPath,
      startedPhases: state.started_phases,
      completedPhases: state.completed_phases,
      phaseTimingsMs: state.phase_timings_ms,
    });
    const appliedViewport = await runRunnerPhase(state, 'visibility_viewport_precondition', timeoutMs, () => (
      applyVisibilityViewportPrecondition(page, input.visibility_precondition, timeoutMs)
    ));
    await runRunnerPhase(state, 'page_navigation', timeoutMs, async () => {
      await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: timeoutMs });
      await page.waitForLoadState('networkidle', { timeout: Math.min(timeoutMs, 10_000) }).catch(() => null);
    });
    const blockerReason = await browserBlockerState(page, timeoutMs);
    if (blockerReason) {
      return {
        status: 'blocked',
        blocker_reason: blockerReason,
        current_url: page.url(),
        title: await page.title().catch(() => null),
        match_count: 0,
        text: null,
        citation_refs: [],
        bounding_box: null,
        screenshot_written: false,
        runtime_metadata: phaseMetadata('locator_evaluation'),
      };
    }

    const locator = reviewedLocatorForPage(page, input.locator_kind, input.locator_value);
    if (!locator) {
      return {
        status: 'blocked',
        blocker_reason: 'reviewed_locator_not_supported',
        current_url: page.url(),
        title: await page.title().catch(() => null),
        match_count: 0,
        text: null,
        citation_refs: [],
        bounding_box: null,
        screenshot_written: false,
        runtime_metadata: phaseMetadata('locator_evaluation'),
      };
    }

    const waitApplied = await runRunnerPhase(state, 'visibility_wait_precondition', timeoutMs, () => (
      applyVisibilityWaitPrecondition(locator, input.visibility_precondition, timeoutMs)
    ));
    const matchCount = await runRunnerPhase(state, 'locator_evaluation', timeoutMs, () => locator.count());
    if (matchCount < 1) {
      return {
        status: 'blocked',
        blocker_reason: 'reviewed_locator_matches_zero_elements',
        current_url: page.url(),
        title: await page.title().catch(() => null),
        match_count: matchCount,
        text: null,
        citation_refs: [],
        bounding_box: null,
        screenshot_written: false,
        runtime_metadata: phaseMetadata('locator_evaluation'),
      };
    }
    if (input.expected_clip_count === 1 && matchCount > 1) {
      return {
        status: 'blocked',
        blocker_reason: 'reviewed_locator_matches_ambiguous_elements_without_human_confirmation',
        current_url: page.url(),
        title: await page.title().catch(() => null),
        match_count: matchCount,
        text: null,
        citation_refs: [],
        bounding_box: null,
        screenshot_written: false,
        runtime_metadata: phaseMetadata('locator_evaluation'),
      };
    }

    const slotResults = [];
    for (const slot of input.slots) {
      const elementIndex = Math.min(slot.ordinal - 1, matchCount - 1);
      const element = locator.nth(elementIndex);
      const scrollApplied = await runRunnerPhase(state, 'visibility_scroll_precondition', timeoutMs, () => (
        applyVisibilityScrollPrecondition(element, input.visibility_precondition, timeoutMs)
      ));
      const visible = await runRunnerPhase(state, 'element_visibility_check', timeoutMs, async () => (
        await element.isVisible({ timeout: timeoutMs }).catch(() => false)
      ));
      if (!visible) {
        return {
          status: 'blocked',
          blocker_reason: 'reviewed_locator_element_not_visible',
          current_url: page.url(),
          title: await page.title().catch(() => null),
          match_count: matchCount,
          text: null,
          citation_refs: [],
          bounding_box: null,
          screenshot_written: false,
          runtime_metadata: {
            ...phaseMetadata('element_visibility_check'),
            visibility_preconditions: {
              viewport_applied: appliedViewport,
              wait_condition_applied: waitApplied,
              scroll_strategy_applied: scrollApplied,
            },
          },
        };
      }
      const boundingBox = await element.boundingBox().catch(() => null);
      const extractedText = await runRunnerPhase(state, 'text_extraction', timeoutMs, async () => {
        const raw = await element.innerText({ timeout: timeoutMs }).catch(async () => (
          await element.textContent({ timeout: timeoutMs }).catch(() => '')
        ));
        return String(raw || '').replace(/\s+/g, ' ').trim();
      });
      const citationRefs = await element.locator('a[href]').evaluateAll((anchors) => (
        [...new Set(anchors.map((anchor) => anchor.href).filter(Boolean))]
      )).catch(() => []);
      await runRunnerPhase(state, 'element_screenshot', timeoutMs, () => element.screenshot({
        path: slot.clip_absolute_path,
        timeout: timeoutMs,
      }));
      slotResults.push({
        slot_id: slot.slot_id,
        status: 'captured',
        text: extractedText || null,
        citation_refs: citationRefs,
        bounding_box: boundingBox,
        clip_absolute_path: slot.clip_absolute_path,
      });
    }

    await runRunnerPhase(state, 'browser_close', Math.min(timeoutMs, 10_000), () => browser.close());
    browser = null;
    return {
      status: 'captured',
      blocker_reason: null,
      current_url: page.url(),
      title: await page.title().catch(() => null),
      match_count: matchCount,
      screenshot_written: true,
      full_page_grab: false,
      slot_results: slotResults,
      runtime_metadata: runnerRuntimeMetadata({
        executionPhase: null,
        timeoutMs,
        toolPath,
        startedPhases: state.started_phases,
        completedPhases: state.completed_phases,
        phaseTimingsMs: state.phase_timings_ms,
        extra: {
          visibility_preconditions: {
            viewport_applied: appliedViewport,
            wait_condition_applied: waitApplied,
            scroll_strategy_applied: input.slots.some(() => Boolean(input.visibility_precondition?.scroll_strategy)),
          },
        },
      }),
    };
  } catch (caught) {
    return {
      status: 'blocked',
      blocker_reason: `capture_runner_failed: ${caught.message}`,
      runtime_metadata: failedRunnerResult({
        error: caught,
        phase: state.failed_phase || 'runner_preflight',
        state,
        timeoutMs,
        toolPath,
        extra: objectValue(caught.runtime_metadata),
      }).runtime_metadata,
      current_url: targetUrl,
      title: null,
      match_count: null,
      text: null,
      citation_refs: [],
      bounding_box: null,
      screenshot_written: false,
    };
  } finally {
    if (browser) {
      await runRunnerPhase(state, 'browser_close', Math.min(timeoutMs, 10_000), () => browser.close()).catch(() => null);
    }
  }
}

export async function smokeEmployerBrandLiveEvidenceSlotCaptureRunner({
  playwrightModule = null,
  playwrightCommand = 'playwright',
  timeoutMs = 10_000,
  viewport = DEFAULT_VIEWPORT,
} = {}) {
  const state = { started_phases: [], completed_phases: [], phase_timings_ms: {}, failed_phase: null };
  let browser = null;
  let toolPath = null;
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'aos-live-evidence-slot-runner-'));
  const clipPath = path.join(tmp, 'slot-smoke.png');
  try {
    const loaded = await runRunnerPhase(state, 'runner_preflight', timeoutMs, () => loadPlaywrightNodeApi({
      playwrightModule,
      playwrightCommand,
    }));
    const playwright = loaded.api;
    toolPath = loaded.toolPath;
    if (!playwright?.chromium?.launch) {
      const error = new Error('Loaded Playwright module does not expose chromium.launch');
      error.code = 'PLAYWRIGHT_NODE_API_INVALID';
      throw error;
    }
    const readiness = await runRunnerPhase(state, 'browser_readiness', timeoutMs, () => (
      checkEmployerBrandPlaywrightBrowserReadiness({
        playwrightModule: playwright,
        playwrightCommand,
        timeoutMs,
        viewport,
      })
    ));
    if (readiness.status !== 0) {
      state.failed_phase = 'browser_readiness';
      const error = new Error(text(readiness.stderr || readiness.stdout));
      error.code = readiness.runtime_metadata?.error_code || 'PLAYWRIGHT_BROWSER_READINESS_FAILED';
      throw Object.assign(error, {
        runtime_metadata: readiness.runtime_metadata,
      });
    }
    browser = await runRunnerPhase(state, 'browser_launch', timeoutMs, () => playwright.chromium.launch({ headless: true }));
    const page = await browser.newPage({ viewport });
    await runRunnerPhase(state, 'page_navigation', timeoutMs, () => page.setContent(`
      <main>
        <section data-aos-live-evidence-smoke="true">
          <h1>Local runner smoke target</h1>
          <p>Element clip and text extract fixture.</p>
          <a href="https://example.com/source">source</a>
        </section>
      </main>
    `, { waitUntil: 'domcontentloaded', timeout: timeoutMs }));
    const locator = page.locator('[data-aos-live-evidence-smoke="true"]');
    const matchCount = await runRunnerPhase(state, 'locator_evaluation', timeoutMs, () => locator.count());
    const textResult = await runRunnerPhase(state, 'text_extraction', timeoutMs, async () => (
      String(await locator.first().innerText({ timeout: timeoutMs })).replace(/\s+/g, ' ').trim()
    ));
    await runRunnerPhase(state, 'element_screenshot', timeoutMs, () => locator.first().screenshot({
      path: clipPath,
      timeout: timeoutMs,
    }));
    await runRunnerPhase(state, 'browser_close', Math.min(timeoutMs, 10_000), () => browser.close());
    browser = null;
    const clipStats = fs.statSync(clipPath);
    return {
      status: 0,
      stdout: 'local fixture smoke passed',
      stderr: '',
      smoke: {
        match_count: matchCount,
        clip_path: clipPath,
        clip_bytes: clipStats.size,
        text: textResult,
        text_extracted: Boolean(textResult),
        full_page_grab: false,
        browser_closed: true,
      },
      runtime_metadata: runnerRuntimeMetadata({
        executionPhase: null,
        timeoutMs,
        toolPath,
        startedPhases: state.started_phases,
        completedPhases: state.completed_phases,
        phaseTimingsMs: state.phase_timings_ms,
        extra: {
          local_fixture_smoke: true,
          match_count: matchCount,
          clip_bytes: clipStats.size,
          text_extracted: Boolean(textResult),
          browser_closed: true,
          full_page_grab: false,
        },
      }),
    };
  } catch (caught) {
    return failedRunnerResult({
      error: caught,
      phase: state.failed_phase || 'runner_preflight',
      state,
      timeoutMs,
      toolPath,
      extra: {
        local_fixture_smoke: true,
        full_page_grab: false,
        ...objectValue(caught.runtime_metadata),
      },
    });
  } finally {
    if (browser) {
      await browser.close().catch(() => null);
    }
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

function captureScript(input) {
  return `async page => {
  const input = ${JSON.stringify(input)};
  await page.setViewportSize(input.viewport).catch(() => null);
  await page.waitForLoadState('domcontentloaded', { timeout: input.timeout_ms }).catch(() => null);
  await page.waitForLoadState('networkidle', { timeout: Math.min(input.timeout_ms, 10000) }).catch(() => null);
  await page.waitForTimeout(1500);
  const visibilityPrecondition = input.visibility_precondition || {};
  function parseViewportHint(viewportHint) {
    if (!viewportHint) return null;
    if (typeof viewportHint === 'object') {
      const width = Number(viewportHint.width);
      const height = Number(viewportHint.height);
      return Number.isFinite(width) && Number.isFinite(height) ? { width, height } : null;
    }
    const match = String(viewportHint).match(/(\\d{3,5})\\s*[xX, ]\\s*(\\d{3,5})/);
    return match ? { width: Number(match[1]), height: Number(match[2]) } : null;
  }
  const viewportHint = parseViewportHint(visibilityPrecondition.viewport_hint);
  if (viewportHint) {
    await page.setViewportSize(viewportHint);
  }

  const currentUrl = page.url();
  const bodyText = (await page.locator('body').innerText({ timeout: 3000 }).catch(() => '')).replace(/\\s+/g, ' ').trim();
  const lowered = bodyText.toLowerCase();
  const blocker = [
    ['captcha_encountered', ['captcha', 'verify you are human']],
    ['login_required', ['sign in to continue', 'log in to continue', 'join linkedin to view']],
    ['paywall_encountered', ['subscribe to continue', 'subscription required']],
  ].find(([, needles]) => needles.some(needle => lowered.includes(needle)));
  if (blocker) {
    return {
      status: 'blocked',
      blocker_reason: blocker[0],
      current_url: currentUrl,
      title: await page.title().catch(() => null),
      match_count: 0,
      text: null,
      citation_refs: [],
      bounding_box: null,
      screenshot_written: false,
    };
  }

  function reviewedLocator(scope) {
    if (input.locator_kind === 'selector') return scope.locator(input.locator_value);
    if (input.locator_kind === 'xpath') return scope.locator('xpath=' + input.locator_value);
    if (input.locator_kind === 'playwright_locator' && input.locator_value === ${JSON.stringify(REVIEWED_LINKEDIN_LOCATOR)}) {
      return scope.getByRole('heading', { name: /Symphony Talent/i });
    }
    if (input.locator_kind === 'playwright_locator' && input.locator_value === ${JSON.stringify(PHENOM_REPAIRED_HERO_LOCATOR)}) {
      return scope.locator('main section').filter({ hasText: /AI for Tomorrow.*Applied by Human Resources/ }).first();
    }
    return null;
  }

  async function reviewedLocatorFrameCounts() {
    const frameCounts = [];
    for (const frame of page.frames()) {
      let count = 0;
      let error = null;
      try {
        const frameLocator = reviewedLocator(frame);
        count = frameLocator ? await frameLocator.count() : 0;
      } catch (caught) {
        error = String(caught && caught.message || caught).slice(0, 500);
      }
      frameCounts.push({
        url: frame.url(),
        name: frame.name() || null,
        count,
        error,
      });
    }
    return frameCounts;
  }

  const locator = reviewedLocator(page);
  if (!locator) {
    return {
      status: 'blocked',
      blocker_reason: 'reviewed_locator_not_supported',
      current_url: currentUrl,
      title: await page.title().catch(() => null),
      match_count: 0,
      text: null,
      citation_refs: [],
      bounding_box: null,
      screenshot_written: false,
    };
  }

  if (visibilityPrecondition.wait_condition) {
    await locator.first().waitFor({ state: 'visible', timeout: input.timeout_ms });
  }
  const matchCount = await locator.count().catch(() => 0);
  if (matchCount < 1) {
    await page.waitForTimeout(3500);
    const frameCounts = await reviewedLocatorFrameCounts();
    return {
      status: 'blocked',
      blocker_reason: 'reviewed_locator_matches_zero_elements',
      current_url: currentUrl,
      title: await page.title().catch(() => null),
      match_count: matchCount,
      frame_count: frameCounts.length,
      total_frame_match_count: frameCounts.reduce((sum, item) => sum + (Number.isFinite(item.count) ? item.count : 0), 0),
      frame_match_counts: frameCounts,
      text: null,
      citation_refs: [],
      bounding_box: null,
      screenshot_written: false,
    };
  }
  if (input.expected_clip_count === 1 && matchCount > 1) {
    return {
      status: 'blocked',
      blocker_reason: 'reviewed_locator_matches_ambiguous_elements_without_human_confirmation',
      current_url: currentUrl,
      title: await page.title().catch(() => null),
      match_count: matchCount,
      text: null,
      citation_refs: [],
      bounding_box: null,
      screenshot_written: false,
    };
  }

  const slotResults = [];
  for (const slot of input.slots) {
    const elementIndex = Math.min(slot.ordinal - 1, matchCount - 1);
    const element = locator.nth(elementIndex);
    if (visibilityPrecondition.scroll_strategy) {
      await element.scrollIntoViewIfNeeded({ timeout: input.timeout_ms });
    }
    const visible = await element.isVisible({ timeout: input.timeout_ms }).catch(() => false);
    if (!visible) {
      return {
        status: 'blocked',
        blocker_reason: 'reviewed_locator_element_not_visible',
        current_url: currentUrl,
        title: await page.title().catch(() => null),
        match_count: matchCount,
        text: null,
        citation_refs: [],
        bounding_box: null,
        screenshot_written: false,
      };
    }
    const boundingBox = await element.boundingBox().catch(() => null);
    let extractedText = await element.innerText({ timeout: input.timeout_ms }).catch(async () => (
      await element.textContent({ timeout: input.timeout_ms }).catch(() => '')
    ));
    extractedText = String(extractedText || '').replace(/\\s+/g, ' ').trim();
    const citationRefs = await element.locator('a[href]').evaluateAll(anchors => [...new Set(anchors.map(anchor => anchor.href).filter(Boolean))]).catch(() => []);
    await element.screenshot({ path: slot.clip_absolute_path, timeout: input.timeout_ms });
    slotResults.push({
      slot_id: slot.slot_id,
      status: 'captured',
      text: extractedText || null,
      citation_refs: citationRefs,
      bounding_box: boundingBox,
      clip_absolute_path: slot.clip_absolute_path,
    });
  }

  return {
    status: 'captured',
    blocker_reason: null,
    current_url: currentUrl,
    title: await page.title().catch(() => null),
    match_count: matchCount,
    screenshot_written: true,
    slot_results: slotResults,
  };
}`;
}

function assetPathsForSlot(unit, slot, { fixtureRoot, clipRoot, textRoot }) {
  const companySlug = slug(unit.company, 'company');
  const sourceSlug = slug(unit.source_category, 'source');
  const slotSlug = slug(slot.slot_id.replace(`${unit.work_unit_id}:`, ''), 'slot');
  const unitSlug = slug(unit.work_unit_id.replace(/^live-reviewed-capture-work-unit:/, ''), 'unit');
  const fileBase = `${unitSlug}-${slotSlug}`;
  const clipPath = path.posix.join(clipRoot, companySlug, sourceSlug, `${fileBase}.png`);
  const textPath = path.posix.join(textRoot, companySlug, sourceSlug, `${fileBase}.txt`);
  return {
    clip_path: clipPath,
    clip_absolute_path: path.join(fixtureRoot, clipPath),
    text_extract_path: textPath,
    text_extract_absolute_path: path.join(fixtureRoot, textPath),
  };
}

function captureRequiresText(captureType) {
  return ['element_text_extract', 'element_clip_and_text_extract'].includes(captureType);
}

function slotEntry({ unit, slot, paths, captureResult, slotResult, capturedAt, viewport, playwrightCli, runnerType = 'playwright-cli' }) {
  const stats = fs.statSync(paths.clip_absolute_path);
  const dimensions = pngDimensions(paths.clip_absolute_path);
  const textContent = captureRequiresText(unit.capture_type) ? slotResult.text : null;
  return {
    slot_id: slot.slot_id,
    target_id: unit.target_id,
    work_unit_id: unit.work_unit_id,
    company: unit.company,
    company_role: unit.company_role,
    source_category: unit.source_category,
    original_url: unit.original_url,
    final_url: captureResult.current_url || unit.final_url,
    reviewed_locator: cloneJson(unit.reviewed_locator),
    locator_provenance: cloneJson(unit.locator_review),
    capture_type: unit.capture_type,
    clip_path: paths.clip_path,
    text_extract_path: captureRequiresText(unit.capture_type) ? paths.text_extract_path : null,
    text_extract_content: textContent,
    kilos_relevance: cloneJson(arrayValue(unit.kilos_relevance)),
    citation_source_metadata: cloneJson(unit.citation_source_metadata),
    acceptance_criteria_refs: cloneJson(arrayValue(unit.acceptance_criteria)),
    citation_refs: cloneJson(arrayValue(slotResult.citation_refs)),
    capture_timestamp: capturedAt,
    full_page_grab: false,
    status: 'captured',
    blocker_reason: null,
    capture_metadata: {
      executor: EMPLOYER_BRAND_LIVE_EVIDENCE_ELEMENT_CAPTURE_EXECUTOR_VERSION,
      backend: runnerType,
      backend_command: playwrightCli,
      runner_type: captureResult.runtime_metadata?.runner_type || runnerType,
      runner_version: captureResult.runtime_metadata?.runner_version || null,
      locator_kind: reviewedLocatorKind(unit.reviewed_locator),
      match_count: captureResult.match_count,
      title: captureResult.title || null,
      viewport,
      bounding_box: slotResult.bounding_box || null,
      clip_bytes: stats.size,
      image_dimensions: dimensions,
      execution_phase: captureResult.runtime_metadata?.execution_phase || null,
      phase_timings_ms: captureResult.runtime_metadata?.phase_timings_ms || {},
      completed_phases: captureResult.runtime_metadata?.completed_phases || [],
      full_page_grab: false,
    },
    acceptance_checks: [
      { name: 'clip_asset_exists', status: stats.size > 0 ? 'pass' : 'fail' },
      { name: 'text_extract_present', status: captureRequiresText(unit.capture_type) && textContent ? 'pass' : 'fail' },
      { name: 'full_page_grab_false', status: 'pass' },
      { name: 'target_work_unit_linkage_present', status: unit.target_id && unit.work_unit_id ? 'pass' : 'fail' },
      { name: 'locator_provenance_present', status: unit.locator_review?.decision ? 'pass' : 'fail' },
      { name: 'kilos_citation_metadata_present', status: unit.kilos_relevance.length && unit.citation_source_metadata ? 'pass' : 'fail' },
    ],
    provenance: {
      read_only: true,
      reviewed_locator_only: true,
      approved_original_or_final_url_only: true,
      no_full_page_grab: true,
      non_goal_controls: cloneJson(NON_GOALS),
      source_capture_plan_path: unit.provenance?.source_capture_plan_path || 'live-evidence-reviewed-locator-capture-plan.json',
      source_repair_patch_path: unit.provenance?.source_repair_patch_path || null,
      source_reviewed_locator_readiness_path: unit.provenance?.source_reviewed_locator_readiness_path || null,
      source_human_locator_approval_patch_path: unit.provenance?.source_human_locator_approval_patch_path || null,
      source_url_open_run_path: unit.provenance?.source_url_open_run_path || null,
    },
  };
}

function runtimeFailureMetadata(runtimeMetadata = null, { playwrightCli }) {
  const metadata = objectValue(runtimeMetadata);
  return {
    runner_type: metadata.runner_type || metadata.backend || 'playwright-cli',
    runner_version: metadata.runner_version || null,
    failed_command_surface: metadata.command_surface_stable || metadata.command_surface || null,
    execution_phase: metadata.execution_phase || null,
    failed_phase: metadata.failed_phase || metadata.execution_phase || null,
    started_phases: Array.isArray(metadata.started_phases) ? cloneJson(metadata.started_phases) : [],
    completed_phases: Array.isArray(metadata.completed_phases) ? cloneJson(metadata.completed_phases) : [],
    phase_timings_ms: objectValue(metadata.phase_timings_ms),
    phase_timeout_ms: Number.isFinite(metadata.phase_timeout_ms) ? metadata.phase_timeout_ms : null,
    tool_path: metadata.tool_path || null,
    timeout_ms: Number.isFinite(metadata.timeout_ms) ? metadata.timeout_ms : null,
    timed_out: metadata.timed_out === true,
    exit_status: Number.isFinite(metadata.exit_status) ? metadata.exit_status : null,
    exit_signal: metadata.exit_signal || null,
    error_code: metadata.error_code || null,
    error_message: metadata.error_message || null,
    stdout_snippet: metadata.stdout_snippet || null,
    stderr_snippet: metadata.stderr_snippet || null,
    missing_browser_executable_path: metadata.missing_browser_executable_path || null,
    browser_cache_path: metadata.browser_cache_path || null,
    repair_command: metadata.repair_command || null,
    working_directory: metadata.working_directory || process.cwd(),
    retry_recommendation: metadata.repair_command || 'repair_capture_runtime_before_retry',
    environment_assumptions: {
      playwright_command: playwrightCli,
      local_command_resolution_required: true,
      shell_lookup: true,
      browser_readiness_check: metadata.browser_readiness_check === true,
      missing_browser_executable_path: metadata.missing_browser_executable_path || null,
      browser_cache_path: metadata.browser_cache_path || null,
      repair_command: metadata.repair_command || null,
    },
  };
}

function failedSlotEntry({ unit, slot, paths, reason, captureResult = null, capturedAt, viewport, playwrightCli, runtimeMetadata = null }) {
  const runtimeFailure = /^capture_command_failed:|^approved_url_open_failed:|^capture_preflight_/.test(reason);
  const requiredNextAction = runtimeFailure
    ? 'retry_after_runtime_repair'
    : reason === 'reviewed_locator_matches_zero_elements'
    ? 'human_review_new_locator_required'
    : 'review_capture_blocker_before_retry';
  return {
    slot_id: slot.slot_id,
    target_id: unit.target_id,
    work_unit_id: unit.work_unit_id,
    company: unit.company,
    company_role: unit.company_role,
    source_category: unit.source_category,
    original_url: unit.original_url,
    final_url: captureResult?.current_url || unit.final_url,
    reviewed_locator: cloneJson(unit.reviewed_locator),
    locator_provenance: cloneJson(unit.locator_review),
    capture_type: unit.capture_type,
    clip_path: null,
    text_extract_path: null,
    text_extract_content: null,
    kilos_relevance: cloneJson(arrayValue(unit.kilos_relevance)),
    citation_source_metadata: cloneJson(unit.citation_source_metadata),
    acceptance_criteria_refs: cloneJson(arrayValue(unit.acceptance_criteria)),
    citation_refs: [],
    capture_timestamp: capturedAt,
    full_page_grab: false,
    status: 'failed',
    blocker_reason: reason,
    required_next_action: requiredNextAction,
    retry_eligibility: runtimeFailure ? 'retry_after_runtime_repair' : 'requires_non_runtime_review',
    capture_metadata: {
      executor: EMPLOYER_BRAND_LIVE_EVIDENCE_ELEMENT_CAPTURE_EXECUTOR_VERSION,
      backend: runtimeMetadata?.runner_type || captureResult?.runtime_metadata?.runner_type || 'playwright-cli',
      backend_command: playwrightCli,
      locator_kind: reviewedLocatorKind(unit.reviewed_locator),
      match_count: Number.isFinite(captureResult?.match_count) ? captureResult.match_count : null,
      title: captureResult?.title || null,
      current_url: captureResult?.current_url || null,
      viewport,
      frame_count: Number.isFinite(captureResult?.frame_count) ? captureResult.frame_count : null,
      total_frame_match_count: Number.isFinite(captureResult?.total_frame_match_count) ? captureResult.total_frame_match_count : null,
      frame_match_counts: Array.isArray(captureResult?.frame_match_counts) ? cloneJson(captureResult.frame_match_counts) : [],
      clip_path_planned: paths.clip_path,
      text_extract_path_planned: captureRequiresText(unit.capture_type) ? paths.text_extract_path : null,
      ...runtimeFailureMetadata(runtimeMetadata || captureResult?.runtime_metadata, { playwrightCli }),
    },
    acceptance_checks: [
      { name: 'clip_asset_exists', status: 'fail' },
      { name: 'text_extract_present', status: captureRequiresText(unit.capture_type) ? 'fail' : 'pass' },
      { name: 'full_page_grab_false', status: 'pass' },
      { name: 'target_work_unit_linkage_present', status: 'pass' },
      { name: 'locator_provenance_present', status: unit.locator_review?.decision ? 'pass' : 'fail' },
      { name: 'kilos_citation_metadata_present', status: unit.kilos_relevance.length && unit.citation_source_metadata ? 'pass' : 'fail' },
    ],
    provenance: {
      read_only: true,
      reviewed_locator_only: true,
      approved_original_or_final_url_only: true,
      no_full_page_grab: true,
      non_goal_controls: cloneJson(NON_GOALS),
      source_capture_plan_path: unit.provenance?.source_capture_plan_path || 'live-evidence-reviewed-locator-capture-plan.json',
      source_repair_patch_path: unit.provenance?.source_repair_patch_path || null,
      source_reviewed_locator_readiness_path: unit.provenance?.source_reviewed_locator_readiness_path || null,
      source_human_locator_approval_patch_path: unit.provenance?.source_human_locator_approval_patch_path || null,
      source_url_open_run_path: unit.provenance?.source_url_open_run_path || null,
    },
  };
}

function blockedEntryFromContext(context, { capturedAt }) {
  return {
    slot_id: context.slot_id || null,
    target_id: context.target_id,
    work_unit_id: context.work_unit_id,
    company: context.company,
    company_role: context.company_role,
    source_category: context.source_category,
    original_url: context.original_url,
    final_url: context.final_url,
    reviewed_locator: null,
    locator_provenance: null,
    capture_type: context.capture_type || 'element_clip_and_text_extract',
    clip_path: null,
    text_extract_path: null,
    text_extract_content: null,
    kilos_relevance: [],
    citation_source_metadata: null,
    acceptance_criteria_refs: [],
    citation_refs: [],
    capture_timestamp: capturedAt,
    full_page_grab: false,
    status: 'blocked_not_run',
    blocker_reason: context.blocker_reason || arrayValue(context.blockers).join('; ') || context.category,
    required_next_action: context.required_next_action,
    capture_metadata: null,
    acceptance_checks: [
      { name: 'blocked_not_run_preserved', status: 'pass' },
      { name: 'full_page_grab_false', status: 'pass' },
    ],
    provenance: {
      read_only: true,
      reviewed_locator_only: false,
      approved_original_or_final_url_only: false,
      no_full_page_grab: true,
      non_goal_controls: cloneJson(NON_GOALS),
      source_capture_plan_path: 'live-evidence-reviewed-locator-capture-plan.json',
      source_context_id: context.context_id,
      source_reviewed_locator_readiness_path: context.provenance?.source_reviewed_locator_readiness_path || null,
      source_human_locator_approval_patch_path: context.provenance?.source_human_locator_approval_patch_path || null,
    },
  };
}

function buildManifest({
  capturePlan,
  entries,
  blockedEntries,
  capturedAt,
  manifestPath,
  executionGate = EXECUTION_GATE,
  capturePlanPath = 'live-evidence-reviewed-locator-capture-plan.json',
  capturePlanSchema = 'shared/schemas/employer-brand-live-evidence-reviewed-locator-capture-plan-v0.schema.json',
  executableUnitCount = capturePlan.summary.executable_unit_count,
  plannedOutputSlotCount = capturePlan.summary.planned_output_slot_count,
  expectedBlockedNotRunCount = capturePlan.summary.non_executable_context_count,
}) {
  const capturedEntries = entries.filter((entry) => entry.status === 'captured');
  const failedEntries = entries.filter((entry) => entry.status === 'failed');
  const allChecks = entries.flatMap((entry) => entry.acceptance_checks || []);
  const acceptancePassed = failedEntries.length === 0
    && capturedEntries.length === capturePlan.summary.planned_output_slot_count
    && allChecks.every((check) => check.status === 'pass');
  return {
    type: EMPLOYER_BRAND_LIVE_EVIDENCE_ELEMENT_CLIP_MANIFEST_TYPE,
    schema_version: EMPLOYER_BRAND_LIVE_EVIDENCE_ELEMENT_CLIP_MANIFEST_SCHEMA_VERSION,
    id: capturePlan.id
      .replace('live-evidence-reviewed-locator-capture-plan:', 'live-evidence-element-clip-manifest:')
      .replace('live-evidence-repaired-locator-capture-plan:', 'live-evidence-element-clip-manifest:')
      .replace('live-evidence-visibility-adjusted-capture-plan:', 'live-evidence-element-clip-manifest:'),
    label: `${capturePlan.label} Live Element Clip Manifest`,
    status: acceptancePassed && blockedEntries.length ? 'captured_with_blocked_context' : (acceptancePassed ? 'captured' : 'not_accepted'),
    source_refs: cloneJson(capturePlan.source_refs),
    capture_plan: {
      id: capturePlan.id,
      path: capturePlanPath,
      schema: capturePlanSchema,
    },
    summary: {
      executable_unit_count: executableUnitCount,
      planned_output_slot_count: plannedOutputSlotCount,
      captured_slot_count: capturedEntries.length,
      failed_slot_count: failedEntries.length,
      blocked_not_run_count: blockedEntries.length,
      total_manifest_entry_count: entries.length + blockedEntries.length,
      full_page_grab_count: [...entries, ...blockedEntries].filter((entry) => entry.full_page_grab === true).length,
      text_extract_required_count: entries.filter((entry) => captureRequiresText(entry.capture_type)).length,
      text_extract_present_count: entries.filter((entry) => captureRequiresText(entry.capture_type) && (entry.text_extract_path || entry.text_extract_content)).length,
      acceptance_passed: acceptancePassed,
    },
    entries: [...entries, ...blockedEntries],
    controls: {
      explicit_execution_gate: executionGate,
      live_element_capture_authorized: true,
      reviewed_locator_only: true,
      approved_original_or_final_url_only: true,
      full_page_grabs_authorized: false,
      autonomous_crawl_authorized: false,
      locator_codegen_authorized: false,
      locator_discovery_authorized: false,
      report_renderer_authorized: false,
      export_execution_authorized: false,
      workflow_engine_authorized: false,
      login_bypass_authorized: false,
      paywall_bypass_authorized: false,
      captcha_bypass_authorized: false,
      consent_bypass_authorized: false,
    },
    acceptance: {
      count_reconciliation_passed: capturedEntries.length === plannedOutputSlotCount
        && blockedEntries.length === expectedBlockedNotRunCount,
      full_page_grab_false: [...entries, ...blockedEntries].every((entry) => entry.full_page_grab === false),
      text_extracts_present_when_required: entries.every((entry) => !captureRequiresText(entry.capture_type) || Boolean(entry.text_extract_path || entry.text_extract_content)),
      target_work_unit_linkage_present: entries.every((entry) => Boolean(entry.target_id && entry.work_unit_id)),
      locator_provenance_present: entries.every((entry) => Boolean(entry.locator_provenance)),
      kilos_citation_metadata_present: entries.every((entry) => entry.kilos_relevance.length > 0 && Boolean(entry.citation_source_metadata)),
    },
    provenance: {
      created_at: capturedAt,
      manifest_path: toPosix(manifestPath),
      read_only_captured_evidence: true,
      no_full_page_grabs: true,
      no_report_rendering: true,
      no_export_work: true,
      no_workflow_automation: true,
      non_goals: cloneJson(NON_GOALS),
    },
  };
}

function assertGate({ executionGate, dryRun }) {
  if (dryRun) return;
  if (executionGate !== EXECUTION_GATE && executionGate !== REPAIRED_EXECUTION_GATE) {
    throw new Error(`Refusing live capture without an approved execution gate`);
  }
}

export function validateEmployerBrandLiveEvidenceElementClipManifest(manifestInput = {}) {
  const manifest = objectValue(manifestInput);
  const entries = arrayValue(manifest.entries);
  const captured = entries.filter((entry) => entry.status === 'captured');
  const blocked = entries.filter((entry) => entry.status === 'blocked_not_run');
  const errors = [];
  if (manifest.type !== EMPLOYER_BRAND_LIVE_EVIDENCE_ELEMENT_CLIP_MANIFEST_TYPE) errors.push('type must identify a Live Evidence Element Clip Manifest');
  if (manifest.schema_version !== EMPLOYER_BRAND_LIVE_EVIDENCE_ELEMENT_CLIP_MANIFEST_SCHEMA_VERSION) errors.push('schema_version must be v0');
  if (![EXECUTION_GATE, REPAIRED_EXECUTION_GATE].includes(manifest.controls?.explicit_execution_gate)) errors.push('execution gate must be recorded');
  if (manifest.controls?.full_page_grabs_authorized !== false) errors.push('full-page grabs must not be authorized');
  if (manifest.summary?.captured_slot_count !== captured.length) errors.push('captured count must reconcile');
  if (manifest.summary?.blocked_not_run_count !== blocked.length) errors.push('blocked not-run count must reconcile');
  if (manifest.summary?.full_page_grab_count !== 0) errors.push('full-page grab count must be zero');
  if (manifest.status !== 'not_accepted' && manifest.summary?.text_extract_required_count !== manifest.summary?.text_extract_present_count) errors.push('required text extracts must be present');
  if (manifest.status !== 'not_accepted' && manifest.acceptance?.count_reconciliation_passed !== true) errors.push('count reconciliation must pass');
  if (manifest.acceptance?.full_page_grab_false !== true) errors.push('full_page_grab=false acceptance must pass');
  if (manifest.status !== 'not_accepted' && manifest.acceptance?.text_extracts_present_when_required !== true) errors.push('text extract acceptance must pass');
  if (manifest.status !== 'not_accepted' && manifest.acceptance?.locator_provenance_present !== true) errors.push('locator provenance acceptance must pass');
  for (const entry of captured) {
    if (!entry.clip_path) errors.push(`${entry.slot_id} missing clip_path`);
    if (captureRequiresText(entry.capture_type) && !entry.text_extract_path && !entry.text_extract_content) errors.push(`${entry.slot_id} missing text extract`);
    if (entry.full_page_grab !== false) errors.push(`${entry.slot_id} must record full_page_grab=false`);
    if (!entry.locator_provenance) errors.push(`${entry.slot_id} missing locator provenance`);
  }
  for (const entry of blocked) {
    if (entry.clip_path || entry.text_extract_path) errors.push(`${entry.target_id} blocked entry must not point at capture assets`);
  }
  return {
    valid: errors.length === 0,
    errors,
  };
}

function diagnostic(code, message, evidence = {}) {
  return {
    code,
    message,
    evidence: cloneJson(evidence),
  };
}

export function verifyEmployerBrandLiveEvidenceElementClipManifestObjective(manifestInput = {}, {
  fixtureRoot = null,
} = {}) {
  const manifest = objectValue(manifestInput);
  const entries = arrayValue(manifest.entries);
  const captured = entries.filter((entry) => entry.status === 'captured');
  const failed = entries.filter((entry) => entry.status === 'failed');
  const blocked = entries.filter((entry) => entry.status === 'blocked_not_run');
  const validation = validateEmployerBrandLiveEvidenceElementClipManifest(manifest);
  const diagnostics = [];

  for (const error of validation.errors) {
    diagnostics.push(diagnostic('schema_or_structural_validation_failed', error));
  }
  if (manifest.summary?.executable_unit_count !== 4) {
    diagnostics.push(diagnostic('executable_unit_count_mismatch', 'Manifest must remain scoped to 4 executable units', {
      actual: manifest.summary?.executable_unit_count,
      expected: 4,
    }));
  }
  if (manifest.summary?.planned_output_slot_count !== 5) {
    diagnostics.push(diagnostic('planned_output_slot_count_mismatch', 'Manifest must remain scoped to 5 planned output slots', {
      actual: manifest.summary?.planned_output_slot_count,
      expected: 5,
    }));
  }
  if (captured.length !== 5 || manifest.summary?.captured_slot_count !== 5) {
    diagnostics.push(diagnostic('captured_slot_count_incomplete', 'All 5 planned output slots must be captured before this objective is complete', {
      captured_entries: captured.length,
      summary_captured_slot_count: manifest.summary?.captured_slot_count,
      expected: 5,
    }));
  }
  if (failed.length !== 0 || manifest.summary?.failed_slot_count !== 0) {
    diagnostics.push(diagnostic('failed_slots_present', 'No executable planned slots may remain failed in a completed live evidence capture slice', {
      failed_entries: failed.length,
      summary_failed_slot_count: manifest.summary?.failed_slot_count,
      failed_slot_ids: failed.map((entry) => entry.slot_id),
      blocker_reasons: unique(failed.map((entry) => entry.blocker_reason)),
      required_next_actions: unique(failed.map((entry) => entry.required_next_action)),
    }));
  }
  if (blocked.length !== 14 || manifest.summary?.blocked_not_run_count !== 14) {
    diagnostics.push(diagnostic('blocked_not_run_context_mismatch', 'All 14 non-executable contexts must be preserved as blocked/not-run', {
      blocked_entries: blocked.length,
      summary_blocked_not_run_count: manifest.summary?.blocked_not_run_count,
      expected: 14,
    }));
  }
  if (manifest.summary?.full_page_grab_count !== 0 || !entries.every((entry) => entry.full_page_grab === false)) {
    diagnostics.push(diagnostic('full_page_grab_scope_violation', 'Live element capture must not include full-page grabs', {
      summary_full_page_grab_count: manifest.summary?.full_page_grab_count,
    }));
  }
  if (manifest.summary?.text_extract_required_count !== manifest.summary?.text_extract_present_count) {
    diagnostics.push(diagnostic('required_text_extracts_missing', 'Every text-required captured slot must carry a text extract', {
      text_extract_required_count: manifest.summary?.text_extract_required_count,
      text_extract_present_count: manifest.summary?.text_extract_present_count,
    }));
  }
  if (manifest.acceptance?.count_reconciliation_passed !== true) {
    diagnostics.push(diagnostic('count_reconciliation_failed', 'Captured, failed, and blocked counts do not satisfy the reviewed capture plan'));
  }
  if (manifest.summary?.acceptance_passed !== true || manifest.status === 'not_accepted') {
    diagnostics.push(diagnostic('manifest_not_accepted', 'Manifest acceptance has not passed', {
      status: manifest.status,
      acceptance_passed: manifest.summary?.acceptance_passed,
    }));
  }
  if (manifest.controls?.reviewed_locator_only !== true || manifest.controls?.approved_original_or_final_url_only !== true) {
    diagnostics.push(diagnostic('scope_controls_missing', 'Manifest must prove reviewed-locator-only and approved-URL-only execution', {
      reviewed_locator_only: manifest.controls?.reviewed_locator_only,
      approved_original_or_final_url_only: manifest.controls?.approved_original_or_final_url_only,
    }));
  }
  if (manifest.controls?.report_renderer_authorized !== false || manifest.controls?.workflow_engine_authorized !== false) {
    diagnostics.push(diagnostic('non_goal_control_violation', 'Report rendering and workflow automation must remain unauthorized', {
      report_renderer_authorized: manifest.controls?.report_renderer_authorized,
      workflow_engine_authorized: manifest.controls?.workflow_engine_authorized,
    }));
  }
  if (fixtureRoot) {
    for (const entry of captured) {
      const clipExists = entry.clip_path ? fs.existsSync(path.join(fixtureRoot, entry.clip_path)) : false;
      const textExists = !captureRequiresText(entry.capture_type)
        || (entry.text_extract_path ? fs.existsSync(path.join(fixtureRoot, entry.text_extract_path)) : Boolean(entry.text_extract_content));
      if (!clipExists || !textExists) {
        diagnostics.push(diagnostic('captured_asset_missing', 'Captured entries must point at existing element clip and text assets', {
          slot_id: entry.slot_id,
          clip_path: entry.clip_path,
          clip_exists: clipExists,
          text_extract_path: entry.text_extract_path,
          text_exists: textExists,
        }));
      }
    }
  }

  return {
    status: diagnostics.length === 0 ? 'passed' : 'failed',
    passed: diagnostics.length === 0,
    diagnostics,
    summary: cloneJson(manifest.summary || {}),
  };
}

export function verifyEmployerBrandRepairedLiveEvidenceElementClipManifestObjective(manifestInput = {}, {
  fixtureRoot = null,
} = {}) {
  const manifest = objectValue(manifestInput);
  const entries = arrayValue(manifest.entries);
  const captured = entries.filter((entry) => entry.status === 'captured');
  const failed = entries.filter((entry) => entry.status === 'failed');
  const blocked = entries.filter((entry) => entry.status === 'blocked_not_run');
  const validation = validateEmployerBrandLiveEvidenceElementClipManifest(manifest);
  const diagnostics = [];

  for (const error of validation.errors) {
    diagnostics.push(diagnostic('schema_or_structural_validation_failed', error));
  }
  if (manifest.controls?.explicit_execution_gate !== REPAIRED_EXECUTION_GATE) {
    diagnostics.push(diagnostic('repaired_execution_gate_missing', 'Manifest must record the repaired live capture execution gate', {
      actual: manifest.controls?.explicit_execution_gate,
      expected: REPAIRED_EXECUTION_GATE,
    }));
  }
  if (manifest.capture_plan?.path !== 'live-evidence-repaired-locator-capture-plan.json') {
    diagnostics.push(diagnostic('capture_plan_path_mismatch', 'Manifest must point at the repaired locator capture plan'));
  }
  if (manifest.summary?.executable_unit_count !== 4 || manifest.summary?.planned_output_slot_count !== 4) {
    diagnostics.push(diagnostic('repaired_scope_count_mismatch', 'Repaired run must remain scoped to 4 executable repaired slots', {
      executable_unit_count: manifest.summary?.executable_unit_count,
      planned_output_slot_count: manifest.summary?.planned_output_slot_count,
    }));
  }
  const linkedinBlocked = blocked.find((entry) => entry.target_id === 'live-target:symphony-talent:linkedin-presence');
  if (!linkedinBlocked || linkedinBlocked.blocker_reason !== 'source_unavailable') {
    diagnostics.push(diagnostic('linkedin_unavailable_not_preserved', 'LinkedIn source-unavailable slot must remain blocked/not-run and untouched'));
  }
  if (blocked.length !== 15 || manifest.summary?.blocked_not_run_count !== 15) {
    diagnostics.push(diagnostic('blocked_not_run_context_mismatch', 'LinkedIn source-unavailable plus 14 read-only contexts must be preserved', {
      blocked_entries: blocked.length,
      summary_blocked_not_run_count: manifest.summary?.blocked_not_run_count,
      expected: 15,
    }));
  }
  if (manifest.summary?.full_page_grab_count !== 0 || !entries.every((entry) => entry.full_page_grab === false)) {
    diagnostics.push(diagnostic('full_page_grab_scope_violation', 'Repaired live element capture must not include full-page grabs', {
      summary_full_page_grab_count: manifest.summary?.full_page_grab_count,
    }));
  }
  if (captured.length + failed.length !== 4) {
    diagnostics.push(diagnostic('repaired_attempt_count_mismatch', 'Exactly 4 repaired slots must be attempted', {
      captured_entries: captured.length,
      failed_entries: failed.length,
    }));
  }
  if (manifest.summary?.text_extract_required_count !== manifest.summary?.text_extract_present_count && failed.length === 0) {
    diagnostics.push(diagnostic('required_text_extracts_missing', 'Every accepted repaired slot must carry a text extract', {
      text_extract_required_count: manifest.summary?.text_extract_required_count,
      text_extract_present_count: manifest.summary?.text_extract_present_count,
    }));
  }
  if (manifest.controls?.locator_codegen_authorized !== false || manifest.controls?.locator_discovery_authorized !== false) {
    diagnostics.push(diagnostic('locator_resolution_control_violation', 'Locator resolution/codegen must remain unauthorized'));
  }
  if (manifest.controls?.report_renderer_authorized !== false || manifest.controls?.workflow_engine_authorized !== false) {
    diagnostics.push(diagnostic('non_goal_control_violation', 'Report rendering and workflow automation must remain unauthorized'));
  }
  if (fixtureRoot) {
    for (const entry of captured) {
      const clipExists = entry.clip_path ? fs.existsSync(path.join(fixtureRoot, entry.clip_path)) : false;
      const textExists = !captureRequiresText(entry.capture_type)
        || (entry.text_extract_path ? fs.existsSync(path.join(fixtureRoot, entry.text_extract_path)) : Boolean(entry.text_extract_content));
      if (!clipExists || !textExists) {
        diagnostics.push(diagnostic('captured_asset_missing', 'Captured repaired entries must point at existing element clip and text assets', {
          slot_id: entry.slot_id,
          clip_path: entry.clip_path,
          clip_exists: clipExists,
          text_extract_path: entry.text_extract_path,
          text_exists: textExists,
        }));
      }
    }
  }

  return {
    status: diagnostics.length === 0 ? 'passed' : 'failed',
    passed: diagnostics.length === 0,
    diagnostics,
    summary: cloneJson(manifest.summary || {}),
  };
}

function repairedSlotToExecutableUnit(slot) {
  const unit = {
    ...cloneJson(slot),
    reviewed_locator: cloneJson(slot.repaired_locator),
    locator_review: {
      decision: 'approve_repaired_locator',
      repair_item_id: slot.repair_item_id,
      human_notes: slot.operator_repair_notes || null,
      provenance: cloneJson(slot.provenance || {}),
    },
    capture_type: 'element_clip_and_text_extract',
    acceptance_criteria: [
      'The captured evidence is scoped to one visible element, not the full page.',
      'The element is visibly the intended repaired evidence target.',
      'The element includes enough surrounding text to understand the employer promise out of context.',
    ],
    citation_source_metadata: {
      data_bundle_id: 'employer-brand-comparative-audit-data-bundle:symphony-talent-phenom-radancy',
      source_category: slot.source_category,
      page_name: `${slot.company} ${slot.source_category}`,
      evidence_goal: slot.evidence_goal,
      desired_element: slot.natural_language_target,
      citation: {
        source_url: slot.final_url || slot.original_url,
        provenance_only: true,
      },
    },
  };
  unit.provenance = {
    ...objectValue(unit.provenance),
    source_capture_plan_path: unit.provenance?.source_capture_plan_path || 'live-evidence-repaired-locator-capture-plan.json',
    source_url_open_run_path: 'live-evidence-url-open-run.json',
  };
  return unit;
}

function unavailableEntryFromSlot(slot, { capturedAt }) {
  return blockedEntryFromContext({
    ...slot,
    blocker_reason: 'source_unavailable',
    required_next_action: slot.human_input_needed || 'Approved alternate source URL is required before capture.',
  }, { capturedAt });
}

export async function executeEmployerBrandRepairedLiveElementCapture(capturePlanInput, {
  fixtureRoot,
  manifestPath = DEFAULT_MANIFEST_PATH,
  clipRoot = DEFAULT_CLIP_ROOT,
  textRoot = DEFAULT_TEXT_ROOT,
  playwrightCli = 'playwright-cli',
  timeoutMs = 45_000,
  viewport = DEFAULT_VIEWPORT,
  capturedAt = new Date().toISOString(),
  executionGate = null,
  dryRun = false,
  captureBackend = null,
  playwrightRunner = runPlaywright,
  runnerType = 'playwright_node_api',
  playwrightModule = null,
  slotCaptureRunner = captureEmployerBrandLiveEvidenceSlotsWithNodeApi,
} = {}) {
  if (!fixtureRoot) throw new Error('fixtureRoot is required');
  assertGate({ executionGate, dryRun });
  const capturePlan = normalizeEmployerBrandLiveEvidenceRepairedLocatorCapturePlan(capturePlanInput);
  const executableUnits = arrayValue(capturePlan.repaired_capture_slots).map(repairedSlotToExecutableUnit);
  if (executableUnits.length !== 4 || capturePlan.summary.planned_output_slot_count !== 4) {
    throw new Error('Repaired live capture V0 is scoped to exactly 4 repaired executable slots');
  }
  executableUnits.forEach((unit) => ensureReviewedLocatorAllowed(unit.reviewed_locator));
  const isVisibilityAdjustedPlan = capturePlan.type === 'aos.employer_brand_live_evidence_visibility_adjusted_capture_plan';
  const repairedCapturePlanPath = isVisibilityAdjustedPlan
    ? 'live-evidence-visibility-adjusted-capture-plan.json'
    : 'live-evidence-repaired-locator-capture-plan.json';
  const repairedCapturePlanSchema = isVisibilityAdjustedPlan
    ? 'shared/schemas/employer-brand-live-evidence-visibility-adjusted-capture-plan-v0.schema.json'
    : 'shared/schemas/employer-brand-live-evidence-repaired-locator-capture-plan-v0.schema.json';

  const blockedEntries = [
    ...arrayValue(capturePlan.unavailable_source_slots).map((slot) => unavailableEntryFromSlot(slot, { capturedAt })),
    ...arrayValue(capturePlan.non_executable_context).map((context) => blockedEntryFromContext(context, { capturedAt })),
  ];
  if (dryRun) {
    return buildManifest({
      capturePlan,
      entries: [],
      blockedEntries,
      capturedAt,
      manifestPath,
      executionGate: REPAIRED_EXECUTION_GATE,
      capturePlanPath: repairedCapturePlanPath,
      capturePlanSchema: repairedCapturePlanSchema,
      executableUnitCount: 4,
      plannedOutputSlotCount: 4,
      expectedBlockedNotRunCount: 15,
    });
  }

  const entries = [];
  if (!captureBackend && runnerType === 'playwright_node_api') {
    const localFixtureSmoke = await smokeEmployerBrandLiveEvidenceSlotCaptureRunner({
      playwrightModule,
      playwrightCommand: playwrightCli === 'playwright-cli' ? 'playwright' : playwrightCli,
      timeoutMs: Math.min(timeoutMs, 10_000),
      viewport,
    });
    if (localFixtureSmoke.status !== 0) {
      for (const unit of executableUnits) {
        const slots = arrayValue(unit.planned_outputs).map((slot) => ({
          ...slot,
          ...assetPathsForSlot(unit, slot, { fixtureRoot, clipRoot, textRoot }),
        }));
        for (const slot of slots) {
          entries.push(failedSlotEntry({
            unit,
            slot,
            paths: slot,
            reason: `capture_preflight_local_fixture_smoke_failed: ${text(localFixtureSmoke.stderr || localFixtureSmoke.stdout)}`,
            capturedAt,
            viewport,
            playwrightCli,
            runtimeMetadata: localFixtureSmoke.runtime_metadata,
          }));
        }
      }
      return buildManifest({
        capturePlan,
        entries,
        blockedEntries,
        capturedAt,
        manifestPath,
        executionGate: REPAIRED_EXECUTION_GATE,
        capturePlanPath: repairedCapturePlanPath,
        capturePlanSchema: repairedCapturePlanSchema,
        executableUnitCount: 4,
        plannedOutputSlotCount: 4,
        expectedBlockedNotRunCount: 15,
      });
    }
  } else if (!captureBackend) {
    const preflight = preflightPlaywright(playwrightCli, {
      timeout: Math.min(timeoutMs, 10_000),
      runner: playwrightRunner,
    });
    const exactInvocationSmoke = preflight.status === 0
      ? exactInvocationSmokePlaywright(playwrightCli, {
        timeout: Math.min(timeoutMs, 10_000),
        runner: playwrightRunner,
      })
      : null;
    const runtimeBlocker = preflight.status !== 0
      ? {
        reasonPrefix: 'capture_preflight_command_availability_failed',
        result: preflight,
      }
      : exactInvocationSmoke.status !== 0
      ? {
        reasonPrefix: 'capture_preflight_exact_invocation_failed',
        result: exactInvocationSmoke,
      }
      : null;
    if (runtimeBlocker) {
      for (const unit of executableUnits) {
        const slots = arrayValue(unit.planned_outputs).map((slot) => ({
          ...slot,
          ...assetPathsForSlot(unit, slot, { fixtureRoot, clipRoot, textRoot }),
        }));
        for (const slot of slots) {
          entries.push(failedSlotEntry({
            unit,
            slot,
            paths: slot,
            reason: `${runtimeBlocker.reasonPrefix}: ${text(runtimeBlocker.result.stderr || runtimeBlocker.result.stdout)}`,
            capturedAt,
            viewport,
            playwrightCli,
            runtimeMetadata: runtimeBlocker.result.runtime_metadata,
          }));
        }
      }
      return buildManifest({
        capturePlan,
        entries,
        blockedEntries,
        capturedAt,
        manifestPath,
        executionGate: REPAIRED_EXECUTION_GATE,
        capturePlanPath: repairedCapturePlanPath,
        capturePlanSchema: repairedCapturePlanSchema,
        executableUnitCount: 4,
        plannedOutputSlotCount: 4,
        expectedBlockedNotRunCount: 15,
      });
    }
  }
  for (const [unitIndex, unit] of executableUnits.entries()) {
    const session = `ebr-${process.pid}-${unitIndex}`;
    let browserOpen = false;
    try {
      const targetUrl = unit.final_url || unit.original_url;
      if (!targetUrl || ![unit.original_url, unit.final_url].includes(targetUrl)) {
        throw new Error(`${unit.work_unit_id} target URL is not an approved original/final URL`);
      }
      const nav = captureBackend || runnerType === 'playwright_node_api' ? { status: 0 } : playwrightRunner(playwrightCli, [
        `-s=${session}`,
        'open',
        targetUrl,
      ], { timeout: timeoutMs, executionPhase: 'slot_approved_url_open' });
      browserOpen = !captureBackend && runnerType !== 'playwright_node_api';
      const slots = arrayValue(unit.planned_outputs).map((slot) => ({
        ...slot,
        ...assetPathsForSlot(unit, slot, { fixtureRoot, clipRoot, textRoot }),
      }));
      for (const slot of slots) {
        fs.mkdirSync(path.dirname(slot.clip_absolute_path), { recursive: true });
        if (captureRequiresText(unit.capture_type)) fs.mkdirSync(path.dirname(slot.text_extract_absolute_path), { recursive: true });
      }
      if (nav.status !== 0) {
        for (const slot of slots) {
          entries.push(failedSlotEntry({ unit, slot, paths: slot, reason: `approved_url_open_failed: ${text(nav.stderr || nav.stdout)}`, capturedAt, viewport, playwrightCli, runtimeMetadata: nav.runtime_metadata }));
        }
        continue;
      }
      const locatorKind = reviewedLocatorKind(unit.reviewed_locator);
      const input = {
        locator_kind: locatorKind,
        locator_value: unit.reviewed_locator[locatorKind],
        expected_clip_count: 1,
        slots,
        timeout_ms: timeoutMs,
        viewport,
        visibility_precondition: cloneJson(objectValue(unit.visibility_precondition)),
      };
      const captureResult = captureBackend
        ? await captureBackend({ unit, slots, input })
        : runnerType === 'playwright_node_api'
        ? await slotCaptureRunner({
          playwrightModule,
          playwrightCommand: playwrightCli === 'playwright-cli' ? 'playwright' : playwrightCli,
          targetUrl,
          input,
          timeoutMs,
          viewport,
        })
        : (() => {
          const runCode = playwrightRunner(playwrightCli, [
            `-s=${session}`,
            'run-code',
            captureScript(input),
          ], { timeout: timeoutMs, executionPhase: 'slot_element_capture_run_code' });
          if (runCode.status !== 0) {
            return {
              status: 'blocked',
              blocker_reason: `capture_command_failed: ${text(runCode.stderr || runCode.stdout)}`,
              runtime_metadata: runCode.runtime_metadata,
              current_url: targetUrl,
              title: null,
              match_count: null,
              text: null,
              citation_refs: [],
              bounding_box: null,
              screenshot_written: false,
            };
          }
          return parseRunCodeResult(runCode.stdout || '');
        })();

      if (!sameOriginOrDomain(targetUrl, captureResult.current_url || targetUrl)) {
        for (const slot of slots) {
          entries.push(failedSlotEntry({ unit, slot, paths: slot, reason: `unexpected_redirect: ${captureResult.current_url}`, capturedAt, viewport, playwrightCli }));
        }
        continue;
      }
      if (captureResult.status !== 'captured') {
        for (const slot of slots) {
          entries.push(failedSlotEntry({
            unit,
            slot,
            paths: slot,
            reason: captureResult.blocker_reason || 'unknown_capture_blocker',
            captureResult,
            capturedAt,
            viewport,
            playwrightCli,
            runtimeMetadata: captureResult.runtime_metadata,
          }));
        }
        continue;
      }

      const resultsBySlot = new Map(arrayValue(captureResult.slot_results).map((result) => [result.slot_id, result]));
      for (const slot of slots) {
        const slotResult = resultsBySlot.get(slot.slot_id);
        if (!slotResult) throw new Error(`Capture result missing slot ${slot.slot_id}`);
        if (captureRequiresText(unit.capture_type)) {
          fs.writeFileSync(slot.text_extract_absolute_path, `${slotResult.text || ''}\n`);
        }
        entries.push(slotEntry({
          unit,
          slot,
          paths: slot,
          captureResult,
          slotResult,
          capturedAt,
          viewport,
          playwrightCli,
          runnerType,
        }));
      }
    } finally {
      if (!captureBackend && browserOpen) {
        playwrightRunner(playwrightCli, [`-s=${session}`, 'close'], { timeout: 15_000, executionPhase: 'slot_cleanup' });
      }
    }
  }

  return buildManifest({
    capturePlan,
    entries,
    blockedEntries,
    capturedAt,
    manifestPath,
    executionGate: REPAIRED_EXECUTION_GATE,
    capturePlanPath: repairedCapturePlanPath,
    capturePlanSchema: repairedCapturePlanSchema,
    executableUnitCount: 4,
    plannedOutputSlotCount: 4,
    expectedBlockedNotRunCount: 15,
  });
}

export async function executeEmployerBrandReviewedLiveElementCapture(capturePlanInput, {
  fixtureRoot,
  manifestPath = DEFAULT_MANIFEST_PATH,
  clipRoot = DEFAULT_CLIP_ROOT,
  textRoot = DEFAULT_TEXT_ROOT,
  playwrightCli = 'playwright-cli',
  timeoutMs = 45_000,
  viewport = DEFAULT_VIEWPORT,
  capturedAt = new Date().toISOString(),
  executionGate = null,
  dryRun = false,
  captureBackend = null,
} = {}) {
  if (!fixtureRoot) throw new Error('fixtureRoot is required');
  assertGate({ executionGate, dryRun });
  const capturePlan = normalizeEmployerBrandLiveEvidenceReviewedLocatorCapturePlan(capturePlanInput);
  const executableUnits = arrayValue(capturePlan.executable_units);
  if (executableUnits.length !== 4 || capturePlan.summary.planned_output_slot_count !== 5) {
    throw new Error('Reviewed live capture V0 is scoped to exactly 4 executable units and 5 planned slots');
  }
  executableUnits.forEach((unit) => ensureReviewedLocatorAllowed(unit.reviewed_locator));

  const blockedEntries = arrayValue(capturePlan.non_executable_context).map((context) => blockedEntryFromContext(context, { capturedAt }));
  if (dryRun) {
    return buildManifest({ capturePlan, entries: [], blockedEntries, capturedAt, manifestPath });
  }

  const entries = [];
  for (const [unitIndex, unit] of executableUnits.entries()) {
    const session = `employer-brand-live-element-${process.pid}-${unitIndex}`;
    let browserOpen = false;
    try {
      const targetUrl = unit.final_url || unit.original_url;
      if (!targetUrl || ![unit.original_url, unit.final_url].includes(targetUrl)) {
        throw new Error(`${unit.work_unit_id} target URL is not an approved original/final URL`);
      }
      const nav = captureBackend ? { status: 0 } : runPlaywright(playwrightCli, [
        `-s=${session}`,
        'open',
        targetUrl,
      ], { timeout: timeoutMs });
      browserOpen = true;
      const slots = arrayValue(unit.planned_outputs).map((slot) => ({
        ...slot,
        ...assetPathsForSlot(unit, slot, { fixtureRoot, clipRoot, textRoot }),
      }));
      for (const slot of slots) {
        fs.mkdirSync(path.dirname(slot.clip_absolute_path), { recursive: true });
        if (captureRequiresText(unit.capture_type)) fs.mkdirSync(path.dirname(slot.text_extract_absolute_path), { recursive: true });
      }
      if (nav.status !== 0) {
        for (const slot of slots) {
          entries.push(failedSlotEntry({
            unit,
            slot,
            paths: slot,
            reason: `approved_url_open_failed: ${text(nav.stderr || nav.stdout)}`,
            capturedAt,
            viewport,
            playwrightCli,
          }));
        }
        continue;
      }

      const locatorKind = reviewedLocatorKind(unit.reviewed_locator);
      const input = {
        locator_kind: locatorKind,
        locator_value: unit.reviewed_locator[locatorKind],
        expected_clip_count: unit.expected_clip_count,
        slots,
        timeout_ms: timeoutMs,
        viewport,
      };
      const captureResult = captureBackend
        ? await captureBackend({ unit, slots, input })
        : (() => {
          const runCode = runPlaywright(playwrightCli, [
            `-s=${session}`,
            'run-code',
            captureScript(input),
          ], { timeout: timeoutMs });
          if (runCode.status !== 0) {
            throw new Error(`Capture command failed for ${unit.work_unit_id}: ${text(runCode.stderr || runCode.stdout)}`);
          }
          return parseRunCodeResult(runCode.stdout || '');
        })();

      if (!sameOriginOrDomain(targetUrl, captureResult.current_url || targetUrl)) {
        for (const slot of slots) {
          entries.push(failedSlotEntry({
            unit,
            slot,
            paths: slot,
            reason: `unexpected_redirect: ${captureResult.current_url}`,
            capturedAt,
            viewport,
            playwrightCli,
          }));
        }
        continue;
      }
      if (captureResult.status !== 'captured') {
        for (const slot of slots) {
          entries.push(failedSlotEntry({
            unit,
            slot,
            paths: slot,
            reason: captureResult.blocker_reason || 'unknown_capture_blocker',
            captureResult,
            capturedAt,
            viewport,
            playwrightCli,
          }));
        }
        continue;
      }

      const resultsBySlot = new Map(arrayValue(captureResult.slot_results).map((result) => [result.slot_id, result]));
      for (const slot of slots) {
        const slotResult = resultsBySlot.get(slot.slot_id);
        if (!slotResult) throw new Error(`Capture result missing slot ${slot.slot_id}`);
        if (captureRequiresText(unit.capture_type)) {
          fs.writeFileSync(slot.text_extract_absolute_path, `${slotResult.text || ''}\n`);
        }
        entries.push(slotEntry({
          unit,
          slot,
          paths: slot,
          captureResult,
          slotResult,
          capturedAt,
          viewport,
          playwrightCli,
        }));
      }
    } finally {
      if (!captureBackend && browserOpen) {
        runPlaywright(playwrightCli, [`-s=${session}`, 'close'], { timeout: 15_000 });
      }
    }
  }

  return buildManifest({ capturePlan, entries, blockedEntries, capturedAt, manifestPath });
}

export function writeEmployerBrandLiveEvidenceElementClipManifest(manifest, { fixtureRoot, manifestPath = DEFAULT_MANIFEST_PATH }) {
  const absolutePath = path.join(fixtureRoot, manifestPath);
  fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
  fs.writeFileSync(absolutePath, `${JSON.stringify(manifest, null, 2)}\n`);
  return absolutePath;
}

export function loadEmployerBrandLiveEvidenceElementClipManifest({ fixtureRoot, manifestPath = DEFAULT_MANIFEST_PATH } = {}) {
  if (!fixtureRoot) throw new Error('fixtureRoot is required');
  return JSON.parse(fs.readFileSync(path.join(fixtureRoot, manifestPath), 'utf8'));
}
