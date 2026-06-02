import fs from 'node:fs';
import path from 'node:path';
import {
  normalizeEmployerBrandLiveEvidenceCaptureFailureReviewPack,
  validateEmployerBrandLiveEvidenceCaptureFailureReviewPack,
} from './employer-brand-live-evidence-capture-failure-review-pack.js';
import {
  normalizeEmployerBrandLiveEvidenceLocatorReadiness,
  validateEmployerBrandLiveEvidenceLocatorReadiness,
} from './employer-brand-live-evidence-locator-readiness.js';

export const EMPLOYER_BRAND_LIVE_EVIDENCE_CAPTURE_REPAIR_PATCH_TYPE =
  'aos.employer_brand_live_evidence_capture_repair_patch';
export const EMPLOYER_BRAND_LIVE_EVIDENCE_CAPTURE_REPAIR_PATCH_SCHEMA_VERSION =
  '2026-05-employer-brand-live-evidence-capture-repair-patch-v0';

export const EMPLOYER_BRAND_LIVE_EVIDENCE_CAPTURE_REPAIR_PATCH_APPLICATION_TYPE =
  'aos.employer_brand_live_evidence_capture_repair_patch_application';

export const CAPTURE_REPAIR_DECISIONS = [
  'approve_repaired_locator',
  'edit_locator',
  'replace_url',
  'refine_target',
  'mark_source_unavailable',
  'reject_target',
  'keep_failed',
  'keep_pending_review',
];

const REPAIR_FIELDS = {
  repair_decision: null,
  proposed_selector: null,
  proposed_xpath: null,
  proposed_playwright_locator: null,
  refined_natural_language_target: null,
  replacement_url: null,
  replacement_source_category: null,
  source_unavailable_reason: null,
  repair_notes: null,
  reviewed_by: null,
  reviewed_at: null,
};

