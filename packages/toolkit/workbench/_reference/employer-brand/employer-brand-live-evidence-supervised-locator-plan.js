import fs from 'node:fs';
import path from 'node:path';
import {
  normalizeEmployerBrandLiveEvidenceLocatorReadiness,
  validateEmployerBrandLiveEvidenceLocatorReadiness,
} from './employer-brand-live-evidence-locator-readiness.js';
import {
  normalizeEmployerBrandLiveEvidenceTargetPlan,
} from './employer-brand-live-evidence-target-plan.js';

export const EMPLOYER_BRAND_LIVE_EVIDENCE_SUPERVISED_LOCATOR_PLAN_TYPE =
  'aos.employer_brand_live_evidence_supervised_locator_plan';
export const EMPLOYER_BRAND_LIVE_EVIDENCE_SUPERVISED_LOCATOR_PLAN_SCHEMA_VERSION =
  '2026-05-employer-brand-live-evidence-supervised-locator-plan-v0';

const SAFETY_GATES = [
  'human_approval_required',
  'same_domain_constraint',
  'no_autonomous_crawl',
  'no_full_page_screenshots',
  'no_live_capture',
  'stop_on_login_paywall_captcha_or_consent_blockers',
  'stop_on_unexpected_redirects',
  'stop_when_target_element_cannot_be_identified_without_guessing',
];

const STOP_CONDITIONS = [
  'login_required',
  'paywall_encountered',
  'captcha_encountered',
  'consent_blocker_prevents_element_identification',
  'unexpected_redirect',
  'target_element_ambiguous_without_guessing',
  'target_element_not_found_without_guessing',
  'operator_cannot_confirm_same_domain',
];

const NON_GOALS = [
  'url_reachability_checks',
  'autonomous_browsing',
  'autonomous_crawl',
  'locator_codegen_execution',
  'live_capture',
  'screenshots',
  'full_page_grabs',
  'clip_generation',
  'report_renderer',
  'html_css_polish',
  'pdf_docx_export',
  'workflow_engine',
];

const NULL_LOCATOR_PLACEHOLDERS = {
  selector: null,
  xpath: null,
  playwright_locator: null,
  codegen_hint: null,
  crawl_discovery_notes: null,
  capture_script_slot: null,
};

const NULL_ALLOWED_OUTPUTS = {
  selector: null,
  xpath: null,
  playwright_locator: null,
  codegen_trace_path: null,
  locator_notes: null,
  confidence: null,
  reviewer_metadata: null,
  operator_metadata: null,
};

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

function groupCounts(items, keyFn) {
  return items.reduce((groups, item) => {
    const key = keyFn(item);
    groups[key] = (groups[key] || 0) + 1;
    return groups;
  }, {});
}

function workUnitId(targetId) {
  return targetId.replace(/^live-target:/, 'live-locator-work-unit:');
}

function reviewedTargetMap(reviewedTargetPlan) {
  const reviewedPlan = reviewedTargetPlan
    ? normalizeEmployerBrandLiveEvidenceTargetPlan(reviewedTargetPlan)
    : null;
  return new Map(arrayValue(reviewedPlan?.targets).map((target) => [target.target_id, target]));
}

