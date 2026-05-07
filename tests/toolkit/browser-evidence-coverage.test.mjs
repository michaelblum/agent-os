import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  artifactBundleWorkbenchSnapshot,
  createArtifactBundleWorkbenchState,
  openArtifactBundle,
} from '../../packages/toolkit/components/artifact-bundle-workbench/model.js';
import {
  summarizeBrowserEvidencePlanningCoverage,
} from '../../packages/toolkit/workbench/browser-evidence-coverage.js';
import {
  createArtifactBundleSubject,
} from '../../packages/toolkit/workbench/artifact-bundle-subject.js';

const repo = new URL('../../', import.meta.url);
const fixtureRoot = 'docs/design/fixtures/aos-artifacts/employer-brand-comparative-audit/';
const subjectUrl = new URL(`${fixtureRoot}subject.json`, repo);
const workRecordUrl = new URL(`${fixtureRoot}work-record.json`, repo);
const planningManifestUrl = new URL(`${fixtureRoot}browser-evidence/planning-manifest-skeleton.json`, repo);
const registryUrl = new URL(`${fixtureRoot}browser-evidence/registry.json`, repo);
const coverageGapUrl = new URL(`${fixtureRoot}browser-evidence/coverage-gap.json`, repo);

async function readJson(url) {
  return JSON.parse(await readFile(url, 'utf8'));
}

function compactCoverageRows(summary) {
  return summary.by_company_source_category.map((row) => ({
    company: row.company,
    source_category: row.source_category,
    planned_count: row.planned_count,
    captured_count: row.captured_count,
    matched_request_count: row.matched_request_count,
    missing_planned_count: row.missing_planned_count,
    extra_captured_count: row.extra_captured_count,
    coverage_status: row.coverage_status,
  }));
}

function compactMissingRequestRows(requests) {
  return requests.map((request) => ({
    request_id: request.request_id,
    company: request.company,
    source_category: request.source_category,
    url: request.url,
    evidence_goal: request.evidence_goal,
  }));
}

function compactMissingCoverageRows(rows) {
  return rows
    .filter((row) => row.coverage_status === 'missing')
    .map((row) => ({
      company: row.company,
      source_category: row.source_category,
      coverage_status: row.coverage_status,
      planned_count: row.planned_count,
      captured_count: row.captured_count,
      missing_planned_count: row.missing_planned_count,
      missing_planned_request_ids: row.missing_planned_request_ids,
    }));
}

function assertDoesNotAuthorizeCollection(value) {
  for (const key of [
    'authorizes_collection',
    'remote_web_collection',
    'autonomous_browsing',
    'collection_execution',
    'workflow_execution',
    'report_generation',
    'export_execution',
    'replay',
    'repair',
    'macro_playback',
  ]) {
    assert.equal(value[key], false, `${key} should be false`);
  }
}

test('browser evidence coverage helper compares Employer Brand planning manifest against captured registry', async () => {
  const planningManifest = await readJson(planningManifestUrl);
  const registry = await readJson(registryUrl);
  const planningBefore = JSON.stringify(planningManifest);
  const registryBefore = JSON.stringify(registry);

  const summary = summarizeBrowserEvidencePlanningCoverage(planningManifest, registry);

  assert.equal(JSON.stringify(planningManifest), planningBefore);
  assert.equal(JSON.stringify(registry), registryBefore);
  assert.equal(summary.type, 'aos.browser_evidence_coverage_summary');
  assert.equal(summary.planned_count, 21);
  assert.equal(summary.captured_count, 3);
  assert.equal(summary.captured_status_count, 3);
  assert.equal(summary.matched_request_count, 3);
  assert.equal(summary.missing_planned_count, 18);
  assert.equal(summary.extra_captured_count, 0);
  assert.equal(summary.missing_planned_requests.length, 18);
  assert.equal(summary.extra_captured_requests.length, 0);
  assert.equal(summary.missing_planned_request_ids[0], 'symphony_talent_employer_brand_pages_planning');
  assert.deepEqual(summary.extra_captured_request_ids, []);

  assert.equal(summary.by_company_source_category.length, 21);
  const symphonyCareers = summary.by_company_source_category.find((row) => (
    row.company === 'Symphony Talent' && row.source_category === 'careers_site'
  ));
  assert.deepEqual({
    planned_count: symphonyCareers.planned_count,
    captured_count: symphonyCareers.captured_count,
    matched_request_count: symphonyCareers.matched_request_count,
    missing_planned_count: symphonyCareers.missing_planned_count,
    extra_captured_count: symphonyCareers.extra_captured_count,
    coverage_status: symphonyCareers.coverage_status,
  }, {
    planned_count: 1,
    captured_count: 1,
    matched_request_count: 1,
    missing_planned_count: 0,
    extra_captured_count: 0,
    coverage_status: 'matched',
  });

  const phenomReviews = summary.by_company_source_category.find((row) => (
    row.company === 'Phenom' && row.source_category === 'review_platforms'
  ));
  assert.equal(phenomReviews.planned_count, 1);
  assert.equal(phenomReviews.captured_count, 0);
  assert.equal(phenomReviews.coverage_status, 'missing');

  assert.deepEqual(summary.by_company.map((row) => [
    row.company,
    row.planned_count,
    row.captured_count,
    row.missing_planned_count,
    row.extra_captured_count,
  ]), [
    ['Symphony Talent', 7, 1, 6, 0],
    ['Phenom', 7, 1, 6, 0],
    ['Radancy', 7, 1, 6, 0],
  ]);
  assert.equal(summary.read_only, true);
  assert.equal(summary.provenance_only, true);
});

