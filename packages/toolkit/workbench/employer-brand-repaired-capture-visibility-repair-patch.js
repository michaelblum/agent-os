import fs from 'node:fs';
import path from 'node:path';
import {
  normalizeEmployerBrandRepairedCaptureVisibilityReviewPack,
  validateEmployerBrandRepairedCaptureVisibilityReviewPack,
} from './employer-brand-repaired-capture-visibility-review-pack.js';

export const EMPLOYER_BRAND_REPAIRED_CAPTURE_VISIBILITY_REPAIR_PATCH_TYPE =
  'aos.employer_brand_repaired_capture_visibility_repair_patch';
export const EMPLOYER_BRAND_REPAIRED_CAPTURE_VISIBILITY_REPAIR_PATCH_SCHEMA_VERSION =
  '2026-05-employer-brand-repaired-capture-visibility-repair-patch-v0';
export const EMPLOYER_BRAND_REPAIRED_CAPTURE_VISIBILITY_REPAIR_PATCH_APPLICATION_TYPE =
  'aos.employer_brand_repaired_capture_visibility_repair_patch_application';

export const VISIBILITY_REPAIR_DECISIONS = [
  'edit_locator',
  'add_scroll_strategy',
  'add_wait_condition',
  'adjust_viewport',
  'mark_target_hidden',
  'mark_source_unavailable',
  'reject_target',
  'keep_pending_review',
];

const DEFAULT_FIXTURE_ROOT = 'docs/design/fixtures/aos-artifacts/employer-brand-comparative-audit';

const REPAIR_FIELDS = {
  visibility_repair_decision: null,
  proposed_selector: null,
  proposed_xpath: null,
  proposed_playwright_locator: null,
  capture_precondition: null,
  scroll_strategy: null,
  wait_condition: null,
  viewport_hint: null,
  mark_target_hidden_reason: null,
  repair_notes: null,
  reviewed_by: null,
  reviewed_at: null,
};

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

