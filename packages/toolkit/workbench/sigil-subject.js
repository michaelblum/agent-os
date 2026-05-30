import { createWorkbenchSubject } from './subject.js';
import { createWikiPageSubject } from './wiki-subject.js';

const MARKDOWN_WORKBENCH_URL = 'aos://toolkit/components/markdown-workbench/index.html';
const SIGIL_RENDERER_URL = 'aos://sigil/renderer/index.html';
const WIKI_SUBJECT_BROWSER_URL = 'aos://toolkit/components/wiki-subject-browser/index.html';

export const SIGIL_AVATAR_SUBJECT_ID = 'sigil.avatar:avatar-main';
export const SIGIL_AVATAR_SUBJECT_TYPE = 'sigil.avatar';
export const SIGIL_SELECTION_CURSOR_SUBJECT_ID = 'sigil.selection_cursor:avatar-main';
export const SIGIL_SELECTION_CURSOR_SUBJECT_TYPE = 'sigil.selection_cursor';

const DEFAULT_AVATAR_CHILD_OBJECT_IDS = Object.freeze({
  root: 'avatar.main',
  primaryShape: 'avatar.primary.shape',
  primaryTesseron: 'avatar.primary.tesseron',
  omegaShape: 'avatar.omega.shape',
  omegaTesseron: 'avatar.omega.tesseron',
  aura: 'avatar.effects.aura',
  phenomena: 'avatar.effects.phenomena',
  lightning: 'avatar.effects.lightning',
  magnetic: 'avatar.effects.magnetic',
  trail: 'avatar.effects.trail',
  travel: 'avatar.effects.travel',
});

const DEFAULT_AVATAR_OBJECT_GRAPH_EDGES = Object.freeze([
  Object.freeze({ from: 'avatar.main', to: 'avatar.primary.shape', relationship: 'owns_render_node' }),
  Object.freeze({ from: 'avatar.primary.shape', to: 'avatar.primary.tesseron', relationship: 'owns_child_geometry' }),
  Object.freeze({ from: 'avatar.main', to: 'avatar.omega.shape', relationship: 'owns_render_node' }),
  Object.freeze({ from: 'avatar.omega.shape', to: 'avatar.omega.tesseron', relationship: 'owns_child_geometry' }),
  Object.freeze({ from: 'avatar.main', to: 'avatar.effects.aura', relationship: 'owns_effect_node' }),
  Object.freeze({ from: 'avatar.main', to: 'avatar.effects.phenomena', relationship: 'owns_effect_node' }),
  Object.freeze({ from: 'avatar.main', to: 'avatar.effects.lightning', relationship: 'owns_effect_node' }),
  Object.freeze({ from: 'avatar.main', to: 'avatar.effects.magnetic', relationship: 'owns_effect_node' }),
  Object.freeze({ from: 'avatar.main', to: 'avatar.effects.trail', relationship: 'owns_effect_node' }),
  Object.freeze({ from: 'avatar.main', to: 'avatar.effects.travel', relationship: 'owns_effect_node' }),
]);

