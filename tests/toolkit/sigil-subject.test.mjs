import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createSigilAgentSubject,
  createSigilAvatarSubject,
  SIGIL_AVATAR_SUBJECT_ID,
  SIGIL_AVATAR_SUBJECT_TYPE,
} from '../../packages/toolkit/workbench/sigil-subject.js';
import {
  subjectCapabilities,
  subjectContracts,
  subjectFacets,
  subjectHosts,
  subjectReferences,
} from '../../packages/toolkit/workbench/subject.js';
import { VISUAL_OBJECT_DESCRIPTOR_CONTRACT_ID } from '../../packages/toolkit/workbench/visual-object-contract.js';

test('createSigilAgentSubject builds a Sigil agent domain subject from a wiki document', () => {
  const subject = createSigilAgentSubject({
    path: 'sigil/agents/default.md',
    type: 'entity',
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
  assert.deepEqual(subjectCapabilities(subject), ['inspectable', 'editable']);
  assert.deepEqual(subject.capabilities, ['inspectable', 'editable']);
  assert.ok(subjectContracts(subject).includes('markdown_document.save.requested'));
  assert.ok(subjectContracts(subject).includes('sigil.agent.preview'));
  assert.ok(subjectContracts(subject).includes('sigil.agent.appearance'));
  assert.equal('views' in subject, false);
  assert.equal('controls' in subject, false);

  assert.deepEqual(subject.metadata.wiki_subject, {
    id: 'wiki:sigil/agents/default.md',
    subject_type: 'wiki.entity',
    path: 'sigil/agents/default.md',
  });
  assert.equal('subject_references' in subject.metadata, false);
  assert.deepEqual(subject.subject_references, [
    {
      id: 'sigil-agent-narrative-source',
      relationship: 'narrative_source',
      handle: 'wiki:sigil/agents/default.md',
      subject_id: 'wiki:sigil/agents/default.md',
      subject_type: 'wiki.entity',
      facet_key: 'wiki-markdown',
      layer: 'narrative',
      role: 'source',
    },
  ]);
  assert.equal(subjectReferences(subject).length, 1);
  assert.deepEqual(subjectFacets(subject).map((facet) => facet.key), [
    'narrative',
    'avatar-preview',
    'appearance-controls',
  ]);
  const hosts = subjectHosts(subject);
  assert.ok(hosts.every((host) => host.kind === 'canvas' && host.target_dialect === 'canvas'));
  assert.ok(hosts.some((host) => host.entry.value === 'aos://toolkit/components/markdown-workbench/index.html'));
  assert.ok(hosts.some((host) => host.entry.value === 'aos://sigil/renderer/index.html'));
  assert.ok(hosts.some((host) => host.entry.value === 'aos://toolkit/components/wiki-subject-browser/index.html'));
});

test('createSigilAgentSubject derives identity from the source wiki path', () => {
  const subject = createSigilAgentSubject({
    path: 'sigil/agents/researcher.md',
    frontmatter: {
      type: 'entity',
      name: 'Researcher',
    },
  });

  assert.equal(subject.id, 'sigil.agent:researcher');
  assert.equal(subject.metadata.agent_id, 'researcher');
  assert.equal(subject.metadata.wiki_subject.id, 'wiki:sigil/agents/researcher.md');
});

test('createSigilAgentSubject rejects missing source identity', () => {
  assert.throws(() => createSigilAgentSubject({ type: 'entity' }), /requires a source wiki path/);
});

test('createSigilAvatarSubject builds a canonical avatar editor subject without agent or legacy routing', () => {
  const subject = createSigilAvatarSubject();
  const facets = subjectFacets(subject);
  const hosts = subjectHosts(subject);
  const serialized = JSON.stringify(subject);

  assert.equal(subject.type, 'aos.workbench.subject');
  assert.equal(subject.id, SIGIL_AVATAR_SUBJECT_ID);
  assert.equal(subject.subject_type, SIGIL_AVATAR_SUBJECT_TYPE);
  assert.equal(subject.owner, 'sigil');
  assert.deepEqual(subjectCapabilities(subject), ['inspectable', 'editable', 'verifier-target', 'exportable']);
  assert.ok(subjectContracts(subject).includes('sigil.avatar.editor.read'));
  assert.ok(subjectContracts(subject).includes('sigil.avatar.control.patch'));
  assert.ok(subjectContracts(subject).includes('sigil.avatar.object_graph.read'));
  assert.ok(subjectContracts(subject).includes(VISUAL_OBJECT_DESCRIPTOR_CONTRACT_ID));
  assert.ok(subjectContracts(subject).includes('canvas_object.registry'));
  assert.equal(subject.source.canvas_id, 'avatar-main');
  assert.equal(subject.state.object_ids.root, 'avatar.main');
  assert.equal(subject.state.object_ids.primaryShape, 'avatar.primary.shape');
  assert.equal(subject.state.object_ids.omegaShape, 'avatar.omega.shape');
  assert.equal(subject.state.object_ids.lightning, 'avatar.effects.lightning');
  assert.equal(subject.state.object_ids.magnetic, 'avatar.effects.magnetic');
  assert.equal(subject.state.object_graph.kind, 'sigil.avatar.object_graph');
  assert.equal(subject.state.object_graph.root_object_id, 'avatar.main');
  assert.equal(subject.state.object_graph.node_ids.primaryShape, 'avatar.primary.shape');
  assert.ok(subject.state.object_graph.edges.some((edge) => edge.from === 'avatar.main'
    && edge.to === 'avatar.effects.lightning'
    && edge.relationship === 'owns_effect_node'));
  assert.equal(subject.state.surface_layouts.compact_control_surface.invocation, 'avatar_right_click');
  assert.deepEqual(
    subject.state.surface_layouts.compact_control_surface.tabs.map((tab) => tab.key),
    ['alpha', 'omega', 'effects', 'travel'],
  );
  assert.equal(subject.state.surface_layouts.wiki_browser_object_graph.layout, 'object_graph_drilldown');
  assert.equal(subject.state.surface_layouts.wiki_browser_object_graph.root_object_id, 'avatar.main');
  assert.equal(subject.metadata.canonical_model, 'sigil.avatar.object_graph');
  assert.equal(subject.metadata.visual_object_contract, VISUAL_OBJECT_DESCRIPTOR_CONTRACT_ID);
  assert.ok(subjectReferences(subject).some((reference) => reference.handle === 'avatar.primary.shape'));
  assert.ok(subjectReferences(subject).some((reference) => reference.handle === 'avatar.omega.shape'));
  assert.ok(subjectReferences(subject).some((reference) => reference.handle === 'avatar.effects.lightning'));
  assert.ok(subjectReferences(subject).some((reference) => reference.handle === 'avatar.effects.magnetic'));
  assert.ok(hosts.some((host) => host.entry.value === 'aos://sigil/renderer/index.html'));
  assert.ok(hosts.some((host) => host.entry.value === 'aos://toolkit/components/wiki-subject-browser/index.html'));
  assert.equal(serialized.includes('sigil.agent'), false);

  const facetKeys = facets.map((facet) => facet.key);
  assert.ok(facetKeys.includes('avatar-preview'));
  assert.ok(facetKeys.includes('primary-shape'));
  assert.ok(facetKeys.includes('omega-shape'));
  assert.ok(facetKeys.includes('appearance'));
  assert.ok(facetKeys.includes('effects'));
  assert.ok(facetKeys.includes('avatar-object-graph'));
  assert.ok(facetKeys.includes('compact-control-surface-projection'));

  const appearance = facets.find((facet) => facet.key === 'appearance');
  assert.ok(appearance.metadata.object_ids.includes('avatar.effects.lightning'));
  assert.ok(appearance.metadata.object_ids.includes('avatar.effects.magnetic'));
  const graphFacet = facets.find((facet) => facet.key === 'avatar-object-graph');
  assert.equal(graphFacet.metadata.surface_layout.kind, 'sigil.avatar.wiki_browser_object_graph_view');
  assert.equal(graphFacet.metadata.surface_layout.layout, 'object_graph_drilldown');
});

test('createSigilAvatarSubject keeps projection-only shortcuts outside canonical avatar facets', () => {
  const subject = createSigilAvatarSubject();
  const facets = subjectFacets(subject);
  const canonicalFacets = facets.filter((facet) => facet.metadata?.canonical_avatar_edit);
  const projectionFacet = facets.find((facet) => facet.key === 'compact-control-surface-projection');
  const projectionIds = projectionFacet.metadata.projection_only_control_ids;

  assert.equal(projectionFacet.metadata.surface_layout.kind, 'sigil.avatar.compact_tabbed_control_surface');
  assert.deepEqual(projectionFacet.metadata.surface_layout.tabs.map((tab) => tab.key), ['alpha', 'omega', 'effects', 'travel']);
  assert.ok(projectionIds.includes('toggle-inspector'));
  assert.ok(projectionIds.includes('toggle-trace'));
  assert.ok(projectionIds.includes('toggle-render-performance'));
  assert.ok(projectionIds.includes('toggle-log'));
  assert.ok(projectionIds.includes('copy'));
  assert.ok(projectionIds.includes('save'));
  assert.ok(projectionIds.includes('import'));
  assert.equal(canonicalFacets.some((facet) => facet.metadata?.projection_only_control_ids), false);
});
