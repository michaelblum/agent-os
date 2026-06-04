import fs from 'node:fs';
import path from 'node:path';
import {
  normalizeEmployerBrandLiveEvidenceSupervisedLocatorPlan,
  validateEmployerBrandLiveEvidenceSupervisedLocatorPlan,
} from './employer-brand-live-evidence-supervised-locator-plan.js';
import {
  normalizeEmployerBrandLiveEvidenceUrlOpenRun,
  validateEmployerBrandLiveEvidenceUrlOpenRun,
} from './employer-brand-live-evidence-url-open-run.js';

export const EMPLOYER_BRAND_LIVE_EVIDENCE_LOCATOR_RESOLUTION_RESULT_TYPE =
  'aos.employer_brand_live_evidence_locator_resolution_result';
export const EMPLOYER_BRAND_LIVE_EVIDENCE_LOCATOR_RESOLUTION_RESULT_SCHEMA_VERSION =
  '2026-05-employer-brand-live-evidence-locator-resolution-result-v0';

export const LOCATOR_RESOLUTION_STATUSES = [
  'resolved',
  'ambiguous',
  'not_found',
  'blocked',
  'not_run',
];

const BLOCKED_URL_OPEN_STATUSES = new Set([
  'login_required',
  'paywall',
  'captcha',
  'consent_required',
  'network_error',
  'timeout',
  'safety_gate_blocked',
]);

const NON_GOALS = [
  'screenshots',
  'element_clips',
  'text_extraction',
  'report_rendering',
  'html_css_polish',
  'pdf_docx_export',
  'workflow_engine',
  'full_page_grabs',
  'autonomous_crawl',
  'login_bypass',
  'paywall_bypass',
  'captcha_bypass',
  'consent_bypass',
];

const CONTROLS = {
  explicit_execution_gate_required: true,
  locator_resolution_authorized: false,
  locator_resolution_executed: false,
  screenshots_authorized: false,
  element_clips_authorized: false,
  text_extraction_authorized: false,
  report_renderer_authorized: false,
  export_execution_authorized: false,
  workflow_engine_authorized: false,
  full_page_grabs_authorized: false,
  autonomous_crawl_authorized: false,
  login_bypass_authorized: false,
  paywall_bypass_authorized: false,
  captcha_bypass_authorized: false,
  consent_bypass_authorized: false,
};