const DEFAULT_AVATAR_CONTROL_GROUPS = Object.freeze([
  Object.freeze({ key: 'avatar-root', label: 'Avatar Root', facet: 'identity', object_ids: ['avatar.main'] }),
  Object.freeze({ key: 'primary-polyhedron', label: 'Alpha Primary Polyhedron', facet: 'primary-shape', object_ids: ['avatar.primary.shape', 'avatar.primary.tesseron'] }),
  Object.freeze({ key: 'omega-polyhedron', label: 'Omega Polyhedron', facet: 'omega-shape', object_ids: ['avatar.omega.shape', 'avatar.omega.tesseron'] }),
  Object.freeze({
    key: 'appearance-materials',
    label: 'Appearance And Materials',
    facet: 'appearance',
    object_ids: [
      'avatar.primary.shape',
      'avatar.omega.shape',
      'avatar.effects.aura',
      'avatar.effects.phenomena',
      'avatar.effects.lightning',
      'avatar.effects.magnetic',
    ],
  }),
  Object.freeze({ key: 'aura-effects', label: 'Aura', facet: 'effects', object_ids: ['avatar.effects.aura'] }),
  Object.freeze({ key: 'phenomena-effects', label: 'Phenomena', facet: 'effects', object_ids: ['avatar.effects.phenomena'] }),
  Object.freeze({ key: 'lightning-effects', label: 'Lightning', facet: 'effects', object_ids: ['avatar.effects.lightning'] }),
  Object.freeze({ key: 'magnetic-effects', label: 'Magnetic', facet: 'effects', object_ids: ['avatar.effects.magnetic'] }),
  Object.freeze({ key: 'path-trail-effects', label: 'Path Trail', facet: 'effects', object_ids: ['avatar.effects.trail'] }),
  Object.freeze({ key: 'fast-travel-visuals', label: 'Fast Travel Visuals', facet: 'effects', object_ids: ['avatar.effects.travel'] }),
]);

const DEFAULT_COMPACT_SURFACE_PROJECTION_ONLY_IDS = Object.freeze([
  'sigil-menu-grid-mode',
  'sigil-menu-ring',
  'sigil-menu-avatar-above-menu',
  'sigil-menu-cancel-radius',
  'sigil-menu-grid1',
  'sigil-menu-grid2',
  'toggle-inspector',
  'toggle-trace',
  'toggle-render-performance',
  'toggle-log',
  'copy',
  'save',
  'import',
]);

const DEFAULT_COMPACT_SURFACE_TABS = Object.freeze([
  Object.freeze({ key: 'alpha', label: 'Alpha', group_keys: ['primary-polyhedron', 'appearance-materials'], object_ids: ['avatar.primary.shape', 'avatar.primary.tesseron'] }),
  Object.freeze({ key: 'omega', label: 'Omega', group_keys: ['omega-polyhedron', 'appearance-materials'], object_ids: ['avatar.omega.shape', 'avatar.omega.tesseron'] }),
  Object.freeze({ key: 'effects', label: 'Effects', group_keys: ['aura-effects', 'phenomena-effects', 'lightning-effects', 'magnetic-effects', 'path-trail-effects'], object_ids: ['avatar.effects.aura', 'avatar.effects.phenomena', 'avatar.effects.lightning', 'avatar.effects.magnetic', 'avatar.effects.trail'] }),
  Object.freeze({ key: 'travel', label: 'Travel', group_keys: ['fast-travel-visuals'], object_ids: ['avatar.effects.travel'] }),
]);

const DEFAULT_SELECTION_CURSOR_OBJECT_IDS = Object.freeze({
  root: 'selection-mode.cursor.model-root',
  primary: 'selection-mode.cursor.sigil-model',
  trail: 'selection-mode.cursor.trail-model',
  effects: 'selection-mode.cursor.sigil-model.effects',
  target: 'selection-mode.cursor.target',
  ancestorLadder: 'selection-mode.cursor.ancestor-ladder',
});

const DEFAULT_SELECTION_CURSOR_OBJECT_GRAPH_EDGES = Object.freeze([
  Object.freeze({ from: 'selection-mode.cursor.model-root', to: 'selection-mode.cursor.sigil-model', relationship: 'owns_render_node' }),
  Object.freeze({ from: 'selection-mode.cursor.model-root', to: 'selection-mode.cursor.trail-model', relationship: 'owns_trail_projection' }),
  Object.freeze({ from: 'selection-mode.cursor.sigil-model', to: 'selection-mode.cursor.sigil-model.effects', relationship: 'adapts_avatar_effect_descriptors' }),
  Object.freeze({ from: 'selection-mode.cursor.model-root', to: 'selection-mode.cursor.target', relationship: 'tracks_selection_target' }),
  Object.freeze({ from: 'selection-mode.cursor.target', to: 'selection-mode.cursor.ancestor-ladder', relationship: 'derives_ancestor_ladder' }),
]);

