import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  ARTIFACT_BUNDLE_OPEN_TYPE,
  artifactBundleWorkbenchSnapshot,
  createArtifactBundleWorkbenchState,
  openArtifactBundle,
  openArtifactBundleLinkedWorkRecord,
} from '../../packages/toolkit/components/artifact-bundle-workbench/model.js';
import {
  createArtifactBundleSubjectCatalogEntry,
  createSubjectOpenRequestFromCatalogEntry,
  subjectCatalogEntryCanOpen,
} from '../../packages/toolkit/workbench/subject-catalog.js';
import {
  artifactBundleArtifacts,
  artifactBundleSummary,
  createArtifactBundleSubject,
} from '../../packages/toolkit/workbench/artifact-bundle-subject.js';
import {
  workRecordIsReadOnly,
} from '../../packages/toolkit/workbench/work-record.js';

const repo = new URL('../../', import.meta.url);
const fixtureRoot = 'docs/design/fixtures/aos-artifacts/employer-brand-comparative-audit/';
const subjectUrl = new URL(`${fixtureRoot}subject.json`, repo);
const sourcesUrl = new URL(`${fixtureRoot}sources.json`, repo);
const workRecordUrl = new URL(`${fixtureRoot}work-record.json`, repo);
const workRecordSchemaUrl = new URL('shared/schemas/aos-work-record-v0.schema.json', repo);
const employerBrandAuditProjectSchemaUrl = new URL('shared/schemas/employer-brand-audit-project-v0.schema.json', repo);
const employerBrandAuditProjectUrl = new URL(`${fixtureRoot}intake/project.json`, repo);
const browserEvidencePlanningManifestUrl = new URL(`${fixtureRoot}browser-evidence/planning-manifest-skeleton.json`, repo);
const browserEvidenceManifestUrl = new URL(`${fixtureRoot}browser-evidence/manifest.json`, repo);
const browserEvidenceRegistryUrl = new URL(`${fixtureRoot}browser-evidence/registry.json`, repo);
const browserEvidenceSchemaUrl = new URL('shared/schemas/browser-evidence-capture-v0.schema.json', repo);
const companyBrandAuditSchemaUrl = new URL('shared/schemas/company-brand-audit-v0.schema.json', repo);
const comparativeBrandAuditSchemaUrl = new URL('shared/schemas/comparative-brand-audit-v0.schema.json', repo);
const companyBrandAuditUrls = [
  new URL(`${fixtureRoot}company-audits/symphony-talent.json`, repo),
  new URL(`${fixtureRoot}company-audits/phenom.json`, repo),
  new URL(`${fixtureRoot}company-audits/radancy.json`, repo),
];
const comparativeBrandAuditUrl = new URL(`${fixtureRoot}comparative-audits/symphony-talent-phenom-radancy.json`, repo);

async function readJson(url) {
  return JSON.parse(await readFile(url, 'utf8'));
}

async function fixtureSubject() {
  return readJson(subjectUrl);
}

async function fixtureSources() {
  return readJson(sourcesUrl);
}

async function fixtureWorkRecord() {
  return readJson(workRecordUrl);
}

function validateJsonFixture(schemaUrl, instanceUrl) {
  return spawnSync(
    'python3',
    [
      '-c',
      `
import json, sys
from pathlib import Path
from jsonschema import Draft202012Validator

schema = json.loads(Path(sys.argv[1]).read_text())
instance = json.loads(Path(sys.argv[2]).read_text())
Draft202012Validator.check_schema(schema)
validator = Draft202012Validator(schema)
errors = sorted(validator.iter_errors(instance), key=lambda e: list(e.path))
if errors:
    for error in errors[:8]:
        print(error.message)
    sys.exit(1)
`,
      fileURLToPath(schemaUrl),
      fileURLToPath(instanceUrl),
    ],
    { encoding: 'utf8' },
  );
}

function validateWorkRecordFixture() {
  return validateJsonFixture(workRecordSchemaUrl, workRecordUrl);
}

function validateEmployerBrandAuditProjectFixture() {
  return validateJsonFixture(employerBrandAuditProjectSchemaUrl, employerBrandAuditProjectUrl);
}

function validateBrowserEvidenceFixture(fixtureUrl) {
  return validateJsonFixture(browserEvidenceSchemaUrl, fixtureUrl);
}

function validateCompanyBrandAuditFixture(fixtureUrl) {
  return validateJsonFixture(companyBrandAuditSchemaUrl, fixtureUrl);
}

function validateComparativeBrandAuditFixture(fixtureUrl) {
  return validateJsonFixture(comparativeBrandAuditSchemaUrl, fixtureUrl);
}

