import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  ARTIFACT_BUNDLE_WORKBENCH_URL,
  SUBJECT_CATALOG_LOAD_TYPE,
  SUBJECT_OPEN_REQUEST_TYPE,
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
  ARTIFACT_BUNDLE_OPEN_TYPE,
  ARTIFACT_BUNDLE_WORKBENCH_SURFACE,
  artifactBundleWorkbenchSnapshot,
  createArtifactBundleWorkbenchState,
  openArtifactBundle,
  openArtifactBundleLinkedWorkRecord,
  selectArtifactBundleArtifact,
} from '../../packages/toolkit/components/artifact-bundle-workbench/model.js';
import {
  workRecordIsReadOnly,
} from '../../packages/toolkit/workbench/work-record.js';
import {
  WIKI_SUBJECT_BROWSER_ARTIFACT_BUNDLE_CANVAS_ID,
  applySubjectCatalogLoad,
  applySubjectOpenRequested,
  createWikiSubjectBrowserOpenRequestFromCatalogEntry,
  createWikiSubjectBrowserState,
  wikiSubjectBrowserSnapshot,
} from '../../packages/toolkit/components/wiki-subject-browser/model.js';

const repo = new URL('../../', import.meta.url);
const fixtureUrl = new URL('docs/design/fixtures/aos-artifacts/example-design-pass/subject.json', repo);
const workRecordFixtureUrl = new URL('docs/design/fixtures/aos-artifacts/example-design-pass/work-record.json', repo);
const workRecordSchemaUrl = new URL('shared/schemas/aos-work-record-v0.schema.json', repo);

async function fixtureSubject() {
  return JSON.parse(await readFile(fixtureUrl, 'utf8'));
}

async function fixtureWorkRecord() {
  return JSON.parse(await readFile(workRecordFixtureUrl, 'utf8'));
}

function validateWorkRecordFixture() {
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
      fileURLToPath(workRecordSchemaUrl),
      fileURLToPath(workRecordFixtureUrl),
    ],
    { encoding: 'utf8' },
  );
}

test('artifact bundle fixture uses canonical Workbench Subject fields', async () => {
  const fixture = await fixtureSubject();
  const subject = createArtifactBundleSubject(fixture);

  assert.equal(subject.type, 'aos.workbench.subject');
  assert.equal(subject.schema_version, '2026-05-03');
  assert.equal(subject.id, 'artifact-bundle:example-design-pass');
  assert.equal(subject.subject_type, 'aos.artifact_bundle');
  assert.equal(subject.owner, 'aos-artifact-workbench');
  assert.equal(subject.source.path, 'docs/design/fixtures/aos-artifacts/example-design-pass');
  assert.deepEqual(subject.capabilities, ['inspectable', 'exportable', 'verifier-target']);
  assert.ok(subject.contracts.includes('artifact_bundle.gallery.view'));
  assert.ok(subject.contracts.includes('artifact_bundle.validation.view'));
  assert.ok(subject.contracts.includes('work_record.evidence.view'));
  assert.equal('views' in subject, false);
  assert.equal('controls' in subject, false);
  assert.ok(subject.subject_references.some((reference) => (
    reference.id === 'origin-work-record'
      && reference.relationship === 'generated_by'
      && reference.handle === 'work-record:example-design-pass-generation'
  )));
  assert.ok(subject.facets.every((facet) => Array.isArray(facet.hosts)));
  assert.ok(subject.facets.some((facet) => (
    facet.key === 'artifact_bundle.preview'
      && facet.layer === 'artifacts'
      && facet.hosts[0].entry.value === ARTIFACT_BUNDLE_WORKBENCH_URL
  )));
});

test('artifact bundle metadata carries entries renderers files exports provenance and validation', async () => {
  const subject = createArtifactBundleSubject(await fixtureSubject());
  const artifacts = artifactBundleArtifacts(subject);

  assert.deepEqual(artifacts.map((artifact) => [artifact.id, artifact.kind]), [
    ['html-prototype', 'html'],
    ['markdown-report', 'markdown'],
  ]);

  for (const artifact of artifacts) {
    assert.ok(artifact.entry, `${artifact.id} has an entry file`);
    assert.ok(artifact.renderer.id, `${artifact.id} has a renderer id`);
    assert.ok(artifact.files.some((file) => file.role === 'entry'), `${artifact.id} has an entry file record`);
    assert.ok(artifact.files.length >= 2, `${artifact.id} has supporting files`);
    assert.ok(artifact.exports.length >= 2, `${artifact.id} has export metadata`);
    assert.equal(artifact.provenance.work_record_id, 'work-record:example-design-pass-generation');
    assert.equal(artifact.work_record.subject_id, 'work-record:example-design-pass-generation');
    assert.equal(artifact.work_record.path, 'work-record.json');
    assert.equal(artifact.validation.state, 'unchecked');
  }

  assert.deepEqual(artifactBundleSummary(subject), {
    artifact_count: 2,
    artifact_kinds: ['html', 'markdown'],
    renderer_ids: ['aos.renderer.html.preview', 'aos.renderer.markdown.report'],
    export_count: 4,
    validation_state: 'unchecked',
  });
});