function text(value, fallback = '') {
  const normalized = String(value ?? '').replace(/\s+/g, ' ').trim();
  return normalized || fallback;
}

function pathText(value) {
  return String(value ?? '').replace(/^\/+/, '').trim();
}

function basename(path = '') {
  return pathText(path).split('/').filter(Boolean).pop() || '';
}

function frontmatterValue(page = {}, key = '') {
  const frontmatter = page.frontmatter && typeof page.frontmatter === 'object' ? page.frontmatter : {};
  return page[key] ?? frontmatter[key];
}

function selectionCursorSubjectIdForAvatarId(avatarId = 'avatar-main') {
  const normalizedAvatarId = text(avatarId, 'avatar-main');
  if (normalizedAvatarId === 'avatar-main') return SIGIL_SELECTION_CURSOR_SUBJECT_ID;
  return `sigil.selection_cursor:${normalizedAvatarId}`;
}

function agentIdForPage(page = {}, path = '') {
  const explicit = text(frontmatterValue(page, 'id') || frontmatterValue(page, 'agent_id'));
  return explicit || basename(path).replace(/\.md$/i, '');
}

function createNarrativeSourceReference(wikiSubject, { id = 'sigil-agent-narrative-source' } = {}) {
  return {
    id,
    relationship: 'narrative_source',
    handle: wikiSubject.id,
    subject_id: wikiSubject.id,
    subject_type: wikiSubject.subject_type,
    facet_key: 'wiki-markdown',
    layer: 'narrative',
    role: 'source',
  };
}

function canvasComponentHost(value, { preferred = false, facet = '' } = {}) {
  return {
    kind: 'canvas',
    target_dialect: 'canvas',
    entry: {
      kind: 'aos-url',
      value,
      ...(facet ? { facet } : {}),
    },
    ...(preferred ? { preferred: true } : {}),
  };
}

function childObjectReferences(childObjectIds = DEFAULT_AVATAR_CHILD_OBJECT_IDS) {
  return Object.entries(childObjectIds).map(([role, objectId]) => ({
    id: `sigil-avatar-${role}`,
    relationship: 'avatar_child_object',
    handle: objectId,
    subject_id: objectId,
    subject_type: 'canvas.object',
    layer: 'model',
    role,
  }));
}

function selectionCursorSidecarReference({
  selectionCursorSubjectId = SIGIL_SELECTION_CURSOR_SUBJECT_ID,
} = {}) {
  return {
    id: 'sigil-avatar-selection-cursor-sidecar',
    relationship: 'sidecar_projection',
    handle: selectionCursorSubjectId,
    subject_id: selectionCursorSubjectId,
    subject_type: SIGIL_SELECTION_CURSOR_SUBJECT_TYPE,
    facet_key: 'cursor-object-graph',
    layer: 'projection',
    role: 'selection-cursor',
  };
}

function selectionCursorObjectReferences({
  avatarSubjectId = SIGIL_AVATAR_SUBJECT_ID,
  objectIds = DEFAULT_SELECTION_CURSOR_OBJECT_IDS,
} = {}) {
  return [
    {
      id: 'sigil-selection-cursor-avatar-source',
      relationship: 'sidecar_of',
      handle: avatarSubjectId,
      subject_id: avatarSubjectId,
      subject_type: SIGIL_AVATAR_SUBJECT_TYPE,
      facet_key: 'avatar-object-graph',
      layer: 'model',
      role: 'avatar-source',
    },
    ...Object.entries(objectIds).map(([role, objectId]) => ({
      id: `sigil-selection-cursor-${role}`,
      relationship: 'selection_cursor_object',
      handle: objectId,
      subject_id: objectId,
      subject_type: role === 'target' || role === 'ancestorLadder' ? 'runtime.selection_mode' : 'canvas.object',
      layer: role === 'target' || role === 'ancestorLadder' ? 'runtime' : 'model',
      role,
    })),
  ];
}

