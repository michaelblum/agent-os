import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createWorkbenchSubject,
  subjectSupports,
  WORKBENCH_SUBJECT_SCHEMA_VERSION,
} from '../../packages/toolkit/workbench/subject.js';

test('createWorkbenchSubject normalizes the common subject descriptor', () => {
  const subject = createWorkbenchSubject({
    id: ' file:docs/example.md ',
    type: ' markdown.document ',
    label: ' Example ',
    owner: 'markdown-workbench',
    source: { kind: 'file', path: 'docs/example.md' },
    capabilities: ['markdown.render', '', null, 'markdown_document.save.requested'],
    state: { dirty: true },
  });

  assert.equal(subject.type, 'aos.workbench.subject');
  assert.equal(subject.schema_version, WORKBENCH_SUBJECT_SCHEMA_VERSION);
  assert.equal(subject.id, 'file:docs/example.md');
  assert.equal(subject.subject_type, 'markdown.document');
  assert.equal(subject.label, 'Example');
  assert.deepEqual(subject.capabilities, ['markdown.render', 'markdown_document.save.requested']);
  assert.equal(subjectSupports(subject, 'markdown.render'), true);
  assert.equal(subjectSupports(subject, 'canvas_object.registry'), false);
});

test('createWorkbenchSubject rejects subjects without stable identity or type', () => {
  assert.throws(() => createWorkbenchSubject({ type: 'markdown.document' }), /requires an id/);
  assert.throws(() => createWorkbenchSubject({ id: 'file:docs/example.md' }), /requires a type/);
});
