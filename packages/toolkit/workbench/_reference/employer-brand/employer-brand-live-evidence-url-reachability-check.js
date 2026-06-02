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

export const EMPLOYER_BRAND_LIVE_EVIDENCE_URL_REACHABILITY_CHECK_TYPE =
  'aos.employer_brand_live_evidence_url_reachability_check';
export const EMPLOYER_BRAND_LIVE_EVIDENCE_URL_REACHABILITY_CHECK_SCHEMA_VERSION =
  '2026-05-employer-brand-live-evidence-url-reachability-check-v0';

export const URL_REACHABILITY_STATUSES = [
  'not_checked',
  'reachable',
  'blocked',
  'redirected',
  'login_required',
  'paywall',
  'captcha',
  'consent_required',
  'network_error',
  'safety_gate_blocked',
];

const NON_GOALS = [
  'locator_resolution',
  'locator_codegen_execution',
  'screenshots',
  'clip_generation',
  'report_rendering',
  'export_execution',
  'workflow_automation',
  'full_page_grabs',
  'autonomous_crawl',
  'login_bypass',
  'paywall_bypass',
  'captcha_bypass',
  'consent_bypass',
  'element_identification',
];

const SAFETY_GATES = [
  'human_approval_required',
  'same_domain_constraint',
  'no_autonomous_crawl',
  'no_login_paywall_captcha_or_consent_bypass',
  'no_element_identification',
  'no_locator_resolution',
  'no_codegen',
  'no_screenshots',
  'no_clips',
  'no_full_page_grabs',
];

