import fs from 'node:fs';
import path from 'node:path';
import {
  normalizeEmployerBrandLiveEvidenceLocatorReadiness,
  validateEmployerBrandLiveEvidenceLocatorReadiness,
} from './employer-brand-live-evidence-locator-readiness.js';
import {
  normalizeEmployerBrandLiveEvidenceTargetPlan,
} from './employer-brand-live-evidence-target-plan.js';

export const EMPLOYER_BRAND_LIVE_EVIDENCE_REVIEWED_LOCATOR_CAPTURE_PLAN_TYPE =
  'aos.employer_brand_live_evidence_reviewed_locator_capture_plan';
export const EMPLOYER_BRAND_LIVE_EVIDENCE_REVIEWED_LOCATOR_CAPTURE_PLAN_SCHEMA_VERSION =
  '2026-05-employer-brand-live-evidence-reviewed-locator-capture-plan-v0';

const READY_LOCATOR_DECISIONS = [
  'approve_selector',
  'edit_selector',
  'provide_xpath',
  'provide_playwright_locator',
];

const SAFETY_GATES = [
  'human_supervision_required',
  'use_reviewed_locator_only',
  'same_final_url_or_same_domain_required',
  'no_url_opening_in_plan_builder',
  'no_locator_resolution_in_plan_builder',
  'no_codegen_execution',
  'no_screenshots',
  'no_element_clips',
  'no_text_extraction',
  'no_full_page_grabs',
  'no_autonomous_crawl',
  'stop_on_login_paywall_captcha_or_consent_blockers',
  'stop_on_unexpected_redirects',
  'stop_when_reviewed_locator_does_not_match_without_guessing',
];

const STOP_CONDITIONS = [
  'login_required',
  'paywall_encountered',
  'captcha_encountered',
  'consent_blocker_prevents_element_capture',
  'unexpected_redirect',
  'same_domain_not_confirmed',
  'reviewed_locator_matches_zero_elements',
  'reviewed_locator_matches_ambiguous_elements_without_human_confirmation',
  'target_element_requires_guessing',
  'human_operator_withholds_approval',
];

const NON_GOALS = [
  'url_opening',
  'locator_resolution',
  'codegen_execution',
  'screenshots',
  'element_clips',
  'text_extraction',
  'capture_execution',
  'report_renderer',
  'export_execution',
  'workflow_engine',
  'full_page_grabs',
  'autonomous_crawl',
  'login_bypass',
  'paywall_bypass',
  'captcha_bypass',
  'consent_bypass',
];

const NULL_LOCATOR = {
  selector: null,
  xpath: null,
  playwright_locator: null,
};

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

function groupCounts(items, keyFn) {
  return items.reduce((groups, item) => {
    const key = keyFn(item);
    groups[key] = (groups[key] || 0) + 1;
    return groups;
  }, {});
}

function slugPart(value) {
  return String(value ?? '')
    .replace(/^live-target:/, '')
    .replace(/[^a-z0-9]+/gi, '-')
    .replace(/^-+|-+$/g, '');
}

function workUnitId(targetId) {
  return `live-reviewed-capture-work-unit:${slugPart(targetId)}`;
}

function flattenReviewItems(reviewPack) {
  return arrayValue(reviewPack?.groups).flatMap((group) => (
    arrayValue(group.source_categories).flatMap((category) => arrayValue(category.review_items))
  ));
}

function targetMaps({ reviewedTargetPlan, targetPlan, humanLocatorReviewPack }) {
  const reviewedPlan = reviewedTargetPlan ? normalizeEmployerBrandLiveEvidenceTargetPlan(reviewedTargetPlan) : null;
  const originalPlan = targetPlan ? normalizeEmployerBrandLiveEvidenceTargetPlan(targetPlan) : null;
  return {
    reviewedTargetsById: new Map(arrayValue(reviewedPlan?.targets).map((target) => [target.target_id, target])),
    originalTargetsById: new Map(arrayValue(originalPlan?.targets).map((target) => [target.target_id, target])),
    reviewItemsById: new Map(flattenReviewItems(humanLocatorReviewPack).map((item) => [item.target_id, item])),
  };
}