const CONTROLS = {
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

function text(value, fallback = '') {
  const normalized = String(value ?? '').replace(/\s+/g, ' ').trim();
  return normalized || fallback;
}

function optionalText(value) {
  const normalized = text(value);
  return normalized || null;
}

function loadJson(fixtureRoot, relativePath) {
  return JSON.parse(fs.readFileSync(path.join(fixtureRoot, relativePath), 'utf8'));
}

function groupCounts(items, key) {
  return items.reduce((counts, item) => {
    const value = item[key] ?? null;
    const countKey = value === null ? 'null' : value;
    counts[countKey] = (counts[countKey] || 0) + 1;
    return counts;
  }, {});
}

function failureToRepairItem(failure) {
  return {
    repair_item_id: failure.failure_id.replace('live-evidence-capture-failure:', 'live-evidence-capture-repair:'),
    failure_id: failure.failure_id,
    slot_id: failure.slot_id,
    target_id: failure.target_id,
    work_unit_id: failure.work_unit_id,
    company: failure.company,
    company_role: failure.company_role,
    source_category: failure.source_category,
    original_url: failure.original_url,
    final_url: failure.final_url,
    status: failure.status,
    blocker_reason: failure.blocker_reason,
    blocker_class: failure.blocker_class,
    recommended_next_action: failure.recommended_next_action,
    allowed_repair_decisions: cloneJson(CAPTURE_REPAIR_DECISIONS),
    original_natural_language_target: optionalText(failure.target_context?.natural_language_target),
    kilos_relevance: cloneJson(arrayValue(failure.target_context?.kilos_relevance)),
    expected_clip_count: Number(failure.target_context?.expected_clip_count ?? 0),
    target_context: cloneJson(objectValue(failure.target_context)),
    reviewed_locator: cloneJson(objectValue(failure.reviewed_locator)),
    locator_provenance: failure.locator_provenance ? cloneJson(failure.locator_provenance) : null,
    operator_outcome_notes: cloneJson(objectValue(failure.operator_outcome_notes)),
    citation_source_metadata: failure.citation_source_metadata ? cloneJson(failure.citation_source_metadata) : null,
    capture_metadata: cloneJson(objectValue(failure.capture_metadata)),
    acceptance_checks: cloneJson(arrayValue(failure.acceptance_checks)),
    full_page_grab: failure.full_page_grab === true,
    repair: cloneJson(REPAIR_FIELDS),
    provenance: {
      ...cloneJson(objectValue(failure.provenance)),
      source_failure_id: failure.failure_id,
      source_failure_review_pack_path: 'live-evidence-capture-failure-review-pack.json',
      read_only_source_context: true,
      patchable_repair_fields_only: true,
    },
  };
}

function contextItemFromFailurePack(entry) {
  return {
    ...cloneJson(objectValue(entry)),
    read_only_context: true,
    actionable_repair_item: false,
  };
}

function normalizeRepairItem(input) {
  const item = objectValue(input);
  return {
    ...cloneJson(item),
    allowed_repair_decisions: arrayValue(item.allowed_repair_decisions),
    kilos_relevance: arrayValue(item.kilos_relevance),
    target_context: cloneJson(objectValue(item.target_context)),
    reviewed_locator: cloneJson(objectValue(item.reviewed_locator)),
    operator_outcome_notes: cloneJson(objectValue(item.operator_outcome_notes)),
    capture_metadata: cloneJson(objectValue(item.capture_metadata)),
    acceptance_checks: cloneJson(arrayValue(item.acceptance_checks)),
    full_page_grab: item.full_page_grab === true,
    repair: {
      ...cloneJson(REPAIR_FIELDS),
      ...cloneJson(objectValue(item.repair)),
    },
  };
}

function repairHasLocator(repair) {
  return Boolean(
    text(repair.proposed_selector)
      || text(repair.proposed_xpath)
      || text(repair.proposed_playwright_locator),
  );
}

function filledRepairDecisionCount(items) {
  return items.filter((item) => item.repair.repair_decision !== null).length;
}

function allRepairFieldsNull(items) {
  return items.every((item) => Object.values(item.repair).every((value) => value === null));
}

export function buildEmployerBrandLiveEvidenceCaptureRepairPatch(inputs = {}, {
  createdAt = null,
} = {}) {
  const failureReviewPack = normalizeEmployerBrandLiveEvidenceCaptureFailureReviewPack(inputs.failureReviewPack);
  const repairItems = failureReviewPack.failures.map(failureToRepairItem);
  const readOnlyContext = failureReviewPack.non_executable_context.map(contextItemFromFailurePack);

  return {
    type: EMPLOYER_BRAND_LIVE_EVIDENCE_CAPTURE_REPAIR_PATCH_TYPE,
    schema_version: EMPLOYER_BRAND_LIVE_EVIDENCE_CAPTURE_REPAIR_PATCH_SCHEMA_VERSION,
    id: 'live-evidence-capture-repair-patch:symphony-talent-phenom-radancy',
    label: 'Symphony Talent Employer Brand Live Evidence Capture Repair Patch Template',
    status: 'unfilled_template',
    source_refs: {
      failure_review_pack_id: failureReviewPack.id,
      failure_review_pack_path: 'live-evidence-capture-failure-review-pack.json',
      failure_review_pack_schema: 'shared/schemas/employer-brand-live-evidence-capture-failure-review-pack-v0.schema.json',
      manifest_path: 'source-artifacts/live-evidence-element-clip-manifest.json',
      reviewed_locator_capture_plan_path: 'live-evidence-reviewed-locator-capture-plan.json',
      reviewed_locator_readiness_path: 'live-evidence-locator-readiness.reviewed.json',
      url_open_run_path: 'live-evidence-url-open-run.json',
      reviewed_target_plan_path: 'live-evidence-target-plan.reviewed.json',
      data_bundle_path: 'data-bundle.json',
      read_only: true,
    },
    summary: {
      patchable_repair_item_count: repairItems.length,
      read_only_context_entry_count: readOnlyContext.length,
      filled_repair_decision_count: filledRepairDecisionCount(repairItems),
      proposed_locator_count: repairItems.filter((item) => repairHasLocator(item.repair)).length,
      replacement_url_count: repairItems.filter((item) => item.repair.replacement_url !== null).length,
      source_unavailable_count: repairItems.filter((item) => item.repair.repair_decision === 'mark_source_unavailable').length,
      zero_match_locator_failure_count: repairItems.filter((item) => item.blocker_class === 'zero_match_locator_failure').length,
      login_or_sign_in_blocker_count: repairItems.filter((item) => item.blocker_class === 'login_or_sign_in_blocker').length,
      blocker_reason_counts: groupCounts(repairItems, 'blocker_reason'),
      blocker_class_counts: groupCounts(repairItems, 'blocker_class'),
      recommended_next_action_counts: groupCounts(repairItems, 'recommended_next_action'),
      all_repair_fields_null: allRepairFieldsNull(repairItems),
    },
    allowed_repair_decisions: cloneJson(CAPTURE_REPAIR_DECISIONS),
    repair_items: repairItems,
    read_only_context: readOnlyContext,
    controls: cloneJson(CONTROLS),
    provenance: {
      created_at: createdAt,
      deterministic_from_local_inputs: true,
      template_only: true,
      repair_fields_initialized_null: true,
      source_failure_pack_unmodified: true,
      preserves_non_executable_context_read_only: true,
      no_urls_opened: true,
      no_browser_codegen_run: true,
      no_locator_resolution_run: true,
      no_selectors_invented: true,
      no_xpath_invented: true,
      no_playwright_locators_invented: true,
      no_screenshots: true,
      no_element_clips: true,
      no_text_extracts: true,
      non_goals: cloneJson(NON_GOALS),
    },
  };
}

export function normalizeEmployerBrandLiveEvidenceCaptureRepairPatch(patchInput = {}) {
  const patch = objectValue(patchInput);
  const repairItems = arrayValue(patch.repair_items).map(normalizeRepairItem);
  const readOnlyContext = arrayValue(patch.read_only_context).map((entry) => ({
    ...cloneJson(objectValue(entry)),
    read_only_context: entry.read_only_context !== false,
    actionable_repair_item: false,
  }));
  return {
    ...cloneJson(patch),
    allowed_repair_decisions: arrayValue(patch.allowed_repair_decisions),
    repair_items: repairItems,
    read_only_context: readOnlyContext,
    summary: {
      ...cloneJson(objectValue(patch.summary)),
      patchable_repair_item_count: repairItems.length,
      read_only_context_entry_count: readOnlyContext.length,
      filled_repair_decision_count: filledRepairDecisionCount(repairItems),
      proposed_locator_count: repairItems.filter((item) => repairHasLocator(item.repair)).length,
      replacement_url_count: repairItems.filter((item) => item.repair.replacement_url !== null).length,
      source_unavailable_count: repairItems.filter((item) => item.repair.repair_decision === 'mark_source_unavailable').length,
      zero_match_locator_failure_count: repairItems.filter((item) => item.blocker_class === 'zero_match_locator_failure').length,
      login_or_sign_in_blocker_count: repairItems.filter((item) => item.blocker_class === 'login_or_sign_in_blocker').length,
      blocker_reason_counts: groupCounts(repairItems, 'blocker_reason'),
      blocker_class_counts: groupCounts(repairItems, 'blocker_class'),
      recommended_next_action_counts: groupCounts(repairItems, 'recommended_next_action'),
      all_repair_fields_null: allRepairFieldsNull(repairItems),
    },
  };
}

function validateDecisionRequirements(item, errors) {
  const repair = item.repair;
  if (repair.repair_decision === null) return;
  if (!CAPTURE_REPAIR_DECISIONS.includes(repair.repair_decision)) {
    errors.push(`${item.slot_id} repair_decision is invalid`);
    return;
  }
  if (['approve_repaired_locator', 'edit_locator'].includes(repair.repair_decision) && !repairHasLocator(repair)) {
    errors.push(`${item.slot_id} ${repair.repair_decision} requires a proposed locator`);
  }
  if (repair.repair_decision === 'replace_url' && !text(repair.replacement_url)) {
    errors.push(`${item.slot_id} replace_url requires replacement_url`);
  }
  if (repair.repair_decision === 'refine_target' && !text(repair.refined_natural_language_target)) {
    errors.push(`${item.slot_id} refine_target requires refined_natural_language_target`);
  }
  if (repair.repair_decision === 'mark_source_unavailable' && !text(repair.source_unavailable_reason)) {
    errors.push(`${item.slot_id} mark_source_unavailable requires source_unavailable_reason`);
  }
  if (repair.repair_decision === 'reject_target' && !text(repair.repair_notes)) {
    errors.push(`${item.slot_id} reject_target requires repair_notes`);
  }
}

export function validateEmployerBrandLiveEvidenceCaptureRepairPatch(patchInput = {}, failureReviewPackInput = null) {
  const errors = [];
  const patch = objectValue(patchInput);
  const normalized = normalizeEmployerBrandLiveEvidenceCaptureRepairPatch(patch);
  const failureReviewPack = failureReviewPackInput
    ? normalizeEmployerBrandLiveEvidenceCaptureFailureReviewPack(failureReviewPackInput)
    : null;
  const failureReviewPackValidation = failureReviewPackInput
    ? validateEmployerBrandLiveEvidenceCaptureFailureReviewPack(failureReviewPackInput)
    : { valid: true, errors: [] };
  if (!failureReviewPackValidation.valid) errors.push(`failure review pack invalid: ${failureReviewPackValidation.errors.join('; ')}`);
  if (patch.type !== EMPLOYER_BRAND_LIVE_EVIDENCE_CAPTURE_REPAIR_PATCH_TYPE) errors.push('type must identify a capture repair patch');
  if (patch.schema_version !== EMPLOYER_BRAND_LIVE_EVIDENCE_CAPTURE_REPAIR_PATCH_SCHEMA_VERSION) errors.push('schema_version must be capture repair patch v0');
  if (!text(patch.id)) errors.push('id is required');
  if (patch.status !== 'unfilled_template' && patch.status !== 'repair_reviewed') errors.push('status must be unfilled_template or repair_reviewed');
  if (patch.source_refs?.failure_review_pack_path !== 'live-evidence-capture-failure-review-pack.json') errors.push('source_refs.failure_review_pack_path must reference the failure review pack');
  if (normalized.repair_items.length !== 5) errors.push('repair_items must include exactly 5 patchable repair items');
  if (normalized.read_only_context.length !== 14) errors.push('read_only_context must include exactly 14 entries');
  if (normalized.summary.zero_match_locator_failure_count !== 4) errors.push('zero-match locator failure count must be 4');
  if (normalized.summary.login_or_sign_in_blocker_count !== 1) errors.push('login/sign-in blocker count must be 1');
  if (normalized.allowed_repair_decisions.join('|') !== CAPTURE_REPAIR_DECISIONS.join('|')) errors.push('allowed_repair_decisions must match the V0 decision set');
  for (const [key, value] of Object.entries(objectValue(patch.controls))) {
    if (value !== false) errors.push(`controls.${key} must remain false`);
  }

  const failuresBySlot = new Map(failureReviewPack?.failures.map((failure) => [failure.slot_id, failure]) || []);
  const seenSlots = new Set();
  for (const item of normalized.repair_items) {
    if (seenSlots.has(item.slot_id)) errors.push(`${item.slot_id} appears more than once`);
    seenSlots.add(item.slot_id);
    const source = failuresBySlot.get(item.slot_id);
    if (failureReviewPack && !source) {
      errors.push(`${item.slot_id} is not present in the failure review pack`);
    } else if (source) {
      for (const key of ['failure_id', 'target_id', 'work_unit_id', 'company', 'source_category', 'original_url', 'final_url', 'blocker_reason', 'blocker_class', 'recommended_next_action']) {
        if (item[key] !== source[key]) errors.push(`${item.slot_id} does not preserve ${key}`);
      }
    }
    if (item.full_page_grab !== false) errors.push(`${item.slot_id} full_page_grab must remain false`);
    if (!arrayValue(item.allowed_repair_decisions).every((decision) => CAPTURE_REPAIR_DECISIONS.includes(decision))) {
      errors.push(`${item.slot_id} includes an unsupported allowed decision`);
    }
    validateDecisionRequirements(item, errors);
  }
  for (const entry of normalized.read_only_context) {
    if (entry.actionable_repair_item !== false) errors.push(`${entry.target_id} context must not be actionable`);
    if (entry.read_only_context !== true) errors.push(`${entry.target_id} context must be read-only`);
    if (entry.full_page_grab !== false) errors.push(`${entry.target_id} context full_page_grab must remain false`);
  }
  if (failureReviewPack) {
    const failureSlots = failureReviewPack.failures.map((failure) => failure.slot_id).sort();
    const repairSlots = normalized.repair_items.map((item) => item.slot_id).sort();
    if (failureSlots.join('|') !== repairSlots.join('|')) errors.push('repair_items must exactly match failed executable slots');
  }
  return { valid: errors.length === 0, errors };
}

export function applyEmployerBrandLiveEvidenceCaptureRepairPatch({
  patchInput,
  failureReviewPackInput,
  reviewedLocatorReadinessInput,
  elementClipManifestInput = null,
  appliedAt = null,
} = {}) {
  const failureValidation = validateEmployerBrandLiveEvidenceCaptureFailureReviewPack(failureReviewPackInput);
  if (!failureValidation.valid) throw new Error(`Capture failure review pack validation failed: ${failureValidation.errors.join('; ')}`);
  const patchValidation = validateEmployerBrandLiveEvidenceCaptureRepairPatch(patchInput, failureReviewPackInput);
  if (!patchValidation.valid) throw new Error(`Capture repair patch validation failed: ${patchValidation.errors.join('; ')}`);
  const readinessValidation = validateEmployerBrandLiveEvidenceLocatorReadiness(reviewedLocatorReadinessInput);
  if (!readinessValidation.valid) throw new Error(`Reviewed locator readiness validation failed: ${readinessValidation.errors.join('; ')}`);

  const patch = normalizeEmployerBrandLiveEvidenceCaptureRepairPatch(patchInput);
  const failureReviewPack = normalizeEmployerBrandLiveEvidenceCaptureFailureReviewPack(failureReviewPackInput);
  const reviewedLocatorReadiness = normalizeEmployerBrandLiveEvidenceLocatorReadiness(reviewedLocatorReadinessInput);
  const manifest = elementClipManifestInput ? objectValue(elementClipManifestInput) : null;
  const filledDecisionCount = filledRepairDecisionCount(patch.repair_items);
  const noOp = filledDecisionCount === 0;

  return {
    type: EMPLOYER_BRAND_LIVE_EVIDENCE_CAPTURE_REPAIR_PATCH_APPLICATION_TYPE,
    schema_version: EMPLOYER_BRAND_LIVE_EVIDENCE_CAPTURE_REPAIR_PATCH_SCHEMA_VERSION,
    id: 'live-evidence-capture-repair-patch-application:symphony-talent-phenom-radancy',
    label: 'Symphony Talent Employer Brand Live Evidence Capture Repair Patch Application',
    status: noOp ? 'no_op_unfilled_template' : 'repair_decisions_pending_execution',
    source_refs: {
      repair_patch_id: patch.id,
      repair_patch_path: 'live-evidence-capture-repair-patch.json',
      failure_review_pack_id: failureReviewPack.id,
      failure_review_pack_path: 'live-evidence-capture-failure-review-pack.json',
      reviewed_locator_readiness_id: reviewedLocatorReadiness.id,
      reviewed_locator_readiness_path: 'live-evidence-locator-readiness.reviewed.json',
      element_clip_manifest_id: manifest?.id || null,
      element_clip_manifest_path: manifest ? 'source-artifacts/live-evidence-element-clip-manifest.json' : null,
    },
    summary: {
      patchable_repair_item_count: patch.repair_items.length,
      filled_repair_decision_count: filledDecisionCount,
      unresolved_failed_executable_slot_count: failureReviewPack.summary.failed_executable_slot_count,
      prior_accepted_capture_count: failureReviewPack.summary.accepted_capture_count,
      post_accepted_capture_count: failureReviewPack.summary.accepted_capture_count,
      prior_failed_executable_slot_count: failureReviewPack.summary.failed_executable_slot_count,
      post_failed_executable_slot_count: failureReviewPack.summary.failed_executable_slot_count,
      read_only_context_entry_count: failureReviewPack.summary.non_executable_context_count,
      prior_locator_ready_count: reviewedLocatorReadiness.summary.locator_ready_count,
      post_locator_ready_count: reviewedLocatorReadiness.summary.locator_ready_count,
      new_locator_ready_slot_count: 0,
      promoted_capture_count: 0,
      replacement_url_count: patch.summary.replacement_url_count,
      source_unavailable_count: patch.summary.source_unavailable_count,
      no_op: noOp,
    },
    repair_results: patch.repair_items.map((item) => ({
      repair_item_id: item.repair_item_id,
      failure_id: item.failure_id,
      slot_id: item.slot_id,
      target_id: item.target_id,
      work_unit_id: item.work_unit_id,
      repair_decision: item.repair.repair_decision,
      applied: false,
      result: item.repair.repair_decision === null ? 'unresolved_empty_repair_fields' : 'pending_later_supervised_execution',
      locator_ready_promoted: false,
      capture_promoted: false,
    })),
    controls: cloneJson(CONTROLS),
    provenance: {
      applied_at: appliedAt,
      empty_patch_no_op: noOp,
      deterministic_from_local_inputs: true,
      does_not_modify_failure_review_pack: true,
      does_not_promote_locator_readiness: true,
      does_not_promote_captures: true,
      no_urls_opened: true,
      no_browser_codegen_run: true,
      no_locator_resolution_run: true,
      no_selectors_invented: true,
      no_screenshots: true,
      no_element_clips: true,
    },
  };
}

export function loadEmployerBrandLiveEvidenceCaptureRepairPatch({ fixtureRoot } = {}) {
  if (!fixtureRoot) throw new Error('fixtureRoot is required');
  return loadJson(fixtureRoot, 'live-evidence-capture-repair-patch.json');
}

export function loadEmployerBrandLiveEvidenceCaptureRepairPatchApplication({ fixtureRoot } = {}) {
  if (!fixtureRoot) throw new Error('fixtureRoot is required');
  return loadJson(fixtureRoot, 'live-evidence-capture-repair-patch.application.json');
}

export function loadEmployerBrandLiveEvidenceCaptureRepairPatchInputs({ fixtureRoot } = {}) {
  if (!fixtureRoot) throw new Error('fixtureRoot is required');
  return {
    failureReviewPack: loadJson(fixtureRoot, 'live-evidence-capture-failure-review-pack.json'),
    manifest: loadJson(fixtureRoot, 'source-artifacts/live-evidence-element-clip-manifest.json'),
    reviewedLocatorCapturePlan: loadJson(fixtureRoot, 'live-evidence-reviewed-locator-capture-plan.json'),
    reviewedLocatorReadiness: loadJson(fixtureRoot, 'live-evidence-locator-readiness.reviewed.json'),
    urlOpenRun: loadJson(fixtureRoot, 'live-evidence-url-open-run.json'),
    reviewedTargetPlan: loadJson(fixtureRoot, 'live-evidence-target-plan.reviewed.json'),
    dataBundle: loadJson(fixtureRoot, 'data-bundle.json'),
  };
}