function text(value, fallback = '') {
  const normalized = String(value ?? '').replace(/\s+/g, ' ').trim();
  return normalized || fallback;
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

function sameDomainMetadata(url) {
  try {
    const parsed = new URL(url);
    return {
      requested_origin: parsed.origin,
      requested_hostname: parsed.hostname,
      expected_origin: parsed.origin,
      same_domain_required: true,
      same_domain: null,
    };
  } catch {
    return {
      requested_origin: null,
      requested_hostname: null,
      expected_origin: null,
      same_domain_required: true,
      same_domain: null,
    };
  }
}

function sameDomainMetadataFromUrlOpenResult(urlOpenResult) {
  const metadata = sameDomainMetadata(urlOpenResult.original_url);
  return {
    ...metadata,
    same_domain: typeof urlOpenResult.same_domain === 'boolean' ? urlOpenResult.same_domain : metadata.same_domain,
  };
}

function statusCounts(results) {
  return URL_REACHABILITY_STATUSES.reduce((counts, status) => {
    counts[`${status}_count`] = results.filter((result) => result.status === status).length;
    return counts;
  }, {});
}

function buildResult({ workUnit, index }) {
  const executable = workUnit.executable === true;
  const blocked = workUnit.blocked === true;
  const status = executable ? 'not_checked' : 'safety_gate_blocked';
  const blockerReasons = blocked
    ? [
      'non_executable_target_not_opened',
      ...arrayValue(workUnit.blockers),
    ]
    : [];

  return {
    result_id: workUnit.work_unit_id.replace('live-locator-work-unit:', 'url-reachability-result:'),
    work_unit_id: workUnit.work_unit_id,
    target_id: workUnit.target_id,
    executable,
    executed: false,
    non_executed: true,
    status,
    url: workUnit.url,
    final_url: null,
    same_domain_gate: sameDomainMetadata(workUnit.url),
    http: {
      status_code: null,
      status_text: null,
      method: null,
      headers_observed: false,
    },
    blocker_reason: blockerReasons.length ? blockerReasons.join('; ') : null,
    checked_at: null,
    operator_notes: executable
      ? 'Dry-run reachability entry. URL was not opened; run a future supervised opener only after explicit authorization.'
      : 'Preserved from supervised locator plan as non-executable; URL was not opened.',
    review_status: executable ? 'pending_supervised_check' : 'blocked_non_executable',
    safety_gates: cloneJson(SAFETY_GATES),
    provenance: {
      source_supervised_locator_plan_target_id: workUnit.target_id,
      source_supervised_locator_plan_work_unit_id: workUnit.work_unit_id,
      source_index: index,
      planning_check_only: true,
      read_only: true,
    },
  };
}

function statusFromUrlOpenResult(urlOpenResult) {
  if (urlOpenResult.status === 'not_run') return 'not_checked';
  if (urlOpenResult.status === 'safety_gate_blocked') return 'safety_gate_blocked';
  return URL_REACHABILITY_STATUSES.includes(urlOpenResult.status) ? urlOpenResult.status : 'blocked';
}

function buildResultFromUrlOpen({ workUnit, urlOpenResult, index }) {
  const executable = workUnit.executable === true;
  const status = statusFromUrlOpenResult(urlOpenResult);
  const executed = executable && urlOpenResult.status !== 'not_run' && Boolean(urlOpenResult.checked_at);
  return {
    result_id: workUnit.work_unit_id.replace('live-locator-work-unit:', 'url-reachability-result:'),
    work_unit_id: workUnit.work_unit_id,
    target_id: workUnit.target_id,
    executable,
    executed,
    non_executed: !executed,
    status,
    url: urlOpenResult.original_url || workUnit.url,
    final_url: urlOpenResult.final_url || null,
    same_domain_gate: sameDomainMetadataFromUrlOpenResult(urlOpenResult),
    http: {
      status_code: Number.isInteger(urlOpenResult.http_status) ? urlOpenResult.http_status : null,
      status_text: null,
      method: executed ? 'GET' : null,
      headers_observed: executed && Number.isInteger(urlOpenResult.http_status),
    },
    blocker_reason: urlOpenResult.blocker_reason || null,
    checked_at: urlOpenResult.checked_at || null,
    operator_notes: urlOpenResult.operator_notes || urlOpenResult.harness_notes || null,
    review_status: executed ? 'checked_by_bounded_url_open_run' : (executable ? 'pending_supervised_check' : 'blocked_non_executable'),
    safety_gates: cloneJson(SAFETY_GATES),
    provenance: {
      source_supervised_locator_plan_target_id: workUnit.target_id,
      source_supervised_locator_plan_work_unit_id: workUnit.work_unit_id,
      source_index: index,
      source_url_open_result_id: urlOpenResult.result_id,
      planning_check_only: false,
      read_only: true,
    },
  };
}

export function normalizeEmployerBrandLiveEvidenceUrlReachabilityCheck(checkInput = {}) {
  const check = objectValue(checkInput);
  const results = arrayValue(check.results).map((resultInput) => {
    const result = objectValue(resultInput);
    return {
      result_id: requireText(result.result_id, 'result_id'),
      work_unit_id: requireText(result.work_unit_id, 'work_unit_id'),
      target_id: requireText(result.target_id, 'target_id'),
      executable: result.executable === true,
      executed: result.executed === true,
      non_executed: result.non_executed !== false,
      status: requireText(result.status, 'status'),
      url: requireText(result.url, 'url'),
      final_url: result.final_url ? text(result.final_url) : null,
      same_domain_gate: {
        requested_origin: result.same_domain_gate?.requested_origin || null,
        requested_hostname: result.same_domain_gate?.requested_hostname || null,
        expected_origin: result.same_domain_gate?.expected_origin || null,
        same_domain_required: result.same_domain_gate?.same_domain_required !== false,
        same_domain: typeof result.same_domain_gate?.same_domain === 'boolean'
          ? result.same_domain_gate.same_domain
          : null,
      },
      http: {
        status_code: Number.isInteger(result.http?.status_code) ? result.http.status_code : null,
        status_text: result.http?.status_text ? text(result.http.status_text) : null,
        method: result.http?.method ? text(result.http.method) : null,
        headers_observed: result.http?.headers_observed === true,
      },
      blocker_reason: result.blocker_reason ? text(result.blocker_reason) : null,
      checked_at: result.checked_at ? text(result.checked_at) : null,
      operator_notes: result.operator_notes ? text(result.operator_notes) : null,
      review_status: requireText(result.review_status, 'review_status'),
      safety_gates: cloneJson(arrayValue(result.safety_gates)),
      provenance: {
        source_supervised_locator_plan_target_id: requireText(
          result.provenance?.source_supervised_locator_plan_target_id,
          'provenance.source_supervised_locator_plan_target_id',
        ),
        source_supervised_locator_plan_work_unit_id: requireText(
          result.provenance?.source_supervised_locator_plan_work_unit_id,
          'provenance.source_supervised_locator_plan_work_unit_id',
        ),
        source_index: Number(result.provenance?.source_index ?? 0),
        source_url_open_result_id: result.provenance?.source_url_open_result_id ? text(result.provenance.source_url_open_result_id) : null,
        planning_check_only: result.provenance?.planning_check_only === true,
        read_only: result.provenance?.read_only !== false,
      },
    };
  });
  const executableResults = results.filter((result) => result.executable);
  const checkedResults = results.filter((result) => result.executed);
  const blockedResults = results.filter((result) => result.status === 'blocked' || result.status === 'safety_gate_blocked');

  return {
    ...cloneJson(check),
    results,
    summary: {
      ...statusCounts(results),
      supervised_locator_work_unit_count: Number(check.summary?.supervised_locator_work_unit_count ?? results.length),
      executable_target_count: Number(check.summary?.executable_target_count ?? executableResults.length),
      non_executed_blocked_target_count: Number(check.summary?.non_executed_blocked_target_count ?? results.filter((result) => !result.executable).length),
      checked_count: Number(check.summary?.checked_count ?? checkedResults.length),
      reachable_count: Number(check.summary?.reachable_count ?? results.filter((result) => result.status === 'reachable').length),
      blocked_count: Number(check.summary?.blocked_count ?? blockedResults.length),
      redirected_count: Number(check.summary?.redirected_count ?? results.filter((result) => result.status === 'redirected').length),
      same_domain_confirmed_count: Number(check.summary?.same_domain_confirmed_count ?? results.filter((result) => result.same_domain_gate.same_domain === true).length),
      same_domain_unknown_count: Number(check.summary?.same_domain_unknown_count ?? results.filter((result) => result.same_domain_gate.same_domain === null).length),
    },
  };
}

export function buildEmployerBrandLiveEvidenceUrlReachabilityCheck({
  supervisedLocatorPlan,
  urlOpenRun = null,
  createdAt = null,
  supervisedLocatorPlanPath = 'live-evidence-supervised-locator-plan.json',
  urlOpenRunPath = 'live-evidence-url-open-run.json',
} = {}) {
  const validation = validateEmployerBrandLiveEvidenceSupervisedLocatorPlan(supervisedLocatorPlan);
  if (!validation.valid) throw new Error(`Supervised locator plan validation failed: ${validation.errors.join('; ')}`);
  const plan = normalizeEmployerBrandLiveEvidenceSupervisedLocatorPlan(supervisedLocatorPlan);
  let openRun = null;
  if (urlOpenRun) {
    const openValidation = validateEmployerBrandLiveEvidenceUrlOpenRun(urlOpenRun);
    if (!openValidation.valid) throw new Error(`URL open run validation failed: ${openValidation.errors.join('; ')}`);
    openRun = normalizeEmployerBrandLiveEvidenceUrlOpenRun(urlOpenRun);
  }
  const openResultsByWorkUnitId = new Map(openRun?.results.map((result) => [result.work_unit_id, result]) || []);
  const results = plan.work_units.map((workUnit, index) => {
    const urlOpenResult = openResultsByWorkUnitId.get(workUnit.work_unit_id);
    return urlOpenResult
      ? buildResultFromUrlOpen({ workUnit, urlOpenResult, index })
      : buildResult({ workUnit, index });
  });
  const executed = Boolean(openRun && openRun.status !== 'not_run_fixture');
  const hasBlockers = results.some((result) => [
    'blocked',
    'login_required',
    'paywall',
    'captcha',
    'consent_required',
    'network_error',
    'safety_gate_blocked',
  ].includes(result.status));
  const checkedResults = results.filter((result) => result.executed);
  const blockedResults = results.filter((result) => result.status === 'blocked' || result.status === 'safety_gate_blocked');

  return normalizeEmployerBrandLiveEvidenceUrlReachabilityCheck({
    type: EMPLOYER_BRAND_LIVE_EVIDENCE_URL_REACHABILITY_CHECK_TYPE,
    schema_version: EMPLOYER_BRAND_LIVE_EVIDENCE_URL_REACHABILITY_CHECK_SCHEMA_VERSION,
    id: plan.id.replace('live-evidence-supervised-locator-plan:', 'live-evidence-url-reachability-check:'),
    label: `${plan.label.replace(/ Live Evidence Supervised Locator Plan$/, '')} Live Evidence URL Reachability Check`,
    status: executed ? (hasBlockers ? 'checked_with_blockers' : 'checked') : 'dry_run_not_checked',
    source_refs: {
      supervised_locator_plan_id: plan.id,
      supervised_locator_plan_path: supervisedLocatorPlanPath,
      supervised_locator_plan_schema: 'shared/schemas/employer-brand-live-evidence-supervised-locator-plan-v0.schema.json',
      locator_readiness_id: plan.source_refs.locator_readiness_id,
      locator_readiness_path: plan.source_refs.locator_readiness_path,
      reviewed_target_plan_id: plan.source_refs.reviewed_target_plan_id,
      reviewed_target_plan_path: plan.source_refs.reviewed_target_plan_path,
      data_bundle_id: plan.source_refs.data_bundle_id,
      data_bundle_path: plan.source_refs.data_bundle_path,
      url_open_run_id: openRun?.id || null,
      url_open_run_path: openRun ? urlOpenRunPath : null,
      url_open_run_schema: openRun ? 'shared/schemas/employer-brand-live-evidence-url-open-run-v0.schema.json' : null,
    },
    summary: {
      supervised_locator_work_unit_count: plan.work_units.length,
      executable_target_count: plan.summary.executable_locator_unit_count,
      non_executed_blocked_target_count: plan.summary.blocked_non_executable_count,
      checked_count: checkedResults.length,
      reachable_count: results.filter((result) => result.status === 'reachable').length,
      blocked_count: blockedResults.length,
      redirected_count: results.filter((result) => result.status === 'redirected').length,
      same_domain_confirmed_count: results.filter((result) => result.same_domain_gate.same_domain === true).length,
      same_domain_unknown_count: results.filter((result) => result.same_domain_gate.same_domain === null).length,
    },
    results,
    controls: {
      dry_run_only: !executed,
      human_approval_required: true,
      url_opening_performed: executed,
      autonomous_crawl_authorized: false,
      autonomous_browsing_authorized: false,
      locator_resolution_authorized: false,
      locator_codegen_executed: false,
      element_identification_authorized: false,
      screenshot_capture_authorized: false,
      full_page_grabs_authorized: false,
      clip_generation_authorized: false,
      report_renderer_authorized: false,
      export_execution_authorized: false,
      workflow_engine_authorized: false,
      login_bypass_authorized: false,
      paywall_bypass_authorized: false,
      captcha_bypass_authorized: false,
      consent_bypass_authorized: false,
    },
    provenance: {
      created_at: createdAt,
      supervised_locator_plan_is_input_source: true,
      executable_only_for_approved_targets: true,
      blocked_draft_targets_preserved_as_non_executed: true,
      rejected_targets_excluded_by_input_plan: true,
      final_url_only_when_safely_known: true,
      http_metadata_only_when_available_without_escalation: true,
      dry_run_not_checked_fixture: !executed,
      planning_check_only: !executed,
      url_open_run_is_input_source: executed,
      url_open_run_path: openRun ? urlOpenRunPath : null,
      url_open_run_schema: openRun ? 'shared/schemas/employer-brand-live-evidence-url-open-run-v0.schema.json' : null,
      read_only: true,
      non_goals: cloneJson(NON_GOALS),
    },
  });
}

export function validateEmployerBrandLiveEvidenceUrlReachabilityCheck(checkInput = {}) {
  const errors = [];
  const check = objectValue(checkInput);
  const results = arrayValue(check.results);
  if (check.type !== EMPLOYER_BRAND_LIVE_EVIDENCE_URL_REACHABILITY_CHECK_TYPE) errors.push('type must identify an Employer Brand Live Evidence URL Reachability Check');
  if (check.schema_version !== EMPLOYER_BRAND_LIVE_EVIDENCE_URL_REACHABILITY_CHECK_SCHEMA_VERSION) errors.push('schema_version must be v0');
  if (results.length < 1) errors.push('results must include at least one supervised locator work unit');
  if (check.summary?.supervised_locator_work_unit_count !== results.length) errors.push('work unit count must match results length');
  if (check.summary?.executable_target_count !== results.filter((result) => result.executable === true).length) errors.push('executable target count must match executable results');
  if (check.summary?.checked_count !== results.filter((result) => result.executed === true).length) errors.push('checked count must match executed results');
  if (check.summary?.reachable_count !== results.filter((result) => result.status === 'reachable').length) errors.push('reachable count must match reachable results');
  if (check.summary?.blocked_count !== results.filter((result) => ['blocked', 'safety_gate_blocked'].includes(result.status)).length) errors.push('blocked count must match blocked results');
  const executedFixture = check.status === 'checked' || check.status === 'checked_with_blockers';
  if (check.controls?.url_opening_performed !== executedFixture) errors.push('URL opening performed control must match check status');
  if (check.controls?.dry_run_only !== !executedFixture) errors.push('dry-run control must match check status');
  if (check.provenance?.rejected_targets_excluded_by_input_plan !== true) errors.push('rejected targets must remain excluded by input plan');
  for (const result of results) {
    if (!URL_REACHABILITY_STATUSES.includes(result.status)) errors.push(`${result.target_id} status is invalid`);
    if (result.executed === false && result.status !== 'safety_gate_blocked' && result.checked_at !== null) errors.push(`${result.target_id} checked_at must stay null when not executed`);
    if (result.executed === false && result.status === 'not_checked' && result.final_url !== null) errors.push(`${result.target_id} final_url must stay null when not executed`);
    if (result.executed === false && result.status === 'not_checked' && result.http?.status_code !== null) errors.push(`${result.target_id} http.status_code must stay null when not executed`);
    if (result.executable !== true && result.status !== 'safety_gate_blocked') errors.push(`${result.target_id} non-executable target must be safety_gate_blocked`);
    if (result.executable === true && result.status !== 'not_checked' && result.executed !== true) errors.push(`${result.target_id} unexecuted executable target must be not_checked`);
    if (result.same_domain_gate?.same_domain_required !== true) errors.push(`${result.target_id} same-domain gate must be required`);
    if (!arrayValue(result.safety_gates).includes('same_domain_constraint')) errors.push(`${result.target_id} missing same-domain safety gate`);
  }
  for (const [key, value] of Object.entries(objectValue(check.controls))) {
    if (key === 'dry_run_only') {
      if (value !== !executedFixture) errors.push(`controls.${key} must match execution status`);
    } else if (key === 'human_approval_required') {
      if (value !== true) errors.push(`controls.${key} must be true`);
    } else if (key === 'url_opening_performed') {
      if (value !== executedFixture) errors.push(`controls.${key} must match execution status`);
    } else if (value !== false) {
      errors.push(`controls.${key} must remain false`);
    }
  }
  return {
    valid: errors.length === 0,
    errors,
  };
}

export function loadEmployerBrandLiveEvidenceUrlReachabilityCheck({
  fixtureRoot,
} = {}) {
  if (!fixtureRoot) throw new Error('fixtureRoot is required');
  return JSON.parse(fs.readFileSync(path.join(fixtureRoot, 'live-evidence-url-reachability-check.json'), 'utf8'));
}