function text(value, fallback = '') {
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

function arrayValue(value) {
  return Array.isArray(value) ? value : [];
}

function objectValue(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function parseUrl(value) {
  try {
    return new URL(value);
  } catch {
    return null;
  }
}

function sameDomain(originalUrl, finalUrl) {
  const original = parseUrl(originalUrl);
  const final = parseUrl(finalUrl || originalUrl);
  return Boolean(original && final && original.hostname === final.hostname);
}

function normalizeCandidate(candidateInput = {}) {
  const candidate = objectValue(candidateInput);
  return {
    selector: optionalText(candidate.selector),
    playwright_locator: optionalText(candidate.playwright_locator),
    selector_type: text(candidate.selector_type, candidate.playwright_locator ? 'playwright_locator' : 'css'),
    confidence: Number(candidate.confidence ?? 0),
    rationale: optionalText(candidate.rationale),
    provenance: optionalText(candidate.provenance) || 'injected_resolver',
  };
}

function candidateMatches(candidates, preferredSelector, playwrightLocator) {
  return candidates.some((candidate) => {
    return (preferredSelector && candidate.selector === preferredSelector)
      || (playwrightLocator && candidate.playwright_locator === playwrightLocator);
  });
}

function eligibleUrlOpenResult(urlOpenResult) {
  if (urlOpenResult.executable !== true) return false;
  if (urlOpenResult.opened !== true) return false;
  if (urlOpenResult.status === 'reachable') return urlOpenResult.same_domain === true;
  if (urlOpenResult.status === 'redirected') {
    return urlOpenResult.same_domain === true && sameDomain(urlOpenResult.original_url, urlOpenResult.final_url);
  }
  return false;
}

function blockedReasonFor(urlOpenResult, workUnit, execute) {
  if (workUnit?.executable !== true || urlOpenResult.executable !== true) {
    return text(urlOpenResult.blocker_reason, 'non_executable_target_not_opened');
  }
  if (execute !== true) return 'explicit_execution_gate_not_enabled';
  if (urlOpenResult.status === 'not_run') return 'url_open_result_not_run';
  if (urlOpenResult.same_domain === false) return 'cross_domain_final_url_blocked';
  if (BLOCKED_URL_OPEN_STATUSES.has(urlOpenResult.status)) {
    return text(urlOpenResult.blocker_reason, `url_open_status_${urlOpenResult.status}`);
  }
  if (!eligibleUrlOpenResult(urlOpenResult)) return `url_open_status_${urlOpenResult.status}_not_eligible`;
  return null;
}

function normalizeResolverOutput(outputInput = {}) {
  const output = objectValue(outputInput);
  const candidates = arrayValue(output.selector_candidates).map(normalizeCandidate);
  const preferredSelector = optionalText(output.preferred_selector);
  const playwrightLocatorCandidate = optionalText(output.playwright_locator_candidate);
  const confidence = Number(output.confidence ?? 0);
  const status = LOCATOR_RESOLUTION_STATUSES.includes(output.resolution_status)
    ? output.resolution_status
    : (preferredSelector || playwrightLocatorCandidate ? 'resolved' : 'ambiguous');
  return {
    resolution_status: status,
    selector_candidates: candidates,
    preferred_selector: preferredSelector,
    playwright_locator_candidate: playwrightLocatorCandidate,
    confidence,
    blocker_reason: optionalText(output.blocker_reason),
    operator_notes: optionalText(output.operator_notes),
    locator_provenance: optionalText(output.locator_provenance) || 'injected_resolver',
  };
}

export function resolveLocatorFromDurableUrlOpenMetadata({
  workUnit,
  urlOpenResult,
} = {}) {
  const target = objectValue(workUnit);
  const urlOpen = objectValue(urlOpenResult);
  const evidenceLabel = [
    target.company,
    target.source_category,
    urlOpen.status,
    urlOpen.title,
  ].map((value) => text(value)).filter(Boolean).join(' / ');

  return {
    resolution_status: 'ambiguous',
    selector_candidates: [{
      selector: null,
      playwright_locator: null,
      selector_type: 'unconfirmed_metadata_only',
      confidence: 0.1,
      rationale: text(
        `No selector can be confirmed from executed URL-open metadata alone: ${evidenceLabel}.`,
        'No selector can be confirmed from executed URL-open metadata alone.',
      ),
      provenance: 'durable_url_open_metadata_only',
    }],
    preferred_selector: null,
    playwright_locator_candidate: null,
    confidence: 0.1,
    blocker_reason: 'durable_url_open_run_has_no_dom_or_accessibility_snapshot_for_selector_confirmation',
    operator_notes: 'Attempted locator resolution from the executed URL-open fixture only; no browser DOM, screenshot, element clip, full-page grab, crawl, capture, report, export, or blocker bypass was performed.',
    locator_provenance: 'durable_url_open_metadata_only',
  };
}

function resultFromStatus({
  workUnit,
  urlOpenResult,
  resolutionStatus,
  selectorCandidates = [],
  preferredSelector = null,
  playwrightLocatorCandidate = null,
  confidence = null,
  blockerReason = null,
  reviewedBy = null,
  operatorNotes = null,
  resolvedAt = null,
  locatorProvenance = 'url_open_gate',
}) {
  return {
    result_id: workUnit.work_unit_id.replace('live-locator-work-unit:', 'locator-resolution-result:'),
    target_id: workUnit.target_id,
    work_unit_id: workUnit.work_unit_id,
    company: workUnit.company,
    source_category: workUnit.source_category,
    original_url: urlOpenResult.original_url || workUnit.url,
    final_url: urlOpenResult.final_url || null,
    url_open_status: urlOpenResult.status,
    same_domain: typeof urlOpenResult.same_domain === 'boolean' ? urlOpenResult.same_domain : null,
    attempted: resolutionStatus === 'resolved' || resolutionStatus === 'ambiguous' || resolutionStatus === 'not_found',
    resolution_status: resolutionStatus,
    selector_candidates: cloneJson(selectorCandidates),
    preferred_selector: preferredSelector,
    playwright_locator_candidate: playwrightLocatorCandidate,
    confidence,
    blocker_reason: blockerReason,
    reviewed_by: reviewedBy,
    operator_notes: operatorNotes,
    resolved_at: resolvedAt,
    locator_provenance: locatorProvenance,
    provenance: {
      source_supervised_locator_plan_work_unit_id: workUnit.work_unit_id,
      source_url_open_result_id: urlOpenResult.result_id,
      locator_metadata_only: true,
      no_screenshots: true,
      no_element_clips: true,
      no_report_or_export: true,
      no_workflow_execution: true,
      no_full_page_grabs: true,
    },
  };
}

function countsFor(results, confidenceThreshold = 0.8) {
  return {
    result_count: results.length,
    attempted_count: results.filter((result) => result.attempted).length,
    resolved_count: results.filter((result) => result.resolution_status === 'resolved').length,
    ambiguous_count: results.filter((result) => result.resolution_status === 'ambiguous').length,
    not_found_count: results.filter((result) => result.resolution_status === 'not_found').length,
    blocked_count: results.filter((result) => result.resolution_status === 'blocked').length,
    not_run_count: results.filter((result) => result.resolution_status === 'not_run').length,
    locator_ready_count: results.filter((result) => result.resolution_status === 'resolved' && result.confidence >= confidenceThreshold).length,
    needs_human_locator_review_count: results.filter((result) => (
      /non_executable_until_human_target_review|target_review_status_not_approved/.test(text(result.blocker_reason))
    )).length,
  };
}

function normalizeRejectedExclusion(exclusionInput = {}) {
  const exclusion = objectValue(exclusionInput);
  return {
    target_id: requireText(exclusion.target_id, 'rejected_exclusion.target_id'),
    decision: text(exclusion.decision, 'reject'),
    reason: optionalText(exclusion.reason),
    source_approval_patch_path: optionalText(exclusion.source_approval_patch_path) || 'live-evidence-target-approval-patch.json',
    resolution_status: 'not_run',
    blocker_reason: 'rejected_target_excluded_before_url_open',
  };
}

export function normalizeEmployerBrandLiveEvidenceLocatorResolutionResult(resultInput = {}) {
  const result = objectValue(resultInput);
  const results = arrayValue(result.results).map((itemInput) => {
    const item = objectValue(itemInput);
    return {
      result_id: requireText(item.result_id, 'result_id'),
      target_id: requireText(item.target_id, 'target_id'),
      work_unit_id: requireText(item.work_unit_id, 'work_unit_id'),
      company: requireText(item.company, 'company'),
      source_category: requireText(item.source_category, 'source_category'),
      original_url: requireText(item.original_url, 'original_url'),
      final_url: optionalText(item.final_url),
      url_open_status: requireText(item.url_open_status, 'url_open_status'),
      same_domain: typeof item.same_domain === 'boolean' ? item.same_domain : null,
      attempted: item.attempted === true,
      resolution_status: requireText(item.resolution_status, 'resolution_status'),
      selector_candidates: arrayValue(item.selector_candidates).map(normalizeCandidate),
      preferred_selector: optionalText(item.preferred_selector),
      playwright_locator_candidate: optionalText(item.playwright_locator_candidate),
      confidence: typeof item.confidence === 'number' ? item.confidence : null,
      blocker_reason: optionalText(item.blocker_reason),
      reviewed_by: optionalText(item.reviewed_by),
      operator_notes: optionalText(item.operator_notes),
      resolved_at: optionalText(item.resolved_at),
      locator_provenance: requireText(item.locator_provenance, 'locator_provenance'),
      provenance: {
        source_supervised_locator_plan_work_unit_id: requireText(
          item.provenance?.source_supervised_locator_plan_work_unit_id,
          'provenance.source_supervised_locator_plan_work_unit_id',
        ),
        source_url_open_result_id: requireText(item.provenance?.source_url_open_result_id, 'provenance.source_url_open_result_id'),
        locator_metadata_only: item.provenance?.locator_metadata_only !== false,
        no_screenshots: item.provenance?.no_screenshots !== false,
        no_element_clips: item.provenance?.no_element_clips !== false,
        no_report_or_export: item.provenance?.no_report_or_export !== false,
        no_workflow_execution: item.provenance?.no_workflow_execution !== false,
        no_full_page_grabs: item.provenance?.no_full_page_grabs !== false,
      },
    };
  });
  const confidenceThreshold = Number(result.summary?.confidence_threshold ?? 0.8);
  const counts = countsFor(results, confidenceThreshold);
  return {
    type: EMPLOYER_BRAND_LIVE_EVIDENCE_LOCATOR_RESOLUTION_RESULT_TYPE,
    schema_version: EMPLOYER_BRAND_LIVE_EVIDENCE_LOCATOR_RESOLUTION_RESULT_SCHEMA_VERSION,
    id: requireText(result.id, 'id'),
    label: requireText(result.label, 'label'),
    status: text(result.status, counts.locator_ready_count > 0 ? 'completed' : 'not_run_fixture'),
    source_refs: cloneJson(objectValue(result.source_refs)),
    summary: {
      ...counts,
      eligible_target_count: Number(result.summary?.eligible_target_count ?? 0),
      rejected_exclusion_count: Number(result.summary?.rejected_exclusion_count ?? arrayValue(result.rejected_exclusions).length),
      confidence_threshold: confidenceThreshold,
    },
    results,
    rejected_exclusions: arrayValue(result.rejected_exclusions).map(normalizeRejectedExclusion),
    controls: { ...cloneJson(CONTROLS), ...cloneJson(objectValue(result.controls)) },
    provenance: {
      created_at: optionalText(result.provenance?.created_at),
      url_open_run_is_input_source: result.provenance?.url_open_run_is_input_source !== false,
      supervised_locator_plan_is_input_source: result.provenance?.supervised_locator_plan_is_input_source !== false,
      injectable_resolver_used: result.provenance?.injectable_resolver_used === true,
      read_only_planning_evidence: result.provenance?.read_only_planning_evidence !== false,
      non_goals: cloneJson(arrayValue(result.provenance?.non_goals).length ? result.provenance.non_goals : NON_GOALS),
    },
  };
}

export async function buildEmployerBrandLiveEvidenceLocatorResolutionResult({
  supervisedLocatorPlan,
  urlOpenRun,
  execute = false,
  resolveLocator = null,
  resolvedAt = null,
  reviewedBy = null,
  operatorNotes = null,
  confidenceThreshold = 0.8,
  supervisedLocatorPlanPath = 'live-evidence-supervised-locator-plan.json',
  urlOpenRunPath = 'live-evidence-url-open-run.json',
} = {}) {
  const planValidation = validateEmployerBrandLiveEvidenceSupervisedLocatorPlan(supervisedLocatorPlan);
  if (!planValidation.valid) throw new Error(`Supervised locator plan validation failed: ${planValidation.errors.join('; ')}`);
  const openValidation = validateEmployerBrandLiveEvidenceUrlOpenRun(urlOpenRun);
  if (!openValidation.valid) throw new Error(`URL open run validation failed: ${openValidation.errors.join('; ')}`);

  const plan = normalizeEmployerBrandLiveEvidenceSupervisedLocatorPlan(supervisedLocatorPlan);
  const openRun = normalizeEmployerBrandLiveEvidenceUrlOpenRun(urlOpenRun);
  const workUnitsById = new Map(plan.work_units.map((workUnit) => [workUnit.work_unit_id, workUnit]));
  const results = [];
  let eligibleTargetCount = 0;

  for (const urlOpenResult of openRun.results) {
    const workUnit = workUnitsById.get(urlOpenResult.work_unit_id);
    if (!workUnit) throw new Error(`Missing supervised locator work unit for ${urlOpenResult.work_unit_id}`);
    const urlOpenEligible = eligibleUrlOpenResult(urlOpenResult);
    if (urlOpenEligible) eligibleTargetCount += 1;
    const blockerReason = blockedReasonFor(urlOpenResult, workUnit, execute);
    if (blockerReason) {
      results.push(resultFromStatus({
        workUnit,
        urlOpenResult,
        resolutionStatus: execute === true && urlOpenResult.status !== 'not_run' ? 'blocked' : 'not_run',
        blockerReason,
        reviewedBy,
        operatorNotes: urlOpenResult.operator_notes || operatorNotes,
        locatorProvenance: 'url_open_gate',
      }));
      continue;
    }

    if (typeof resolveLocator !== 'function') {
      results.push(resultFromStatus({
        workUnit,
        urlOpenResult,
        resolutionStatus: 'not_run',
        blockerReason: 'resolver_not_provided',
        reviewedBy,
        operatorNotes,
        locatorProvenance: 'execution_gate',
      }));
      continue;
    }

    const resolverOutput = normalizeResolverOutput(await resolveLocator({
      workUnit: cloneJson(workUnit),
      urlOpenResult: cloneJson(urlOpenResult),
    }));
    const confidentlyResolved = resolverOutput.resolution_status === 'resolved'
      && resolverOutput.confidence >= confidenceThreshold
      && (resolverOutput.preferred_selector || resolverOutput.playwright_locator_candidate)
      && candidateMatches(
        resolverOutput.selector_candidates,
        resolverOutput.preferred_selector,
        resolverOutput.playwright_locator_candidate,
      );

    results.push(resultFromStatus({
      workUnit,
      urlOpenResult,
      resolutionStatus: confidentlyResolved ? 'resolved' : (resolverOutput.resolution_status === 'not_found' ? 'not_found' : 'ambiguous'),
      selectorCandidates: resolverOutput.selector_candidates,
      preferredSelector: confidentlyResolved ? resolverOutput.preferred_selector : null,
      playwrightLocatorCandidate: confidentlyResolved ? resolverOutput.playwright_locator_candidate : null,
      confidence: resolverOutput.confidence,
      blockerReason: confidentlyResolved ? null : (resolverOutput.blocker_reason || 'target_element_ambiguous_without_guessing'),
      reviewedBy,
      operatorNotes: resolverOutput.operator_notes || operatorNotes,
      resolvedAt,
      locatorProvenance: resolverOutput.locator_provenance,
    }));
  }

  const summary = {
    ...countsFor(results, confidenceThreshold),
    eligible_target_count: eligibleTargetCount,
    rejected_exclusion_count: arrayValue(openRun.rejected_exclusions).length,
    confidence_threshold: confidenceThreshold,
  };
  const controls = {
    ...CONTROLS,
    locator_resolution_authorized: execute === true,
    locator_resolution_executed: execute === true && results.some((result) => result.attempted),
  };

  return normalizeEmployerBrandLiveEvidenceLocatorResolutionResult({
    id: openRun.id.replace('live-evidence-url-open-run:', 'live-evidence-locator-resolution-result:'),
    label: `${openRun.label.replace(/ Live Evidence URL Open Run$/, '')} Live Evidence Locator Resolution Result`,
    status: execute === true
      ? (summary.locator_ready_count > 0 ? 'completed' : 'completed_with_blockers')
      : 'not_run_fixture',
    source_refs: {
      supervised_locator_plan_id: plan.id,
      supervised_locator_plan_path: supervisedLocatorPlanPath,
      supervised_locator_plan_schema: 'shared/schemas/employer-brand-live-evidence-supervised-locator-plan-v0.schema.json',
      url_open_run_id: openRun.id,
      url_open_run_path: urlOpenRunPath,
      url_open_run_schema: 'shared/schemas/employer-brand-live-evidence-url-open-run-v0.schema.json',
    },
    summary,
    results,
    rejected_exclusions: cloneJson(arrayValue(openRun.rejected_exclusions)),
    controls,
    provenance: {
      created_at: resolvedAt,
      url_open_run_is_input_source: true,
      supervised_locator_plan_is_input_source: true,
      injectable_resolver_used: typeof resolveLocator === 'function',
      read_only_planning_evidence: true,
      non_goals: cloneJson(NON_GOALS),
    },
  });
}

export function validateEmployerBrandLiveEvidenceLocatorResolutionResult(resultInput = {}) {
  const errors = [];
  const result = objectValue(resultInput);
  const results = arrayValue(result.results);
  if (result.type !== EMPLOYER_BRAND_LIVE_EVIDENCE_LOCATOR_RESOLUTION_RESULT_TYPE) errors.push('type must identify an Employer Brand Live Evidence Locator Resolution Result');
  if (result.schema_version !== EMPLOYER_BRAND_LIVE_EVIDENCE_LOCATOR_RESOLUTION_RESULT_SCHEMA_VERSION) errors.push('schema_version must be Locator Resolution Result V0');
  if (!['not_run_fixture', 'completed', 'completed_with_blockers'].includes(result.status)) errors.push('status is invalid');
  if (results.length < 1) errors.push('results must include URL-open run targets');
  const counts = countsFor(results, Number(result.summary?.confidence_threshold ?? 0.8));
  for (const [key, value] of Object.entries(counts)) {
    if (result.summary?.[key] !== value) errors.push(`summary.${key} must reconcile with results`);
  }
  if (result.summary?.rejected_exclusion_count !== arrayValue(result.rejected_exclusions).length) errors.push('summary.rejected_exclusion_count must reconcile with rejected exclusions');
  for (const exclusion of arrayValue(result.rejected_exclusions)) {
    if (exclusion.decision !== 'reject') errors.push(`${exclusion.target_id} rejected exclusion must keep reject decision`);
    if (exclusion.resolution_status !== 'not_run') errors.push(`${exclusion.target_id} rejected exclusion must remain not_run`);
  }
  for (const item of results) {
    if (!LOCATOR_RESOLUTION_STATUSES.includes(item.resolution_status)) errors.push(`${item.target_id} resolution_status is invalid`);
    if (item.resolution_status === 'resolved') {
      if (!item.preferred_selector && !item.playwright_locator_candidate) errors.push(`${item.target_id} resolved locator requires a preferred selector or Playwright locator`);
      if (item.confidence < Number(result.summary?.confidence_threshold ?? 0.8)) errors.push(`${item.target_id} resolved locator must meet confidence threshold`);
      if (!candidateMatches(arrayValue(item.selector_candidates), item.preferred_selector, item.playwright_locator_candidate)) errors.push(`${item.target_id} resolved locator must come from selector candidates`);
    } else {
      if (item.preferred_selector !== null) errors.push(`${item.target_id} unresolved locator must not keep preferred_selector`);
      if (item.playwright_locator_candidate !== null) errors.push(`${item.target_id} unresolved locator must not keep playwright_locator_candidate`);
    }
    if (item.attempted && !item.resolved_at) errors.push(`${item.target_id} attempted locator resolution requires resolved_at`);
    if (!item.attempted && item.resolved_at !== null) errors.push(`${item.target_id} blocked/not-run locator must keep resolved_at null`);
    if (item.url_open_status === 'not_run' && item.resolution_status !== 'not_run') errors.push(`${item.target_id} not-run URL open target must remain not_run`);
    if (BLOCKED_URL_OPEN_STATUSES.has(item.url_open_status) && item.resolution_status !== 'blocked' && item.resolution_status !== 'not_run') errors.push(`${item.target_id} blocked URL open target must remain blocked/not_run`);
    if (item.same_domain === false && !['blocked', 'not_run'].includes(item.resolution_status)) errors.push(`${item.target_id} cross-domain target must remain blocked/not_run`);
    if (item.provenance?.no_screenshots !== true) errors.push(`${item.target_id} must forbid screenshots`);
    if (item.provenance?.no_element_clips !== true) errors.push(`${item.target_id} must forbid element clips`);
    if (item.provenance?.no_report_or_export !== true) errors.push(`${item.target_id} must forbid report/export`);
    if (item.provenance?.no_workflow_execution !== true) errors.push(`${item.target_id} must forbid workflow execution`);
    if (item.provenance?.no_full_page_grabs !== true) errors.push(`${item.target_id} must forbid full-page grabs`);
  }
  for (const [key, value] of Object.entries(CONTROLS)) {
    if (key === 'locator_resolution_authorized' || key === 'locator_resolution_executed') continue;
    if (result.controls?.[key] !== value) errors.push(`controls.${key} must be ${value}`);
  }
  return {
    valid: errors.length === 0,
    errors,
  };
}

export function loadEmployerBrandLiveEvidenceLocatorResolutionResult({ fixtureRoot } = {}) {
  if (!fixtureRoot) throw new Error('fixtureRoot is required');
  return JSON.parse(fs.readFileSync(path.join(fixtureRoot, 'live-evidence-locator-resolution-result.json'), 'utf8'));
}