test('Employer Brand coverage gap fixture matches helper output and does not authorize collection', async () => {
  const planningManifest = await readJson(planningManifestUrl);
  const registry = await readJson(registryUrl);
  const coverageGap = await readJson(coverageGapUrl);
  const expected = summarizeBrowserEvidencePlanningCoverage(planningManifest, registry);

  assert.equal(coverageGap.type, 'aos.browser_evidence_coverage_gap');
  assert.equal(coverageGap.read_only, true);
  assert.equal(coverageGap.provenance_only, true);
  assert.equal(coverageGap.planning_artifact_only, true);
  assert.equal(coverageGap.authorizes_collection, false);
  assert.equal(coverageGap.collection_execution, false);
  assert.equal(coverageGap.derived_from.coverage_helper, 'packages/toolkit/workbench/browser-evidence-coverage.js#summarizeBrowserEvidencePlanningCoverage');
  assert.equal(coverageGap.derived_from.planning_manifest_path, 'browser-evidence/planning-manifest-skeleton.json');
  assert.equal(coverageGap.derived_from.captured_registry_path, 'browser-evidence/registry.json');

  assert.equal(coverageGap.coverage_summary.planned_count, expected.planned_count);
  assert.equal(coverageGap.coverage_summary.captured_count, expected.captured_count);
  assert.equal(coverageGap.coverage_summary.captured_status_count, expected.captured_status_count);
  assert.equal(coverageGap.coverage_summary.matched_request_count, expected.matched_request_count);
  assert.equal(coverageGap.coverage_summary.missing_planned_count, expected.missing_planned_count);
  assert.equal(coverageGap.coverage_summary.extra_captured_count, expected.extra_captured_count);
  assert.deepEqual(coverageGap.coverage_summary.missing_planned_request_ids, expected.missing_planned_request_ids);
  assert.deepEqual(coverageGap.coverage_summary.extra_captured_request_ids, expected.extra_captured_request_ids);

  assert.equal(coverageGap.missing_planned_requests.length, 18);
  assert.deepEqual(
    compactMissingRequestRows(coverageGap.missing_planned_requests),
    compactMissingRequestRows(expected.missing_planned_requests),
  );
  assert.deepEqual(
    compactMissingCoverageRows(coverageGap.by_company_source_category),
    compactMissingCoverageRows(expected.by_company_source_category),
  );
  assert.deepEqual(coverageGap.by_company.map((row) => [
    row.company,
    row.planned_count,
    row.captured_count,
    row.missing_planned_count,
    row.extra_captured_count,
    row.missing_source_categories,
  ]), [
    ['Symphony Talent', 7, 1, 6, 0, [
      'employer_brand_pages',
      'linkedin_presence',
      'review_platforms',
      'social_campaigns',
      'awards_recognition',
      'employee_stories',
    ]],
    ['Phenom', 7, 1, 6, 0, [
      'employer_brand_pages',
      'linkedin_presence',
      'review_platforms',
      'social_campaigns',
      'awards_recognition',
      'employee_stories',
    ]],
    ['Radancy', 7, 1, 6, 0, [
      'employer_brand_pages',
      'linkedin_presence',
      'review_platforms',
      'social_campaigns',
      'awards_recognition',
      'employee_stories',
    ]],
  ]);
  assert.deepEqual(coverageGap.by_source_category.map((row) => [
    row.source_category,
    row.coverage_policy,
    row.planned_count,
    row.captured_count,
    row.missing_planned_count,
  ]), [
    ['employer_brand_pages', 'attempt_if_available', 3, 0, 3],
    ['linkedin_presence', 'attempt_if_available', 3, 0, 3],
    ['review_platforms', 'required', 3, 0, 3],
    ['social_campaigns', 'optional', 3, 0, 3],
    ['awards_recognition', 'attempt_if_available', 3, 0, 3],
    ['employee_stories', 'optional', 3, 0, 3],
  ]);
  assert.match(coverageGap.evidence_still_needed_summary, /review platforms are required policy coverage/i);

  assertDoesNotAuthorizeCollection(coverageGap.authorization);
  assert.equal('open_ref' in coverageGap, false);
  assert.equal('can_open' in coverageGap, false);
  assert.equal('run_command' in coverageGap, false);
  assert.equal('collector' in coverageGap, false);
});

