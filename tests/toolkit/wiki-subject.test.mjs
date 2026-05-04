import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createWikiPageSubject,
  createWikiPageSubjects,
  wikiSubjectType,
} from '../../packages/toolkit/workbench/wiki-subject.js';

test('wikiSubjectType maps canonical wiki page types', () => {
  assert.equal(wikiSubjectType({ path: 'aos/concepts/runtime-modes.md', type: 'concept' }), 'wiki.concept');
  assert.equal(wikiSubjectType({ path: 'aos/entities/daemon.md', type: 'entity' }), 'wiki.entity');
  assert.equal(wikiSubjectType({ path: 'aos/plugins/self-check/SKILL.md', type: 'workflow' }), 'wiki.workflow');
  assert.equal(wikiSubjectType({ path: 'aos/plugins/foo/references/bar.md', type: 'concept', plugin: 'foo' }), 'wiki.reference');
  assert.equal(wikiSubjectType({ path: 'sigil/agents/default.md', type: 'agent' }), 'sigil.agent');
});

test('createWikiPageSubject builds a concept subject from wiki list shape', () => {
  const subject = createWikiPageSubject({
    path: 'aos/concepts/employer-brand-workflow-map.md',
    type: 'concept',
    name: 'Employer Brand Workflow Map',
    description: 'End-to-end map for a workflow set.',
    tags: ['employer-brand', 'workflow', 'process'],
    modified_at: 1776393337,
  });

  assert.equal(subject.type, 'aos.workbench.subject');
  assert.equal(subject.id, 'wiki:aos/concepts/employer-brand-workflow-map.md');
  assert.equal(subject.subject_type, 'wiki.concept');
  assert.equal(subject.label, 'Employer Brand Workflow Map');
  assert.equal(subject.owner, 'aos');
  assert.deepEqual(subject.source, {
    kind: 'wiki',
    path: 'aos/concepts/employer-brand-workflow-map.md',
    namespace: 'aos',
    plugin: null,
  });
  assert.equal(subject.state.modified_at, 1776393337);
  assert.deepEqual(subject.metadata.tags, ['employer-brand', 'workflow', 'process']);
  assert.ok(subject.capabilities.includes('wiki.read'));
  assert.ok(subject.capabilities.includes('markdown_document.save.requested'));
});

test('createWikiPageSubject preserves plugin workflow capabilities', () => {
  const subject = createWikiPageSubject({
    path: 'aos/plugins/customize-with-agent/SKILL.md',
    frontmatter: {
      type: 'workflow',
      name: 'customize-with-agent',
      tags: '[meta, authoring, plugin-creation]',
    },
    plugin: 'customize-with-agent',
  });

  assert.equal(subject.subject_type, 'wiki.workflow');
  assert.equal(subject.source.plugin, 'customize-with-agent');
  assert.deepEqual(subject.metadata.tags, ['meta', 'authoring', 'plugin-creation']);
  assert.ok(subject.capabilities.includes('wiki.invoke'));
  assert.ok(subject.views.includes('workflow.graph'));
  assert.ok(subject.controls.includes('invoke'));
});

test('createWikiPageSubject preserves Sigil agent specialization', () => {
  const subject = createWikiPageSubject({
    path: 'sigil/agents/default.md',
    type: 'agent',
    name: 'Default',
    tags: ['sigil', 'orchestrator'],
  });

  assert.equal(subject.subject_type, 'sigil.agent');
  assert.equal(subject.owner, 'sigil');
  assert.ok(subject.capabilities.includes('sigil.agent.preview'));
  assert.ok(subject.views.includes('sigil.avatar.preview'));
});

test('createWikiPageSubjects maps arrays and rejects missing path', () => {
  assert.equal(createWikiPageSubjects([{ path: 'aos/entities/daemon.md', type: 'entity' }]).length, 1);
  assert.throws(() => createWikiPageSubject({ type: 'concept' }), /requires a path/);
});
