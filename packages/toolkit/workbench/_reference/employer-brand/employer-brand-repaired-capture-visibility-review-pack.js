import fs from 'node:fs';
import path from 'node:path';

export const EMPLOYER_BRAND_REPAIRED_CAPTURE_VISIBILITY_REVIEW_PACK_TYPE =
  'aos.employer_brand_repaired_capture_visibility_review_pack';
export const EMPLOYER_BRAND_REPAIRED_CAPTURE_VISIBILITY_REVIEW_PACK_SCHEMA_VERSION =
  '2026-05-employer-brand-repaired-capture-visibility-review-pack-v0';

const DEFAULT_FIXTURE_ROOT = 'docs/design/fixtures/aos-artifacts/employer-brand-comparative-audit';
const DEFAULT_MANIFEST_PATH = 'source-artifacts/live-evidence-element-clip-manifest.json';
const DEFAULT_CAPTURE_PLAN_PATH = 'live-evidence-repaired-locator-capture-plan.json';
const DEFAULT_REPAIR_PROMOTION_PATH = 'live-evidence-capture-repair-promotion.json';
const DEFAULT_REPAIR_PATCH_PATH = 'live-evidence-capture-repair-patch.json';
const DEFAULT_RUNTIME_DIAGNOSTICS_PATH = 'live-evidence-repaired-capture-runtime-diagnostics.json';
const DEFAULT_REVIEWED_TARGET_PLAN_PATH = 'live-evidence-target-plan.reviewed.json';
const DEFAULT_DATA_BUNDLE_PATH = 'data-bundle.json';

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