test('coverage gap fixture is linked from the Artifact Bundle subject and Work Record evidence trail', async () => {
  const subject = await readJson(subjectUrl);
  const workRecord = await readJson(workRecordUrl);
  const artifact = subject.artifacts.find((item) => item.id === 'employer-brand-report');
  const coverageGapRef = subject.subject_references.find((item) => item.id === 'browser-evidence-coverage-gap');
  const coverageGapFile = artifact.files.find((item) => item.path === 'browser-evidence/coverage-gap.json');
  const coverageGapEvidence = workRecord.evidence.find((item) => item.id === 'evidence:browser-evidence-coverage-gap');

  assert.equal(coverageGapRef.subject_type, 'aos.browser_evidence_coverage_gap');
  assert.equal(coverageGapRef.metadata.path, 'browser-evidence/coverage-gap.json');
  assert.equal(coverageGapRef.metadata.read_only, true);
  assert.equal(coverageGapRef.metadata.provenance_only, true);
  assert.equal(coverageGapRef.metadata.planning_artifact_only, true);
  assertDoesNotAuthorizeCollection(coverageGapRef.metadata);

  assert.equal(artifact.provenance.browser_evidence_coverage_gap, 'browser-evidence/coverage-gap.json');
  assert.equal(coverageGapFile.role, 'browser_evidence_coverage_gap');
  assert.equal(coverageGapFile.read_only, true);
  assert.equal(coverageGapFile.provenance_only, true);
  assert.equal(coverageGapFile.metadata.evidence_ref, 'evidence:browser-evidence-coverage-gap');
  assertDoesNotAuthorizeCollection(coverageGapFile.metadata);
  assert.ok(artifact.work_record.evidence_refs.includes('evidence:browser-evidence-coverage-gap'));

  assert.equal(coverageGapEvidence.kind, 'repo_file');
  assert.equal(coverageGapEvidence.metadata.path, 'browser-evidence/coverage-gap.json');
  assert.equal(coverageGapEvidence.metadata.read_only, true);
  assert.equal(coverageGapEvidence.metadata.provenance_only, true);
  assertDoesNotAuthorizeCollection(coverageGapEvidence.metadata);
  assert.ok(workRecord.verifier_report.evidence_refs.includes('evidence:browser-evidence-coverage-gap'));
  assert.ok(workRecord.execution_map.artifact_routes.some((route) => (
    route.destination === 'docs/design/fixtures/aos-artifacts/employer-brand-comparative-audit/browser-evidence/coverage-gap.json'
  )));
});

test('artifact bundle workbench exposes fixture coverage as read-only provenance metadata', async () => {
  const planningManifest = await readJson(planningManifestUrl);
  const registry = await readJson(registryUrl);
  const expected = summarizeBrowserEvidencePlanningCoverage(planningManifest, registry);
  const subject = createArtifactBundleSubject(await readJson(subjectUrl));
  const state = createArtifactBundleWorkbenchState({
    contentRoot: {
      name: 'repo-test',
      url: 'aos://repo-test/',
    },
  });

  openArtifactBundle(state, {
    type: 'artifact_bundle.open',
    subject,
    content_root: {
      name: 'repo-test',
      url: 'aos://repo-test/',
    },
  });
  const snapshot = artifactBundleWorkbenchSnapshot(state);
  const summary = snapshot.selected_source_evidence_metadata.browser_evidence_coverage_summary;
  const coverageGapEntry = snapshot.selected_source_evidence_metadata.entries.find((entry) => (
    entry.role === 'browser_evidence_coverage_gap'
  ));

  assert.equal(snapshot.read_only, true);
  assert.equal(coverageGapEntry.path, 'browser-evidence/coverage-gap.json');
  assert.equal(coverageGapEntry.read_only, true);
  assert.equal(coverageGapEntry.provenance_only, true);
  assert.equal(summary.read_only, true);
  assert.equal(summary.provenance_only, true);
  assert.equal(summary.semantic_ref, 'artifact-bundle-workbench:source-evidence:browser-evidence-coverage:employer-brand-report');
  assert.equal(summary.planned_count, expected.planned_count);
  assert.equal(summary.captured_count, expected.captured_count);
  assert.equal(summary.missing_planned_count, expected.missing_planned_count);
  assert.equal(summary.extra_captured_count, expected.extra_captured_count);
  assert.deepEqual(summary.missing_planned_request_ids, expected.missing_planned_request_ids);
  assert.deepEqual(summary.extra_captured_request_ids, expected.extra_captured_request_ids);
  assert.deepEqual(summary.by_company, expected.by_company);
  assert.deepEqual(compactCoverageRows(summary), compactCoverageRows(expected));
  assert.equal('open_ref' in summary, false);
  assert.equal('can_open' in summary, false);
});