test('Employer Brand artifact bundle fixture carries a Markdown report and source metadata', async () => {
  const subject = createArtifactBundleSubject(await fixtureSubject());
  const sources = await fixtureSources();
  const artifacts = artifactBundleArtifacts(subject);

  assert.equal(subject.id, 'artifact-bundle:employer-brand-comparative-audit');
  assert.equal(subject.subject_type, 'aos.artifact_bundle');
  assert.equal(subject.source.path, fixtureRoot.replace(/\/$/, ''));
  assert.deepEqual(subject.capabilities, ['inspectable', 'exportable', 'verifier-target']);
  assert.equal('views' in subject, false);
  assert.equal('controls' in subject, false);
  assert.deepEqual(artifacts.map((artifact) => [artifact.id, artifact.kind]), [
    ['employer-brand-report', 'markdown'],
  ]);

  const report = artifacts[0];
  assert.equal(report.entry, 'report.md');
  assert.equal(report.renderer.id, 'aos.renderer.markdown.report');
  assert.ok(report.files.some((file) => file.path === 'sources.json' && file.role === 'source_metadata'));
  assert.ok(report.files.some((file) => file.path === 'intake/project.json' && file.role === 'employer_brand_audit_project'));
  assert.ok(report.files.some((file) => file.path === 'source-artifacts/data-bundle.json' && file.role === 'source_artifact_data_bundle'));
  assert.ok(report.files.some((file) => (
    file.path === 'live-evidence-capture-failure-review-pack.json'
    && file.role === 'live_evidence_capture_failure_review_pack'
    && file.schema === 'shared/schemas/employer-brand-live-evidence-capture-failure-review-pack-v0.schema.json'
    && file.metadata.failed_executable_slot_count === 5
    && file.metadata.no_repairs_fabricated === true
  )));
  assert.ok(report.files.some((file) => file.path === 'source-artifacts/target-plan.json' && file.role === 'source_artifact_target_plan'));
  assert.ok(report.files.some((file) => file.path === 'work-record.json' && file.role === 'work_record_fixture'));
  assert.ok(report.files.some((file) => file.path === 'browser-evidence/planning-manifest-skeleton.json' && file.role === 'browser_evidence_planning_manifest'));
  assert.ok(report.files.some((file) => file.path === 'browser-evidence/manifest.json' && file.role === 'browser_evidence_manifest'));
  assert.ok(report.files.some((file) => file.path === 'browser-evidence/registry.json' && file.role === 'browser_evidence_registry'));
  assert.equal(report.files.filter((file) => file.role === 'company_brand_audit').length, 3);
  assert.ok(report.files
    .filter((file) => file.role === 'company_brand_audit')
    .every((file) => file.schema === 'shared/schemas/company-brand-audit-v0.schema.json'));
  assert.equal(report.files.filter((file) => file.role === 'comparative_brand_audit').length, 1);
  assert.ok(report.files
    .filter((file) => file.role === 'comparative_brand_audit')
    .every((file) => file.schema === 'shared/schemas/comparative-brand-audit-v0.schema.json'));
  assert.equal(report.files.filter((file) => file.role === 'browser_evidence_fixture_page').length, 3);
  assert.equal(report.files.filter((file) => file.role === 'browser_evidence_crop').length, 3);
  assert.ok(report.exports.some((item) => item.kind === 'pdf' && item.status === 'not_generated'));
  assert.equal(report.provenance.work_record_id, 'work-record:employer-brand-comparative-audit-fixture');
  assert.equal(report.provenance.source_metadata, 'sources.json');
  assert.equal(report.provenance.employer_brand_audit_project_schema, 'shared/schemas/employer-brand-audit-project-v0.schema.json');
  assert.equal(report.provenance.employer_brand_audit_project, 'intake/project.json');
  assert.equal(report.provenance.browser_evidence_planning_manifest, 'browser-evidence/planning-manifest-skeleton.json');
  assert.equal(report.provenance.browser_evidence_registry, 'browser-evidence/registry.json');
  assert.deepEqual(report.provenance.company_brand_audits, [
    'company-audits/symphony-talent.json',
    'company-audits/phenom.json',
    'company-audits/radancy.json',
  ]);
  assert.deepEqual(report.provenance.comparative_brand_audits, [
    'comparative-audits/symphony-talent-phenom-radancy.json',
  ]);
  assert.equal(report.provenance.local_fixture_pages_only, true);
  assert.equal(report.provenance.provenance_only, true);
  assert.deepEqual(report.work_record.evidence_refs, [
    'evidence:markdown-report',
    'evidence:sources-metadata',
    'evidence:employer-brand-audit-project',
    'evidence:browser-evidence-planning-manifest',
    'evidence:subject-descriptor',
    'evidence:work-record-fixture',
    'evidence:browser-evidence-manifest',
    'evidence:browser-evidence-registry',
    'evidence:browser-evidence-coverage-gap',
    'evidence:company-brand-audit-symphony-talent',
    'evidence:company-brand-audit-phenom',
    'evidence:company-brand-audit-radancy',
    'evidence:comparative-brand-audit',
    'evidence:browser-evidence-fixture-assets',
  ]);

  const projectRef = subject.subject_references.find((ref) => ref.id === 'employer-brand-audit-project');
  assert.equal(projectRef.subject_type, 'aos.employer_brand_audit_project');
  assert.equal(projectRef.metadata.schema, 'shared/schemas/employer-brand-audit-project-v0.schema.json');
  assert.equal(projectRef.metadata.path, 'intake/project.json');
  assert.equal(projectRef.metadata.client_company, 'Symphony Talent');
  assert.deepEqual(projectRef.metadata.competitor_companies, ['Phenom', 'Radancy']);
  assert.equal(projectRef.metadata.project_instance_only, true);
  assert.equal(projectRef.metadata.read_only, true);
  assert.equal(projectRef.metadata.provenance_only, true);

  const planningManifestRef = subject.subject_references.find((ref) => ref.id === 'browser-evidence-planning-manifest');
  assert.equal(planningManifestRef.subject_type, 'aos.browser_evidence_capture_manifest');
  assert.equal(planningManifestRef.metadata.path, 'browser-evidence/planning-manifest-skeleton.json');
  assert.equal(planningManifestRef.metadata.request_count, 21);
  assert.equal(planningManifestRef.metadata.skeleton_only, true);
  assert.equal(planningManifestRef.metadata.collection_execution, false);
  assert.equal(planningManifestRef.metadata.provenance_only, true);

  const registryRef = subject.subject_references.find((ref) => ref.id === 'browser-evidence-registry');
  assert.equal(registryRef.subject_type, 'aos.browser_evidence_registry');
  assert.equal(registryRef.metadata.registry_path, 'browser-evidence/registry.json');
  assert.equal(registryRef.metadata.planning_manifest_path, 'browser-evidence/planning-manifest-skeleton.json');
  assert.equal(registryRef.metadata.local_fixture_pages_only, true);
  assert.equal(registryRef.metadata.provenance_only, true);
  const companyAuditRef = subject.subject_references.find((ref) => ref.id === 'company-brand-audits');
  assert.equal(companyAuditRef.subject_type, 'aos.company_brand_audit_set');
  assert.equal(companyAuditRef.metadata.schema, 'shared/schemas/company-brand-audit-v0.schema.json');
  assert.deepEqual(companyAuditRef.metadata.paths, [
    'company-audits/symphony-talent.json',
    'company-audits/phenom.json',
    'company-audits/radancy.json',
  ]);
  assert.equal(companyAuditRef.metadata.local_fixture_evidence_only, true);
  assert.equal(companyAuditRef.metadata.provenance_only, true);
  const comparativeAuditRef = subject.subject_references.find((ref) => ref.id === 'comparative-brand-audit');
  assert.equal(comparativeAuditRef.subject_type, 'aos.comparative_brand_audit');
  assert.equal(comparativeAuditRef.metadata.path, 'comparative-audits/symphony-talent-phenom-radancy.json');
  assert.equal(comparativeAuditRef.metadata.schema, 'shared/schemas/comparative-brand-audit-v0.schema.json');
  assert.deepEqual(comparativeAuditRef.metadata.company_audit_ids, [
    'company-brand-audit:symphony-talent',
    'company-brand-audit:phenom',
    'company-brand-audit:radancy',
  ]);
  assert.equal(comparativeAuditRef.metadata.local_fixture_evidence_only, true);
  assert.equal(comparativeAuditRef.metadata.provenance_only, true);

  assert.equal(sources.audit.client, 'Symphony Talent');
  assert.deepEqual(sources.audit.competitors, ['Phenom', 'Radancy']);
  assert.equal(sources.audit.project_id, 'employer-brand-audit-project:symphony-talent-phenom-radancy');
  assert.equal(sources.audit.project_path, 'intake/project.json');
  assert.equal(sources.sources.length, 3);
  assert.ok(sources.sources.every((source) => source.collection_status === 'not_collected_in_fixture'));
  assert.equal(sources.employer_brand_audit_project.schema, 'shared/schemas/employer-brand-audit-project-v0.schema.json');
  assert.equal(sources.employer_brand_audit_project.path, 'intake/project.json');
  assert.equal(sources.employer_brand_audit_project.project_instance_only, true);
  assert.equal(sources.employer_brand_audit_project.read_only, true);
  assert.equal(sources.employer_brand_audit_project.provenance_only, true);
  assert.equal(sources.source_artifact_data_bundle.schema, 'shared/schemas/employer-brand-source-artifact-data-bundle-v0.schema.json');
  assert.equal(sources.source_artifact_data_bundle.path, 'source-artifacts/data-bundle.json');
  assert.equal(sources.source_artifact_data_bundle.target_plan_path, 'source-artifacts/target-plan.json');
  assert.equal(sources.source_artifact_data_bundle.target_count, 13);
  assert.equal(sources.source_artifact_data_bundle.expected_clip_count, 44);
  assert.equal(sources.source_artifact_data_bundle.capture_unit, 'page_element');
  assert.equal(sources.source_artifact_data_bundle.full_page_grabs, false);
  assert.equal(sources.source_artifact_data_bundle.selectors_ready, false);
  assert.equal(sources.source_artifact_data_bundle.xpath_ready, false);
  assert.equal(sources.source_artifact_data_bundle.playwright_ready, false);
  assert.equal(sources.source_artifact_data_bundle.codegen_ready, false);
  assert.equal(sources.source_artifact_data_bundle.report_renderer_authorized, false);
  assert.equal(sources.source_artifact_data_bundle.report_artifact_authorized, false);
  assert.equal(sources.source_artifact_data_bundle.export_execution_authorized, false);
  assert.equal(sources.source_artifact_data_bundle.remote_web_collection_authorized, false);
  assert.equal(sources.source_artifact_data_bundle.workflow_engine_authorized, false);
  assert.deepEqual(sources.source_artifact_data_bundle.source_artifact_paths, [
    '/Users/Michael/Documents/DownloadedDecks/KILOS comp audit template.pptx',
    '/Users/Michael/Documents/DownloadedDecks/KILOS comp audit template.pdf',
    '/Users/Michael/Desktop/SPv5.html',
  ]);
  assert.equal(sources.browser_evidence_registry.path, 'browser-evidence/registry.json');
  assert.equal(sources.browser_evidence_registry.planning_manifest_path, 'browser-evidence/planning-manifest-skeleton.json');
  assert.equal(sources.browser_evidence_registry.local_fixture_pages_only, true);
  assert.equal(sources.browser_evidence_planning_manifest.path, 'browser-evidence/planning-manifest-skeleton.json');
  assert.equal(sources.browser_evidence_planning_manifest.request_count, 21);
  assert.equal(sources.browser_evidence_planning_manifest.skeleton_only, true);
  assert.equal(sources.browser_evidence_planning_manifest.collection_execution, false);
  assert.equal(sources.company_brand_audits.schema, 'shared/schemas/company-brand-audit-v0.schema.json');
  assert.deepEqual(sources.company_brand_audits.paths, [
    'company-audits/symphony-talent.json',
    'company-audits/phenom.json',
    'company-audits/radancy.json',
  ]);
  assert.equal(sources.comparative_brand_audit.schema, 'shared/schemas/comparative-brand-audit-v0.schema.json');
  assert.equal(sources.comparative_brand_audit.path, 'comparative-audits/symphony-talent-phenom-radancy.json');
  assert.equal(sources.comparative_brand_audit.local_fixture_evidence_only, true);
  assert.equal(sources.comparative_brand_audit.provenance_only, true);
  assert.ok(sources.provenance.non_goals.includes('generation'));
  assert.ok(sources.provenance.non_goals.includes('export_execution'));
});

