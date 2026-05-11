import fs from 'node:fs';
import path from 'node:path';
import {
  normalizeEmployerBrandRepairedCaptureVisibilityRepairPatch,
  validateEmployerBrandRepairedCaptureVisibilityRepairPatch,
} from './employer-brand-repaired-capture-visibility-repair-patch.js';
import {
  normalizeEmployerBrandRepairedCaptureVisibilityReviewPack,
  validateEmployerBrandRepairedCaptureVisibilityReviewPack,
} from './employer-brand-repaired-capture-visibility-review-pack.js';
import {
  normalizeEmployerBrandLiveEvidenceRepairedLocatorCapturePlan,
  validateEmployerBrandLiveEvidenceRepairedLocatorCapturePlan,
} from './employer-brand-live-evidence-capture-repair-promotion.js';

export const EMPLOYER_BRAND_LIVE_EVIDENCE_VISIBILITY_ADJUSTED_CAPTURE_PLAN_TYPE =
  'aos.employer_brand_live_evidence_visibility_adjusted_capture_plan';
export const EMPLOYER_BRAND_LIVE_EVIDENCE_VISIBILITY_ADJUSTED_CAPTURE_PLAN_SCHEMA_VERSION =
  '2026-05-employer-brand-live-evidence-visibility-adjusted-capture-plan-v0';

const DEFAULT_FIXTURE_ROOT = 'docs/design/fixtures/aos-artifacts/employer-brand-comparative-audit';
const EXECUTABLE_DECISIONS = new Set(['add_scroll_strategy', 'add_wait_condition', 'adjust_viewport', 'edit_locator']);
const CONTROLS = {
  open_urls: false,
  run_browser_capture: false,
  run_locator_resolution: false,
  run_codegen: false,
  invent_selectors: false,
  invent_xpath: false,
  invent_playwright_locators: false,
  create_clips: false,
  extract_text: false,
  promote_captures: false,
  full_page_grab: false,
  bypass_login_or_access_controls: false,
};

function arrayValue(value) {
  return Array.isArray(value) ? value : [];
}

