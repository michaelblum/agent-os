import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const BROWSER_EVIDENCE_CAPTURE_SCHEMA_VERSION = '2026-05-browser-evidence-capture-v0';
export const BROWSER_EVIDENCE_CAPTURE_COLLECTOR_VERSION = '2026-05-browser-evidence-capture-v0';
export const BROWSER_EVIDENCE_CAPTURE_MANIFEST_TYPE = 'aos.browser_evidence_capture_manifest';
export const BROWSER_EVIDENCE_REGISTRY_TYPE = 'aos.browser_evidence_registry';

const DEFAULT_VIEWPORT = {
  width: 1440,
  height: 900,
};

const CAPTURE_STATUSES = new Set([
  'captured',
  'missing_selector',
  'invalid_request',
  'blocked_non_local_url',
  'capture_failed',
]);

let captureSessionCounter = 0;

function text(value, fallback = '') {
  const normalized = String(value ?? '').replace(/\s+/g, ' ').trim();
  return normalized || fallback;
}

function optionalText(value) {
  const normalized = text(value);
  return normalized || null;
}

function requireText(value, label) {
  const normalized = text(value);
  if (!normalized) throw new TypeError(`${label} is required`);
  return normalized;
}

function stringArray(value) {
  if (!Array.isArray(value)) return [];
  return value.map((item) => text(item)).filter(Boolean);
}

function objectValue(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function slug(value = '', fallback = 'capture') {
  return text(value, fallback)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 96) || fallback;
}

function toPosix(relativePath) {
  return relativePath.split(path.sep).join('/');
}

function parseUrl(value) {
  try {
    return new URL(value);
  } catch {
    return null;
  }
}

function isLocalHttpUrl(url) {
  if (!['http:', 'https:'].includes(url.protocol)) return false;
  return ['localhost', '127.0.0.1', '::1', '[::1]'].includes(url.hostname);
}

function dataUrlForHtmlFile(filePath) {
  const source = fs.readFileSync(filePath);
  return `data:text/html;base64,${source.toString('base64')}`;
}

function resolveSourceUrl(rawUrl, { cwd = process.cwd() } = {}) {
  const requestedUrl = requireText(rawUrl, 'request url');
  const parsed = parseUrl(requestedUrl);

  if (parsed?.protocol === 'data:') {
    return {
      source_url: requestedUrl,
      browser_url: requestedUrl,
      source_url_kind: 'data_url',
      resolved_source_url: requestedUrl,
    };
  }

  if (parsed?.protocol === 'file:') {
    const filePath = fileURLToPath(parsed);
    return {
      source_url: requestedUrl,
      browser_url: dataUrlForHtmlFile(filePath),
      source_url_kind: 'file_url',
      resolved_source_url: parsed.href,
    };
  }

  if (parsed && isLocalHttpUrl(parsed)) {
    return {
      source_url: requestedUrl,
      browser_url: requestedUrl,
      source_url_kind: 'local_http_url',
      resolved_source_url: parsed.href,
    };
  }

  if (parsed) {
    return {
      source_url: requestedUrl,
      browser_url: null,
      source_url_kind: 'blocked_remote_url',
      resolved_source_url: parsed.href,
      blocked: true,
      error: {
        code: 'non_local_url_blocked',
        message: 'Browser Evidence Capture V0 only accepts file, data, localhost, or relative fixture URLs.',
      },
    };
  }

  const filePath = path.resolve(cwd, requestedUrl);
  return {
    source_url: requestedUrl,
    browser_url: dataUrlForHtmlFile(filePath),
    source_url_kind: 'relative_file',
    resolved_source_url: pathToFileURL(filePath).href,
  };
}

function normalizeRequest(request) {
  const source = objectValue(request);
  return {
    request_id: requireText(source.request_id, 'request_id'),
    company: requireText(source.company, 'company'),
    source_category: requireText(source.source_category, 'source_category'),
    url: requireText(source.url, 'url'),
    selector: optionalText(source.selector),
    xpath: optionalText(source.xpath),
    evidence_goal: requireText(source.evidence_goal, 'evidence_goal'),
    kilos_relevance: stringArray(source.kilos_relevance),
    kilos_factors: stringArray(source.kilos_factors),
    notes: optionalText(source.notes),
  };
}