function avatarEditorFacet(group = {}, options = {}) {
  return {
    key: group.facet || group.key,
    layer: 'controls',
    label: group.label || group.key,
    capabilities: ['inspectable', 'editable'],
    contracts: [
      'sigil.avatar.editor.read',
      'sigil.avatar.control.patch',
      'canvas_object.registry',
      ...(group.key === 'primary-polyhedron' || group.key === 'omega-polyhedron'
        ? ['canvas_object.transform.patch']
        : []),
      ...(group.key !== 'avatar-root' ? ['canvas_object.effects.patch'] : []),
    ],
    hosts: [
      canvasComponentHost(WIKI_SUBJECT_BROWSER_URL, {
        preferred: options.preferred,
        facet: group.facet || group.key,
      }),
    ],
    metadata: {
      group_key: group.key,
      object_ids: Array.isArray(group.object_ids) ? [...group.object_ids] : [],
      canonical_avatar_edit: true,
    },
  };
}

function avatarSurfaceLayouts(controlGroups = DEFAULT_AVATAR_CONTROL_GROUPS) {
  return {
    compact_control_surface: {
      kind: 'sigil.avatar.compact_tabbed_control_surface',
      invocation: 'avatar_right_click',
      layout: 'tabs',
      source: 'sigil.avatar.object_graph',
      tabs: DEFAULT_COMPACT_SURFACE_TABS.map((tab) => ({ ...tab })),
      shortcut_projection_control_ids: [...DEFAULT_COMPACT_SURFACE_PROJECTION_ONLY_IDS],
    },
    wiki_browser_object_graph: {
      kind: 'sigil.avatar.wiki_browser_object_graph_view',
      layout: 'object_graph_drilldown',
      source: 'sigil.avatar.object_graph',
      root_object_id: 'avatar.main',
      group_keys: controlGroups.map((group) => group.key),
    },
  };
}

function selectionCursorSurfaceLayouts(objectIds = DEFAULT_SELECTION_CURSOR_OBJECT_IDS) {
  return {
    wiki_browser_object_graph: {
      kind: 'sigil.selection_cursor.wiki_browser_object_graph_view',
      layout: 'object_graph_drilldown',
      source: 'sigil.selection_cursor.object_graph',
      root_object_id: objectIds.root,
      group_keys: ['cursor-render-model', 'cursor-trail-model', 'selection-target', 'ancestor-ladder', 'avatar-style-source'],
    },
  };
}

