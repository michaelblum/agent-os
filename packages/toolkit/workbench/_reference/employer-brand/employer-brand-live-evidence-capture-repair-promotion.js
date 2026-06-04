import fs from 'node:fs';
import path from 'node:path';
import {
  normalizeEmployerBrandLiveEvidenceCaptureFailureReviewPack,
  validateEmployerBrandLiveEvidenceCaptureFailureReviewPack,
} from './employer-brand-live-evidence-capture-failure-review-pack.js';
import {
  normalizeEmployerBrandLiveEvidenceCaptureRepairPatch,
  validateEmployerBrandLiveEvidenceCaptureRepairPatch,
} from './employer-brand-live-evidence-capture-repair-patch.js';

export const EMPLOYER_BRAND_LIVE_EVIDENCE_CAPTURE_REPAIR_PROMOTION_TYPE =
  'aos.employer_brand_live_evidence_capture_repair_promotion';
export const EMPLOYER_BRAND_LIVE_EVIDENCE_CAPTURE_REPAIR_PROMOTION_SCHEMA_VERSION =
  '2026-05-employer-brand-live-evidence-capture-repair-promotion-v0';
export const EMPLOYER_BRAND_LIVE_EVIDENCE_REPAIRED_LOCATOR_CAPTURE_PLAN_TYPE =
  'aos.employer_brand_live_evidence_repaired_locator_capture_plan';

const PROMOTION_CONTROLS = {
  open_urls: false,
  run_browser_codegen: false,
  run_locator_resolution: false,
  invent_selectors: false,
  invent_xpath: false,
  invent_playwright_locators: false,
  capture_screenshots: false,
  generate_clips: false,
  extract_text: false,
  bypass_login_or_access_controls: false,
  render_reports: false,
  export_documents: false,
  execute_workflow: false,
  broaden_target_set: false,
  full_page_grab: false,
};

const NON_GOALS = [
  'url_opening',
  'browser_codegen',
  'locator_resolution',
  'selector_invention',
  'xpath_invention',
  'playwright_locator_invention',
  'screenshot_capture',
  'clip_generation',
  'text_extraction',
  'login_bypass',
  'paywall_bypass',
  'captcha_bypass',
  'consent_bypass',
  'report_rendering',
  'html_css_polish',
  'pdf_export',
  'docx_export',
  'workflow_execution',
  'target_broadening',
];

function arrayValue(value) {
  return Array.isArray(value) ? value : [];
}

