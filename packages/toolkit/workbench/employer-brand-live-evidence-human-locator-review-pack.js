import fs from 'node:fs';
import path from 'node:path';
import {
  normalizeEmployerBrandLiveEvidenceLocatorReadiness,
  validateEmployerBrandLiveEvidenceLocatorReadiness,
} from './employer-brand-live-evidence-locator-readiness.js';
import {
  normalizeEmployerBrandLiveEvidenceLocatorResolutionResult,
  validateEmployerBrandLiveEvidenceLocatorResolutionResult,
} from './employer-brand-live-evidence-locator-resolution-result.js';
import {
  normalizeEmployerBrandLiveEvidenceSupervisedLocatorPlan,
  validateEmployerBrandLiveEvidenceSupervisedLocatorPlan,
} from './employer-brand-live-evidence-supervised-locator-plan.js';
import {
  normalizeEmployerBrandLiveEvidenceTargetPlan,
  validateEmployerBrandLiveEvidenceTargetPlan,
} from './employer-brand-live-evidence-target-plan.js';

export const EMPLOYER_BRAND_LIVE_EVIDENCE_HUMAN_LOCATOR_REVIEW_PACK_TYPE =
  'aos.employer_brand_live_evidence_human_locator_review_pack';
export const EMPLOYER_BRAND_LIVE_EVIDENCE_HUMAN_LOCATOR_REVIEW_PACK_SCHEMA_VERSION =
  '2026-05-employer-brand-live-evidence-human-locator-review-pack-v0';
export const EMPLOYER_BRAND_LIVE_EVIDENCE_HUMAN_LOCATOR_PATCH_TYPE =
  'aos.employer_brand_live_evidence_human_locator_patch';
export const EMPLOYER_BRAND_LIVE_EVIDENCE_HUMAN_LOCATOR_PATCH_SCHEMA_VERSION =
  '2026-05-employer-brand-live-evidence-human-locator-patch-v0';