test('artifact bundle fixture links a schema-valid Work Record evidence route', async () => {
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
  const openResult = openArtifactBundle(state, {
    type: ARTIFACT_BUNDLE_OPEN_TYPE,
    subject,
    content_root: {
      name: 'repo-test',
      url: 'aos://repo-test/',
    },
  });
  assert.equal(openResult.status, 'opened');

  let snapshot = artifactBundleWorkbenchSnapshot(state);
  assert.equal(snapshot.selected_work_record_link.record_id, 'work-record:example-design-pass-generation');
  assert.equal(snapshot.selected_work_record_link.record_path, 'work-record.json');
  assert.equal(
    snapshot.selected_work_record_link.record_url,
    'aos://repo-test/docs/design/fixtures/aos-artifacts/example-design-pass/work-record.json',
  );
  assert.deepEqual(snapshot.selected_work_record_link.evidence_refs, ['evidence:html-prototype']);
  assert.equal(snapshot.selected_work_record_link.can_open, true);
  assert.equal(snapshot.selected_work_record_summary.status, 'linked');
  assert.equal(snapshot.selected_work_record_summary.snapshot_available, false);
  assert.equal(snapshot.selected_work_record_summary.evidence_ref_count, 1);
  assert.deepEqual(snapshot.selected_work_record_summary.evidence_refs, ['evidence:html-prototype']);

  const result = openArtifactBundleLinkedWorkRecord(state, { record });
  assert.equal(result.status, 'opened');
  assert.equal(result.record_id, 'work-record:example-design-pass-generation');
  assert.equal(result.read_only, true);

  snapshot = artifactBundleWorkbenchSnapshot(state);
  assert.equal(snapshot.linked_work_record_open.open_message.type, 'work_record.open');
  assert.equal(snapshot.linked_work_record_open.open_message.source.kind, 'artifact_bundle_work_record');
  assert.equal(snapshot.linked_work_record_open.open_message.source.artifact_id, 'html-prototype');
  assert.equal(snapshot.linked_work_record_open.workbench_snapshot.subject.subject_type, 'aos.work_record');
  assert.equal(snapshot.linked_work_record_open.workbench_snapshot.diagnostics.evidence_count, 2);
  assert.equal(snapshot.linked_work_record_open.workbench_snapshot.diagnostics.verifier_status, 'passed');
  assert.equal(snapshot.selected_work_record_summary.snapshot_available, true);
  assert.equal(snapshot.selected_work_record_summary.evidence_count, 2);
  assert.equal(snapshot.selected_work_record_summary.claim_count, 2);
  assert.equal(snapshot.selected_work_record_summary.verified_claim_count, 2);
  assert.equal(snapshot.selected_work_record_summary.failed_claim_count, 0);
  assert.equal(snapshot.selected_work_record_summary.unverified_claim_count, 0);
  assert.equal(snapshot.selected_work_record_summary.verifier_status, 'passed');
  assert.equal(snapshot.selected_work_record_summary.health_state, 'valid');
  assert.equal(snapshot.selected_work_record_summary.read_only, true);
  assert.equal(workRecordIsReadOnly(snapshot.linked_work_record_open.workbench_snapshot.record), true);
});

test('artifact bundle workbench model opens read-only and preserves artifact payloads', async () => {
  const subject = createArtifactBundleSubject(await fixtureSubject());
  const state = createArtifactBundleWorkbenchState({
    contentRoot: {
      name: 'repo-test',
      url: 'aos://repo-test/',
    },
  });

  const openResult = openArtifactBundle(state, {
    type: ARTIFACT_BUNDLE_OPEN_TYPE,
    subject,
    content_root: {
      name: 'repo-test',
      url: 'aos://repo-test/',
    },
  });
  assert.equal(openResult.status, 'opened');
  let snapshot = artifactBundleWorkbenchSnapshot(state);
  assert.equal(snapshot.surface, ARTIFACT_BUNDLE_WORKBENCH_SURFACE);
  assert.equal(snapshot.read_only, true);
  assert.equal(snapshot.selected_artifact_id, 'html-prototype');
  assert.deepEqual(snapshot.selected_artifact, subject.artifacts[0]);
  assert.equal(
    snapshot.preview.url,
    'aos://repo-test/docs/design/fixtures/aos-artifacts/example-design-pass/prototype/index.html',
  );
  assert.equal(snapshot.preview.render_mode, 'iframe');
  assert.equal(snapshot.diagnostics.has_legacy_views, false);
  assert.equal(snapshot.diagnostics.has_legacy_controls, false);

  const selectResult = selectArtifactBundleArtifact(state, 'markdown-report');
  assert.equal(selectResult.status, 'selected');
  snapshot = artifactBundleWorkbenchSnapshot(state);
  assert.equal(snapshot.selected_artifact_id, 'markdown-report');
  assert.deepEqual(snapshot.selected_artifact, subject.artifacts[1]);
  assert.equal(
    snapshot.preview.url,
    'aos://repo-test/docs/design/fixtures/aos-artifacts/example-design-pass/report.md',
  );
  assert.equal(snapshot.preview.render_mode, 'markdown');
});

