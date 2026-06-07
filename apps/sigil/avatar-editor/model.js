import {
    avatarControlsControlDescriptors,
    getAvatarControlsControlDescriptor,
} from '../avatar-controls/descriptors.js';
import { toolkitSpecifier } from '../renderer/live-modules/content-roots.js';
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

const {
    createVisualObjectDescriptor,
    VISUAL_OBJECT_DESCRIPTOR_CONTRACT_ID,
} = await import(toolkitSpecifier('workbench/visual-object-contract.js', {
    local: '../../../packages/toolkit/workbench/visual-object-contract.js',
}));

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
        label: 'Primary Polyhedron',
        facet: 'primary-shape',
        objectIds: [AVATAR_PRIMARY_OBJECT_ID, AVATAR_PRIMARY_TESSERON_OBJECT_ID],
        contracts: ['sigil.avatar.control.patch', 'canvas_object.transform.patch', 'canvas_object.effects.patch'],
        descriptorIds: [
            'sigil-avatar-controls-shape-select',
            'sigil-avatar-controls-mother-scale',
            'sigil-avatar-controls-tetartoid-a',
            'sigil-avatar-controls-tetartoid-b',
            'sigil-avatar-controls-tetartoid-c',
            'sigil-avatar-controls-torus-radius',
            'sigil-avatar-controls-torus-tube',
            'sigil-avatar-controls-torus-arc',
            'sigil-avatar-controls-prism-top-radius',
            'sigil-avatar-controls-prism-bottom-radius',
            'sigil-avatar-controls-prism-height',
            'sigil-avatar-controls-prism-sides',
            'sigil-avatar-controls-box-width',
            'sigil-avatar-controls-box-height',
            'sigil-avatar-controls-box-depth',
            'sigil-avatar-controls-tesseron',
            'sigil-avatar-controls-tesseron-proportion',
            'sigil-avatar-controls-tesseron-match',
            'sigil-avatar-controls-stellation',
            'sigil-avatar-controls-opacity',
            'sigil-avatar-controls-edge-opacity',
            'sigil-avatar-controls-xray',
            'sigil-avatar-controls-specular',
        ],
    },
    {
        key: 'omega-polyhedron',
        label: 'Omega Polyhedron',
        facet: 'omega-shape',
        objectIds: [AVATAR_OMEGA_OBJECT_ID, AVATAR_OMEGA_TESSERON_OBJECT_ID],
        contracts: ['sigil.avatar.control.patch', 'canvas_object.transform.patch'],
        descriptorIds: [
            'sigil-avatar-controls-omega-enabled',
            'sigil-avatar-controls-omega-shape',
            'sigil-avatar-controls-omega-tetartoid-a',
            'sigil-avatar-controls-omega-tetartoid-b',
            'sigil-avatar-controls-omega-tetartoid-c',
            'sigil-avatar-controls-omega-torus-radius',
            'sigil-avatar-controls-omega-torus-tube',
            'sigil-avatar-controls-omega-torus-arc',
            'sigil-avatar-controls-omega-prism-top-radius',
            'sigil-avatar-controls-omega-prism-bottom-radius',
            'sigil-avatar-controls-omega-prism-height',
            'sigil-avatar-controls-omega-prism-sides',
            'sigil-avatar-controls-omega-box-width',
            'sigil-avatar-controls-omega-box-height',
            'sigil-avatar-controls-omega-box-depth',
            'sigil-avatar-controls-omega-tesseron',
            'sigil-avatar-controls-omega-tesseron-proportion',
            'sigil-avatar-controls-omega-tesseron-match',
            'sigil-avatar-controls-omega-stellation',
            'sigil-avatar-controls-omega-scale',
            'sigil-avatar-controls-omega-counterspin',
            'sigil-avatar-controls-omega-lock',
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
            'sigil-avatar-controls-primary-color',
            'sigil-avatar-controls-edge-color',
            'sigil-avatar-controls-face1',
            'sigil-avatar-controls-face2',
            'sigil-avatar-controls-edge1',
            'sigil-avatar-controls-edge2',
            'sigil-avatar-controls-aura1',
            'sigil-avatar-controls-aura2',
            'sigil-avatar-controls-lightning1',
            'sigil-avatar-controls-lightning2',
            'sigil-avatar-controls-magnetic1',
            'sigil-avatar-controls-magnetic2',
        ],
    },
    {
        key: 'aura-effects',
        label: 'Aura',
        facet: 'effects',
        objectIds: [AVATAR_AURA_OBJECT_ID],
        contracts: ['sigil.avatar.control.patch', 'canvas_object.effects.patch'],
        descriptorIds: [
            'sigil-avatar-controls-aura-reach',
            'sigil-avatar-controls-aura-intensity',
        ],
    },
    {
        key: 'phenomena-effects',
        label: 'Phenomena',
        facet: 'effects',
        objectIds: [AVATAR_PHENOMENA_OBJECT_ID],
        contracts: ['sigil.avatar.control.patch', 'canvas_object.effects.patch'],
        descriptorIds: [
            'sigil-avatar-controls-spin',
            'sigil-avatar-controls-pulsar',
            'sigil-avatar-controls-accretion',
            'sigil-avatar-controls-gamma',
            'sigil-avatar-controls-neutrino',
        ],
    },
    {
        key: 'lightning-effects',
        label: 'Lightning',
        facet: 'effects',
        objectIds: [AVATAR_LIGHTNING_OBJECT_ID],
        contracts: ['sigil.avatar.control.patch', 'canvas_object.effects.patch'],
        descriptorIds: [
            'sigil-avatar-controls-lightning',
            'sigil-avatar-controls-lightning-origin-center',
            'sigil-avatar-controls-lightning-solid-block',
            'sigil-avatar-controls-lightning-length',
            'sigil-avatar-controls-lightning-frequency',
            'sigil-avatar-controls-lightning-duration',
            'sigil-avatar-controls-lightning-branching',
            'sigil-avatar-controls-lightning-brightness',
        ],
    },
    {
        key: 'magnetic-effects',
        label: 'Magnetic',
        facet: 'effects',
        objectIds: [AVATAR_MAGNETIC_OBJECT_ID],
        contracts: ['sigil.avatar.control.patch', 'canvas_object.effects.patch'],
        descriptorIds: [
            'sigil-avatar-controls-magnetic',
            'sigil-avatar-controls-magnetic-count',
            'sigil-avatar-controls-magnetic-speed',
            'sigil-avatar-controls-magnetic-wander',
        ],
    },
    {
        key: 'path-trail-effects',
        label: 'Path Trail',
        facet: 'effects',
        objectIds: [AVATAR_TRAIL_OBJECT_ID],
        contracts: ['sigil.avatar.control.patch', 'canvas_object.effects.patch'],
        descriptorIds: [
            'sigil-avatar-controls-trail-enabled',
            'sigil-avatar-controls-trail-length',
            'sigil-avatar-controls-trail-opacity',
            'sigil-avatar-controls-trail-fade',
            'sigil-avatar-controls-trail-style',
        ],
    },
    {
        key: 'fast-travel-visuals',
        label: 'Fast Travel Visuals',
        facet: 'effects',
        objectIds: [AVATAR_TRAVEL_OBJECT_ID],
        contracts: ['sigil.avatar.control.patch', 'canvas_object.effects.patch'],
        descriptorIds: [
            'sigil-avatar-controls-line-interdim',
            'sigil-avatar-controls-fast-travel-effect',
            'sigil-avatar-controls-line-duration',
            'sigil-avatar-controls-line-delay',
            'sigil-avatar-controls-line-repeat-count',
            'sigil-avatar-controls-line-repeat-duration',
            'sigil-avatar-controls-line-lag',
            'sigil-avatar-controls-line-scale',
            'sigil-avatar-controls-line-trail-mode',
            'sigil-avatar-controls-wormhole-shading',
            'sigil-avatar-controls-wormhole-object',
            'sigil-avatar-controls-wormhole-particles',
            'sigil-avatar-controls-wormhole-radius',
            'sigil-avatar-controls-wormhole-implosion',
            'sigil-avatar-controls-wormhole-transit',
            'sigil-avatar-controls-wormhole-rebound',
            'sigil-avatar-controls-wormhole-distortion',
            'sigil-avatar-controls-wormhole-twist',
            'sigil-avatar-controls-wormhole-zoom',
            'sigil-avatar-controls-wormhole-object-height',
            'sigil-avatar-controls-wormhole-object-spin',
            'sigil-avatar-controls-wormhole-particle-density',
            'sigil-avatar-controls-wormhole-shadow',
            'sigil-avatar-controls-wormhole-specular',
            'sigil-avatar-controls-wormhole-light-angle',
            'sigil-avatar-controls-wormhole-flash',
            'sigil-avatar-controls-wormhole-white',
            'sigil-avatar-controls-wormhole-starburst',
            'sigil-avatar-controls-wormhole-lens',
        ],
    },
];