function urlResultsByTarget(urlOpenRun) {
  return new Map([
    ...arrayValue(urlOpenRun?.results),
    ...arrayValue(urlOpenRun?.blocked_entries),
  ].map((result) => [result.target_id, result]));
}

function locatorDecisionMap(humanLocatorApprovalPatch) {
  return new Map(arrayValue(humanLocatorApprovalPatch?.decisions).map((decision) => [
    requireText(decision.target_id, 'human locator decision target_id'),
    decision,
  ]));
}

function reviewedLocator(target, decision) {
  return {
    selector: optionalText(target.locator_placeholders?.selector ?? decision?.locator?.selector),
    xpath: optionalText(target.locator_placeholders?.xpath ?? decision?.locator?.xpath),
    playwright_locator: optionalText(target.locator_placeholders?.playwright_locator ?? decision?.locator?.playwright_locator),
  };
}

function sourceMetadata({ target, reviewedTarget, reviewItem, dataBundle }) {
  const citation = arrayValue(dataBundle?.citations?.rows).find((row) => (
    row.company === target.company && row.source_category === target.source_category
  )) || null;
  return {
    data_bundle_id: optionalText(dataBundle?.id),
    source_category: target.source_category,
    page_name: optionalText(reviewedTarget?.page_name ?? reviewItem?.page_name),
    evidence_goal: optionalText(reviewedTarget?.evidence_goal ?? reviewItem?.evidence_goal),
    desired_element: optionalText(reviewedTarget?.target_element ?? reviewItem?.desired_element ?? target.desired_element_summary),
    citation: citation ? {
      request_id: optionalText(citation.request_id),
      registry_status: optionalText(citation.registry_status),
      source_url: optionalText(citation.source_url),
      screenshot_path: optionalText(citation.screenshot_path),
      captured_at: optionalText(citation.captured_at),
      provenance_only: true,
    } : {
      request_id: null,
      registry_status: 'not_available_for_live_target',
      source_url: target.url,
      screenshot_path: null,
      captured_at: null,
      provenance_only: true,
    },
  };
}

function outputSlotsForUnit(unitId, target) {
  return Array.from({ length: Number(target.expected_clip_count || 0) }, (_, index) => {
    const ordinal = index + 1;
    const slotId = `${unitId}:slot:${ordinal}`;
    return {
      slot_id: slotId,
      target_id: target.target_id,
      work_unit_id: unitId,
      ordinal,
      planned_clip_id: `${slotId}:element-clip`,
      planned_text_extract_id: `${slotId}:text-extract`,
      clip_path: null,
      text_extract_path: null,
      acceptance_status: 'not_run',
    };
  });
}

