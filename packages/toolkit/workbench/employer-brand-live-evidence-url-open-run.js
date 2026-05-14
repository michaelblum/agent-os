import fs from 'node:fs';
import path from 'node:path';
import {
  normalizeEmployerBrandLiveEvidenceSupervisedLocatorPlan,
  validateEmployerBrandLiveEvidenceSupervisedLocatorPlan,
} from './employer-brand-live-evidence-supervised-locator-plan.js';

export const EMPLOYER_BRAND_LIVE_EVIDENCE_URL_OPEN_RUN_TYPE =
  'aos.employer_brand_live_evidence_url_open_run';
export const EMPLOYER_BRAND_LIVE_EVIDENCE_URL_OPEN_RUN_SCHEMA_VERSION =
  '2026-05-employer-brand-live-evidence-url-open-run-v0';

export const URL_OPEN_STATUSES = [
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

const BLOCKER_PATTERNS = [
  { status: 'captcha', pattern: /\b(captcha|recaptcha|verify you are human|human verification)\b/i },
  { status: 'paywall', pattern: /\b(paywall|subscribe to continue|subscription required)\b/i },
  { status: 'consent_required', pattern: /\b(cookie consent|privacy consent|accept cookies|consent required)\b/i },
  { status: 'login_required', pattern: /\b(log in|login|sign in|signin|authentication required)\b/i },
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
  'html_css_polish',
  'pdf_docx_export',
];

const CONTROLS = {
  bounded_target_url_open_authorized: true,
  dry_run_only: false,
  autonomous_crawl_authorized: false,
  autonomous_browsing_authorized: false,
  link_following_authorized: false,
  redirect_handling_authorized: true,
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

function hostnameFor(value) {
  return parseUrl(value)?.hostname || null;
}

function sameDomain(originalUrl, finalUrl) {
  const original = parseUrl(originalUrl);
  const final = parseUrl(finalUrl || originalUrl);
  if (!original || !final) return false;
  return original.hostname === final.hostname;
}

function redirectSummary(chain = []) {
  return arrayValue(chain).map((entry) => ({
    from_url: requireText(entry.from_url, 'redirect.from_url'),
    to_url: requireText(entry.to_url, 'redirect.to_url'),
    status_code: Number.isInteger(entry.status_code) ? entry.status_code : null,
  }));
}

function statusCounts(results) {
  return URL_OPEN_STATUSES.reduce((counts, status) => {
    counts[`${status}_count`] = results.filter((result) => result.status === status).length;
    return counts;
  }, {});
}

function classifySuccessfulNavigation(navigation) {
  const statusCode = Number.isInteger(navigation.http_status) ? navigation.http_status : null;
  const haystack = [navigation.title, navigation.blocker_reason].map((value) => text(value)).join(' ');
  for (const blocker of BLOCKER_PATTERNS) {
    if (blocker.pattern.test(haystack)) return blocker.status;
  }
  if (statusCode === 401 || statusCode === 403) return 'login_required';
  if (statusCode === 402) return 'paywall';
  if (statusCode === 408 || navigation.timed_out === true) return 'timeout';
  if (statusCode && statusCode >= 400) return 'network_error';
  if (statusCode && statusCode >= 500) return 'network_error';
  if (navigation.consent_required === true) return 'consent_required';
  if (navigation.captcha === true) return 'captcha';
  if (navigation.paywall === true) return 'paywall';
  if (navigation.login_required === true) return 'login_required';
  if (arrayValue(navigation.redirect_chain).length > 0 || navigation.final_url !== navigation.original_url) {
    return 'redirected';
  }
  return 'reachable';
}

function normalizeNavigationResult(rawNavigation, originalUrl) {
  const navigation = objectValue(rawNavigation);
  const status = URL_OPEN_STATUSES.includes(navigation.status)
    ? navigation.status
    : classifySuccessfulNavigation({
      ...navigation,
      original_url: originalUrl,
      final_url: navigation.final_url || originalUrl,
    });
  return {
    status,
    final_url: optionalText(navigation.final_url) || originalUrl,
    redirect_chain: redirectSummary(navigation.redirect_chain),
    http_status: Number.isInteger(navigation.http_status) ? navigation.http_status : null,
    title: optionalText(navigation.title),
    blocker_reason: optionalText(navigation.blocker_reason),
    operator_notes: optionalText(navigation.operator_notes),
  };
}

function notRunResult(workUnit, index, { checkedAt, operatorNotes }) {
  const blocked = workUnit.executable !== true;
  return {
    result_id: workUnit.work_unit_id.replace('live-locator-work-unit:', 'url-open-result:'),
    work_unit_id: workUnit.work_unit_id,
    target_id: workUnit.target_id,
    executable: workUnit.executable === true,
    opened: false,
    status: blocked ? 'safety_gate_blocked' : 'not_run',
    original_url: workUnit.url,
    final_url: null,
    same_domain: null,
    redirect_chain: [],
    http_status: null,
    title: null,
    blocker_reason: blocked
      ? ['non_executable_target_not_opened', ...arrayValue(workUnit.blockers)].join('; ')
      : null,
    checked_at: null,
    operator_notes: blocked
      ? 'Preserved from supervised locator plan as non-executable; URL was not opened.'
      : (operatorNotes || 'Executable approved target was not opened in this fixture run.'),
    harness_notes: blocked
      ? 'Safety-gated before URL open because the work unit is not executable.'
      : 'Fixture entry only. Use the explicit CLI --execute path for bounded supervised URL opening.',
    provenance: {
      source_supervised_locator_plan_target_id: workUnit.target_id,
      source_supervised_locator_plan_work_unit_id: workUnit.work_unit_id,
      source_index: index,
      source_url_reachability_check_result_id: workUnit.work_unit_id.replace('live-locator-work-unit:', 'url-reachability-result:'),
      target_url_only: true,
      no_locator_resolution: true,
      no_element_identification: true,
      no_capture: true,
      no_report_or_export: true,
    },
  };
}

async function openedResult(workUnit, index, { checkedAt, navigate, timeoutMs, operatorNotes }) {
  const originalUrl = workUnit.url;
  const parsed = parseUrl(originalUrl);
  if (!parsed || !['http:', 'https:'].includes(parsed.protocol)) {
    return {
      ...notRunResult(workUnit, index, { checkedAt, operatorNotes }),
      opened: false,
      status: 'safety_gate_blocked',
      blocker_reason: 'unsupported_or_invalid_target_url',
      checked_at: checkedAt,
      harness_notes: 'Safety gate blocked before navigation because the URL is not http(s).',
    };
  }

  let navigation;
  try {
    navigation = normalizeNavigationResult(await navigate(originalUrl, { timeoutMs }), originalUrl);
  } catch (caught) {
    const code = text(caught?.code || caught?.name).toLowerCase();
    const timedOut = code.includes('timeout') || /timeout/i.test(text(caught?.message));
    navigation = {
      status: timedOut ? 'timeout' : 'network_error',
      final_url: originalUrl,
      redirect_chain: [],
      http_status: null,
      title: null,
      blocker_reason: text(caught?.message, timedOut ? 'navigation timeout' : 'network error'),
      operator_notes: null,
    };
  }

  const finalUrl = navigation.final_url || originalUrl;
  const same = sameDomain(originalUrl, finalUrl);
  if (same !== true && navigation.status !== 'network_error' && navigation.status !== 'timeout') {
    navigation.status = 'safety_gate_blocked';
    navigation.blocker_reason = text(
      navigation.blocker_reason,
      `Redirect left approved target domain: ${hostnameFor(originalUrl)} -> ${hostnameFor(finalUrl)}`,
    );
  }

  return {
    result_id: workUnit.work_unit_id.replace('live-locator-work-unit:', 'url-open-result:'),
    work_unit_id: workUnit.work_unit_id,
    target_id: workUnit.target_id,
    executable: true,
    opened: !['timeout', 'network_error', 'safety_gate_blocked'].includes(navigation.status) || navigation.http_status !== null,
    status: navigation.status,
    original_url: originalUrl,
    final_url: finalUrl,
    same_domain: same,
    redirect_chain: navigation.redirect_chain,
    http_status: navigation.http_status,
    title: navigation.title,
    blocker_reason: navigation.blocker_reason,
    checked_at: checkedAt,
    operator_notes: navigation.operator_notes || operatorNotes || null,
    harness_notes: 'Bounded supervised URL open recorded only navigation metadata; no locator, element, screenshot, clip, report, export, workflow, or crawl work was performed.',
    provenance: {
      source_supervised_locator_plan_target_id: workUnit.target_id,
      source_supervised_locator_plan_work_unit_id: workUnit.work_unit_id,
      source_index: index,
      source_url_reachability_check_result_id: workUnit.work_unit_id.replace('live-locator-work-unit:', 'url-reachability-result:'),
      target_url_only: true,
      no_locator_resolution: true,
      no_element_identification: true,
      no_capture: true,
      no_report_or_export: true,
    },
  };
}

export async function fetchUrlOpenNavigation(url, { timeoutMs = 10_000, maxRedirects = 5 } = {}) {
  const redirect_chain = [];
  let current = url;
  for (let index = 0; index <= maxRedirects; index += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(new Error('navigation timeout')), timeoutMs);
    let response;
    try {
      response = await fetch(current, {
        method: 'GET',
        redirect: 'manual',
        signal: controller.signal,
        headers: {
          'user-agent': 'aos-employer-brand-url-open-run-v0',
          accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        },
      });
    } finally {
      clearTimeout(timeout);
    }

    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get('location');
      if (!location) {
        return {
          final_url: current,
          redirect_chain,
          http_status: response.status,
          blocker_reason: 'redirect_response_missing_location_header',
        };
      }
      const next = new URL(location, current).href;
      redirect_chain.push({ from_url: current, to_url: next, status_code: response.status });
      current = next;
      continue;
    }

    let title = null;
    const contentType = response.headers.get('content-type') || '';
    if (/html/i.test(contentType) && response.body) {
      const reader = response.body.getReader();
      const chunks = [];
      let total = 0;
      while (total < 65_536) {
        const { done, value } = await reader.read();
        if (done || !value) break;
        chunks.push(value);
        total += value.byteLength;
      }
      await reader.cancel().catch(() => {});
      const html = new TextDecoder().decode(Buffer.concat(chunks));
      title = optionalText(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.replace(/<[^>]+>/g, ' '));
    }

    return {
      final_url: response.url || current,
      redirect_chain,
      http_status: response.status,
      title,
    };
  }
  return {
    final_url: current,
    redirect_chain,
    http_status: null,
    blocker_reason: 'redirect_limit_exceeded',
    status: 'safety_gate_blocked',
  };
}