function buildEntry({ target, reviewedTarget, index, locatorReadinessPath }) {
  const executable = target.approval_decision === 'approve' && target.readiness_state === 'needs_locator';
  const blockers = executable
    ? []
    : [
      ...arrayValue(target.blockers),
      ...(target.readiness_state === 'needs_human_target_review' ? ['non_executable_until_human_target_review'] : []),
      ...(target.readiness_state !== 'needs_locator' ? ['readiness_state_not_needs_locator'] : []),
      ...(target.approval_decision !== 'approve' ? ['approval_decision_not_approve'] : []),
    ];

  return {
    work_unit_id: workUnitId(target.target_id),
    target_id: target.target_id,
    executable,
    blocked: !executable,
    blockers,
    company: target.company,
    company_role: requireText(reviewedTarget?.company_role, `${target.target_id}.company_role`),
    source_category: target.source_category,
    page_name: requireText(reviewedTarget?.page_name, `${target.target_id}.page_name`),
    url: target.url,
    desired_element: target.desired_element_summary,
    evidence_goal: requireText(reviewedTarget?.evidence_goal, `${target.target_id}.evidence_goal`),
    kilos_relevance: cloneJson(target.kilos_relevance),
    capture_type: target.capture_type,
    expected_clip_count: target.expected_clip_count,
    acceptance_criteria: cloneJson(arrayValue(reviewedTarget?.acceptance_criteria)),
    current_locator_placeholders: {
      ...cloneJson(NULL_LOCATOR_PLACEHOLDERS),
      ...cloneJson(objectValue(target.locator_placeholders)),
    },
    required_operator_action: executable
      ? 'In a later supervised browser/codegen session, open only the approved URL, identify the requested same-domain element without guessing, and write nullable locator patch fields only after human confirmation.'
      : target.required_next_action,
    allowed_outputs: cloneJson(NULL_ALLOWED_OUTPUTS),
    safety_gates: cloneJson(SAFETY_GATES),
    stop_conditions: cloneJson(STOP_CONDITIONS),
    provenance: {
      source_locator_readiness_path: locatorReadinessPath,
      source_locator_readiness_target_id: target.target_id,
      source_reviewed_target_plan_path: target.provenance?.source_reviewed_target_plan_path || 'live-evidence-target-plan.reviewed.json',
      source_approval_patch_path: target.provenance?.source_approval_patch_path || 'live-evidence-target-approval-patch.json',
      source_data_bundle_path: target.provenance?.source_data_bundle_path || 'data-bundle.json',
      source_index: index,
      planning_metadata_only: true,
      read_only: true,
    },
  };
}

export function normalizeEmployerBrandLiveEvidenceSupervisedLocatorPlan(planInput = {}) {
  const plan = objectValue(planInput);
  const entries = arrayValue(plan.work_units).map((entryInput) => {
    const entry = objectValue(entryInput);
    return {
      work_unit_id: requireText(entry.work_unit_id, 'work_unit_id'),
      target_id: requireText(entry.target_id, 'target_id'),
      executable: entry.executable === true,
      blocked: entry.blocked === true,
      blockers: cloneJson(arrayValue(entry.blockers)),
      company: requireText(entry.company, 'company'),
      company_role: requireText(entry.company_role, 'company_role'),
      source_category: requireText(entry.source_category, 'source_category'),
      page_name: requireText(entry.page_name, 'page_name'),
      url: requireText(entry.url, 'url'),
      desired_element: requireText(entry.desired_element, 'desired_element'),
      evidence_goal: requireText(entry.evidence_goal, 'evidence_goal'),
      kilos_relevance: cloneJson(arrayValue(entry.kilos_relevance)),
      capture_type: requireText(entry.capture_type, 'capture_type'),
      expected_clip_count: Number(entry.expected_clip_count ?? 0),
      acceptance_criteria: cloneJson(arrayValue(entry.acceptance_criteria)),
      current_locator_placeholders: {
        ...cloneJson(NULL_LOCATOR_PLACEHOLDERS),
        ...cloneJson(objectValue(entry.current_locator_placeholders)),
      },
      required_operator_action: requireText(entry.required_operator_action, 'required_operator_action'),
      allowed_outputs: {
        ...cloneJson(NULL_ALLOWED_OUTPUTS),
        ...cloneJson(objectValue(entry.allowed_outputs)),
      },
      safety_gates: cloneJson(arrayValue(entry.safety_gates)),
      stop_conditions: cloneJson(arrayValue(entry.stop_conditions)),
      provenance: {
        source_locator_readiness_path: text(entry.provenance?.source_locator_readiness_path, 'live-evidence-locator-readiness.json'),
        source_locator_readiness_target_id: requireText(entry.provenance?.source_locator_readiness_target_id, 'provenance.source_locator_readiness_target_id'),
        source_reviewed_target_plan_path: text(entry.provenance?.source_reviewed_target_plan_path, 'live-evidence-target-plan.reviewed.json'),
        source_approval_patch_path: text(entry.provenance?.source_approval_patch_path, 'live-evidence-target-approval-patch.json'),
        source_data_bundle_path: text(entry.provenance?.source_data_bundle_path, 'data-bundle.json'),
        source_index: Number(entry.provenance?.source_index ?? 0),
        planning_metadata_only: entry.provenance?.planning_metadata_only !== false,
        read_only: entry.provenance?.read_only !== false,
      },
    };
  });
  const executableEntries = entries.filter((entry) => entry.executable);
  const blockedEntries = entries.filter((entry) => entry.blocked);
  return {
    ...cloneJson(plan),
    work_units: entries,
    summary: {
      readiness_input_count: Number(plan.summary?.readiness_input_count ?? entries.length),
      executable_locator_unit_count: Number(plan.summary?.executable_locator_unit_count ?? executableEntries.length),
      blocked_non_executable_count: Number(plan.summary?.blocked_non_executable_count ?? blockedEntries.length),
      needs_human_target_review_count: Number(plan.summary?.needs_human_target_review_count ?? entries.filter((entry) => entry.blockers.includes('non_executable_until_human_target_review')).length),
      expected_clip_count_for_executable_units: Number(plan.summary?.expected_clip_count_for_executable_units ?? executableEntries.reduce((count, entry) => count + entry.expected_clip_count, 0)),
      locator_ready_count: Number(plan.summary?.locator_ready_count ?? 0),
      url_checks_performed: plan.summary?.url_checks_performed === true,
      grouped_by_company: cloneJson(Object.keys(objectValue(plan.summary?.grouped_by_company)).length ? plan.summary.grouped_by_company : groupCounts(entries, (entry) => entry.company)),
      executable_grouped_by_company: cloneJson(Object.keys(objectValue(plan.summary?.executable_grouped_by_company)).length ? plan.summary.executable_grouped_by_company : groupCounts(executableEntries, (entry) => entry.company)),
    },
  };
}

