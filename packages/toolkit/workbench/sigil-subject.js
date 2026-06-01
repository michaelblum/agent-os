import { createWorkbenchSubject } from './subject.js';
import { createWikiPageSubject } from './wiki-subject.js';
import { VISUAL_OBJECT_DESCRIPTOR_CONTRACT_ID } from './visual-object-contract.js';

const MARKDOWN_WORKBENCH_URL = 'aos://toolkit/components/markdown-workbench/index.html';
const SIGIL_RENDERER_URL = 'aos://sigil/renderer/index.html';
const WIKI_SUBJECT_BROWSER_URL = 'aos://toolkit/components/wiki-subject-browser/index.html';

export const SIGIL_AVATAR_SUBJECT_ID = 'sigil.avatar:avatar-main';
export const SIGIL_AVATAR_SUBJECT_TYPE = 'sigil.avatar';

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

export function createSigilAvatarSubject(options = {}) {
  const childObjectIds = options.childObjectIds || DEFAULT_AVATAR_CHILD_OBJECT_IDS;
  const controlGroups = Array.isArray(options.controlGroups) && options.controlGroups.length > 0
    ? options.controlGroups
    : DEFAULT_AVATAR_CONTROL_GROUPS;
  const avatarId = text(options.avatarId, 'avatar-main');
  const avatarSubjectId = text(options.id, SIGIL_AVATAR_SUBJECT_ID);
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
      VISUAL_OBJECT_DESCRIPTOR_CONTRACT_ID,
      'canvas_object.registry',
      'canvas_object.transform.patch',
      'canvas_object.effects.patch',
    ],
    subject_references: [
      ...childObjectReferences(childObjectIds),
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
    },
    metadata: {
      avatar_id: avatarId,
      canonical_model: 'sigil.avatar.object_graph',
      editor_model: options.editorModelSource || 'apps/sigil/avatar-editor/model.js',
      visual_object_contract: VISUAL_OBJECT_DESCRIPTOR_CONTRACT_ID,
      projection_only_control_ids: [...DEFAULT_COMPACT_SURFACE_PROJECTION_ONLY_IDS],
      agent_subject_separate: true,
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