export const SIGIL_AVATAR_COMPACT_SURFACE_PROJECTION_ONLY_IDS = Object.freeze([
    'sigil-avatar-controls-grid-mode',
    'sigil-avatar-controls-ring',
    'sigil-avatar-controls-avatar-above-menu',
    'sigil-avatar-controls-cancel-radius',
    'sigil-avatar-controls-grid1',
    'sigil-avatar-controls-grid2',
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
    if (descriptor.coerce === 'geometry' || descriptor.id === 'sigil-avatar-controls-shape-select' || descriptor.id === 'sigil-avatar-controls-omega-shape') {
        return SIGIL_AVATAR_GEOMETRY_OPTIONS.map((option) => ({ ...option }));
    }
    if (Array.isArray(descriptor.options)) {
        return descriptor.options.map((option) => ({ ...option }));
    }
    return undefined;
}

function visibleWhenForDescriptor(descriptor, group) {
    if (!descriptor.visibleWhen) return undefined;
    const sourceDescriptor = getAvatarControlsControlDescriptor(descriptor.visibleWhen.field);
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
            .map((id) => getAvatarControlsControlDescriptor(id))
            .filter(Boolean)
            .map((descriptor) => controlForDescriptor(descriptor, group, state)),
    };
}

function projectionOnlyControls(state) {
    return SIGIL_AVATAR_COMPACT_SURFACE_PROJECTION_ONLY_IDS
        .map((id) => getAvatarControlsControlDescriptor(id))
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
    for (const descriptor of avatarControlsControlDescriptors) {
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
                legacy_descriptor_source: 'apps/sigil/avatar-controls/descriptors.js',
                projection_only_controls: projectionControls,
            },
        },
        metadata: {
            source: 'apps/sigil/avatar-editor/model.js',
            canonical_model: 'sigil.avatar.object_graph',
            descriptor_source: 'apps/sigil/avatar-controls/descriptors.js',
            visual_object_contract: VISUAL_OBJECT_DESCRIPTOR_CONTRACT_ID,
            compatibility_descriptor_ids: controls.flatMap((control) => control.compatibility_ids),
        },
    };
}

export function getSigilAvatarEditorControl(model, descriptorId) {
    return model?.controls?.find((control) => control.compatibility_ids?.includes(descriptorId)) || null;
}