export function normalizeBrowserEvidenceCaptureManifest(manifest) {
  const source = objectValue(manifest);
  const requests = Array.isArray(source.requests) ? source.requests : [];
  return {
    type: text(source.type, BROWSER_EVIDENCE_CAPTURE_MANIFEST_TYPE),
    schema_version: text(source.schema_version, BROWSER_EVIDENCE_CAPTURE_SCHEMA_VERSION),
    manifest_id: optionalText(source.manifest_id),
    audit_id: optionalText(source.audit_id),
    created_at: optionalText(source.created_at),
    description: optionalText(source.description),
    requests: requests.map(normalizeRequest),
    metadata: objectValue(source.metadata),
  };
}

function evidenceBase(request, capturedAt) {
  return {
    request_id: request.request_id,
    company: request.company,
    source_category: request.source_category,
    source_url: request.url,
    url: request.url,
    evidence_goal: request.evidence_goal,
    kilos_relevance: request.kilos_relevance,
    kilos_factors: request.kilos_factors,
    notes: request.notes,
    captured_at: capturedAt,
    selector: request.selector,
    xpath: request.xpath,
    extracted_text: null,
    screenshot_path: null,
    status: 'capture_failed',
    error: null,
    caveat: null,
    selector_resolution: {
      strategy: 'unresolved',
      candidates: [],
      used: null,
    },
    capture_metadata: {},
  };
}

function assetPathsForRequest(request, {
  assetDir = 'evidence',
  outputDir = process.cwd(),
} = {}) {
  const companySlug = slug(request.company, 'company');
  const requestSlug = slug(request.request_id, 'request');
  const assetRoot = path.isAbsolute(assetDir)
    ? assetDir
    : path.resolve(outputDir, assetDir);
  const relativeRoot = path.isAbsolute(assetDir)
    ? toPosix(path.relative(outputDir, assetDir))
    : toPosix(assetDir);
  const relativePath = path.posix.join(relativeRoot || '.', companySlug, `${requestSlug}.png`);
  const absolutePath = path.join(assetRoot, companySlug, `${requestSlug}.png`);
  return {
    screenshot_path: relativePath,
    screenshot_absolute_path: absolutePath,
  };
}

