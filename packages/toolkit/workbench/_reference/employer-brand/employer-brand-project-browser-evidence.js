import {
  BROWSER_EVIDENCE_CAPTURE_MANIFEST_TYPE,
  BROWSER_EVIDENCE_CAPTURE_SCHEMA_VERSION,
} from './browser-evidence-capture.js';

export const EMPLOYER_BRAND_PROJECT_BROWSER_EVIDENCE_COMPILER_VERSION =
  '2026-05-employer-brand-project-browser-evidence-v0';

const PROJECT_TYPE = 'aos.employer_brand_audit_project';
const PROJECT_SCHEMA_VERSION = '2026-05-employer-brand-audit-project-v0';
const LOCAL_ONLY_CONTROLS = [
  'remote_web_collection_authorized',
  'autonomous_browsing_authorized',
  'report_generation_authorized',
  'export_execution_authorized',
  'workflow_engine_authorized',
  'replay_authorized',
  'repair_authorized',
  'macro_playback_authorized',
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

function objectValue(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function stringArray(value) {
  if (!Array.isArray(value)) return [];
  return value.map((item) => text(item)).filter(Boolean);
}

function slug(value = '', fallback = 'item') {
  return text(value, fallback)
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 96) || fallback;
}

function pathSlug(value = '', fallback = 'item') {
  return slug(value, fallback).replace(/_/g, '-');
}

function toPosixPath(...parts) {
  return parts
    .map((part) => text(part).replace(/^\/+|\/+$/g, ''))
    .filter(Boolean)
    .join('/');
}

function uniqueId(base, seen) {
  let candidate = base;
  let index = 2;
  while (seen.has(candidate)) {
    candidate = `${base}_${index}`;
    index += 1;
  }
  seen.add(candidate);
  return candidate;
}

function normalizeCompany(companyInput, fallbackRole) {
  const company = objectValue(companyInput);
  return {
    name: requireText(company.name, `${fallbackRole} company name`),
    role: text(company.role, fallbackRole),
    notes: optionalText(company.notes),
  };
}

function projectCompanies(project) {
  const intake = objectValue(project.intake);
  const client = normalizeCompany(intake.client_company, 'client');
  const competitors = Array.isArray(intake.competitor_companies)
    ? intake.competitor_companies.map((company) => normalizeCompany(company, 'competitor'))
    : [];
  return [client, ...competitors];
}

function sourceCategories(project, { includeNotApplicable = false } = {}) {
  const categories = Array.isArray(project.source_categories) ? project.source_categories : [];
  return categories
    .map((categoryInput) => {
      const category = objectValue(categoryInput);
      return {
        id: requireText(category.id, 'source category id'),
        label: requireText(category.label, 'source category label'),
        coverage_policy: requireText(category.coverage_policy, 'source category coverage_policy'),
        expected_source_kinds: stringArray(category.expected_source_kinds),
        evidence_goal: requireText(category.evidence_goal, 'source category evidence_goal'),
        notes: optionalText(category.notes),
      };
    })
    .filter((category) => includeNotApplicable || category.coverage_policy !== 'not_applicable');
}

function assertLocalOnlyProjectControls(project) {
  const controls = objectValue(project.controls);
  const enabled = LOCAL_ONLY_CONTROLS.filter((key) => controls[key] !== false);
  if (enabled.length > 0) {
    throw new TypeError(
      `Employer Brand Audit Project fixture must keep local-only controls false before manifest planning: ${enabled.join(', ')}`,
    );
  }
}

function normalizeProject(projectInput) {
  const project = objectValue(projectInput);
  if (text(project.type) !== PROJECT_TYPE) {
    throw new TypeError(`project type must be ${PROJECT_TYPE}`);
  }
  if (text(project.schema_version) !== PROJECT_SCHEMA_VERSION) {
    throw new TypeError(`project schema_version must be ${PROJECT_SCHEMA_VERSION}`);
  }
  assertLocalOnlyProjectControls(project);

  return project;
}

function requestNotesFor({ company, category }) {
  const parts = [
    'Planning skeleton only; supply a local fixture page and locator before capture.',
    `Company role: ${company.role}.`,
    `Source category: ${category.label} (${category.coverage_policy}).`,
  ];
  if (category.expected_source_kinds.length > 0) {
    parts.push(`Expected source kinds: ${category.expected_source_kinds.join(', ')}.`);
  }
  if (category.notes) parts.push(`Project notes: ${category.notes}`);
  return parts.join(' ');
}

function requestFor({ company, category, htmlRoot, seenRequestIds }) {
  const companySlug = slug(company.name, 'company');
  const categorySlug = slug(category.id, 'source');
  const requestId = uniqueId(`${companySlug}_${categorySlug}_planning`, seenRequestIds);

  return {
    request_id: requestId,
    company: company.name,
    source_category: category.id,
    url: toPosixPath(htmlRoot, `${pathSlug(company.name, 'company')}-${pathSlug(category.id, 'source')}.html`),
    selector: `[data-browser-evidence-request="${requestId}"]`,
    xpath: null,
    evidence_goal: category.evidence_goal,
    kilos_relevance: [],
    kilos_factors: [],
    notes: requestNotesFor({ company, category }),
  };
}

export function compileBrowserEvidenceManifestFromEmployerBrandAuditProject(projectInput, {
  htmlRoot = 'html',
  createdAt = null,
  includeNotApplicable = false,
} = {}) {
  const project = normalizeProject(projectInput);
  const projectFixtureId = requireText(project.id, 'project id');
  const projectRecord = objectValue(project.project);
  const projectId = requireText(projectRecord.project_id, 'project.project_id');
  const companies = projectCompanies(project);
  const categories = sourceCategories(project, { includeNotApplicable });
  if (companies.length === 0) {
    throw new TypeError('Employer Brand Audit Project fixture must include at least one company.');
  }
  if (categories.length === 0) {
    throw new TypeError('Employer Brand Audit Project fixture must include at least one applicable source category.');
  }

  const seenRequestIds = new Set();
  const requests = [];
  for (const company of companies) {
    for (const category of categories) {
      requests.push(requestFor({
        company,
        category,
        htmlRoot,
        seenRequestIds,
      }));
    }
  }

  const skippedCategories = !includeNotApplicable && Array.isArray(project.source_categories)
    ? project.source_categories
      .map((category) => objectValue(category))
      .filter((category) => text(category.coverage_policy) === 'not_applicable')
      .map((category) => text(category.id))
      .filter(Boolean)
    : [];

  return {
    type: BROWSER_EVIDENCE_CAPTURE_MANIFEST_TYPE,
    schema_version: BROWSER_EVIDENCE_CAPTURE_SCHEMA_VERSION,
    manifest_id: `manifest:${projectId}-browser-evidence-planning-skeleton`,
    audit_id: `audit:${projectId}`,
    created_at: createdAt,
    description: `Local-only Browser Evidence Capture planning manifest skeleton derived from Employer Brand Audit Project V0 fixture ${projectFixtureId}.`,
    requests,
    metadata: {
      compiler: EMPLOYER_BRAND_PROJECT_BROWSER_EVIDENCE_COMPILER_VERSION,
      source_project_type: PROJECT_TYPE,
      source_project_schema_version: PROJECT_SCHEMA_VERSION,
      source_project_id: projectId,
      source_project_fixture_id: projectFixtureId,
      deterministic_planning_bridge: true,
      skeleton_only: true,
      local_fixture_pages_only: true,
      live_websites: false,
      remote_web_collection: false,
      autonomous_browsing: false,
      collection_execution: false,
      workflow_execution: false,
      report_generation: false,
      export_execution: false,
      request_count: requests.length,
      company_count: companies.length,
      source_category_count: categories.length,
      companies: companies.map((company) => ({
        name: company.name,
        role: company.role,
      })),
      source_categories: categories.map((category) => ({
        id: category.id,
        label: category.label,
        coverage_policy: category.coverage_policy,
        evidence_goal: category.evidence_goal,
      })),
      skipped_source_categories: skippedCategories,
    },
  };
}
