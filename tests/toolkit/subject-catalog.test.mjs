import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  ARTIFACT_BUNDLE_WORKBENCH_URL,
  SUBJECT_OPEN_REQUEST_TYPE,
  WORK_RECORD_WORKBENCH_URL,
  createArtifactBundleSubjectCatalogEntry,
  createSubjectCatalogEntry,
  createSubjectOpenRequestFromCatalogEntry,
  createWorkRecordSubjectCatalogEntry,
  subjectCatalogEntryCanOpen,
} from '../../packages/toolkit/workbench/subject-catalog.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../..');
const fixtureRoot = path.join(repoRoot, 'shared/schemas/fixtures/aos-work-record-v0/valid');
const artifactBundleFixturePath = path.join(
  repoRoot,
  'docs/design/fixtures/aos-artifacts/example-design-pass/subject.json',
);

function fixture(name) {
  return JSON.parse(fs.readFileSync(path.join(fixtureRoot, name), 'utf8'));
}

function artifactBundleFixture() {
  return JSON.parse(fs.readFileSync(artifactBundleFixturePath, 'utf8'));
}

test('subject catalog creates an openable non-wiki Work Record entry from canonical descriptor fields', () => {
  const record = fixture('playbook-browser-click-status.json');
  const entry = createWorkRecordSubjectCatalogEntry(record, {
    source: {
      kind: 'fixture',
      path: '/tmp/playbook-browser-click-status.json',
      read_only: true,
    },
  });

  assert.equal(entry.type, 'aos.subject_catalog.entry');
  assert.equal(entry.entry_handle, 'work-record:aos-browser-click-status-2026-05-06');
  assert.equal(entry.subject.subject_type, 'aos.work_record');
  assert.deepEqual(entry.capabilities, ['inspectable', 'verifier-target', 'exportable']);
  assert.ok(entry.contracts.includes('work_record.execution_map.view'));
  assert.ok(entry.facets.some((facet) => facet.hosts.some((host) => (
    host.entry.value === WORK_RECORD_WORKBENCH_URL
  ))));
  assert.ok(entry.subject_references.some((reference) => (
    reference.id === 'origin-playbook-subject'
      && reference.handle === 'playbook:browser-live-action-status'
  )));
  assert.equal(entry.affordances.openable, true);
  assert.equal(entry.affordances.openers[0].id, 'work-record-workbench');
  assert.equal(subjectCatalogEntryCanOpen(entry), true);
});

test('subject catalog open request carries stable payload for existing Work Record Workbench', () => {
  const record = fixture('playbook-browser-click-status.json');
  const entry = createWorkRecordSubjectCatalogEntry(record);
  const request = createSubjectOpenRequestFromCatalogEntry(entry, {
    requestId: 'subject-open-test',
  });

  assert.equal(request.type, SUBJECT_OPEN_REQUEST_TYPE);
  assert.equal(request.request_id, 'subject-open-test');
  assert.equal(request.entry_handle, entry.entry_handle);
  assert.equal(request.subject.subject_type, 'aos.work_record');
  assert.equal(request.selected_facet.key, 'work_record.intent');
  assert.equal(request.host.entry.value, WORK_RECORD_WORKBENCH_URL);
  assert.equal(request.opener.id, 'work-record-workbench');
  assert.equal(request.opener.message_type, 'work_record.open');
  assert.equal(request.open_message.type, 'work_record.open');
  assert.equal(request.open_message.record.id, 'work-record:aos-browser-click-status-2026-05-06');
});

test('subject catalog does not use legacy views controls or dotted raw capabilities for opening', () => {
  const legacySummarySubject = {
    type: 'aos.workbench.subject',
    schema_version: '2026-05-03',
    id: 'work-record:legacy-summary-only',
    subject_type: 'aos.work_record',
    label: 'Legacy Summary Only',
    owner: 'aos-work-record',
    capabilities: ['inspectable', 'work_record.execution_map.view'],
    views: ['work_record.execution_map.json'],
    controls: ['open'],
    facets: [
      {
        key: 'legacy-summary',
        layer: 'descriptor',
        label: 'Legacy Summary',
        hosts: [
          {
            kind: 'canvas',
            target_dialect: 'canvas',
            entry: {
              kind: 'aos-url',
              value: WORK_RECORD_WORKBENCH_URL,
            },
          },
        ],
      },
    ],
  };

  const entry = createSubjectCatalogEntry({
    subject: legacySummarySubject,
    open_payload: {
      type: 'work_record.open',
      record: {
        id: 'work-record:legacy-summary-only',
      },
    },
  });

  assert.deepEqual(entry.contracts, []);
  assert.equal(entry.affordances.openable, false);
  assert.equal(subjectCatalogEntryCanOpen(entry), false);
  assert.equal(createSubjectOpenRequestFromCatalogEntry(entry), null);
});

test('subject catalog creates an openable artifact bundle entry from canonical descriptor fields', () => {
  const entry = createArtifactBundleSubjectCatalogEntry(artifactBundleFixture());
  const request = createSubjectOpenRequestFromCatalogEntry(entry, {
    requestId: 'artifact-open-test',
  });

  assert.equal(entry.subject.subject_type, 'aos.artifact_bundle');
  assert.deepEqual(entry.capabilities, ['inspectable', 'exportable', 'verifier-target']);
  assert.ok(entry.contracts.includes('artifact_bundle.gallery.view'));
  assert.equal(entry.affordances.openable, true);
  assert.equal(entry.affordances.openers[0].id, 'artifact-bundle-workbench');
  assert.equal(request.type, SUBJECT_OPEN_REQUEST_TYPE);
  assert.equal(request.opener.id, 'artifact-bundle-workbench');
  assert.equal(request.host.entry.value, ARTIFACT_BUNDLE_WORKBENCH_URL);
  assert.equal(request.open_message.type, 'artifact_bundle.open');
  assert.equal(request.open_message.subject.id, 'artifact-bundle:example-design-pass');
});