export function buildEmployerBrandLiveEvidenceSupervisedLocatorPlan({
  locatorReadiness,
  reviewedTargetPlan,
  dataBundle = null,
  createdAt = null,
  locatorReadinessPath = 'live-evidence-locator-readiness.json',
} = {}) {
  const readinessValidation = validateEmployerBrandLiveEvidenceLocatorReadiness(locatorReadiness);
  if (!readinessValidation.valid) throw new Error(`Locator readiness validation failed: ${readinessValidation.errors.join('; ')}`);
  const readiness = normalizeEmployerBrandLiveEvidenceLocatorReadiness(locatorReadiness);
  const reviewedTargetsById = reviewedTargetMap(reviewedTargetPlan);
  const workUnits = readiness.targets.map((target, index) => buildEntry({
    target,
    reviewedTarget: reviewedTargetsById.get(target.target_id),
    index,
    locatorReadinessPath,
  }));
  const executable = workUnits.filter((entry) => entry.executable);
  const blocked = workUnits.filter((entry) => entry.blocked);

  return normalizeEmployerBrandLiveEvidenceSupervisedLocatorPlan({
    type: EMPLOYER_BRAND_LIVE_EVIDENCE_SUPERVISED_LOCATOR_PLAN_TYPE,
    schema_version: EMPLOYER_BRAND_LIVE_EVIDENCE_SUPERVISED_LOCATOR_PLAN_SCHEMA_VERSION,
    id: readiness.id.replace('live-evidence-locator-readiness:', 'live-evidence-supervised-locator-plan:'),
    label: `${readiness.label.replace(/ Live Evidence Locator Readiness$/, '')} Live Evidence Supervised Locator Plan`,
    status: blocked.length ? 'operator_plan_ready_with_blocked_entries' : 'operator_plan_ready',
    source_refs: {
      locator_readiness_id: readiness.id,
      locator_readiness_path: locatorReadinessPath,
      locator_readiness_schema: 'shared/schemas/employer-brand-live-evidence-locator-readiness-v0.schema.json',
      reviewed_target_plan_id: readiness.source_refs.reviewed_target_plan_id,
      reviewed_target_plan_path: readiness.source_refs.reviewed_target_plan_path,
      reviewed_target_plan_schema: readiness.source_refs.reviewed_target_plan_schema,
      approval_patch_id: readiness.source_refs.approval_patch_id,
      approval_patch_path: readiness.source_refs.approval_patch_path,
      data_bundle_id: dataBundle?.id || readiness.source_refs.data_bundle_id || null,
      data_bundle_path: dataBundle ? 'data-bundle.json' : readiness.source_refs.data_bundle_path || null,
    },
    summary: {
      readiness_input_count: readiness.targets.length,
      executable_locator_unit_count: executable.length,
      blocked_non_executable_count: blocked.length,
      needs_human_target_review_count: readiness.summary.needs_human_target_review_count,
      expected_clip_count_for_executable_units: executable.reduce((count, entry) => count + entry.expected_clip_count, 0),
      locator_ready_count: 0,
      url_checks_performed: false,
      grouped_by_company: groupCounts(workUnits, (entry) => entry.company),
      executable_grouped_by_company: groupCounts(executable, (entry) => entry.company),
    },
    work_units: workUnits,
    controls: {
      human_approval_required: true,
      url_checks_performed: false,
      autonomous_crawl_authorized: false,
      autonomous_browsing_authorized: false,
      live_capture_authorized: false,
      locator_codegen_executed: false,
      screenshot_capture_authorized: false,
      full_page_screenshots_authorized: false,
      full_page_grabs_authorized: false,
      clip_generation_authorized: false,
      report_renderer_authorized: false,
      html_css_polish_authorized: false,
      pdf_docx_export_authorized: false,
      workflow_engine_authorized: false,
    },
    provenance: {
      created_at: createdAt,
      readiness_bundle_is_input_source: true,
      executable_only_for_approved_needs_locator: true,
      draft_targets_preserved_as_blocked: true,
      rejected_targets_excluded: true,
      allowed_outputs_unfilled: true,
      arbitrary_n_company_grouping: true,
      planning_metadata_only: true,
      read_only: true,
      non_goals: cloneJson(NON_GOALS),
    },
  });
}