test('Employer Brand Audit Project fixture scopes the bundle as one project instance', async () => {
  const validation = validateEmployerBrandAuditProjectFixture();
  assert.equal(validation.status, 0, `${validation.stdout}${validation.stderr}`);

  const subject = createArtifactBundleSubject(await fixtureSubject());
  const record = await fixtureWorkRecord();
  const project = await readJson(employerBrandAuditProjectUrl);
  const report = artifactBundleArtifacts(subject)[0];
  const projectFile = report.files.find((file) => file.role === 'employer_brand_audit_project');
  const projectEvidence = record.evidence.find((item) => item.id === 'evidence:employer-brand-audit-project');
  const projectClaim = record.claims.find((claim) => claim.id === 'claim:employer-brand-audit-project-linked');
  const projectPostcondition = record.execution_map.postconditions
    .find((postcondition) => postcondition.id === 'postcondition:employer-brand-audit-project-linked');

  assert.equal(project.intake.client_company.name, 'Symphony Talent');
  assert.deepEqual(project.intake.competitor_companies.map((company) => company.name), ['Phenom', 'Radancy']);
  assert.equal(project.provenance.project_instance_only, true);
  assert.equal(project.controls.remote_web_collection_authorized, false);
  assert.equal(project.controls.report_generation_authorized, false);
  assert.equal(project.artifact_links.artifact_bundle_id, subject.id);
  assert.equal(project.artifact_links.work_record_id, record.id);
  assert.equal(project.artifact_links.browser_evidence_planning_manifest_path, 'browser-evidence/planning-manifest-skeleton.json');
  assert.equal(project.artifact_links.read_only, true);
  assert.equal(project.artifact_links.provenance_only, true);

  assert.equal(projectFile.path, 'intake/project.json');
  assert.equal(projectFile.read_only, true);
  assert.equal(projectFile.provenance_only, true);
  assert.equal(projectFile.metadata.evidence_ref, 'evidence:employer-brand-audit-project');
  assert.equal(projectEvidence.metadata.schema, 'shared/schemas/employer-brand-audit-project-v0.schema.json');
  assert.equal(projectEvidence.metadata.path, 'intake/project.json');
  assert.equal(projectEvidence.metadata.project_instance_only, true);
  assert.equal(projectEvidence.metadata.read_only, true);
  assert.equal(projectEvidence.metadata.provenance_only, true);
  assert.match(projectClaim.text, /one project instance rather than the workflow/);
  assert.equal(projectPostcondition.check.expected, 'aos.employer_brand_audit_project');
  assert.ok(record.verifier_report.evidence_refs.includes('evidence:employer-brand-audit-project'));
  assert.ok(record.verifier_report.evidence_refs.includes('evidence:browser-evidence-planning-manifest'));
  assert.ok(record.verifier_report.derived_indexes.verified.includes('claim:employer-brand-audit-project-linked'));
  assert.ok(record.verifier_report.derived_indexes.verified.includes('claim:browser-evidence-planning-manifest-linked'));
});

