import fs from 'node:fs';
import path from 'node:path';
import {
  EMPLOYER_BRAND_LIVE_EVIDENCE_TARGET_PLAN_SCHEMA_VERSION,
  EMPLOYER_BRAND_LIVE_EVIDENCE_TARGET_PLAN_TYPE,
  normalizeEmployerBrandLiveEvidenceTargetPlan,
  validateEmployerBrandLiveEvidenceTargetPlan,
} from './employer-brand-live-evidence-target-plan.js';
import {
  EMPLOYER_BRAND_LIVE_EVIDENCE_TARGET_REVIEW_PACK_SCHEMA_VERSION,
  EMPLOYER_BRAND_LIVE_EVIDENCE_TARGET_REVIEW_PACK_TYPE,
  normalizeEmployerBrandLiveEvidenceTargetReviewPack,
  validateEmployerBrandLiveEvidenceTargetReviewPack,
} from './employer-brand-live-evidence-target-review-pack.js';

export const EMPLOYER_BRAND_LIVE_EVIDENCE_TARGET_APPROVAL_PATCH_TYPE =
  'aos.employer_brand_live_evidence_target_approval_patch';
export const EMPLOYER_BRAND_LIVE_EVIDENCE_TARGET_APPROVAL_PATCH_SCHEMA_VERSION =
  '2026-05-employer-brand-live-evidence-target-approval-patch-v0';

