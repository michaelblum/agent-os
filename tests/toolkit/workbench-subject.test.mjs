import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createWorkbenchSubject,
  isLegacyOperationContract,
  isWorkbenchSubjectCapability,
  normalizeWorkbenchSubjectDescriptor,
  subjectCapabilities,
  subjectCanonicalContracts,
  subjectCanonicalReferences,
  subjectContracts,
  subjectFacets,
  subjectHosts,
  subjectLegacyControls,
  subjectLegacyViews,
  subjectReferences,
  subjectSupports,
  subjectSupportsCapability,
  subjectSupportsContract,
  WORKBENCH_SUBJECT_SCHEMA_VERSION,
} from '../../packages/toolkit/workbench/subject.js';

test('createWorkbenchSubject normalizes the common subject descriptor', () => {
  const subject = createWorkbenchSubject({
    id: ' file:docs/example.md ',
    type: ' markdown.document ',
    label: ' Example ',
    owner: 'markdown-workbench',
    source: { kind: 'file', path: 'docs/example.md' },
    capabilities: ['inspectable', '', null, 'editable', 'markdown_document.text.patch', 'unknown-mode'],
    contracts: ['markdown.render', '', null, 'markdown_document.save.requested'],
    state: { dirty: true },
  });

  assert.equal(subject.type, 'aos.workbench.subject');
  assert.equal(subject.schema_version, WORKBENCH_SUBJECT_SCHEMA_VERSION);
  assert.equal(subject.id, 'file:docs/example.md');
  assert.equal(subject.subject_type, 'markdown.document');
  assert.equal(subject.label, 'Example');
  assert.deepEqual(subject.capabilities, ['inspectable', 'editable']);
  assert.deepEqual(subject.contracts, [
    'markdown.render',
    'markdown_document.save.requested',
    'markdown_document.text.patch',
  ]);
  assert.equal('views' in subject, false);
  assert.equal('controls' in subject, false);
  assert.equal(subjectSupports(subject, 'markdown.render'), true);
  assert.equal(subjectSupportsCapability(subject, 'editable'), true);
  assert.equal(subjectSupportsContract(subject, 'markdown_document.save.requested'), true);
  assert.equal(subjectSupports(subject, 'canvas_object.registry'), false);
});

test('createWorkbenchSubject rejects subjects without stable identity or type', () => {
  assert.throws(() => createWorkbenchSubject({ type: 'markdown.document' }), /requires an id/);
  assert.throws(() => createWorkbenchSubject({ id: 'file:docs/example.md' }), /requires a type/);
});

test('subject compatibility helpers split high-level capabilities from archived legacy descriptors', () => {
  const subject = {
    type: 'aos.workbench.subject',
    schema_version: WORKBENCH_SUBJECT_SCHEMA_VERSION,
    id: 'wiki:aos/concepts/example.md',
    subject_type: 'wiki.concept',
    label: 'Example',
    owner: 'aos',
    capabilities: ['inspectable', 'editable', 'wiki.read', 'markdown_document.text.patch'],
    contracts: ['wiki.invoke', 'markdown_document.text.patch'],
    subject_references: [
      {
        id: 'source-doc',
        relationship: 'narrative_source',
        handle: 'wiki:aos/concepts/source.md',
      },
    ],
    facets: [
      {
        key: 'wiki-markdown',
        layer: 'narrative',
        label: 'Markdown',
        capabilities: ['inspectable', 'editable'],
        contracts: ['markdown_document.text.patch'],
        hosts: [
          {
            kind: 'canvas',
            target_dialect: 'canvas',
            entry: {
              kind: 'aos-url',
              value: 'aos://toolkit/components/markdown-workbench/index.html',
            },
            preferred: true,
          },
        ],
      },
    ],
    views: ['markdown.source', 'markdown.preview'],
    controls: ['text.editor', 'save'],
    metadata: {
      subject_references: [
        {
          id: 'source-doc',
          relationship: 'narrative_source',
          handle: 'wiki:aos/concepts/source.md',
        },
      ],
    },
  };

  assert.equal(isLegacyOperationContract('markdown_document.text.patch'), true);
  assert.equal(isLegacyOperationContract('editable'), false);
  assert.equal(isWorkbenchSubjectCapability('editable'), true);
  assert.equal(isWorkbenchSubjectCapability('wiki.read'), false);
  assert.deepEqual(subjectCapabilities(subject), ['inspectable', 'editable']);
  assert.deepEqual(subjectCanonicalContracts(subject), [
    'wiki.invoke',
    'markdown_document.text.patch',
  ]);
  assert.deepEqual(subjectContracts(subject), [
    'wiki.invoke',
    'markdown_document.text.patch',
    'wiki.read',
  ]);
  assert.equal(subjectReferences(subject).length, 1);
  assert.equal(subjectCanonicalReferences(subject).length, 1);
  assert.equal(subjectFacets(subject)[0].key, 'wiki-markdown');
  assert.equal(subjectHosts(subject)[0].entry.value, 'aos://toolkit/components/markdown-workbench/index.html');
  assert.deepEqual(subjectLegacyViews(subject), ['markdown.source', 'markdown.preview']);
  assert.deepEqual(subjectLegacyControls(subject), ['text.editor', 'save']);
  assert.equal(subjectSupports(subject, 'wiki.read'), true);
  assert.equal(subjectSupportsCapability(subject, 'editable'), true);
  assert.equal(subjectSupportsCapability(subject, 'wiki.read'), false);
  assert.equal(subjectSupportsContract(subject, 'wiki.read'), true);

  const normalized = normalizeWorkbenchSubjectDescriptor(subject);
  assert.deepEqual(normalized.capabilities, ['inspectable', 'editable']);
  assert.deepEqual(normalized.legacy_capabilities, [
    'inspectable',
    'editable',
    'wiki.read',
    'markdown_document.text.patch',
  ]);
  assert.equal(normalized.subject_references.length, 1);
});

test('subject compatibility helpers read legacy descriptors without v-next fields', () => {
  const legacy = {
    type: 'aos.workbench.subject',
    schema_version: '2026-05-03',
    id: 'wiki:aos/concepts/legacy.md',
    subject_type: 'wiki.concept',
    label: 'Legacy',
    owner: 'aos',
    capabilities: ['wiki.read', 'markdown_document.text.patch'],
    views: ['markdown.source'],
    controls: ['text.editor'],
    metadata: {
      subject_references: [
        {
          id: 'legacy-source',
          relationship: 'narrative_source',
          handle: 'wiki:aos/concepts/source.md',
        },
      ],
    },
  };

  assert.deepEqual(subjectCapabilities(legacy), []);
  assert.deepEqual(subjectCanonicalContracts(legacy), []);
  assert.deepEqual(subjectContracts(legacy), ['wiki.read', 'markdown_document.text.patch']);
  assert.equal(subjectSupports(legacy, 'markdown_document.text.patch'), true);
  assert.equal(subjectReferences(legacy)[0].id, 'legacy-source');
  assert.deepEqual(subjectCanonicalReferences(legacy), []);
  assert.deepEqual(subjectLegacyViews(legacy), ['markdown.source']);
  assert.deepEqual(subjectLegacyControls(legacy), ['text.editor']);

  const normalized = normalizeWorkbenchSubjectDescriptor(legacy);
  assert.deepEqual(normalized.contracts, ['wiki.read', 'markdown_document.text.patch']);
  assert.equal(normalized.subject_references[0].handle, 'wiki:aos/concepts/source.md');
});
