import fs from 'node:fs';
import path from 'node:path';

import {
  BROWSER_EVIDENCE_CAPTURE_COLLECTOR_VERSION,
  BROWSER_EVIDENCE_CAPTURE_MANIFEST_TYPE,
  BROWSER_EVIDENCE_CAPTURE_SCHEMA_VERSION,
  BROWSER_EVIDENCE_REGISTRY_TYPE,
  DEFAULT_VIEWPORT,
  assetPathsForRequest,
  baseMetadata,
  candidateInputs,
  createBrowserEvidenceRegistry,
  evidenceBase,
  finalizeStatus,
  invalidEvidence,
  normalizeBrowserEvidenceCaptureManifest,
  normalizeRequest,
  resolveSourceUrl,
} from './browser-evidence-model.js';

function failure(base, code, message, caveat, metadata, selectorResolution = base.selector_resolution) {
  return { ...base, status: 'capture_failed', error: { code, message }, caveat, selector_resolution: selectorResolution, capture_metadata: metadata };
}

function initialResolution(candidates) {
  return {
    strategy: candidates.map((candidate) => candidate.kind).join('_then_') || 'none',
    candidates: candidates.map((candidate) => ({ ...candidate, match_count: 0, error: null })),
    used: null,
  };
}

function operationMetadata(source, operation, startedAt, completedAt, viewport, screenshotBytes = null) {
  return baseMetadata({
    browser: 'chromium', viewport, source_url_kind: source.source_url_kind,
    started_at: startedAt, completed_at: completedAt,
    duration_ms: Math.max(0, Date.parse(completedAt) - Date.parse(startedAt)),
    session_generation: operation?.receipt?.session_generation ?? null,
    descriptor_sha256: operation?.receipt?.backend_identity?.descriptor_sha256 ?? null,
    closure_sha256: operation?.receipt?.backend_identity?.closure_sha256 ?? null,
    screenshot_bytes: screenshotBytes,
  });
}

export async function captureBrowserEvidenceRequest(requestInput, options = {}) {
  const capturedAt = new Date().toISOString();
  let request;
  try { request = normalizeRequest(requestInput); }
  catch (error) { return invalidEvidence(requestInput, capturedAt, error.message); }

  const base = evidenceBase(request, capturedAt);
  const candidates = candidateInputs(request);
  if (candidates.length === 0) {
    return {
      ...base, status: 'invalid_request', error: { code: 'locator_required', message: 'A capture request must include selector or xpath.' },
      caveat: 'No browser navigation was attempted because the request has no locator.',
      selector_resolution: initialResolution(candidates), capture_metadata: baseMetadata(),
    };
  }
  if (typeof options.managedEvidenceOperation !== 'function' || !options.sessionId) {
    return failure(base, 'managed_session_required', 'A managed browser session is required.', 'No browser operation was attempted.', baseMetadata(), initialResolution(candidates));
  }

  const startedAt = new Date().toISOString();
  let source;
  try { source = resolveSourceUrl(request.url, options.cwd ?? process.cwd()); }
  catch {
    const completedAt = new Date().toISOString();
    return failure(base, 'source_url_unreadable', 'The local fixture URL is unreadable.', 'No browser operation was attempted.', operationMetadata({ source_url_kind: 'unreadable' }, null, startedAt, completedAt, options.viewport ?? DEFAULT_VIEWPORT), initialResolution(candidates));
  }
  if (source.blocked) {
    const completedAt = new Date().toISOString();
    return {
      ...base, status: 'blocked_non_local_url',
      error: { code: 'non_local_url_blocked', message: 'Only file, data, localhost, or relative fixture URLs are accepted.' },
      caveat: 'No navigation was attempted because the URL is outside the local fixture policy.',
      selector_resolution: initialResolution(candidates),
      capture_metadata: operationMetadata(source, null, startedAt, completedAt, options.viewport ?? DEFAULT_VIEWPORT),
    };
  }

  let operation;
  try {
    operation = await options.managedEvidenceOperation(options.sessionId, { url: source.browser_url, candidates });
  } catch {
    const completedAt = new Date().toISOString();
    return failure(base, 'managed_capture_failed', 'The managed browser evidence operation failed.', 'The session remains governed by managed lifecycle recovery.', operationMetadata(source, null, startedAt, completedAt, options.viewport ?? DEFAULT_VIEWPORT), initialResolution(candidates));
  }
  const result = operation?.result;
  const completedAt = new Date().toISOString();
  if (!result || !['captured', 'missing_selector'].includes(result.status) || !result.selector_resolution) {
    return failure(base, 'managed_capture_invalid', 'The managed browser evidence result is invalid.', 'No evidence artifact was accepted.', operationMetadata(source, operation, startedAt, completedAt, options.viewport ?? DEFAULT_VIEWPORT), initialResolution(candidates));
  }
  if (result.status === 'missing_selector') {
    return {
      ...base, status: 'missing_selector', error: { code: 'selector_not_found', message: 'No locator candidate matched an element.' },
      caveat: 'No screenshot was accepted because the locator did not resolve.',
      selector_resolution: result.selector_resolution,
      capture_metadata: operationMetadata(source, operation, startedAt, completedAt, options.viewport ?? DEFAULT_VIEWPORT),
    };
  }
  if (!Buffer.isBuffer(operation.screenshot) || operation.screenshot.length === 0) {
    return failure(base, 'managed_screenshot_missing', 'The managed screenshot artifact is missing.', 'Element metadata was observed without a screenshot artifact.', operationMetadata(source, operation, startedAt, completedAt, options.viewport ?? DEFAULT_VIEWPORT), result.selector_resolution);
  }
  const paths = assetPathsForRequest(request, options.assetDir ?? 'evidence', options.outputDir ?? process.cwd());
  fs.mkdirSync(path.dirname(paths.screenshot_absolute_path), { recursive: true });
  fs.writeFileSync(paths.screenshot_absolute_path, operation.screenshot, { mode: 0o600 });
  return {
    ...base, extracted_text: result.extracted_text || null, screenshot_path: paths.screenshot_path,
    status: finalizeStatus(result.status), error: null,
    caveat: 'The screenshot is a managed viewport capture; selector bounds identify the evidence element.',
    selector_resolution: result.selector_resolution,
    capture_metadata: operationMetadata(source, operation, startedAt, completedAt, options.viewport ?? DEFAULT_VIEWPORT, operation.screenshot.length),
  };
}

export async function captureBrowserEvidenceManifest(manifestInput, options = {}) {
  const manifest = normalizeBrowserEvidenceCaptureManifest(manifestInput);
  const outputDir = options.outputPath ? path.dirname(path.resolve(options.outputPath)) : (options.outputDir ?? process.cwd());
  const evidence = [];
  for (const request of manifest.requests) {
    evidence.push(await captureBrowserEvidenceRequest(request, { ...options, outputDir }));
  }
  return createBrowserEvidenceRegistry(manifest, evidence, {
    sessionGeneration: evidence.find((item) => item.capture_metadata.session_generation)?.capture_metadata.session_generation ?? null,
  });
}

export {
  BROWSER_EVIDENCE_CAPTURE_COLLECTOR_VERSION,
  BROWSER_EVIDENCE_CAPTURE_MANIFEST_TYPE,
  BROWSER_EVIDENCE_CAPTURE_SCHEMA_VERSION,
  BROWSER_EVIDENCE_REGISTRY_TYPE,
  createBrowserEvidenceRegistry,
  normalizeBrowserEvidenceCaptureManifest,
};