function buildExecutableUnit({
  target,
  reviewedTarget,
  reviewItem,
  urlResult,
  locatorDecision,
  index,
  dataBundle,
  reviewedLocatorReadinessPath,
}) {
  const unitId = workUnitId(target.target_id);
  const slots = outputSlotsForUnit(unitId, target);
  return {
    target_id: target.target_id,
    work_unit_id: unitId,
    execution_order: index + 1,
    executable: true,
    company: target.company,
    company_role: requireText(reviewedTarget?.company_role ?? reviewItem?.company_role, `${target.target_id}.company_role`),
    source_category: target.source_category,
    original_url: requireText(urlResult?.original_url ?? target.url, `${target.target_id}.original_url`),
    final_url: requireText(urlResult?.final_url ?? reviewItem?.final_url ?? target.url, `${target.target_id}.final_url`),
    reviewed_locator: reviewedLocator(target, locatorDecision),
    locator_review: {
      decision: requireText(locatorDecision?.decision ?? target.provenance?.human_locator_decision, `${target.target_id}.locator decision`),
      review_item_id: requireText(target.provenance?.human_locator_review_item_id ?? locatorDecision?.review_item_id, `${target.target_id}.review_item_id`),
      human_notes: optionalText(locatorDecision?.human_notes),
      provenance: {
        source_human_locator_approval_patch_path: 'live-evidence-human-locator-approval-patch.json',
        source_human_locator_approval_patch_id: optionalText(target.provenance?.source_human_locator_approval_patch_id),
        source_human_locator_review_pack_path: 'live-evidence-human-locator-review-pack.json',
        source_human_locator_work_unit_id: optionalText(target.provenance?.human_locator_work_unit_id ?? locatorDecision?.work_unit_id),
        read_only: true,
      },
    },
    capture_type: target.capture_type,
    expected_clip_count: Number(target.expected_clip_count || 0),
    kilos_relevance: cloneJson(arrayValue(target.kilos_relevance)),
    citation_source_metadata: sourceMetadata({ target, reviewedTarget, reviewItem, dataBundle }),
    acceptance_criteria: cloneJson(arrayValue(reviewedTarget?.acceptance_criteria ?? reviewItem?.acceptance_criteria)),
    output_manifest_slot_ids: slots.map((slot) => slot.slot_id),
    planned_outputs: slots,
    safety_gates: cloneJson(SAFETY_GATES),
    stop_conditions: cloneJson(STOP_CONDITIONS),
    provenance: {
      source_reviewed_locator_readiness_path: reviewedLocatorReadinessPath,
      source_reviewed_locator_readiness_target_id: target.target_id,
      source_reviewed_target_plan_path: target.provenance?.source_reviewed_target_plan_path || 'live-evidence-target-plan.reviewed.json',
      source_url_open_run_path: 'live-evidence-url-open-run.json',
      source_url_open_result_id: optionalText(urlResult?.result_id),
      source_human_locator_approval_patch_path: 'live-evidence-human-locator-approval-patch.json',
      source_human_locator_review_pack_path: 'live-evidence-human-locator-review-pack.json',
      source_data_bundle_path: 'data-bundle.json',
      source_index: index,
      planning_metadata_only: true,
      read_only: true,
    },
  };
}

function nonExecutableCategory(target, decision = null) {
  if (decision?.decision === 'reject_target') return 'rejected';
  if (target?.readiness_state === 'not_checked' && arrayValue(target.blockers).includes('human_locator_blocked')) return 'blocked';
  if (target?.readiness_state === 'needs_human_target_review') return 'needs_human_locator_review';
  return target?.readiness_state || 'unknown';
}

function buildNonExecutableContext({ target, decision, reviewedTarget, originalTarget, reviewItem, urlResult, index }) {
  const source = target || originalTarget || reviewItem || {};
  const category = nonExecutableCategory(target, decision);
  return {
    context_id: `live-reviewed-capture-context:${slugPart(source.target_id || decision?.target_id)}`,
    target_id: requireText(source.target_id ?? decision?.target_id, 'non executable target_id'),
    work_unit_id: source.provenance?.human_locator_work_unit_id || decision?.work_unit_id || reviewItem?.work_unit_id || `live-locator-work-unit:${slugPart(source.target_id ?? decision?.target_id)}`,
    executable: false,
    category,
    readiness_state: target?.readiness_state || (category === 'rejected' ? 'rejected_excluded' : 'not_checked'),
    approval_decision: target?.approval_decision || (category === 'rejected' ? 'reject' : null),
    human_locator_decision: decision?.decision || target?.provenance?.human_locator_decision || null,
    company: requireText(source.company ?? originalTarget?.company, `${source.target_id}.company`),
    company_role: optionalText(reviewedTarget?.company_role ?? originalTarget?.company_role ?? reviewItem?.company_role),
    source_category: requireText(source.source_category ?? originalTarget?.source_category, `${source.target_id}.source_category`),
    original_url: optionalText(urlResult?.original_url ?? source.url ?? originalTarget?.url),
    final_url: optionalText(urlResult?.final_url ?? reviewItem?.final_url),
    capture_type: optionalText(source.capture_type ?? originalTarget?.capture_type),
    expected_clip_count: Number(source.expected_clip_count ?? originalTarget?.expected_clip_count ?? 0),
    blockers: cloneJson(arrayValue(target?.blockers).length ? target.blockers : [category]),
    required_next_action: text(target?.required_next_action ?? decision?.human_notes, 'Keep as non-executable context until a human reviewer resolves this target.'),
    output_manifest_slot_ids: [],
    provenance: {
      source_reviewed_locator_readiness_path: target ? 'live-evidence-locator-readiness.reviewed.json' : null,
      source_human_locator_approval_patch_path: decision ? 'live-evidence-human-locator-approval-patch.json' : null,
      source_human_locator_review_pack_path: reviewItem ? 'live-evidence-human-locator-review-pack.json' : null,
      planning_metadata_only: true,
      read_only: true,
      source_index: index,
    },
  };
}

