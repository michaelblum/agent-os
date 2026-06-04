import fs from 'node:fs';
import path from 'node:path';

export const EMPLOYER_BRAND_ELEMENT_CAPTURE_PLANNING_BUNDLE_TYPE = 'aos.employer_brand_element_capture_planning_bundle';
export const EMPLOYER_BRAND_ELEMENT_CAPTURE_PLANNING_BUNDLE_SCHEMA_VERSION = '2026-05-employer-brand-element-capture-planning-bundle-v0';
export const EMPLOYER_BRAND_ELEMENT_CLIP_MANIFEST_TYPE = 'aos.employer_brand_element_clip_manifest';
export const EMPLOYER_BRAND_ELEMENT_CLIP_MANIFEST_SCHEMA_VERSION = '2026-05-employer-brand-element-clip-manifest-v0';

const KILOS_DIMENSIONS = ['kinship', 'impact', 'lifestyle', 'opportunity', 'status'];
const NON_GOALS = [
  'live_browser_collection',
  'screenshots',
  'element_clip_generation',
  'report_renderer',
  'html_css_polish',
  'pdf_export',
  'docx_export',
  'workflow_engine',
  'full_page_grabs',
];

const SPV5_LOCATORS = {
  'target:spa-header-view-nav': {
    selector: '#main-header',
    playwright_locator: "page.locator('#main-header')",
    codegen_hint: "locator('#main-header')",
    readiness_state: 'locator_ready',
  },
  'target:spa-competition-logo-grid': {
    selector: '#competition-content-wrapper > .card',
    playwright_locator: "page.locator('#competition-content-wrapper > .card')",
    codegen_hint: "set activeView to competition, then locator('#competition-content-wrapper > .card')",
    readiness_state: 'locator_ready',
  },
  'target:spa-kilos-matrix': {
    selector: '#kilos-matrix',
    playwright_locator: "page.locator('#kilos-matrix')",
    codegen_hint: "set activeView to competition, then locator('#kilos-matrix')",
    readiness_state: 'locator_ready',
  },
  'target:spa-company-deep-dive-cards': {
    selector_template: '#{company_slug}',
    playwright_locator_template: "page.locator('#{company_slug}')",
    codegen_hint: "set activeView to deepdives, then locate the company section by its slug id",
    readiness_state: 'locator_ready',
  },
};

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function resolveFixturePath(fixtureRoot, relativePath) {
  return path.join(fixtureRoot, relativePath);
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

function slug(value) {
  return String(value ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function spv5DomSlug(value) {
  return String(value ?? '')
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^\w-]+/g, '');
}

function extractSpv5Companies(html = '') {
  const placeholders = html.match(/<script id="data-placeholders">([\s\S]*?)<\/script>/);
  const source = placeholders?.[1] || html;
  const names = [...source.matchAll(/"companyName"\s*:\s*"([^"]+)"/g)].map((match) => match[1]);
  const firstRun = [];
  for (const name of names) {
    if (firstRun.includes(name)) break;
    firstRun.push(name);
  }
  return firstRun.map((name, index) => ({
    company_ref_id: `company:${slug(name)}`,
    name,
    slug: slug(name),
    role: index === 0 ? 'client' : 'competitor',
  }));
}

function sourceArtifactMap(sourceArtifactDataBundle, targetPlan) {
  const rows = [
    ...arrayValue(sourceArtifactDataBundle.source_artifacts),
    ...arrayValue(targetPlan.source_artifact_refs),
  ];
  return new Map(rows.map((artifact) => [artifact.id, artifact]));
}

function locatorForTarget(target, company = null) {
  const locator = SPV5_LOCATORS[target.target_id];
  if (!locator) {
    return {
      selector: null,
      xpath: null,
      playwright_locator: null,
      codegen_hint: null,
      integrity: 'unresolved_placeholder',
    };
  }
  const selector = locator.selector_template
    ? locator.selector_template.replace('{company_slug}', spv5DomSlug(company?.name || company?.slug || ''))
    : locator.selector;
  const playwrightLocator = locator.playwright_locator_template
    ? locator.playwright_locator_template.replace('{company_slug}', spv5DomSlug(company?.name || company?.slug || ''))
    : locator.playwright_locator;
  return {
    selector,
    xpath: null,
    playwright_locator: playwrightLocator,
    codegen_hint: locator.codegen_hint,
    integrity: 'stable_spv5_dom_id_or_direct_child',
  };
}

function blockersForTarget(target, sourceArtifact) {
  if (sourceArtifact?.kind === 'pdf') {
    return ['pdf_crop_coordinates_unresolved', 'pdf_text_region_parser_needed'];
  }
  if (sourceArtifact?.kind === 'pptx') {
    return ['pptx_object_parser_needed', 'slide_export_not_authorized'];
  }
  if (!SPV5_LOCATORS[target.target_id]) {
    return ['stable_spv5_selector_not_identified'];
  }
  return [];
}

function readinessForTarget(target, sourceArtifact) {
  if (sourceArtifact?.kind === 'pdf') return 'blocked_unresolved_pdf_crop';
  if (sourceArtifact?.kind === 'pptx') return 'blocked_parser_needed';
  return SPV5_LOCATORS[target.target_id]?.readiness_state || 'blocked_locator_needed';
}

function repeatedCompaniesForTarget(target, companies) {
  if (target.target_id === 'target:spa-company-deep-dive-cards') return companies;
  if (target.target_id === 'target:spa-evidence-gallery-active-frames') return companies;
  return [];
}

function workUnitId(targetId, company = null) {
  const suffix = targetId.replace(/^target:/, '').replace(/[^a-z0-9]+/gi, '-').replace(/^-+|-+$/g, '');
  return company ? `work-unit:${suffix}:${company.slug}` : `work-unit:${suffix}`;
}

function normalizeWorkUnits({ targetPlan, sourceArtifactDataBundle, companies }) {
  const artifacts = sourceArtifactMap(sourceArtifactDataBundle, targetPlan);
  return arrayValue(targetPlan.targets).flatMap((target) => {
    const sourceArtifact = artifacts.get(target.source_artifact_id) || null;
    const repeatedCompanies = repeatedCompaniesForTarget(target, companies);
    const rows = repeatedCompanies.length ? repeatedCompanies : [null];
    return rows.map((company) => {
      const expectedClipCount = company ? 1 : target.expected_clip_count;
      const blockers = blockersForTarget(target, sourceArtifact);
      return {
        id: workUnitId(target.target_id, company),
        target_id: target.target_id,
        source_artifact: {
          id: target.source_artifact_id,
          kind: sourceArtifact?.kind || null,
          path: sourceArtifact?.path || null,
          role: sourceArtifact?.role || null,
        },
        company_ref: company ? cloneJson(company) : null,
        kilos_relevance: cloneJson(arrayValue(target.kilos_relevance)),
        capture_type: target.capture_type,
        expected_clip_count: expectedClipCount,
        readiness_state: readinessForTarget(target, sourceArtifact),
        blockers,
        locator_hints: locatorForTarget(target, company),
        acceptance_criteria: cloneJson(arrayValue(target.acceptance_criteria)),
        provenance: {
          source_target_name: target.target_name,
          natural_language_target: target.page_element_target?.natural_language_target || null,
          artifact_location: target.page_element_target?.artifact_location || null,
          non_goal_controls: cloneJson(NON_GOALS),
          read_only: true,
          planned_only: true,
        },
      };
    });
  });
}

export function normalizeEmployerBrandElementCapturePlanningBundle(inputs = {}) {
  const targetPlan = objectValue(inputs.targetPlan);
  const sourceArtifactDataBundle = objectValue(inputs.sourceArtifactDataBundle);
  const comparativeAuditDataBundle = objectValue(inputs.comparativeAuditDataBundle);
  const companies = arrayValue(inputs.companies).length
    ? arrayValue(inputs.companies)
    : extractSpv5Companies(String(inputs.spv5Html || ''));
  const workUnits = normalizeWorkUnits({ targetPlan, sourceArtifactDataBundle, companies });
  const expectedClipCount = workUnits.reduce((count, unit) => count + unit.expected_clip_count, 0);
  const blockers = unique(workUnits.flatMap((unit) => unit.blockers));

  return {
    type: EMPLOYER_BRAND_ELEMENT_CAPTURE_PLANNING_BUNDLE_TYPE,
    schema_version: EMPLOYER_BRAND_ELEMENT_CAPTURE_PLANNING_BUNDLE_SCHEMA_VERSION,
    id: `element-capture-planning-bundle:${targetPlan.id || 'fixture'}`,
    label: `${targetPlan.label || 'Employer Brand Source Elements'} Capture Planning Bundle`,
    status: blockers.length ? 'planned_with_blockers' : 'planned_ready',
    inputs: {
      target_plan_path: 'source-artifacts/target-plan.json',
      source_artifact_data_bundle_path: 'source-artifacts/data-bundle.json',
      comparative_audit_data_bundle_path: 'data-bundle.json',
      spv5_html_path: '/Users/Michael/Desktop/SPv5.html',
      kilos_template_pdf_path: '/Users/Michael/Documents/DownloadedDecks/KILOS comp audit template.pdf',
      kilos_template_pptx_path: '/Users/Michael/Documents/DownloadedDecks/KILOS comp audit template.pptx',
    },
    source_plan: {
      id: targetPlan.id,
      schema: 'shared/schemas/employer-brand-source-artifact-target-plan-v0.schema.json',
      target_count: targetPlan.expected_totals?.target_count ?? arrayValue(targetPlan.targets).length,
      expected_clip_count: targetPlan.expected_totals?.expected_clip_count ?? expectedClipCount,
    },
    expansion: {
      company_count: companies.length,
      company_refs: companies.map((company) => cloneJson(company)),
      target_count: arrayValue(targetPlan.targets).length,
      work_unit_count: workUnits.length,
      expected_clip_count: expectedClipCount,
      expected_clip_count_preserved: expectedClipCount === targetPlan.expected_totals?.expected_clip_count,
      arbitrary_n_companies: true,
    },
    readiness: {
      locator_ready_count: workUnits.filter((unit) => unit.readiness_state === 'locator_ready').length,
      blocked_count: workUnits.filter((unit) => unit.readiness_state !== 'locator_ready').length,
      blockers,
    },
    work_units: workUnits,
    controls: {
      live_browser_collection_authorized: false,
      screenshot_generation_authorized: false,
      element_clip_generation_authorized: false,
      report_renderer_authorized: false,
      export_execution_authorized: false,
      workflow_engine_authorized: false,
      full_page_grabs_authorized: false,
    },
    provenance: {
      created_at: inputs.createdAt || null,
      comparative_audit_data_bundle_id: comparativeAuditDataBundle.id || null,
      read_only: true,
      planned_only: true,
      non_goals: cloneJson(NON_GOALS),
    },
  };
}

export function normalizeEmployerBrandElementClipManifest(inputs = {}) {
  const planningBundle = objectValue(inputs.planningBundle);
  return {
    type: EMPLOYER_BRAND_ELEMENT_CLIP_MANIFEST_TYPE,
    schema_version: EMPLOYER_BRAND_ELEMENT_CLIP_MANIFEST_SCHEMA_VERSION,
    id: `element-clip-manifest:${planningBundle.id || 'planned-only'}`,
    label: 'Employer Brand Element Clip Manifest V0 Planned Skeleton',
    status: 'planned_only_empty',
    planning_bundle: {
      id: planningBundle.id || null,
      path: 'source-artifacts/element-capture-planning-bundle.json',
      schema: 'shared/schemas/employer-brand-element-capture-planning-bundle-v0.schema.json',
    },
    expected: {
      target_count: planningBundle.source_plan?.target_count ?? 0,
      work_unit_count: planningBundle.expansion?.work_unit_count ?? 0,
      expected_clip_count: planningBundle.expansion?.expected_clip_count ?? 0,
    },
    clips: [],
    planned_slots: arrayValue(planningBundle.work_units).map((unit) => ({
      target_id: unit.target_id,
      work_unit_id: unit.id,
      company: unit.company_ref,
      source_artifact: cloneJson(unit.source_artifact),
      capture_type: unit.capture_type,
      clip_path: null,
      text_extract_path: null,
      text_extract_content: null,
      citation_refs: [],
      kilos_relevance: cloneJson(unit.kilos_relevance),
      acceptance_result: {
        status: 'not_run',
        criteria: cloneJson(unit.acceptance_criteria),
        notes: null,
      },
      provenance: {
        planned_only: true,
        read_only: true,
        non_goal_flags: cloneJson(NON_GOALS),
      },
    })),
    controls: {
      contains_actual_captures: false,
      local_spv5_html_only: false,
      live_browser_collection_authorized: false,
      remote_web_collection_authorized: false,
      pdf_capture_execution_authorized: false,
      pptx_capture_execution_authorized: false,
      screenshot_generation_authorized: false,
      element_clip_generation_authorized: false,
      report_renderer_authorized: false,
      export_execution_authorized: false,
      workflow_engine_authorized: false,
      full_page_grabs_authorized: false,
    },
    provenance: {
      created_at: inputs.createdAt || null,
      planning_bundle_id: planningBundle.id || null,
      planning_bundle_path: 'source-artifacts/element-capture-planning-bundle.json',
      manifest_path: 'source-artifacts/element-clip-manifest.planned.json',
      source_spv5_html_path: null,
      source_spv5_html_url: null,
      executor: null,
      read_only: true,
      planned_only: true,
      local_fixture_evidence_only: false,
      non_goals: cloneJson(NON_GOALS),
    },
  };
}

export function loadEmployerBrandElementCapturePlanningInputs({ fixtureRoot } = {}) {
  if (!fixtureRoot) throw new Error('fixtureRoot is required');
  const spv5Path = '/Users/Michael/Desktop/SPv5.html';
  return {
    targetPlan: readJson(resolveFixturePath(fixtureRoot, 'source-artifacts/target-plan.json')),
    sourceArtifactDataBundle: readJson(resolveFixturePath(fixtureRoot, 'source-artifacts/data-bundle.json')),
    comparativeAuditDataBundle: readJson(resolveFixturePath(fixtureRoot, 'data-bundle.json')),
    spv5Html: fs.existsSync(spv5Path) ? fs.readFileSync(spv5Path, 'utf8') : '',
  };
}

export function loadEmployerBrandElementCapturePlanningBundle({ fixtureRoot, createdAt = null } = {}) {
  return normalizeEmployerBrandElementCapturePlanningBundle({
    ...loadEmployerBrandElementCapturePlanningInputs({ fixtureRoot }),
    createdAt,
  });
}

export function validateEmployerBrandElementCapturePlanningBundle(bundle = {}) {
  const errors = [];
  if (bundle.type !== EMPLOYER_BRAND_ELEMENT_CAPTURE_PLANNING_BUNDLE_TYPE) errors.push('type must identify an Employer Brand Element Capture Planning Bundle');
  if (bundle.schema_version !== EMPLOYER_BRAND_ELEMENT_CAPTURE_PLANNING_BUNDLE_SCHEMA_VERSION) errors.push('schema_version must be v0');
  if (bundle.controls?.element_clip_generation_authorized !== false) errors.push('element clip generation must remain unauthorized');
  if (bundle.controls?.live_browser_collection_authorized !== false) errors.push('live browser collection must remain unauthorized');
  if (bundle.controls?.full_page_grabs_authorized !== false) errors.push('full-page grabs must remain unauthorized');
  if (bundle.expansion?.target_count !== bundle.source_plan?.target_count) errors.push('target count must preserve source plan target count');
  if (bundle.expansion?.expected_clip_count !== bundle.source_plan?.expected_clip_count) errors.push('expected clip count must preserve source plan expected clip count');
  if (!bundle.expansion?.arbitrary_n_companies) errors.push('expansion must be arbitrary-n company aware');
  if (!arrayValue(bundle.work_units).every((unit) => arrayValue(unit.kilos_relevance).every((dimension) => KILOS_DIMENSIONS.includes(dimension)))) errors.push('KILOS relevance must use KILOS dimension keys');
  if (arrayValue(bundle.work_units).some((unit) => unit.source_artifact?.kind !== 'html_spa' && unit.locator_hints?.selector !== null)) errors.push('non-HTML targets must not have selectors');
  return {
    valid: errors.length === 0,
    errors,
  };
}
