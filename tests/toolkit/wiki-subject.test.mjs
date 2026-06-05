import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createWikiPageSubject,
  createWikiPageSubjects,
  wikiSubjectType,
} from '../../packages/toolkit/workbench/wiki-subject.js';
import {
  subjectCapabilities,
  subjectContracts,
  subjectFacets,
  subjectHosts,
} from '../../packages/toolkit/workbench/subject.js';

test('wikiSubjectType maps canonical wiki page types', () => {
  assert.equal(wikiSubjectType({ path: 'aos/concepts/runtime-modes.md', type: 'concept' }), 'wiki.concept');
  assert.equal(wikiSubjectType({ path: 'aos/entities/daemon.md', type: 'entity' }), 'wiki.entity');
  assert.equal(wikiSubjectType({ path: 'aos/plugins/self-check/SKILL.md', type: 'workflow' }), 'wiki.workflow');
  assert.equal(wikiSubjectType({ path: 'aos/plugins/foo/references/bar.md', type: 'concept', plugin: 'foo' }), 'wiki.reference');
  assert.equal(wikiSubjectType({ path: 'sigil/agents/default.md', type: 'bespoke' }), 'wiki.page');
  assert.equal(wikiSubjectType({ path: 'sigil/agents/default.md' }), 'wiki.page');
});

test('createWikiPageSubject builds a concept subject from wiki list shape', () => {
  const subject = createWikiPageSubject({
    path: 'aos/concepts/runtime-modes.md',
    type: 'concept',
    name: 'Runtime Modes',
    description: 'Repo and installed runtime isolation.',
    tags: ['runtime', 'modes', 'platform'],
    modified_at: 1776393337,
  });

  assert.equal(subject.type, 'aos.workbench.subject');
  assert.equal(subject.id, 'wiki:aos/concepts/runtime-modes.md');
  assert.equal(subject.subject_type, 'wiki.concept');
  assert.equal(subject.label, 'Runtime Modes');
  assert.equal(subject.owner, 'aos');
  assert.deepEqual(subject.source, {
    kind: 'wiki',
    path: 'aos/concepts/runtime-modes.md',
    namespace: 'aos',
    plugin: null,
  });
  assert.equal(subject.state.modified_at, 1776393337);
  assert.deepEqual(subject.metadata.tags, ['runtime', 'modes', 'platform']);
  assert.deepEqual(subjectCapabilities(subject), ['inspectable', 'editable']);
  assert.deepEqual(subject.capabilities, ['inspectable', 'editable']);
  assert.ok(subjectContracts(subject).includes('wiki.read'));
  assert.ok(subjectContracts(subject).includes('markdown_document.save.requested'));
  assert.ok(subjectContracts(subject).includes('markdown_document.text.patch'));
  const facets = subjectFacets(subject);
  assert.deepEqual(facets.map((facet) => facet.key), ['wiki-markdown', 'markdown-preview', 'wiki-graph']);
  assert.equal(facets.find((facet) => facet.key === 'wiki-markdown').layer, 'narrative');
  assert.ok(facets.find((facet) => facet.key === 'markdown-preview').contracts.includes('wiki.markdown.render'));
  assert.equal(facets.find((facet) => facet.key === 'wiki-graph').layer, 'descriptor');
  const hosts = subjectHosts(subject);
  assert.ok(hosts.every((host) => host.kind === 'canvas' && host.target_dialect === 'canvas'));
  assert.ok(hosts.some((host) => host.entry.value === 'aos://toolkit/components/markdown-workbench/index.html'));
  assert.ok(hosts.some((host) => host.entry.value === 'aos://toolkit/components/wiki-kb/index.html'));
  assert.equal('views' in subject, false);
  assert.equal('controls' in subject, false);
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
  assert.ok(subjectCapabilities(subject).includes('replayable'));
  assert.deepEqual(subject.capabilities, ['inspectable', 'editable', 'replayable']);
  assert.ok(subjectContracts(subject).includes('wiki.invoke'));
  assert.ok(subjectContracts(subject).includes('workflow.project'));
  const facets = subjectFacets(subject);
  assert.ok(facets.some((facet) => facet.key === 'workflow-projection'));
  assert.ok(facets.some((facet) => facet.key === 'workflow-controls'));
  assert.ok(facets.find((facet) => facet.key === 'workflow-controls').contracts.includes('wiki.invoke'));
  assert.equal('views' in subject, false);
  assert.equal('controls' in subject, false);
});

test('createWikiPageSubject keeps canonical entity documents wiki-oriented', () => {
  const subject = createWikiPageSubject({
    path: 'sigil/agents/default.md',
    type: 'entity',
    name: 'Default',
    tags: ['sigil', 'orchestrator'],
  });

  assert.equal(subject.subject_type, 'wiki.entity');
  assert.equal(subject.owner, 'sigil');
  assert.equal(subject.metadata.wiki_type, 'entity');
  assert.ok(!subjectContracts(subject).includes('sigil.agent.preview'));
  assert.equal('views' in subject, false);
  assert.equal('controls' in subject, false);
});

test('createWikiPageSubjects maps arrays and rejects missing path', () => {
  assert.equal(createWikiPageSubjects([{ path: 'aos/entities/daemon.md', type: 'entity' }]).length, 1);
  assert.throws(() => createWikiPageSubject({ type: 'concept' }), /requires a path/);
});
