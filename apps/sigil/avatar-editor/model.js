import {
    contextMenuControlDescriptors,
    getContextMenuControlDescriptor,
} from '../context-menu/descriptors.js';
import {
    createVisualObjectDescriptor,
    VISUAL_OBJECT_DESCRIPTOR_CONTRACT_ID,
} from '../../../packages/toolkit/workbench/visual-object-contract.js';
import {
    AVATAR_AURA_OBJECT_ID,
    AVATAR_LIGHTNING_OBJECT_ID,
    AVATAR_MAGNETIC_OBJECT_ID,
    AVATAR_OMEGA_OBJECT_ID,
    AVATAR_OMEGA_TESSERON_OBJECT_ID,
    AVATAR_PHENOMENA_OBJECT_ID,
    AVATAR_PRIMARY_OBJECT_ID,
    AVATAR_PRIMARY_TESSERON_OBJECT_ID,
    AVATAR_ROOT_OBJECT_ID,
    AVATAR_TRAIL_OBJECT_ID,
    AVATAR_TRAVEL_OBJECT_ID,
} from '../renderer/live-modules/avatar-object-control.js';

export const SIGIL_AVATAR_SUBJECT_ID = 'sigil.avatar:avatar-main';
export const SIGIL_AVATAR_SUBJECT_TYPE = 'sigil.avatar';

export const SIGIL_AVATAR_GEOMETRY_OPTIONS = Object.freeze([
    Object.freeze({ value: 4, label: 'Tetrahedron' }),
    Object.freeze({ value: 6, label: 'Box' }),
    Object.freeze({ value: 8, label: 'Octahedron' }),
    Object.freeze({ value: 12, label: 'Dodecahedron' }),
    Object.freeze({ value: 20, label: 'Icosahedron' }),
    Object.freeze({ value: 90, label: 'Tetartoid' }),
    Object.freeze({ value: 91, label: 'Torus Knot' }),
    Object.freeze({ value: 92, label: 'Torus' }),
    Object.freeze({ value: 93, label: 'Prism' }),
    Object.freeze({ value: 100, label: 'Sphere' }),
]);

export const SIGIL_AVATAR_CHILD_OBJECT_IDS = Object.freeze({
    root: AVATAR_ROOT_OBJECT_ID,
    primaryShape: AVATAR_PRIMARY_OBJECT_ID,
    primaryTesseron: AVATAR_PRIMARY_TESSERON_OBJECT_ID,
    omegaShape: AVATAR_OMEGA_OBJECT_ID,
    omegaTesseron: AVATAR_OMEGA_TESSERON_OBJECT_ID,
    aura: AVATAR_AURA_OBJECT_ID,
    phenomena: AVATAR_PHENOMENA_OBJECT_ID,
    lightning: AVATAR_LIGHTNING_OBJECT_ID,
    trail: AVATAR_TRAIL_OBJECT_ID,
    travel: AVATAR_TRAVEL_OBJECT_ID,
    magnetic: AVATAR_MAGNETIC_OBJECT_ID,
});

export const SIGIL_AVATAR_OBJECT_GRAPH_NODE_IDS = Object.freeze({
    ...SIGIL_AVATAR_CHILD_OBJECT_IDS,
});

export const SIGIL_AVATAR_OBJECT_GRAPH_EDGES = Object.freeze([
    Object.freeze({ from: AVATAR_ROOT_OBJECT_ID, to: AVATAR_PRIMARY_OBJECT_ID, relationship: 'owns_render_node' }),
    Object.freeze({ from: AVATAR_PRIMARY_OBJECT_ID, to: AVATAR_PRIMARY_TESSERON_OBJECT_ID, relationship: 'owns_child_geometry' }),
    Object.freeze({ from: AVATAR_ROOT_OBJECT_ID, to: AVATAR_OMEGA_OBJECT_ID, relationship: 'owns_render_node' }),
    Object.freeze({ from: AVATAR_OMEGA_OBJECT_ID, to: AVATAR_OMEGA_TESSERON_OBJECT_ID, relationship: 'owns_child_geometry' }),
    Object.freeze({ from: AVATAR_ROOT_OBJECT_ID, to: AVATAR_AURA_OBJECT_ID, relationship: 'owns_effect_node' }),
    Object.freeze({ from: AVATAR_ROOT_OBJECT_ID, to: AVATAR_PHENOMENA_OBJECT_ID, relationship: 'owns_effect_node' }),
    Object.freeze({ from: AVATAR_ROOT_OBJECT_ID, to: AVATAR_LIGHTNING_OBJECT_ID, relationship: 'owns_effect_node' }),
    Object.freeze({ from: AVATAR_ROOT_OBJECT_ID, to: AVATAR_MAGNETIC_OBJECT_ID, relationship: 'owns_effect_node' }),
    Object.freeze({ from: AVATAR_ROOT_OBJECT_ID, to: AVATAR_TRAIL_OBJECT_ID, relationship: 'owns_effect_node' }),
    Object.freeze({ from: AVATAR_ROOT_OBJECT_ID, to: AVATAR_TRAVEL_OBJECT_ID, relationship: 'owns_effect_node' }),
]);

