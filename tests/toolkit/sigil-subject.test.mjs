import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSigilAgentSubject } from '../../packages/toolkit/workbench/sigil-subject.js';

test('createSigilAgentSubject builds a Sigil agent domain subject from a wiki document', () => {
  const subject = createSigilAgentSubject({
    path: 'sigil/agents/default.md',
    type: 'agent',
    id: 'default',
    name: 'Default',
    description: 'Default Sigil operator.',
    tags: ['sigil', 'orchestrator'],
    modified_at: 1776393337,
  });

  assert.equal(subject.type, 'aos.workbench.subject');
  assert.equal(subject.id, 'sigil.agent:default');
  assert.equal(subject.subject_type, 'sigil.agent');
  assert.equal(subject.label, 'Default');
  assert.equal(subject.owner, 'sigil');
  assert.deepEqual(subject.source, {
    kind: 'wiki',
    path: 'sigil/agents/default.md',
    namespace: 'sigil',
    plugin: null,
    agent_id: 'default',
  });
  assert.equal(subject.state.modified_at, 1776393337);
  assert.ok(subject.capabilities.includes('markdown_document.save.requested'));
  assert.ok(subject.capabilities.includes('sigil.agent.preview'));
  assert.ok(subject.views.includes('sigil.avatar.preview'));
  assert.ok(subject.controls.includes('appearance.controls'));

  assert.deepEqual(subject.metadata.wiki_subject, {
    id: 'wiki:sigil/agents/default.md',
    subject_type: 'wiki.entity',
    path: 'sigil/agents/default.md',
  });
  assert.deepEqual(subject.metadata.subject_references, [
    {
      id: 'sigil-agent-narrative-source',
      relationship: 'narrative_source',
      handle: 'wiki:sigil/agents/default.md',
      subject_id: 'wiki:sigil/agents/default.md',
      subject_type: 'wiki.entity',
      facet_key: 'wiki',
      layer: 'narrative',
      role: 'source',
    },
  ]);
});

test('createSigilAgentSubject derives identity from the source wiki path', () => {
  const subject = createSigilAgentSubject({
    path: 'sigil/agents/researcher.md',
    frontmatter: {
      type: 'agent',
      name: 'Researcher',
    },
  });

  assert.equal(subject.id, 'sigil.agent:researcher');
  assert.equal(subject.metadata.agent_id, 'researcher');
  assert.equal(subject.metadata.wiki_subject.id, 'wiki:sigil/agents/researcher.md');
});

test('createSigilAgentSubject rejects missing source identity', () => {
  assert.throws(() => createSigilAgentSubject({ type: 'agent' }), /requires a source wiki path/);
});
