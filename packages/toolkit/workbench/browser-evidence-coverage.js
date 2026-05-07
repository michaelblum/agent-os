import {
  normalizeBrowserEvidenceCaptureManifest,
} from './browser-evidence-capture.js';

export const BROWSER_EVIDENCE_COVERAGE_SUMMARY_TYPE = 'aos.browser_evidence_coverage_summary';
export const BROWSER_EVIDENCE_COVERAGE_SCHEMA_VERSION = '2026-05-browser-evidence-coverage-v0';

function text(value, fallback = '') {
  const normalized = String(value ?? '').replace(/\s+/g, ' ').trim();
  return normalized || fallback;
}

function optionalText(value) {
  const normalized = text(value);
  return normalized || null;
}

function objectValue(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function arrayValue(value) {
  return Array.isArray(value) ? value : [];
}

function cloneJson(value) {
  if (value === undefined) return undefined;
  return JSON.parse(JSON.stringify(value));
}

function requestSummary(request = {}) {
  return {
    request_id: text(request.request_id),
    company: text(request.company),
    source_category: text(request.source_category),
    url: text(request.url),
    evidence_goal: text(request.evidence_goal),
  };
}

function evidenceSummary(evidence = {}) {
  return {
    request_id: text(evidence.request_id),
    company: text(evidence.company),
    source_category: text(evidence.source_category),
    url: text(evidence.source_url || evidence.url),
    status: text(evidence.status, 'unknown'),
    screenshot_path: optionalText(evidence.screenshot_path),
  };
}

function normalizeRegistryEvidence(registry = {}) {
  return arrayValue(objectValue(registry).evidence)
    .map((item) => {
      const evidence = objectValue(item);
      return {
        request_id: text(evidence.request_id),
        company: text(evidence.company),
        source_category: text(evidence.source_category),
        source_url: text(evidence.source_url || evidence.url),
        url: text(evidence.url || evidence.source_url),
        status: text(evidence.status, 'unknown'),
        screenshot_path: optionalText(evidence.screenshot_path),
      };
    })
    .filter((item) => item.request_id);
}

function coverageKey(company = '', sourceCategory = '') {
  return `${text(company, 'unknown')}\u0000${text(sourceCategory, 'unknown')}`;
}

function coverageBucket(company = '', sourceCategory = '') {
  return {
    company: text(company, 'unknown'),
    source_category: text(sourceCategory, 'unknown'),
    planned_count: 0,
    captured_count: 0,
    matched_request_count: 0,
    missing_planned_count: 0,
    extra_captured_count: 0,
    planned_request_ids: [],
    captured_request_ids: [],
    matched_request_ids: [],
    missing_planned_request_ids: [],
    extra_captured_request_ids: [],
    coverage_status: 'empty',
  };
}

function coverageStatus(bucket) {
  if (bucket.planned_count === 0 && bucket.captured_count > 0) return 'extra_captured';
  if (bucket.planned_count > 0 && bucket.matched_request_count === bucket.planned_count && bucket.extra_captured_count > 0) {
    return 'matched_with_extra';
  }
  if (bucket.planned_count > 0 && bucket.matched_request_count === bucket.planned_count) return 'matched';
  if (bucket.planned_count > 0 && bucket.captured_count > 0) return 'captured_without_matching_request_id';
  if (bucket.planned_count > 0) return 'missing';
  return 'empty';
}

function summarizeCompany(company = '', rows = []) {
  return {
    company: text(company, 'unknown'),
    planned_count: rows.reduce((count, row) => count + row.planned_count, 0),
    captured_count: rows.reduce((count, row) => count + row.captured_count, 0),
    matched_request_count: rows.reduce((count, row) => count + row.matched_request_count, 0),
    missing_planned_count: rows.reduce((count, row) => count + row.missing_planned_count, 0),
    extra_captured_count: rows.reduce((count, row) => count + row.extra_captured_count, 0),
    source_categories: rows.map((row) => row.source_category),
  };
}

export function summarizeBrowserEvidencePlanningCoverage(planningManifest = {}, capturedRegistry = {}) {
  const planning = normalizeBrowserEvidenceCaptureManifest(planningManifest);
  const registry = objectValue(capturedRegistry);
  const capturedEvidence = normalizeRegistryEvidence(registry);
  const plannedRequests = planning.requests.map(requestSummary);
  const plannedById = new Map(plannedRequests.map((request) => [request.request_id, request]));
  const capturedById = new Map(capturedEvidence.map((evidence) => [evidence.request_id, evidence]));
  const coverageByKey = new Map();

  function bucketFor(company = '', sourceCategory = '') {
    const key = coverageKey(company, sourceCategory);
    if (!coverageByKey.has(key)) coverageByKey.set(key, coverageBucket(company, sourceCategory));
    return coverageByKey.get(key);
  }

  for (const request of plannedRequests) {
    const bucket = bucketFor(request.company, request.source_category);
    bucket.planned_count += 1;
    bucket.planned_request_ids.push(request.request_id);
    if (capturedById.has(request.request_id)) {
      bucket.matched_request_count += 1;
      bucket.matched_request_ids.push(request.request_id);
    } else {
      bucket.missing_planned_count += 1;
      bucket.missing_planned_request_ids.push(request.request_id);
    }
  }

  for (const evidence of capturedEvidence) {
    const bucket = bucketFor(evidence.company, evidence.source_category);
    bucket.captured_count += 1;
    bucket.captured_request_ids.push(evidence.request_id);
    if (!plannedById.has(evidence.request_id)) {
      bucket.extra_captured_count += 1;
      bucket.extra_captured_request_ids.push(evidence.request_id);
    }
  }

  const byCompanySourceCategory = [...coverageByKey.values()].map((bucket) => ({
    ...bucket,
    coverage_status: coverageStatus(bucket),
  }));
  const companyNames = [...new Set(byCompanySourceCategory.map((row) => row.company))];

  return {
    type: BROWSER_EVIDENCE_COVERAGE_SUMMARY_TYPE,
    schema_version: BROWSER_EVIDENCE_COVERAGE_SCHEMA_VERSION,
    planning_manifest_id: optionalText(planning.manifest_id),
    captured_manifest_id: optionalText(registry.manifest?.manifest_id),
    registry_status: optionalText(registry.status),
    planned_count: plannedRequests.length,
    captured_count: capturedEvidence.length,
    captured_status_count: capturedEvidence.filter((item) => item.status === 'captured').length,
    matched_request_count: plannedRequests.filter((request) => capturedById.has(request.request_id)).length,
    missing_planned_count: plannedRequests.filter((request) => !capturedById.has(request.request_id)).length,
    extra_captured_count: capturedEvidence.filter((item) => !plannedById.has(item.request_id)).length,
    missing_planned_request_ids: plannedRequests
      .filter((request) => !capturedById.has(request.request_id))
      .map((request) => request.request_id),
    extra_captured_request_ids: capturedEvidence
      .filter((item) => !plannedById.has(item.request_id))
      .map((item) => item.request_id),
    missing_planned_requests: plannedRequests.filter((request) => !capturedById.has(request.request_id)),
    extra_captured_requests: capturedEvidence
      .filter((item) => !plannedById.has(item.request_id))
      .map(evidenceSummary),
    by_company_source_category: byCompanySourceCategory,
    by_company: companyNames.map((company) => (
      summarizeCompany(company, byCompanySourceCategory.filter((row) => row.company === company))
    )),
    read_only: true,
    provenance_only: true,
  };
}

export function cloneBrowserEvidenceCoverageSummary(summary = null) {
  const value = objectValue(summary);
  if (Object.keys(value).length === 0) return null;
  return cloneJson(value);
}