export function normalizeEmployerBrandLiveEvidenceReviewedLocatorCapturePlan(planInput = {}) {
  const plan = objectValue(planInput);
  const executableUnits = arrayValue(plan.executable_units).map((unitInput) => {
    const unit = objectValue(unitInput);
    return {
      target_id: requireText(unit.target_id, 'target_id'),
      work_unit_id: requireText(unit.work_unit_id, 'work_unit_id'),
      execution_order: Number(unit.execution_order ?? 0),
      executable: unit.executable === true,
      company: requireText(unit.company, 'company'),
      company_role: requireText(unit.company_role, 'company_role'),
      source_category: requireText(unit.source_category, 'source_category'),
      original_url: requireText(unit.original_url, 'original_url'),
      final_url: requireText(unit.final_url, 'final_url'),
      reviewed_locator: {
        ...cloneJson(NULL_LOCATOR),
        ...cloneJson(objectValue(unit.reviewed_locator)),
      },
      locator_review: cloneJson(objectValue(unit.locator_review)),
      capture_type: requireText(unit.capture_type, 'capture_type'),
      expected_clip_count: Number(unit.expected_clip_count ?? 0),
      kilos_relevance: cloneJson(arrayValue(unit.kilos_relevance)),
      citation_source_metadata: cloneJson(objectValue(unit.citation_source_metadata)),
      acceptance_criteria: cloneJson(arrayValue(unit.acceptance_criteria)),
      output_manifest_slot_ids: cloneJson(arrayValue(unit.output_manifest_slot_ids)),
      planned_outputs: cloneJson(arrayValue(unit.planned_outputs)),
      safety_gates: cloneJson(arrayValue(unit.safety_gates)),
      stop_conditions: cloneJson(arrayValue(unit.stop_conditions)),
      provenance: cloneJson(objectValue(unit.provenance)),
    };
  });
  const nonExecutableContext = arrayValue(plan.non_executable_context).map((entryInput) => {
    const entry = objectValue(entryInput);
    return {
      context_id: requireText(entry.context_id, 'context_id'),
      target_id: requireText(entry.target_id, 'target_id'),
      work_unit_id: requireText(entry.work_unit_id, 'work_unit_id'),
      executable: false,
      category: requireText(entry.category, 'category'),
      readiness_state: requireText(entry.readiness_state, 'readiness_state'),
      approval_decision: entry.approval_decision ?? null,
      human_locator_decision: entry.human_locator_decision ?? null,
      company: requireText(entry.company, 'company'),
      company_role: entry.company_role ?? null,
      source_category: requireText(entry.source_category, 'source_category'),
      original_url: entry.original_url ?? null,
      final_url: entry.final_url ?? null,
      capture_type: entry.capture_type ?? null,
      expected_clip_count: Number(entry.expected_clip_count ?? 0),
      blockers: cloneJson(arrayValue(entry.blockers)),
      required_next_action: requireText(entry.required_next_action, 'required_next_action'),
      output_manifest_slot_ids: cloneJson(arrayValue(entry.output_manifest_slot_ids)),
      provenance: cloneJson(objectValue(entry.provenance)),
    };
  });
  const plannedOutputSlots = executableUnits.flatMap((unit) => unit.planned_outputs);
  return {
    ...cloneJson(plan),
    executable_units: executableUnits,
    non_executable_context: nonExecutableContext,
    planned_output_manifest: {
      status: 'planned_only_empty',
      expected_clip_count: Number(plan.planned_output_manifest?.expected_clip_count ?? plannedOutputSlots.length),
      expected_text_extract_count: Number(plan.planned_output_manifest?.expected_text_extract_count ?? plannedOutputSlots.length),
      slots: cloneJson(arrayValue(plan.planned_output_manifest?.slots).length ? plan.planned_output_manifest.slots : plannedOutputSlots),
      contains_actual_captures: false,
    },
  };
}