test('artifact bundle subject catalog entry creates a canonical open request', async () => {
  const subject = createArtifactBundleSubject(await fixtureSubject());
  const entry = createArtifactBundleSubjectCatalogEntry(subject);
  const request = createSubjectOpenRequestFromCatalogEntry(entry, {
    requestId: 'artifact-open-test',
  });

  assert.equal(entry.type, 'aos.subject_catalog.entry');
  assert.equal(entry.subject.subject_type, 'aos.artifact_bundle');
  assert.deepEqual(entry.capabilities, ['inspectable', 'exportable', 'verifier-target']);
  assert.ok(entry.contracts.includes('artifact_bundle.preview.view'));
  assert.ok(entry.facets.some((facet) => facet.key === 'artifact_bundle.gallery'));
  assert.equal(entry.affordances.openable, true);
  assert.equal(entry.affordances.openers[0].id, 'artifact-bundle-workbench');
  assert.equal(subjectCatalogEntryCanOpen(entry), true);
  assert.equal(request.type, SUBJECT_OPEN_REQUEST_TYPE);
  assert.equal(request.request_id, 'artifact-open-test');
  assert.equal(request.entry_handle, subject.id);
  assert.equal(request.selected_facet.key, 'artifact_bundle.gallery');
  assert.equal(request.host.entry.value, ARTIFACT_BUNDLE_WORKBENCH_URL);
  assert.equal(request.opener.id, 'artifact-bundle-workbench');
  assert.equal(request.opener.message_type, 'artifact_bundle.open');
  assert.equal(request.open_message.type, 'artifact_bundle.open');
  assert.equal(request.open_message.subject.id, subject.id);
});

test('wiki subject browser can list and route artifact bundle catalog entries', async () => {
  const entry = createArtifactBundleSubjectCatalogEntry(await fixtureSubject());
  const state = createWikiSubjectBrowserState();

  const load = applySubjectCatalogLoad(state, {
    type: SUBJECT_CATALOG_LOAD_TYPE,
    entries: [entry],
  });
  const request = createWikiSubjectBrowserOpenRequestFromCatalogEntry(state.catalog_entries[0]);
  applySubjectOpenRequested(state, request);
  const snapshot = wikiSubjectBrowserSnapshot(state);

  assert.equal(load.entry_count, 1);
  assert.deepEqual(snapshot.subject_graph_summary.subject_types, ['aos.artifact_bundle']);
  assert.ok(snapshot.subject_graph_summary.relationship_types.includes('generated_by'));
  assert.ok(snapshot.subject_index_entries.some((item) => (
    item.subject_id === 'artifact-bundle:example-design-pass'
      && item.open_ref === 'wiki-subject-browser-v0:subject-list:open:artifact-bundle-example-design-pass'
  )));
  assert.equal(request.opener.id, 'artifact-bundle-workbench');
  assert.equal(request.host.entry.value, ARTIFACT_BUNDLE_WORKBENCH_URL);
  assert.equal(snapshot.last_subject_open_request.open_message.type, 'artifact_bundle.open');
  assert.equal(snapshot.navigation_history.length, 1);
  assert.equal(snapshot.navigation_trail[0].entry_handle, 'artifact-bundle:example-design-pass');
  assert.equal(WIKI_SUBJECT_BROWSER_ARTIFACT_BUNDLE_CANVAS_ID, 'wiki-subject-browser-v0-artifact-bundle');
});

test('artifact bundle workbench files expose the named surface and refs', async () => {
  const indexHtml = await readFile(new URL('packages/toolkit/components/artifact-bundle-workbench/index.html', repo), 'utf8');
  const indexJs = await readFile(new URL('packages/toolkit/components/artifact-bundle-workbench/index.js', repo), 'utf8');
  const launch = await readFile(new URL('packages/toolkit/components/artifact-bundle-workbench/launch.sh', repo), 'utf8');

  assert.match(indexHtml, /Artifact Bundle Workbench/);
  assert.match(indexJs, /aosRef\('root'\)/);
  assert.match(indexJs, /window\.__artifactBundleWorkbenchState/);
  assert.match(indexJs, /artifact_bundle\.open/);
  assert.match(indexJs, /artifact_bundle\.select/);
  assert.match(indexJs, /Open Work Record Evidence/);
  assert.match(indexJs, /data-role="evidence-summary"/);
  assert.match(indexJs, /artifact_bundle\.work_record\.open\.result/);
  assert.match(indexJs, /work-record-workbench/);
  assert.match(indexJs, /renderMarkdown/);
  assert.match(indexHtml, /\.\.\/\.\.\/markdown\/preview\.css/);
  assert.match(indexJs, /aos-markdown-preview artifact-bundle-markdown-preview/);
  assert.match(indexJs, /data-role="markdown-preview"/);
  assert.match(launch, /--manifest artifact-bundle-workbench/);
  assert.match(launch, /artifact-bundle-workbench:root/);
  assert.match(launch, /last_result\?\.status === "opened"/);
  assert.doesNotMatch(launch, /selected_artifact_id === "html-prototype"/);
  assert.match(launch, /example-design-pass\/subject\.json/);
});