export function createSigilAvatarSubject(options = {}) {
  const childObjectIds = options.childObjectIds || DEFAULT_AVATAR_CHILD_OBJECT_IDS;
  const controlGroups = Array.isArray(options.controlGroups) && options.controlGroups.length > 0
    ? options.controlGroups
    : DEFAULT_AVATAR_CONTROL_GROUPS;
  const avatarId = text(options.avatarId, 'avatar-main');
  const avatarSubjectId = text(options.id, SIGIL_AVATAR_SUBJECT_ID);
  const selectionCursorSubjectId = text(
    options.selectionCursorSubjectId,
    selectionCursorSubjectIdForAvatarId(avatarId),
  );
  const surfaceLayouts = avatarSurfaceLayouts(controlGroups);

  return createWorkbenchSubject({
    id: avatarSubjectId,
    type: SIGIL_AVATAR_SUBJECT_TYPE,
    label: text(options.label, 'Sigil Avatar'),
    owner: 'sigil',
    source: {
      kind: 'canvas',
      canvas_id: avatarId,
      subject_id: avatarSubjectId,
      object_id: childObjectIds.root || 'avatar.main',
    },
    capabilities: [
      'inspectable',
      'editable',
      'verifier-target',
      'exportable',
    ],
    contracts: [
      'sigil.avatar.editor.read',
      'sigil.avatar.control.patch',
      'sigil.avatar.preview',
      'sigil.avatar.object_graph.read',
      'sigil.avatar.compact_control_surface.projection',
      'canvas_object.registry',
      'canvas_object.transform.patch',
      'canvas_object.effects.patch',
    ],
    subject_references: [
      ...childObjectReferences(childObjectIds),
      selectionCursorSidecarReference({ selectionCursorSubjectId }),
    ],
    facets: [
      {
        key: 'avatar-preview',
        layer: 'preview',
        label: 'Avatar Preview',
        capabilities: ['inspectable'],
        contracts: ['sigil.avatar.preview', 'canvas_object.registry'],
        hosts: [
          canvasComponentHost(SIGIL_RENDERER_URL, { preferred: true, facet: 'avatar-preview' }),
        ],
        metadata: {
          object_ids: [childObjectIds.root || 'avatar.main'],
          canonical_avatar_edit: true,
        },
      },
      ...controlGroups.map((group, index) => avatarEditorFacet(group, { preferred: index === 0 })),
      {
        key: 'avatar-object-graph',
        layer: 'graph',
        label: 'Avatar Object Graph',
        capabilities: ['inspectable', 'editable'],
        contracts: ['sigil.avatar.object_graph.read', 'sigil.avatar.control.patch', 'canvas_object.registry'],
        hosts: [
          canvasComponentHost(WIKI_SUBJECT_BROWSER_URL, { facet: 'avatar-object-graph' }),
        ],
        metadata: {
          canonical_avatar_edit: true,
          surface_layout: surfaceLayouts.wiki_browser_object_graph,
        },
      },
      {
        key: 'compact-control-surface-projection',
        layer: 'projection',
        label: 'Compact Control Surface Projection',
        capabilities: ['inspectable'],
        contracts: ['sigil.avatar.compact_control_surface.projection'],
        hosts: [
          canvasComponentHost(SIGIL_RENDERER_URL, { facet: 'compact-control-surface-projection' }),
        ],
        metadata: {
          canonical_avatar_edit: false,
          surface_layout: surfaceLayouts.compact_control_surface,
          projection_only_control_ids: [...DEFAULT_COMPACT_SURFACE_PROJECTION_ONLY_IDS],
        },
      },
    ],
    persistence: {
      kind: 'avatar_state_patch',
      request: 'sigil.avatar.control.patch',
      result: 'avatar_render_state.updated',
    },
    state: {
      avatar_id: avatarId,
      object_ids: { ...childObjectIds },
      object_graph: {
        kind: 'sigil.avatar.object_graph',
        root_object_id: childObjectIds.root || 'avatar.main',
        node_ids: { ...childObjectIds },
        edges: DEFAULT_AVATAR_OBJECT_GRAPH_EDGES.map((edge) => ({ ...edge })),
      },
      surface_layouts: surfaceLayouts,
      control_groups: controlGroups.map((group) => ({ ...group })),
      sidecars: {
        selection_cursor: selectionCursorSubjectId,
      },
    },
    metadata: {
      avatar_id: avatarId,
      canonical_model: 'sigil.avatar.object_graph',
      editor_model: options.editorModelSource || 'apps/sigil/avatar-editor/model.js',
      projection_only_control_ids: [...DEFAULT_COMPACT_SURFACE_PROJECTION_ONLY_IDS],
      sidecar_subject_ids: [selectionCursorSubjectId],
      agent_subject_separate: true,
    },
  });
}