export function buildEmployerBrandLiveEvidenceReviewedLocatorCapturePlan({
  reviewedLocatorReadiness,
  humanLocatorApprovalPatch,
  humanLocatorReviewPack,
  urlOpenRun,
  reviewedTargetPlan,
  targetPlan = null,
  dataBundle = null,
  createdAt = null,
  reviewedLocatorReadinessPath = 'live-evidence-locator-readiness.reviewed.json',
} = {}) {
  const readinessValidation = validateEmployerBrandLiveEvidenceLocatorReadiness(reviewedLocatorReadiness);
  if (!readinessValidation.valid) throw new Error(`Reviewed locator readiness validation failed: ${readinessValidation.errors.join('; ')}`);
  const readiness = normalizeEmployerBrandLiveEvidenceLocatorReadiness(reviewedLocatorReadiness);
  const decisionsByTargetId = locatorDecisionMap(humanLocatorApprovalPatch);
  const urlResults = urlResultsByTarget(urlOpenRun);
  const { reviewedTargetsById, originalTargetsById, reviewItemsById } = targetMaps({
    reviewedTargetPlan,
    targetPlan,
    humanLocatorReviewPack,
  });

  const readyTargets = readiness.targets.filter((target) => (
    target.readiness_state === 'locator_ready'
      && target.approval_decision === 'approve'
      && READY_LOCATOR_DECISIONS.includes(target.provenance?.human_locator_decision)
  ));
  const executableUnits = readyTargets.map((target, index) => buildExecutableUnit({
    target,
    reviewedTarget: reviewedTargetsById.get(target.target_id),
    reviewItem: reviewItemsById.get(target.target_id),
    urlResult: urlResults.get(target.target_id),
    locatorDecision: decisionsByTargetId.get(target.target_id),
    index,
    dataBundle,
    reviewedLocatorReadinessPath,
  }));
  const executableTargetIds = new Set(executableUnits.map((unit) => unit.target_id));

  const nonExecutableFromReadiness = readiness.targets
    .filter((target) => !executableTargetIds.has(target.target_id))
    .map((target, index) => buildNonExecutableContext({
      target,
      decision: decisionsByTargetId.get(target.target_id),
      reviewedTarget: reviewedTargetsById.get(target.target_id),
      originalTarget: originalTargetsById.get(target.target_id),
      reviewItem: reviewItemsById.get(target.target_id),
      urlResult: urlResults.get(target.target_id),
      index,
    }));
  const rejectedContext = arrayValue(humanLocatorApprovalPatch?.decisions)
    .filter((decision) => decision.decision === 'reject_target')
    .filter((decision) => !readiness.targets.some((target) => target.target_id === decision.target_id))
    .map((decision, index) => buildNonExecutableContext({
      target: null,
      decision,
      reviewedTarget: reviewedTargetsById.get(decision.target_id),
      originalTarget: originalTargetsById.get(decision.target_id),
      reviewItem: reviewItemsById.get(decision.target_id),
      urlResult: urlResults.get(decision.target_id),
      index: nonExecutableFromReadiness.length + index,
    }));
  const nonExecutableContext = [...nonExecutableFromReadiness, ...rejectedContext];
  const plannedOutputSlots = executableUnits.flatMap((unit) => unit.planned_outputs);

  return normalizeEmployerBrandLiveEvidenceReviewedLocatorCapturePlan({
    type: EMPLOYER_BRAND_LIVE_EVIDENCE_REVIEWED_LOCATOR_CAPTURE_PLAN_TYPE,
    schema_version: EMPLOYER_BRAND_LIVE_EVIDENCE_REVIEWED_LOCATOR_CAPTURE_PLAN_SCHEMA_VERSION,
    id: readiness.id.replace('live-evidence-locator-readiness-reviewed:', 'live-evidence-reviewed-locator-capture-plan:'),
    label: `${readiness.label.replace(/ Live Evidence Locator Readiness$/, '')} Reviewed Locator Capture Plan`,
    status: 'pre_capture_plan_ready_with_non_executable_context',
    source_refs: {
      reviewed_locator_readiness_id: readiness.id,
      reviewed_locator_readiness_path: reviewedLocatorReadinessPath,
      reviewed_locator_readiness_schema: 'shared/schemas/employer-brand-live-evidence-locator-readiness-v0.schema.json',
      human_locator_approval_patch_id: humanLocatorApprovalPatch?.id || readiness.source_refs.human_locator_approval_patch_id,
      human_locator_approval_patch_path: 'live-evidence-human-locator-approval-patch.json',
      human_locator_approval_patch_schema: 'shared/schemas/employer-brand-live-evidence-human-locator-approval-patch-v0.schema.json',
      human_locator_review_pack_id: humanLocatorReviewPack?.id || readiness.source_refs.human_locator_review_pack_id,
      human_locator_review_pack_path: 'live-evidence-human-locator-review-pack.json',
      url_open_run_id: urlOpenRun?.id || null,
      url_open_run_path: 'live-evidence-url-open-run.json',
      reviewed_target_plan_id: reviewedTargetPlan?.id || readiness.source_refs.reviewed_target_plan_id,
      reviewed_target_plan_path: 'live-evidence-target-plan.reviewed.json',
      data_bundle_id: dataBundle?.id || readiness.source_refs.data_bundle_id || null,
      data_bundle_path: 'data-bundle.json',
    },
    summary: {
      reviewed_readiness_target_count: readiness.targets.length,
      executable_unit_count: executableUnits.length,
      expected_ready_clip_count: readiness.summary.expected_ready_clip_count,
      planned_output_slot_count: plannedOutputSlots.length,
      non_executable_context_count: nonExecutableContext.length,
      needs_locator_count: readiness.summary.needs_locator_count,
      needs_human_locator_review_count: readiness.summary.needs_human_locator_review_count,
      blocked_count: readiness.summary.blocked_count,
      rejected_count: readiness.summary.rejected_count,
      grouped_by_company: groupCounts(executableUnits, (unit) => unit.company),
      grouped_non_executable_by_category: groupCounts(nonExecutableContext, (entry) => entry.category),
    },
    capture_ordering: {
      strategy: 'company_then_source_category_fixture_order',
      order_is_deterministic: true,
      executable_work_unit_ids: executableUnits.map((unit) => unit.work_unit_id),
      stop_after_each_unit_for_human_review: true,
    },
    retry_policy: {
      automatic_retries_authorized: false,
      max_manual_retry_attempts_per_unit: 1,
      retry_requires_human_reapproval: true,
      retryable_conditions: [
        'transient_network_error_before_capture',
        'human_confirms_reviewed_locator_still_matches_target',
      ],
      stop_conditions: cloneJson(STOP_CONDITIONS),
    },
    executable_units: executableUnits,
    non_executable_context: nonExecutableContext,
    planned_output_manifest: {
      status: 'planned_only_empty',
      expected_clip_count: plannedOutputSlots.length,
      expected_text_extract_count: plannedOutputSlots.length,
      slots: plannedOutputSlots,
      contains_actual_captures: false,
    },
    controls: {
      pre_capture_plan_only: true,
      human_approved_locators_required: true,
      url_opening_authorized: false,
      locator_resolution_authorized: false,
      codegen_execution_authorized: false,
      screenshot_capture_authorized: false,
      element_clip_generation_authorized: false,
      text_extraction_authorized: false,
      capture_execution_authorized: false,
      full_page_grabs_authorized: false,
      autonomous_crawl_authorized: false,
      report_renderer_authorized: false,
      export_execution_authorized: false,
      workflow_engine_authorized: false,
    },
    provenance: {
      created_at: createdAt,
      reviewed_locator_readiness_is_input_source: true,
      executable_only_for_locator_ready_targets: true,
      unresolved_targets_preserved_as_non_executable_context: true,
      rejected_targets_preserved_as_non_executable_context: true,
      planned_outputs_only: true,
      no_capture_assets_produced: true,
      planning_metadata_only: true,
      read_only: true,
      non_goals: cloneJson(NON_GOALS),
    },
  });
}