export function normalizeEmployerBrandLiveEvidenceUrlOpenRun(runInput = {}) {
  const run = objectValue(runInput);
  const results = arrayValue(run.results).map((resultInput) => {
    const result = objectValue(resultInput);
    return {
      result_id: requireText(result.result_id, 'result_id'),
      work_unit_id: requireText(result.work_unit_id, 'work_unit_id'),
      target_id: requireText(result.target_id, 'target_id'),
      executable: result.executable === true,
      opened: result.opened === true,
      status: requireText(result.status, 'status'),
      original_url: requireText(result.original_url, 'original_url'),
      final_url: optionalText(result.final_url),
      same_domain: typeof result.same_domain === 'boolean' ? result.same_domain : null,
      redirect_chain: redirectSummary(result.redirect_chain),
      http_status: Number.isInteger(result.http_status) ? result.http_status : null,
      title: optionalText(result.title),
      blocker_reason: optionalText(result.blocker_reason),
      checked_at: optionalText(result.checked_at),
      operator_notes: optionalText(result.operator_notes),
      harness_notes: optionalText(result.harness_notes),
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
        source_url_reachability_check_result_id: optionalText(result.provenance?.source_url_reachability_check_result_id),
        target_url_only: result.provenance?.target_url_only !== false,
        no_locator_resolution: result.provenance?.no_locator_resolution !== false,
        no_element_identification: result.provenance?.no_element_identification !== false,
        no_capture: result.provenance?.no_capture !== false,
        no_report_or_export: result.provenance?.no_report_or_export !== false,
      },
    };
  });
  return {
    type: EMPLOYER_BRAND_LIVE_EVIDENCE_URL_OPEN_RUN_TYPE,
    schema_version: EMPLOYER_BRAND_LIVE_EVIDENCE_URL_OPEN_RUN_SCHEMA_VERSION,
    id: requireText(run.id, 'id'),
    label: requireText(run.label, 'label'),
    status: requireText(run.status, 'status'),
    source_refs: cloneJson(objectValue(run.source_refs)),
    run_config: {
      timeout_ms: Number(run.run_config?.timeout_ms ?? 10_000),
      navigation_scope: text(run.run_config?.navigation_scope, 'target_url_initial_navigation_only'),
      max_redirects: Number(run.run_config?.max_redirects ?? 5),
      title_observation: text(run.run_config?.title_observation, 'safe_page_title_only_when_available'),
      operator: optionalText(run.run_config?.operator),
    },
    summary: {
      ...statusCounts(results),
      supervised_locator_work_unit_count: Number(run.summary?.supervised_locator_work_unit_count ?? results.length),
      executable_target_count: Number(run.summary?.executable_target_count ?? results.filter((result) => result.executable).length),
      opened_count: Number(run.summary?.opened_count ?? results.filter((result) => result.opened).length),
      same_domain_confirmed_count: Number(run.summary?.same_domain_confirmed_count ?? results.filter((result) => result.same_domain === true).length),
      same_domain_blocked_count: Number(run.summary?.same_domain_blocked_count ?? results.filter((result) => result.status === 'safety_gate_blocked' && result.same_domain === false).length),
      non_executable_preserved_count: Number(run.summary?.non_executable_preserved_count ?? results.filter((result) => !result.executable).length),
      rejected_exclusion_count: Number(run.summary?.rejected_exclusion_count ?? arrayValue(run.rejected_exclusions).length),
    },
    results,
    blocked_entries: cloneJson(arrayValue(run.blocked_entries)),
    rejected_exclusions: cloneJson(arrayValue(run.rejected_exclusions)),
    controls: { ...CONTROLS, ...cloneJson(objectValue(run.controls)) },
    provenance: {
      created_at: optionalText(run.provenance?.created_at),
      supervised_locator_plan_is_input_source: run.provenance?.supervised_locator_plan_is_input_source !== false,
      url_reachability_check_is_optional_input_source: run.provenance?.url_reachability_check_is_optional_input_source === true,
      executable_only_for_approved_targets: run.provenance?.executable_only_for_approved_targets !== false,
      blocked_draft_targets_preserved_as_non_executed: run.provenance?.blocked_draft_targets_preserved_as_non_executed !== false,
      rejected_targets_preserved_as_exclusions: run.provenance?.rejected_targets_preserved_as_exclusions !== false,
      safely_observable_metadata_only: run.provenance?.safely_observable_metadata_only !== false,
      non_goals: cloneJson(arrayValue(run.provenance?.non_goals).length ? run.provenance.non_goals : NON_GOALS),
    },
  };
}

