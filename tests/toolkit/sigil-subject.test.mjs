import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createSigilAgentSubject,
  createSigilAvatarSubject,
  createSigilSelectionCursorSubject,
  SIGIL_AVATAR_SUBJECT_ID,
  SIGIL_AVATAR_SUBJECT_TYPE,
  SIGIL_SELECTION_CURSOR_SUBJECT_ID,
  SIGIL_SELECTION_CURSOR_SUBJECT_TYPE,
} from '../../packages/toolkit/workbench/sigil-subject.js';
import {
  subjectCapabilities,
  subjectContracts,
  subjectFacets,
  subjectHosts,
  subjectReferences,
} from '../../packages/toolkit/workbench/subject.js';

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
  assert.equal(hosts.some((host) => host.entry.value.includes('/studio/')), false);
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

test('createSigilAvatarSubject builds a canonical avatar editor subject without agent or studio routing', () => {
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
  assert.ok(subjectReferences(subject).some((reference) => reference.handle === 'avatar.primary.shape'));
  assert.ok(subjectReferences(subject).some((reference) => reference.handle === 'avatar.omega.shape'));
  assert.ok(subjectReferences(subject).some((reference) => reference.handle === 'avatar.effects.lightning'));
  assert.ok(subjectReferences(subject).some((reference) => reference.handle === 'avatar.effects.magnetic'));
  assert.ok(subjectReferences(subject).some((reference) => reference.handle === SIGIL_SELECTION_CURSOR_SUBJECT_ID
    && reference.relationship === 'sidecar_projection'));
  assert.equal(subject.state.sidecars.selection_cursor, SIGIL_SELECTION_CURSOR_SUBJECT_ID);
  assert.deepEqual(subject.metadata.sidecar_subject_ids, [SIGIL_SELECTION_CURSOR_SUBJECT_ID]);
  assert.ok(hosts.some((host) => host.entry.value === 'aos://sigil/renderer/index.html'));
  assert.ok(hosts.some((host) => host.entry.value === 'aos://toolkit/components/wiki-subject-browser/index.html'));
  assert.equal(serialized.includes('/studio/'), false);
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

test('createSigilSelectionCursorSubject builds a side-car object graph for avatar-derived cursor projection', () => {
  const subject = createSigilSelectionCursorSubject();
  const facets = subjectFacets(subject);
  const hosts = subjectHosts(subject);
  const references = subjectReferences(subject);
  const serialized = JSON.stringify(subject);

  assert.equal(subject.type, 'aos.workbench.subject');
  assert.equal(subject.id, SIGIL_SELECTION_CURSOR_SUBJECT_ID);
  assert.equal(subject.subject_type, SIGIL_SELECTION_CURSOR_SUBJECT_TYPE);
  assert.equal(subject.owner, 'sigil');
  assert.deepEqual(subjectCapabilities(subject), ['inspectable', 'editable', 'verifier-target', 'exportable']);
  assert.ok(subjectContracts(subject).includes('sigil.selection_cursor.object_graph.read'));
  assert.ok(subjectContracts(subject).includes('sigil.selection_cursor.render_model.read'));
  assert.ok(subjectContracts(subject).includes('sigil.selection_cursor.trail_model.read'));
  assert.ok(subjectContracts(subject).includes('sigil.selection_mode.ancestor_ladder.read'));
  assert.ok(subjectContracts(subject).includes('sigil.avatar.appearance.inherit'));
  assert.ok(subjectContracts(subject).includes('canvas_object.transform.patch'));
  assert.ok(subjectContracts(subject).includes('canvas_object.effects.patch'));
  assert.equal(subject.source.kind, 'runtime_projection');
  assert.equal(subject.source.avatar_subject_id, SIGIL_AVATAR_SUBJECT_ID);
  assert.equal(subject.state.avatar_subject_id, SIGIL_AVATAR_SUBJECT_ID);
  assert.equal(subject.state.object_ids.root, 'selection-mode.cursor.model-root');
  assert.equal(subject.state.object_ids.primary, 'selection-mode.cursor.sigil-model');
  assert.equal(subject.state.object_ids.trail, 'selection-mode.cursor.trail-model');
  assert.equal(subject.state.object_ids.effects, 'selection-mode.cursor.sigil-model.effects');
  assert.equal(subject.state.object_ids.target, 'selection-mode.cursor.target');
  assert.equal(subject.state.object_ids.ancestorLadder, 'selection-mode.cursor.ancestor-ladder');
  assert.equal(subject.state.object_graph.kind, 'sigil.selection_cursor.object_graph');
  assert.equal(subject.state.object_graph.root_object_id, 'selection-mode.cursor.model-root');
  assert.ok(subject.state.object_graph.edges.some((edge) => edge.from === 'selection-mode.cursor.target'
    && edge.to === 'selection-mode.cursor.ancestor-ladder'
    && edge.relationship === 'derives_ancestor_ladder'));
  assert.ok(subject.state.object_graph.edges.some((edge) => edge.from === 'selection-mode.cursor.sigil-model'
    && edge.to === 'selection-mode.cursor.sigil-model.effects'
    && edge.relationship === 'adapts_avatar_effect_descriptors'));
  assert.equal(subject.state.surface_layouts.wiki_browser_object_graph.layout, 'object_graph_drilldown');
  assert.equal(subject.state.render_model.kind, 'selection_mode_cursor');
  assert.equal(subject.state.render_model.model_kind, 'sigil_model');
  assert.equal(subject.state.render_model.shape, 'avatar_derived_prism_pointer');
  assert.equal(subject.state.render_model.geometry.primitive, 'prism');
  assert.equal(subject.state.render_model.geometry.geometry_type, 93);
  assert.equal(subject.state.render_model.geometry.top_radius, 0);
  assert.equal(subject.state.render_model.geometry.bottom_radius, 0.8);
  assert.equal(subject.state.render_model.geometry.height, 2);
  assert.equal(subject.state.render_model.geometry.sides, 3);
  assert.equal(subject.state.render_model.geometry.cross_section, 'triangular');
  assert.equal(subject.state.render_model.geometry.source_policy, 'mirror_current_avatar_except_faces_rotation_orientation');
  assert.equal(subject.state.render_model.geometry.long_axis, 'screen_north_west');
  assert.deepEqual(subject.state.render_model.geometry.orientation_degrees, { x: 0, y: 0, z: 45 });
  assert.equal(subject.state.render_model.hotspot.kind, 'tip');
  assert.equal(subject.state.render_model.animation.axis, 'local_y');
  assert.equal(subject.state.render_model.animation.rotates_on_axis, 'long_axis');
  assert.deepEqual(subject.state.render_model.controls.rotation_degrees, { x: 0, y: 0, z: 45 });
  assert.deepEqual(subject.state.render_model.controls.geometry_controls.map((control) => control.id), [
    'cursor.prism.topRadius',
    'cursor.prism.bottomRadius',
    'cursor.prism.height',
    'cursor.prism.sides',
    'cursor.spin.speed',
  ]);
  assert.ok(subject.state.render_model.cursor_overrides.includes('single_axis_rotation'));
  assert.equal(subject.state.trail_model.shape, 'avatar_derived_prism_pointer');
  assert.equal(subject.state.trail_model.repeat_geometry, 'prism');
  assert.equal(subject.state.trail_model.policy.max_visible_instances, 8);
  assert.equal(subject.state.style_source.appearance_source, 'current_live_sigil_avatar');
  assert.equal(subject.state.style_source.material_source, 'current_avatar_render_model');
  assert.equal(subject.state.style_source.effects_source, 'current_avatar_effect_descriptors');
  assert.equal(subject.state.selection_target.badge_order, 'leaf-to-root');
  assert.equal(subject.metadata.sidecar_for, SIGIL_AVATAR_SUBJECT_ID);
  assert.equal(subject.metadata.canonical_model, 'sigil.selection_cursor.object_graph');
  assert.equal(subject.metadata.projection_only, true);
  assert.ok(references.some((reference) => reference.handle === SIGIL_AVATAR_SUBJECT_ID
    && reference.relationship === 'sidecar_of'));
  assert.ok(references.some((reference) => reference.handle === 'selection-mode.cursor.sigil-model'
    && reference.role === 'primary'));
  assert.ok(references.some((reference) => reference.handle === 'selection-mode.cursor.ancestor-ladder'
    && reference.subject_type === 'runtime.selection_mode'));

  const facetKeys = facets.map((facet) => facet.key);
  assert.deepEqual(facetKeys, [
    'cursor-object-graph',
    'cursor-render-model',
    'cursor-trail-model',
    'selection-target',
    'ancestor-ladder',
    'avatar-style-source',
  ]);
  const graphFacet = facets.find((facet) => facet.key === 'cursor-object-graph');
  assert.equal(graphFacet.metadata.surface_layout.kind, 'sigil.selection_cursor.wiki_browser_object_graph_view');
  assert.ok(hosts.some((host) => host.entry.value === 'aos://sigil/renderer/index.html'));
  assert.ok(hosts.some((host) => host.entry.value === 'aos://toolkit/components/wiki-subject-browser/index.html'));
  assert.equal(serialized.includes('/studio/'), false);
  assert.equal(serialized.includes('sigil.agent'), false);
});
