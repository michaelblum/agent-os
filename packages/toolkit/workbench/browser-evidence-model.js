import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const BROWSER_EVIDENCE_CAPTURE_SCHEMA_VERSION = '2026-05-browser-evidence-capture-v0';
export const BROWSER_EVIDENCE_CAPTURE_COLLECTOR_VERSION = '2026-05-browser-evidence-capture-v0';
export const BROWSER_EVIDENCE_CAPTURE_MANIFEST_TYPE = 'aos.browser_evidence_capture_manifest';
export const BROWSER_EVIDENCE_REGISTRY_TYPE = 'aos.browser_evidence_registry';
export const DEFAULT_VIEWPORT = Object.freeze({ width: 1440, height: 900 });
export const MAX_LOCAL_FIXTURE_BYTES = 3000;
const NOFOLLOW = fs.constants.O_NOFOLLOW ?? 0;

const CAPTURE_STATUSES = new Set([
  'captured', 'missing_selector', 'invalid_request', 'blocked_non_local_url', 'capture_failed',
]);

export function text(value, fallback = '') {
  const normalized = String(value ?? '').replace(/\s+/g, ' ').trim();
  return normalized || fallback;
}

function optionalText(value) {
  return text(value) || null;
}

function requireText(value, label) {
  const normalized = text(value);
  if (!normalized) throw new TypeError(`${label} is required`);
  return normalized;
}

export function objectValue(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function stringArray(value) {
  if (!Array.isArray(value)) return [];
  return value.map((item) => text(item)).filter(Boolean);
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
    evidence_dimensions: stringArray(source.evidence_dimensions),
    evidence_factors: stringArray(source.evidence_factors),
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

export function invalidEvidence(requestInput, capturedAt, message) {
  const source = objectValue(requestInput);
  return {
    request_id: text(source.request_id, 'unknown-request'),
    company: text(source.company, 'Unknown'),
    source_category: text(source.source_category, 'unknown'),
    source_url: text(source.url), url: text(source.url),
    evidence_goal: text(source.evidence_goal),
    evidence_dimensions: stringArray(source.evidence_dimensions),
    evidence_factors: stringArray(source.evidence_factors), notes: optionalText(source.notes),
    captured_at: capturedAt, selector: optionalText(source.selector), xpath: optionalText(source.xpath),
    extracted_text: null, screenshot_path: null, status: 'invalid_request',
    error: { code: 'invalid_request', message },
    caveat: 'The request did not include the fields required for a browser evidence capture.',
    selector_resolution: { strategy: 'invalid_request', candidates: [], used: null },
    capture_metadata: baseMetadata(),
  };
}

export function evidenceBase(request, capturedAt) {
  return {
    request_id: request.request_id, company: request.company, source_category: request.source_category,
    source_url: request.url, url: request.url, evidence_goal: request.evidence_goal,
    evidence_dimensions: request.evidence_dimensions, evidence_factors: request.evidence_factors,
    notes: request.notes, captured_at: capturedAt, selector: request.selector, xpath: request.xpath,
    extracted_text: null, screenshot_path: null, status: 'capture_failed', error: null, caveat: null,
    selector_resolution: { strategy: 'unresolved', candidates: [], used: null }, capture_metadata: {},
  };
}

function parseUrl(value) {
  try { return new URL(value); } catch { return null; }
}

function readLocalFixture(file) {
  let descriptor;
  try {
    const before = fs.lstatSync(file);
    if (before.isSymbolicLink() || !before.isFile() || before.nlink !== 1
      || before.size > MAX_LOCAL_FIXTURE_BYTES) throw new Error('fixture metadata');
    descriptor = fs.openSync(file, fs.constants.O_RDONLY | NOFOLLOW | fs.constants.O_NONBLOCK);
    const opened = fs.fstatSync(descriptor);
    if (!opened.isFile() || opened.nlink !== 1 || opened.dev !== before.dev
      || opened.ino !== before.ino || opened.size !== before.size) throw new Error('fixture identity');
    const bytes = fs.readFileSync(descriptor);
    const after = fs.lstatSync(file);
    if (bytes.length !== opened.size || after.dev !== opened.dev || after.ino !== opened.ino
      || after.size !== opened.size || after.nlink !== 1 || !after.isFile()) throw new Error('fixture changed');
    return bytes;
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor);
  }
}

export function resolveSourceUrl(rawUrl, cwd) {
  const requestedUrl = requireText(rawUrl, 'request url');
  const parsed = parseUrl(requestedUrl);
  if (parsed?.protocol === 'data:') return { browser_url: requestedUrl, source_url_kind: 'data_url' };
  if (parsed?.protocol === 'file:') {
    return { browser_url: `data:text/html;base64,${readLocalFixture(fileURLToPath(parsed)).toString('base64')}`, source_url_kind: 'file_url' };
  }
  if (parsed && ['http:', 'https:'].includes(parsed.protocol)
    && ['localhost', '127.0.0.1', '::1', '[::1]'].includes(parsed.hostname)) {
    return { browser_url: requestedUrl, source_url_kind: 'local_http_url' };
  }
  if (parsed) return { blocked: true, source_url_kind: 'blocked_remote_url' };
  const bytes = readLocalFixture(path.resolve(cwd, requestedUrl));
  return { browser_url: `data:text/html;base64,${bytes.toString('base64')}`, source_url_kind: 'relative_file' };
}

export function candidateInputs(request) {
  return [
    ...(request.selector ? [{ kind: 'css', value: request.selector }] : []),
    ...(request.xpath ? [{ kind: 'xpath', value: request.xpath }] : []),
  ];
}

function slug(value, fallback) {
  return text(value, fallback).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 96) || fallback;
}

export function assetPathsForRequest(request, assetDir, outputDir) {
  const relativeRoot = path.isAbsolute(assetDir) ? path.relative(outputDir, assetDir) : assetDir;
  const relative = path.posix.join(relativeRoot.split(path.sep).join('/') || '.', slug(request.company, 'company'), `${slug(request.request_id, 'request')}.png`);
  return { screenshot_path: relative, screenshot_absolute_path: path.resolve(outputDir, relative) };
}

export function baseMetadata(extra = {}) {
  return {
    collector: BROWSER_EVIDENCE_CAPTURE_COLLECTOR_VERSION,
    backend: 'managed_playwright_companion',
    local_url_policy: 'file_data_or_localhost_only',
    local_fixture_max_bytes: MAX_LOCAL_FIXTURE_BYTES,
    autonomous_browsing: false,
    ...extra,
  };
}

export function finalizeStatus(status) {
  return CAPTURE_STATUSES.has(status) ? status : 'capture_failed';
}

export function createBrowserEvidenceRegistry(manifest, evidence, options = {}) {
  const byStatus = {};
  for (const item of evidence) byStatus[item.status] = (byStatus[item.status] || 0) + 1;
  const captured = byStatus.captured || 0;
  return {
    type: BROWSER_EVIDENCE_REGISTRY_TYPE, schema_version: BROWSER_EVIDENCE_CAPTURE_SCHEMA_VERSION,
    generated_at: options.generatedAt ?? new Date().toISOString(),
    status: captured === evidence.length ? 'completed' : 'completed_with_failures',
    manifest: { type: manifest.type, schema_version: manifest.schema_version, manifest_id: manifest.manifest_id, audit_id: manifest.audit_id, request_count: manifest.requests.length },
    summary: { request_count: evidence.length, captured_count: captured, failed_count: evidence.length - captured, by_status: byStatus },
    evidence,
    capture_metadata: baseMetadata({ session_generation: options.sessionGeneration ?? null }),
  };
}

export { normalizeRequest };