function objectValue(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function optionalText(value) {
  const normalized = String(value ?? '').replace(/\s+/g, ' ').trim();
  return normalized || null;
}

function loadJson(fixtureRoot, relativePath) {
  return JSON.parse(fs.readFileSync(path.join(fixtureRoot, relativePath), 'utf8'));
}

function locatorFromRepair(repair) {
  return {
    selector: optionalText(repair.proposed_selector),
    xpath: optionalText(repair.proposed_xpath),
    playwright_locator: optionalText(repair.proposed_playwright_locator),
  };
}

function locatorHasValue(locator) {
  return Boolean(locator.selector || locator.xpath || locator.playwright_locator);
}

function outputSlotFromRepair(item) {
  return {
    slot_id: item.slot_id,
    target_id: item.target_id,
    work_unit_id: item.work_unit_id,
    planned_clip_id: `${item.slot_id}:repaired-element-clip`,
    planned_text_extract_id: `${item.slot_id}:repaired-text-extract`,
    clip_path: null,
    text_extract_path: null,
    acceptance_status: 'not_run',
    full_page_grab: false,
  };
}

function buildRepairedSlot(item, failure) {
  const repairedLocator = locatorFromRepair(item.repair);
  return {
    slot_id: item.slot_id,
    failure_id: item.failure_id,
    repair_item_id: item.repair_item_id,
    target_id: item.target_id,
    work_unit_id: item.work_unit_id,
    executable: true,
    status: 'repaired_locator_ready_for_capture_attempt',
    repair_decision: item.repair.repair_decision,
    company: item.company,
    company_role: item.company_role,
    source_category: item.source_category,
    original_url: item.original_url,
    final_url: item.final_url,
    natural_language_target: item.original_natural_language_target,
    evidence_goal: optionalText(item.target_context?.evidence_goal),
    kilos_relevance: cloneJson(arrayValue(item.kilos_relevance)),
    expected_clip_count: Number(item.expected_clip_count || 0),
    original_failed_locator: cloneJson(objectValue(item.reviewed_locator)),
    repaired_locator: repairedLocator,
    operator_repair_notes: item.repair.repair_notes,
    failure_provenance: {
      blocker_reason: item.blocker_reason,
      blocker_class: item.blocker_class,
      recommended_next_action: item.recommended_next_action,
      operator_outcome_notes: cloneJson(objectValue(item.operator_outcome_notes)),
      capture_metadata: cloneJson(objectValue(item.capture_metadata)),
      acceptance_checks: cloneJson(arrayValue(item.acceptance_checks)),
      source_failure_review_pack_path: 'live-evidence-capture-failure-review-pack.json',
      source_failure_id: item.failure_id,
      source_failed_slot_status: failure?.status || item.status,
      read_only: true,
    },
    planned_outputs: [outputSlotFromRepair(item)],
    full_page_grab: false,
    provenance: {
      source_repair_patch_path: 'live-evidence-capture-repair-patch.json',
      operator_reviewed_by: item.repair.reviewed_by,
      operator_reviewed_at: item.repair.reviewed_at,
      preserves_original_slot_identity: true,
      planned_only: true,
      read_only_source_context: true,
    },
  };
}

function buildUnavailableSourceSlot(item) {
  return {
    slot_id: item.slot_id,
    failure_id: item.failure_id,
    repair_item_id: item.repair_item_id,
    target_id: item.target_id,
    work_unit_id: item.work_unit_id,
    executable: false,
    status: 'source_unavailable',
    repair_decision: item.repair.repair_decision,
    company: item.company,
    company_role: item.company_role,
    source_category: item.source_category,
    original_url: item.original_url,
    final_url: item.final_url,
    natural_language_target: item.original_natural_language_target,
    evidence_goal: optionalText(item.target_context?.evidence_goal),
    kilos_relevance: cloneJson(arrayValue(item.kilos_relevance)),
    expected_clip_count: Number(item.expected_clip_count || 0),
    original_failed_locator: cloneJson(objectValue(item.reviewed_locator)),
    repaired_locator: {
      selector: null,
      xpath: null,
      playwright_locator: null,
    },
    source_unavailable_reason: item.repair.source_unavailable_reason,
    human_input_needed: 'LinkedIn alternate approved source URL is required before this source can become executable.',
    planned_outputs: [],
    full_page_grab: false,
    provenance: {
      source_repair_patch_path: 'live-evidence-capture-repair-patch.json',
      source_failure_review_pack_path: 'live-evidence-capture-failure-review-pack.json',
      no_bypass_attempted: true,
      read_only_source_context: true,
    },
  };
}

function buildContextEntry(entry) {
  return {
    ...cloneJson(objectValue(entry)),
    executable: false,
    read_only_context: true,
    actionable_repair_item: false,
    full_page_grab: false,
  };
}

function groupFailures(failureReviewPack) {
  return arrayValue(failureReviewPack.repair_queue?.groups).flatMap((group) => arrayValue(group.failures));
}

function buildSourceRefs({ patch, application, failureReviewPack, reviewedLocatorCapturePlan, reviewedLocatorReadiness, urlOpenRun, reviewedTargetPlan, dataBundle, manifest }) {
  return {
    repair_patch_id: patch.id,
    repair_patch_path: 'live-evidence-capture-repair-patch.json',
    repair_patch_application_id: application?.id || null,
    repair_patch_application_path: 'live-evidence-capture-repair-patch.application.json',
    failure_review_pack_id: failureReviewPack.id,
    failure_review_pack_path: 'live-evidence-capture-failure-review-pack.json',
    manifest_id: manifest?.id || null,
    manifest_path: 'source-artifacts/live-evidence-element-clip-manifest.json',
    reviewed_locator_capture_plan_id: reviewedLocatorCapturePlan?.id || null,
    reviewed_locator_capture_plan_path: 'live-evidence-reviewed-locator-capture-plan.json',
    reviewed_locator_readiness_id: reviewedLocatorReadiness?.id || null,
    reviewed_locator_readiness_path: 'live-evidence-locator-readiness.reviewed.json',
    url_open_run_id: urlOpenRun?.id || null,
    url_open_run_path: 'live-evidence-url-open-run.json',
    reviewed_target_plan_id: reviewedTargetPlan?.id || null,
    reviewed_target_plan_path: 'live-evidence-target-plan.reviewed.json',
    data_bundle_id: dataBundle?.id || null,
    data_bundle_path: 'data-bundle.json',
    read_only: true,
  };
}

export function buildEmployerBrandLiveEvidenceCaptureRepairPromotion(inputs = {}, {
  createdAt = null,
} = {}) {
  const failureValidation = validateEmployerBrandLiveEvidenceCaptureFailureReviewPack(inputs.failureReviewPack);
  if (!failureValidation.valid) throw new Error(`Capture failure review pack validation failed: ${failureValidation.errors.join('; ')}`);
  const patchValidation = validateEmployerBrandLiveEvidenceCaptureRepairPatch(inputs.repairPatch, inputs.failureReviewPack);
  if (!patchValidation.valid) throw new Error(`Capture repair patch validation failed: ${patchValidation.errors.join('; ')}`);

  const failureReviewPack = normalizeEmployerBrandLiveEvidenceCaptureFailureReviewPack(inputs.failureReviewPack);
  const patch = normalizeEmployerBrandLiveEvidenceCaptureRepairPatch(inputs.repairPatch);
  const failuresBySlot = new Map(groupFailures(inputs.failureReviewPack).map((failure) => [failure.slot_id, failure]));
  const repairedSlots = patch.repair_items
    .filter((item) => item.repair.repair_decision === 'approve_repaired_locator')
    .map((item) => buildRepairedSlot(item, failuresBySlot.get(item.slot_id)));
  const unavailableSourceSlots = patch.repair_items
    .filter((item) => item.repair.repair_decision === 'mark_source_unavailable')
    .map(buildUnavailableSourceSlot);
  const nonExecutableContext = failureReviewPack.non_executable_context.map(buildContextEntry);
  const plannedOutputSlots = repairedSlots.flatMap((slot) => slot.planned_outputs);

  const sourceRefs = buildSourceRefs({
    patch,
    application: inputs.repairPatchApplication,
    failureReviewPack,
    reviewedLocatorCapturePlan: inputs.reviewedLocatorCapturePlan,
    reviewedLocatorReadiness: inputs.reviewedLocatorReadiness,
    urlOpenRun: inputs.urlOpenRun,
    reviewedTargetPlan: inputs.reviewedTargetPlan,
    dataBundle: inputs.dataBundle,
    manifest: inputs.manifest,
  });
  const summary = {
    repaired_executable_slot_count: repairedSlots.length,
    unavailable_source_slot_count: unavailableSourceSlots.length,
    previous_failed_executable_slot_count: failureReviewPack.summary.failed_executable_slot_count,
    read_only_context_entry_count: nonExecutableContext.length,
    accepted_capture_count: failureReviewPack.summary.accepted_capture_count,
    promoted_capture_count: 0,
    actual_capture_file_count: 0,
    planned_output_slot_count: plannedOutputSlots.length,
    full_page_grab_count: 0,
  };
  const repairedCapturePlan = normalizeEmployerBrandLiveEvidenceRepairedLocatorCapturePlan({
    type: EMPLOYER_BRAND_LIVE_EVIDENCE_REPAIRED_LOCATOR_CAPTURE_PLAN_TYPE,
    schema_version: EMPLOYER_BRAND_LIVE_EVIDENCE_CAPTURE_REPAIR_PROMOTION_SCHEMA_VERSION,
    id: 'live-evidence-repaired-locator-capture-plan:symphony-talent-phenom-radancy',
    label: 'Symphony Talent Employer Brand Live Evidence Repaired Locator Capture Plan',
    status: 'pre_capture_plan_ready_with_source_unavailable_context',
    source_refs: sourceRefs,
    summary,
    capture_ordering: {
      strategy: 'preserve_repair_patch_slot_order',
      order_is_deterministic: true,
      executable_slot_ids: repairedSlots.map((slot) => slot.slot_id),
      stop_after_each_slot_for_human_review: true,
    },
    repaired_capture_slots: repairedSlots,
    unavailable_source_slots: unavailableSourceSlots,
    non_executable_context: nonExecutableContext,
    planned_output_manifest: {
      status: 'planned_only_empty',
      expected_clip_count: plannedOutputSlots.length,
      expected_text_extract_count: plannedOutputSlots.length,
      slots: plannedOutputSlots,
      contains_actual_captures: false,
    },
    controls: cloneJson(PROMOTION_CONTROLS),
    provenance: {
      created_at: createdAt,
      deterministic_from_filled_repair_patch: true,
      no_urls_opened: true,
      no_locator_resolution_run: true,
      no_capture_assets_produced: true,
      planned_outputs_only: true,
      read_only: true,
      planning_metadata_only: true,
      non_goals: cloneJson(NON_GOALS),
    },
  });

  return {
    type: EMPLOYER_BRAND_LIVE_EVIDENCE_CAPTURE_REPAIR_PROMOTION_TYPE,
    schema_version: EMPLOYER_BRAND_LIVE_EVIDENCE_CAPTURE_REPAIR_PROMOTION_SCHEMA_VERSION,
    id: 'live-evidence-capture-repair-promotion:symphony-talent-phenom-radancy',
    label: 'Symphony Talent Employer Brand Live Evidence Capture Repair Promotion',
    status: 'repair_promoted_to_next_capture_attempt_plan',
    source_refs: sourceRefs,
    summary,
    promotion_results: [
      ...repairedSlots.map((slot) => ({
        slot_id: slot.slot_id,
        failure_id: slot.failure_id,
        repair_item_id: slot.repair_item_id,
        result: 'promoted_to_repaired_capture_slot',
        executable: true,
        repaired_locator: cloneJson(slot.repaired_locator),
        capture_promoted: false,
      })),
      ...unavailableSourceSlots.map((slot) => ({
        slot_id: slot.slot_id,
        failure_id: slot.failure_id,
        repair_item_id: slot.repair_item_id,
        result: 'preserved_as_source_unavailable_context',
        executable: false,
        repaired_locator: cloneJson(slot.repaired_locator),
        capture_promoted: false,
      })),
    ],
    repaired_capture_plan_ref: {
      id: repairedCapturePlan.id,
      path: 'live-evidence-repaired-locator-capture-plan.json',
      schema: 'shared/schemas/employer-brand-live-evidence-repaired-locator-capture-plan-v0.schema.json',
      status: repairedCapturePlan.status,
      read_only: true,
    },
    repaired_capture_plan: repairedCapturePlan,
    controls: cloneJson(PROMOTION_CONTROLS),
    provenance: {
      created_at: createdAt,
      deterministic_from_local_inputs: true,
      promotes_approved_repair_decisions_only: true,
      preserves_unavailable_sources_as_context: true,
      no_urls_opened: true,
      no_browser_codegen_run: true,
      no_locator_resolution_run: true,
      no_selectors_invented: true,
      no_xpath_invented: true,
      no_playwright_locators_invented: true,
      no_screenshots: true,
      no_element_clips: true,
      no_text_extracts: true,
      no_capture_assets_produced: true,
      read_only: true,
      planning_metadata_only: true,
      non_goals: cloneJson(NON_GOALS),
    },
  };
}

export function normalizeEmployerBrandLiveEvidenceCaptureRepairPromotion(promotionInput = {}) {
  const promotion = objectValue(promotionInput);
  return {
    ...cloneJson(promotion),
    promotion_results: arrayValue(promotion.promotion_results).map((result) => cloneJson(objectValue(result))),
    repaired_capture_plan: promotion.repaired_capture_plan
      ? normalizeEmployerBrandLiveEvidenceRepairedLocatorCapturePlan(promotion.repaired_capture_plan)
      : null,
  };
}

export function normalizeEmployerBrandLiveEvidenceRepairedLocatorCapturePlan(planInput = {}) {
  const plan = objectValue(planInput);
  const repairedCaptureSlots = arrayValue(plan.repaired_capture_slots).map((slotInput) => ({
    ...cloneJson(objectValue(slotInput)),
    executable: true,
    repaired_locator: {
      selector: null,
      xpath: null,
      playwright_locator: null,
      ...cloneJson(objectValue(slotInput.repaired_locator)),
    },
    planned_outputs: arrayValue(slotInput.planned_outputs).map((output) => ({
      ...cloneJson(objectValue(output)),
      clip_path: null,
      text_extract_path: null,
      full_page_grab: false,
    })),
    full_page_grab: false,
  }));
  const unavailableSourceSlots = arrayValue(plan.unavailable_source_slots).map((slotInput) => ({
    ...cloneJson(objectValue(slotInput)),
    executable: false,
    repaired_locator: {
      selector: null,
      xpath: null,
      playwright_locator: null,
      ...cloneJson(objectValue(slotInput.repaired_locator)),
    },
    planned_outputs: [],
    full_page_grab: false,
  }));
  const nonExecutableContext = arrayValue(plan.non_executable_context).map(buildContextEntry);
  const plannedSlots = arrayValue(plan.planned_output_manifest?.slots).map((slot) => ({
    ...cloneJson(objectValue(slot)),
    clip_path: null,
    text_extract_path: null,
    full_page_grab: false,
  }));
  return {
    ...cloneJson(plan),
    repaired_capture_slots: repairedCaptureSlots,
    unavailable_source_slots: unavailableSourceSlots,
    non_executable_context: nonExecutableContext,
    planned_output_manifest: {
      ...cloneJson(objectValue(plan.planned_output_manifest)),
      slots: plannedSlots,
      contains_actual_captures: false,
    },
  };
}

function validatePlan(planInput) {
  const errors = [];
  const plan = normalizeEmployerBrandLiveEvidenceRepairedLocatorCapturePlan(planInput);
  if (plan.type !== EMPLOYER_BRAND_LIVE_EVIDENCE_REPAIRED_LOCATOR_CAPTURE_PLAN_TYPE) errors.push('type must identify a repaired locator capture plan');
  if (plan.schema_version !== EMPLOYER_BRAND_LIVE_EVIDENCE_CAPTURE_REPAIR_PROMOTION_SCHEMA_VERSION) errors.push('schema_version must be capture repair promotion v0');
  if (plan.summary?.repaired_executable_slot_count !== 4) errors.push('repaired executable slot count must be 4');
  if (plan.summary?.unavailable_source_slot_count !== 1) errors.push('unavailable source slot count must be 1');
  if (plan.summary?.previous_failed_executable_slot_count !== 5) errors.push('previous failed executable slot count must be 5');
  if (plan.summary?.accepted_capture_count !== 0) errors.push('accepted capture count must remain 0');
  if (plan.summary?.promoted_capture_count !== 0) errors.push('promoted capture count must remain 0');
  if (plan.summary?.actual_capture_file_count !== 0) errors.push('actual capture file count must remain 0');
  if (plan.repaired_capture_slots.length !== 4) errors.push('plan must include exactly 4 repaired executable slots');
  if (plan.unavailable_source_slots.length !== 1) errors.push('plan must include exactly 1 unavailable source slot');
  if (plan.non_executable_context.length !== 14) errors.push('plan must preserve 14 non-executable context entries');
  for (const [key, value] of Object.entries(objectValue(plan.controls))) {
    if (value !== false) errors.push(`controls.${key} must remain false`);
  }
  for (const slot of plan.repaired_capture_slots) {
    if (slot.executable !== true) errors.push(`${slot.slot_id} must be executable`);
    if (!locatorHasValue(slot.repaired_locator)) errors.push(`${slot.slot_id} must carry a repaired locator`);
    if (slot.full_page_grab !== false) errors.push(`${slot.slot_id} full_page_grab must remain false`);
    for (const output of slot.planned_outputs) {
      if (output.clip_path !== null) errors.push(`${output.slot_id} clip_path must remain null`);
      if (output.text_extract_path !== null) errors.push(`${output.slot_id} text_extract_path must remain null`);
      if (output.full_page_grab !== false) errors.push(`${output.slot_id} full_page_grab must remain false`);
    }
  }
  for (const slot of plan.unavailable_source_slots) {
    if (slot.executable !== false) errors.push(`${slot.slot_id} unavailable source slot must be non-executable`);
    if (slot.status !== 'source_unavailable') errors.push(`${slot.slot_id} unavailable source status must be source_unavailable`);
    if (locatorHasValue(slot.repaired_locator)) errors.push(`${slot.slot_id} unavailable source must not carry a repaired locator`);
    if (slot.full_page_grab !== false) errors.push(`${slot.slot_id} full_page_grab must remain false`);
  }
  for (const entry of plan.non_executable_context) {
    if (entry.executable !== false) errors.push(`${entry.target_id} context must be non-executable`);
    if (entry.full_page_grab !== false) errors.push(`${entry.target_id} context full_page_grab must remain false`);
  }
  for (const output of arrayValue(plan.planned_output_manifest?.slots)) {
    if (output.clip_path !== null) errors.push(`${output.slot_id} manifest clip_path must remain null`);
    if (output.text_extract_path !== null) errors.push(`${output.slot_id} manifest text_extract_path must remain null`);
  }
  return errors;
}

export function validateEmployerBrandLiveEvidenceCaptureRepairPromotion(promotionInput = {}) {
  const promotion = normalizeEmployerBrandLiveEvidenceCaptureRepairPromotion(promotionInput);
  const errors = [];
  if (promotion.type !== EMPLOYER_BRAND_LIVE_EVIDENCE_CAPTURE_REPAIR_PROMOTION_TYPE) errors.push('type must identify a capture repair promotion');
  if (promotion.schema_version !== EMPLOYER_BRAND_LIVE_EVIDENCE_CAPTURE_REPAIR_PROMOTION_SCHEMA_VERSION) errors.push('schema_version must be capture repair promotion v0');
  if (promotion.summary?.repaired_executable_slot_count !== 4) errors.push('promotion repaired executable slot count must be 4');
  if (promotion.summary?.unavailable_source_slot_count !== 1) errors.push('promotion unavailable source slot count must be 1');
  if (promotion.summary?.promoted_capture_count !== 0) errors.push('promotion must not promote captures');
  if (arrayValue(promotion.promotion_results).length !== 5) errors.push('promotion must include 5 repair item results');
  errors.push(...validatePlan(promotion.repaired_capture_plan || {}));
  return { valid: errors.length === 0, errors };
}

export function validateEmployerBrandLiveEvidenceRepairedLocatorCapturePlan(planInput = {}) {
  const errors = validatePlan(planInput);
  return { valid: errors.length === 0, errors };
}

export function loadEmployerBrandLiveEvidenceCaptureRepairPromotion({ fixtureRoot } = {}) {
  if (!fixtureRoot) throw new Error('fixtureRoot is required');
  return loadJson(fixtureRoot, 'live-evidence-capture-repair-promotion.json');
}

export function loadEmployerBrandLiveEvidenceRepairedLocatorCapturePlan({ fixtureRoot } = {}) {
  if (!fixtureRoot) throw new Error('fixtureRoot is required');
  return loadJson(fixtureRoot, 'live-evidence-repaired-locator-capture-plan.json');
}

export function loadEmployerBrandLiveEvidenceCaptureRepairPromotionInputs({ fixtureRoot } = {}) {
  if (!fixtureRoot) throw new Error('fixtureRoot is required');
  return {
    repairPatch: loadJson(fixtureRoot, 'live-evidence-capture-repair-patch.json'),
    repairPatchApplication: loadJson(fixtureRoot, 'live-evidence-capture-repair-patch.application.json'),
    failureReviewPack: loadJson(fixtureRoot, 'live-evidence-capture-failure-review-pack.json'),
    manifest: loadJson(fixtureRoot, 'source-artifacts/live-evidence-element-clip-manifest.json'),
    reviewedLocatorCapturePlan: loadJson(fixtureRoot, 'live-evidence-reviewed-locator-capture-plan.json'),
    reviewedLocatorReadiness: loadJson(fixtureRoot, 'live-evidence-locator-readiness.reviewed.json'),
    urlOpenRun: loadJson(fixtureRoot, 'live-evidence-url-open-run.json'),
    reviewedTargetPlan: loadJson(fixtureRoot, 'live-evidence-target-plan.reviewed.json'),
    dataBundle: loadJson(fixtureRoot, 'data-bundle.json'),
  };
}
