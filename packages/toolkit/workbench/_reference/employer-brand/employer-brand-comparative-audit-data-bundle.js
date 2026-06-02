import fs from 'node:fs';
import path from 'node:path';
import {
  normalizeEmployerBrandLiveEvidenceTargetPlan,
} from './employer-brand-live-evidence-target-plan.js';
import {
  normalizeEmployerBrandLiveEvidenceTargetReviewPack,
} from './employer-brand-live-evidence-target-review-pack.js';
import {
  normalizeEmployerBrandLiveEvidenceTargetPlan as normalizeReviewedEmployerBrandLiveEvidenceTargetPlan,
} from './employer-brand-live-evidence-target-plan.js';
import {
  normalizeEmployerBrandLiveEvidenceLocatorReadiness,
} from './employer-brand-live-evidence-locator-readiness.js';
import {
  normalizeEmployerBrandLiveEvidenceSupervisedLocatorPlan,
} from './employer-brand-live-evidence-supervised-locator-plan.js';
import {
  normalizeEmployerBrandLiveEvidenceUrlReachabilityCheck,
} from './employer-brand-live-evidence-url-reachability-check.js';
import {
  normalizeEmployerBrandLiveEvidenceUrlOpenRun,
} from './employer-brand-live-evidence-url-open-run.js';
import {
  normalizeEmployerBrandLiveEvidenceLocatorResolutionResult,
} from './employer-brand-live-evidence-locator-resolution-result.js';
import {
  normalizeEmployerBrandLiveEvidenceHumanLocatorReviewPack,
} from './employer-brand-live-evidence-human-locator-review-pack.js';
import {
  normalizeEmployerBrandLiveEvidenceReviewedLocatorCapturePlan,
} from './employer-brand-live-evidence-reviewed-locator-capture-plan.js';
import {
  normalizeEmployerBrandLiveEvidenceCaptureFailureReviewPack,
} from './employer-brand-live-evidence-capture-failure-review-pack.js';
import {
  normalizeEmployerBrandLiveEvidenceCaptureRepairPatch,
} from './employer-brand-live-evidence-capture-repair-patch.js';
import {
  normalizeEmployerBrandLiveEvidenceCaptureRepairPromotion,
  normalizeEmployerBrandLiveEvidenceRepairedLocatorCapturePlan,
} from './employer-brand-live-evidence-capture-repair-promotion.js';
import {
  normalizeEmployerBrandRepairedCaptureRuntimeDiagnostics,
} from './employer-brand-repaired-capture-runtime-diagnostics.js';
import {
  normalizeEmployerBrandRepairedCaptureVisibilityReviewPack,
} from './employer-brand-repaired-capture-visibility-review-pack.js';
import {
  normalizeEmployerBrandRepairedCaptureVisibilityRepairPatch,
} from './employer-brand-repaired-capture-visibility-repair-patch.js';

export const EMPLOYER_BRAND_COMPARATIVE_AUDIT_DATA_BUNDLE_TYPE = 'aos.employer_brand_comparative_audit_data_bundle';
export const EMPLOYER_BRAND_COMPARATIVE_AUDIT_DATA_BUNDLE_SCHEMA_VERSION = '2026-05-employer-brand-comparative-audit-data-bundle-v0';

const KILOS_DIMENSIONS = ['kinship', 'impact', 'lifestyle', 'opportunity', 'status'];
const DEFAULT_NON_GOALS = [
  'report_renderer',
  'html_css_polish',
  'pdf_export',
  'docx_export',
  'live_collection',
  'workflow_engine',
  'full_page_grabs',
];

function text(value, fallback = '') {
  const normalized = String(value ?? '').replace(/\s+/g, ' ').trim();
  return normalized || fallback;
}

function optionalText(value) {
  const normalized = text(value);
  return normalized || null;
}

function arrayValue(value) {
  return Array.isArray(value) ? value : [];
}

