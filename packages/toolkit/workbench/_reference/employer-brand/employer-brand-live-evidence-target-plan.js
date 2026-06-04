import fs from 'node:fs';
import path from 'node:path';

export const EMPLOYER_BRAND_LIVE_EVIDENCE_TARGET_PLAN_TYPE = 'aos.employer_brand_live_evidence_target_plan';
export const EMPLOYER_BRAND_LIVE_EVIDENCE_TARGET_PLAN_SCHEMA_VERSION =
  '2026-05-employer-brand-live-evidence-target-plan-v0';

const PROJECT_TYPE = 'aos.employer_brand_audit_project';
const PROJECT_SCHEMA_VERSION = '2026-05-employer-brand-audit-project-v0';
const KILOS_DIMENSIONS = ['kinship', 'impact', 'lifestyle', 'opportunity', 'status'];
const NON_GOALS = [
  'full_page_grabs',
  'autonomous_browsing',
  'live_collection',
  'locator_codegen',
  'capture_execution',
  'report_renderer',
  'export_execution',
  'workflow_engine',
];
const NULL_LOCATORS = {
  selector: null,
  xpath: null,
  playwright_locator: null,
  codegen_hint: null,
  crawl_discovery_notes: null,
  capture_script_slot: null,
};
const CATEGORY_KILOS = {
  careers_site: ['opportunity', 'lifestyle'],
  employer_brand_pages: ['kinship', 'lifestyle', 'opportunity'],
  linkedin_presence: ['status', 'impact'],
  review_platforms: ['kinship', 'lifestyle'],
  social_campaigns: ['kinship', 'impact'],
  awards_recognition: ['status', 'impact'],
  employee_stories: ['kinship', 'lifestyle', 'opportunity'],
};
const CATEGORY_PATHS = {
  careers_site: '',
  employer_brand_pages: 'careers/culture',
  linkedin_presence: null,
  review_platforms: null,
  social_campaigns: 'news',
  awards_recognition: 'news',
  employee_stories: 'careers/employee-stories',
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

function objectValue(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function arrayValue(value) {
  return Array.isArray(value) ? value : [];
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function slug(value = '', separator = '-') {
  return text(value, 'item')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, separator)
    .replace(new RegExp(`^${separator}+|${separator}+$`, 'g'), '');
}

function companyId(company) {
  return `company:${slug(company.name)}`;
}

function withPath(baseUrl, pathPart) {
  if (pathPart === null) return null;
  try {
    const url = new URL(baseUrl);
    if (pathPart) url.pathname = `/${pathPart.replace(/^\/+/, '')}`;
    return url.toString();
  } catch {
    return baseUrl;
  }
}

function linkedinUrl(company) {
  return `https://www.linkedin.com/company/${slug(company.name)}/`;
}

function reviewUrl(company) {
  return `https://www.glassdoor.com/Search/results.htm?keyword=${encodeURIComponent(company.name)}`;
}

function plannedUrl(company, category) {
  if (category.id === 'linkedin_presence') return linkedinUrl(company);
  if (category.id === 'review_platforms') return reviewUrl(company);
  const candidate = withPath(company.website_url, CATEGORY_PATHS[category.id] ?? '');
  return candidate || requireText(company.website_url, `${company.name} website_url`);
}

function targetElementFor(category) {
  if (category.id === 'review_platforms') {
    return 'Human-selected rating, review-theme, or employee-sentiment element on the chosen review platform page.';
  }
  if (category.id === 'linkedin_presence') {
    return 'Human-selected LinkedIn company, life, jobs, or post element that shows talent-facing positioning or hiring proof.';
  }
  return `Human-selected page element that best supports the ${category.label} evidence goal without capturing the full page.`;
}

function acceptanceCriteriaFor(category) {
  return [
    'The captured evidence is scoped to the named element, not the full page.',
    `The element visibly supports the ${category.label} source category.`,
    'The element preserves enough surrounding labels or headings to understand the evidence out of context.',
    'The element can be reviewed against the stated KILOS relevance before capture execution.',
  ];
}

function normalizeCompany(companyInput, fallbackRole) {
  const company = objectValue(companyInput);
  return {
    name: requireText(company.name, `${fallbackRole} company name`),
    role: text(company.role, fallbackRole),
    website_url: requireText(company.website_url, `${fallbackRole} company website_url`),
  };
}

function projectCompanies(project) {
  const intake = objectValue(project.intake);
  return [
    normalizeCompany(intake.client_company, 'client'),
    ...arrayValue(intake.competitor_companies).map((company) => normalizeCompany(company, 'competitor')),
  ];
}

function sourceCategories(project) {
  return arrayValue(project.source_categories)
    .map((categoryInput) => {
      const category = objectValue(categoryInput);
      return {
        id: requireText(category.id, 'source category id'),
        label: requireText(category.label, 'source category label'),
        coverage_policy: requireText(category.coverage_policy, 'source category coverage_policy'),
        evidence_goal: requireText(category.evidence_goal, 'source category evidence_goal'),
      };
    })
    .filter((category) => category.coverage_policy !== 'not_applicable');
}

function normalizeProject(projectInput) {
  const project = objectValue(projectInput);
  if (text(project.type) !== PROJECT_TYPE) throw new TypeError(`project type must be ${PROJECT_TYPE}`);
  if (text(project.schema_version) !== PROJECT_SCHEMA_VERSION) {
    throw new TypeError(`project schema_version must be ${PROJECT_SCHEMA_VERSION}`);
  }
  return project;
}

function statusCounts(targets) {
  return targets.reduce((counts, target) => {
    counts[target.review_status] = (counts[target.review_status] || 0) + 1;
    return counts;
  }, {});
}

function groupCounts(targets, keyFn) {
  return targets.reduce((groups, target) => {
    const key = keyFn(target);
    groups[key] = (groups[key] || 0) + 1;
    return groups;
  }, {});
}

function kilosSummary(targets) {
  return KILOS_DIMENSIONS.map((dimension) => ({
    dimension,
    target_count: targets.filter((target) => arrayValue(target.kilos_relevance).includes(dimension)).length,
  }));
}

export function buildDraftEmployerBrandLiveEvidenceTargetPlanFromProject(projectInput, {
  createdAt = null,
} = {}) {
  const project = normalizeProject(projectInput);
  const companies = projectCompanies(project);
  const categories = sourceCategories(project);
  const projectId = requireText(project.project?.project_id, 'project.project_id');
  const targets = companies.flatMap((company) => categories.map((category) => ({
    target_id: `live-target:${slug(company.name)}:${slug(category.id)}`,
    company_id: companyId(company),
    company: company.name,
    company_role: company.role,
    source_category: category.id,
    page_name: `${company.name} ${category.label}`,
    url: plannedUrl(company, category),
    target_element: targetElementFor(category),
    evidence_goal: category.evidence_goal,
    kilos_relevance: cloneJson(CATEGORY_KILOS[category.id] || []),
    capture_type: 'element_clip_and_text_extract',
    expected_clip_count: 1,
    acceptance_criteria: acceptanceCriteriaFor(category),
    review_status: 'human_review_required',
    locator_placeholders: cloneJson(NULL_LOCATORS),
    notes: 'Draft placeholder seeded from project intake. Human review must confirm the URL and target element before locator work or capture execution.',
  })));

  return {
    type: EMPLOYER_BRAND_LIVE_EVIDENCE_TARGET_PLAN_TYPE,
    schema_version: EMPLOYER_BRAND_LIVE_EVIDENCE_TARGET_PLAN_SCHEMA_VERSION,
    id: `live-evidence-target-plan:${projectId}`,
    label: `${project.label || 'Employer Brand Audit Project'} Live Evidence Target Plan`,
    status: 'human_review_required',
    project_ref: {
      project_id: projectId,
      project_path: 'intake/project.json',
      framework: 'KILOS',
      read_only: true,
      planning_metadata_only: true,
    },
    expected_totals: {
      company_count: companies.length,
      source_category_count: categories.length,
      page_count: targets.length,
      target_count: targets.length,
      expected_clip_count: targets.reduce((count, target) => count + target.expected_clip_count, 0),
    },
    targets,
    controls: {
      full_page_grabs: false,
      autonomous_browsing_authorized: false,
      live_collection_authorized: false,
      report_renderer_authorized: false,
      export_execution_authorized: false,
      workflow_engine_authorized: false,
    },
    provenance: {
      created_at: createdAt,
      human_authored_contract: true,
      planning_metadata_only: true,
      read_only: true,
      live_evidence_collected: false,
      selectors_resolved: false,
      non_goals: cloneJson(NON_GOALS),
    },
  };
}

export function normalizeEmployerBrandLiveEvidenceTargetPlan(planInput = {}) {
  const plan = objectValue(planInput);
  const targets = arrayValue(plan.targets).map((targetInput) => {
    const target = objectValue(targetInput);
    return {
      ...cloneJson(target),
      target_id: requireText(target.target_id, 'target_id'),
      company_id: requireText(target.company_id, 'company_id'),
      company: requireText(target.company, 'company'),
      company_role: requireText(target.company_role, 'company_role'),
      source_category: requireText(target.source_category, 'source_category'),
      page_name: requireText(target.page_name, 'page_name'),
      url: requireText(target.url, 'url'),
      target_element: requireText(target.target_element, 'target_element'),
      evidence_goal: requireText(target.evidence_goal, 'evidence_goal'),
      kilos_relevance: arrayValue(target.kilos_relevance),
      capture_type: requireText(target.capture_type, 'capture_type'),
      expected_clip_count: Number(target.expected_clip_count ?? 0),
      acceptance_criteria: arrayValue(target.acceptance_criteria),
      review_status: requireText(target.review_status, 'review_status'),
      locator_placeholders: {
        ...cloneJson(NULL_LOCATORS),
        ...cloneJson(objectValue(target.locator_placeholders)),
      },
      notes: optionalText(target.notes),
    };
  });

  return {
    ...cloneJson(plan),
    targets,
    summary: {
      company_count: new Set(targets.map((target) => target.company_id)).size,
      source_category_count: new Set(targets.map((target) => target.source_category)).size,
      page_count: new Set(targets.map((target) => `${target.company_id}|${target.source_category}|${target.url}`)).size,
      target_count: targets.length,
      expected_clip_count: targets.reduce((count, target) => count + target.expected_clip_count, 0),
      review_status_counts: statusCounts(targets),
      kilos_dimensions: kilosSummary(targets),
      grouped_by_company: groupCounts(targets, (target) => target.company_id),
      grouped_by_source_category: groupCounts(targets, (target) => target.source_category),
      grouped_by_url_source_category: groupCounts(targets, (target) => `${target.url}|${target.source_category}`),
    },
  };
}

export function validateEmployerBrandLiveEvidenceTargetPlan(planInput = {}) {
  const errors = [];
  const plan = objectValue(planInput);
  const targets = arrayValue(plan.targets);
  if (plan.type !== EMPLOYER_BRAND_LIVE_EVIDENCE_TARGET_PLAN_TYPE) errors.push('type must identify an Employer Brand Live Evidence Target Plan');
  if (plan.schema_version !== EMPLOYER_BRAND_LIVE_EVIDENCE_TARGET_PLAN_SCHEMA_VERSION) errors.push('schema_version must be v0');
  if (targets.length < 1) errors.push('targets must include at least one live page element target');
  if (plan.controls?.full_page_grabs !== false) errors.push('full_page_grabs must remain false');
  for (const key of [
    'autonomous_browsing_authorized',
    'live_collection_authorized',
    'report_renderer_authorized',
    'export_execution_authorized',
    'workflow_engine_authorized',
  ]) {
    if (plan.controls?.[key] !== false) errors.push(`${key} must remain false`);
  }
  for (const target of targets) {
    for (const field of [
      'target_id',
      'company_id',
      'company',
      'company_role',
      'source_category',
      'page_name',
      'url',
      'target_element',
      'evidence_goal',
      'capture_type',
      'review_status',
    ]) {
      if (!text(target?.[field])) errors.push(`${field} is required`);
    }
    const locators = objectValue(target?.locator_placeholders);
    for (const field of Object.keys(NULL_LOCATORS)) {
      if (locators[field] !== null) errors.push(`${target?.target_id || 'target'} locator ${field} must remain null`);
    }
  }
  return {
    valid: errors.length === 0,
    errors,
  };
}

export function loadEmployerBrandLiveEvidenceTargetPlan({
  fixtureRoot,
} = {}) {
  if (!fixtureRoot) throw new Error('fixtureRoot is required');
  return JSON.parse(fs.readFileSync(path.join(fixtureRoot, 'live-evidence-target-plan.json'), 'utf8'));
}