export async function buildEmployerBrandLiveEvidenceUrlOpenRun({
  supervisedLocatorPlan,
  urlReachabilityCheck = null,
  approvalPatch = null,
  execute = false,
  navigate = fetchUrlOpenNavigation,
  checkedAt = null,
  timeoutMs = 10_000,
  maxRedirects = 5,
  operator = null,
  operatorNotes = null,
  supervisedLocatorPlanPath = 'live-evidence-supervised-locator-plan.json',
  urlReachabilityCheckPath = 'live-evidence-url-reachability-check.json',
  approvalPatchPath = 'live-evidence-target-approval-patch.json',
} = {}) {
  const validation = validateEmployerBrandLiveEvidenceSupervisedLocatorPlan(supervisedLocatorPlan);
  if (!validation.valid) throw new Error(`Supervised locator plan validation failed: ${validation.errors.join('; ')}`);
  const plan = normalizeEmployerBrandLiveEvidenceSupervisedLocatorPlan(supervisedLocatorPlan);
  const blockedEntries = [];
  const results = [];

  for (const [index, workUnit] of plan.work_units.entries()) {
    if (workUnit.executable !== true || execute !== true) {
      const result = notRunResult(workUnit, index, { checkedAt, operatorNotes });
      results.push(result);
      if (workUnit.executable !== true) blockedEntries.push(result);
      continue;
    }
    results.push(await openedResult(workUnit, index, {
      checkedAt,
      navigate: (url, options) => navigate(url, { ...options, maxRedirects }),
      timeoutMs,
      operatorNotes,
    }));
  }

  const rejectedExclusions = arrayValue(approvalPatch?.decisions)
    .filter((decision) => decision?.decision === 'reject')
    .map((decision) => ({
      target_id: requireText(decision.target_id, 'decision.target_id'),
      decision: 'reject',
      reason: optionalText(decision.reviewer_notes) || 'Rejected target excluded before URL open run.',
      source_approval_patch_path: approvalPatchPath,
    }));

  const status = execute
    ? (results.some((result) => ['login_required', 'paywall', 'captcha', 'consent_required', 'network_error', 'timeout', 'safety_gate_blocked'].includes(result.status))
      ? 'completed_with_blockers'
      : 'completed')
    : 'not_run_fixture';

  return normalizeEmployerBrandLiveEvidenceUrlOpenRun({
    id: plan.id.replace('live-evidence-supervised-locator-plan:', 'live-evidence-url-open-run:'),
    label: `${plan.label.replace(/ Live Evidence Supervised Locator Plan$/, '')} Live Evidence URL Open Run`,
    status,
    source_refs: {
      supervised_locator_plan_id: plan.id,
      supervised_locator_plan_path: supervisedLocatorPlanPath,
      supervised_locator_plan_schema: 'shared/schemas/employer-brand-live-evidence-supervised-locator-plan-v0.schema.json',
      url_reachability_check_id: urlReachabilityCheck?.id || null,
      url_reachability_check_path: urlReachabilityCheck ? urlReachabilityCheckPath : null,
      url_reachability_check_schema: urlReachabilityCheck ? 'shared/schemas/employer-brand-live-evidence-url-reachability-check-v0.schema.json' : null,
      approval_patch_id: approvalPatch?.id || null,
      approval_patch_path: approvalPatch ? approvalPatchPath : null,
    },
    run_config: {
      timeout_ms: timeoutMs,
      navigation_scope: 'target_url_initial_navigation_only',
      max_redirects: maxRedirects,
      title_observation: 'safe_page_title_only_when_available',
      operator,
    },
    results,
    blocked_entries: blockedEntries,
    rejected_exclusions: rejectedExclusions,
    controls: {
      ...cloneJson(CONTROLS),
      dry_run_only: !execute,
      bounded_target_url_open_authorized: execute === true,
    },
    provenance: {
      created_at: checkedAt,
      supervised_locator_plan_is_input_source: true,
      url_reachability_check_is_optional_input_source: Boolean(urlReachabilityCheck),
      executable_only_for_approved_targets: true,
      blocked_draft_targets_preserved_as_non_executed: true,
      rejected_targets_preserved_as_exclusions: true,
      safely_observable_metadata_only: true,
      non_goals: cloneJson(NON_GOALS),
    },
  });
}