function nullableText(value) {
  const normalized = text(value);
  return normalized || null;
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

function plannedSlotById(capturePlan) {
  return new Map(arrayValue(capturePlan.repaired_capture_slots).map((slot) => [slot.slot_id, slot]));
}

function reviewedTargetById(reviewedTargetPlan) {
  return new Map(arrayValue(reviewedTargetPlan.targets).map((target) => [target.target_id, target]));
}

function targetContext(entry, plannedSlot, reviewedTarget) {
  const citation = objectValue(entry.citation_source_metadata);
  return {
    original_natural_language_target: nullableText(
      citation.desired_element
        ?? plannedSlot?.natural_language_target
        ?? reviewedTarget?.target_element
        ?? reviewedTarget?.desired_element,
    ),
    kilos_relevance: cloneJson(arrayValue(entry.kilos_relevance?.length ? entry.kilos_relevance : plannedSlot?.kilos_relevance)),
    evidence_goal: nullableText(citation.evidence_goal ?? plannedSlot?.evidence_goal ?? reviewedTarget?.evidence_goal),
    expected_clip_count: Number(plannedSlot?.expected_clip_count ?? reviewedTarget?.expected_clip_count ?? 0),
    page_name: nullableText(citation.page_name ?? reviewedTarget?.page_name),
    acceptance_criteria: cloneJson(arrayValue(reviewedTarget?.acceptance_criteria?.length ? reviewedTarget.acceptance_criteria : entry.acceptance_criteria_refs)),
  };
}

function operatorOutcomeNotes(entry) {
  const metadata = objectValue(entry.capture_metadata);
  return {
    required_next_action: nullableText(entry.required_next_action),
    retry_eligibility: nullableText(entry.retry_eligibility),
    title: nullableText(metadata.title),
    current_url: nullableText(metadata.current_url),
    runner_type: nullableText(metadata.runner_type ?? metadata.backend),
    failed_phase: nullableText(metadata.failed_phase ?? metadata.execution_phase),
    execution_phase: nullableText(metadata.execution_phase),
    match_count: metadata.match_count ?? null,
    frame_count: metadata.frame_count ?? null,
    total_frame_match_count: metadata.total_frame_match_count ?? null,
    viewport: metadata.viewport ? cloneJson(metadata.viewport) : null,
    started_phases: cloneJson(arrayValue(metadata.started_phases)),
    completed_phases: cloneJson(arrayValue(metadata.completed_phases)),
    phase_timings_ms: cloneJson(objectValue(metadata.phase_timings_ms)),
  };
}

function visibilityFailureFromEntry(entry, index, inputs) {
  const plannedSlot = plannedSlotById(inputs.repairedLocatorCapturePlan).get(entry.slot_id) || null;
  const reviewedTarget = reviewedTargetById(inputs.reviewedTargetPlan).get(entry.target_id) || null;
  const metadata = objectValue(entry.capture_metadata);
  return {
    failure_id: `live-evidence-repaired-capture-visibility-failure:${index + 1}`,
    slot_id: entry.slot_id,
    target_id: entry.target_id,
    work_unit_id: entry.work_unit_id,
    company: entry.company,
    company_role: entry.company_role,
    source_category: entry.source_category,
    original_url: entry.original_url,
    final_url: entry.final_url,
    status: entry.status,
    blocker_reason: entry.blocker_reason,
    failure_classification: 'visibility_failure',
    visibility_failure_kind: 'reviewed_locator_element_not_visible',
    distinct_from: {
      runtime_preflight_failure: false,
      locator_zero_match_failure: false,
      ambiguous_multi_match_failure: false,
      login_or_source_unavailable_blocker: false,
    },
    recommended_next_action: 'needs_visibility_repair_review',
    failed_phase: metadata.failed_phase ?? metadata.execution_phase ?? null,
    runner_type: metadata.runner_type ?? metadata.backend ?? null,
    match_count: metadata.match_count ?? null,
    expected_match_count: 1,
    target_context: targetContext(entry, plannedSlot, reviewedTarget),
    repaired_locator: cloneJson(objectValue(entry.reviewed_locator)),
    operator_outcome_notes: operatorOutcomeNotes(entry),
    prior_repair_provenance: {
      repaired_capture_slot: plannedSlot ? {
        failure_id: plannedSlot.failure_id,
        repair_item_id: plannedSlot.repair_item_id,
        repair_decision: plannedSlot.repair_decision,
        operator_repair_notes: plannedSlot.operator_repair_notes,
        failure_provenance: cloneJson(objectValue(plannedSlot.failure_provenance)),
        provenance: cloneJson(objectValue(plannedSlot.provenance)),
      } : null,
      locator_provenance: entry.locator_provenance ? cloneJson(entry.locator_provenance) : null,
      manifest_provenance: cloneJson(objectValue(entry.provenance)),
    },
    citation_source_metadata: entry.citation_source_metadata ? cloneJson(entry.citation_source_metadata) : null,
    capture_metadata: cloneJson(metadata),
    acceptance_checks: cloneJson(arrayValue(entry.acceptance_checks)),
    clip_path: entry.clip_path ?? null,
    text_extract_path: entry.text_extract_path ?? null,
    text_extract_content: entry.text_extract_content ?? null,
    full_page_grab: entry.full_page_grab === true,
  };
}

function contextItemFromEntry(entry) {
  return {
    slot_id: entry.slot_id ?? null,
    target_id: entry.target_id,
    work_unit_id: entry.work_unit_id,
    company: entry.company,
    company_role: entry.company_role,
    source_category: entry.source_category,
    original_url: entry.original_url,
    final_url: entry.final_url,
    status: entry.status,
    blocker_reason: entry.blocker_reason,
    required_next_action: entry.required_next_action ?? null,
    context_kind: entry.blocker_reason === 'source_unavailable' ? 'source_unavailable' : 'non_executable_context',
    actionable_visibility_failure: false,
    full_page_grab: entry.full_page_grab === true,
    provenance: cloneJson(objectValue(entry.provenance)),
  };
}

export function buildEmployerBrandRepairedCaptureVisibilityReviewPack(inputs = {}, {
  createdAt = null,
} = {}) {
  const manifest = objectValue(inputs.manifest);
  const entries = arrayValue(manifest.entries);
  const failedEntries = entries.filter((entry) => entry.status === 'failed');
  const visibilityFailures = failedEntries
    .filter((entry) => entry.blocker_reason === 'reviewed_locator_element_not_visible')
    .map((entry, index) => visibilityFailureFromEntry(entry, index, inputs));
  const nonExecutableContext = entries
    .filter((entry) => entry.status !== 'failed')
    .map(contextItemFromEntry);
  const linkedInSourceUnavailable = nonExecutableContext
    .filter((entry) => entry.context_kind === 'source_unavailable');

  return {
    type: EMPLOYER_BRAND_REPAIRED_CAPTURE_VISIBILITY_REVIEW_PACK_TYPE,
    schema_version: EMPLOYER_BRAND_REPAIRED_CAPTURE_VISIBILITY_REVIEW_PACK_SCHEMA_VERSION,
    id: 'live-evidence-repaired-capture-visibility-review-pack:symphony-talent-phenom-radancy',
    label: 'Employer Brand Repaired Capture Visibility Failure Review Pack',
    status: 'visibility_repair_review_required',
    source_refs: {
      manifest_path: DEFAULT_MANIFEST_PATH,
      repaired_locator_capture_plan_path: DEFAULT_CAPTURE_PLAN_PATH,
      capture_repair_promotion_path: DEFAULT_REPAIR_PROMOTION_PATH,
      capture_repair_patch_path: DEFAULT_REPAIR_PATCH_PATH,
      repaired_capture_runtime_diagnostics_path: DEFAULT_RUNTIME_DIAGNOSTICS_PATH,
      reviewed_target_plan_path: DEFAULT_REVIEWED_TARGET_PLAN_PATH,
      data_bundle_path: DEFAULT_DATA_BUNDLE_PATH,
      read_only: true,
    },
    summary: {
      attempted_repaired_slot_count: failedEntries.length + entries.filter((entry) => entry.status === 'captured').length,
      actionable_visibility_failure_count: visibilityFailures.length,
      accepted_capture_count: manifest.summary?.captured_slot_count ?? entries.filter((entry) => entry.status === 'captured').length,
      failed_slot_count: manifest.summary?.failed_slot_count ?? failedEntries.length,
      actual_clip_asset_count: entries.filter((entry) => entry.clip_path).length,
      actual_text_asset_count: entries.filter((entry) => entry.text_extract_path || entry.text_extract_content).length,
      linked_in_source_unavailable_count: linkedInSourceUnavailable.length,
      non_executable_context_count: nonExecutableContext.filter((entry) => entry.context_kind !== 'source_unavailable').length,
      full_page_grab_count: manifest.summary?.full_page_grab_count ?? entries.filter((entry) => entry.full_page_grab === true).length,
      runner_type_counts: groupCounts(visibilityFailures, 'runner_type'),
      failed_phase_counts: groupCounts(visibilityFailures, 'failed_phase'),
      blocker_reason_counts: groupCounts(failedEntries, 'blocker_reason'),
      match_count_counts: groupCounts(visibilityFailures, 'match_count'),
      runtime_preflight_failure_count: 0,
      zero_match_locator_failure_count: failedEntries.filter((entry) => entry.blocker_reason === 'reviewed_locator_matches_zero_elements').length,
      ambiguous_multi_match_failure_count: failedEntries.filter((entry) => (entry.capture_metadata?.match_count ?? 0) > 1).length,
      source_unavailable_blocker_count: linkedInSourceUnavailable.length,
    },
    visibility_failures: visibilityFailures,
    non_actionable_context: nonExecutableContext,
    invariants: {
      exactly_four_actionable_visibility_failures: visibilityFailures.length === 4,
      accepted_capture_count_zero: (manifest.summary?.captured_slot_count ?? 0) === 0,
      actual_clip_and_text_asset_count_zero: entries.every((entry) => entry.clip_path === null && entry.text_extract_path === null && entry.text_extract_content === null),
      full_page_grab_false: entries.every((entry) => entry.full_page_grab === false),
      linked_in_source_unavailable_preserved: linkedInSourceUnavailable.length === 1,
      visibility_failures_not_runtime_failures: visibilityFailures.every((failure) => failure.distinct_from.runtime_preflight_failure === false),
      visibility_failures_not_zero_match_failures: visibilityFailures.every((failure) => failure.match_count === 1),
      visibility_failures_failed_at_element_visibility_check: visibilityFailures.every((failure) => failure.failed_phase === 'element_visibility_check'),
    },
    controls: {
      read_only_review_pack: true,
      open_urls: false,
      run_browser_capture: false,
      run_locator_resolution: false,
      run_codegen: false,
      invent_selectors: false,
      invent_xpath: false,
      invent_playwright_locators: false,
      create_clips: false,
      extract_text: false,
      full_page_grab: false,
      bypass_login_or_access_controls: false,
    },
    provenance: {
      created_at: createdAt,
      deterministic_from_local_inputs: true,
      no_live_pages_inspected: true,
      no_capture_run: true,
      no_locator_resolution_or_codegen: true,
      no_replacement_evidence_invented: true,
      read_only: true,
    },
  };
}

export function normalizeEmployerBrandRepairedCaptureVisibilityReviewPack(input = {}) {
  const pack = objectValue(input);
  const visibilityFailures = arrayValue(pack.visibility_failures).map((failure) => ({
    ...cloneJson(objectValue(failure)),
    target_context: cloneJson(objectValue(failure.target_context)),
    repaired_locator: cloneJson(objectValue(failure.repaired_locator)),
    operator_outcome_notes: cloneJson(objectValue(failure.operator_outcome_notes)),
    prior_repair_provenance: cloneJson(objectValue(failure.prior_repair_provenance)),
    capture_metadata: cloneJson(objectValue(failure.capture_metadata)),
    acceptance_checks: cloneJson(arrayValue(failure.acceptance_checks)),
    full_page_grab: failure.full_page_grab === true,
  }));
  const nonActionableContext = arrayValue(pack.non_actionable_context).map((entry) => ({
    ...cloneJson(objectValue(entry)),
    actionable_visibility_failure: false,
    full_page_grab: entry.full_page_grab === true,
  }));
  return {
    ...cloneJson(pack),
    visibility_failures: visibilityFailures,
    non_actionable_context: nonActionableContext,
    summary: {
      ...cloneJson(objectValue(pack.summary)),
      actionable_visibility_failure_count: visibilityFailures.length,
      actual_clip_asset_count: visibilityFailures.filter((failure) => failure.clip_path).length,
      actual_text_asset_count: visibilityFailures.filter((failure) => failure.text_extract_path || failure.text_extract_content).length,
      linked_in_source_unavailable_count: nonActionableContext.filter((entry) => entry.context_kind === 'source_unavailable').length,
      non_executable_context_count: nonActionableContext.filter((entry) => entry.context_kind !== 'source_unavailable').length,
      full_page_grab_count: [
        ...visibilityFailures,
        ...nonActionableContext,
      ].filter((entry) => entry.full_page_grab === true).length,
      runner_type_counts: groupCounts(visibilityFailures, 'runner_type'),
      failed_phase_counts: groupCounts(visibilityFailures, 'failed_phase'),
      match_count_counts: groupCounts(visibilityFailures, 'match_count'),
    },
  };
}

export function validateEmployerBrandRepairedCaptureVisibilityReviewPack(input = {}) {
  const errors = [];
  const pack = normalizeEmployerBrandRepairedCaptureVisibilityReviewPack(input);
  if (pack.type !== EMPLOYER_BRAND_REPAIRED_CAPTURE_VISIBILITY_REVIEW_PACK_TYPE) errors.push('type must identify a repaired capture visibility review pack');
  if (pack.schema_version !== EMPLOYER_BRAND_REPAIRED_CAPTURE_VISIBILITY_REVIEW_PACK_SCHEMA_VERSION) errors.push('schema_version must be repaired capture visibility review pack v0');
  if (pack.status !== 'visibility_repair_review_required') errors.push('status must require visibility repair review');
  if (pack.source_refs?.read_only !== true) errors.push('source refs must be read-only');
  if (pack.summary.actionable_visibility_failure_count !== 4) errors.push('must classify exactly 4 actionable visibility failures');
  if (pack.summary.accepted_capture_count !== 0) errors.push('accepted capture count must remain 0');
  if (pack.summary.actual_clip_asset_count !== 0) errors.push('actual clip asset count must remain 0');
  if (pack.summary.actual_text_asset_count !== 0) errors.push('actual text asset count must remain 0');
  if (pack.summary.linked_in_source_unavailable_count !== 1) errors.push('LinkedIn source-unavailable context must be preserved once');
  if (pack.summary.non_executable_context_count !== 14) errors.push('14 other non-executable context entries must be preserved');
  if (pack.summary.full_page_grab_count !== 0) errors.push('full_page_grab must remain false for all entries');
  if (pack.visibility_failures.length !== 4) errors.push('visibility_failures must include 4 items');
  for (const failure of pack.visibility_failures) {
    if (failure.blocker_reason !== 'reviewed_locator_element_not_visible') errors.push(`${failure.slot_id} must be a reviewed locator visibility failure`);
    if (failure.failed_phase !== 'element_visibility_check') errors.push(`${failure.slot_id} must fail at element_visibility_check`);
    if (failure.match_count !== 1) errors.push(`${failure.slot_id} must preserve match_count=1`);
    if (failure.runner_type !== 'playwright_node_api') errors.push(`${failure.slot_id} must preserve playwright_node_api runner type`);
    if (failure.full_page_grab !== false) errors.push(`${failure.slot_id} full_page_grab must be false`);
    if (!text(failure.target_context?.original_natural_language_target)) errors.push(`${failure.slot_id} must preserve the original natural-language target`);
    if (!text(failure.target_context?.evidence_goal)) errors.push(`${failure.slot_id} must preserve the evidence goal`);
    if (!arrayValue(failure.target_context?.kilos_relevance).length) errors.push(`${failure.slot_id} must preserve KILOS relevance`);
    if (failure.target_context?.expected_clip_count < 1) errors.push(`${failure.slot_id} must preserve expected clip count`);
    if (!objectValue(failure.repaired_locator).selector && !objectValue(failure.repaired_locator).xpath && !objectValue(failure.repaired_locator).playwright_locator) errors.push(`${failure.slot_id} must preserve the repaired locator value`);
  }
  for (const entry of pack.non_actionable_context) {
    if (entry.actionable_visibility_failure !== false) errors.push(`${entry.target_id} context must remain non-actionable`);
    if (entry.full_page_grab !== false) errors.push(`${entry.target_id} context full_page_grab must be false`);
  }
  if (!Object.values(objectValue(pack.invariants)).every((value) => value === true)) errors.push('all visibility review invariants must pass');
  for (const [key, value] of Object.entries(objectValue(pack.controls))) {
    if (key === 'read_only_review_pack') {
      if (value !== true) errors.push('controls.read_only_review_pack must be true');
    } else if (value !== false) {
      errors.push(`controls.${key} must remain false`);
    }
  }
  return { valid: errors.length === 0, errors };
}

export function loadEmployerBrandRepairedCaptureVisibilityReviewPackInputs({
  fixtureRoot = DEFAULT_FIXTURE_ROOT,
} = {}) {
  return {
    manifest: loadJson(fixtureRoot, DEFAULT_MANIFEST_PATH),
    repairedLocatorCapturePlan: loadJson(fixtureRoot, DEFAULT_CAPTURE_PLAN_PATH),
    captureRepairPromotion: loadJson(fixtureRoot, DEFAULT_REPAIR_PROMOTION_PATH),
    captureRepairPatch: loadJson(fixtureRoot, DEFAULT_REPAIR_PATCH_PATH),
    repairedCaptureRuntimeDiagnostics: loadJson(fixtureRoot, DEFAULT_RUNTIME_DIAGNOSTICS_PATH),
    reviewedTargetPlan: loadJson(fixtureRoot, DEFAULT_REVIEWED_TARGET_PLAN_PATH),
    dataBundle: loadJson(fixtureRoot, DEFAULT_DATA_BUNDLE_PATH),
  };
}

export function loadEmployerBrandRepairedCaptureVisibilityReviewPack({ fixtureRoot = DEFAULT_FIXTURE_ROOT } = {}) {
  return loadJson(fixtureRoot, 'live-evidence-repaired-capture-visibility-review-pack.json');
}

export function writeEmployerBrandRepairedCaptureVisibilityReviewPack(reviewPack, {
  fixtureRoot = DEFAULT_FIXTURE_ROOT,
  outPath = 'live-evidence-repaired-capture-visibility-review-pack.json',
} = {}) {
  const outputPath = path.isAbsolute(outPath) ? outPath : path.join(fixtureRoot, outPath);
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, `${JSON.stringify(reviewPack, null, 2)}\n`);
  return outputPath;
}