test('Employer Brand artifact bundle links the source artifact data bundle without renderer or export authority', async () => {
  const subject = createArtifactBundleSubject(await fixtureSubject());
  const sources = await fixtureSources();
  const report = artifactBundleArtifacts(subject)[0];
  const dataBundleFile = report.files.find((file) => file.role === 'source_artifact_data_bundle');
  const targetPlanFile = report.files.find((file) => file.role === 'source_artifact_target_plan');
  const dataBundle = await readJson(new URL(`${fixtureRoot}source-artifacts/data-bundle.json`, repo));
  const targetPlan = await readJson(new URL(`${fixtureRoot}source-artifacts/target-plan.json`, repo));

  assert.equal(dataBundleFile.path, 'source-artifacts/data-bundle.json');
  assert.equal(dataBundleFile.schema, 'shared/schemas/employer-brand-source-artifact-data-bundle-v0.schema.json');
  assert.equal(dataBundleFile.read_only, true);
  assert.equal(dataBundleFile.provenance_only, true);
  assert.equal(dataBundleFile.metadata.target_count, 13);
  assert.equal(dataBundleFile.metadata.expected_clip_count, 44);
  assert.equal(dataBundleFile.metadata.full_page_grabs, false);
  assert.equal(dataBundleFile.metadata.report_renderer_authorized, false);
  assert.equal(dataBundleFile.metadata.report_artifact_authorized, false);
  assert.equal(dataBundleFile.metadata.export_execution_authorized, false);

  assert.equal(targetPlanFile.path, 'source-artifacts/target-plan.json');
  assert.equal(targetPlanFile.schema, 'shared/schemas/employer-brand-source-artifact-target-plan-v0.schema.json');
  assert.equal(targetPlanFile.read_only, true);
  assert.equal(targetPlanFile.provenance_only, true);
  assert.equal(targetPlanFile.metadata.capture_unit, 'page_element');
  assert.equal(targetPlanFile.metadata.full_page_grabs, false);
  assert.equal(targetPlanFile.metadata.selector, null);
  assert.equal(targetPlanFile.metadata.xpath, null);
  assert.equal(targetPlanFile.metadata.playwright_locator, null);
  assert.equal(targetPlanFile.metadata.codegen_hint, null);

  assert.equal(dataBundle.target_plan.target_count, targetPlan.targets.length);
  assert.equal(dataBundle.target_plan.expected_clip_count, targetPlan.expected_totals.expected_clip_count);
  assert.equal(sources.source_artifact_data_bundle.read_only, true);
  assert.equal(sources.source_artifact_data_bundle.provenance_only, true);
});