export function validateEmployerBrandLiveEvidenceUrlOpenRun(runInput = {}) {
  const errors = [];
  const run = objectValue(runInput);
  const results = arrayValue(run.results);
  if (run.type !== EMPLOYER_BRAND_LIVE_EVIDENCE_URL_OPEN_RUN_TYPE) errors.push('type must identify an Employer Brand Live Evidence URL Open Run');
  if (run.schema_version !== EMPLOYER_BRAND_LIVE_EVIDENCE_URL_OPEN_RUN_SCHEMA_VERSION) errors.push('schema_version must be URL Open Run V0');
  if (!['not_run_fixture', 'completed', 'completed_with_blockers'].includes(run.status)) errors.push('run status is invalid');
  if (results.length < 1) errors.push('results must include supervised locator work units');
  if (run.summary?.supervised_locator_work_unit_count !== results.length) errors.push('work unit count must match results length');
  if (run.summary?.executable_target_count !== results.filter((result) => result.executable === true).length) errors.push('executable target count must match executable results');
  if (run.summary?.opened_count !== results.filter((result) => result.opened === true).length) errors.push('opened count must match opened results');
  if (run.summary?.rejected_exclusion_count !== arrayValue(run.rejected_exclusions).length) errors.push('rejected exclusion count must match rejected exclusions');
  for (const status of URL_OPEN_STATUSES) {
    if (run.summary?.[`${status}_count`] !== results.filter((result) => result.status === status).length) {
      errors.push(`${status} count must match result statuses`);
    }
  }
  for (const result of results) {
    if (!URL_OPEN_STATUSES.includes(result.status)) errors.push(`${result.target_id} status is invalid`);
    if (result.executable !== true && result.status !== 'safety_gate_blocked') errors.push(`${result.target_id} non-executable target must be safety-gated`);
    if (result.executable === true && result.status === 'not_run' && result.opened === true) errors.push(`${result.target_id} not_run target cannot be opened`);
    if (result.status !== 'not_run' && result.status !== 'safety_gate_blocked' && !result.checked_at) errors.push(`${result.target_id} checked_at is required for opened target statuses`);
    if (result.same_domain === false && result.status !== 'safety_gate_blocked') errors.push(`${result.target_id} cross-domain final URL must be safety_gate_blocked`);
    if (result.provenance?.target_url_only !== true) errors.push(`${result.target_id} must record target_url_only provenance`);
    if (result.provenance?.no_locator_resolution !== true) errors.push(`${result.target_id} must forbid locator resolution`);
    if (result.provenance?.no_element_identification !== true) errors.push(`${result.target_id} must forbid element identification`);
    if (result.provenance?.no_capture !== true) errors.push(`${result.target_id} must forbid capture`);
    if (result.provenance?.no_report_or_export !== true) errors.push(`${result.target_id} must forbid report/export`);
  }
  const executedFixture = run.status === 'completed' || run.status === 'completed_with_blockers';
  for (const [key, value] of Object.entries(CONTROLS)) {
    if (key === 'dry_run_only') {
      if (run.controls?.[key] !== !executedFixture) errors.push(`controls.${key} must match execution status`);
    } else if (key === 'bounded_target_url_open_authorized') {
      if (run.controls?.[key] !== executedFixture) errors.push(`controls.${key} must match execution status`);
    } else if (run.controls?.[key] !== value) {
      errors.push(`controls.${key} must be ${value}`);
    }
  }
  return {
    valid: errors.length === 0,
    errors,
  };
}

export function loadEmployerBrandLiveEvidenceUrlOpenRun({ fixtureRoot } = {}) {
  if (!fixtureRoot) throw new Error('fixtureRoot is required');
  return JSON.parse(fs.readFileSync(path.join(fixtureRoot, 'live-evidence-url-open-run.json'), 'utf8'));
}