function objectValue(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function loadJson(fixtureRoot, relativePath) {
  return readJson(path.join(fixtureRoot, relativePath));
}

function locatorHasValue(locator) {
  return Boolean(locator?.selector || locator?.xpath || locator?.playwright_locator);
}

function plannedOutputsFromSlot(slot) {
  return arrayValue(slot.planned_outputs).map((output) => ({
    ...cloneJson(objectValue(output)),
    clip_path: null,
    text_extract_path: null,
    full_page_grab: false,
  }));
}

function buildVisibilityAdjustedSlot({ repairedSlot, repairItem, visibilityFailure }) {
  const repair = objectValue(repairItem.repair);
  return {
    ...cloneJson(repairedSlot),
    executable: true,
    status: 'visibility_adjusted_ready_for_capture_attempt',
    repaired_locator: cloneJson(objectValue(repairedSlot.repaired_locator)),
    expected_clip_count: Number(repairItem.expected_clip_count || repairedSlot.expected_clip_count || 0),
    planned_outputs: plannedOutputsFromSlot(repairedSlot),
    full_page_grab: false,
    visibility_precondition: {
      visibility_repair_decision: repair.visibility_repair_decision,
      capture_precondition: repair.capture_precondition,
      scroll_strategy: repair.scroll_strategy,
      wait_condition: repair.wait_condition,
      viewport_hint: repair.viewport_hint,
      operator_repair_notes: repair.repair_notes,
      reviewed_by: repair.reviewed_by,
      reviewed_at: repair.reviewed_at,
      source_visibility_repair_item_id: repairItem.repair_item_id,
      source_visibility_failure_id: repairItem.failure_id,
      read_only: true,
    },
    visibility_failure_provenance: {
      blocker_reason: repairItem.blocker_reason,
      failure_classification: repairItem.failure_classification,
      visibility_failure_kind: repairItem.visibility_failure_kind,
      failed_phase: repairItem.failed_phase,
      runner_type: repairItem.runner_type,
      match_count: repairItem.match_count,
      operator_outcome_notes: cloneJson(objectValue(repairItem.operator_outcome_notes)),
      capture_metadata: cloneJson(objectValue(repairItem.capture_metadata)),
      acceptance_checks: cloneJson(arrayValue(repairItem.acceptance_checks)),
      source_visibility_review_pack_path: 'live-evidence-repaired-capture-visibility-review-pack.json',
      source_visibility_failure_id: visibilityFailure?.failure_id || repairItem.failure_id,
      read_only: true,
    },
    provenance: {
      ...cloneJson(objectValue(repairedSlot.provenance)),
      source_capture_plan_path: 'live-evidence-visibility-adjusted-capture-plan.json',
      source_repaired_locator_capture_plan_path: 'live-evidence-repaired-locator-capture-plan.json',
      source_visibility_repair_patch_path: 'live-evidence-repaired-capture-visibility-repair-patch.json',
      source_visibility_review_pack_path: 'live-evidence-repaired-capture-visibility-review-pack.json',
      visibility_precondition_planned_only: true,
      no_capture_assets_produced: true,
      read_only_source_context: true,
    },
  };
}

export function buildEmployerBrandLiveEvidenceVisibilityAdjustedCapturePlan(inputs = {}, {
  createdAt = null,
} = {}) {
  const reviewValidation = validateEmployerBrandRepairedCaptureVisibilityReviewPack(inputs.visibilityReviewPack);
  if (!reviewValidation.valid) throw new Error(`Visibility review pack validation failed: ${reviewValidation.errors.join('; ')}`);
  const patchValidation = validateEmployerBrandRepairedCaptureVisibilityRepairPatch(inputs.visibilityRepairPatch, inputs.visibilityReviewPack);
  if (!patchValidation.valid) throw new Error(`Visibility repair patch validation failed: ${patchValidation.errors.join('; ')}`);
  const repairedPlanValidation = validateEmployerBrandLiveEvidenceRepairedLocatorCapturePlan(inputs.repairedLocatorCapturePlan);
  if (!repairedPlanValidation.valid) throw new Error(`Repaired locator capture plan validation failed: ${repairedPlanValidation.errors.join('; ')}`);

  const reviewPack = normalizeEmployerBrandRepairedCaptureVisibilityReviewPack(inputs.visibilityReviewPack);
  const patch = normalizeEmployerBrandRepairedCaptureVisibilityRepairPatch(inputs.visibilityRepairPatch);
  const repairedPlan = normalizeEmployerBrandLiveEvidenceRepairedLocatorCapturePlan(inputs.repairedLocatorCapturePlan);
  const repairItems = patch.repair_items.filter((item) => EXECUTABLE_DECISIONS.has(item.repair.visibility_repair_decision));
  const repairedSlotsById = new Map(repairedPlan.repaired_capture_slots.map((slot) => [slot.slot_id, slot]));
  const visibilityFailuresById = new Map(reviewPack.visibility_failures.map((failure) => [failure.slot_id, failure]));
  const visibilityAdjustedSlots = repairItems.map((item) => {
    const repairedSlot = repairedSlotsById.get(item.slot_id);
    if (!repairedSlot) throw new Error(`${item.slot_id} is missing from the repaired locator capture plan`);
    return buildVisibilityAdjustedSlot({
      repairedSlot,
      repairItem: item,
      visibilityFailure: visibilityFailuresById.get(item.slot_id),
    });
  });
  const plannedOutputSlots = visibilityAdjustedSlots.flatMap((slot) => plannedOutputsFromSlot(slot));
  const sourceRefs = {
    visibility_repair_patch_id: patch.id,
    visibility_repair_patch_path: 'live-evidence-repaired-capture-visibility-repair-patch.json',
    visibility_review_pack_id: reviewPack.id,
    visibility_review_pack_path: 'live-evidence-repaired-capture-visibility-review-pack.json',
    repaired_locator_capture_plan_id: repairedPlan.id,
    repaired_locator_capture_plan_path: 'live-evidence-repaired-locator-capture-plan.json',
    element_clip_manifest_id: inputs.elementClipManifest?.id || null,
    element_clip_manifest_path: 'source-artifacts/live-evidence-element-clip-manifest.json',
    repaired_capture_runtime_diagnostics_id: inputs.repairedCaptureRuntimeDiagnostics?.id || null,
    repaired_capture_runtime_diagnostics_path: 'live-evidence-repaired-capture-runtime-diagnostics.json',
    reviewed_target_plan_id: inputs.reviewedTargetPlan?.id || null,
    reviewed_target_plan_path: 'live-evidence-target-plan.reviewed.json',
    data_bundle_id: inputs.dataBundle?.id || null,
    data_bundle_path: 'data-bundle.json',
    read_only: true,
  };
  const summary = {
    visibility_adjusted_executable_slot_count: visibilityAdjustedSlots.length,
    repaired_executable_slot_count: repairedPlan.summary.repaired_executable_slot_count,
    unavailable_source_slot_count: arrayValue(repairedPlan.unavailable_source_slots).length,
    non_executable_context_entry_count: arrayValue(repairedPlan.non_executable_context).length,
    read_only_visibility_context_entry_count: arrayValue(patch.read_only_context).length,
    accepted_capture_count: 0,
    promoted_capture_count: 0,
    actual_clip_asset_count: 0,
    actual_text_asset_count: 0,
    actual_capture_file_count: 0,
    planned_output_slot_count: plannedOutputSlots.length,
    scroll_strategy_count: visibilityAdjustedSlots.filter((slot) => slot.visibility_precondition.scroll_strategy !== null).length,
    wait_condition_count: visibilityAdjustedSlots.filter((slot) => slot.visibility_precondition.wait_condition !== null).length,
    viewport_hint_count: visibilityAdjustedSlots.filter((slot) => slot.visibility_precondition.viewport_hint !== null).length,
    full_page_grab_count: 0,
  };
  return normalizeEmployerBrandLiveEvidenceVisibilityAdjustedCapturePlan({
    type: EMPLOYER_BRAND_LIVE_EVIDENCE_VISIBILITY_ADJUSTED_CAPTURE_PLAN_TYPE,
    schema_version: EMPLOYER_BRAND_LIVE_EVIDENCE_VISIBILITY_ADJUSTED_CAPTURE_PLAN_SCHEMA_VERSION,
    id: 'live-evidence-visibility-adjusted-capture-plan:symphony-talent-phenom-radancy',
    label: 'Employer Brand Live Evidence Visibility-Adjusted Capture Plan',
    status: 'visibility_adjusted_pre_capture_plan_ready',
    source_refs: sourceRefs,
    summary,
    capture_ordering: {
      strategy: 'preserve_visibility_repair_patch_slot_order',
      order_is_deterministic: true,
      executable_slot_ids: visibilityAdjustedSlots.map((slot) => slot.slot_id),
      stop_after_each_slot_for_human_review: true,
    },
    repaired_capture_slots: visibilityAdjustedSlots,
    unavailable_source_slots: cloneJson(arrayValue(repairedPlan.unavailable_source_slots)),
    non_executable_context: cloneJson(arrayValue(repairedPlan.non_executable_context)),
    read_only_visibility_context: cloneJson(arrayValue(patch.read_only_context)),
    planned_output_manifest: {
      status: 'planned_only_empty',
      expected_clip_count: plannedOutputSlots.length,
      expected_text_extract_count: plannedOutputSlots.length,
      slots: plannedOutputSlots,
      contains_actual_captures: false,
    },
    controls: cloneJson(CONTROLS),
    provenance: {
      created_at: createdAt,
      deterministic_from_filled_visibility_repair_patch: true,
      operator_approved_visibility_preconditions_only: true,
      no_urls_opened: true,
      no_browser_capture_run: true,
      no_locator_resolution_or_codegen: true,
      no_selectors_invented: true,
      no_capture_assets_produced: true,
      no_full_page_grabs: true,
      read_only: true,
      planning_metadata_only: true,
    },
  });
}

export function normalizeEmployerBrandLiveEvidenceVisibilityAdjustedCapturePlan(input = {}) {
  const plan = objectValue(input);
  return {
    ...cloneJson(plan),
    repaired_capture_slots: arrayValue(plan.repaired_capture_slots).map((slotInput) => ({
      ...cloneJson(objectValue(slotInput)),
      executable: true,
      repaired_locator: cloneJson(objectValue(slotInput.repaired_locator)),
      planned_outputs: plannedOutputsFromSlot(slotInput),
      visibility_precondition: {
        visibility_repair_decision: null,
        capture_precondition: null,
        scroll_strategy: null,
        wait_condition: null,
        viewport_hint: null,
        operator_repair_notes: null,
        reviewed_by: null,
        reviewed_at: null,
        read_only: true,
        ...cloneJson(objectValue(slotInput.visibility_precondition)),
      },
      full_page_grab: false,
    })),
    unavailable_source_slots: arrayValue(plan.unavailable_source_slots).map((slot) => ({
      ...cloneJson(objectValue(slot)),
      executable: false,
      planned_outputs: [],
      full_page_grab: false,
    })),
    non_executable_context: arrayValue(plan.non_executable_context).map((entry) => ({
      ...cloneJson(objectValue(entry)),
      executable: false,
      full_page_grab: false,
    })),
    read_only_visibility_context: arrayValue(plan.read_only_visibility_context).map((entry) => ({
      ...cloneJson(objectValue(entry)),
      read_only_context: true,
      actionable_visibility_repair_item: false,
      full_page_grab: false,
    })),
    planned_output_manifest: {
      ...cloneJson(objectValue(plan.planned_output_manifest)),
      slots: arrayValue(plan.planned_output_manifest?.slots).map((slot) => ({
        ...cloneJson(objectValue(slot)),
        clip_path: null,
        text_extract_path: null,
        full_page_grab: false,
      })),
      contains_actual_captures: false,
    },
  };
}

export function validateEmployerBrandLiveEvidenceVisibilityAdjustedCapturePlan(input = {}) {
  const plan = normalizeEmployerBrandLiveEvidenceVisibilityAdjustedCapturePlan(input);
  const errors = [];
  if (plan.type !== EMPLOYER_BRAND_LIVE_EVIDENCE_VISIBILITY_ADJUSTED_CAPTURE_PLAN_TYPE) errors.push('type must identify a visibility-adjusted capture plan');
  if (plan.schema_version !== EMPLOYER_BRAND_LIVE_EVIDENCE_VISIBILITY_ADJUSTED_CAPTURE_PLAN_SCHEMA_VERSION) errors.push('schema_version must be visibility-adjusted capture plan v0');
  if (plan.status !== 'visibility_adjusted_pre_capture_plan_ready') errors.push('status must be visibility_adjusted_pre_capture_plan_ready');
  if (plan.summary?.visibility_adjusted_executable_slot_count !== 4) errors.push('visibility-adjusted executable slot count must be 4');
  if (plan.summary?.accepted_capture_count !== 0) errors.push('accepted capture count must remain 0');
  if (plan.summary?.actual_clip_asset_count !== 0 || plan.summary?.actual_text_asset_count !== 0) errors.push('actual asset counts must remain 0');
  if (plan.summary?.planned_output_slot_count !== 4) errors.push('planned output slot count must be 4');
  if (plan.summary?.scroll_strategy_count !== 1) errors.push('scroll strategy count must be 1');
  if (plan.summary?.wait_condition_count !== 3) errors.push('wait condition count must be 3');
  if (plan.summary?.viewport_hint_count !== 0) errors.push('viewport hint count must be 0');
  if (plan.summary?.full_page_grab_count !== 0) errors.push('full_page_grab count must be 0');
  if (plan.repaired_capture_slots.length !== 4) errors.push('plan must include exactly 4 executable slots');
  if (plan.unavailable_source_slots.length !== 1) errors.push('LinkedIn source-unavailable context must be preserved');
  if (plan.non_executable_context.length !== 14) errors.push('14 non-executable context entries must be preserved');
  if (plan.read_only_visibility_context.length !== 15) errors.push('15 visibility read-only context entries must be preserved');
  for (const [key, value] of Object.entries(objectValue(plan.controls))) {
    if (value !== false) errors.push(`controls.${key} must remain false`);
  }
  for (const slot of plan.repaired_capture_slots) {
    if (slot.executable !== true) errors.push(`${slot.slot_id} must be executable`);
    if (!locatorHasValue(slot.repaired_locator)) errors.push(`${slot.slot_id} must preserve repaired locator`);
    if (slot.full_page_grab !== false) errors.push(`${slot.slot_id} full_page_grab must be false`);
    const precondition = slot.visibility_precondition;
    if (!EXECUTABLE_DECISIONS.has(precondition.visibility_repair_decision)) errors.push(`${slot.slot_id} must carry an executable visibility decision`);
    if (!precondition.capture_precondition) errors.push(`${slot.slot_id} must preserve capture_precondition`);
    if (!precondition.operator_repair_notes) errors.push(`${slot.slot_id} must preserve operator repair notes`);
    if (precondition.visibility_repair_decision === 'add_scroll_strategy' && !precondition.scroll_strategy) errors.push(`${slot.slot_id} missing approved scroll strategy`);
    if (precondition.visibility_repair_decision === 'add_wait_condition' && !precondition.wait_condition) errors.push(`${slot.slot_id} missing approved wait condition`);
    for (const output of slot.planned_outputs) {
      if (output.clip_path !== null || output.text_extract_path !== null) errors.push(`${output.slot_id} planned paths must remain null`);
      if (output.full_page_grab !== false) errors.push(`${output.slot_id} planned full_page_grab must be false`);
    }
  }
  for (const output of arrayValue(plan.planned_output_manifest?.slots)) {
    if (output.clip_path !== null || output.text_extract_path !== null) errors.push(`${output.slot_id} manifest planned paths must remain null`);
    if (output.full_page_grab !== false) errors.push(`${output.slot_id} manifest full_page_grab must be false`);
  }
  return { valid: errors.length === 0, errors };
}

export function loadEmployerBrandLiveEvidenceVisibilityAdjustedCapturePlan({ fixtureRoot = DEFAULT_FIXTURE_ROOT } = {}) {
  return loadJson(fixtureRoot, 'live-evidence-visibility-adjusted-capture-plan.json');
}

export function loadEmployerBrandLiveEvidenceVisibilityAdjustedCapturePlanInputs({ fixtureRoot = DEFAULT_FIXTURE_ROOT } = {}) {
  return {
    visibilityRepairPatch: loadJson(fixtureRoot, 'live-evidence-repaired-capture-visibility-repair-patch.json'),
    visibilityReviewPack: loadJson(fixtureRoot, 'live-evidence-repaired-capture-visibility-review-pack.json'),
    repairedLocatorCapturePlan: loadJson(fixtureRoot, 'live-evidence-repaired-locator-capture-plan.json'),
    elementClipManifest: loadJson(fixtureRoot, 'source-artifacts/live-evidence-element-clip-manifest.json'),
    repairedCaptureRuntimeDiagnostics: loadJson(fixtureRoot, 'live-evidence-repaired-capture-runtime-diagnostics.json'),
    reviewedTargetPlan: loadJson(fixtureRoot, 'live-evidence-target-plan.reviewed.json'),
    dataBundle: loadJson(fixtureRoot, 'data-bundle.json'),
  };
}

export function writeEmployerBrandLiveEvidenceVisibilityAdjustedCapturePlan(plan, {
  fixtureRoot = DEFAULT_FIXTURE_ROOT,
  outPath = 'live-evidence-visibility-adjusted-capture-plan.json',
} = {}) {
  const outputPath = path.isAbsolute(outPath) ? outPath : path.join(fixtureRoot, outPath);
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, `${JSON.stringify(plan, null, 2)}\n`);
  return outputPath;
}
