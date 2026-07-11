import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  formatSubjectEntryHandle,
  isSubjectEntryHandle,
  normalizeSubjectEntryHandle,
  parseSubjectEntryHandle,
  subjectEntryHandleFacetKey,
  subjectEntryHandleSubjectId,
  SUBJECT_ENTRY_HANDLE_SCHEMA_VERSION,
  SUBJECT_ENTRY_HANDLE_TYPE,
} from '../../packages/toolkit/workbench/subject-entry-handle.js';

test('subject entry handle helper parses valid handles', () => {
  assert.deepEqual(parseSubjectEntryHandle('wiki:Runtime Modes'), {
    type: SUBJECT_ENTRY_HANDLE_TYPE,
    schema_version: SUBJECT_ENTRY_HANDLE_SCHEMA_VERSION,
    handle: 'wiki:Runtime Modes',
    facet_key: 'wiki',
    subject_id: 'Runtime Modes',
  });

  assert.equal(parseSubjectEntryHandle('wiki:aos/concepts/runtime-modes.md')?.subject_id, 'aos/concepts/runtime-modes.md');
  assert.equal(parseSubjectEntryHandle('work-record:aos-browser-click-status-2026-05-06')?.facet_key, 'work-record');
  assert.equal(parseSubjectEntryHandle('example.menu.item:wiki-graph')?.facet_key, 'example.menu.item');
  assert.equal(parseSubjectEntryHandle('artifact-bundle:example:with-colon')?.subject_id, 'example:with-colon');
});

test('subject entry handle helper rejects invalid handles', () => {
  for (const handle of [
    '',
    'Runtime Modes',
    'wiki:',
    ':Runtime Modes',
    ' wiki ',
    'wiki :Runtime Modes',
    'wiki/graph:Runtime Modes',
  ]) {
    assert.equal(parseSubjectEntryHandle(handle), null, handle);
    assert.equal(isSubjectEntryHandle(handle), false, handle);
    assert.equal(normalizeSubjectEntryHandle(handle), '', handle);
  }
});

test('subject entry handle helper extracts facet keys and subject ids', () => {
  assert.equal(subjectEntryHandleFacetKey('wiki:aos/concepts/runtime-modes.md'), 'wiki');
  assert.equal(subjectEntryHandleSubjectId('wiki:aos/concepts/runtime-modes.md'), 'aos/concepts/runtime-modes.md');
  assert.equal(subjectEntryHandleFacetKey('work-record:aos-browser-click-status-2026-05-06'), 'work-record');
  assert.equal(subjectEntryHandleSubjectId('work-record:aos-browser-click-status-2026-05-06'), 'aos-browser-click-status-2026-05-06');
  assert.equal(subjectEntryHandleFacetKey('not-a-handle'), '');
  assert.equal(subjectEntryHandleSubjectId('not-a-handle'), '');
});

test('subject entry handle helper formats normalized handles', () => {
  assert.equal(formatSubjectEntryHandle('wiki', 'Runtime Modes'), 'wiki:Runtime Modes');
  assert.equal(formatSubjectEntryHandle({ facet_key: 'wiki', subject_id: 'aos/concepts/runtime-modes.md' }), 'wiki:aos/concepts/runtime-modes.md');
  assert.equal(formatSubjectEntryHandle({ facetKey: 'work-record', subjectId: 'aos-browser-click-status-2026-05-06' }), 'work-record:aos-browser-click-status-2026-05-06');
  assert.equal(normalizeSubjectEntryHandle(' wiki:Runtime Modes '), 'wiki:Runtime Modes');
  assert.equal(normalizeSubjectEntryHandle('wiki: /aos/concepts/runtime-modes.md'), 'wiki:/aos/concepts/runtime-modes.md');
  assert.equal(formatSubjectEntryHandle({ facet_key: 'wiki', subject_id: '' }), '');
  assert.equal(formatSubjectEntryHandle({ facet_key: 'wiki graph', subject_id: 'Runtime Modes' }), '');
});