test('Employer Brand Browser Evidence registry validates and uses local fixture pages only', async () => {
  const planningValidation = validateBrowserEvidenceFixture(browserEvidencePlanningManifestUrl);
  const manifestValidation = validateBrowserEvidenceFixture(browserEvidenceManifestUrl);
  const registryValidation = validateBrowserEvidenceFixture(browserEvidenceRegistryUrl);
  assert.equal(planningValidation.status, 0, `${planningValidation.stdout}${planningValidation.stderr}`);
  assert.equal(manifestValidation.status, 0, `${manifestValidation.stdout}${manifestValidation.stderr}`);
  assert.equal(registryValidation.status, 0, `${registryValidation.stdout}${registryValidation.stderr}`);

  const planningManifest = await readJson(browserEvidencePlanningManifestUrl);
  const manifest = await readJson(browserEvidenceManifestUrl);
  const registry = await readJson(browserEvidenceRegistryUrl);

  assert.equal(planningManifest.metadata.skeleton_only, true);
  assert.equal(planningManifest.metadata.deterministic_planning_bridge, true);
  assert.equal(planningManifest.metadata.collection_execution, false);
  assert.equal(planningManifest.metadata.remote_web_collection, false);
  assert.equal(planningManifest.metadata.autonomous_browsing, false);
  assert.equal(planningManifest.requests.length, 21);
  assert.notEqual(planningManifest.manifest_id, manifest.manifest_id);
  assert.equal('evidence' in planningManifest, false);
  assert.equal('capture_metadata' in planningManifest, false);
  assert.equal(manifest.metadata.local_fixture_pages_only, true);
  assert.equal(manifest.metadata.live_websites, false);
  assert.equal(registry.type, 'aos.browser_evidence_registry');
  assert.equal(registry.status, 'completed');
  assert.equal(registry.summary.request_count, 3);
  assert.equal(registry.summary.captured_count, 3);
  assert.equal(registry.capture_metadata.autonomous_browsing, false);
  assert.equal(registry.capture_metadata.local_url_policy, 'file_data_or_localhost_only');
  assert.equal(registry.capture_metadata.provenance_only, true);

  for (const request of manifest.requests) {
    assert.match(request.url, /^html\//);
    assert.doesNotMatch(request.url, /^https?:\/\//);
    assert.match(request.notes, /Fixture page only/);
  }

  for (const request of planningManifest.requests) {
    assert.match(request.url, /^html\//);
    assert.doesNotMatch(request.url, /^https?:\/\//);
    assert.match(request.request_id, /_planning$/);
    assert.match(request.notes, /Planning skeleton only/);
    assert.deepEqual(request.kilos_relevance, []);
    assert.deepEqual(request.kilos_factors, []);
  }

  for (const item of registry.evidence) {
    assert.equal(item.status, 'captured');
    assert.match(item.source_url, /^html\//);
    assert.equal(item.capture_metadata.source_url_kind, 'relative_file');
    assert.equal(item.capture_metadata.autonomous_browsing, false);
    assert.equal(item.capture_metadata.fixture_backed, true);
    assert.equal(item.capture_metadata.provenance_only, true);
    assert.match(item.capture_metadata.resolved_source_url, /^repo:/);
    assert.match(item.screenshot_path, /^screenshots\//);
    await readFile(new URL(`${fixtureRoot}browser-evidence/${item.screenshot_path}`, repo));
  }
});

test('Employer Brand Company Brand Audit fixtures validate and cite registry evidence', async () => {
  const registry = await readJson(browserEvidenceRegistryUrl);
  const registryByRequest = new Map(registry.evidence.map((item) => [item.request_id, item]));

  for (const fixtureUrl of companyBrandAuditUrls) {
    const validation = validateCompanyBrandAuditFixture(fixtureUrl);
    assert.equal(validation.status, 0, `${validation.stdout}${validation.stderr}`);

    const audit = await readJson(fixtureUrl);
    assert.equal(audit.scope.registry_path, 'browser-evidence/registry.json');
    assert.equal(audit.scope.local_fixture_evidence_only, true);
    assert.equal(audit.scope.live_websites, false);
    assert.equal(audit.provenance.provenance_only, true);

    for (const citation of audit.cited_evidence) {
      const registryItem = registryByRequest.get(citation.request_id);
      assert.ok(registryItem, `${audit.id} cites unknown registry request ${citation.request_id}`);
      assert.equal(citation.company, registryItem.company);
      assert.equal(citation.source_url, registryItem.source_url);
      assert.equal(citation.screenshot_path, registryItem.screenshot_path);
      assert.equal(citation.status, registryItem.status);
    }
  }
});

test('Employer Brand Comparative Brand Audit fixture validates and cites local source audits', async () => {
  const validation = validateComparativeBrandAuditFixture(comparativeBrandAuditUrl);
  assert.equal(validation.status, 0, `${validation.stdout}${validation.stderr}`);

  const registry = await readJson(browserEvidenceRegistryUrl);
  const registryRequestIds = new Set(registry.evidence.map((item) => item.request_id));
  const companyAudits = await Promise.all(companyBrandAuditUrls.map(readJson));
  const companyAuditById = new Map(companyAudits.map((audit) => [audit.id, audit]));
  const audit = await readJson(comparativeBrandAuditUrl);

  assert.equal(audit.type, 'aos.comparative_brand_audit');
  assert.equal(audit.scope.local_fixture_evidence_only, true);
  assert.equal(audit.scope.live_websites, false);
  assert.equal(audit.provenance.provenance_only, true);
  assert.equal(audit.provenance.read_only, true);
  assert.deepEqual(audit.provenance.derived_from_company_audit_ids, [
    'company-brand-audit:symphony-talent',
    'company-brand-audit:phenom',
    'company-brand-audit:radancy',
  ]);

  for (const citation of audit.citations) {
    const companyAudit = companyAuditById.get(citation.company_audit_id);
    assert.ok(companyAudit, `${audit.id} cites unknown source audit ${citation.company_audit_id}`);
    assert.equal(citation.company, companyAudit.company.name);
    assert.equal(citation.role, companyAudit.company.role);
    assert.deepEqual(citation.request_ids, companyAudit.provenance.browser_evidence_request_ids);
    assert.ok(citation.request_ids.every((requestId) => registryRequestIds.has(requestId)));
  }
});

test('Employer Brand artifact bundle previews the Markdown report through the existing workbench model', async () => {
  const subject = createArtifactBundleSubject(await fixtureSubject());
  const state = createArtifactBundleWorkbenchState({
    contentRoot: {
      name: 'repo-test',
      url: 'aos://repo-test/',
    },
  });
  const result = openArtifactBundle(state, {
    type: ARTIFACT_BUNDLE_OPEN_TYPE,
    subject,
    content_root: {
      name: 'repo-test',
      url: 'aos://repo-test/',
    },
  });
  const snapshot = artifactBundleWorkbenchSnapshot(state);

  assert.equal(result.status, 'opened');
  assert.equal(snapshot.read_only, true);
  assert.equal(snapshot.selected_artifact_id, 'employer-brand-report');
  assert.equal(snapshot.preview.render_mode, 'markdown');
  assert.equal(
    snapshot.preview.url,
    'aos://repo-test/docs/design/fixtures/aos-artifacts/employer-brand-comparative-audit/report.md',
  );
  assert.equal(snapshot.selected_work_record_link.record_id, 'work-record:employer-brand-comparative-audit-fixture');
  assert.equal(snapshot.selected_work_record_link.record_path, 'work-record.json');
  assert.equal(snapshot.selected_work_record_link.can_open, true);
  assert.equal(snapshot.selected_work_record_summary.status, 'linked');
  assert.equal(snapshot.selected_work_record_summary.evidence_ref_count, 14);
  assert.equal(snapshot.selected_source_evidence_metadata.read_only, true);
  assert.equal(snapshot.selected_source_evidence_metadata.provenance_only, true);
  assert.deepEqual(snapshot.selected_source_evidence_metadata.browser_evidence_registry_paths, [
    'browser-evidence/registry.json',
  ]);
  assert.deepEqual(snapshot.selected_source_evidence_metadata.browser_evidence_manifest_paths, [
    'browser-evidence/manifest.json',
  ]);
  assert.deepEqual(snapshot.selected_source_evidence_metadata.browser_evidence_planning_manifest_paths, [
    'browser-evidence/planning-manifest-skeleton.json',
  ]);
  assert.equal(snapshot.selected_source_evidence_metadata.browser_evidence_entry_count, 10);
  assert.equal(snapshot.selected_source_evidence_metadata.local_fixture_page_count, 3);
  assert.equal(snapshot.selected_source_evidence_metadata.crop_count, 3);
  assert.equal(
    snapshot.selected_source_evidence_metadata.entries
      .filter((entry) => entry.role === 'company_brand_audit')
      .length,
    3,
  );
  assert.equal(
    snapshot.selected_source_evidence_metadata.entries
      .filter((entry) => entry.role === 'comparative_brand_audit')
      .length,
    1,
  );
  assert.ok(snapshot.selected_source_evidence_metadata.entries.every((entry) => entry.inspectable === true));
  assert.ok(snapshot.selected_source_evidence_metadata.entries.every((entry) => !('open_ref' in entry)));
  assert.ok(snapshot.selected_source_evidence_metadata.entries.every((entry) => !('can_open' in entry)));
  assert.deepEqual(artifactBundleSummary(subject), {
    artifact_count: 1,
    artifact_kinds: ['markdown'],
    renderer_ids: ['aos.renderer.markdown.report'],
    export_count: 2,
    validation_state: 'unchecked',
  });
});

test('Employer Brand artifact bundle opens the linked schema-v0 Work Record evidence summary', async () => {
  const validation = validateWorkRecordFixture();
  assert.equal(validation.status, 0, `${validation.stdout}${validation.stderr}`);

  const subject = createArtifactBundleSubject(await fixtureSubject());
  const record = await fixtureWorkRecord();
  const state = createArtifactBundleWorkbenchState({
    subject,
    contentRoot: {
      name: 'repo-test',
      url: 'aos://repo-test/',
    },
  });

  openArtifactBundle(state, {
    type: ARTIFACT_BUNDLE_OPEN_TYPE,
    subject,
    content_root: {
      name: 'repo-test',
      url: 'aos://repo-test/',
    },
  });
  const result = openArtifactBundleLinkedWorkRecord(state, { record });
  const snapshot = artifactBundleWorkbenchSnapshot(state);

  assert.equal(result.status, 'opened');
  assert.equal(result.record_id, 'work-record:employer-brand-comparative-audit-fixture');
  assert.equal(result.read_only, true);
  assert.equal(snapshot.linked_work_record_open.open_message.type, 'work_record.open');
  assert.equal(snapshot.linked_work_record_open.open_message.source.kind, 'artifact_bundle_work_record');
  assert.equal(snapshot.linked_work_record_open.open_message.source.artifact_id, 'employer-brand-report');
  assert.equal(snapshot.linked_work_record_open.workbench_snapshot.diagnostics.evidence_count, 14);
  assert.equal(snapshot.linked_work_record_open.workbench_snapshot.diagnostics.claim_count, 9);
  assert.equal(snapshot.linked_work_record_open.workbench_snapshot.diagnostics.verifier_status, 'passed');
  assert.equal(snapshot.selected_work_record_summary.snapshot_available, true);
  assert.equal(snapshot.selected_work_record_summary.evidence_count, 14);
  assert.equal(snapshot.selected_work_record_summary.claim_count, 9);
  assert.equal(snapshot.selected_work_record_summary.verified_claim_count, 9);
  assert.equal(snapshot.selected_work_record_summary.failed_claim_count, 0);
  assert.equal(snapshot.selected_work_record_summary.unverified_claim_count, 0);
  assert.equal(snapshot.selected_work_record_summary.health_state, 'valid');
  assert.equal(workRecordIsReadOnly(snapshot.linked_work_record_open.workbench_snapshot.record), true);
});

test('Employer Brand browser evidence links remain read-only and provenance-only', async () => {
  const subject = createArtifactBundleSubject(await fixtureSubject());
  const record = await fixtureWorkRecord();
  const registry = await readJson(browserEvidenceRegistryUrl);
  const report = artifactBundleArtifacts(subject)[0];
  const browserEvidenceFiles = report.files.filter((file) => file.role.startsWith('browser_evidence'));
  const companyAuditFiles = report.files.filter((file) => file.role === 'company_brand_audit');
  const comparativeAuditFiles = report.files.filter((file) => file.role === 'comparative_brand_audit');

  assert.equal(subject.capabilities.includes('editable'), false);
  assert.equal(subject.capabilities.includes('replayable'), false);
  assert.ok(browserEvidenceFiles.length > 0);
  assert.ok(browserEvidenceFiles.every((file) => file.read_only === true));
  assert.ok(browserEvidenceFiles.every((file) => file.provenance_only === true));
  assert.ok(browserEvidenceFiles.every((file) => file.metadata?.live_websites === false));
  assert.equal(companyAuditFiles.length, 3);
  assert.ok(companyAuditFiles.every((file) => file.read_only === true));
  assert.ok(companyAuditFiles.every((file) => file.provenance_only === true));
  assert.ok(companyAuditFiles.every((file) => file.metadata?.local_fixture_evidence_only === true));
  assert.equal(comparativeAuditFiles.length, 1);
  assert.ok(comparativeAuditFiles.every((file) => file.read_only === true));
  assert.ok(comparativeAuditFiles.every((file) => file.provenance_only === true));
  assert.ok(comparativeAuditFiles.every((file) => file.metadata?.local_fixture_evidence_only === true));

  const registryEvidence = record.evidence.find((item) => item.id === 'evidence:browser-evidence-registry');
  const manifestEvidence = record.evidence.find((item) => item.id === 'evidence:browser-evidence-manifest');
  const planningManifestEvidence = record.evidence.find((item) => item.id === 'evidence:browser-evidence-planning-manifest');
  const assetEvidence = record.evidence.find((item) => item.id === 'evidence:browser-evidence-fixture-assets');
  const projectEvidence = record.evidence.find((item) => item.id === 'evidence:employer-brand-audit-project');
  const companyAuditEvidence = record.evidence.filter((item) => item.metadata?.role === 'company_brand_audit');
  const comparativeAuditEvidence = record.evidence.find((item) => item.metadata?.role === 'comparative_brand_audit');
  assert.equal(projectEvidence.immutable, true);
  assert.equal(projectEvidence.metadata.read_only, true);
  assert.equal(projectEvidence.metadata.provenance_only, true);
  assert.equal(projectEvidence.metadata.project_instance_only, true);
  assert.equal(planningManifestEvidence.immutable, true);
  assert.equal(planningManifestEvidence.metadata.read_only, true);
  assert.equal(planningManifestEvidence.metadata.provenance_only, true);
  assert.equal(planningManifestEvidence.metadata.skeleton_only, true);
  assert.equal(planningManifestEvidence.metadata.collection_execution, false);
  assert.equal(planningManifestEvidence.metadata.remote_web_collection, false);
  assert.equal(planningManifestEvidence.metadata.autonomous_browsing, false);
  assert.equal(registryEvidence.immutable, true);
  assert.equal(registryEvidence.metadata.read_only, true);
  assert.equal(registryEvidence.metadata.provenance_only, true);
  assert.equal(manifestEvidence.metadata.local_fixture_pages_only, true);
  assert.equal(assetEvidence.metadata.live_websites, false);
  assert.equal(companyAuditEvidence.length, 3);
  assert.ok(companyAuditEvidence.every((item) => item.immutable === true));
  assert.ok(companyAuditEvidence.every((item) => item.metadata.read_only === true));
  assert.ok(companyAuditEvidence.every((item) => item.metadata.provenance_only === true));
  assert.equal(comparativeAuditEvidence.immutable, true);
  assert.equal(comparativeAuditEvidence.metadata.read_only, true);
  assert.equal(comparativeAuditEvidence.metadata.provenance_only, true);
  assert.equal(record.execution_map.replay_policy.mode, 'report_only');
  assert.deepEqual(record.execution_map.replay_policy.gate_refs, []);
  assert.equal(registry.capture_metadata.autonomous_browsing, false);
  assert.equal(registry.capture_metadata.provenance_only, true);
});

test('Employer Brand artifact bundle creates a canonical open request and generic launch path', async () => {
  const subject = createArtifactBundleSubject(await fixtureSubject());
  const entry = createArtifactBundleSubjectCatalogEntry(subject, {
    contentRoot: {
      name: 'repo-test',
      url: 'aos://repo-test/',
    },
  });
  const request = createSubjectOpenRequestFromCatalogEntry(entry, {
    requestId: 'employer-brand-artifact-open-test',
  });
  const launch = await readFile(new URL('packages/toolkit/components/artifact-bundle-workbench/launch.sh', repo), 'utf8');
  const indexJs = await readFile(new URL('packages/toolkit/components/artifact-bundle-workbench/index.js', repo), 'utf8');

  assert.equal(subjectCatalogEntryCanOpen(entry), true);
  assert.equal(request.open_message.type, 'artifact_bundle.open');
  assert.equal(request.open_message.subject.id, 'artifact-bundle:employer-brand-comparative-audit');
  assert.equal(request.open_message.content_root.url, 'aos://repo-test/');
  assert.match(launch, /last_result\?\.status === "opened"/);
  assert.doesNotMatch(launch, /selected_artifact_id === "html-prototype"/);
  assert.match(indexJs, /source-evidence-metadata/);
  assert.doesNotMatch(indexJs, /browser-evidence-viewer/);
  assert.doesNotMatch(indexJs, /company-brand-audit-viewer/);
  assert.doesNotMatch(indexJs, /comparative-brand-audit-viewer/);
  assert.doesNotMatch(indexJs, /company_brand_audit\.open/);
  assert.doesNotMatch(indexJs, /comparative_brand_audit\.open/);
  assert.doesNotMatch(indexJs, /browser_evidence\.open/);
});
