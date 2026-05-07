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
      fileURLToPath(workRecordUrl),
    ],
    { encoding: 'utf8' },
  );
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
  assert.ok(report.files.some((file) => file.path === 'work-record.json' && file.role === 'work_record_fixture'));
  assert.ok(report.exports.some((item) => item.kind === 'pdf' && item.status === 'not_generated'));
  assert.equal(report.provenance.work_record_id, 'work-record:employer-brand-comparative-audit-fixture');
  assert.equal(report.provenance.source_metadata, 'sources.json');
  assert.deepEqual(report.work_record.evidence_refs, [
    'evidence:markdown-report',
    'evidence:sources-metadata',
    'evidence:subject-descriptor',
    'evidence:work-record-fixture',
  ]);

  assert.equal(sources.audit.client, 'Symphony Talent');
  assert.deepEqual(sources.audit.competitors, ['Phenom', 'Radancy']);
  assert.equal(sources.sources.length, 3);
  assert.ok(sources.sources.every((source) => source.collection_status === 'not_collected_in_fixture'));
  assert.ok(sources.provenance.non_goals.includes('generation'));
  assert.ok(sources.provenance.non_goals.includes('export_execution'));
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
  assert.equal(snapshot.selected_work_record_summary.evidence_ref_count, 4);
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
  assert.equal(snapshot.linked_work_record_open.workbench_snapshot.diagnostics.evidence_count, 4);
  assert.equal(snapshot.linked_work_record_open.workbench_snapshot.diagnostics.claim_count, 3);
  assert.equal(snapshot.linked_work_record_open.workbench_snapshot.diagnostics.verifier_status, 'passed');
  assert.equal(snapshot.selected_work_record_summary.snapshot_available, true);
  assert.equal(snapshot.selected_work_record_summary.evidence_count, 4);
  assert.equal(snapshot.selected_work_record_summary.claim_count, 3);
  assert.equal(snapshot.selected_work_record_summary.verified_claim_count, 3);
  assert.equal(snapshot.selected_work_record_summary.failed_claim_count, 0);
  assert.equal(snapshot.selected_work_record_summary.unverified_claim_count, 0);
  assert.equal(snapshot.selected_work_record_summary.health_state, 'valid');
  assert.equal(workRecordIsReadOnly(snapshot.linked_work_record_open.workbench_snapshot.record), true);
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

  assert.equal(subjectCatalogEntryCanOpen(entry), true);
  assert.equal(request.open_message.type, 'artifact_bundle.open');
  assert.equal(request.open_message.subject.id, 'artifact-bundle:employer-brand-comparative-audit');
  assert.equal(request.open_message.content_root.url, 'aos://repo-test/');
  assert.match(launch, /last_result\?\.status === "opened"/);
  assert.doesNotMatch(launch, /selected_artifact_id === "html-prototype"/);
});