const GROUP_DEFINITIONS = [
    {
        key: 'avatar-root',
        label: 'Avatar Root',
        facet: 'identity',
        objectIds: [AVATAR_ROOT_OBJECT_ID],
        contracts: ['sigil.avatar.preview', 'canvas_object.registry'],
        descriptorIds: [],
    },
    {
        key: 'primary-polyhedron',
        label: 'Alpha Primary Polyhedron',
        facet: 'primary-shape',
        objectIds: [AVATAR_PRIMARY_OBJECT_ID, AVATAR_PRIMARY_TESSERON_OBJECT_ID],
        contracts: ['sigil.avatar.control.patch', 'canvas_object.transform.patch', 'canvas_object.effects.patch'],
        descriptorIds: [
            'sigil-menu-shape-select',
            'sigil-menu-mother-scale',
            'sigil-menu-tetartoid-a',
            'sigil-menu-tetartoid-b',
            'sigil-menu-tetartoid-c',
            'sigil-menu-torus-radius',
            'sigil-menu-torus-tube',
            'sigil-menu-torus-arc',
            'sigil-menu-prism-top-radius',
            'sigil-menu-prism-bottom-radius',
            'sigil-menu-prism-height',
            'sigil-menu-prism-sides',
            'sigil-menu-box-width',
            'sigil-menu-box-height',
            'sigil-menu-box-depth',
            'sigil-menu-tesseron',
            'sigil-menu-tesseron-proportion',
            'sigil-menu-tesseron-match',
            'sigil-menu-stellation',
            'sigil-menu-opacity',
            'sigil-menu-edge-opacity',
            'sigil-menu-xray',
            'sigil-menu-specular',
        ],
    },
    {
        key: 'omega-polyhedron',
        label: 'Omega Polyhedron',
        facet: 'omega-shape',
        objectIds: [AVATAR_OMEGA_OBJECT_ID, AVATAR_OMEGA_TESSERON_OBJECT_ID],
        contracts: ['sigil.avatar.control.patch', 'canvas_object.transform.patch'],
        descriptorIds: [
            'sigil-menu-omega-enabled',
            'sigil-menu-omega-shape',
            'sigil-menu-omega-tetartoid-a',
            'sigil-menu-omega-tetartoid-b',
            'sigil-menu-omega-tetartoid-c',
            'sigil-menu-omega-torus-radius',
            'sigil-menu-omega-torus-tube',
            'sigil-menu-omega-torus-arc',
            'sigil-menu-omega-prism-top-radius',
            'sigil-menu-omega-prism-bottom-radius',
            'sigil-menu-omega-prism-height',
            'sigil-menu-omega-prism-sides',
            'sigil-menu-omega-box-width',
            'sigil-menu-omega-box-height',
            'sigil-menu-omega-box-depth',
            'sigil-menu-omega-tesseron',
            'sigil-menu-omega-tesseron-proportion',
            'sigil-menu-omega-tesseron-match',
            'sigil-menu-omega-stellation',
            'sigil-menu-omega-scale',
            'sigil-menu-omega-counterspin',
            'sigil-menu-omega-lock',
        ],
    },
    {
        key: 'appearance-materials',
        label: 'Appearance And Materials',
        facet: 'appearance',
        objectIds: [
            AVATAR_PRIMARY_OBJECT_ID,
            AVATAR_OMEGA_OBJECT_ID,
            AVATAR_AURA_OBJECT_ID,
            AVATAR_PHENOMENA_OBJECT_ID,
            AVATAR_LIGHTNING_OBJECT_ID,
            AVATAR_MAGNETIC_OBJECT_ID,
        ],
        contracts: ['sigil.avatar.control.patch', 'canvas_object.effects.patch'],
        descriptorIds: [
            'sigil-menu-primary-color',
            'sigil-menu-edge-color',
            'sigil-menu-face1',
            'sigil-menu-face2',
            'sigil-menu-edge1',
            'sigil-menu-edge2',
            'sigil-menu-aura1',
            'sigil-menu-aura2',
            'sigil-menu-lightning1',
            'sigil-menu-lightning2',
            'sigil-menu-magnetic1',
            'sigil-menu-magnetic2',
        ],
    },
    {
        key: 'aura-effects',
        label: 'Aura',
        facet: 'effects',
        objectIds: [AVATAR_AURA_OBJECT_ID],
        contracts: ['sigil.avatar.control.patch', 'canvas_object.effects.patch'],
        descriptorIds: [
            'sigil-menu-aura-reach',
            'sigil-menu-aura-intensity',
        ],
    },
    {
        key: 'phenomena-effects',
        label: 'Phenomena',
        facet: 'effects',
        objectIds: [AVATAR_PHENOMENA_OBJECT_ID],
        contracts: ['sigil.avatar.control.patch', 'canvas_object.effects.patch'],
        descriptorIds: [
            'sigil-menu-spin',
            'sigil-menu-pulsar',
            'sigil-menu-accretion',
            'sigil-menu-gamma',
            'sigil-menu-neutrino',
        ],
    },
    {
        key: 'lightning-effects',
        label: 'Lightning',
        facet: 'effects',
        objectIds: [AVATAR_LIGHTNING_OBJECT_ID],
        contracts: ['sigil.avatar.control.patch', 'canvas_object.effects.patch'],
        descriptorIds: [
            'sigil-menu-lightning',
            'sigil-menu-lightning-origin-center',
            'sigil-menu-lightning-solid-block',
            'sigil-menu-lightning-length',
            'sigil-menu-lightning-frequency',
            'sigil-menu-lightning-duration',
            'sigil-menu-lightning-branching',
            'sigil-menu-lightning-brightness',
        ],
    },
    {
        key: 'magnetic-effects',
        label: 'Magnetic',
        facet: 'effects',
        objectIds: [AVATAR_MAGNETIC_OBJECT_ID],
        contracts: ['sigil.avatar.control.patch', 'canvas_object.effects.patch'],
        descriptorIds: [
            'sigil-menu-magnetic',
            'sigil-menu-magnetic-count',
            'sigil-menu-magnetic-speed',
            'sigil-menu-magnetic-wander',
        ],
    },
    {
        key: 'path-trail-effects',
        label: 'Path Trail',
        facet: 'effects',
        objectIds: [AVATAR_TRAIL_OBJECT_ID],
        contracts: ['sigil.avatar.control.patch', 'canvas_object.effects.patch'],
        descriptorIds: [
            'sigil-menu-trail-enabled',
            'sigil-menu-trail-length',
            'sigil-menu-trail-opacity',
            'sigil-menu-trail-fade',
            'sigil-menu-trail-style',
        ],
    },
    {
        key: 'fast-travel-visuals',
        label: 'Fast Travel Visuals',
        facet: 'effects',
        objectIds: [AVATAR_TRAVEL_OBJECT_ID],
        contracts: ['sigil.avatar.control.patch', 'canvas_object.effects.patch'],
        descriptorIds: [
            'sigil-menu-line-interdim',
            'sigil-menu-fast-travel-effect',
            'sigil-menu-line-duration',
            'sigil-menu-line-delay',
            'sigil-menu-line-repeat-count',
            'sigil-menu-line-repeat-duration',
            'sigil-menu-line-lag',
            'sigil-menu-line-scale',
            'sigil-menu-line-trail-mode',
            'sigil-menu-wormhole-shading',
            'sigil-menu-wormhole-object',
            'sigil-menu-wormhole-particles',
            'sigil-menu-wormhole-radius',
            'sigil-menu-wormhole-implosion',
            'sigil-menu-wormhole-transit',
            'sigil-menu-wormhole-rebound',
            'sigil-menu-wormhole-distortion',
            'sigil-menu-wormhole-twist',
            'sigil-menu-wormhole-zoom',
            'sigil-menu-wormhole-object-height',
            'sigil-menu-wormhole-object-spin',
            'sigil-menu-wormhole-particle-density',
            'sigil-menu-wormhole-shadow',
            'sigil-menu-wormhole-specular',
            'sigil-menu-wormhole-light-angle',
            'sigil-menu-wormhole-flash',
            'sigil-menu-wormhole-white',
            'sigil-menu-wormhole-starburst',
            'sigil-menu-wormhole-lens',
        ],
    },
];