const KILOS_DIMENSIONS = ['kinship', 'impact', 'lifestyle', 'opportunity', 'status'];
const DECISIONS = ['approve', 'reject', 'keep_draft'];
const EDIT_FIELDS = [
  'desired_element',
  'target_element',
  'evidence_goal',
  'kilos_relevance',
  'expected_clip_count',
  'acceptance_criteria',
  'notes',
  'review_status',
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

function patchDecisions(patch) {
  return arrayValue(patch.decisions).map((input) => {
    const decision = objectValue(input);
    const edits = objectValue(decision.edits);
    const normalizedEdits = {};
    for (const field of EDIT_FIELDS) {
      if (Object.hasOwn(edits, field)) normalizedEdits[field] = cloneJson(edits[field]);
    }
    return {
      target_id: requireText(decision.target_id, 'target_id'),
      decision: requireText(decision.decision, 'decision'),
      reviewer_notes: optionalText(decision.reviewer_notes),
      edits: normalizedEdits,
    };
  });
}

function decisionMapForPatch(patch) {
  const decisions = patchDecisions(patch);
  const byId = new Map();
  for (const decision of decisions) {
    if (byId.has(decision.target_id)) throw new Error(`${decision.target_id} has duplicate decisions`);
    byId.set(decision.target_id, decision);
  }
  return byId;
}

function decisionSummary({ originalTargets, decisions, reviewer, reviewedAt, patchId }) {
  let approvedCount = 0;
  let rejectedCount = 0;
  let draftCount = 0;
  let editedCount = 0;
  let unchangedCount = 0;
  let expectedClipCountAfterRejectedTargetsExcluded = 0;
  const decisionsById = new Map(decisions.map((decision) => [decision.target_id, decision]));

  for (const target of originalTargets) {
    const decision = decisionsById.get(target.target_id);
    const effectiveDecision = decision?.decision || 'keep_draft';
    const edited = decision ? Object.keys(decision.edits).length > 0 : false;
    if (effectiveDecision === 'approve') approvedCount += 1;
    if (effectiveDecision === 'reject') rejectedCount += 1;
    if (effectiveDecision === 'keep_draft') draftCount += 1;
    if (edited) editedCount += 1;
    if (!edited) unchangedCount += 1;
    if (effectiveDecision !== 'reject') {
      expectedClipCountAfterRejectedTargetsExcluded += Number(decision?.edits.expected_clip_count ?? target.expected_clip_count ?? 0);
    }
  }

  return {
    total_targets: originalTargets.length,
    approved_count: approvedCount,
    rejected_count: rejectedCount,
    draft_count: draftCount,
    edited_count: editedCount,
    unchanged_count: unchangedCount,
    expected_clip_count_after_rejected_targets_excluded: expectedClipCountAfterRejectedTargetsExcluded,
    reviewer: cloneJson(reviewer),
    reviewed_at: reviewedAt,
    approval_patch_id: patchId,
  };
}

function applyEdits(target, edits) {
  const next = cloneJson(target);
  if (Object.hasOwn(edits, 'desired_element')) next.target_element = requireText(edits.desired_element, 'desired_element');
  if (Object.hasOwn(edits, 'target_element')) next.target_element = requireText(edits.target_element, 'target_element');
  if (Object.hasOwn(edits, 'evidence_goal')) next.evidence_goal = requireText(edits.evidence_goal, 'evidence_goal');
  if (Object.hasOwn(edits, 'kilos_relevance')) next.kilos_relevance = cloneJson(arrayValue(edits.kilos_relevance));
  if (Object.hasOwn(edits, 'expected_clip_count')) next.expected_clip_count = Number(edits.expected_clip_count);
  if (Object.hasOwn(edits, 'acceptance_criteria')) next.acceptance_criteria = cloneJson(arrayValue(edits.acceptance_criteria));
  if (Object.hasOwn(edits, 'notes')) next.notes = optionalText(edits.notes);
  if (Object.hasOwn(edits, 'review_status')) next.review_status = requireText(edits.review_status, 'review_status');
  return next;
}

export function validateEmployerBrandLiveEvidenceTargetApprovalPatch(patchInput = {}) {
  const errors = [];
  const patch = objectValue(patchInput);
  let decisions = [];
  try {
    decisions = patchDecisions(patch);
  } catch (caught) {
    errors.push(caught.message);
  }

  if (patch.type !== EMPLOYER_BRAND_LIVE_EVIDENCE_TARGET_APPROVAL_PATCH_TYPE) errors.push('type must identify an Employer Brand Live Evidence Target Approval Patch');
  if (patch.schema_version !== EMPLOYER_BRAND_LIVE_EVIDENCE_TARGET_APPROVAL_PATCH_SCHEMA_VERSION) errors.push('schema_version must be v0');
  if (!text(patch.id)) errors.push('id is required');
  if (!text(patch.target_plan_ref?.target_plan_id)) errors.push('target_plan_ref.target_plan_id is required');
  if (patch.target_plan_ref?.target_plan_path !== 'live-evidence-target-plan.json') errors.push('target_plan_ref.target_plan_path must reference live-evidence-target-plan.json');
  if (!text(patch.review_pack_ref?.review_pack_id)) errors.push('review_pack_ref.review_pack_id is required');
  if (patch.review_pack_ref?.review_pack_path !== 'live-evidence-target-review-pack.json') errors.push('review_pack_ref.review_pack_path must reference live-evidence-target-review-pack.json');
  if (decisions.length < 1) errors.push('decisions must include at least one target decision');

  const seen = new Set();
  for (const decision of decisions) {
    if (seen.has(decision.target_id)) errors.push(`${decision.target_id} has duplicate decisions`);
    seen.add(decision.target_id);
    if (!DECISIONS.includes(decision.decision)) errors.push(`${decision.target_id} decision is invalid`);
    for (const [field, value] of Object.entries(decision.edits)) {
      if (!EDIT_FIELDS.includes(field)) errors.push(`${decision.target_id} edit field ${field} is invalid`);
      if (['desired_element', 'target_element', 'evidence_goal', 'review_status'].includes(field) && !text(value)) {
        errors.push(`${decision.target_id} ${field} edit must be non-empty`);
      }
      if (field === 'expected_clip_count' && (!Number.isInteger(Number(value)) || Number(value) < 0)) {
        errors.push(`${decision.target_id} expected_clip_count edit must be a non-negative integer`);
      }
      if (field === 'kilos_relevance' && !arrayValue(value).every((dimension) => KILOS_DIMENSIONS.includes(dimension))) {
        errors.push(`${decision.target_id} kilos_relevance edit has invalid KILOS dimension`);
      }
      if (field === 'acceptance_criteria' && arrayValue(value).length < 1) {
        errors.push(`${decision.target_id} acceptance_criteria edit must include at least one criterion`);
      }
    }
  }

  for (const key of [
    'live_browser_collection',
    'url_reachability_check',
    'locator_codegen',
    'screenshot_capture',
    'clip_generation',
    'report_rendering',
    'html_css_polish',
    'pdf_docx_export',
    'workflow_execution',
    'full_page_grabs',
  ]) {
    if (patch.controls?.[key] !== false) errors.push(`controls.${key} must remain false`);
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

export function applyEmployerBrandLiveEvidenceTargetApprovalPatch(planInput, patchInput, {
  reviewPackInput = null,
  derivedAt = null,
} = {}) {
  const planValidation = validateEmployerBrandLiveEvidenceTargetPlan(planInput);
  if (!planValidation.valid) throw new Error(`Live evidence target plan validation failed: ${planValidation.errors.join('; ')}`);
  const patchValidation = validateEmployerBrandLiveEvidenceTargetApprovalPatch(patchInput);
  if (!patchValidation.valid) throw new Error(`Live evidence target approval patch validation failed: ${patchValidation.errors.join('; ')}`);
  if (reviewPackInput) {
    const reviewPackValidation = validateEmployerBrandLiveEvidenceTargetReviewPack(reviewPackInput);
    if (!reviewPackValidation.valid) throw new Error(`Live evidence target review pack validation failed: ${reviewPackValidation.errors.join('; ')}`);
  }

  const plan = normalizeEmployerBrandLiveEvidenceTargetPlan(planInput);
  const patch = objectValue(patchInput);
  const reviewPack = reviewPackInput ? normalizeEmployerBrandLiveEvidenceTargetReviewPack(reviewPackInput) : null;
  if (plan.type !== EMPLOYER_BRAND_LIVE_EVIDENCE_TARGET_PLAN_TYPE) throw new TypeError(`target plan type must be ${EMPLOYER_BRAND_LIVE_EVIDENCE_TARGET_PLAN_TYPE}`);
  if (plan.schema_version !== EMPLOYER_BRAND_LIVE_EVIDENCE_TARGET_PLAN_SCHEMA_VERSION) throw new TypeError(`target plan schema_version must be ${EMPLOYER_BRAND_LIVE_EVIDENCE_TARGET_PLAN_SCHEMA_VERSION}`);
  if (reviewPack && reviewPack.type !== EMPLOYER_BRAND_LIVE_EVIDENCE_TARGET_REVIEW_PACK_TYPE) throw new TypeError(`review pack type must be ${EMPLOYER_BRAND_LIVE_EVIDENCE_TARGET_REVIEW_PACK_TYPE}`);
  if (reviewPack && reviewPack.schema_version !== EMPLOYER_BRAND_LIVE_EVIDENCE_TARGET_REVIEW_PACK_SCHEMA_VERSION) throw new TypeError(`review pack schema_version must be ${EMPLOYER_BRAND_LIVE_EVIDENCE_TARGET_REVIEW_PACK_SCHEMA_VERSION}`);
  if (patch.target_plan_ref.target_plan_id !== plan.id) throw new Error('approval patch target_plan_ref.target_plan_id does not match plan id');
  if (reviewPack && patch.review_pack_ref.review_pack_id !== reviewPack.id) throw new Error('approval patch review_pack_ref.review_pack_id does not match review pack id');

  const decisionsById = decisionMapForPatch(patch);
  const missingTargets = [...decisionsById.keys()].filter((targetId) => !plan.targets.some((target) => target.target_id === targetId));
  if (missingTargets.length) throw new Error(`approval patch references unknown targets: ${missingTargets.join(', ')}`);

  const reviewedTargets = [];
  for (const target of plan.targets) {
    const decision = decisionsById.get(target.target_id) || {
      target_id: target.target_id,
      decision: 'keep_draft',
      reviewer_notes: null,
      edits: {},
    };
    if (decision.decision === 'reject') continue;
    const next = applyEdits(target, decision.edits);
    next.review_status = decision.edits.review_status || (decision.decision === 'approve' ? 'approved' : 'draft');
    reviewedTargets.push(next);
  }

  const summary = decisionSummary({
    originalTargets: plan.targets,
    decisions: [...decisionsById.values()],
    reviewer: patch.reviewer,
    reviewedAt: patch.reviewed_at || derivedAt,
    patchId: patch.id,
  });
  const status = summary.draft_count > 0 ? 'human_review_required' : 'approved';
  const { summary: _summary, ...planForPersistence } = cloneJson(plan);
  const reviewedPlan = {
    ...planForPersistence,
    id: plan.id.replace('live-evidence-target-plan:', 'live-evidence-reviewed-target-plan:'),
    label: `${plan.label.replace(/ Live Evidence Target Plan$/, '')} Reviewed Live Evidence Target Plan`,
    status,
    expected_totals: {
      ...cloneJson(plan.expected_totals),
      company_count: new Set(reviewedTargets.map((target) => target.company_id)).size,
      source_category_count: new Set(reviewedTargets.map((target) => target.source_category)).size,
      page_count: reviewedTargets.length,
      target_count: reviewedTargets.length,
      expected_clip_count: summary.expected_clip_count_after_rejected_targets_excluded,
    },
    targets: reviewedTargets,
    review_decision_summary: summary,
    provenance: {
      ...cloneJson(plan.provenance),
      created_at: derivedAt,
      source_target_plan_path: 'live-evidence-target-plan.json',
      source_review_pack_path: 'live-evidence-target-review-pack.json',
      approval_patch_path: 'live-evidence-target-approval-patch.json',
      original_target_plan_unchanged: true,
      rejected_targets_excluded_from_readiness: true,
      planning_metadata_only: true,
      read_only: true,
      live_evidence_collected: false,
      selectors_resolved: false,
    },
  };

  const reviewedValidation = validateEmployerBrandLiveEvidenceTargetPlan(reviewedPlan);
  if (!reviewedValidation.valid) throw new Error(`Reviewed live evidence target plan validation failed: ${reviewedValidation.errors.join('; ')}`);
  return reviewedPlan;
}

export function loadEmployerBrandLiveEvidenceTargetApprovalPatch({
  fixtureRoot,
} = {}) {
  if (!fixtureRoot) throw new Error('fixtureRoot is required');
  return JSON.parse(fs.readFileSync(path.join(fixtureRoot, 'live-evidence-target-approval-patch.json'), 'utf8'));
}