function objectValue(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function readJsonIfExists(file) {
  if (!fs.existsSync(file)) return null;
  return readJson(file);
}

function resolveFixturePath(fixtureRoot, relativePath) {
  return path.join(fixtureRoot, relativePath);
}

function projectCompanies(project) {
  const intake = objectValue(project.intake);
  return [
    objectValue(intake.client_company),
    ...arrayValue(intake.competitor_companies).map(objectValue),
  ].filter((company) => company.name);
}

function sourceByCompany(sources) {
  return new Map(arrayValue(sources.sources).map((source) => [source.company, source]));
}

function registryByRequest(registry) {
  return new Map(arrayValue(registry.evidence).map((evidence) => [evidence.request_id, evidence]));
}

function auditRequestIds(audit) {
  return unique([
    ...arrayValue(audit.provenance?.browser_evidence_request_ids),
    ...arrayValue(audit.cited_evidence).map((citation) => citation.request_id),
    ...arrayValue(audit.kilos_analysis).flatMap((row) => arrayValue(row.request_ids)),
    ...arrayValue(audit.evidence_backed_claims).flatMap((claim) => arrayValue(claim.request_ids)),
  ]);
}

function auditNonGoals(audit) {
  return unique([
    ...arrayValue(audit.provenance?.non_goals),
    ...(audit.scope?.report_generation === false ? ['report_generation'] : []),
    ...(audit.scope?.live_websites === false ? ['live_websites'] : []),
  ]);
}

function normalizeCitationFromRegistry(requestId, registryRows) {
  const row = registryRows.get(requestId);
  if (!row) {
    return {
      request_id: requestId,
      registry_status: 'missing',
      company: null,
      source_category: null,
      source_url: null,
      screenshot_path: null,
      captured_at: null,
    };
  }
  return {
    request_id: requestId,
    registry_status: row.status || 'unknown',
    company: row.company,
    source_category: row.source_category,
    source_url: row.source_url || row.url,
    screenshot_path: row.screenshot_path || null,
    captured_at: row.captured_at || null,
  };
}

function normalizeCompanyAudit({
  audit,
  auditPath,
  projectCompany,
  source,
  registryRows,
  coverageGap,
}) {
  const requestIds = auditRequestIds(audit);
  const companyCoverage = arrayValue(coverageGap?.by_company).find((row) => row.company === audit.company?.name) || null;
  const kilosAnalysis = arrayValue(audit.kilos_analysis).map((row) => ({
    dimension: text(row.dimension).toLowerCase(),
    factors: arrayValue(row.factors),
    interpretation: text(row.interpretation),
    request_ids: arrayValue(row.request_ids),
  }));

  return {
    name: audit.company?.name || projectCompany?.name || '',
    role: audit.company?.role || projectCompany?.role || '',
    website_url: source?.url || projectCompany?.website_url || null,
    audit_id: audit.id,
    path: auditPath,
    source_id: source?.id || null,
    registry_request_ids: requestIds,
    screenshot_paths: unique(requestIds.map((requestId) => registryRows.get(requestId)?.screenshot_path)),
    kilos_dimensions: kilosAnalysis,
    coverage_summary: {
      source_coverage: cloneJson(arrayValue(audit.source_coverage_summary)),
      planned_count: companyCoverage?.planned_count ?? null,
      captured_count: companyCoverage?.captured_count ?? requestIds.filter((requestId) => registryRows.get(requestId)?.status === 'captured').length,
      missing_planned_count: companyCoverage?.missing_planned_count ?? null,
      missing_source_categories: cloneJson(arrayValue(companyCoverage?.missing_source_categories)),
      missing_planned_request_ids: cloneJson(arrayValue(companyCoverage?.missing_planned_request_ids)),
    },
    citations: requestIds.map((requestId) => normalizeCitationFromRegistry(requestId, registryRows)),
    caveats: unique([
      ...arrayValue(audit.caveats),
      audit.employee_sentiment_and_review_sites?.caveat,
    ]),
    non_goals: auditNonGoals(audit),
    read_only: true,
    provenance_only: true,
  };
}

function normalizeComparativeAudit({ audit, auditPath, registryRows, companyAuditsById }) {
  const requestIds = unique([
    ...arrayValue(audit.comparative_synthesis?.request_ids),
    ...arrayValue(audit.citations).flatMap((citation) => arrayValue(citation.request_ids)),
    ...arrayValue(audit.kilos_positioning_matrix).flatMap((row) => arrayValue(row.request_ids)),
    ...arrayValue(audit.evidence_backed_claims).flatMap((claim) => arrayValue(claim.request_ids)),
  ]);
  const companyAuditIds = unique([
    ...arrayValue(audit.provenance?.derived_from_company_audit_ids),
    ...arrayValue(audit.source_company_audits).map((item) => item.id),
    ...arrayValue(audit.citations).map((citation) => citation.company_audit_id),
  ]);

  return {
    id: audit.id,
    path: auditPath,
    company_audit_ids: companyAuditIds,
    company_audit_paths: companyAuditIds.map((id) => companyAuditsById.get(id)?.path).filter(Boolean),
    companies: cloneJson(arrayValue(audit.companies)),
    kilos_dimensions: arrayValue(audit.kilos_positioning_matrix).map((row) => ({
      dimension: text(row.dimension).toLowerCase(),
      company_audit_ids: arrayValue(row.company_audit_ids),
      request_ids: arrayValue(row.request_ids),
      synthesis: text(row.synthesis),
    })),
    citation_integrity: {
      request_ids: requestIds,
      registry_request_ids_present: requestIds.every((requestId) => registryRows.has(requestId)),
      company_audit_ids_present: companyAuditIds.every((id) => companyAuditsById.has(id)),
    },
    citations: requestIds.map((requestId) => normalizeCitationFromRegistry(requestId, registryRows)),
    caveats: cloneJson(arrayValue(audit.caveats)),
    non_goals: unique([
      ...arrayValue(audit.provenance?.non_goals),
      ...(audit.scope?.report_generation === false ? ['report_generation'] : []),
      ...(audit.scope?.live_websites === false ? ['live_websites'] : []),
    ]),
    read_only: true,
    provenance_only: true,
  };
}

function normalizeKilos(companies, comparativeAudits) {
  return {
    framework: 'KILOS',
    dimensions: KILOS_DIMENSIONS.map((dimension) => ({
      dimension,
      companies: companies.map((company) => {
        const analysis = company.kilos_dimensions.find((row) => row.dimension === dimension) || null;
        return {
          company: company.name,
          role: company.role,
          present: Boolean(analysis),
          factors: cloneJson(arrayValue(analysis?.factors)),
          request_ids: cloneJson(arrayValue(analysis?.request_ids)),
        };
      }),
      comparative_present: comparativeAudits.some((audit) => audit.kilos_dimensions.some((row) => row.dimension === dimension)),
    })),
  };
}

function normalizeCoverage({ registry, coverageGap, companies }) {
  const evidence = arrayValue(registry.evidence);
  return {
    browser_evidence: {
      registry_status: registry.status || 'unknown',
      request_count: registry.summary?.request_count ?? evidence.length,
      captured_count: registry.summary?.captured_count ?? evidence.filter((row) => row.status === 'captured').length,
      failed_count: registry.summary?.failed_count ?? evidence.filter((row) => row.status === 'failed').length,
      local_fixture_pages_only: registry.capture_metadata?.fixture_backed === true,
      autonomous_browsing: registry.capture_metadata?.autonomous_browsing === true,
      provenance_only: registry.capture_metadata?.provenance_only === true,
    },
    planning: coverageGap ? {
      planned_count: coverageGap.coverage_summary?.planned_count ?? null,
      captured_count: coverageGap.coverage_summary?.captured_count ?? null,
      matched_request_count: coverageGap.coverage_summary?.matched_request_count ?? null,
      missing_planned_count: coverageGap.coverage_summary?.missing_planned_count ?? null,
      extra_captured_count: coverageGap.coverage_summary?.extra_captured_count ?? null,
      missing_planned_request_ids: cloneJson(arrayValue(coverageGap.coverage_summary?.missing_planned_request_ids)),
    } : null,
    by_company: companies.map((company) => ({
      company: company.name,
      planned_count: company.coverage_summary.planned_count,
      captured_count: company.coverage_summary.captured_count,
      missing_planned_count: company.coverage_summary.missing_planned_count,
      missing_source_categories: cloneJson(company.coverage_summary.missing_source_categories),
    })),
  };
}

function normalizeSourceArtifactTargets({
  sourceArtifactDataBundle,
  targetPlan,
  elementCapturePlanningBundle,
  elementClipManifest,
  elementClipAcceptanceReport,
}) {
  const targets = arrayValue(targetPlan.targets);
  return {
    data_bundle_id: sourceArtifactDataBundle.id,
    data_bundle_schema: 'shared/schemas/employer-brand-source-artifact-data-bundle-v0.schema.json',
    data_bundle_path: 'source-artifacts/data-bundle.json',
    target_plan_id: targetPlan.id || sourceArtifactDataBundle.target_plan?.id,
    target_plan_schema: sourceArtifactDataBundle.target_plan?.schema || 'shared/schemas/employer-brand-source-artifact-target-plan-v0.schema.json',
    target_plan_path: sourceArtifactDataBundle.target_plan?.path || 'source-artifacts/target-plan.json',
    source_artifacts: cloneJson(arrayValue(sourceArtifactDataBundle.source_artifacts)),
    target_count: sourceArtifactDataBundle.target_plan?.target_count ?? targets.length,
    expected_clip_count: sourceArtifactDataBundle.target_plan?.expected_clip_count
      ?? targets.reduce((count, target) => count + Number(target.expected_clip_count || 0), 0),
    target_ids: targets.map((target) => target.target_id),
    capture_unit: targetPlan.capture_scope?.capture_unit || null,
    full_page_grabs: sourceArtifactDataBundle.target_plan?.full_page_grabs === true,
    selectors_ready: sourceArtifactDataBundle.target_plan?.selectors_ready === true,
    xpath_ready: sourceArtifactDataBundle.target_plan?.xpath_ready === true,
    playwright_ready: sourceArtifactDataBundle.target_plan?.playwright_ready === true,
    codegen_ready: sourceArtifactDataBundle.target_plan?.codegen_ready === true,
    element_capture_planning: elementCapturePlanningBundle ? {
      planning_bundle_id: elementCapturePlanningBundle.id,
      planning_bundle_schema: 'shared/schemas/employer-brand-element-capture-planning-bundle-v0.schema.json',
      planning_bundle_path: 'source-artifacts/element-capture-planning-bundle.json',
      clip_manifest_schema: 'shared/schemas/employer-brand-element-clip-manifest-v0.schema.json',
      clip_manifest_path: 'source-artifacts/element-clip-manifest.json',
      planned_clip_manifest_path: 'source-artifacts/element-clip-manifest.planned.json',
      status: elementCapturePlanningBundle.status,
      work_unit_count: elementCapturePlanningBundle.expansion?.work_unit_count ?? 0,
      locator_ready_count: elementCapturePlanningBundle.readiness?.locator_ready_count ?? 0,
      blocked_count: elementCapturePlanningBundle.readiness?.blocked_count ?? 0,
      expected_clip_count: elementCapturePlanningBundle.expansion?.expected_clip_count ?? 0,
      clip_manifest_status: elementClipManifest?.status || null,
      actual_clip_count: arrayValue(elementClipManifest?.clips).length,
      planned_slot_count: arrayValue(elementClipManifest?.planned_slots).length,
      acceptance_report_schema: 'shared/schemas/employer-brand-element-clip-acceptance-report-v0.schema.json',
      acceptance_report_path: 'source-artifacts/element-clip-acceptance-report.json',
      acceptance_report_status: elementClipAcceptanceReport?.status || null,
      acceptance_captured_count: elementClipAcceptanceReport?.summary?.captured_count ?? 0,
      acceptance_blocked_count: elementClipAcceptanceReport?.summary?.blocked_count ?? 0,
      acceptance_failed_count: elementClipAcceptanceReport?.summary?.failed_count ?? 0,
      acceptance_not_run_count: elementClipAcceptanceReport?.summary?.not_run_count ?? 0,
      local_spv5_html_only: elementClipManifest?.controls?.local_spv5_html_only === true,
      full_page_grabs_authorized: elementClipManifest?.controls?.full_page_grabs_authorized === true,
      read_only: true,
      provenance_only: true,
      planned_only: elementClipManifest?.provenance?.planned_only !== false,
    } : null,
    non_goals: unique([
      ...arrayValue(sourceArtifactDataBundle.provenance?.non_goals),
      ...arrayValue(targetPlan.capture_scope?.non_goals),
      ...arrayValue(elementCapturePlanningBundle?.provenance?.non_goals),
    ]),
    read_only: true,
    provenance_only: true,
  };
}

function normalizeLiveEvidenceTargets(liveEvidenceTargetPlan, liveEvidenceTargetReviewPack, liveEvidenceTargetApprovalPatch, liveEvidenceReviewedTargetPlan, liveEvidenceLocatorReadiness, liveEvidenceSupervisedLocatorPlan, liveEvidenceUrlOpenRun, liveEvidenceUrlReachabilityCheck, liveEvidenceLocatorResolutionResult, liveEvidenceHumanLocatorReviewPack, liveEvidenceHumanLocatorApprovalPatch, liveEvidenceReviewedLocatorReadiness, liveEvidenceReviewedLocatorCapturePlan, liveEvidenceElementClipManifest, liveEvidenceCaptureFailureReviewPack, liveEvidenceCaptureRepairPatch, liveEvidenceCaptureRepairPromotion, liveEvidenceRepairedLocatorCapturePlan, liveEvidenceRepairedCaptureRuntimeDiagnostics, liveEvidenceRepairedCaptureVisibilityReviewPack, liveEvidenceRepairedCaptureVisibilityRepairPatch, liveEvidenceVisibilityAdjustedCapturePlan) {
  if (!liveEvidenceTargetPlan) return null;
  const normalized = normalizeEmployerBrandLiveEvidenceTargetPlan(liveEvidenceTargetPlan);
  const reviewPack = liveEvidenceTargetReviewPack
    ? normalizeEmployerBrandLiveEvidenceTargetReviewPack(liveEvidenceTargetReviewPack)
    : null;
  const reviewedPlan = liveEvidenceReviewedTargetPlan
    ? normalizeReviewedEmployerBrandLiveEvidenceTargetPlan(liveEvidenceReviewedTargetPlan)
    : null;
  const locatorReadiness = liveEvidenceLocatorReadiness
    ? normalizeEmployerBrandLiveEvidenceLocatorReadiness(liveEvidenceLocatorReadiness)
    : null;
  const supervisedLocatorPlan = liveEvidenceSupervisedLocatorPlan
    ? normalizeEmployerBrandLiveEvidenceSupervisedLocatorPlan(liveEvidenceSupervisedLocatorPlan)
    : null;
  const urlOpenRun = liveEvidenceUrlOpenRun
    ? normalizeEmployerBrandLiveEvidenceUrlOpenRun(liveEvidenceUrlOpenRun)
    : null;
  const urlReachabilityCheck = liveEvidenceUrlReachabilityCheck
    ? normalizeEmployerBrandLiveEvidenceUrlReachabilityCheck(liveEvidenceUrlReachabilityCheck)
    : null;
  const locatorResolutionResult = liveEvidenceLocatorResolutionResult
    ? normalizeEmployerBrandLiveEvidenceLocatorResolutionResult(liveEvidenceLocatorResolutionResult)
    : null;
  const humanLocatorReviewPack = liveEvidenceHumanLocatorReviewPack
    ? normalizeEmployerBrandLiveEvidenceHumanLocatorReviewPack(liveEvidenceHumanLocatorReviewPack)
    : null;
  const humanLocatorApprovalPatch = liveEvidenceHumanLocatorApprovalPatch ? objectValue(liveEvidenceHumanLocatorApprovalPatch) : null;
  const reviewedLocatorReadiness = liveEvidenceReviewedLocatorReadiness
    ? normalizeEmployerBrandLiveEvidenceLocatorReadiness(liveEvidenceReviewedLocatorReadiness)
    : null;
  const reviewedLocatorCapturePlan = liveEvidenceReviewedLocatorCapturePlan
    ? normalizeEmployerBrandLiveEvidenceReviewedLocatorCapturePlan(liveEvidenceReviewedLocatorCapturePlan)
    : null;
  const elementClipManifest = liveEvidenceElementClipManifest ? objectValue(liveEvidenceElementClipManifest) : null;
  const captureFailureReviewPack = liveEvidenceCaptureFailureReviewPack
    ? normalizeEmployerBrandLiveEvidenceCaptureFailureReviewPack(liveEvidenceCaptureFailureReviewPack)
    : null;
  const captureRepairPatch = liveEvidenceCaptureRepairPatch
    ? normalizeEmployerBrandLiveEvidenceCaptureRepairPatch(liveEvidenceCaptureRepairPatch)
    : null;
  const captureRepairPromotion = liveEvidenceCaptureRepairPromotion
    ? normalizeEmployerBrandLiveEvidenceCaptureRepairPromotion(liveEvidenceCaptureRepairPromotion)
    : null;
  const repairedLocatorCapturePlan = liveEvidenceRepairedLocatorCapturePlan
    ? normalizeEmployerBrandLiveEvidenceRepairedLocatorCapturePlan(liveEvidenceRepairedLocatorCapturePlan)
    : null;
  const repairedCaptureRuntimeDiagnostics = liveEvidenceRepairedCaptureRuntimeDiagnostics
    ? normalizeEmployerBrandRepairedCaptureRuntimeDiagnostics({
      manifest: elementClipManifest,
      capturePlan: repairedLocatorCapturePlan,
      ...objectValue(liveEvidenceRepairedCaptureRuntimeDiagnostics),
    })
    : null;
  const repairedCaptureVisibilityReviewPack = liveEvidenceRepairedCaptureVisibilityReviewPack
    ? normalizeEmployerBrandRepairedCaptureVisibilityReviewPack(liveEvidenceRepairedCaptureVisibilityReviewPack)
    : null;
  const repairedCaptureVisibilityRepairPatch = liveEvidenceRepairedCaptureVisibilityRepairPatch
    ? normalizeEmployerBrandRepairedCaptureVisibilityRepairPatch(liveEvidenceRepairedCaptureVisibilityRepairPatch)
    : null;
  const visibilityAdjustedCapturePlan = liveEvidenceVisibilityAdjustedCapturePlan
    ? objectValue(liveEvidenceVisibilityAdjustedCapturePlan)
    : null;
  const elementClipManifestRequiredNextActions = unique(
    arrayValue(elementClipManifest?.entries)
      .filter((entry) => entry.status === 'failed')
      .map((entry) => entry.required_next_action),
  );
  const decisionSummary = reviewedPlan?.review_decision_summary || null;
  return {
    target_plan_id: normalized.id,
    target_plan_schema: 'shared/schemas/employer-brand-live-evidence-target-plan-v0.schema.json',
    target_plan_path: 'live-evidence-target-plan.json',
    review_pack_id: reviewPack?.id || null,
    review_pack_schema: reviewPack ? 'shared/schemas/employer-brand-live-evidence-target-review-pack-v0.schema.json' : null,
    review_pack_path: reviewPack ? 'live-evidence-target-review-pack.json' : null,
    review_pack_status: reviewPack?.status || null,
    approval_patch_id: liveEvidenceTargetApprovalPatch?.id || null,
    approval_patch_schema: liveEvidenceTargetApprovalPatch ? 'shared/schemas/employer-brand-live-evidence-target-approval-patch-v0.schema.json' : null,
    approval_patch_path: liveEvidenceTargetApprovalPatch ? 'live-evidence-target-approval-patch.json' : null,
    reviewed_target_plan_id: reviewedPlan?.id || null,
    reviewed_target_plan_schema: reviewedPlan ? 'shared/schemas/employer-brand-live-evidence-target-plan-v0.schema.json' : null,
    reviewed_target_plan_path: reviewedPlan ? 'live-evidence-reviewed-target-plan.json' : null,
    reviewed_target_plan_status: reviewedPlan?.status || null,
    locator_readiness_id: locatorReadiness?.id || null,
    locator_readiness_schema: locatorReadiness ? 'shared/schemas/employer-brand-live-evidence-locator-readiness-v0.schema.json' : null,
    locator_readiness_path: locatorReadiness ? 'live-evidence-locator-readiness.json' : null,
    locator_readiness_status: locatorReadiness?.status || null,
    supervised_locator_plan_id: supervisedLocatorPlan?.id || null,
    supervised_locator_plan_schema: supervisedLocatorPlan ? 'shared/schemas/employer-brand-live-evidence-supervised-locator-plan-v0.schema.json' : null,
    supervised_locator_plan_path: supervisedLocatorPlan ? 'live-evidence-supervised-locator-plan.json' : null,
    supervised_locator_plan_status: supervisedLocatorPlan?.status || null,
    url_open_run_id: urlOpenRun?.id || null,
    url_open_run_schema: urlOpenRun ? 'shared/schemas/employer-brand-live-evidence-url-open-run-v0.schema.json' : null,
    url_open_run_path: urlOpenRun ? 'live-evidence-url-open-run.json' : null,
    url_open_run_status: urlOpenRun?.status || null,
    url_reachability_check_id: urlReachabilityCheck?.id || null,
    url_reachability_check_schema: urlReachabilityCheck ? 'shared/schemas/employer-brand-live-evidence-url-reachability-check-v0.schema.json' : null,
    url_reachability_check_path: urlReachabilityCheck ? 'live-evidence-url-reachability-check.json' : null,
    url_reachability_check_status: urlReachabilityCheck?.status || null,
    locator_resolution_result_id: locatorResolutionResult?.id || null,
    locator_resolution_result_schema: locatorResolutionResult ? 'shared/schemas/employer-brand-live-evidence-locator-resolution-result-v0.schema.json' : null,
    locator_resolution_result_path: locatorResolutionResult ? 'live-evidence-locator-resolution-result.json' : null,
    locator_resolution_result_status: locatorResolutionResult?.status || null,
    human_locator_review_pack_id: humanLocatorReviewPack?.id || null,
    human_locator_review_pack_schema: humanLocatorReviewPack ? 'shared/schemas/employer-brand-live-evidence-human-locator-review-pack-v0.schema.json' : null,
    human_locator_review_pack_path: humanLocatorReviewPack ? 'live-evidence-human-locator-review-pack.json' : null,
    human_locator_review_pack_status: humanLocatorReviewPack?.status || null,
    human_locator_approval_patch_id: humanLocatorApprovalPatch?.id || null,
    human_locator_approval_patch_schema: humanLocatorApprovalPatch ? 'shared/schemas/employer-brand-live-evidence-human-locator-approval-patch-v0.schema.json' : null,
    human_locator_approval_patch_path: humanLocatorApprovalPatch ? 'live-evidence-human-locator-approval-patch.json' : null,
    reviewed_locator_readiness_id: reviewedLocatorReadiness?.id || null,
    reviewed_locator_readiness_schema: reviewedLocatorReadiness ? 'shared/schemas/employer-brand-live-evidence-locator-readiness-v0.schema.json' : null,
    reviewed_locator_readiness_path: reviewedLocatorReadiness ? 'live-evidence-locator-readiness.reviewed.json' : null,
    reviewed_locator_readiness_status: reviewedLocatorReadiness?.status || null,
    reviewed_locator_capture_plan_id: reviewedLocatorCapturePlan?.id || null,
    reviewed_locator_capture_plan_schema: reviewedLocatorCapturePlan ? 'shared/schemas/employer-brand-live-evidence-reviewed-locator-capture-plan-v0.schema.json' : null,
    reviewed_locator_capture_plan_path: reviewedLocatorCapturePlan ? 'live-evidence-reviewed-locator-capture-plan.json' : null,
    reviewed_locator_capture_plan_status: reviewedLocatorCapturePlan?.status || null,
    live_element_clip_manifest_id: elementClipManifest?.id || null,
    live_element_clip_manifest_schema: elementClipManifest ? 'shared/schemas/employer-brand-live-evidence-element-clip-manifest-v0.schema.json' : null,
    live_element_clip_manifest_path: elementClipManifest ? 'source-artifacts/live-evidence-element-clip-manifest.json' : null,
    live_element_clip_manifest_status: elementClipManifest?.status || null,
    capture_failure_review_pack_id: captureFailureReviewPack?.id || null,
    capture_failure_review_pack_schema: captureFailureReviewPack ? 'shared/schemas/employer-brand-live-evidence-capture-failure-review-pack-v0.schema.json' : null,
    capture_failure_review_pack_path: captureFailureReviewPack ? 'live-evidence-capture-failure-review-pack.json' : null,
    capture_failure_review_pack_status: captureFailureReviewPack?.status || null,
    capture_repair_patch_id: captureRepairPatch?.id || null,
    capture_repair_patch_schema: captureRepairPatch ? 'shared/schemas/employer-brand-live-evidence-capture-repair-patch-v0.schema.json' : null,
    capture_repair_patch_path: captureRepairPatch ? 'live-evidence-capture-repair-patch.json' : null,
    capture_repair_patch_status: captureRepairPatch?.status || null,
    capture_repair_promotion_id: captureRepairPromotion?.id || null,
    capture_repair_promotion_schema: captureRepairPromotion ? 'shared/schemas/employer-brand-live-evidence-capture-repair-promotion-v0.schema.json' : null,
    capture_repair_promotion_path: captureRepairPromotion ? 'live-evidence-capture-repair-promotion.json' : null,
    capture_repair_promotion_status: captureRepairPromotion?.status || null,
    repaired_locator_capture_plan_id: repairedLocatorCapturePlan?.id || null,
    repaired_locator_capture_plan_schema: repairedLocatorCapturePlan ? 'shared/schemas/employer-brand-live-evidence-repaired-locator-capture-plan-v0.schema.json' : null,
    repaired_locator_capture_plan_path: repairedLocatorCapturePlan ? 'live-evidence-repaired-locator-capture-plan.json' : null,
    repaired_locator_capture_plan_status: repairedLocatorCapturePlan?.status || null,
    repaired_capture_runtime_diagnostics_id: repairedCaptureRuntimeDiagnostics?.id || null,
    repaired_capture_runtime_diagnostics_schema: repairedCaptureRuntimeDiagnostics ? 'shared/schemas/employer-brand-repaired-capture-runtime-diagnostics-v0.schema.json' : null,
    repaired_capture_runtime_diagnostics_path: repairedCaptureRuntimeDiagnostics ? 'live-evidence-repaired-capture-runtime-diagnostics.json' : null,
    repaired_capture_runtime_diagnostics_status: repairedCaptureRuntimeDiagnostics?.status || null,
    repaired_capture_visibility_review_pack_id: repairedCaptureVisibilityReviewPack?.id || null,
    repaired_capture_visibility_review_pack_schema: repairedCaptureVisibilityReviewPack ? 'shared/schemas/employer-brand-repaired-capture-visibility-review-pack-v0.schema.json' : null,
    repaired_capture_visibility_review_pack_path: repairedCaptureVisibilityReviewPack ? 'live-evidence-repaired-capture-visibility-review-pack.json' : null,
    repaired_capture_visibility_review_pack_status: repairedCaptureVisibilityReviewPack?.status || null,
    repaired_capture_visibility_repair_patch_id: repairedCaptureVisibilityRepairPatch?.id || null,
    repaired_capture_visibility_repair_patch_schema: repairedCaptureVisibilityRepairPatch ? 'shared/schemas/employer-brand-repaired-capture-visibility-repair-patch-v0.schema.json' : null,
    repaired_capture_visibility_repair_patch_path: repairedCaptureVisibilityRepairPatch ? 'live-evidence-repaired-capture-visibility-repair-patch.json' : null,
    repaired_capture_visibility_repair_patch_status: repairedCaptureVisibilityRepairPatch?.status || null,
    visibility_adjusted_capture_plan_id: visibilityAdjustedCapturePlan?.id || null,
    visibility_adjusted_capture_plan_schema: visibilityAdjustedCapturePlan ? 'shared/schemas/employer-brand-live-evidence-visibility-adjusted-capture-plan-v0.schema.json' : null,
    visibility_adjusted_capture_plan_path: visibilityAdjustedCapturePlan ? 'live-evidence-visibility-adjusted-capture-plan.json' : null,
    visibility_adjusted_capture_plan_status: visibilityAdjustedCapturePlan?.status || null,
    status: normalized.status,
    target_count: normalized.summary.target_count,
    expected_clip_count: normalized.summary.expected_clip_count,
    company_count: normalized.summary.company_count,
    source_category_count: normalized.summary.source_category_count,
    page_count: normalized.summary.page_count,
    review_pack_group_count: reviewPack?.groups.length ?? null,
    review_pack_locator_ready_count: reviewPack?.summary.locator_ready_count ?? null,
    review_pack_human_review_required_count: reviewPack?.summary.review_status_counts.human_review_required ?? null,
    review_pack_pending_decision_count: reviewPack?.summary.approval_decision_counts.null ?? null,
    decision_summary: decisionSummary ? cloneJson(decisionSummary) : null,
    reviewed_target_count: reviewedPlan?.summary.target_count ?? null,
    reviewed_expected_clip_count: reviewedPlan?.summary.expected_clip_count ?? null,
    reviewed_approved_count: reviewedPlan?.summary.review_status_counts.approved ?? null,
    reviewed_draft_count: reviewedPlan?.summary.review_status_counts.draft ?? null,
    reviewed_rejected_count: decisionSummary?.rejected_count ?? null,
    readiness_summary: locatorReadiness ? cloneJson(locatorReadiness.summary) : null,
    supervised_locator_plan_summary: supervisedLocatorPlan ? cloneJson(supervisedLocatorPlan.summary) : null,
    url_open_run_summary: urlOpenRun ? cloneJson(urlOpenRun.summary) : null,
    url_reachability_check_summary: urlReachabilityCheck ? cloneJson(urlReachabilityCheck.summary) : null,
    locator_resolution_summary: locatorResolutionResult ? cloneJson(locatorResolutionResult.summary) : null,
    human_locator_review_pack_summary: humanLocatorReviewPack ? cloneJson(humanLocatorReviewPack.summary) : null,
    human_locator_approval_patch_summary: humanLocatorApprovalPatch ? {
      decision_count: arrayValue(humanLocatorApprovalPatch.decisions).length,
      locator_ready_decision_count: arrayValue(humanLocatorApprovalPatch.decisions).filter((decision) => ['approve_selector', 'edit_selector', 'provide_xpath', 'provide_playwright_locator'].includes(decision.decision)).length,
      blocked_count: arrayValue(humanLocatorApprovalPatch.decisions).filter((decision) => decision.decision === 'mark_blocked').length,
      rejected_count: arrayValue(humanLocatorApprovalPatch.decisions).filter((decision) => decision.decision === 'reject_target').length,
      expected_ready_clip_count: reviewedLocatorReadiness?.summary?.expected_ready_clip_count ?? null,
    } : null,
    reviewed_locator_readiness_summary: reviewedLocatorReadiness ? cloneJson(reviewedLocatorReadiness.summary) : null,
    reviewed_locator_capture_plan_summary: reviewedLocatorCapturePlan ? cloneJson(reviewedLocatorCapturePlan.summary) : null,
    live_element_clip_manifest_summary: elementClipManifest ? cloneJson(elementClipManifest.summary) : null,
    live_element_clip_manifest_acceptance: elementClipManifest ? cloneJson(elementClipManifest.acceptance) : null,
    live_element_clip_manifest_required_next_actions: cloneJson(elementClipManifestRequiredNextActions),
    capture_failure_review_pack_summary: captureFailureReviewPack ? cloneJson(captureFailureReviewPack.summary) : null,
    capture_repair_patch_summary: captureRepairPatch ? cloneJson(captureRepairPatch.summary) : null,
    capture_repair_promotion_summary: captureRepairPromotion ? cloneJson(captureRepairPromotion.summary) : null,
    repaired_locator_capture_plan_summary: repairedLocatorCapturePlan ? cloneJson(repairedLocatorCapturePlan.summary) : null,
    repaired_capture_runtime_diagnostics_summary: repairedCaptureRuntimeDiagnostics ? cloneJson(repairedCaptureRuntimeDiagnostics.summary) : null,
    repaired_capture_visibility_review_pack_summary: repairedCaptureVisibilityReviewPack ? cloneJson(repairedCaptureVisibilityReviewPack.summary) : null,
    repaired_capture_visibility_repair_patch_summary: repairedCaptureVisibilityRepairPatch ? cloneJson(repairedCaptureVisibilityRepairPatch.summary) : null,
    visibility_adjusted_capture_plan_summary: visibilityAdjustedCapturePlan ? cloneJson(visibilityAdjustedCapturePlan.summary) : null,
    review_status_counts: cloneJson(normalized.summary.review_status_counts),
    kilos_dimensions: cloneJson(normalized.summary.kilos_dimensions),
    grouped_by_company: cloneJson(normalized.summary.grouped_by_company),
    grouped_by_source_category: cloneJson(normalized.summary.grouped_by_source_category),
    grouped_by_url_source_category: cloneJson(normalized.summary.grouped_by_url_source_category),
    controls: cloneJson(normalized.controls),
    locator_placeholders_nullable: normalized.targets.every((target) => Object.values(target.locator_placeholders).every((value) => value === null)),
    live_evidence_collected: normalized.provenance?.live_evidence_collected === true,
    selectors_resolved: normalized.provenance?.selectors_resolved === true,
    locator_readiness_planning_metadata_only: locatorReadiness?.provenance?.planning_metadata_only === true,
    supervised_locator_plan_planning_metadata_only: supervisedLocatorPlan?.provenance?.planning_metadata_only === true,
    url_open_run_executed_read_only_evidence: urlOpenRun ? urlOpenRun.status !== 'not_run_fixture' && urlOpenRun.controls?.bounded_target_url_open_authorized === true : false,
    url_reachability_check_planning_metadata_only: urlReachabilityCheck?.provenance?.planning_check_only === true,
    locator_resolution_read_only_planning_evidence: locatorResolutionResult?.provenance?.read_only_planning_evidence === true,
    human_locator_review_pack_read_only_planning_evidence: humanLocatorReviewPack?.provenance?.read_only === true
      && humanLocatorReviewPack?.provenance?.planning_metadata_only === true,
    human_locator_approval_patch_read_only_planning_evidence: humanLocatorApprovalPatch?.provenance?.read_only === true
      && humanLocatorApprovalPatch?.provenance?.planning_metadata_only === true,
    reviewed_locator_readiness_read_only_planning_evidence: reviewedLocatorReadiness?.provenance?.read_only === true
      && reviewedLocatorReadiness?.provenance?.planning_metadata_only === true,
    reviewed_locator_capture_plan_read_only_planning_evidence: reviewedLocatorCapturePlan?.provenance?.read_only === true
      && reviewedLocatorCapturePlan?.provenance?.planning_metadata_only === true,
    reviewed_locator_capture_plan_no_capture_assets_produced: reviewedLocatorCapturePlan?.provenance?.no_capture_assets_produced === true,
    live_element_clip_manifest_read_only_captured_evidence: elementClipManifest?.provenance?.read_only_captured_evidence === true,
    live_element_clip_manifest_no_full_page_grabs: elementClipManifest?.summary?.full_page_grab_count === 0
      && elementClipManifest?.acceptance?.full_page_grab_false === true,
    capture_failure_review_pack_read_only: captureFailureReviewPack?.provenance?.read_only === true,
    capture_failure_review_pack_no_repairs_fabricated: captureFailureReviewPack?.provenance?.repair_fields_initialized_null === true
      && captureFailureReviewPack.failures.every((failure) => Object.values(failure.repair).every((value) => value === null)),
    capture_repair_patch_template_only: captureRepairPatch?.provenance?.template_only === true,
    capture_repair_patch_no_unapproved_repairs: captureRepairPatch
      ? captureRepairPatch.repair_items.every((item) => item.repair.repair_decision !== null)
      : false,
    capture_repair_patch_read_only_context_count: captureRepairPatch?.summary?.read_only_context_entry_count ?? null,
    capture_repair_promotion_read_only_planning_evidence: captureRepairPromotion?.provenance?.read_only === true
      && captureRepairPromotion?.provenance?.planning_metadata_only === true,
    capture_repair_promotion_no_capture_assets_produced: captureRepairPromotion?.provenance?.no_capture_assets_produced === true,
    repaired_locator_capture_plan_read_only_planning_evidence: repairedLocatorCapturePlan?.provenance?.read_only === true
      && repairedLocatorCapturePlan?.provenance?.planning_metadata_only === true,
    repaired_locator_capture_plan_no_capture_assets_produced: repairedLocatorCapturePlan?.provenance?.no_capture_assets_produced === true,
    repaired_capture_runtime_diagnostics_read_only: repairedCaptureRuntimeDiagnostics?.provenance?.read_only === true
      && repairedCaptureRuntimeDiagnostics?.controls?.read_only_diagnostics === true,
    repaired_capture_runtime_diagnostics_runtime_failure_count: repairedCaptureRuntimeDiagnostics?.summary?.runtime_capture_invocation_failure_count ?? null,
    repaired_capture_runtime_diagnostics_locator_failure_count: repairedCaptureRuntimeDiagnostics?.summary?.locator_failure_count ?? null,
    repaired_capture_runtime_diagnostics_retry_after_runtime_repair_count: repairedCaptureRuntimeDiagnostics
      ? repairedCaptureRuntimeDiagnostics.repaired_slots.filter((slot) => slot.retry_eligibility === 'retry_after_runtime_repair').length
      : null,
    repaired_capture_visibility_review_pack_read_only: repairedCaptureVisibilityReviewPack?.provenance?.read_only === true
      && repairedCaptureVisibilityReviewPack?.controls?.read_only_review_pack === true,
    repaired_capture_visibility_review_pack_actionable_failure_count: repairedCaptureVisibilityReviewPack?.summary?.actionable_visibility_failure_count ?? null,
    repaired_capture_visibility_review_pack_asset_count_zero: repairedCaptureVisibilityReviewPack
      ? repairedCaptureVisibilityReviewPack.summary.actual_clip_asset_count === 0
        && repairedCaptureVisibilityReviewPack.summary.actual_text_asset_count === 0
      : null,
    repaired_capture_visibility_repair_patch_template_only: repairedCaptureVisibilityRepairPatch?.provenance?.template_only === true,
    repaired_capture_visibility_repair_patch_all_fields_null: repairedCaptureVisibilityRepairPatch?.summary?.all_repair_fields_null === true,
    repaired_capture_visibility_repair_patch_item_count: repairedCaptureVisibilityRepairPatch?.summary?.patchable_visibility_repair_item_count ?? null,
    visibility_adjusted_capture_plan_read_only_planning_evidence: visibilityAdjustedCapturePlan?.provenance?.read_only === true
      && visibilityAdjustedCapturePlan?.provenance?.planning_metadata_only === true,
    visibility_adjusted_capture_plan_no_capture_assets_produced: visibilityAdjustedCapturePlan?.provenance?.no_capture_assets_produced === true,
    read_only: true,
    planning_metadata_only: true,
    non_goals: cloneJson(arrayValue(normalized.provenance?.non_goals)),
  };
}

export function normalizeEmployerBrandComparativeAuditDataBundle(inputs = {}) {
  const project = objectValue(inputs.project);
  const sources = objectValue(inputs.sources);
  const sourceArtifactDataBundle = objectValue(inputs.sourceArtifactDataBundle);
  const targetPlan = objectValue(inputs.targetPlan);
  const elementCapturePlanningBundle = inputs.elementCapturePlanningBundle ? objectValue(inputs.elementCapturePlanningBundle) : null;
  const elementClipManifest = inputs.elementClipManifest ? objectValue(inputs.elementClipManifest) : null;
  const elementClipAcceptanceReport = inputs.elementClipAcceptanceReport ? objectValue(inputs.elementClipAcceptanceReport) : null;
  const liveEvidenceTargetPlan = inputs.liveEvidenceTargetPlan ? objectValue(inputs.liveEvidenceTargetPlan) : null;
  const liveEvidenceTargetReviewPack = inputs.liveEvidenceTargetReviewPack ? objectValue(inputs.liveEvidenceTargetReviewPack) : null;
  const liveEvidenceTargetApprovalPatch = inputs.liveEvidenceTargetApprovalPatch ? objectValue(inputs.liveEvidenceTargetApprovalPatch) : null;
  const liveEvidenceReviewedTargetPlan = inputs.liveEvidenceReviewedTargetPlan ? objectValue(inputs.liveEvidenceReviewedTargetPlan) : null;
  const liveEvidenceLocatorReadiness = inputs.liveEvidenceLocatorReadiness ? objectValue(inputs.liveEvidenceLocatorReadiness) : null;
  const liveEvidenceSupervisedLocatorPlan = inputs.liveEvidenceSupervisedLocatorPlan ? objectValue(inputs.liveEvidenceSupervisedLocatorPlan) : null;
  const liveEvidenceUrlOpenRun = inputs.liveEvidenceUrlOpenRun ? objectValue(inputs.liveEvidenceUrlOpenRun) : null;
  const liveEvidenceUrlReachabilityCheck = inputs.liveEvidenceUrlReachabilityCheck ? objectValue(inputs.liveEvidenceUrlReachabilityCheck) : null;
  const liveEvidenceLocatorResolutionResult = inputs.liveEvidenceLocatorResolutionResult ? objectValue(inputs.liveEvidenceLocatorResolutionResult) : null;
  const liveEvidenceHumanLocatorReviewPack = inputs.liveEvidenceHumanLocatorReviewPack ? objectValue(inputs.liveEvidenceHumanLocatorReviewPack) : null;
  const liveEvidenceHumanLocatorApprovalPatch = inputs.liveEvidenceHumanLocatorApprovalPatch ? objectValue(inputs.liveEvidenceHumanLocatorApprovalPatch) : null;
  const liveEvidenceReviewedLocatorReadiness = inputs.liveEvidenceReviewedLocatorReadiness ? objectValue(inputs.liveEvidenceReviewedLocatorReadiness) : null;
  const liveEvidenceReviewedLocatorCapturePlan = inputs.liveEvidenceReviewedLocatorCapturePlan ? objectValue(inputs.liveEvidenceReviewedLocatorCapturePlan) : null;
  const liveEvidenceElementClipManifest = inputs.liveEvidenceElementClipManifest ? objectValue(inputs.liveEvidenceElementClipManifest) : null;
  const liveEvidenceCaptureFailureReviewPack = inputs.liveEvidenceCaptureFailureReviewPack ? objectValue(inputs.liveEvidenceCaptureFailureReviewPack) : null;
  const liveEvidenceCaptureRepairPatch = inputs.liveEvidenceCaptureRepairPatch ? objectValue(inputs.liveEvidenceCaptureRepairPatch) : null;
  const liveEvidenceCaptureRepairPromotion = inputs.liveEvidenceCaptureRepairPromotion ? objectValue(inputs.liveEvidenceCaptureRepairPromotion) : null;
  const liveEvidenceRepairedLocatorCapturePlan = inputs.liveEvidenceRepairedLocatorCapturePlan ? objectValue(inputs.liveEvidenceRepairedLocatorCapturePlan) : null;
  const liveEvidenceRepairedCaptureRuntimeDiagnostics = inputs.liveEvidenceRepairedCaptureRuntimeDiagnostics ? objectValue(inputs.liveEvidenceRepairedCaptureRuntimeDiagnostics) : null;
  const liveEvidenceRepairedCaptureVisibilityReviewPack = inputs.liveEvidenceRepairedCaptureVisibilityReviewPack ? objectValue(inputs.liveEvidenceRepairedCaptureVisibilityReviewPack) : null;
  const liveEvidenceRepairedCaptureVisibilityRepairPatch = inputs.liveEvidenceRepairedCaptureVisibilityRepairPatch ? objectValue(inputs.liveEvidenceRepairedCaptureVisibilityRepairPatch) : null;
  const liveEvidenceVisibilityAdjustedCapturePlan = inputs.liveEvidenceVisibilityAdjustedCapturePlan ? objectValue(inputs.liveEvidenceVisibilityAdjustedCapturePlan) : null;
  const humanAlignmentPackPresent = inputs.humanAlignmentPackPresent === true;
  const registry = objectValue(inputs.browserEvidenceRegistry);
  const coverageGap = inputs.coverageGap ? objectValue(inputs.coverageGap) : null;
  const companyAuditPaths = arrayValue(inputs.companyAuditPaths);
  const comparativeAuditPaths = arrayValue(inputs.comparativeAuditPaths);
  const sourceMap = sourceByCompany(sources);
  const registryRows = registryByRequest(registry);
  const intakeCompanies = projectCompanies(project);
  const companyAudits = arrayValue(inputs.companyAudits);

  const companies = companyAudits.map((audit, index) => normalizeCompanyAudit({
    audit,
    auditPath: companyAuditPaths[index] || null,
    projectCompany: intakeCompanies.find((company) => company.name === audit.company?.name),
    source: sourceMap.get(audit.company?.name),
    registryRows,
    coverageGap,
  }));
  const companyAuditsById = new Map(companies.map((company) => [company.audit_id, company]));
  const comparativeAudits = arrayValue(inputs.comparativeAudits).map((audit, index) => normalizeComparativeAudit({
    audit,
    auditPath: comparativeAuditPaths[index] || null,
    registryRows,
    companyAuditsById,
  }));
  const allRequestIds = unique([
    ...companies.flatMap((company) => company.registry_request_ids),
    ...comparativeAudits.flatMap((audit) => audit.citation_integrity.request_ids),
  ]);
  const nonGoals = unique([
    ...DEFAULT_NON_GOALS,
    ...arrayValue(project.provenance?.non_goals),
    ...arrayValue(sources.provenance?.non_goals),
    ...arrayValue(sourceArtifactDataBundle.provenance?.non_goals),
    ...companies.flatMap((company) => company.non_goals),
    ...comparativeAudits.flatMap((audit) => audit.non_goals),
  ]);

  return {
    type: EMPLOYER_BRAND_COMPARATIVE_AUDIT_DATA_BUNDLE_TYPE,
    schema_version: EMPLOYER_BRAND_COMPARATIVE_AUDIT_DATA_BUNDLE_SCHEMA_VERSION,
    id: `employer-brand-comparative-audit-data-bundle:${project.project?.project_id || project.id || 'fixture'}`,
    label: `${project.label || 'Employer Brand Comparative Audit'} Data Bundle`,
    status: 'normalized',
    project: {
      id: project.id,
      project_id: project.project?.project_id || null,
      framework: project.project?.framework || 'KILOS',
      company_count: companies.length,
      client_company: companies.find((company) => company.role === 'client')?.name || null,
      competitor_companies: companies.filter((company) => company.role !== 'client').map((company) => company.name),
    },
    inputs: {
      project_path: 'intake/project.json',
      sources_path: 'sources.json',
      live_evidence_target_plan_path: liveEvidenceTargetPlan ? 'live-evidence-target-plan.json' : null,
      live_evidence_target_review_pack_path: liveEvidenceTargetReviewPack ? 'live-evidence-target-review-pack.json' : null,
      live_evidence_target_approval_patch_path: liveEvidenceTargetApprovalPatch ? 'live-evidence-target-approval-patch.json' : null,
      live_evidence_reviewed_target_plan_path: liveEvidenceReviewedTargetPlan ? 'live-evidence-reviewed-target-plan.json' : null,
      live_evidence_locator_readiness_path: liveEvidenceLocatorReadiness ? 'live-evidence-locator-readiness.json' : null,
      live_evidence_supervised_locator_plan_path: liveEvidenceSupervisedLocatorPlan ? 'live-evidence-supervised-locator-plan.json' : null,
      live_evidence_url_open_run_path: liveEvidenceUrlOpenRun ? 'live-evidence-url-open-run.json' : null,
      live_evidence_url_reachability_check_path: liveEvidenceUrlReachabilityCheck ? 'live-evidence-url-reachability-check.json' : null,
      live_evidence_locator_resolution_result_path: liveEvidenceLocatorResolutionResult ? 'live-evidence-locator-resolution-result.json' : null,
      live_evidence_human_locator_review_pack_path: liveEvidenceHumanLocatorReviewPack ? 'live-evidence-human-locator-review-pack.json' : null,
      live_evidence_human_locator_approval_patch_path: liveEvidenceHumanLocatorApprovalPatch ? 'live-evidence-human-locator-approval-patch.json' : null,
      live_evidence_reviewed_locator_readiness_path: liveEvidenceReviewedLocatorReadiness ? 'live-evidence-locator-readiness.reviewed.json' : null,
      live_evidence_reviewed_locator_capture_plan_path: liveEvidenceReviewedLocatorCapturePlan ? 'live-evidence-reviewed-locator-capture-plan.json' : null,
      live_evidence_element_clip_manifest_path: liveEvidenceElementClipManifest ? 'source-artifacts/live-evidence-element-clip-manifest.json' : null,
      live_evidence_capture_failure_review_pack_path: liveEvidenceCaptureFailureReviewPack ? 'live-evidence-capture-failure-review-pack.json' : null,
      live_evidence_capture_repair_patch_path: liveEvidenceCaptureRepairPatch ? 'live-evidence-capture-repair-patch.json' : null,
      live_evidence_capture_repair_promotion_path: liveEvidenceCaptureRepairPromotion ? 'live-evidence-capture-repair-promotion.json' : null,
      live_evidence_repaired_locator_capture_plan_path: liveEvidenceRepairedLocatorCapturePlan ? 'live-evidence-repaired-locator-capture-plan.json' : null,
      live_evidence_repaired_capture_runtime_diagnostics_path: liveEvidenceRepairedCaptureRuntimeDiagnostics ? 'live-evidence-repaired-capture-runtime-diagnostics.json' : null,
      live_evidence_repaired_capture_visibility_review_pack_path: liveEvidenceRepairedCaptureVisibilityReviewPack ? 'live-evidence-repaired-capture-visibility-review-pack.json' : null,
      live_evidence_repaired_capture_visibility_repair_patch_path: liveEvidenceRepairedCaptureVisibilityRepairPatch ? 'live-evidence-repaired-capture-visibility-repair-patch.json' : null,
      live_evidence_visibility_adjusted_capture_plan_path: liveEvidenceVisibilityAdjustedCapturePlan ? 'live-evidence-visibility-adjusted-capture-plan.json' : null,
      human_alignment_pack_path: humanAlignmentPackPresent ? 'human-alignment-pack.md' : null,
      source_artifact_data_bundle_path: 'source-artifacts/data-bundle.json',
      target_plan_path: 'source-artifacts/target-plan.json',
      browser_evidence_registry_path: 'browser-evidence/registry.json',
      browser_evidence_coverage_gap_path: coverageGap ? 'browser-evidence/coverage-gap.json' : null,
      company_audit_paths: cloneJson(companyAuditPaths),
      comparative_audit_paths: cloneJson(comparativeAuditPaths),
    },
    source_artifact_targets: normalizeSourceArtifactTargets({
      sourceArtifactDataBundle,
      targetPlan,
      elementCapturePlanningBundle,
      elementClipManifest,
      elementClipAcceptanceReport,
    }),
    live_evidence_targets: normalizeLiveEvidenceTargets(
      liveEvidenceTargetPlan,
      liveEvidenceTargetReviewPack,
      liveEvidenceTargetApprovalPatch,
      liveEvidenceReviewedTargetPlan,
      liveEvidenceLocatorReadiness,
      liveEvidenceSupervisedLocatorPlan,
      liveEvidenceUrlOpenRun,
      liveEvidenceUrlReachabilityCheck,
      liveEvidenceLocatorResolutionResult,
      liveEvidenceHumanLocatorReviewPack,
      liveEvidenceHumanLocatorApprovalPatch,
      liveEvidenceReviewedLocatorReadiness,
      liveEvidenceReviewedLocatorCapturePlan,
      liveEvidenceElementClipManifest,
      liveEvidenceCaptureFailureReviewPack,
      liveEvidenceCaptureRepairPatch,
      liveEvidenceCaptureRepairPromotion,
      liveEvidenceRepairedLocatorCapturePlan,
      liveEvidenceRepairedCaptureRuntimeDiagnostics,
      liveEvidenceRepairedCaptureVisibilityReviewPack,
      liveEvidenceRepairedCaptureVisibilityRepairPatch,
      liveEvidenceVisibilityAdjustedCapturePlan,
    ),
    companies,
    comparative_audits: comparativeAudits,
    kilos: normalizeKilos(companies, comparativeAudits),
    citations: {
      registry_request_ids: allRequestIds,
      registry_request_count: allRequestIds.length,
      missing_registry_request_ids: allRequestIds.filter((requestId) => !registryRows.has(requestId)),
      screenshot_paths: unique(allRequestIds.map((requestId) => registryRows.get(requestId)?.screenshot_path)),
      rows: allRequestIds.map((requestId) => normalizeCitationFromRegistry(requestId, registryRows)),
    },
    coverage: normalizeCoverage({ registry, coverageGap, companies }),
    controls: {
      report_renderer_authorized: false,
      report_artifact_authorized: false,
      export_execution_authorized: false,
      remote_web_collection_authorized: false,
      workflow_engine_authorized: false,
      full_page_grabs_authorized: false,
    },
    provenance: {
      created_at: optionalText(inputs.createdAt),
      read_only: true,
      provenance_only: true,
      local_fixture_evidence_only: true,
      human_alignment_pack: humanAlignmentPackPresent ? {
        path: 'human-alignment-pack.md',
        status: 'human_alignment_required',
        read_only: true,
        provenance_only: true,
        no_capture_authorization: true,
      } : null,
      arbitrary_n_companies: true,
      non_goals: unique([
        ...nonGoals,
        ...arrayValue(liveEvidenceTargetPlan?.provenance?.non_goals),
        ...arrayValue(liveEvidenceUrlReachabilityCheck?.provenance?.non_goals),
      ]),
    },
  };
}

export function loadEmployerBrandComparativeAuditDataBundleInputs({
  fixtureRoot,
} = {}) {
  if (!fixtureRoot) throw new Error('fixtureRoot is required');
  const project = readJson(resolveFixturePath(fixtureRoot, 'intake/project.json'));
  const links = objectValue(project.artifact_links);
  const companyAuditPaths = arrayValue(links.company_brand_audit_paths);
  const comparativeAuditPaths = arrayValue(links.comparative_brand_audit_paths);

  return {
    project,
    sources: readJson(resolveFixturePath(fixtureRoot, 'sources.json')),
    liveEvidenceTargetPlan: readJsonIfExists(resolveFixturePath(fixtureRoot, 'live-evidence-target-plan.json')),
    liveEvidenceTargetReviewPack: readJsonIfExists(resolveFixturePath(fixtureRoot, 'live-evidence-target-review-pack.json')),
    liveEvidenceTargetApprovalPatch: readJsonIfExists(resolveFixturePath(fixtureRoot, 'live-evidence-target-approval-patch.json')),
    liveEvidenceReviewedTargetPlan: readJsonIfExists(resolveFixturePath(fixtureRoot, 'live-evidence-reviewed-target-plan.json')),
    liveEvidenceLocatorReadiness: readJsonIfExists(resolveFixturePath(fixtureRoot, 'live-evidence-locator-readiness.json')),
    liveEvidenceSupervisedLocatorPlan: readJsonIfExists(resolveFixturePath(fixtureRoot, 'live-evidence-supervised-locator-plan.json')),
    liveEvidenceUrlOpenRun: readJsonIfExists(resolveFixturePath(fixtureRoot, 'live-evidence-url-open-run.json')),
    liveEvidenceUrlReachabilityCheck: readJsonIfExists(resolveFixturePath(fixtureRoot, 'live-evidence-url-reachability-check.json')),
    liveEvidenceLocatorResolutionResult: readJsonIfExists(resolveFixturePath(fixtureRoot, 'live-evidence-locator-resolution-result.json')),
    liveEvidenceHumanLocatorReviewPack: readJsonIfExists(resolveFixturePath(fixtureRoot, 'live-evidence-human-locator-review-pack.json')),
    liveEvidenceHumanLocatorApprovalPatch: readJsonIfExists(resolveFixturePath(fixtureRoot, 'live-evidence-human-locator-approval-patch.json')),
    liveEvidenceReviewedLocatorReadiness: readJsonIfExists(resolveFixturePath(fixtureRoot, 'live-evidence-locator-readiness.reviewed.json')),
    liveEvidenceReviewedLocatorCapturePlan: readJsonIfExists(resolveFixturePath(fixtureRoot, 'live-evidence-reviewed-locator-capture-plan.json')),
    liveEvidenceElementClipManifest: readJsonIfExists(resolveFixturePath(fixtureRoot, 'source-artifacts/live-evidence-element-clip-manifest.json')),
    liveEvidenceCaptureFailureReviewPack: readJsonIfExists(resolveFixturePath(fixtureRoot, 'live-evidence-capture-failure-review-pack.json')),
    liveEvidenceCaptureRepairPatch: readJsonIfExists(resolveFixturePath(fixtureRoot, 'live-evidence-capture-repair-patch.json')),
    liveEvidenceCaptureRepairPromotion: readJsonIfExists(resolveFixturePath(fixtureRoot, 'live-evidence-capture-repair-promotion.json')),
    liveEvidenceRepairedLocatorCapturePlan: readJsonIfExists(resolveFixturePath(fixtureRoot, 'live-evidence-repaired-locator-capture-plan.json')),
    liveEvidenceRepairedCaptureRuntimeDiagnostics: readJsonIfExists(resolveFixturePath(fixtureRoot, 'live-evidence-repaired-capture-runtime-diagnostics.json')),
    liveEvidenceRepairedCaptureVisibilityReviewPack: readJsonIfExists(resolveFixturePath(fixtureRoot, 'live-evidence-repaired-capture-visibility-review-pack.json')),
    liveEvidenceRepairedCaptureVisibilityRepairPatch: readJsonIfExists(resolveFixturePath(fixtureRoot, 'live-evidence-repaired-capture-visibility-repair-patch.json')),
    liveEvidenceVisibilityAdjustedCapturePlan: readJsonIfExists(resolveFixturePath(fixtureRoot, 'live-evidence-visibility-adjusted-capture-plan.json')),
    humanAlignmentPackPresent: fs.existsSync(resolveFixturePath(fixtureRoot, 'human-alignment-pack.md')),
    sourceArtifactDataBundle: readJson(resolveFixturePath(fixtureRoot, 'source-artifacts/data-bundle.json')),
    targetPlan: readJson(resolveFixturePath(fixtureRoot, 'source-artifacts/target-plan.json')),
    elementCapturePlanningBundle: readJsonIfExists(resolveFixturePath(fixtureRoot, 'source-artifacts/element-capture-planning-bundle.json')),
    elementClipManifest: readJsonIfExists(resolveFixturePath(fixtureRoot, 'source-artifacts/element-clip-manifest.json'))
      || readJsonIfExists(resolveFixturePath(fixtureRoot, 'source-artifacts/element-clip-manifest.planned.json')),
    elementClipAcceptanceReport: readJsonIfExists(resolveFixturePath(fixtureRoot, 'source-artifacts/element-clip-acceptance-report.json')),
    browserEvidenceRegistry: readJson(resolveFixturePath(fixtureRoot, 'browser-evidence/registry.json')),
    coverageGap: readJsonIfExists(resolveFixturePath(fixtureRoot, 'browser-evidence/coverage-gap.json')),
    companyAuditPaths,
    comparativeAuditPaths,
    companyAudits: companyAuditPaths.map((relativePath) => readJson(resolveFixturePath(fixtureRoot, relativePath))),
    comparativeAudits: comparativeAuditPaths.map((relativePath) => readJson(resolveFixturePath(fixtureRoot, relativePath))),
  };
}

export function loadEmployerBrandComparativeAuditDataBundle({
  fixtureRoot,
  createdAt = null,
} = {}) {
  return normalizeEmployerBrandComparativeAuditDataBundle({
    ...loadEmployerBrandComparativeAuditDataBundleInputs({ fixtureRoot }),
    createdAt,
  });
}

export function validateEmployerBrandComparativeAuditDataBundle(bundle = {}) {
  const errors = [];
  if (bundle.type !== EMPLOYER_BRAND_COMPARATIVE_AUDIT_DATA_BUNDLE_TYPE) errors.push('type must identify an Employer Brand Comparative Audit Data Bundle');
  if (bundle.schema_version !== EMPLOYER_BRAND_COMPARATIVE_AUDIT_DATA_BUNDLE_SCHEMA_VERSION) errors.push('schema_version must be v0');
  if (!Array.isArray(bundle.companies) || bundle.companies.length < 2) errors.push('companies must include an arbitrary n-company set of at least two companies');
  if (bundle.project?.company_count !== bundle.companies?.length) errors.push('project.company_count must equal companies.length');
  if (bundle.source_artifact_targets?.target_count !== bundle.source_artifact_targets?.target_ids?.length) errors.push('source target count must equal target_ids length');
  if (bundle.source_artifact_targets?.full_page_grabs !== false) errors.push('full_page_grabs must remain false');
  if (bundle.live_evidence_targets && bundle.live_evidence_targets.locator_placeholders_nullable !== true) errors.push('live evidence locator placeholders must remain nullable');
  if (bundle.live_evidence_targets?.controls?.full_page_grabs !== false) errors.push('live evidence full_page_grabs must remain false');
  if (bundle.live_evidence_targets?.controls?.live_collection_authorized !== false) errors.push('live evidence collection authority must remain false');
  if (bundle.live_evidence_targets?.review_pack_path && bundle.live_evidence_targets.review_pack_locator_ready_count !== 0) errors.push('live evidence review pack must not mark locators ready in V0');
  if (!bundle.live_evidence_targets?.approval_patch_path && bundle.live_evidence_targets?.review_pack_pending_decision_count !== bundle.live_evidence_targets?.target_count) errors.push('live evidence review pack must keep all approval decisions pending before approval patching');
  if (bundle.live_evidence_targets?.approval_patch_path && bundle.live_evidence_targets?.reviewed_target_count !== bundle.live_evidence_targets?.target_count - bundle.live_evidence_targets?.reviewed_rejected_count) errors.push('reviewed live evidence target count must exclude rejected targets');
  if (bundle.live_evidence_targets?.locator_readiness_path && bundle.live_evidence_targets?.readiness_summary?.excluded_rejected_count !== bundle.live_evidence_targets?.reviewed_rejected_count) errors.push('locator readiness excluded count must match reviewed rejected count');
  if (!bundle.live_evidence_targets?.url_open_run_path && bundle.live_evidence_targets?.locator_readiness_path && bundle.live_evidence_targets?.readiness_summary?.url_not_checked_count !== bundle.live_evidence_targets?.reviewed_target_count) errors.push('locator readiness must leave included URLs not_checked without URL-open evidence');
  if (bundle.live_evidence_targets?.supervised_locator_plan_path && bundle.live_evidence_targets?.supervised_locator_plan_summary?.executable_locator_unit_count !== bundle.live_evidence_targets?.readiness_summary?.needs_locator_count) errors.push('supervised locator executable units must match needs_locator readiness count');
  if (bundle.live_evidence_targets?.supervised_locator_plan_path && bundle.live_evidence_targets?.supervised_locator_plan_summary?.url_checks_performed !== false) errors.push('supervised locator plan must not perform URL checks');
  if (bundle.live_evidence_targets?.url_reachability_check_path && bundle.live_evidence_targets?.url_reachability_check_summary?.executable_target_count !== bundle.live_evidence_targets?.supervised_locator_plan_summary?.executable_locator_unit_count) errors.push('URL reachability executable count must match supervised locator executable count');
  if (bundle.live_evidence_targets?.url_open_run_path && bundle.live_evidence_targets?.url_open_run_status !== 'not_run_fixture' && bundle.live_evidence_targets?.url_open_run_executed_read_only_evidence !== true) errors.push('executed URL-open run must be marked as read-only evidence');
  if (!bundle.live_evidence_targets?.url_open_run_path && bundle.live_evidence_targets?.url_reachability_check_path && bundle.live_evidence_targets?.url_reachability_check_summary?.checked_count !== 0) errors.push('URL reachability dry-run fixture must not perform checks without URL-open evidence');
  if (!bundle.live_evidence_targets?.url_open_run_path && bundle.live_evidence_targets?.url_reachability_check_path && bundle.live_evidence_targets?.url_reachability_check_summary?.reachable_count !== 0) errors.push('URL reachability dry-run fixture must not mark targets reachable without URL-open evidence');
  if (bundle.live_evidence_targets?.locator_resolution_result_path && bundle.live_evidence_targets?.locator_resolution_summary?.locator_ready_count !== bundle.live_evidence_targets?.readiness_summary?.locator_ready_count) errors.push('locator resolution ready count must match readiness ready count for the fixture');
  if (bundle.live_evidence_targets?.human_locator_review_pack_path && bundle.live_evidence_targets?.human_locator_review_pack_summary?.locator_ready_count !== 0) errors.push('human locator review pack must not mark locators ready');
  if (bundle.live_evidence_targets?.human_locator_review_pack_path && bundle.live_evidence_targets?.human_locator_review_pack_summary?.ambiguous_locator_attempt_count !== bundle.live_evidence_targets?.locator_resolution_summary?.ambiguous_count) errors.push('human locator review ambiguous count must match locator resolution ambiguous count');
  if (bundle.live_evidence_targets?.human_locator_review_pack_path && bundle.live_evidence_targets?.human_locator_review_pack_summary?.needs_human_target_review_count !== bundle.live_evidence_targets?.readiness_summary?.needs_human_target_review_count) errors.push('human locator review target-review count must match readiness target-review count');
  if (bundle.live_evidence_targets?.human_locator_approval_patch_path && bundle.live_evidence_targets?.human_locator_approval_patch_read_only_planning_evidence !== true) errors.push('human locator approval patch must remain read-only planning evidence');
  if (bundle.live_evidence_targets?.reviewed_locator_readiness_path && bundle.live_evidence_targets?.reviewed_locator_readiness_summary?.locator_ready_count !== bundle.live_evidence_targets?.human_locator_approval_patch_summary?.locator_ready_decision_count) errors.push('reviewed locator readiness ready count must match explicit human-approved locator decisions');
  if (bundle.live_evidence_targets?.reviewed_locator_readiness_path && bundle.live_evidence_targets?.reviewed_locator_readiness_summary?.expected_ready_clip_count !== bundle.live_evidence_targets?.human_locator_approval_patch_summary?.expected_ready_clip_count) errors.push('reviewed locator readiness expected ready clips must reconcile');
  if (bundle.live_evidence_targets?.reviewed_locator_capture_plan_path && bundle.live_evidence_targets?.reviewed_locator_capture_plan_summary?.executable_unit_count !== bundle.live_evidence_targets?.reviewed_locator_readiness_summary?.locator_ready_count) errors.push('reviewed locator capture plan executable count must match reviewed locator-ready count');
  if (bundle.live_evidence_targets?.reviewed_locator_capture_plan_path && bundle.live_evidence_targets?.reviewed_locator_capture_plan_summary?.expected_ready_clip_count !== bundle.live_evidence_targets?.reviewed_locator_readiness_summary?.expected_ready_clip_count) errors.push('reviewed locator capture plan clip count must match reviewed readiness ready clips');
  if (
    bundle.live_evidence_targets?.reviewed_locator_capture_plan_path
    && !bundle.live_evidence_targets?.live_element_clip_manifest_path
    && bundle.live_evidence_targets?.reviewed_locator_capture_plan_no_capture_assets_produced !== true
  ) errors.push('reviewed locator capture plan must not produce capture assets until the live element clip manifest is present');
  if (bundle.live_evidence_targets?.live_element_clip_manifest_path && bundle.live_evidence_targets?.live_element_clip_manifest_read_only_captured_evidence !== true) errors.push('live element clip manifest must be read-only captured evidence');
  if (bundle.live_evidence_targets?.live_element_clip_manifest_path && bundle.live_evidence_targets?.live_element_clip_manifest_no_full_page_grabs !== true) errors.push('live element clip manifest must prove no full-page grabs');
  if (bundle.live_evidence_targets?.capture_failure_review_pack_path && bundle.live_evidence_targets?.capture_failure_review_pack_read_only !== true) errors.push('capture failure review pack must be read-only');
  if (bundle.live_evidence_targets?.capture_failure_review_pack_path && bundle.live_evidence_targets?.capture_failure_review_pack_no_repairs_fabricated !== true) errors.push('capture failure review pack must not fabricate repair fields');
  if (
    bundle.live_evidence_targets?.capture_failure_review_pack_path
    && bundle.live_evidence_targets?.live_element_clip_manifest_summary?.planned_output_slot_count !== 4
    && bundle.live_evidence_targets?.capture_failure_review_pack_summary?.failed_executable_slot_count !== bundle.live_evidence_targets?.live_element_clip_manifest_summary?.failed_slot_count
  ) errors.push('capture failure review pack failed count must match live element clip manifest');
  if (
    bundle.live_evidence_targets?.capture_failure_review_pack_path
    && bundle.live_evidence_targets?.live_element_clip_manifest_summary?.planned_output_slot_count !== 4
    && bundle.live_evidence_targets?.capture_failure_review_pack_summary?.accepted_capture_count !== bundle.live_evidence_targets?.live_element_clip_manifest_summary?.captured_slot_count
  ) errors.push('capture failure review pack accepted count must match live element clip manifest');
  if (
    bundle.live_evidence_targets?.capture_failure_review_pack_path
    && bundle.live_evidence_targets?.live_element_clip_manifest_summary?.planned_output_slot_count !== 4
    && bundle.live_evidence_targets?.capture_failure_review_pack_summary?.non_executable_context_count !== bundle.live_evidence_targets?.live_element_clip_manifest_summary?.blocked_not_run_count
  ) errors.push('capture failure review pack context count must match live element clip manifest');
  if (bundle.live_evidence_targets?.capture_repair_patch_path && bundle.live_evidence_targets?.capture_repair_patch_no_unapproved_repairs !== true) errors.push('capture repair patch must contain only reviewed repair decisions');
  if (bundle.live_evidence_targets?.capture_repair_patch_path && bundle.live_evidence_targets?.capture_repair_patch_summary?.patchable_repair_item_count !== bundle.live_evidence_targets?.capture_failure_review_pack_summary?.failed_executable_slot_count) errors.push('capture repair patch item count must match failed executable slots');
  if (bundle.live_evidence_targets?.capture_repair_patch_path && bundle.live_evidence_targets?.capture_repair_patch_summary?.read_only_context_entry_count !== bundle.live_evidence_targets?.capture_failure_review_pack_summary?.non_executable_context_count) errors.push('capture repair patch context count must match failure review context');
  if (bundle.live_evidence_targets?.capture_repair_promotion_path && bundle.live_evidence_targets?.capture_repair_promotion_read_only_planning_evidence !== true) errors.push('capture repair promotion must remain read-only planning evidence');
  if (bundle.live_evidence_targets?.capture_repair_promotion_path && bundle.live_evidence_targets?.capture_repair_promotion_no_capture_assets_produced !== true) errors.push('capture repair promotion must not produce capture assets');
  if (bundle.live_evidence_targets?.capture_repair_promotion_path && bundle.live_evidence_targets?.capture_repair_promotion_summary?.repaired_executable_slot_count !== 4) errors.push('capture repair promotion must promote four repaired executable slots');
  if (bundle.live_evidence_targets?.capture_repair_promotion_path && bundle.live_evidence_targets?.capture_repair_promotion_summary?.unavailable_source_slot_count !== 1) errors.push('capture repair promotion must preserve one unavailable source slot');
  if (bundle.live_evidence_targets?.repaired_locator_capture_plan_path && bundle.live_evidence_targets?.repaired_locator_capture_plan_read_only_planning_evidence !== true) errors.push('repaired locator capture plan must remain read-only planning evidence');
  if (bundle.live_evidence_targets?.repaired_locator_capture_plan_path && bundle.live_evidence_targets?.repaired_locator_capture_plan_no_capture_assets_produced !== true) errors.push('repaired locator capture plan must not produce capture assets');
  if (bundle.live_evidence_targets?.repaired_locator_capture_plan_path && bundle.live_evidence_targets?.repaired_locator_capture_plan_summary?.repaired_executable_slot_count !== bundle.live_evidence_targets?.capture_repair_promotion_summary?.repaired_executable_slot_count) errors.push('repaired locator plan executable count must match promotion');
  if (bundle.live_evidence_targets?.repaired_capture_runtime_diagnostics_path && bundle.live_evidence_targets?.repaired_capture_runtime_diagnostics_read_only !== true) errors.push('repaired capture runtime diagnostics must remain read-only');
  if (
    bundle.live_evidence_targets?.repaired_capture_runtime_diagnostics_path
    && (
      (bundle.live_evidence_targets?.repaired_capture_runtime_diagnostics_summary?.runtime_capture_invocation_failure_count ?? 0)
      + (bundle.live_evidence_targets?.repaired_capture_runtime_diagnostics_summary?.locator_failure_count ?? 0)
      + (bundle.live_evidence_targets?.repaired_capture_runtime_diagnostics_summary?.content_failure_count ?? 0)
    ) !== bundle.live_evidence_targets?.repaired_capture_runtime_diagnostics_summary?.failed_slot_count
  ) errors.push('repaired capture diagnostics must classify all failed slots');
  if (bundle.live_evidence_targets?.repaired_capture_runtime_diagnostics_path && bundle.live_evidence_targets?.repaired_capture_runtime_diagnostics_summary?.accepted_capture_count !== 0) errors.push('repaired capture runtime diagnostics accepted count must remain zero');
  if (bundle.live_evidence_targets?.repaired_capture_runtime_diagnostics_path && bundle.live_evidence_targets?.repaired_capture_runtime_diagnostics_summary?.actual_capture_file_count !== 0) errors.push('repaired capture runtime diagnostics actual capture file count must remain zero');
  if (
    bundle.live_evidence_targets?.repaired_capture_runtime_diagnostics_path
    && bundle.live_evidence_targets?.repaired_capture_runtime_diagnostics_retry_after_runtime_repair_count
      !== bundle.live_evidence_targets?.repaired_capture_runtime_diagnostics_runtime_failure_count
  ) errors.push('repaired capture runtime retry count must match runtime failures');
  if (
    bundle.live_evidence_targets?.live_element_clip_manifest_path
    && bundle.live_evidence_targets?.live_element_clip_manifest_status !== 'not_accepted'
    && bundle.live_evidence_targets?.live_element_clip_manifest_summary?.captured_slot_count !== bundle.live_evidence_targets?.reviewed_locator_capture_plan_summary?.planned_output_slot_count
  ) errors.push('live element clip manifest captured slots must match reviewed planned output slots');
  if (
    bundle.live_evidence_targets?.live_element_clip_manifest_path
    && bundle.live_evidence_targets?.live_element_clip_manifest_summary?.planned_output_slot_count !== 4
    && bundle.live_evidence_targets?.live_element_clip_manifest_summary?.blocked_not_run_count !== bundle.live_evidence_targets?.reviewed_locator_capture_plan_summary?.non_executable_context_count
  ) errors.push('live element clip manifest blocked context count must match reviewed capture plan context');
  if (
    bundle.live_evidence_targets?.live_element_clip_manifest_path
    && bundle.live_evidence_targets?.live_element_clip_manifest_summary?.planned_output_slot_count === 4
    && bundle.live_evidence_targets?.live_element_clip_manifest_summary?.blocked_not_run_count !== 15
  ) errors.push('repaired live element clip manifest blocked context count must preserve LinkedIn plus 14 context entries');
  if (
    bundle.live_evidence_targets?.locator_resolution_result_path
    && bundle.live_evidence_targets?.locator_resolution_result_status === 'not_run_fixture'
    && bundle.live_evidence_targets?.locator_resolution_summary?.attempted_count !== 0
  ) errors.push('not-run locator resolution fixture must not attempt resolution without an execution gate');
  if (bundle.citations?.missing_registry_request_ids?.length > 0) errors.push('all citations must resolve to Browser Evidence registry rows');
  if (!bundle.kilos?.dimensions?.every((row) => KILOS_DIMENSIONS.includes(row.dimension))) errors.push('kilos dimensions must use KILOS dimension keys');
  if (bundle.controls?.report_renderer_authorized !== false) errors.push('report renderer authority must remain false');
  if (bundle.controls?.workflow_engine_authorized !== false) errors.push('workflow engine authority must remain false');
  if (bundle.controls?.full_page_grabs_authorized !== false) errors.push('full-page grab authority must remain false');
  return {
    valid: errors.length === 0,
    errors,
  };
}