export function createSigilSelectionCursorSubject(options = {}) {
  const avatarId = text(options.avatarId, 'avatar-main');
  const avatarSubjectId = text(options.avatarSubjectId, SIGIL_AVATAR_SUBJECT_ID);
  const objectIds = options.objectIds || DEFAULT_SELECTION_CURSOR_OBJECT_IDS;
  const surfaceLayouts = selectionCursorSurfaceLayouts(objectIds);

  return createWorkbenchSubject({
    id: text(options.id, selectionCursorSubjectIdForAvatarId(avatarId)),
    type: SIGIL_SELECTION_CURSOR_SUBJECT_TYPE,
    label: text(options.label, 'Sigil Selection Cursor'),
    owner: 'sigil',
    source: {
      kind: 'runtime_projection',
      avatar_id: avatarId,
      avatar_subject_id: avatarSubjectId,
      overlay_ref: 'liveState.selectionModeOverlay',
      cursor_model_snapshot_ref: 'readSelectionModeCursorModelSnapshot',
    },
    capabilities: [
      'inspectable',
      'editable',
      'verifier-target',
      'exportable',
    ],
    contracts: [
      'sigil.selection_cursor.object_graph.read',
      'sigil.selection_cursor.render_model.read',
      'sigil.selection_cursor.trail_model.read',
      'sigil.selection_mode.ancestor_ladder.read',
      'sigil.avatar.appearance.inherit',
      'canvas_object.registry',
      'canvas_object.transform.patch',
      'canvas_object.effects.patch',
    ],
    subject_references: selectionCursorObjectReferences({ avatarSubjectId, objectIds }),
    facets: [
      {
        key: 'cursor-object-graph',
        layer: 'graph',
        label: 'Selection Cursor Object Graph',
        capabilities: ['inspectable'],
        contracts: ['sigil.selection_cursor.object_graph.read', 'canvas_object.registry'],
        hosts: [
          canvasComponentHost(WIKI_SUBJECT_BROWSER_URL, { preferred: true, facet: 'cursor-object-graph' }),
        ],
        metadata: {
          surface_layout: surfaceLayouts.wiki_browser_object_graph,
          projection_only: true,
        },
      },
      {
        key: 'cursor-render-model',
        layer: 'model',
        label: 'Cursor Render Model',
        capabilities: ['inspectable', 'verifier-target'],
        contracts: ['sigil.selection_cursor.render_model.read', 'sigil.avatar.appearance.inherit', 'canvas_object.transform.patch', 'canvas_object.effects.patch'],
        hosts: [
          canvasComponentHost(SIGIL_RENDERER_URL, { facet: 'selection-cursor' }),
        ],
        metadata: {
          object_ids: [objectIds.root, objectIds.primary, objectIds.effects],
          model_kind: 'sigil_model',
          projection_only: true,
        },
      },
      {
        key: 'cursor-trail-model',
        layer: 'model',
        label: 'Cursor Trail Model',
        capabilities: ['inspectable', 'verifier-target'],
        contracts: ['sigil.selection_cursor.trail_model.read', 'sigil.avatar.appearance.inherit'],
        hosts: [
          canvasComponentHost(SIGIL_RENDERER_URL, { facet: 'selection-cursor-trail' }),
        ],
        metadata: {
          object_ids: [objectIds.trail],
          max_visible_instances: 8,
          projection_only: true,
        },
      },
      {
        key: 'selection-target',
        layer: 'runtime',
        label: 'Selection Target',
        capabilities: ['inspectable'],
        contracts: ['sigil.selection_mode.ancestor_ladder.read'],
        hosts: [
          canvasComponentHost(WIKI_SUBJECT_BROWSER_URL, { facet: 'selection-target' }),
        ],
        metadata: {
          object_ids: [objectIds.target, objectIds.ancestorLadder],
          projection_only: true,
        },
      },
      {
        key: 'ancestor-ladder',
        layer: 'runtime',
        label: 'Ancestor Ladder',
        capabilities: ['inspectable'],
        contracts: ['sigil.selection_mode.ancestor_ladder.read'],
        hosts: [
          canvasComponentHost(WIKI_SUBJECT_BROWSER_URL, { facet: 'ancestor-ladder' }),
        ],
        metadata: {
          object_ids: [objectIds.ancestorLadder],
          path_ref: 'selectionMode.context_session.artifacts[0].path',
          active_target_node_id_ref: 'selectionMode.context_session.artifacts[0].active_target_node_id',
          projection_only: true,
        },
      },
      {
        key: 'avatar-style-source',
        layer: 'reference',
        label: 'Avatar Style Source',
        capabilities: ['inspectable'],
        contracts: ['sigil.avatar.object_graph.read', 'sigil.avatar.appearance.inherit'],
        hosts: [
          canvasComponentHost(WIKI_SUBJECT_BROWSER_URL, { facet: 'avatar-style-source' }),
        ],
        metadata: {
          subject_id: avatarSubjectId,
          source_ref: 'sigil-selection-cursor-avatar-source',
          projection_only: true,
        },
      },
    ],
    state: {
      avatar_id: avatarId,
      avatar_subject_id: avatarSubjectId,
      object_ids: { ...objectIds },
      object_graph: {
        kind: 'sigil.selection_cursor.object_graph',
        root_object_id: objectIds.root,
        node_ids: { ...objectIds },
        edges: DEFAULT_SELECTION_CURSOR_OBJECT_GRAPH_EDGES.map((edge) => ({ ...edge })),
      },
      surface_layouts: surfaceLayouts,
      style_source: {
        source: 'avatar_render_state',
        appearance_source: 'current_live_sigil_avatar',
        material_source: 'current_avatar_render_model',
        effects_source: 'current_avatar_effect_descriptors',
        avatar_subject_id: avatarSubjectId,
        avatar_object_id: 'avatar.main',
      },
      render_model: {
        kind: 'selection_mode_cursor',
        model_kind: 'sigil_model',
        object_id: objectIds.primary,
        root_object_id: objectIds.root,
        source: 'avatar_render_state',
        appearance_source: 'current_live_sigil_avatar',
        material_source: 'current_avatar_render_model',
        effects_source: 'current_avatar_effect_descriptors',
        shape: 'avatar_derived_prism_pointer',
        geometry: {
          primitive: 'prism',
          geometry_type: 93,
          top_radius: 0,
          bottom_radius: 0.8,
          height: 2,
          sides: 3,
          cross_section: 'triangular',
          expected_depth_axis: 'screen_plane',
          long_axis: 'screen_north_west',
          base_screen_quadrant: 'down_right',
          source_policy: 'mirror_current_avatar_except_faces_rotation_orientation',
          orientation_degrees: { x: 0, y: 0, z: 45 },
          spin_axis: 'local_y',
        },
        hotspot: {
          kind: 'tip',
          local: { x: 0, y: 0, z: 0 },
        },
        animation: {
          source: 'selection_mode_pointer_single_axis',
          axis: 'local_y',
          rotates_on_axis: 'long_axis',
        },
        controls: {
          rotation_degrees: { x: 0, y: 0, z: 45 },
          geometry_controls: [
            { id: 'cursor.prism.topRadius', label: 'Front radius', type: 'slider', value: 0, min: 0, max: 2, step: 0.01 },
            { id: 'cursor.prism.bottomRadius', label: 'Rear radius', type: 'slider', value: 0.8, min: 0.1, max: 2, step: 0.01 },
            { id: 'cursor.prism.height', label: 'Length', type: 'slider', value: 2, min: 0.2, max: 4, step: 0.01 },
            { id: 'cursor.prism.sides', label: 'Face count', type: 'number', value: 3, min: 3, max: 64, step: 1 },
            { id: 'cursor.spin.speed', label: 'Long-axis spin', type: 'slider', value: 0.1, min: 0, max: 0.2, step: 0.001 },
          ],
        },
        cursor_overrides: ['geometry', 'orientation', 'hotspot', 'scale', 'visibility', 'single_axis_rotation'],
      },
      trail_model: {
        kind: 'selection_mode_cursor_trail',
        model_kind: 'sigil_model',
        object_id: objectIds.trail,
        shape: 'avatar_derived_prism_pointer',
        repeat_shape: 'avatar_derived_prism_pointer',
        repeat_geometry: 'prism',
        timing_source: 'selection_mode_trail',
        policy: {
          source: 'selection_mode_pointer_trail_policy',
          max_visible_instances: 8,
          opacity: 'subtle_avatar_derived_echo',
        },
      },
      selection_target: {
        source: 'selection_mode.context_session',
        active_target_node_id_ref: 'selectionMode.context_session.artifacts[0].active_target_node_id',
        ancestor_path_ref: 'selectionMode.context_session.artifacts[0].path',
        badge_order: 'leaf-to-root',
      },
      runtime_sources: {
        selection_mode: 'liveState.selectionMode',
        overlay: 'liveState.selectionModeOverlay',
        cursor_glyph: 'liveState.selectionModeOverlay.cursorGlyph',
        cursor_trail: 'liveState.selectionModeOverlay.cursorTrail',
        renderer_snapshot: 'readSelectionModeCursorModelSnapshot',
      },
    },
    metadata: {
      avatar_id: avatarId,
      sidecar_for: avatarSubjectId,
      canonical_model: 'sigil.selection_cursor.object_graph',
      editor_model: 'apps/sigil/renderer/live-modules/selection-mode-visual-model.js',
      renderer_model: 'apps/sigil/renderer/live-modules/selection-mode-cursor-model-renderer.js',
      projection_only: true,
    },
  });
}