const KILOS_DIMENSIONS = ['kinship', 'impact', 'lifestyle', 'opportunity', 'status'];
const HUMAN_DECISIONS = [
  'approve_selector',
  'edit_selector',
  'provide_xpath',
  'provide_playwright_locator',
  'refine_natural_language_target',
  'mark_blocked',
  'keep_draft',
  'reject_target',
];
const NULL_LOCATORS = {
  selector: null,
  xpath: null,
  playwright_locator: null,
};
const NON_GOAL_FLAGS = {
  locator_execution: false,
  codegen_execution: false,
  url_opening: false,
  screenshot_capture: false,
  element_clip_generation: false,
  capture_execution: false,
  report_rendering: false,
  export_execution: false,
  workflow_engine: false,
  full_page_grabs: false,
  autonomous_crawling: false,
  bypasses: false,
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

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function statusCounts(items, key) {
  return items.reduce((counts, item) => {
    const value = item[key] ?? null;
    const countKey = value === null ? 'null' : value;
    counts[countKey] = (counts[countKey] || 0) + 1;
    return counts;
  }, {});
}

function mapBy(items, key) {
  return new Map(arrayValue(items).map((item) => [item[key], item]));
}

function locatorCandidates(candidates) {
  return arrayValue(candidates).map((candidate) => ({
    selector: candidate.selector ?? null,
    xpath: candidate.xpath ?? null,
    playwright_locator: candidate.playwright_locator ?? null,
    selector_type: text(candidate.selector_type, 'unconfirmed_metadata_only'),
    confidence: candidate.confidence ?? null,
    rationale: optionalText(candidate.rationale),
    provenance: optionalText(candidate.provenance),
    metadata_only: true,
  }));
}

function itemFromSources({ reason, targetId, result, readiness, workUnit, reviewedTarget }) {
  const ambiguityReason = result?.blocker_reason
    || arrayValue(readiness?.blockers).join('; ')
    || arrayValue(workUnit?.blockers).join('; ')
    || 'needs_human_review';
  const finalUrl = result?.final_url ?? null;
  const url = result?.original_url || workUnit?.url || readiness?.url || reviewedTarget?.url;
  return {
    review_item_id: `human-locator-review-item:${targetId.replace(/^live-target:/, '')}`,
    target_id: requireText(targetId, 'target_id'),
    work_unit_id: requireText(result?.work_unit_id || workUnit?.work_unit_id, 'work_unit_id'),
    company: requireText(result?.company || workUnit?.company || readiness?.company || reviewedTarget?.company, 'company'),
    company_role: requireText(workUnit?.company_role || reviewedTarget?.company_role || 'unknown', 'company_role'),
    source_category: requireText(result?.source_category || workUnit?.source_category || readiness?.source_category || reviewedTarget?.source_category, 'source_category'),
    url: requireText(url, 'url'),
    final_url: finalUrl,
    page_name: requireText(workUnit?.page_name || reviewedTarget?.page_name || readiness?.source_category, 'page_name'),
    desired_element: requireText(workUnit?.desired_element || readiness?.desired_element_summary || reviewedTarget?.target_element, 'desired_element'),
    evidence_goal: requireText(workUnit?.evidence_goal || reviewedTarget?.evidence_goal, 'evidence_goal'),
    kilos_relevance: cloneJson(arrayValue(workUnit?.kilos_relevance || readiness?.kilos_relevance || reviewedTarget?.kilos_relevance)),
    capture_type: requireText(workUnit?.capture_type || readiness?.capture_type || reviewedTarget?.capture_type, 'capture_type'),
    expected_clip_count: Number(workUnit?.expected_clip_count ?? readiness?.expected_clip_count ?? reviewedTarget?.expected_clip_count ?? 0),
    acceptance_criteria: cloneJson(arrayValue(workUnit?.acceptance_criteria || reviewedTarget?.acceptance_criteria)),
    review_source: reason,
    resolution_status: result?.resolution_status || null,
    readiness_state: readiness?.readiness_state || null,
    url_open_status: result?.url_open_status || readiness?.url_reachability || null,
    ambiguity_or_blocker_reason: requireText(ambiguityReason, 'ambiguity_or_blocker_reason'),
    unconfirmed_selector_candidates: locatorCandidates(result?.selector_candidates),
    human_locator: cloneJson(NULL_LOCATORS),
    locator_ready: false,
    required_human_decision: {
      status: 'pending',
      allowed_decisions: cloneJson(HUMAN_DECISIONS),
      selected_decision: null,
      human_notes: null,
    },
    non_goal_flags: cloneJson(NON_GOAL_FLAGS),
    provenance: {
      source_locator_resolution_result_id: result?.result_id || null,
      source_locator_readiness_target: readiness ? targetId : null,
      source_supervised_locator_work_unit_id: workUnit?.work_unit_id || result?.work_unit_id || null,
      metadata_only: true,
      read_only_planning_evidence: true,
    },
  };
}

function groupReviewItems(items) {
  const groups = new Map();
  for (const item of items) {
    if (!groups.has(item.company)) {
      groups.set(item.company, {
        company: item.company,
        company_role: item.company_role,
        review_item_count: 0,
        expected_clip_count: 0,
        source_categories: new Map(),
      });
    }
    const companyGroup = groups.get(item.company);
    companyGroup.review_item_count += 1;
    companyGroup.expected_clip_count += item.expected_clip_count;
    if (!companyGroup.source_categories.has(item.source_category)) {
      companyGroup.source_categories.set(item.source_category, {
        source_category: item.source_category,
        review_item_count: 0,
        expected_clip_count: 0,
        review_items: [],
      });
    }
    const sourceGroup = companyGroup.source_categories.get(item.source_category);
    sourceGroup.review_item_count += 1;
    sourceGroup.expected_clip_count += item.expected_clip_count;
    sourceGroup.review_items.push(item);
  }
  return [...groups.values()].map((group) => ({
    ...group,
    source_categories: [...group.source_categories.values()],
  }));
}

export function buildEmployerBrandLiveEvidenceHumanLocatorReviewPack({
  locatorResolutionResult,
  locatorReadiness,
  supervisedLocatorPlan,
  reviewedTargetPlan,
  createdAt = null,
} = {}) {
  for (const [label, input, validator] of [
    ['locator resolution result', locatorResolutionResult, validateEmployerBrandLiveEvidenceLocatorResolutionResult],
    ['locator readiness', locatorReadiness, validateEmployerBrandLiveEvidenceLocatorReadiness],
    ['supervised locator plan', supervisedLocatorPlan, validateEmployerBrandLiveEvidenceSupervisedLocatorPlan],
    ['reviewed target plan', reviewedTargetPlan, validateEmployerBrandLiveEvidenceTargetPlan],
  ]) {
    const validation = validator(input);
    if (!validation.valid) throw new Error(`${label} validation failed: ${validation.errors.join('; ')}`);
  }

  const resolution = normalizeEmployerBrandLiveEvidenceLocatorResolutionResult(locatorResolutionResult);
  const readiness = normalizeEmployerBrandLiveEvidenceLocatorReadiness(locatorReadiness);
  const locatorPlan = normalizeEmployerBrandLiveEvidenceSupervisedLocatorPlan(supervisedLocatorPlan);
  const targetPlan = normalizeEmployerBrandLiveEvidenceTargetPlan(reviewedTargetPlan);
  const resultsByTarget = mapBy(resolution.results, 'target_id');
  const readinessByTarget = mapBy(readiness.targets, 'target_id');
  const workUnitsByTarget = mapBy(locatorPlan.work_units, 'target_id');
  const targetsById = mapBy(targetPlan.targets, 'target_id');
  const reviewTargetIds = unique([
    ...resolution.results
      .filter((result) => result.attempted === true && result.resolution_status === 'ambiguous')
      .map((result) => result.target_id),
    ...readiness.targets
      .filter((target) => target.readiness_state === 'needs_human_target_review')
      .map((target) => target.target_id),
  ]);
  const reviewItems = reviewTargetIds.map((targetId) => itemFromSources({
    reason: resultsByTarget.get(targetId)?.resolution_status === 'ambiguous'
      ? 'ambiguous_locator_attempt'
      : 'needs_human_target_review',
    targetId,
    result: resultsByTarget.get(targetId),
    readiness: readinessByTarget.get(targetId),
    workUnit: workUnitsByTarget.get(targetId),
    reviewedTarget: targetsById.get(targetId),
  }));
  const ambiguousCount = reviewItems.filter((item) => item.review_source === 'ambiguous_locator_attempt').length;
  const humanTargetReviewCount = reviewItems.filter((item) => item.review_source === 'needs_human_target_review').length;

  return {
    type: EMPLOYER_BRAND_LIVE_EVIDENCE_HUMAN_LOCATOR_REVIEW_PACK_TYPE,
    schema_version: EMPLOYER_BRAND_LIVE_EVIDENCE_HUMAN_LOCATOR_REVIEW_PACK_SCHEMA_VERSION,
    id: resolution.id.replace('live-evidence-locator-resolution-result:', 'live-evidence-human-locator-review-pack:'),
    label: `${resolution.label.replace(/ Live Evidence Locator Resolution Result$/, '')} Human Locator Review Pack`,
    status: 'human_locator_review_required',
    source_refs: {
      locator_resolution_result_path: 'live-evidence-locator-resolution-result.json',
      locator_readiness_path: 'live-evidence-locator-readiness.json',
      supervised_locator_plan_path: 'live-evidence-supervised-locator-plan.json',
      reviewed_target_plan_path: 'live-evidence-target-plan.reviewed.json',
      url_open_run_path: 'live-evidence-url-open-run.json',
      read_only_planning_evidence: true,
    },
    summary: {
      review_item_count: reviewItems.length,
      ambiguous_locator_attempt_count: ambiguousCount,
      needs_human_target_review_count: humanTargetReviewCount,
      locator_ready_count: 0,
      expected_clip_count: reviewItems.reduce((count, item) => count + item.expected_clip_count, 0),
      source_counts: statusCounts(reviewItems, 'review_source'),
      decision_status_counts: statusCounts(reviewItems.map((item) => item.required_human_decision), 'status'),
      unconfirmed_candidate_count: reviewItems.reduce((count, item) => count + item.unconfirmed_selector_candidates.length, 0),
    },
    groups: groupReviewItems(reviewItems),
    excluded_context: {
      blocked_result_count: resolution.summary.blocked_count,
      rejected_exclusion_count: resolution.summary.rejected_exclusion_count,
      hard_blocked_targets_outside_queue: resolution.results
        .filter((result) => result.resolution_status === 'blocked' && !reviewTargetIds.includes(result.target_id))
        .map((result) => ({
          target_id: result.target_id,
          work_unit_id: result.work_unit_id,
          company: result.company,
          source_category: result.source_category,
          blocker_reason: result.blocker_reason,
        })),
      rejected_exclusions: cloneJson(arrayValue(resolution.rejected_exclusions)),
    },
    controls: cloneJson(NON_GOAL_FLAGS),
    provenance: {
      created_at: createdAt,
      read_only: true,
      planning_metadata_only: true,
      no_locator_execution: true,
      no_codegen_execution: true,
      no_url_opening: true,
      no_screenshots: true,
      no_element_clips: true,
      no_capture_execution: true,
      no_report_renderer: true,
      no_export_work: true,
      no_workflow_engine: true,
      no_full_page_grabs: true,
      no_autonomous_crawling_or_bypasses: true,
      only_human_approved_locators_become_ready: true,
    },
  };
}

export function normalizeEmployerBrandLiveEvidenceHumanLocatorReviewPack(packInput = {}) {
  const pack = objectValue(packInput);
  const groups = arrayValue(pack.groups).map((companyInput) => {
    const company = objectValue(companyInput);
    const sourceCategories = arrayValue(company.source_categories).map((sourceInput) => {
      const source = objectValue(sourceInput);
      const reviewItems = arrayValue(source.review_items).map((itemInput) => {
        const item = objectValue(itemInput);
        return {
          ...cloneJson(item),
          target_id: requireText(item.target_id, 'target_id'),
          work_unit_id: requireText(item.work_unit_id, 'work_unit_id'),
          company: requireText(item.company, 'company'),
          source_category: requireText(item.source_category, 'source_category'),
          url: requireText(item.url, 'url'),
          final_url: item.final_url ?? null,
          page_name: requireText(item.page_name, 'page_name'),
          desired_element: requireText(item.desired_element, 'desired_element'),
          evidence_goal: requireText(item.evidence_goal, 'evidence_goal'),
          kilos_relevance: cloneJson(arrayValue(item.kilos_relevance)),
          capture_type: requireText(item.capture_type, 'capture_type'),
          expected_clip_count: Number(item.expected_clip_count ?? 0),
          acceptance_criteria: cloneJson(arrayValue(item.acceptance_criteria)),
          ambiguity_or_blocker_reason: requireText(item.ambiguity_or_blocker_reason, 'ambiguity_or_blocker_reason'),
          unconfirmed_selector_candidates: locatorCandidates(item.unconfirmed_selector_candidates),
          human_locator: { ...cloneJson(NULL_LOCATORS), ...cloneJson(objectValue(item.human_locator)) },
          locator_ready: item.locator_ready === true,
          required_human_decision: {
            status: text(item.required_human_decision?.status, 'pending'),
            allowed_decisions: cloneJson(arrayValue(item.required_human_decision?.allowed_decisions).length ? item.required_human_decision.allowed_decisions : HUMAN_DECISIONS),
            selected_decision: optionalText(item.required_human_decision?.selected_decision),
            human_notes: optionalText(item.required_human_decision?.human_notes),
          },
          non_goal_flags: { ...cloneJson(NON_GOAL_FLAGS), ...cloneJson(objectValue(item.non_goal_flags)) },
        };
      });
      return {
        source_category: requireText(source.source_category, 'source_category'),
        review_item_count: Number(source.review_item_count ?? reviewItems.length),
        expected_clip_count: Number(source.expected_clip_count ?? reviewItems.reduce((count, item) => count + item.expected_clip_count, 0)),
        review_items: reviewItems,
      };
    });
    const items = sourceCategories.flatMap((source) => source.review_items);
    return {
      company: requireText(company.company, 'company'),
      company_role: requireText(company.company_role, 'company_role'),
      review_item_count: Number(company.review_item_count ?? items.length),
      expected_clip_count: Number(company.expected_clip_count ?? items.reduce((count, item) => count + item.expected_clip_count, 0)),
      source_categories: sourceCategories,
    };
  });
  const reviewItems = groups.flatMap((group) => group.source_categories.flatMap((source) => source.review_items));
  return {
    ...cloneJson(pack),
    groups,
    review_items: reviewItems,
    summary: {
      review_item_count: reviewItems.length,
      ambiguous_locator_attempt_count: reviewItems.filter((item) => item.review_source === 'ambiguous_locator_attempt').length,
      needs_human_target_review_count: reviewItems.filter((item) => item.review_source === 'needs_human_target_review').length,
      locator_ready_count: reviewItems.filter((item) => item.locator_ready).length,
      expected_clip_count: reviewItems.reduce((count, item) => count + item.expected_clip_count, 0),
      source_counts: statusCounts(reviewItems, 'review_source'),
      decision_status_counts: statusCounts(reviewItems.map((item) => item.required_human_decision), 'status'),
      unconfirmed_candidate_count: reviewItems.reduce((count, item) => count + item.unconfirmed_selector_candidates.length, 0),
    },
  };
}

export function validateEmployerBrandLiveEvidenceHumanLocatorReviewPack(packInput = {}) {
  const errors = [];
  const pack = objectValue(packInput);
  const normalized = normalizeEmployerBrandLiveEvidenceHumanLocatorReviewPack(pack);
  if (pack.type !== EMPLOYER_BRAND_LIVE_EVIDENCE_HUMAN_LOCATOR_REVIEW_PACK_TYPE) errors.push('type must identify a Human Locator Review Pack');
  if (pack.schema_version !== EMPLOYER_BRAND_LIVE_EVIDENCE_HUMAN_LOCATOR_REVIEW_PACK_SCHEMA_VERSION) errors.push('schema_version must be v0');
  if (normalized.review_items.length < 1) errors.push('review_items must not be empty');
  if (normalized.summary.locator_ready_count !== 0) errors.push('locator_ready_count must remain 0 before human locator patch approval');
  for (const [key, value] of Object.entries(objectValue(pack.controls))) {
    if (value !== false) errors.push(`controls.${key} must remain false`);
  }
  for (const item of normalized.review_items) {
    if (!item.kilos_relevance.every((dimension) => KILOS_DIMENSIONS.includes(dimension))) errors.push(`${item.target_id} has invalid KILOS relevance`);
    if (!item.required_human_decision.allowed_decisions.every((decision) => HUMAN_DECISIONS.includes(decision))) errors.push(`${item.target_id} has invalid allowed decision`);
    if (item.required_human_decision.selected_decision !== null) errors.push(`${item.target_id} selected_decision must remain null in the review pack`);
    if (item.locator_ready !== false) errors.push(`${item.target_id} locator_ready must remain false`);
    for (const [key, value] of Object.entries(item.human_locator)) {
      if (value !== null) errors.push(`${item.target_id} human_locator.${key} must remain null in the review pack`);
    }
    for (const candidate of item.unconfirmed_selector_candidates) {
      if (candidate.metadata_only !== true) errors.push(`${item.target_id} candidate must be metadata_only`);
      if (candidate.selector_type !== 'unconfirmed_metadata_only') errors.push(`${item.target_id} candidate selector_type must be unconfirmed_metadata_only`);
    }
    for (const [key, value] of Object.entries(item.non_goal_flags)) {
      if (value !== false) errors.push(`${item.target_id} non_goal_flags.${key} must remain false`);
    }
  }
  return { valid: errors.length === 0, errors };
}

export function validateEmployerBrandLiveEvidenceHumanLocatorPatch(patchInput = {}, reviewPackInput = null) {
  const errors = [];
  const patch = objectValue(patchInput);
  const reviewPack = reviewPackInput ? normalizeEmployerBrandLiveEvidenceHumanLocatorReviewPack(reviewPackInput) : null;
  const reviewItemsById = reviewPack ? mapBy(reviewPack.review_items, 'target_id') : new Map();
  const decisions = arrayValue(patch.decisions).map(objectValue);
  if (patch.type !== EMPLOYER_BRAND_LIVE_EVIDENCE_HUMAN_LOCATOR_PATCH_TYPE) errors.push('type must identify a Human Locator Patch');
  if (patch.schema_version !== EMPLOYER_BRAND_LIVE_EVIDENCE_HUMAN_LOCATOR_PATCH_SCHEMA_VERSION) errors.push('schema_version must be v0');
  if (!text(patch.id)) errors.push('id is required');
  if (!text(patch.review_pack_ref?.review_pack_id)) errors.push('review_pack_ref.review_pack_id is required');
  if (patch.review_pack_ref?.review_pack_path !== 'live-evidence-human-locator-review-pack.json') errors.push('review_pack_ref.review_pack_path must reference live-evidence-human-locator-review-pack.json');
  if (decisions.length < 1) errors.push('decisions must include at least one human locator decision');

  const seen = new Set();
  for (const decision of decisions) {
    const targetId = text(decision.target_id);
    const action = text(decision.decision);
    if (!targetId) errors.push('decision.target_id is required');
    if (seen.has(targetId)) errors.push(`${targetId} has duplicate decisions`);
    seen.add(targetId);
    if (reviewPack && !reviewItemsById.has(targetId)) errors.push(`${targetId} is not in the review pack`);
    if (!HUMAN_DECISIONS.includes(action)) errors.push(`${targetId} decision is invalid`);
    const locator = objectValue(decision.locator);
    if (['approve_selector', 'edit_selector'].includes(action) && !text(locator.selector)) errors.push(`${targetId} selector approval requires a non-empty selector`);
    if (action === 'provide_xpath' && !text(locator.xpath)) errors.push(`${targetId} XPath approval requires a non-empty xpath`);
    if (action === 'provide_playwright_locator' && !text(locator.playwright_locator)) errors.push(`${targetId} Playwright approval requires a non-empty playwright_locator`);
    if (action === 'refine_natural_language_target' && !text(decision.refined_desired_element)) errors.push(`${targetId} refined desired element is required`);
    if (action === 'mark_blocked' && !text(decision.blocker_reason)) errors.push(`${targetId} blocker_reason is required`);
    if (['keep_draft', 'reject_target'].includes(action) && (text(locator.selector) || text(locator.xpath) || text(locator.playwright_locator))) {
      errors.push(`${targetId} ${action} must not include locator fields`);
    }
  }
  for (const [key, value] of Object.entries(objectValue(patch.controls))) {
    if (value !== false) errors.push(`controls.${key} must remain false`);
  }
  return { valid: errors.length === 0, errors };
}

export function loadEmployerBrandLiveEvidenceHumanLocatorReviewPack({ fixtureRoot } = {}) {
  if (!fixtureRoot) throw new Error('fixtureRoot is required');
  return JSON.parse(fs.readFileSync(path.join(fixtureRoot, 'live-evidence-human-locator-review-pack.json'), 'utf8'));
}
