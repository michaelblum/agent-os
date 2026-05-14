import fs from 'node:fs';
import path from 'node:path';
import {
  EMPLOYER_BRAND_LIVE_EVIDENCE_TARGET_PLAN_SCHEMA_VERSION,
  EMPLOYER_BRAND_LIVE_EVIDENCE_TARGET_PLAN_TYPE,
  normalizeEmployerBrandLiveEvidenceTargetPlan,
  validateEmployerBrandLiveEvidenceTargetPlan,
} from './employer-brand-live-evidence-target-plan.js';

export const EMPLOYER_BRAND_LIVE_EVIDENCE_TARGET_REVIEW_PACK_TYPE =
  'aos.employer_brand_live_evidence_target_review_pack';
export const EMPLOYER_BRAND_LIVE_EVIDENCE_TARGET_REVIEW_PACK_SCHEMA_VERSION =
  '2026-05-employer-brand-live-evidence-target-review-pack-v0';

const KILOS_DIMENSIONS = ['kinship', 'impact', 'lifestyle', 'opportunity', 'status'];
const APPROVAL_DECISIONS = ['approved', 'approved_with_edits', 'rejected', 'needs_revision'];
const NULL_LOCATORS = {
  selector: null,
  xpath: null,
  playwright_locator: null,
  codegen_hint: null,
  crawl_discovery_notes: null,
  capture_script_slot: null,
};
const NON_GOAL_FLAGS = {
  full_page_grab: false,
  live_browser_collection: false,
  url_reachability_check: false,
  locator_codegen: false,
  screenshot_capture: false,
  clip_generation: false,
  report_rendering: false,
  html_css_polish: false,
  pdf_docx_export: false,
  workflow_execution: false,
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

function statusCounts(items, key) {
  return items.reduce((counts, item) => {
    const value = item[key] ?? null;
    const countKey = value === null ? 'null' : value;
    counts[countKey] = (counts[countKey] || 0) + 1;
    return counts;
  }, {});
}

function locatorReadinessFromTarget(target) {
  const locators = {
    ...cloneJson(NULL_LOCATORS),
    ...cloneJson(objectValue(target.locator_placeholders)),
  };
  const selectorReady = Boolean(text(locators.selector));
  const xpathReady = Boolean(text(locators.xpath));
  const playwrightReady = Boolean(text(locators.playwright_locator));
  const codegenReady = Boolean(text(locators.codegen_hint));
  const locatorReady = selectorReady || xpathReady || playwrightReady;

  return {
    locator_ready: locatorReady,
    selector_ready: selectorReady,
    xpath_ready: xpathReady,
    playwright_ready: playwrightReady,
    codegen_ready: codegenReady,
    locator_placeholders: locators,
    summary: locatorReady
      ? 'Locator data is present for later capture planning review.'
      : 'No locator, XPath, Playwright locator, or codegen hint has been resolved; this item is review-only.',
  };
}

function reviewItemFromTarget(target) {
  const locatorReadiness = locatorReadinessFromTarget(target);
  return {
    target_id: requireText(target.target_id, 'target_id'),
    company_id: requireText(target.company_id, 'company_id'),
    company: requireText(target.company, 'company'),
    company_role: requireText(target.company_role, 'company_role'),
    source_category: requireText(target.source_category, 'source_category'),
    page_name: requireText(target.page_name, 'page_name'),
    url: requireText(target.url, 'url'),
    desired_element: requireText(target.target_element, 'target_element'),
    evidence_goal: requireText(target.evidence_goal, 'evidence_goal'),
    kilos_relevance: cloneJson(arrayValue(target.kilos_relevance)),
    capture_type: requireText(target.capture_type, 'capture_type'),
    expected_clip_count: Number(target.expected_clip_count ?? 0),
    acceptance_criteria: cloneJson(arrayValue(target.acceptance_criteria)),
    review_status: requireText(target.review_status, 'review_status'),
    approval_status: 'not_reviewed',
    locator_readiness: locatorReadiness,
    locator_readiness_summary: locatorReadiness.summary,
    notes: optionalText(target.notes),
    non_goal_flags: cloneJson(NON_GOAL_FLAGS),
    reviewer_notes: null,
    suggested_target_edits: null,
    approval_decision: null,
    decision_timestamp: null,
  };
}

function kilosSummary(items) {
  return KILOS_DIMENSIONS.map((dimension) => ({
    dimension,
    target_count: items.filter((item) => item.kilos_relevance.includes(dimension)).length,
  }));
}

function groupReviewItems(items) {
  const byCompany = new Map();
  for (const item of items) {
    if (!byCompany.has(item.company_id)) {
      byCompany.set(item.company_id, {
        company_id: item.company_id,
        company: item.company,
        company_role: item.company_role,
        target_count: 0,
        expected_clip_count: 0,
        locator_ready_count: 0,
        source_categories: new Map(),
      });
    }
    const companyGroup = byCompany.get(item.company_id);
    companyGroup.target_count += 1;
    companyGroup.expected_clip_count += item.expected_clip_count;
    companyGroup.locator_ready_count += item.locator_readiness.locator_ready ? 1 : 0;

    if (!companyGroup.source_categories.has(item.source_category)) {
      companyGroup.source_categories.set(item.source_category, {
        source_category: item.source_category,
        target_count: 0,
        expected_clip_count: 0,
        locator_ready_count: 0,
        review_items: [],
      });
    }
    const sourceGroup = companyGroup.source_categories.get(item.source_category);
    sourceGroup.target_count += 1;
    sourceGroup.expected_clip_count += item.expected_clip_count;
    sourceGroup.locator_ready_count += item.locator_readiness.locator_ready ? 1 : 0;
    sourceGroup.review_items.push(item);
  }

  return [...byCompany.values()].map((companyGroup) => ({
    ...companyGroup,
    source_categories: [...companyGroup.source_categories.values()],
  }));
}

export function buildEmployerBrandLiveEvidenceTargetReviewPackFromPlan(planInput, {
  createdAt = null,
} = {}) {
  const planValidation = validateEmployerBrandLiveEvidenceTargetPlan(planInput);
  if (!planValidation.valid) {
    throw new Error(`Live evidence target plan validation failed: ${planValidation.errors.join('; ')}`);
  }
  const plan = normalizeEmployerBrandLiveEvidenceTargetPlan(planInput);
  if (plan.type !== EMPLOYER_BRAND_LIVE_EVIDENCE_TARGET_PLAN_TYPE) {
    throw new TypeError(`target plan type must be ${EMPLOYER_BRAND_LIVE_EVIDENCE_TARGET_PLAN_TYPE}`);
  }
  if (plan.schema_version !== EMPLOYER_BRAND_LIVE_EVIDENCE_TARGET_PLAN_SCHEMA_VERSION) {
    throw new TypeError(`target plan schema_version must be ${EMPLOYER_BRAND_LIVE_EVIDENCE_TARGET_PLAN_SCHEMA_VERSION}`);
  }
  const reviewItems = plan.targets.map(reviewItemFromTarget);
  const locatorReadyCount = reviewItems.filter((item) => item.locator_readiness.locator_ready).length;

  return {
    type: EMPLOYER_BRAND_LIVE_EVIDENCE_TARGET_REVIEW_PACK_TYPE,
    schema_version: EMPLOYER_BRAND_LIVE_EVIDENCE_TARGET_REVIEW_PACK_SCHEMA_VERSION,
    id: plan.id.replace('live-evidence-target-plan:', 'live-evidence-target-review-pack:'),
    label: `${plan.label.replace(/ Live Evidence Target Plan$/, '')} Live Evidence Target Review Pack`,
    status: 'human_review_required',
    target_plan_ref: {
      target_plan_id: plan.id,
      target_plan_path: 'live-evidence-target-plan.json',
      target_plan_schema: 'shared/schemas/employer-brand-live-evidence-target-plan-v0.schema.json',
      target_plan_status: plan.status,
      read_only: true,
      planning_metadata_only: true,
    },
    project_ref: cloneJson(plan.project_ref),
    summary: {
      company_count: plan.summary.company_count,
      source_category_count: plan.summary.source_category_count,
      page_count: plan.summary.page_count,
      target_count: reviewItems.length,
      expected_clip_count: reviewItems.reduce((count, item) => count + item.expected_clip_count, 0),
      locator_ready_count: locatorReadyCount,
      review_status_counts: statusCounts(reviewItems, 'review_status'),
      approval_decision_counts: statusCounts(reviewItems, 'approval_decision'),
      kilos_dimensions: kilosSummary(reviewItems),
    },
    groups: groupReviewItems(reviewItems),
    controls: {
      ...cloneJson(plan.controls),
      url_reachability_checks_authorized: false,
      locator_codegen_authorized: false,
      screenshot_capture_authorized: false,
      clip_generation_authorized: false,
      html_css_polish_authorized: false,
    },
    provenance: {
      created_at: createdAt,
      source_target_plan_path: 'live-evidence-target-plan.json',
      source_project_path: 'intake/project.json',
      human_review_affordances_empty: true,
      planning_metadata_only: true,
      read_only: true,
      live_evidence_collected: false,
      url_reachability_checked: false,
      locators_resolved: false,
      locator_codegen_executed: false,
      screenshots_captured: false,
      clips_generated: false,
      report_rendered: false,
      exports_generated: false,
      workflow_executed: false,
      non_goals: cloneJson(arrayValue(plan.provenance?.non_goals)),
    },
  };
}

export function normalizeEmployerBrandLiveEvidenceTargetReviewPack(packInput = {}) {
  const pack = objectValue(packInput);
  const groups = arrayValue(pack.groups).map((companyInput) => {
    const companyGroup = objectValue(companyInput);
    const sourceCategories = arrayValue(companyGroup.source_categories).map((sourceInput) => {
      const sourceGroup = objectValue(sourceInput);
      const reviewItems = arrayValue(sourceGroup.review_items).map((itemInput) => {
        const item = objectValue(itemInput);
        const locatorReadiness = {
          ...locatorReadinessFromTarget({ locator_placeholders: item.locator_readiness?.locator_placeholders }),
          ...cloneJson(objectValue(item.locator_readiness)),
        };
        return {
          ...cloneJson(item),
          target_id: requireText(item.target_id, 'target_id'),
          company_id: requireText(item.company_id, 'company_id'),
          company: requireText(item.company, 'company'),
          company_role: requireText(item.company_role, 'company_role'),
          source_category: requireText(item.source_category, 'source_category'),
          page_name: requireText(item.page_name, 'page_name'),
          url: requireText(item.url, 'url'),
          desired_element: requireText(item.desired_element, 'desired_element'),
          evidence_goal: requireText(item.evidence_goal, 'evidence_goal'),
          kilos_relevance: cloneJson(arrayValue(item.kilos_relevance)),
          capture_type: requireText(item.capture_type, 'capture_type'),
          expected_clip_count: Number(item.expected_clip_count ?? 0),
          acceptance_criteria: cloneJson(arrayValue(item.acceptance_criteria)),
          review_status: requireText(item.review_status, 'review_status'),
          approval_status: text(item.approval_status, 'not_reviewed'),
          locator_readiness: locatorReadiness,
          locator_readiness_summary: text(item.locator_readiness_summary, locatorReadiness.summary),
          notes: optionalText(item.notes),
          non_goal_flags: {
            ...cloneJson(NON_GOAL_FLAGS),
            ...cloneJson(objectValue(item.non_goal_flags)),
          },
          reviewer_notes: optionalText(item.reviewer_notes),
          suggested_target_edits: optionalText(item.suggested_target_edits),
          approval_decision: optionalText(item.approval_decision),
          decision_timestamp: optionalText(item.decision_timestamp),
        };
      });
      return {
        source_category: requireText(sourceGroup.source_category, 'source_category'),
        target_count: Number(sourceGroup.target_count ?? reviewItems.length),
        expected_clip_count: Number(sourceGroup.expected_clip_count ?? reviewItems.reduce((count, item) => count + item.expected_clip_count, 0)),
        locator_ready_count: Number(sourceGroup.locator_ready_count ?? reviewItems.filter((item) => item.locator_readiness.locator_ready).length),
        review_items: reviewItems,
      };
    });
    const items = sourceCategories.flatMap((sourceGroup) => sourceGroup.review_items);
    return {
      company_id: requireText(companyGroup.company_id, 'company_id'),
      company: requireText(companyGroup.company, 'company'),
      company_role: requireText(companyGroup.company_role, 'company_role'),
      target_count: Number(companyGroup.target_count ?? items.length),
      expected_clip_count: Number(companyGroup.expected_clip_count ?? items.reduce((count, item) => count + item.expected_clip_count, 0)),
      locator_ready_count: Number(companyGroup.locator_ready_count ?? items.filter((item) => item.locator_readiness.locator_ready).length),
      source_categories: sourceCategories,
    };
  });
  const reviewItems = groups.flatMap((group) => group.source_categories.flatMap((sourceGroup) => sourceGroup.review_items));

  return {
    ...cloneJson(pack),
    groups,
    review_items: reviewItems,
    summary: {
      company_count: new Set(reviewItems.map((item) => item.company_id)).size,
      source_category_count: new Set(reviewItems.map((item) => item.source_category)).size,
      page_count: new Set(reviewItems.map((item) => `${item.company_id}|${item.source_category}|${item.url}`)).size,
      target_count: reviewItems.length,
      expected_clip_count: reviewItems.reduce((count, item) => count + item.expected_clip_count, 0),
      locator_ready_count: reviewItems.filter((item) => item.locator_readiness.locator_ready).length,
      review_status_counts: statusCounts(reviewItems, 'review_status'),
      approval_decision_counts: statusCounts(reviewItems, 'approval_decision'),
      kilos_dimensions: kilosSummary(reviewItems),
    },
  };
}

export function validateEmployerBrandLiveEvidenceTargetReviewPack(packInput = {}) {
  const errors = [];
  const pack = objectValue(packInput);
  const normalized = normalizeEmployerBrandLiveEvidenceTargetReviewPack(pack);
  const items = normalized.review_items;

  if (pack.type !== EMPLOYER_BRAND_LIVE_EVIDENCE_TARGET_REVIEW_PACK_TYPE) errors.push('type must identify an Employer Brand Live Evidence Target Review Pack');
  if (pack.schema_version !== EMPLOYER_BRAND_LIVE_EVIDENCE_TARGET_REVIEW_PACK_SCHEMA_VERSION) errors.push('schema_version must be v0');
  if (items.length < 1) errors.push('review pack must include at least one review item');
  if (pack.controls?.full_page_grabs !== false) errors.push('full_page_grabs must remain false');
  for (const key of [
    'live_collection_authorized',
    'url_reachability_checks_authorized',
    'locator_codegen_authorized',
    'screenshot_capture_authorized',
    'clip_generation_authorized',
    'report_renderer_authorized',
    'export_execution_authorized',
    'workflow_engine_authorized',
  ]) {
    if (pack.controls?.[key] !== false) errors.push(`${key} must remain false`);
  }
  for (const item of items) {
    if (!arrayValue(item.kilos_relevance).every((dimension) => KILOS_DIMENSIONS.includes(dimension))) {
      errors.push(`${item.target_id} has invalid KILOS relevance`);
    }
    if (item.approval_decision !== null && !APPROVAL_DECISIONS.includes(item.approval_decision)) {
      errors.push(`${item.target_id} approval_decision is invalid`);
    }
    if (item.approval_decision === null && item.decision_timestamp !== null) {
      errors.push(`${item.target_id} decision_timestamp must stay null until a decision exists`);
    }
    for (const [key, value] of Object.entries(item.non_goal_flags)) {
      if (value !== false) errors.push(`${item.target_id} non_goal_flags.${key} must remain false`);
    }
    for (const [key, value] of Object.entries(item.locator_readiness.locator_placeholders)) {
      if (value !== null) errors.push(`${item.target_id} locator ${key} must remain null`);
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

export function loadEmployerBrandLiveEvidenceTargetReviewPack({
  fixtureRoot,
} = {}) {
  if (!fixtureRoot) throw new Error('fixtureRoot is required');
  return JSON.parse(fs.readFileSync(path.join(fixtureRoot, 'live-evidence-target-review-pack.json'), 'utf8'));
}