function runPlaywright(playwrightCli, args, { timeout = 30_000 } = {}) {
  const result = spawnSync(playwrightCli, args, {
    encoding: 'utf8',
    timeout,
    maxBuffer: 10 * 1024 * 1024,
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

function createPlaywrightSessionName(sessionPrefix) {
  captureSessionCounter = (captureSessionCounter + 1) % Number.MAX_SAFE_INTEGER;
  const prefix = slug(sessionPrefix, 'capture').slice(0, 8);
  const pid = process.pid.toString(36);
  const counter = captureSessionCounter.toString(36);
  const timestamp = Date.now().toString(36);
  // playwright-cli derives short socket names from the leading session text.
  return `${prefix}-${pid}-${counter}-${timestamp}`;
}

function parseRunCodeResult(stdout) {
  const marker = '### Result\n';
  const start = stdout.indexOf(marker);
  if (start < 0) {
    throw new Error('playwright-cli run-code did not return a result block');
  }
  const rest = stdout.slice(start + marker.length);
  const end = rest.indexOf('\n### ');
  const jsonText = (end >= 0 ? rest.slice(0, end) : rest).trim();
  return JSON.parse(jsonText);
}

function candidateInputsFor(request) {
  const candidates = [];
  if (request.selector) {
    candidates.push({
      kind: 'css',
      value: request.selector,
    });
  }
  if (request.xpath) {
    candidates.push({
      kind: 'xpath',
      value: request.xpath,
    });
  }
  return candidates;
}

function captureScript(input) {
  return `async page => {
  const input = ${JSON.stringify(input)};
  await page.waitForLoadState('domcontentloaded', { timeout: input.timeout_ms }).catch(() => null);
  const candidates = [];
  let used = null;
  const locatorFor = candidate => candidate.kind === 'xpath'
    ? page.locator('xpath=' + candidate.value)
    : page.locator(candidate.value);

  for (const candidate of input.candidates) {
    let matchCount = 0;
    let error = null;
    try {
      matchCount = await locatorFor(candidate).count();
    } catch (caught) {
      error = caught?.message || String(caught);
    }
    const resolved = {
      kind: candidate.kind,
      value: candidate.value,
      match_count: matchCount,
      error,
    };
    candidates.push(resolved);
    if (!used && !error && matchCount > 0) used = resolved;
  }

  const strategy = input.candidates.map(candidate => candidate.kind).join('_then_') || 'none';
  if (!used) {
    return {
      status: 'missing_selector',
      extracted_text: null,
      screenshot_written: false,
      page_url: page.url(),
      bounding_box: null,
      visible: false,
      error: {
        code: 'selector_not_found',
        message: 'No CSS selector or XPath candidate matched an element.',
      },
      caveat: 'No element crop was captured because the selector did not resolve.',
      selector_resolution: {
        strategy,
        candidates,
        used: null,
      },
    };
  }

  const locator = locatorFor(used).first();
  await locator.scrollIntoViewIfNeeded({ timeout: input.timeout_ms }).catch(() => null);
  const visible = await locator.isVisible({ timeout: input.timeout_ms }).catch(() => false);
  let extractedText = '';
  try {
    extractedText = await locator.innerText({ timeout: input.timeout_ms });
  } catch {
    extractedText = await locator.textContent({ timeout: input.timeout_ms }).catch(() => '') || '';
  }
  extractedText = extractedText.replace(/\\s+/g, ' ').trim();
  const boundingBox = await locator.boundingBox().catch(() => null);

  try {
    await locator.screenshot({ path: input.screenshot_path, timeout: input.timeout_ms });
  } catch (caught) {
    return {
      status: 'capture_failed',
      extracted_text: extractedText,
      screenshot_written: false,
      page_url: page.url(),
      bounding_box: boundingBox,
      visible,
      error: {
        code: 'element_screenshot_failed',
        message: caught?.message || String(caught),
      },
      caveat: 'The element resolved, but Playwright could not write the screenshot crop.',
      selector_resolution: {
        strategy,
        candidates,
        used: {
          kind: used.kind,
          value: used.value,
          index: 0,
          match_count: used.match_count,
        },
      },
    };
  }

  return {
    status: 'captured',
    extracted_text: extractedText,
    screenshot_written: true,
    page_url: page.url(),
    bounding_box: boundingBox,
    visible,
    error: null,
    caveat: visible ? null : 'The element was captured, but Playwright reported it was not visible before the screenshot call.',
    selector_resolution: {
      strategy,
      candidates,
      used: {
        kind: used.kind,
        value: used.value,
        index: 0,
        match_count: used.match_count,
      },
    },
  };
}`;
}

function requestMetadata({
  source,
  session,
  playwrightCli,
  result = {},
  startedAt,
  completedAt,
  viewport,
}) {
  return {
    collector: BROWSER_EVIDENCE_CAPTURE_COLLECTOR_VERSION,
    backend: 'playwright-cli',
    backend_command: playwrightCli,
    browser: 'chromium',
    headless: true,
    viewport,
    local_url_policy: 'file_data_or_localhost_only',
    autonomous_browsing: false,
    playwright_session: session,
    source_url_kind: source.source_url_kind,
    resolved_source_url: source.resolved_source_url,
    page_url: result.page_url || null,
    started_at: startedAt,
    completed_at: completedAt,
    duration_ms: Date.parse(completedAt) - Date.parse(startedAt),
    bounding_box: result.bounding_box || null,
    visible: result.visible ?? null,
  };
}

function finalizeStatus(status) {
  return CAPTURE_STATUSES.has(status) ? status : 'capture_failed';
}

export function captureBrowserEvidenceRequest(requestInput, {
  assetDir = 'evidence',
  cwd = process.cwd(),
  outputDir = process.cwd(),
  playwrightCli = 'playwright-cli',
  sessionPrefix = 'browser-evidence',
  timeoutMs = 30_000,
  viewport = DEFAULT_VIEWPORT,
} = {}) {
  let request;
  const capturedAt = new Date().toISOString();
  try {
    request = normalizeRequest(requestInput);
  } catch (caught) {
    return {
      request_id: text(objectValue(requestInput).request_id, 'unknown-request'),
      company: text(objectValue(requestInput).company, 'Unknown'),
      source_category: text(objectValue(requestInput).source_category, 'unknown'),
      source_url: text(objectValue(requestInput).url),
      url: text(objectValue(requestInput).url),
      evidence_goal: text(objectValue(requestInput).evidence_goal),
      kilos_relevance: stringArray(objectValue(requestInput).kilos_relevance),
      kilos_factors: stringArray(objectValue(requestInput).kilos_factors),
      notes: optionalText(objectValue(requestInput).notes),
      captured_at: capturedAt,
      selector: optionalText(objectValue(requestInput).selector),
      xpath: optionalText(objectValue(requestInput).xpath),
      extracted_text: null,
      screenshot_path: null,
      status: 'invalid_request',
      error: {
        code: 'invalid_request',
        message: caught.message,
      },
      caveat: 'The request did not include the fields required for a browser evidence capture.',
      selector_resolution: {
        strategy: 'invalid_request',
        candidates: [],
        used: null,
      },
      capture_metadata: {
        collector: BROWSER_EVIDENCE_CAPTURE_COLLECTOR_VERSION,
        backend: 'playwright-cli',
        local_url_policy: 'file_data_or_localhost_only',
        autonomous_browsing: false,
      },
    };
  }

  const base = evidenceBase(request, capturedAt);
  const startedAt = new Date().toISOString();
  const candidates = candidateInputsFor(request);
  if (candidates.length === 0) {
    return {
      ...base,
      status: 'invalid_request',
      error: {
        code: 'locator_required',
        message: 'A capture request must include selector or xpath.',
      },
      caveat: 'No browser navigation was attempted because the request has no locator.',
      selector_resolution: {
        strategy: 'none',
        candidates: [],
        used: null,
      },
      capture_metadata: {
        collector: BROWSER_EVIDENCE_CAPTURE_COLLECTOR_VERSION,
        backend: 'playwright-cli',
        local_url_policy: 'file_data_or_localhost_only',
        autonomous_browsing: false,
      },
    };
  }

  let source;
  try {
    source = resolveSourceUrl(request.url, { cwd });
  } catch (caught) {
    const completedAt = new Date().toISOString();
    return {
      ...base,
      status: 'capture_failed',
      error: {
        code: 'source_url_unreadable',
        message: caught.message,
      },
      caveat: 'The local fixture URL could not be read before browser capture.',
      selector_resolution: {
        strategy: candidates.map((candidate) => candidate.kind).join('_then_'),
        candidates: candidates.map((candidate) => ({
          ...candidate,
          match_count: 0,
          error: null,
        })),
        used: null,
      },
      capture_metadata: requestMetadata({
        source: {
          source_url_kind: 'unreadable',
          resolved_source_url: request.url,
        },
        session: null,
        playwrightCli,
        startedAt,
        completedAt,
        viewport,
      }),
    };
  }

  if (source.blocked) {
    const completedAt = new Date().toISOString();
    return {
      ...base,
      status: 'blocked_non_local_url',
      error: source.error,
      caveat: 'No navigation was attempted because Browser Evidence Capture V0 is restricted to local fixture URLs.',
      selector_resolution: {
        strategy: candidates.map((candidate) => candidate.kind).join('_then_'),
        candidates: candidates.map((candidate) => ({
          ...candidate,
          match_count: 0,
          error: null,
        })),
        used: null,
      },
      capture_metadata: requestMetadata({
        source,
        session: null,
        playwrightCli,
        startedAt,
        completedAt,
        viewport,
      }),
    };
  }

  const session = createPlaywrightSessionName(sessionPrefix);
  const paths = assetPathsForRequest(request, { assetDir, outputDir });
  fs.mkdirSync(path.dirname(paths.screenshot_absolute_path), { recursive: true });

  const open = runPlaywright(playwrightCli, [
    `-s=${session}`,
    'open',
    source.browser_url,
  ], { timeout: timeoutMs });

  if (open.status !== 0) {
    const completedAt = new Date().toISOString();
    return {
      ...base,
      status: 'capture_failed',
      error: {
        code: 'browser_open_failed',
        message: text(open.stderr || open.stdout, 'playwright-cli open failed'),
      },
      caveat: 'Playwright could not open the local fixture URL.',
      selector_resolution: {
        strategy: candidates.map((candidate) => candidate.kind).join('_then_'),
        candidates: candidates.map((candidate) => ({
          ...candidate,
          match_count: 0,
          error: null,
        })),
        used: null,
      },
      capture_metadata: requestMetadata({
        source,
        session,
        playwrightCli,
        startedAt,
        completedAt,
        viewport,
      }),
    };
  }

  try {
    const runCode = runPlaywright(playwrightCli, [
      `-s=${session}`,
      'run-code',
      captureScript({
        candidates,
        screenshot_path: paths.screenshot_absolute_path,
        timeout_ms: timeoutMs,
      }),
    ], { timeout: timeoutMs });

    if (runCode.status !== 0) {
      const completedAt = new Date().toISOString();
      return {
        ...base,
        status: 'capture_failed',
        error: {
          code: 'browser_capture_failed',
          message: text(runCode.stderr || runCode.stdout, 'playwright-cli run-code failed'),
        },
        caveat: 'Playwright failed before returning selector resolution metadata.',
        capture_metadata: requestMetadata({
          source,
          session,
          playwrightCli,
          startedAt,
          completedAt,
          viewport,
        }),
      };
    }

    const result = parseRunCodeResult(runCode.stdout || '');
    const completedAt = new Date().toISOString();
    const screenshotPath = result.screenshot_written ? paths.screenshot_path : null;
    const screenshotStats = result.screenshot_written
      ? fs.statSync(paths.screenshot_absolute_path)
      : null;

    return {
      ...base,
      extracted_text: result.extracted_text || null,
      screenshot_path: screenshotPath,
      status: finalizeStatus(result.status),
      error: result.error || null,
      caveat: result.caveat || null,
      selector_resolution: result.selector_resolution,
      capture_metadata: {
        ...requestMetadata({
          source,
          session,
          playwrightCli,
          result,
          startedAt,
          completedAt,
          viewport,
        }),
        screenshot_bytes: screenshotStats?.size ?? null,
      },
    };
  } catch (caught) {
    const completedAt = new Date().toISOString();
    return {
      ...base,
      status: 'capture_failed',
      error: {
        code: 'capture_result_parse_failed',
        message: caught.message,
      },
      caveat: 'Playwright ran, but the collector could not parse the returned capture metadata.',
      capture_metadata: requestMetadata({
        source,
        session,
        playwrightCli,
        startedAt,
        completedAt,
        viewport,
      }),
    };
  } finally {
    runPlaywright(playwrightCli, [`-s=${session}`, 'close'], { timeout: 15_000 });
  }
}

function summarizeEvidence(evidence) {
  const byStatus = {};
  for (const item of evidence) {
    byStatus[item.status] = (byStatus[item.status] || 0) + 1;
  }
  return {
    request_count: evidence.length,
    captured_count: byStatus.captured || 0,
    failed_count: evidence.length - (byStatus.captured || 0),
    by_status: byStatus,
  };
}

export function createBrowserEvidenceRegistry(manifest, evidence, {
  generatedAt = new Date().toISOString(),
  outputDir = process.cwd(),
  playwrightCli = 'playwright-cli',
} = {}) {
  const summary = summarizeEvidence(evidence);
  return {
    type: BROWSER_EVIDENCE_REGISTRY_TYPE,
    schema_version: BROWSER_EVIDENCE_CAPTURE_SCHEMA_VERSION,
    generated_at: generatedAt,
    status: summary.failed_count > 0 ? 'completed_with_failures' : 'completed',
    manifest: {
      type: manifest.type,
      schema_version: manifest.schema_version,
      manifest_id: manifest.manifest_id,
      audit_id: manifest.audit_id,
      request_count: manifest.requests.length,
    },
    summary,
    evidence,
    capture_metadata: {
      collector: BROWSER_EVIDENCE_CAPTURE_COLLECTOR_VERSION,
      backend: 'playwright-cli',
      backend_command: playwrightCli,
      output_root: outputDir,
      local_url_policy: 'file_data_or_localhost_only',
      autonomous_browsing: false,
    },
  };
}

export function captureBrowserEvidenceManifest(manifestInput, {
  assetDir = 'evidence',
  cwd = process.cwd(),
  outputDir = process.cwd(),
  outputPath = null,
  playwrightCli = 'playwright-cli',
  timeoutMs = 30_000,
  viewport = DEFAULT_VIEWPORT,
} = {}) {
  const manifest = normalizeBrowserEvidenceCaptureManifest(manifestInput);
  const registryOutputDir = outputPath ? path.dirname(path.resolve(outputPath)) : outputDir;
  const evidence = manifest.requests.map((request) => captureBrowserEvidenceRequest(request, {
    assetDir,
    cwd,
    outputDir: registryOutputDir,
    playwrightCli,
    timeoutMs,
    viewport,
  }));
  return createBrowserEvidenceRegistry(manifest, evidence, {
    outputDir: registryOutputDir,
    playwrightCli,
  });
}

export function playwrightCliAvailable(playwrightCli = 'playwright-cli') {
  const probe = runPlaywright(playwrightCli, ['--version'], { timeout: 10_000 });
  return probe.status === 0;
}
