import fs from 'node:fs';
import path from 'node:path';
import {
  normalizeEmployerBrandLiveEvidenceHumanLocatorReviewPack,
  validateEmployerBrandLiveEvidenceHumanLocatorReviewPack,
} from './employer-brand-live-evidence-human-locator-review-pack.js';
import {
  normalizeEmployerBrandLiveEvidenceLocatorReadiness,
  validateEmployerBrandLiveEvidenceLocatorReadiness,
} from './employer-brand-live-evidence-locator-readiness.js';

export const EMPLOYER_BRAND_LIVE_EVIDENCE_HUMAN_LOCATOR_APPROVAL_PATCH_TYPE =
  'aos.employer_brand_live_evidence_human_locator_approval_patch';
export const EMPLOYER_BRAND_LIVE_EVIDENCE_HUMAN_LOCATOR_APPROVAL_PATCH_SCHEMA_VERSION =
  '2026-05-employer-brand-live-evidence-human-locator-approval-patch-v0';

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
const READY_DECISIONS = [
  'approve_selector',
  'edit_selector',
  'provide_xpath',
  'provide_playwright_locator',
];
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
const NULL_LOCATORS = {
  selector: null,
  xpath: null,
  playwright_locator: null,
  codegen_hint: null,
  crawl_discovery_notes: null,
  capture_script_slot: null,
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

function reviewItemsByTargetId(reviewPack) {
  return new Map(normalizeEmployerBrandLiveEvidenceHumanLocatorReviewPack(reviewPack).review_items.map((item) => [item.target_id, item]));
}

function normalizeLocator(locatorInput = {}) {
  const locator = objectValue(locatorInput);
  return {
    selector: optionalText(locator.selector),
    xpath: optionalText(locator.xpath),
    playwright_locator: optionalText(locator.playwright_locator),
  };
}

function locatorValueForDecision(decision, locator) {
  if (['approve_selector', 'edit_selector'].includes(decision)) return text(locator.selector);
  if (decision === 'provide_xpath') return text(locator.xpath);
  if (decision === 'provide_playwright_locator') return text(locator.playwright_locator);
  return '';
}

function normalizeDecision(input) {
  const decision = objectValue(input);
  return {
    review_item_id: requireText(decision.review_item_id, 'review_item_id'),
    target_id: requireText(decision.target_id, 'target_id'),
    work_unit_id: requireText(decision.work_unit_id, 'work_unit_id'),
    decision: requireText(decision.decision, 'decision'),
    locator: normalizeLocator(decision.locator),
    refined_desired_element: optionalText(decision.refined_desired_element),
    blocker_reason: optionalText(decision.blocker_reason),
    human_notes: optionalText(decision.human_notes),
  };
}

export function validateEmployerBrandLiveEvidenceHumanLocatorApprovalPatch(patchInput = {}, reviewPackInput = null) {
  const errors = [];
  const patch = objectValue(patchInput);
  const reviewPack = reviewPackInput ? normalizeEmployerBrandLiveEvidenceHumanLocatorReviewPack(reviewPackInput) : null;
  const reviewPackValidation = reviewPackInput ? validateEmployerBrandLiveEvidenceHumanLocatorReviewPack(reviewPackInput) : { valid: true, errors: [] };
  if (!reviewPackValidation.valid) errors.push(`review pack invalid: ${reviewPackValidation.errors.join('; ')}`);
  const itemsByTarget = reviewPack ? reviewItemsByTargetId(reviewPack) : new Map();
  let decisions = [];
  try {
    decisions = arrayValue(patch.decisions).map(normalizeDecision);
  } catch (caught) {
    errors.push(caught.message);
  }

  if (patch.type !== EMPLOYER_BRAND_LIVE_EVIDENCE_HUMAN_LOCATOR_APPROVAL_PATCH_TYPE) errors.push('type must identify a Human Locator Approval Patch');
  if (patch.schema_version !== EMPLOYER_BRAND_LIVE_EVIDENCE_HUMAN_LOCATOR_APPROVAL_PATCH_SCHEMA_VERSION) errors.push('schema_version must be human locator approval patch v0');
  if (!text(patch.id)) errors.push('id is required');
  if (!text(patch.review_pack_ref?.review_pack_id)) errors.push('review_pack_ref.review_pack_id is required');
  if (patch.review_pack_ref?.review_pack_path !== 'live-evidence-human-locator-review-pack.json') errors.push('review_pack_ref.review_pack_path must reference live-evidence-human-locator-review-pack.json');
  if (reviewPack && patch.review_pack_ref?.review_pack_id !== reviewPack.id) errors.push('review_pack_ref.review_pack_id must match the review pack id');
  if (decisions.length < 1) errors.push('decisions must include at least one human locator decision');

  const seen = new Set();
  for (const decision of decisions) {
    if (seen.has(decision.target_id)) errors.push(`${decision.target_id} has duplicate decisions`);
    seen.add(decision.target_id);
    if (!HUMAN_DECISIONS.includes(decision.decision)) errors.push(`${decision.target_id} decision is invalid`);
    const reviewItem = itemsByTarget.get(decision.target_id);
    if (reviewPack && !reviewItem) {
      errors.push(`${decision.target_id} is not in the review pack`);
    } else if (reviewItem) {
      if (decision.review_item_id !== reviewItem.review_item_id) errors.push(`${decision.target_id} review_item_id does not match review pack`);
      if (decision.work_unit_id !== reviewItem.work_unit_id) errors.push(`${decision.target_id} work_unit_id does not match review pack`);
    }
    if (READY_DECISIONS.includes(decision.decision) && !locatorValueForDecision(decision.decision, decision.locator)) {
      errors.push(`${decision.target_id} ${decision.decision} requires a non-empty reviewed locator value`);
    }
    if (decision.decision === 'refine_natural_language_target' && !decision.refined_desired_element) errors.push(`${decision.target_id} refined_desired_element is required`);
    if (decision.decision === 'mark_blocked' && !decision.blocker_reason) errors.push(`${decision.target_id} blocker_reason is required`);
    if (['keep_draft', 'reject_target', 'refine_natural_language_target', 'mark_blocked'].includes(decision.decision)
      && (text(decision.locator.selector) || text(decision.locator.xpath) || text(decision.locator.playwright_locator))) {
      errors.push(`${decision.target_id} ${decision.decision} must not include locator fields`);
    }
  }
  for (const key of Object.keys(NON_GOAL_FLAGS)) {
    if (patch.controls?.[key] !== false) errors.push(`controls.${key} must remain false`);
  }
  return { valid: errors.length === 0, errors };
}

function applyDecisionToTarget(target, decision, reviewItem, patch) {
  const next = cloneJson(target);
  next.locator_placeholders = { ...cloneJson(NULL_LOCATORS), ...cloneJson(objectValue(next.locator_placeholders)) };
  next.provenance = {
    ...cloneJson(objectValue(next.provenance)),
    source_human_locator_review_pack_path: 'live-evidence-human-locator-review-pack.json',
    source_human_locator_approval_patch_path: 'live-evidence-human-locator-approval-patch.json',
    source_human_locator_approval_patch_id: patch.id,
    human_locator_decision: decision.decision,
    human_locator_review_item_id: decision.review_item_id,
    human_locator_work_unit_id: decision.work_unit_id,
    planning_metadata_only: true,
    read_only: true,
  };
  if (decision.decision === 'refine_natural_language_target') {
    next.desired_element_summary = decision.refined_desired_element;
    next.readiness_state = 'needs_locator';
    next.blockers = ['locator_placeholders_unresolved'];
    next.required_next_action = 'Use the refined human target text in a later supervised locator pass.';
  } else if (decision.decision === 'mark_blocked') {
    next.readiness_state = 'not_checked';
    next.blockers = ['human_locator_blocked'];
    next.required_next_action = decision.blocker_reason;
  } else if (decision.decision === 'keep_draft') {
    next.readiness_state = 'needs_human_target_review';
    next.blockers = ['human_locator_kept_draft'];
    next.required_next_action = 'Keep this target in draft until a human supplies a locator or revised target.';
  } else if (READY_DECISIONS.includes(decision.decision)) {
    next.locator_placeholders.selector = decision.locator.selector;
    next.locator_placeholders.xpath = decision.locator.xpath;
    next.locator_placeholders.playwright_locator = decision.locator.playwright_locator;
    next.readiness_state = 'locator_ready';
    next.blockers = [];
    next.required_next_action = 'Ready for a later supervised capture plan; no locator execution has been performed.';
  }
  next.human_locator_review = {
    review_item_id: reviewItem.review_item_id,
    work_unit_id: reviewItem.work_unit_id,
    decision: decision.decision,
    human_notes: decision.human_notes,
  };
  return next;
}

export function applyEmployerBrandLiveEvidenceHumanLocatorApprovalPatch(locatorReadinessInput, patchInput, {
  reviewPackInput,
  derivedAt = null,
} = {}) {
  const readinessValidation = validateEmployerBrandLiveEvidenceLocatorReadiness(locatorReadinessInput);
  if (!readinessValidation.valid) throw new Error(`Locator readiness validation failed: ${readinessValidation.errors.join('; ')}`);
  const reviewPackValidation = validateEmployerBrandLiveEvidenceHumanLocatorReviewPack(reviewPackInput);
  if (!reviewPackValidation.valid) throw new Error(`Human locator review pack validation failed: ${reviewPackValidation.errors.join('; ')}`);
  const patchValidation = validateEmployerBrandLiveEvidenceHumanLocatorApprovalPatch(patchInput, reviewPackInput);
  if (!patchValidation.valid) throw new Error(`Human locator approval patch validation failed: ${patchValidation.errors.join('; ')}`);

  const readiness = normalizeEmployerBrandLiveEvidenceLocatorReadiness(locatorReadinessInput);
  const reviewPack = normalizeEmployerBrandLiveEvidenceHumanLocatorReviewPack(reviewPackInput);
  const patch = objectValue(patchInput);
  const itemsByTarget = reviewItemsByTargetId(reviewPack);
  const decisions = arrayValue(patch.decisions).map(normalizeDecision);
  const decisionsByTarget = new Map(decisions.map((decision) => [decision.target_id, decision]));
  const rejected = new Set(decisions.filter((decision) => decision.decision === 'reject_target').map((decision) => decision.target_id));
  const targets = readiness.targets
    .filter((target) => !rejected.has(target.target_id))
    .map((target) => {
      const decision = decisionsByTarget.get(target.target_id);
      if (!decision) return cloneJson(target);
      return applyDecisionToTarget(target, decision, itemsByTarget.get(target.target_id), patch);
    });

  const locatorReadyCount = targets.filter((target) => target.readiness_state === 'locator_ready').length;
  const blockedCount = targets.filter((target) => target.blockers.includes('human_locator_blocked')).length;
  const needsHumanLocatorReviewCount = reviewPack.review_items.length - decisions.length;
  const expectedReadyClipCount = targets
    .filter((target) => target.readiness_state === 'locator_ready')
    .reduce((count, target) => count + Number(target.expected_clip_count || 0), 0);
  const derived = normalizeEmployerBrandLiveEvidenceLocatorReadiness({
    ...cloneJson(readiness),
    id: readiness.id.replace('live-evidence-locator-readiness:', 'live-evidence-locator-readiness-reviewed:'),
    label: `${readiness.label} - Human Locator Approved`,
    status: locatorReadyCount > 0 && needsHumanLocatorReviewCount === 0 ? 'locator_ready' : 'needs_locator',
    source_refs: {
      ...cloneJson(readiness.source_refs),
      human_locator_review_pack_id: reviewPack.id,
      human_locator_review_pack_path: 'live-evidence-human-locator-review-pack.json',
      human_locator_approval_patch_id: patch.id,
      human_locator_approval_patch_path: 'live-evidence-human-locator-approval-patch.json',
      human_locator_approval_patch_schema: 'shared/schemas/employer-brand-live-evidence-human-locator-approval-patch-v0.schema.json',
    },
    summary: {
      ...cloneJson(readiness.summary),
      excluded_rejected_count: Number(readiness.summary.excluded_rejected_count || 0) + rejected.size,
      locator_ready_count: locatorReadyCount,
      needs_locator_count: targets.filter((target) => target.readiness_state === 'needs_locator').length,
      needs_human_target_review_count: targets.filter((target) => target.readiness_state === 'needs_human_target_review').length,
      needs_human_locator_review_count: needsHumanLocatorReviewCount,
      blocked_count: blockedCount,
      rejected_count: Number(readiness.summary.rejected_count || 0) + rejected.size,
      expected_clip_count_for_included_targets: targets.reduce((count, target) => count + Number(target.expected_clip_count || 0), 0),
      expected_ready_clip_count: expectedReadyClipCount,
    },
    targets,
    provenance: {
      ...cloneJson(readiness.provenance),
      created_at: derivedAt,
      source_locator_readiness_path: 'live-evidence-locator-readiness.json',
      source_human_locator_review_pack_path: 'live-evidence-human-locator-review-pack.json',
      source_human_locator_approval_patch_path: 'live-evidence-human-locator-approval-patch.json',
      only_human_approved_locators_become_ready: true,
      unconfirmed_machine_candidates_do_not_promote: true,
      no_locator_execution: true,
      no_codegen_execution: true,
      no_url_opening: true,
      no_screenshots: true,
      no_element_clips: true,
      no_capture_execution: true,
    },
  });
  const validation = validateEmployerBrandLiveEvidenceLocatorReadiness(derived);
  if (!validation.valid) throw new Error(`Derived locator readiness validation failed: ${validation.errors.join('; ')}`);
  return derived;
}

export function loadEmployerBrandLiveEvidenceHumanLocatorApprovalPatch({ fixtureRoot } = {}) {
  if (!fixtureRoot) throw new Error('fixtureRoot is required');
  return JSON.parse(fs.readFileSync(path.join(fixtureRoot, 'live-evidence-human-locator-approval-patch.json'), 'utf8'));
}
