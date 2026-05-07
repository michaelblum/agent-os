import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  deriveWorkbenchSubjectControls,
  findWorkbenchSubjectControl,
  WORKBENCH_SUBJECT_CONTROL_ORDER,
} from '../../packages/toolkit/workbench/subject-controls.js';
import { createWorkbenchSubject } from '../../packages/toolkit/workbench/subject.js';
import { createWikiPageSubject } from '../../packages/toolkit/workbench/wiki-subject.js';

test('subject controls derive ordered open and edit controls for wiki subjects', () => {
  const subject = createWikiPageSubject({
    path: 'aos/concepts/runtime-modes.md',
    frontmatter: {
      type: 'concept',
      name: 'Runtime Modes',
    },
  });

  const controls = deriveWorkbenchSubjectControls(subject);
  assert.deepEqual(WORKBENCH_SUBJECT_CONTROL_ORDER, ['open', 'edit', 'verify', 'replay', 'export']);
  assert.deepEqual(controls.map((control) => control.id), ['open', 'edit']);

  const open = findWorkbenchSubjectControl(controls, 'open');
  assert.equal(open.enabled, true);
  assert.equal(open.capability, 'inspectable');
  assert.ok(open.contracts.includes('wiki.read'));
  assert.ok(open.facets.some((facet) => facet.key === 'wiki-markdown'));

  const edit = findWorkbenchSubjectControl(controls, 'edit');
  assert.equal(edit.enabled, true);
  assert.equal(edit.capability, 'editable');
  assert.equal(edit.persistence.kind, 'wiki_write');
  assert.deepEqual(edit.facets.map((facet) => facet.key), ['wiki-markdown']);
  assert.ok(edit.contracts.includes('markdown_document.text.patch'));
  assert.ok(edit.contracts.includes('markdown_document.save.requested'));
});

test('subject controls derive verify and export controls from canonical facets and contracts', () => {
  const subject = createWorkbenchSubject({
    id: 'artifact-bundle:sample',
    type: 'aos.artifact_bundle',
    label: 'Sample Bundle',
    owner: 'aos',
    capabilities: ['inspectable', 'verifier-target', 'exportable'],
    contracts: [
      'artifact_bundle.gallery.view',
      'artifact_bundle.exports.view',
      'artifact_bundle.validation.view',
    ],
    facets: [
      {
        key: 'artifact_bundle.gallery',
        layer: 'artifacts',
        label: 'Artifact Gallery',
        capabilities: ['inspectable', 'exportable'],
        contracts: ['artifact_bundle.gallery.view', 'artifact_bundle.exports.view'],
        hosts: [{ kind: 'canvas', target_dialect: 'canvas' }],
      },
      {
        key: 'artifact_bundle.validation',
        layer: 'health',
        label: 'Validation',
        capabilities: ['verifier-target'],
        contracts: ['artifact_bundle.validation.view'],
        hosts: [{ kind: 'canvas', target_dialect: 'canvas' }],
      },
    ],
  });

  const controls = deriveWorkbenchSubjectControls(subject);
  assert.deepEqual(controls.map((control) => control.id), ['open', 'verify', 'export']);
  assert.equal(findWorkbenchSubjectControl(controls, 'open').enabled, true);
  assert.equal(findWorkbenchSubjectControl(controls, 'verify').enabled, true);
  assert.equal(findWorkbenchSubjectControl(controls, 'export').enabled, true);
  assert.deepEqual(
    findWorkbenchSubjectControl(controls, 'export').facets.map((facet) => facet.key),
    ['artifact_bundle.gallery'],
  );
});

test('subject controls ignore legacy controls and dotted raw capabilities', () => {
  const legacy = {
    type: 'aos.workbench.subject',
    schema_version: '2026-05-03',
    id: 'wiki:aos/concepts/legacy.md',
    subject_type: 'wiki.concept',
    label: 'Legacy',
    owner: 'aos',
    capabilities: ['inspectable', 'editable', 'markdown_document.text.patch'],
    views: ['markdown.source'],
    controls: ['open', 'edit', 'save'],
  };

  const controls = deriveWorkbenchSubjectControls(legacy);
  assert.deepEqual(controls.map((control) => control.id), ['open', 'edit']);
  assert.equal(findWorkbenchSubjectControl(controls, 'open').enabled, false);
  assert.equal(findWorkbenchSubjectControl(controls, 'open').reason, 'missing_inspectable_facet');
  assert.equal(findWorkbenchSubjectControl(controls, 'edit').enabled, false);
  assert.deepEqual(findWorkbenchSubjectControl(controls, 'edit').contracts, []);
  assert.deepEqual(findWorkbenchSubjectControl(controls, 'edit').facets, []);
});