function text(value, fallback = '') {
  const normalized = String(value ?? '').replace(/\s+/g, ' ').trim();
  return normalized || fallback;
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function loadJson(fixtureRoot, relativePath) {
  return readJson(path.join(fixtureRoot, relativePath));
}

function groupCounts(items, key) {
  return items.reduce((counts, item) => {
    const countKey = item[key] === null || item[key] === undefined ? 'null' : item[key];
    counts[countKey] = (counts[countKey] || 0) + 1;
    return counts;
  }, {});
}

function allRepairFieldsNull(items) {
  return items.every((item) => Object.values(item.repair).every((value) => value === null));
}

function filledDecisionCount(items) {
  return items.filter((item) => item.repair.visibility_repair_decision !== null).length;
}

function repairHasLocator(repair) {
  return Boolean(text(repair.proposed_selector) || text(repair.proposed_xpath) || text(repair.proposed_playwright_locator));
}

function failureToRepairItem(failure) {
  return {
    repair_item_id: failure.failure_id.replace('visibility-failure:', 'visibility-repair:'),
    failure_id: failure.failure_id,
    slot_id: failure.slot_id,
    target_id: failure.target_id,
    work_unit_id: failure.work_unit_id,
    company: failure.company,
    company_role: failure.company_role,
    source_category: failure.source_category,
    original_url: failure.original_url,
    final_url: failure.final_url,
    blocker_reason: failure.blocker_reason,
    failure_classification: failure.failure_classification,
    visibility_failure_kind: failure.visibility_failure_kind,
    failed_phase: failure.failed_phase,
    runner_type: failure.runner_type,
    match_count: failure.match_count,
    allowed_visibility_repair_decisions: cloneJson(VISIBILITY_REPAIR_DECISIONS),
    original_natural_language_target: failure.target_context?.original_natural_language_target ?? null,
    kilos_relevance: cloneJson(arrayValue(failure.target_context?.kilos_relevance)),
    evidence_goal: failure.target_context?.evidence_goal ?? null,
    expected_clip_count: Number(failure.target_context?.expected_clip_count ?? 0),
    target_context: cloneJson(objectValue(failure.target_context)),
    repaired_locator: cloneJson(objectValue(failure.repaired_locator)),
    operator_outcome_notes: cloneJson(objectValue(failure.operator_outcome_notes)),
    prior_repair_provenance: cloneJson(objectValue(failure.prior_repair_provenance)),
    citation_source_metadata: failure.citation_source_metadata ? cloneJson(failure.citation_source_metadata) : null,
    capture_metadata: cloneJson(objectValue(failure.capture_metadata)),
    acceptance_checks: cloneJson(arrayValue(failure.acceptance_checks)),
    full_page_grab: failure.full_page_grab === true,
    repair: cloneJson(REPAIR_FIELDS),
    provenance: {
      source_visibility_failure_id: failure.failure_id,
      source_visibility_review_pack_path: 'live-evidence-repaired-capture-visibility-review-pack.json',
      read_only_source_context: true,
      patchable_repair_fields_only: true,
    },
  };
}

function contextItem(entry) {
  return {
    ...cloneJson(objectValue(entry)),
    read_only_context: true,
    actionable_visibility_repair_item: false,
  };
}

function normalizeRepairItem(input) {
  const item = objectValue(input);
  return {
    ...cloneJson(item),
    allowed_visibility_repair_decisions: arrayValue(item.allowed_visibility_repair_decisions),
    kilos_relevance: arrayValue(item.kilos_relevance),
    target_context: cloneJson(objectValue(item.target_context)),
    repaired_locator: cloneJson(objectValue(item.repaired_locator)),
    operator_outcome_notes: cloneJson(objectValue(item.operator_outcome_notes)),
    prior_repair_provenance: cloneJson(objectValue(item.prior_repair_provenance)),
    capture_metadata: cloneJson(objectValue(item.capture_metadata)),
    acceptance_checks: cloneJson(arrayValue(item.acceptance_checks)),
    full_page_grab: item.full_page_grab === true,
    repair: {
      ...cloneJson(REPAIR_FIELDS),
      ...cloneJson(objectValue(item.repair)),
    },
  };
}

export function buildEmployerBrandRepairedCaptureVisibilityRepairPatch(inputs = {}, {
  createdAt = null,
} = {}) {
  const reviewPack = normalizeEmployerBrandRepairedCaptureVisibilityReviewPack(inputs.visibilityReviewPack);
  const repairItems = reviewPack.visibility_failures.map(failureToRepairItem);
  const readOnlyContext = reviewPack.non_actionable_context.map(contextItem);
  return {
    type: EMPLOYER_BRAND_REPAIRED_CAPTURE_VISIBILITY_REPAIR_PATCH_TYPE,
    schema_version: EMPLOYER_BRAND_REPAIRED_CAPTURE_VISIBILITY_REPAIR_PATCH_SCHEMA_VERSION,
    id: 'live-evidence-repaired-capture-visibility-repair-patch:symphony-talent-phenom-radancy',
    label: 'Employer Brand Repaired Capture Visibility Repair Patch Template',
    status: 'unfilled_template',
    source_refs: {
      visibility_review_pack_id: reviewPack.id,
      visibility_review_pack_path: 'live-evidence-repaired-capture-visibility-review-pack.json',
      visibility_review_pack_schema: 'shared/schemas/employer-brand-repaired-capture-visibility-review-pack-v0.schema.json',
      manifest_path: 'source-artifacts/live-evidence-element-clip-manifest.json',
      repaired_locator_capture_plan_path: 'live-evidence-repaired-locator-capture-plan.json',
      repaired_capture_runtime_diagnostics_path: 'live-evidence-repaired-capture-runtime-diagnostics.json',
      read_only: true,
    },
    summary: {
      patchable_visibility_repair_item_count: repairItems.length,
      read_only_context_entry_count: readOnlyContext.length,
      filled_visibility_repair_decision_count: filledDecisionCount(repairItems),
      proposed_locator_count: repairItems.filter((item) => repairHasLocator(item.repair)).length,
      scroll_strategy_count: repairItems.filter((item) => item.repair.scroll_strategy !== null).length,
      wait_condition_count: repairItems.filter((item) => item.repair.wait_condition !== null).length,
      viewport_hint_count: repairItems.filter((item) => item.repair.viewport_hint !== null).length,
      hidden_target_count: repairItems.filter((item) => item.repair.visibility_repair_decision === 'mark_target_hidden').length,
      source_unavailable_count: repairItems.filter((item) => item.repair.visibility_repair_decision === 'mark_source_unavailable').length,
      failed_phase_counts: groupCounts(repairItems, 'failed_phase'),
      runner_type_counts: groupCounts(repairItems, 'runner_type'),
      match_count_counts: groupCounts(repairItems, 'match_count'),
      all_repair_fields_null: allRepairFieldsNull(repairItems),
    },
    allowed_visibility_repair_decisions: cloneJson(VISIBILITY_REPAIR_DECISIONS),
    repair_items: repairItems,
    read_only_context: readOnlyContext,
    controls: cloneJson(CONTROLS),
    provenance: {
      created_at: createdAt,
      deterministic_from_local_inputs: true,
      template_only: true,
      repair_fields_initialized_null: true,
      source_visibility_review_pack_unmodified: true,
      no_urls_opened: true,
      no_browser_capture_run: true,
      no_locator_resolution_or_codegen: true,
      no_selectors_invented: true,
      no_xpath_invented: true,
      no_playwright_locators_invented: true,
      no_clips_or_text_extracts_created: true,
      read_only: true,
    },
  };
}

export function normalizeEmployerBrandRepairedCaptureVisibilityRepairPatch(input = {}) {
  const patch = objectValue(input);
  const repairItems = arrayValue(patch.repair_items).map(normalizeRepairItem);
  const readOnlyContext = arrayValue(patch.read_only_context).map((entry) => ({
    ...cloneJson(objectValue(entry)),
    read_only_context: entry.read_only_context !== false,
    actionable_visibility_repair_item: false,
  }));
  return {
    ...cloneJson(patch),
    allowed_visibility_repair_decisions: arrayValue(patch.allowed_visibility_repair_decisions),
    repair_items: repairItems,
    read_only_context: readOnlyContext,
    summary: {
      ...cloneJson(objectValue(patch.summary)),
      patchable_visibility_repair_item_count: repairItems.length,
      read_only_context_entry_count: readOnlyContext.length,
      filled_visibility_repair_decision_count: filledDecisionCount(repairItems),
      proposed_locator_count: repairItems.filter((item) => repairHasLocator(item.repair)).length,
      scroll_strategy_count: repairItems.filter((item) => item.repair.scroll_strategy !== null).length,
      wait_condition_count: repairItems.filter((item) => item.repair.wait_condition !== null).length,
      viewport_hint_count: repairItems.filter((item) => item.repair.viewport_hint !== null).length,
      hidden_target_count: repairItems.filter((item) => item.repair.visibility_repair_decision === 'mark_target_hidden').length,
      source_unavailable_count: repairItems.filter((item) => item.repair.visibility_repair_decision === 'mark_source_unavailable').length,
      failed_phase_counts: groupCounts(repairItems, 'failed_phase'),
      runner_type_counts: groupCounts(repairItems, 'runner_type'),
      match_count_counts: groupCounts(repairItems, 'match_count'),
      all_repair_fields_null: allRepairFieldsNull(repairItems),
    },
  };
}

function validateDecisionRequirements(item, errors) {
  const repair = item.repair;
  if (repair.visibility_repair_decision === null) return;
  if (!VISIBILITY_REPAIR_DECISIONS.includes(repair.visibility_repair_decision)) {
    errors.push(`${item.slot_id} visibility_repair_decision is invalid`);
    return;
  }
  if (repair.visibility_repair_decision === 'edit_locator' && !repairHasLocator(repair)) {
    errors.push(`${item.slot_id} edit_locator requires a proposed locator`);
  }
  if (repair.visibility_repair_decision === 'add_scroll_strategy' && !text(repair.scroll_strategy)) {
    errors.push(`${item.slot_id} add_scroll_strategy requires scroll_strategy`);
  }
  if (repair.visibility_repair_decision === 'add_wait_condition' && !text(repair.wait_condition)) {
    errors.push(`${item.slot_id} add_wait_condition requires wait_condition`);
  }
  if (repair.visibility_repair_decision === 'adjust_viewport' && !text(repair.viewport_hint)) {
    errors.push(`${item.slot_id} adjust_viewport requires viewport_hint`);
  }
  if (repair.visibility_repair_decision === 'mark_target_hidden' && !text(repair.mark_target_hidden_reason)) {
    errors.push(`${item.slot_id} mark_target_hidden requires mark_target_hidden_reason`);
  }
  if (['mark_source_unavailable', 'reject_target'].includes(repair.visibility_repair_decision) && !text(repair.repair_notes)) {
    errors.push(`${item.slot_id} ${repair.visibility_repair_decision} requires repair_notes`);
  }
}

export function validateEmployerBrandRepairedCaptureVisibilityRepairPatch(input = {}, reviewPackInput = null) {
  const errors = [];
  const patch = normalizeEmployerBrandRepairedCaptureVisibilityRepairPatch(input);
  const reviewPack = reviewPackInput ? normalizeEmployerBrandRepairedCaptureVisibilityReviewPack(reviewPackInput) : null;
  const reviewValidation = reviewPackInput
    ? validateEmployerBrandRepairedCaptureVisibilityReviewPack(reviewPackInput)
    : { valid: true, errors: [] };
  if (!reviewValidation.valid) errors.push(`visibility review pack invalid: ${reviewValidation.errors.join('; ')}`);
  if (patch.type !== EMPLOYER_BRAND_REPAIRED_CAPTURE_VISIBILITY_REPAIR_PATCH_TYPE) errors.push('type must identify a repaired capture visibility repair patch');
  if (patch.schema_version !== EMPLOYER_BRAND_REPAIRED_CAPTURE_VISIBILITY_REPAIR_PATCH_SCHEMA_VERSION) errors.push('schema_version must be repaired capture visibility repair patch v0');
  if (patch.status !== 'unfilled_template' && patch.status !== 'repair_reviewed') errors.push('status must be unfilled_template or repair_reviewed');
  if (patch.source_refs?.visibility_review_pack_path !== 'live-evidence-repaired-capture-visibility-review-pack.json') errors.push('source_refs must reference the visibility review pack');
  if (patch.repair_items.length !== 4) errors.push('repair_items must include exactly 4 patchable visibility repair items');
  if (patch.read_only_context.length !== 15) errors.push('read_only_context must preserve 15 non-actionable context entries');
  if (patch.allowed_visibility_repair_decisions.join('|') !== VISIBILITY_REPAIR_DECISIONS.join('|')) errors.push('allowed decisions must match the V0 visibility decision set');
  for (const [key, value] of Object.entries(objectValue(patch.controls))) {
    if (value !== false) errors.push(`controls.${key} must remain false`);
  }
  const failuresBySlot = new Map(arrayValue(reviewPack?.visibility_failures).map((failure) => [failure.slot_id, failure]));
  const seenSlots = new Set();
  for (const item of patch.repair_items) {
    if (seenSlots.has(item.slot_id)) errors.push(`${item.slot_id} appears more than once`);
    seenSlots.add(item.slot_id);
    const source = failuresBySlot.get(item.slot_id);
    if (reviewPack && !source) {
      errors.push(`${item.slot_id} is not present in the visibility review pack`);
    } else if (source) {
      for (const key of ['failure_id', 'target_id', 'work_unit_id', 'company', 'source_category', 'original_url', 'final_url', 'blocker_reason', 'failed_phase', 'runner_type', 'match_count']) {
        if (item[key] !== source[key]) errors.push(`${item.slot_id} does not preserve ${key}`);
      }
    }
    if (item.full_page_grab !== false) errors.push(`${item.slot_id} full_page_grab must remain false`);
    if (!arrayValue(item.allowed_visibility_repair_decisions).every((decision) => VISIBILITY_REPAIR_DECISIONS.includes(decision))) {
      errors.push(`${item.slot_id} includes an unsupported allowed decision`);
    }
    validateDecisionRequirements(item, errors);
  }
  for (const entry of patch.read_only_context) {
    if (entry.actionable_visibility_repair_item !== false) errors.push(`${entry.target_id} context must not be actionable`);
    if (entry.read_only_context !== true) errors.push(`${entry.target_id} context must be read-only`);
    if (entry.full_page_grab !== false) errors.push(`${entry.target_id} context full_page_grab must remain false`);
  }
  if (reviewPack) {
    const failureSlots = reviewPack.visibility_failures.map((failure) => failure.slot_id).sort();
    const repairSlots = patch.repair_items.map((item) => item.slot_id).sort();
    if (failureSlots.join('|') !== repairSlots.join('|')) errors.push('repair_items must exactly match visibility failure slots');
  }
  return { valid: errors.length === 0, errors };
}

export function applyEmployerBrandRepairedCaptureVisibilityRepairPatch({
  patchInput,
  visibilityReviewPackInput,
  elementClipManifestInput = null,
  appliedAt = null,
} = {}) {
  const reviewValidation = validateEmployerBrandRepairedCaptureVisibilityReviewPack(visibilityReviewPackInput);
  if (!reviewValidation.valid) throw new Error(`Visibility review pack validation failed: ${reviewValidation.errors.join('; ')}`);
  const patchValidation = validateEmployerBrandRepairedCaptureVisibilityRepairPatch(patchInput, visibilityReviewPackInput);
  if (!patchValidation.valid) throw new Error(`Visibility repair patch validation failed: ${patchValidation.errors.join('; ')}`);
  const patch = normalizeEmployerBrandRepairedCaptureVisibilityRepairPatch(patchInput);
  const reviewPack = normalizeEmployerBrandRepairedCaptureVisibilityReviewPack(visibilityReviewPackInput);
  const manifest = elementClipManifestInput ? objectValue(elementClipManifestInput) : null;
  const filled = filledDecisionCount(patch.repair_items);
  const noOp = filled === 0;
  return {
    type: EMPLOYER_BRAND_REPAIRED_CAPTURE_VISIBILITY_REPAIR_PATCH_APPLICATION_TYPE,
    schema_version: EMPLOYER_BRAND_REPAIRED_CAPTURE_VISIBILITY_REPAIR_PATCH_SCHEMA_VERSION,
    id: 'live-evidence-repaired-capture-visibility-repair-patch-application:symphony-talent-phenom-radancy',
    label: 'Employer Brand Repaired Capture Visibility Repair Patch Application',
    status: noOp ? 'no_op_unfilled_template' : 'visibility_repairs_pending_execution',
    source_refs: {
      visibility_repair_patch_id: patch.id,
      visibility_repair_patch_path: 'live-evidence-repaired-capture-visibility-repair-patch.json',
      visibility_review_pack_id: reviewPack.id,
      visibility_review_pack_path: 'live-evidence-repaired-capture-visibility-review-pack.json',
      element_clip_manifest_id: manifest?.id || null,
      element_clip_manifest_path: manifest ? 'source-artifacts/live-evidence-element-clip-manifest.json' : null,
    },
    summary: {
      patchable_visibility_repair_item_count: patch.repair_items.length,
      filled_visibility_repair_decision_count: filled,
      prior_accepted_capture_count: reviewPack.summary.accepted_capture_count,
      post_accepted_capture_count: reviewPack.summary.accepted_capture_count,
      prior_failed_slot_count: reviewPack.summary.failed_slot_count,
      post_failed_slot_count: reviewPack.summary.failed_slot_count,
      prior_clip_asset_count: reviewPack.summary.actual_clip_asset_count,
      post_clip_asset_count: reviewPack.summary.actual_clip_asset_count,
      prior_text_asset_count: reviewPack.summary.actual_text_asset_count,
      post_text_asset_count: reviewPack.summary.actual_text_asset_count,
      promoted_capture_count: 0,
      new_asset_count: 0,
      full_page_grab_count: reviewPack.summary.full_page_grab_count,
      no_op: noOp,
    },
    repair_results: patch.repair_items.map((item) => ({
      repair_item_id: item.repair_item_id,
      failure_id: item.failure_id,
      slot_id: item.slot_id,
      target_id: item.target_id,
      work_unit_id: item.work_unit_id,
      visibility_repair_decision: item.repair.visibility_repair_decision,
      applied: false,
      result: item.repair.visibility_repair_decision === null ? 'unresolved_empty_repair_fields' : 'pending_later_supervised_execution',
      capture_promoted: false,
      asset_created: false,
    })),
    controls: cloneJson(CONTROLS),
    provenance: {
      applied_at: appliedAt,
      empty_patch_no_op: noOp,
      deterministic_from_local_inputs: true,
      does_not_modify_visibility_review_pack: true,
      does_not_promote_captures: true,
      does_not_create_assets: true,
      no_urls_opened: true,
      no_browser_capture_run: true,
      no_locator_resolution_or_codegen: true,
    },
  };
}

export function loadEmployerBrandRepairedCaptureVisibilityRepairPatch({ fixtureRoot = DEFAULT_FIXTURE_ROOT } = {}) {
  return loadJson(fixtureRoot, 'live-evidence-repaired-capture-visibility-repair-patch.json');
}

export function loadEmployerBrandRepairedCaptureVisibilityRepairPatchApplication({ fixtureRoot = DEFAULT_FIXTURE_ROOT } = {}) {
  return loadJson(fixtureRoot, 'live-evidence-repaired-capture-visibility-repair-patch.application.json');
}

export function writeEmployerBrandRepairedCaptureVisibilityRepairPatch(patch, {
  fixtureRoot = DEFAULT_FIXTURE_ROOT,
  outPath = 'live-evidence-repaired-capture-visibility-repair-patch.json',
} = {}) {
  const outputPath = path.isAbsolute(outPath) ? outPath : path.join(fixtureRoot, outPath);
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, `${JSON.stringify(patch, null, 2)}\n`);
  return outputPath;
}