export function createSigilAgentSubject(page = {}, options = {}) {
  const path = pathText(page.path);
  if (!path) throw new TypeError('sigil agent subject requires a source wiki path');

  const wikiSubject = createWikiPageSubject(page);
  const agentId = text(options.agentId || agentIdForPage(page, path));
  if (!agentId) throw new TypeError('sigil agent subject requires an agent id');

  const reference = createNarrativeSourceReference(wikiSubject, {
    id: options.referenceId || 'sigil-agent-narrative-source',
  });
  const label = text(options.label || frontmatterValue(page, 'name'), wikiSubject.label || agentId);
  const tags = Array.isArray(wikiSubject.metadata.tags) ? wikiSubject.metadata.tags : [];

  return createWorkbenchSubject({
    id: `sigil.agent:${agentId}`,
    type: 'sigil.agent',
    label,
    owner: 'sigil',
    source: {
      kind: 'wiki',
      path,
      namespace: wikiSubject.source?.namespace || 'sigil',
      plugin: wikiSubject.source?.plugin || null,
      agent_id: agentId,
    },
    capabilities: [
      'inspectable',
      'editable',
    ],
    contracts: [
      'wiki.read',
      'wiki.markdown.render',
      'markdown_document.text.patch',
      'markdown_document.save.requested',
      'sigil.agent.preview',
      'sigil.agent.appearance',
    ],
    subject_references: [reference],
    facets: [
      {
        key: 'narrative',
        layer: 'narrative',
        label: 'Agent Narrative',
        source_ref: reference.id,
        capabilities: ['inspectable', 'editable'],
        contracts: [
          'wiki.read',
          'wiki.markdown.render',
          'markdown_document.text.patch',
          'markdown_document.save.requested',
        ],
        hosts: [
          canvasComponentHost(MARKDOWN_WORKBENCH_URL, { preferred: true, facet: 'source' }),
        ],
      },
      {
        key: 'avatar-preview',
        layer: 'artifacts',
        label: 'Avatar Preview',
        capabilities: ['inspectable'],
        contracts: ['sigil.agent.preview'],
        hosts: [
          canvasComponentHost(SIGIL_RENDERER_URL, { facet: 'avatar-preview' }),
        ],
      },
      {
        key: 'appearance-controls',
        layer: 'controls',
        label: 'Appearance Controls',
        capabilities: ['editable'],
        contracts: ['sigil.agent.appearance'],
        hosts: [
          canvasComponentHost(WIKI_SUBJECT_BROWSER_URL, { facet: 'appearance-controls' }),
        ],
      },
    ],
    persistence: {
      kind: 'wiki_write',
      request: 'markdown_document.save.requested',
      result: 'wiki_page_changed',
    },
    state: {
      modified_at: wikiSubject.state.modified_at,
    },
    metadata: {
      agent_id: agentId,
      wiki_subject: {
        id: wikiSubject.id,
        subject_type: wikiSubject.subject_type,
        path,
      },
      wiki_type: wikiSubject.metadata.wiki_type,
      description: wikiSubject.metadata.description,
      tags,
    },
  });
}