export const SIGIL_AVATAR_COMPACT_SURFACE_PROJECTION_ONLY_IDS = Object.freeze([
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

const COMPACT_SURFACE_TABS = Object.freeze([
    Object.freeze({
        key: 'alpha',
        label: 'Alpha',
        groupKeys: ['primary-polyhedron', 'appearance-materials'],
        objectIds: [AVATAR_PRIMARY_OBJECT_ID, AVATAR_PRIMARY_TESSERON_OBJECT_ID],
    }),
    Object.freeze({
        key: 'omega',
        label: 'Omega',
        groupKeys: ['omega-polyhedron', 'appearance-materials'],
        objectIds: [AVATAR_OMEGA_OBJECT_ID, AVATAR_OMEGA_TESSERON_OBJECT_ID],
    }),
    Object.freeze({
        key: 'effects',
        label: 'Effects',
        groupKeys: ['aura-effects', 'phenomena-effects', 'lightning-effects', 'magnetic-effects', 'path-trail-effects'],
        objectIds: [AVATAR_AURA_OBJECT_ID, AVATAR_PHENOMENA_OBJECT_ID, AVATAR_LIGHTNING_OBJECT_ID, AVATAR_MAGNETIC_OBJECT_ID, AVATAR_TRAIL_OBJECT_ID],
    }),
    Object.freeze({
        key: 'travel',
        label: 'Travel',
        groupKeys: ['fast-travel-visuals'],
        objectIds: [AVATAR_TRAVEL_OBJECT_ID],
    }),
]);

const GROUP_BY_DESCRIPTOR_ID = new Map();
for (const group of GROUP_DEFINITIONS) {
    for (const id of group.descriptorIds) GROUP_BY_DESCRIPTOR_ID.set(id, group);
}

const PROJECTION_ONLY_SET = new Set(SIGIL_AVATAR_COMPACT_SURFACE_PROJECTION_ONLY_IDS);

function pathParts(value) {
    return Array.isArray(value) ? value : String(value ?? '').split('.').filter(Boolean);
}

function readPath(target, keyPath) {
    const parts = pathParts(keyPath);
    if (parts.length === 0) return undefined;
    return parts.reduce((value, key) => value?.[key], target);
}

function statePathText(value) {
    return pathParts(value).join('.');
}

function canonicalControlId(descriptor, group) {
    return `sigil.avatar.${group.key}.${statePathText(descriptor.statePath || descriptor.id).replace(/\.(\d+)(?=\.|$)/g, '[$1]')}`;
}

function optionsForDescriptor(descriptor) {
    if (descriptor.coerce === 'geometry' || descriptor.id === 'sigil-menu-shape-select' || descriptor.id === 'sigil-menu-omega-shape') {
        return SIGIL_AVATAR_GEOMETRY_OPTIONS.map((option) => ({ ...option }));
    }
    if (Array.isArray(descriptor.options)) {
        return descriptor.options.map((option) => ({ ...option }));
    }
    return undefined;
}

function visibleWhenForDescriptor(descriptor, group) {
    if (!descriptor.visibleWhen) return undefined;
    const sourceDescriptor = getContextMenuControlDescriptor(descriptor.visibleWhen.field);
    if (!sourceDescriptor) return { ...descriptor.visibleWhen };
    return {
        ...descriptor.visibleWhen,
        field: canonicalControlId(sourceDescriptor, group),
    };
}

function controlForDescriptor(descriptor, group, state) {
    const control = {
        id: canonicalControlId(descriptor, group),
        descriptor_id: descriptor.id,
        compatibility_ids: [descriptor.id, ...(descriptor.aliases || [])],
        label: descriptor.label,
        type: descriptor.type,
        state_path: statePathText(descriptor.statePath),
        value: readPath(state, descriptor.statePath),
        route: descriptor.route,
        coerce: descriptor.coerce,
        persistence: descriptor.persistence,
        renderer_sync: [...(descriptor.rendererSync || [])],
        object_ids: [...group.objectIds],
        group_key: group.key,
        facet_key: group.facet,
        canonical_avatar_edit: true,
    };
    const options = optionsForDescriptor(descriptor);
    if (options) control.options = options;
    for (const key of ['min', 'max', 'step']) {
        if (descriptor[key] !== undefined) control[key] = descriptor[key];
    }
    const visibleWhen = visibleWhenForDescriptor(descriptor, group);
    if (visibleWhen) control.visible_when = visibleWhen;
    return control;
}

function groupModel(group, state) {
    return {
        key: group.key,
        label: group.label,
        facet_key: group.facet,
        object_ids: [...group.objectIds],
        contracts: [...group.contracts],
        controls: group.descriptorIds
            .map((id) => getContextMenuControlDescriptor(id))
            .filter(Boolean)
            .map((descriptor) => controlForDescriptor(descriptor, group, state)),
    };
}

function projectionOnlyControls(state) {
    return SIGIL_AVATAR_COMPACT_SURFACE_PROJECTION_ONLY_IDS
        .map((id) => getContextMenuControlDescriptor(id))
        .filter(Boolean)
        .map((descriptor) => {
            const control = {
                id: descriptor.id,
                label: descriptor.label,
                type: descriptor.type,
                state_path: descriptor.statePath ? statePathText(descriptor.statePath) : null,
                value: descriptor.statePath ? readPath(state, descriptor.statePath) : undefined,
                route: descriptor.route,
                action_id: descriptor.actionId,
                reason: descriptor.type === 'action' ? 'app-action-shortcut' : 'runtime-or-world-projection',
                canonical_avatar_edit: false,
            };
            const options = optionsForDescriptor(descriptor);
            if (options) control.options = options;
            for (const key of ['min', 'max', 'step']) {
                if (descriptor[key] !== undefined) control[key] = descriptor[key];
            }
            return control;
        });
}

function visualDescriptorForControl(control) {
    return createVisualObjectDescriptor({
        ...control,
        kind: control.type,
        projection: { classification: 'editable' },
        evidence_contracts: [
            'sigil.avatar.editor.read',
            control.route,
            'json_serializable',
        ].filter(Boolean),
    });
}

function visualDescriptorForProjectionControl(control) {
    return createVisualObjectDescriptor({
        ...control,
        kind: control.type,
        projection: {
            classification: 'projection_only',
            reason: control.reason,
        },
        evidence_contracts: [
            control.route,
            'json_serializable',
            'projection_only_explicit',
        ].filter(Boolean),
    });
}

function groupReference(group) {
    return {
        group_key: group.key,
        facet_key: group.facet_key,
        label: group.label,
        object_ids: [...group.object_ids],
        control_ids: group.controls.map((control) => control.id),
        descriptor_ids: group.controls.map((control) => control.descriptor_id),
    };
}

function referencesForGroupKeys(groupsByKey, groupKeys = []) {
    return groupKeys
        .map((key) => groupsByKey.get(key))
        .filter(Boolean)
        .map((group) => groupReference(group));
}

function buildSurfaceLayouts(groups) {
    const groupsByKey = new Map(groups.map((group) => [group.key, group]));
    return {
        compact_control_surface: {
            kind: 'sigil.avatar.compact_tabbed_control_surface',
            invocation: 'avatar_right_click',
            layout: 'tabs',
            toolkit_primitives: ['tabs', 'section', 'form', 'select', 'slider', 'checkbox', 'radio_group', 'color_control'],
            source: 'sigil.avatar.object_graph',
            tabs: COMPACT_SURFACE_TABS.map((tab) => ({
                key: tab.key,
                label: tab.label,
                object_ids: [...tab.objectIds],
                groups: referencesForGroupKeys(groupsByKey, tab.groupKeys),
            })),
            shortcut_projection_control_ids: [...SIGIL_AVATAR_COMPACT_SURFACE_PROJECTION_ONLY_IDS],
        },
        wiki_browser_object_graph: {
            kind: 'sigil.avatar.wiki_browser_object_graph_view',
            layout: 'object_graph_drilldown',
            source: 'sigil.avatar.object_graph',
            root_object_id: AVATAR_ROOT_OBJECT_ID,
            groups: groups.map((group) => groupReference(group)),
        },
    };
}

export function classifySigilAvatarControlSurfaceDescriptors() {
    const canonical = [];
    const projectionOnly = [];
    const unmapped = [];
    for (const descriptor of contextMenuControlDescriptors) {
        if (GROUP_BY_DESCRIPTOR_ID.has(descriptor.id)) canonical.push(descriptor.id);
        else if (PROJECTION_ONLY_SET.has(descriptor.id)) projectionOnly.push(descriptor.id);
        else unmapped.push(descriptor.id);
    }
    return {
        canonical,
        projection_only: projectionOnly,
        unmapped,
    };
}

export function buildSigilAvatarEditorModel(state = {}, options = {}) {
    const groups = GROUP_DEFINITIONS.map((group) => groupModel(group, state));
    const controls = groups.flatMap((group) => group.controls);
    const projectionControls = projectionOnlyControls(state);
    const visualObjectDescriptors = [
        ...controls.map(visualDescriptorForControl),
        ...projectionControls.map(visualDescriptorForProjectionControl),
    ];
    const surfaceLayouts = buildSurfaceLayouts(groups);
    const objectGraph = {
        kind: 'sigil.avatar.object_graph',
        adapter_source: 'apps/sigil/renderer/live-modules/avatar-object-control.js',
        adapter_export: 'buildAvatarObjectRegistry',
        root_object_id: AVATAR_ROOT_OBJECT_ID,
        node_ids: { ...SIGIL_AVATAR_OBJECT_GRAPH_NODE_IDS },
        edges: SIGIL_AVATAR_OBJECT_GRAPH_EDGES.map((edge) => ({ ...edge })),
    };
    return {
        type: 'sigil.avatar.editor_model',
        schema_version: '2026-05-29',
        subject_id: options.subjectId || SIGIL_AVATAR_SUBJECT_ID,
        subject_type: SIGIL_AVATAR_SUBJECT_TYPE,
        avatar_id: options.avatarId || 'avatar-main',
        object_ids: { ...SIGIL_AVATAR_CHILD_OBJECT_IDS },
        object_graph: objectGraph,
        contracts: [
            'sigil.avatar.editor.read',
            'sigil.avatar.control.patch',
            'sigil.avatar.object_graph.read',
            'canvas_object.registry',
            'canvas_object.transform.patch',
            'canvas_object.effects.patch',
        ],
        groups,
        controls,
        visual_object_contract: VISUAL_OBJECT_DESCRIPTOR_CONTRACT_ID,
        visual_object_descriptors: visualObjectDescriptors,
        surface_layouts: surfaceLayouts,
        projection: {
            compact_control_surface: {
                role: 'compact-tabbed-control-surface-projection',
                themed_surface: 'sigil.avatar-control-surface',
                surface_layout: surfaceLayouts.compact_control_surface,
                legacy_descriptor_source: 'apps/sigil/context-menu/descriptors.js',
                projection_only_controls: projectionControls,
            },
        },
        metadata: {
            source: 'apps/sigil/avatar-editor/model.js',
            canonical_model: 'sigil.avatar.object_graph',
            descriptor_source: 'apps/sigil/context-menu/descriptors.js',
            visual_object_contract: VISUAL_OBJECT_DESCRIPTOR_CONTRACT_ID,
            compatibility_descriptor_ids: controls.flatMap((control) => control.compatibility_ids),
        },
    };
}

export function getSigilAvatarEditorControl(model, descriptorId) {
    return model?.controls?.find((control) => control.compatibility_ids?.includes(descriptorId)) || null;
}