export function validateEmployerBrandLiveEvidenceSupervisedLocatorPlan(planInput = {}) {
  const errors = [];
  const plan = objectValue(planInput);
  const workUnits = arrayValue(plan.work_units);
  if (plan.type !== EMPLOYER_BRAND_LIVE_EVIDENCE_SUPERVISED_LOCATOR_PLAN_TYPE) errors.push('type must identify an Employer Brand Live Evidence Supervised Locator Plan');
  if (plan.schema_version !== EMPLOYER_BRAND_LIVE_EVIDENCE_SUPERVISED_LOCATOR_PLAN_SCHEMA_VERSION) errors.push('schema_version must be v0');
  if (workUnits.length < 1) errors.push('work_units must include at least one readiness input target');
  if (plan.summary?.readiness_input_count !== workUnits.length) errors.push('readiness input count must equal work unit entries');
  if (plan.summary?.executable_locator_unit_count !== workUnits.filter((entry) => entry.executable === true).length) errors.push('executable locator unit count must match executable work units');
  if (plan.summary?.blocked_non_executable_count !== workUnits.filter((entry) => entry.blocked === true).length) errors.push('blocked count must match blocked work units');
  if (plan.summary?.expected_clip_count_for_executable_units !== workUnits.filter((entry) => entry.executable === true).reduce((count, entry) => count + Number(entry.expected_clip_count || 0), 0)) errors.push('expected clip count must sum executable work units');
  if (plan.summary?.locator_ready_count !== 0) errors.push('locator_ready_count must remain 0');
  if (plan.summary?.url_checks_performed !== false) errors.push('url checks performed must remain false');
  for (const gate of SAFETY_GATES) {
    if (!workUnits.every((entry) => arrayValue(entry.safety_gates).includes(gate))) errors.push(`missing safety gate: ${gate}`);
  }
  for (const entry of workUnits) {
    if (entry.executable === true && entry.blocked === true) errors.push(`${entry.target_id} cannot be both executable and blocked`);
    if (entry.executable !== true && entry.blocked !== true) errors.push(`${entry.target_id} non-executable entry must be blocked`);
    for (const [field, value] of Object.entries({ ...NULL_LOCATOR_PLACEHOLDERS, ...objectValue(entry.current_locator_placeholders) })) {
      if (field in NULL_LOCATOR_PLACEHOLDERS && value !== null) errors.push(`${entry.target_id} current locator ${field} must remain null`);
    }
    for (const [field, value] of Object.entries({ ...NULL_ALLOWED_OUTPUTS, ...objectValue(entry.allowed_outputs) })) {
      if (field in NULL_ALLOWED_OUTPUTS && value !== null) errors.push(`${entry.target_id} allowed output ${field} must remain null`);
    }
  }
  for (const [key, value] of Object.entries(objectValue(plan.controls))) {
    if (key === 'human_approval_required') {
      if (value !== true) errors.push('controls.human_approval_required must be true');
    } else if (value !== false) {
      errors.push(`controls.${key} must remain false`);
    }
  }
  return {
    valid: errors.length === 0,
    errors,
  };
}

export function loadEmployerBrandLiveEvidenceSupervisedLocatorPlan({
  fixtureRoot,
} = {}) {
  if (!fixtureRoot) throw new Error('fixtureRoot is required');
  return JSON.parse(fs.readFileSync(path.join(fixtureRoot, 'live-evidence-supervised-locator-plan.json'), 'utf8'));
}
