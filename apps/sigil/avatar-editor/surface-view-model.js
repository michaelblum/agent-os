import {
    buildSigilAvatarEditorModel,
} from './model.js';

const COMPACT_SURFACE_VIEW_MODEL_TYPE = 'sigil.avatar.compact_control_surface.view_model';
const WIKI_BROWSER_GRAPH_VIEW_MODEL_TYPE = 'sigil.avatar.wiki_browser_object_graph.view_model';

function text(value, fallback = '') {
    const normalized = String(value ?? '').replace(/\s+/g, ' ').trim();
    return normalized || fallback;
}

function arrayValue(value) {
    return Array.isArray(value) ? value : [];
}

function cloneJson(value) {
    if (value === undefined) return undefined;
    return JSON.parse(JSON.stringify(value));
}

function isEditorModel(value = {}) {
    return value?.type === 'sigil.avatar.editor_model'
        && value?.object_graph?.kind === 'sigil.avatar.object_graph';
}

function editorModelFor(input = {}, options = {}) {
    return isEditorModel(input) ? input : buildSigilAvatarEditorModel(input, options);
}

function toolkitControlKind(control = {}) {
    if (control.type === 'select') return 'select';
    if (control.type === 'segmented') return 'radio_group';
    if (control.type === 'checkbox') return 'checkbox';
    if (control.type === 'slider') return 'slider';
    if (control.type === 'color') return 'color';
    if (control.type === 'action') return 'button';
    return text(control.type, 'field');
}

function controlBinding(control = {}) {
    return {
        descriptor_id: control.descriptor_id || null,
        compatibility_ids: [...arrayValue(control.compatibility_ids)],
        state_path: control.state_path || null,
        route: control.route || null,
        persistence: control.persistence || null,
        renderer_sync: [...arrayValue(control.renderer_sync)],
        object_ids: [...arrayValue(control.object_ids)],
        group_key: control.group_key || null,
        facet_key: control.facet_key || null,
    };
}

function toolkitControl(control = {}) {
    const kind = toolkitControlKind(control);
    const viewControl = {
        id: control.id || control.descriptor_id,
        descriptor_id: control.descriptor_id || control.id,
        label: text(control.label, control.id || control.descriptor_id),
        kind,
        toolkit_control: {
            namespace: 'packages/toolkit/controls',
            kind,
        },
        value: cloneJson(control.value),
        binding: controlBinding(control),
        canonical_avatar_edit: control.canonical_avatar_edit !== false,
    };
    if (Array.isArray(control.options)) {
        viewControl.options = control.options.map((option) => ({ ...option }));
    }
    for (const key of ['min', 'max', 'step', 'unit', 'output']) {
        if (control[key] !== undefined) viewControl[key] = cloneJson(control[key]);
    }
    if (control.visible_when) viewControl.visible_when = cloneJson(control.visible_when);
    if (control.action_id) viewControl.action_id = control.action_id;
    return viewControl;
}

function controlsById(model = {}) {
    return new Map(arrayValue(model.controls).map((control) => [control.id, control]));
}

function surfaceSection(group = {}, controlMap = new Map()) {
    return {
        key: group.group_key,
        label: group.label,
        facet_key: group.facet_key,
        object_ids: [...arrayValue(group.object_ids)],
        controls: arrayValue(group.control_ids)
            .map((controlId) => controlMap.get(controlId))
            .filter(Boolean)
            .map((control) => toolkitControl(control)),
    };
}

function projectionTool(control = {}) {
    return toolkitControl({
        ...control,
        id: control.id,
        descriptor_id: control.id,
        compatibility_ids: [control.id],
        persistence: 'none',
        renderer_sync: [],
        object_ids: [],
    });
}

function edgeListForNode(objectGraph = {}, nodeId = '') {
    return arrayValue(objectGraph.edges).filter((edge) => edge.from === nodeId || edge.to === nodeId);
}

function groupsForNode(groups = [], nodeId = '') {
    return groups.filter((group) => arrayValue(group.object_ids).includes(nodeId));
}

function graphNode({ nodeId, model, groups }) {
    const nodeGroups = groupsForNode(groups, nodeId);
    return {
        object_id: nodeId,
        role: Object.entries(model.object_graph?.node_ids || {})
            .find(([, objectId]) => objectId === nodeId)?.[0] || null,
        edges: edgeListForNode(model.object_graph, nodeId).map((edge) => ({ ...edge })),
        groups: nodeGroups.map((group) => ({
            key: group.key,
            label: group.label,
            facet_key: group.facet_key,
            control_count: arrayValue(group.controls).length,
            control_ids: arrayValue(group.controls).map((control) => control.id),
        })),
    };
}

export function buildSigilAvatarCompactSurfaceViewModel(input = {}, options = {}) {
    const model = editorModelFor(input, options);
    const projection = model.projection?.compact_control_surface || {};
    const layout = projection.surface_layout || model.surface_layouts?.compact_control_surface || {};
    const controlMap = controlsById(model);
    return {
        type: COMPACT_SURFACE_VIEW_MODEL_TYPE,
        schema_version: model.schema_version,
        source_model: model.type,
        avatar_id: model.avatar_id,
        object_graph: cloneJson(model.object_graph),
        invocation: layout.invocation || 'avatar_right_click',
        layout: layout.layout || 'tabs',
        tabs: arrayValue(layout.tabs).map((tab) => ({
            key: tab.key,
            label: tab.label,
            object_ids: [...arrayValue(tab.object_ids)],
            sections: arrayValue(tab.groups).map((group) => surfaceSection(group, controlMap)),
        })),
        projection_tools: arrayValue(projection.projection_only_controls).map(projectionTool),
        metadata: {
            canonical_model: model.metadata?.canonical_model || 'sigil.avatar.object_graph',
            surface_layout_kind: layout.kind || 'sigil.avatar.compact_tabbed_control_surface',
            themed_surface: projection.themed_surface || 'sigil.avatar-control-surface',
        },
    };
}

export function buildSigilAvatarWikiBrowserObjectGraphViewModel(input = {}, options = {}) {
    const model = editorModelFor(input, options);
    const layout = model.surface_layouts?.wiki_browser_object_graph || {};
    const groups = arrayValue(model.groups);
    const nodeIds = Object.values(model.object_graph?.node_ids || {});
    return {
        type: WIKI_BROWSER_GRAPH_VIEW_MODEL_TYPE,
        schema_version: model.schema_version,
        source_model: model.type,
        avatar_id: model.avatar_id,
        layout: layout.layout || 'object_graph_drilldown',
        root_object_id: layout.root_object_id || model.object_graph?.root_object_id || 'avatar.main',
        object_graph: cloneJson(model.object_graph),
        nodes: nodeIds.map((nodeId) => graphNode({ nodeId, model, groups })),
        metadata: {
            canonical_model: model.metadata?.canonical_model || 'sigil.avatar.object_graph',
            surface_layout_kind: layout.kind || 'sigil.avatar.wiki_browser_object_graph_view',
        },
    };
}