export function validateEmployerBrandLiveEvidenceReviewedLocatorCapturePlan(planInput = {}) {
  const errors = [];
  const plan = objectValue(planInput);
  const executableUnits = arrayValue(plan.executable_units);
  const nonExecutableContext = arrayValue(plan.non_executable_context);
  const slots = arrayValue(plan.planned_output_manifest?.slots);
  if (plan.type !== EMPLOYER_BRAND_LIVE_EVIDENCE_REVIEWED_LOCATOR_CAPTURE_PLAN_TYPE) errors.push('type must identify an Employer Brand Reviewed Locator Capture Plan');
  if (plan.schema_version !== EMPLOYER_BRAND_LIVE_EVIDENCE_REVIEWED_LOCATOR_CAPTURE_PLAN_SCHEMA_VERSION) errors.push('schema_version must be v0');
  if (plan.summary?.executable_unit_count !== executableUnits.length) errors.push('executable unit count must match executable units');
  if (plan.summary?.planned_output_slot_count !== slots.length) errors.push('planned output slot count must match planned output slots');
  if (plan.summary?.expected_ready_clip_count !== executableUnits.reduce((count, unit) => count + Number(unit.expected_clip_count || 0), 0)) errors.push('expected ready clip count must match executable expected clips');
  if (plan.summary?.expected_ready_clip_count !== slots.length) errors.push('expected ready clip count must match planned slot count');
  if (plan.summary?.non_executable_context_count !== nonExecutableContext.length) errors.push('non executable context count must match context entries');
  if (plan.planned_output_manifest?.contains_actual_captures !== false) errors.push('planned output manifest must not contain actual captures');
  if (plan.controls?.pre_capture_plan_only !== true) errors.push('controls.pre_capture_plan_only must be true');
  for (const [key, value] of Object.entries(objectValue(plan.controls))) {
    if (!['pre_capture_plan_only', 'human_approved_locators_required'].includes(key) && value !== false) errors.push(`controls.${key} must remain false`);
  }
  const slotIds = new Set(slots.map((slot) => slot.slot_id));
  if (slotIds.size !== slots.length) errors.push('planned output slot IDs must be unique');
  for (const unit of executableUnits) {
    if (unit.executable !== true) errors.push(`${unit.target_id} executable unit must be executable`);
    if (!unit.reviewed_locator?.selector && !unit.reviewed_locator?.xpath && !unit.reviewed_locator?.playwright_locator) errors.push(`${unit.target_id} must carry a reviewed selector, XPath, or Playwright locator`);
    if (!READY_LOCATOR_DECISIONS.includes(unit.locator_review?.decision)) errors.push(`${unit.target_id} must carry reviewed locator provenance`);
    for (const gate of SAFETY_GATES) {
      if (!arrayValue(unit.safety_gates).includes(gate)) errors.push(`${unit.target_id} missing safety gate: ${gate}`);
    }
    if (arrayValue(unit.output_manifest_slot_ids).length !== Number(unit.expected_clip_count || 0)) errors.push(`${unit.target_id} output slot count must match expected clip count`);
    for (const slotId of arrayValue(unit.output_manifest_slot_ids)) {
      if (!slotIds.has(slotId)) errors.push(`${unit.target_id} output slot ${slotId} missing from planned manifest`);
    }
  }
  for (const entry of nonExecutableContext) {
    if (entry.executable !== false) errors.push(`${entry.target_id} non-executable context must not be executable`);
    if (arrayValue(entry.output_manifest_slot_ids).length !== 0) errors.push(`${entry.target_id} non-executable context must not reserve output slots`);
  }
  for (const slot of slots) {
    if (slot.clip_path !== null) errors.push(`${slot.slot_id} clip_path must remain null`);
    if (slot.text_extract_path !== null) errors.push(`${slot.slot_id} text_extract_path must remain null`);
    if (slot.acceptance_status !== 'not_run') errors.push(`${slot.slot_id} acceptance status must remain not_run`);
  }
  return {
    valid: errors.length === 0,
    errors,
  };
}

export function loadEmployerBrandLiveEvidenceReviewedLocatorCapturePlan({
  fixtureRoot,
} = {}) {
  if (!fixtureRoot) throw new Error('fixtureRoot is required');
  return JSON.parse(fs.readFileSync(path.join(fixtureRoot, 'live-evidence-reviewed-locator-capture-plan.json'), 'utf8'));
}
