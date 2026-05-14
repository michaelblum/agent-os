import fs from 'node:fs';
import path from 'node:path';
import {
  normalizeEmployerBrandLiveEvidenceTargetPlan,
  validateEmployerBrandLiveEvidenceTargetPlan,
} from './employer-brand-live-evidence-target-plan.js';
import {
  normalizeEmployerBrandLiveEvidenceUrlReachabilityCheck,
  validateEmployerBrandLiveEvidenceUrlReachabilityCheck,
} from './employer-brand-live-evidence-url-reachability-check.js';

export const EMPLOYER_BRAND_LIVE_EVIDENCE_LOCATOR_READINESS_TYPE =
  'aos.employer_brand_live_evidence_locator_readiness';
export const EMPLOYER_BRAND_LIVE_EVIDENCE_LOCATOR_READINESS_SCHEMA_VERSION =
  '2026-05-employer-brand-live-evidence-locator-readiness-v0';

const READINESS_STATES = [
  'locator_ready',
  'needs_locator',
  'needs_human_target_review',
  'rejected_excluded',
  'not_checked',
];
const URL_REACHABILITY_STATES = [
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
const NULL_LOCATORS = {
  selector: null,
  xpath: null,
  playwright_locator: null,
  codegen_hint: null,
  crawl_discovery_notes: null,
  capture_script_slot: null,
};
const HUMAN_LOCATOR_READY_DECISIONS = [
  'approve_selector',
  'edit_selector',
  'provide_xpath',
  'provide_playwright_locator',
];
const NON_GOALS = [
  'live_browser_collection',
  'url_reachability_checks',
  'locator_codegen_execution',
  'screenshots',
  'clip_generation',
  'report_rendering',
  'html_css_polish',
  'pdf_docx_export',
  'workflow_engine',
  'full_page_grabs',
];

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

function approvalDecisionMap(patchInput) {
  return new Map(arrayValue(patchInput?.decisions).map((decision) => [
    requireText(decision.target_id, 'decision.target_id'),
    {
      decision: requireText(decision.decision, 'decision.decision'),
      reviewer_notes: optionalText(decision.reviewer_notes),
    },
  ]));
}

function rejectedTargetIds(patchInput) {
  return new Set(
    arrayValue(patchInput?.decisions)
      .filter((decision) => decision.decision === 'reject')
      .map((decision) => requireText(decision.target_id, 'decision.target_id')),
  );
}

function locatorReady(locatorPlaceholders) {
  const locators = objectValue(locatorPlaceholders);
  return Boolean(text(locators.selector) || text(locators.xpath) || text(locators.playwright_locator));
}

function hasHumanApprovedLocator(target) {
  const provenance = objectValue(target.provenance);
  return Boolean(
    provenance.source_human_locator_approval_patch_path === 'live-evidence-human-locator-approval-patch.json'
      && HUMAN_LOCATOR_READY_DECISIONS.includes(provenance.human_locator_decision)
      && locatorReady(target.locator_placeholders),
  );
}

function classifyReadiness(target, approvalDecision) {
  if (!approvalDecision) {
    return {
      readiness_state: 'not_checked',
      blockers: ['approval_decision_missing'],
      required_next_action: 'Review the target approval decision before locator planning.',
    };
  }
  if (approvalDecision === 'reject') {
    return {
      readiness_state: 'rejected_excluded',
      blockers: ['approval_decision_rejected'],
      required_next_action: 'No locator action. Target was rejected by review.',
    };
  }
  if (target.review_status !== 'approved') {
    return {
      readiness_state: 'needs_human_target_review',
      blockers: ['target_review_status_not_approved', 'locator_placeholders_unresolved', 'url_reachability_not_checked'],
      required_next_action: 'Complete human target review before supervised locator/codegen work.',
    };
  }
  if (!locatorReady(target.locator_placeholders)) {
    return {
      readiness_state: 'needs_locator',
      blockers: ['locator_placeholders_unresolved', 'url_reachability_not_checked'],
      required_next_action: 'Run supervised locator/codegen planning for this approved target.',
    };
  }
  return {
    readiness_state: 'locator_ready',
    blockers: ['url_reachability_not_checked'],
    required_next_action: 'Run URL reachability and capture preflight checks before execution.',
  };
}

function blockersWithReachability(blockers, reachabilityStatus) {
  const next = arrayValue(blockers).filter((blocker) => blocker !== 'url_reachability_not_checked');
  if (reachabilityStatus === 'not_checked') next.push('url_reachability_not_checked');
  if (['login_required', 'paywall', 'captcha', 'consent_required', 'network_error', 'safety_gate_blocked'].includes(reachabilityStatus)) {
    next.push(`url_reachability_${reachabilityStatus}`);
  }
  return unique(next);
}

function groupCounts(targets, keyFn) {
  return targets.reduce((groups, target) => {
    const key = keyFn(target);
    groups[key] = (groups[key] || 0) + 1;
    return groups;
  }, {});
}

function readinessCounts(targets) {
  const counts = Object.fromEntries(READINESS_STATES.map((state) => [`${state}_count`, 0]));
  for (const target of targets) counts[`${target.readiness_state}_count`] += 1;
  return counts;
}

export function normalizeEmployerBrandLiveEvidenceLocatorReadiness(readinessInput = {}) {
  const readiness = objectValue(readinessInput);
  const targets = arrayValue(readiness.targets).map((targetInput) => {
    const target = objectValue(targetInput);
    return {
      target_id: requireText(target.target_id, 'target_id'),
      company: requireText(target.company, 'company'),
      source_category: requireText(target.source_category, 'source_category'),
      url: requireText(target.url, 'url'),
      review_status: requireText(target.review_status, 'review_status'),
      approval_decision: requireText(target.approval_decision, 'approval_decision'),
      desired_element_summary: requireText(target.desired_element_summary, 'desired_element_summary'),
      capture_type: requireText(target.capture_type, 'capture_type'),
      expected_clip_count: Number(target.expected_clip_count ?? 0),
      kilos_relevance: cloneJson(arrayValue(target.kilos_relevance)),
      locator_placeholders: {
        ...cloneJson(NULL_LOCATORS),
        ...cloneJson(objectValue(target.locator_placeholders)),
      },
      url_reachability: text(target.url_reachability, 'not_checked'),
      readiness_state: requireText(target.readiness_state, 'readiness_state'),
      blockers: cloneJson(arrayValue(target.blockers)),
      required_next_action: requireText(target.required_next_action, 'required_next_action'),
      provenance: {
        source_reviewed_target_plan_path: text(target.provenance?.source_reviewed_target_plan_path, 'live-evidence-reviewed-target-plan.json'),
        source_approval_patch_path: text(target.provenance?.source_approval_patch_path, 'live-evidence-target-approval-patch.json'),
        source_review_pack_path: text(target.provenance?.source_review_pack_path, 'live-evidence-target-review-pack.json'),
        source_data_bundle_path: text(target.provenance?.source_data_bundle_path, 'data-bundle.json'),
        source_url_reachability_check_path: text(target.provenance?.source_url_reachability_check_path, 'live-evidence-url-reachability-check.json'),
        source_url_reachability_result_id: optionalText(target.provenance?.source_url_reachability_result_id),
        source_human_locator_review_pack_path: optionalText(target.provenance?.source_human_locator_review_pack_path),
        source_human_locator_approval_patch_path: optionalText(target.provenance?.source_human_locator_approval_patch_path),
        source_human_locator_approval_patch_id: optionalText(target.provenance?.source_human_locator_approval_patch_id),
        human_locator_decision: optionalText(target.provenance?.human_locator_decision),
        human_locator_review_item_id: optionalText(target.provenance?.human_locator_review_item_id),
        human_locator_work_unit_id: optionalText(target.provenance?.human_locator_work_unit_id),
        planning_metadata_only: target.provenance?.planning_metadata_only !== false,
        read_only: target.provenance?.read_only !== false,
      },
    };
  });
  const counts = readinessCounts(targets);
  return {
    ...cloneJson(readiness),
    targets,
    summary: {
      source_target_count: Number(readiness.summary?.source_target_count ?? targets.length),
      excluded_rejected_count: Number(readiness.summary?.excluded_rejected_count ?? 0),
      approved_count: Number(readiness.summary?.approved_count ?? targets.filter((target) => target.approval_decision === 'approve').length),
      draft_count: Number(readiness.summary?.draft_count ?? targets.filter((target) => target.approval_decision === 'keep_draft').length),
      locator_ready_count: Number(readiness.summary?.locator_ready_count ?? counts.locator_ready_count),
      needs_locator_count: Number(readiness.summary?.needs_locator_count ?? counts.needs_locator_count),
      needs_human_target_review_count: Number(readiness.summary?.needs_human_target_review_count ?? counts.needs_human_target_review_count),
      needs_human_locator_review_count: Number(readiness.summary?.needs_human_locator_review_count ?? counts.not_checked_count),
      blocked_count: Number(readiness.summary?.blocked_count ?? targets.filter((target) => target.readiness_state === 'not_checked' && target.blockers.includes('human_locator_blocked')).length),
      rejected_count: Number(readiness.summary?.rejected_count ?? 0),
      url_not_checked_count: Number(readiness.summary?.url_not_checked_count ?? targets.filter((target) => target.url_reachability === 'not_checked').length),
      expected_clip_count_for_included_targets: Number(readiness.summary?.expected_clip_count_for_included_targets ?? targets.reduce((count, target) => count + target.expected_clip_count, 0)),
      expected_ready_clip_count: Number(readiness.summary?.expected_ready_clip_count ?? targets.filter((target) => target.readiness_state === 'locator_ready').reduce((count, target) => count + target.expected_clip_count, 0)),
      grouped_by_company: cloneJson(Object.keys(objectValue(readiness.summary?.grouped_by_company)).length ? readiness.summary.grouped_by_company : groupCounts(targets, (target) => target.company)),
      grouped_by_source_category: cloneJson(Object.keys(objectValue(readiness.summary?.grouped_by_source_category)).length ? readiness.summary.grouped_by_source_category : groupCounts(targets, (target) => target.source_category)),
    },
  };
}

export function buildEmployerBrandLiveEvidenceLocatorReadiness({
  reviewedTargetPlan,
  approvalPatch,
  reviewPack = null,
  dataBundle = null,
  urlReachabilityCheck = null,
  createdAt = null,
  reviewedTargetPlanPath = 'live-evidence-reviewed-target-plan.json',
} = {}) {
  const planValidation = validateEmployerBrandLiveEvidenceTargetPlan(reviewedTargetPlan);
  if (!planValidation.valid) throw new Error(`Reviewed target plan validation failed: ${planValidation.errors.join('; ')}`);
  const reviewedPlan = normalizeEmployerBrandLiveEvidenceTargetPlan(reviewedTargetPlan);
  const decisionsById = approvalDecisionMap(approvalPatch);
  const rejectedIds = rejectedTargetIds(approvalPatch);
  let reachability = null;
  if (urlReachabilityCheck) {
    const reachabilityValidation = validateEmployerBrandLiveEvidenceUrlReachabilityCheck(urlReachabilityCheck);
    if (!reachabilityValidation.valid) throw new Error(`URL reachability check validation failed: ${reachabilityValidation.errors.join('; ')}`);
    reachability = normalizeEmployerBrandLiveEvidenceUrlReachabilityCheck(urlReachabilityCheck);
  }
  const reachabilityByTargetId = new Map(arrayValue(reachability?.results).map((result) => [result.target_id, result]));
  const includedTargets = reviewedPlan.targets.filter((target) => !rejectedIds.has(target.target_id));
  const targets = includedTargets.map((target) => {
    const decision = decisionsById.get(target.target_id);
    const approvalDecision = decision?.decision || null;
    const classification = classifyReadiness(target, approvalDecision);
    const reachabilityResult = reachabilityByTargetId.get(target.target_id) || null;
    const urlReachability = reachabilityResult?.status || 'not_checked';
    return {
      target_id: target.target_id,
      company: target.company,
      source_category: target.source_category,
      url: target.url,
      review_status: target.review_status,
      approval_decision: approvalDecision || 'not_checked',
      desired_element_summary: target.target_element,
      capture_type: target.capture_type,
      expected_clip_count: target.expected_clip_count,
      kilos_relevance: cloneJson(target.kilos_relevance),
      locator_placeholders: cloneJson(target.locator_placeholders),
      url_reachability: urlReachability,
      ...classification,
      blockers: blockersWithReachability(classification.blockers, urlReachability),
      provenance: {
        source_reviewed_target_plan_path: reviewedTargetPlanPath,
        source_reviewed_target_plan_id: reviewedPlan.id,
        source_approval_patch_path: 'live-evidence-target-approval-patch.json',
        source_approval_patch_id: approvalPatch?.id || null,
        source_review_pack_path: reviewPack ? 'live-evidence-target-review-pack.json' : null,
        source_review_pack_id: reviewPack?.id || null,
      source_data_bundle_path: dataBundle ? 'data-bundle.json' : null,
      source_data_bundle_id: dataBundle?.id || null,
      source_url_reachability_check_path: 'live-evidence-url-reachability-check.json',
      source_url_reachability_result_id: reachabilityResult?.result_id || null,
      planning_metadata_only: true,
      read_only: true,
      },
    };
  });
  const summaryCounts = readinessCounts(targets);
  return normalizeEmployerBrandLiveEvidenceLocatorReadiness({
    type: EMPLOYER_BRAND_LIVE_EVIDENCE_LOCATOR_READINESS_TYPE,
    schema_version: EMPLOYER_BRAND_LIVE_EVIDENCE_LOCATOR_READINESS_SCHEMA_VERSION,
    id: reviewedPlan.id.replace('live-evidence-reviewed-target-plan:', 'live-evidence-locator-readiness:'),
    label: `${reviewedPlan.label.replace(/ Reviewed Live Evidence Target Plan$/, '')} Live Evidence Locator Readiness`,
    status: targets.some((target) => target.readiness_state === 'needs_human_target_review')
      ? 'needs_human_target_review'
      : 'needs_locator',
    source_refs: {
      reviewed_target_plan_id: reviewedPlan.id,
      reviewed_target_plan_path: reviewedTargetPlanPath,
      reviewed_target_plan_schema: 'shared/schemas/employer-brand-live-evidence-target-plan-v0.schema.json',
      approval_patch_id: approvalPatch?.id || null,
      approval_patch_path: 'live-evidence-target-approval-patch.json',
      review_pack_id: reviewPack?.id || null,
      review_pack_path: reviewPack ? 'live-evidence-target-review-pack.json' : null,
      data_bundle_id: dataBundle?.id || null,
      data_bundle_path: dataBundle ? 'data-bundle.json' : null,
      url_reachability_check_id: reachability?.id || null,
      url_reachability_check_path: reachability ? 'live-evidence-url-reachability-check.json' : null,
      url_reachability_check_schema: reachability ? 'shared/schemas/employer-brand-live-evidence-url-reachability-check-v0.schema.json' : null,
    },
    summary: {
      source_target_count: reviewedPlan.review_decision_summary?.total_targets
        ?? reviewedPlan.expected_totals?.target_count
        ?? targets.length + rejectedIds.size,
      excluded_rejected_count: reviewedPlan.review_decision_summary?.rejected_count ?? rejectedIds.size,
      approved_count: targets.filter((target) => target.approval_decision === 'approve').length,
      draft_count: targets.filter((target) => target.approval_decision === 'keep_draft').length,
      locator_ready_count: summaryCounts.locator_ready_count,
      needs_locator_count: summaryCounts.needs_locator_count,
      needs_human_target_review_count: summaryCounts.needs_human_target_review_count,
      url_not_checked_count: targets.filter((target) => target.url_reachability === 'not_checked').length,
      expected_clip_count_for_included_targets: targets.reduce((count, target) => count + target.expected_clip_count, 0),
      grouped_by_company: groupCounts(targets, (target) => target.company),
      grouped_by_source_category: groupCounts(targets, (target) => target.source_category),
    },
    targets,
    controls: {
      live_browser_collection_authorized: false,
      url_reachability_checks_authorized: false,
      locator_codegen_execution_authorized: false,
      screenshot_capture_authorized: false,
      clip_generation_authorized: false,
      report_renderer_authorized: false,
      html_css_polish_authorized: false,
      pdf_docx_export_authorized: false,
      workflow_engine_authorized: false,
      full_page_grabs_authorized: false,
    },
    provenance: {
      created_at: createdAt,
      reviewed_plan_is_input_source: true,
      rejected_targets_excluded: true,
      url_reachability_default: 'not_checked',
      locators_preserved_from_reviewed_plan: true,
      url_reachability_check_path: 'live-evidence-url-reachability-check.json',
      url_reachability_check_schema: 'shared/schemas/employer-brand-live-evidence-url-reachability-check-v0.schema.json',
      url_reachability_check_read_only_planning_evidence: true,
      url_reachability_check_is_input_source: Boolean(reachability),
      url_reachability_checked_count: reachability?.summary?.checked_count ?? 0,
      arbitrary_n_company_grouping: true,
      planning_metadata_only: true,
      read_only: true,
      non_goals: cloneJson(NON_GOALS),
    },
  });
}

export function validateEmployerBrandLiveEvidenceLocatorReadiness(readinessInput = {}) {
  const errors = [];
  const readiness = objectValue(readinessInput);
  const targets = arrayValue(readiness.targets);
  if (readiness.type !== EMPLOYER_BRAND_LIVE_EVIDENCE_LOCATOR_READINESS_TYPE) errors.push('type must identify an Employer Brand Live Evidence Locator Readiness bundle');
  if (readiness.schema_version !== EMPLOYER_BRAND_LIVE_EVIDENCE_LOCATOR_READINESS_SCHEMA_VERSION) errors.push('schema_version must be v0');
  if (targets.length < 1) errors.push('targets must include at least one non-rejected reviewed target');
  if (readiness.provenance?.reviewed_plan_is_input_source !== true) errors.push('reviewed plan must be the readiness input source');
  if (readiness.provenance?.rejected_targets_excluded !== true) errors.push('rejected targets must be excluded');
  if (readiness.provenance?.url_reachability_check_path !== 'live-evidence-url-reachability-check.json') errors.push('URL reachability check path must be recorded as read-only planning evidence');
  if (readiness.provenance?.url_reachability_check_read_only_planning_evidence !== true) errors.push('URL reachability check metadata must remain read-only planning evidence');
  if (readiness.summary?.source_target_count !== targets.length + readiness.summary?.excluded_rejected_count) errors.push('source target count must equal included plus rejected-excluded counts');
  if (readiness.summary?.url_not_checked_count !== targets.filter((target) => target.url_reachability === 'not_checked').length) errors.push('url_not_checked_count must reflect target URL status');
  if (readiness.summary?.expected_clip_count_for_included_targets !== targets.reduce((count, target) => count + Number(target.expected_clip_count || 0), 0)) errors.push('expected clip count must sum included targets');
  for (const target of targets) {
    if (target.approval_decision === 'reject') errors.push(`${target.target_id} rejected target must not be included`);
    if (!READINESS_STATES.includes(target.readiness_state)) errors.push(`${target.target_id} readiness_state is invalid`);
    if (!URL_REACHABILITY_STATES.includes(target.url_reachability)) errors.push(`${target.target_id} URL reachability is invalid`);
    const hasLocatorValue = locatorReady(target.locator_placeholders);
    if (target.readiness_state === 'locator_ready' && !hasHumanApprovedLocator(target)) {
      errors.push(`${target.target_id} locator_ready requires explicit human-approved selector, XPath, or Playwright locator provenance`);
    }
    if (hasLocatorValue && !hasHumanApprovedLocator(target)) {
      errors.push(`${target.target_id} locator values require explicit human locator approval provenance`);
    }
    if (target.readiness_state !== 'locator_ready' && hasLocatorValue) {
      errors.push(`${target.target_id} non-ready target must not carry locator values`);
    }
    for (const [field, value] of Object.entries({ ...NULL_LOCATORS, ...objectValue(target.locator_placeholders) })) {
      if (field in NULL_LOCATORS && value !== null && !text(value)) errors.push(`${target.target_id} locator ${field} must be null or non-empty`);
    }
  }
  for (const [key, value] of Object.entries(objectValue(readiness.controls))) {
    if (value !== false) errors.push(`controls.${key} must remain false`);
  }
  return {
    valid: errors.length === 0,
    errors,
  };
}

export function loadEmployerBrandLiveEvidenceLocatorReadiness({
  fixtureRoot,
} = {}) {
  if (!fixtureRoot) throw new Error('fixtureRoot is required');
  return JSON.parse(fs.readFileSync(path.join(fixtureRoot, 'live-evidence-locator-readiness.json'), 'utf8'));
}
