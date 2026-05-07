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
const planningManifestUrl = new URL(`${fixtureRoot}browser-evidence/planning-manifest-skeleton.json`, repo);
const registryUrl = new URL(`${fixtureRoot}browser-evidence/registry.json`, repo);

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

  assert.equal(snapshot.read_only, true);
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
