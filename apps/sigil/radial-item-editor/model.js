import { DEFAULT_SIGIL_RADIAL_ITEMS } from '../renderer/radial-menu-defaults.js';
import {
    buildAvatarObjectRegistry,
    AVATAR_ROOT_OBJECT_ID,
} from '../renderer/live-modules/avatar-object-control.js';
import {
    applyRadialMenuObjectEffectsPatch,
    applyRadialMenuObjectTransformPatch,
    buildRadialMenuObjectRegistry,
    DEFAULT_NESTED_TREE_EFFECT,
    resolveNestedFractalPulse,
} from '../renderer/live-modules/radial-object-control.js';

export const DEFAULT_EDITOR_CANVAS_ID = 'sigil-radial-item-editor';
export const DEFAULT_EDITOR_ITEM_ID = 'wiki-graph';
export const RADIAL_ITEM_EDITOR_LOCK_IN_TYPE = 'sigil.radial_item_editor.lock_in';
export const RADIAL_ITEM_EDITOR_LOCK_IN_SCHEMA_VERSION = '2026-05-03';
export const WORKBENCH_SUBJECT_SCHEMA_VERSION = '2026-05-03';
export const RADIAL_ITEM_SUBJECT_TYPE = 'sigil.radial_menu.item_3d';
export const AVATAR_SUBJECT_TYPE = 'sigil.avatar.3d';
export const RADIAL_ITEM_SOURCE = Object.freeze({
    kind: 'sigil.radial_menu.default_items',
    path: 'apps/sigil/renderer/radial-menu-defaults.js',
    export: 'DEFAULT_SIGIL_RADIAL_ITEMS',
    operation: 'replace_item_by_id',
});
export const AVATAR_SUBJECT_SOURCE = Object.freeze({
    kind: 'sigil.avatar.object_graph',
    path: 'apps/sigil/renderer/live-modules/avatar-object-control.js',
    export: 'buildAvatarObjectRegistry',
    operation: 'owner_managed',
});

function isPlainObject(value) {
    return !!value && typeof value === 'object' && !Array.isArray(value);
}

export function cloneConfig(value) {
    if (Array.isArray(value)) return value.map((entry) => cloneConfig(entry));
    if (!isPlainObject(value)) return value;
    const next = {};
    for (const [key, entry] of Object.entries(value)) {
        next[key] = cloneConfig(entry);
    }
    return next;
}

function text(value, fallback = '') {
    const normalized = String(value ?? '').replace(/\s+/g, ' ').trim();
    return normalized || fallback;
}

function geometryKind(item = {}) {
    return typeof item.geometry?.type === 'string' ? item.geometry.type.toLowerCase() : '';
}

function radialEditorCanvasHost(canvasId = DEFAULT_EDITOR_CANVAS_ID, { preferred = false, facet = '' } = {}) {
    return {
        kind: 'canvas',
        target_dialect: 'canvas',
        entry: {
            kind: 'canvas-id',
            value: text(canvasId, DEFAULT_EDITOR_CANVAS_ID),
            ...(facet ? { facet } : {}),
        },
        ...(preferred ? { preferred: true } : {}),
    };
}

function subjectCanvasHost(canvasId = DEFAULT_EDITOR_CANVAS_ID, { preferred = false, facet = '' } = {}) {
    return radialEditorCanvasHost(canvasId, { preferred, facet });
}

function subjectResult({
    type,
    requestId,
    target = {},
    status = 'rejected',
    code = 'unsupported_subject_operation',
    message = 'Subject does not support this editor operation.',
} = {}) {
    return {
        type,
        schema_version: RADIAL_ITEM_EDITOR_LOCK_IN_SCHEMA_VERSION,
        request_id: text(requestId, 'editor-subject-request'),
        target: cloneConfig(target),
        status,
        error: { code, message },
    };
}

export function editableRadialItems(items = DEFAULT_SIGIL_RADIAL_ITEMS) {
    const source = Array.isArray(items) ? items : [];
    return source
        .filter((item) => {
            const kind = geometryKind(item);
            return item?.id && (kind === 'gltf' || kind === 'glb');
        })
        .map((item) => ({
            id: item.id,
            label: text(item.label, item.id),
            action: text(item.action),
            geometryKind: geometryKind(item),
        }));
}

export function pickInitialItemId(items = DEFAULT_SIGIL_RADIAL_ITEMS, requestedId = DEFAULT_EDITOR_ITEM_ID) {
    const editable = editableRadialItems(items);
    if (editable.some((item) => item.id === requestedId)) return requestedId;
    if (editable.some((item) => item.id === DEFAULT_EDITOR_ITEM_ID)) return DEFAULT_EDITOR_ITEM_ID;
    return editable[0]?.id || '';
}

export function createRadialItemEditorState({
    items = DEFAULT_SIGIL_RADIAL_ITEMS,
    itemId = DEFAULT_EDITOR_ITEM_ID,
    canvasId = DEFAULT_EDITOR_CANVAS_ID,
} = {}) {
    const clonedItems = cloneConfig(items);
    return {
        canvasId: text(canvasId, DEFAULT_EDITOR_CANVAS_ID),
        items: clonedItems,
        selectedItemId: pickInitialItemId(clonedItems, itemId),
    };
}

export function selectedRadialItem(state = {}) {
    const items = Array.isArray(state.items) ? state.items : [];
    return items.find((item) => item?.id === state.selectedItemId) || null;
}

export function selectedRadialItemPart(state = {}, partId = '') {
    const item = selectedRadialItem(state);
    const parts = Array.isArray(item?.geometry?.parts) ? item.geometry.parts : [];
    return parts.find((part) => part?.id === partId) || null;
}

export function selectRadialItem(state = {}, itemId = '') {
    const nextId = pickInitialItemId(state.items, itemId);
    if (!nextId) return null;
    state.selectedItemId = nextId;
    return selectedRadialItem(state);
}

export function selectedRadialConfig(state = {}) {
    const item = selectedRadialItem(state);
    return { items: item ? [item] : [] };
}

export function buildEditorRadialSnapshot(state = {}, {
    width = 800,
    height = 600,
    visualRadius = 116,
    originOffset = 170,
} = {}) {
    const item = selectedRadialItem(state);
    if (!item) {
        return {
            phase: 'idle',
            origin: { x: width / 2, y: height / 2, valid: true },
            pointer: { x: width / 2, y: height / 2, valid: true },
            menuProgress: 0,
            activeItemId: null,
            items: [],
            radii: { item: visualRadius, menu: originOffset },
        };
    }

    const center = { x: width / 2, y: height / 2, valid: true };
    const previewItem = {
        ...item,
        center,
        visualRadius,
        hitRadius: visualRadius,
        angle: -90,
    };
    return {
        phase: 'radial',
        origin: { x: width / 2, y: (height / 2) + originOffset, valid: true },
        pointer: center,
        menuProgress: 1,
        activeItemId: item.id,
        items: [previewItem],
        radii: { item: visualRadius, menu: originOffset },
    };
}

export function buildEditorObjectRegistry(state = {}) {
    return buildRadialMenuObjectRegistry(selectedRadialConfig(state), {
        canvasId: text(state.canvasId, DEFAULT_EDITOR_CANVAS_ID),
    });
}

function radialSubjectDescriptor(state = {}) {
    const item = selectedRadialItem(state);
    const canvasId = text(state.canvasId, DEFAULT_EDITOR_CANVAS_ID);
    return {
        kind: 'subject-descriptor',
        adapter: 'sigil.radial-item-editor.radial-subject',
        subject_id: item ? `sigil.radial_menu.item:${item.id}` : 'sigil.radial_menu.item:none',
        subject_type: RADIAL_ITEM_SUBJECT_TYPE,
        label: item ? text(item.label, item.id) : 'No radial item',
        owner: 'sigil.radial-item-editor',
        canvas_id: canvasId,
        source: cloneConfig(RADIAL_ITEM_SOURCE),
        capabilities: ['inspectable', 'editable', 'exportable'],
        contracts: [
            'canvas_object.registry',
            'canvas_object.transform.patch',
            'canvas_object.effects.patch',
            'canvas_object.visibility.patch',
            RADIAL_ITEM_EDITOR_LOCK_IN_TYPE,
            'sigil.radial_item.preview',
        ],
        persistence: {
            kind: 'agent_handoff',
            request: RADIAL_ITEM_EDITOR_LOCK_IN_TYPE,
            result: 'source.patch.result',
        },
        metadata: {
            action: text(item?.action),
            geometry_kind: geometryKind(item || {}),
        },
        state: {
            item_id: item?.id || null,
            canvas_id: canvasId,
        },
        registry: () => buildEditorObjectRegistry(state),
        preview: (options = {}) => buildEditorRadialSnapshot(state, options),
        applyTransformPatch: (message = {}) => applyEditorObjectPatch(state, message),
        applyEffectsPatch: (message = {}) => applyEditorEffectsPatch(state, message),
        exportAction: (options = {}) => exportSelectedRadialItemDefinition(state, options),
    };
}

function avatarSubjectDescriptor({
    rendererState = {},
    canvasId = 'avatar-main',
    sourceId = 'sigil.avatar-object-control',
    avatarVisible = true,
    avatarPos,
} = {}) {
    const normalizedCanvasId = text(canvasId, 'avatar-main');
    const registryOptions = {
        canvasId: normalizedCanvasId,
        sourceId,
        avatarVisible,
        ...(avatarPos ? { avatarPos } : {}),
    };
    return {
        kind: 'subject-descriptor',
        adapter: 'sigil.radial-item-editor.avatar-subject',
        subject_id: 'sigil.avatar:avatar-main',
        subject_type: AVATAR_SUBJECT_TYPE,
        label: 'Sigil Avatar',
        owner: 'sigil',
        canvas_id: normalizedCanvasId,
        source: cloneConfig(AVATAR_SUBJECT_SOURCE),
        capabilities: ['inspectable', 'editable'],
        contracts: [
            'canvas_object.registry',
            'canvas_object.transform.patch',
            'canvas_object.effects.patch',
            'sigil.avatar.action',
        ],
        persistence: {
            kind: 'app_owned',
            request: 'sigil.avatar.action',
            result: 'canvas_object.effects.result',
        },
        metadata: {
            root_object_id: AVATAR_ROOT_OBJECT_ID,
            renderer_owner: 'apps/sigil/renderer',
            persistence_owner: 'apps/sigil/renderer/appearance.js',
        },
        state: {
            canvas_id: normalizedCanvasId,
            item_id: null,
        },
        registry: () => buildAvatarObjectRegistry(rendererState, registryOptions),
        preview: () => ({
            type: 'sigil.avatar.preview',
            status: 'owner-managed',
            canvas_id: normalizedCanvasId,
            root_object_id: AVATAR_ROOT_OBJECT_ID,
        }),
        applyTransformPatch: (message = {}) => subjectResult({
            type: 'canvas_object.transform.result',
            requestId: message.request_id,
            target: message.target,
            message: 'Avatar transform patches are owner-managed by the live Sigil renderer in this slice.',
        }),
        applyEffectsPatch: (message = {}) => subjectResult({
            type: 'canvas_object.effects.result',
            requestId: message.request_id,
            target: message.target,
            message: 'Avatar effects patches are owner-managed by the live Sigil renderer in this slice.',
        }),
        exportAction: () => ({
            type: 'sigil.avatar.action',
            action: 'owner-managed-export',
            status: 'owner-managed',
            source: cloneConfig(AVATAR_SUBJECT_SOURCE),
        }),
    };
}

export function loadThingEditorSubject(input = {}, options = {}) {
    if (input?.kind === 'subject-descriptor') return input;
    const subjectType = text(input.subject_type || input.subjectType || input.type || input.kind, RADIAL_ITEM_SUBJECT_TYPE);
    if (subjectType === RADIAL_ITEM_SUBJECT_TYPE || subjectType === 'radial' || subjectType === 'sigil.radial_menu.item') {
        const state = input.state || input.editorState || createRadialItemEditorState({
            items: input.items,
            itemId: input.itemId,
            canvasId: input.canvasId,
        });
        return radialSubjectDescriptor(state);
    }
    if (subjectType === AVATAR_SUBJECT_TYPE || subjectType === 'avatar' || subjectType === 'sigil.avatar') {
        return avatarSubjectDescriptor({
            rendererState: input.rendererState || input.state || {},
            canvasId: input.canvasId,
            sourceId: input.sourceId,
            avatarVisible: input.avatarVisible,
            avatarPos: input.avatarPos,
            ...options,
        });
    }
    throw new TypeError(`Unsupported 3D thing editor subject: ${subjectType}`);
}

export function buildThingEditorObjectRegistry(subjectInput = {}) {
    return loadThingEditorSubject(subjectInput).registry();
}

export function buildThingEditorPreview(subjectInput = {}, options = {}) {
    return loadThingEditorSubject(subjectInput).preview(options);
}

export function applyThingEditorObjectPatch(subjectInput = {}, message = {}) {
    return loadThingEditorSubject(subjectInput).applyTransformPatch(message);
}

export function applyThingEditorEffectsPatch(subjectInput = {}, message = {}) {
    return loadThingEditorSubject(subjectInput).applyEffectsPatch(message);
}

export function exportThingEditorSubject(subjectInput = {}, options = {}) {
    return loadThingEditorSubject(subjectInput).exportAction(options);
}

export function exportSelectedRadialItemDefinition(state = {}, {
    generatedAt = new Date().toISOString(),
} = {}) {
    const item = selectedRadialItem(state);
    return {
        type: RADIAL_ITEM_EDITOR_LOCK_IN_TYPE,
        schema_version: RADIAL_ITEM_EDITOR_LOCK_IN_SCHEMA_VERSION,
        generated_at: text(generatedAt, new Date().toISOString()),
        subject: buildRadialItemWorkbenchSubject(state),
        source: cloneConfig(RADIAL_ITEM_SOURCE),
        item_id: item?.id || null,
        item: item ? cloneConfig(item) : null,
        registry: buildEditorObjectRegistry(state),
    };
}

export function buildRadialItemWorkbenchSubject(state = {}) {
    return buildThingEditorWorkbenchSubject(radialSubjectDescriptor(state));
}

export function buildThingEditorWorkbenchSubject(subjectInput = {}) {
    const descriptor = loadThingEditorSubject(subjectInput);
    const registry = descriptor.registry();
    const isRadialSubject = descriptor.subject_type === RADIAL_ITEM_SUBJECT_TYPE;
    const previewContract = descriptor.subject_type === RADIAL_ITEM_SUBJECT_TYPE
        ? 'sigil.radial_item.preview'
        : 'sigil.avatar.preview';
    const actionContract = descriptor.subject_type === RADIAL_ITEM_SUBJECT_TYPE
        ? RADIAL_ITEM_EDITOR_LOCK_IN_TYPE
        : 'sigil.avatar.action';
    return {
        type: 'aos.workbench.subject',
        schema_version: WORKBENCH_SUBJECT_SCHEMA_VERSION,
        id: descriptor.subject_id,
        subject_type: descriptor.subject_type,
        label: descriptor.label,
        owner: descriptor.owner,
        source: cloneConfig(descriptor.source),
        capabilities: cloneConfig(descriptor.capabilities),
        contracts: cloneConfig(descriptor.contracts),
        facets: [
            {
                key: 'object-registry',
                layer: 'descriptor',
                label: 'Object Registry',
                source: cloneConfig(descriptor.source),
                capabilities: ['inspectable'],
                contracts: ['canvas_object.registry'],
                hosts: [
                    subjectCanvasHost(descriptor.canvas_id, { preferred: true, facet: 'object-registry' }),
                ],
            },
            {
                key: 'object-controls',
                layer: 'controls',
                label: 'Object Controls',
                capabilities: ['editable'],
                contracts: [
                    'canvas_object.transform.patch',
                    'canvas_object.effects.patch',
                    'canvas_object.visibility.patch',
                    actionContract,
                ],
                hosts: [
                    subjectCanvasHost(descriptor.canvas_id, { facet: 'object-controls' }),
                ],
            },
            {
                key: isRadialSubject ? 'radial-preview' : 'preview',
                layer: 'artifacts',
                label: isRadialSubject ? 'Radial Preview' : 'Preview',
                capabilities: ['inspectable'],
                contracts: [previewContract],
                hosts: [
                    subjectCanvasHost(descriptor.canvas_id, { facet: isRadialSubject ? 'radial-preview' : 'preview' }),
                ],
            },
            ...(isRadialSubject ? [] : [{
                key: 'owner-actions',
                layer: 'actions',
                label: 'Owner Actions',
                capabilities: descriptor.capabilities.includes('exportable') ? ['exportable'] : [],
                contracts: [actionContract],
                hosts: [
                    subjectCanvasHost(descriptor.canvas_id, { facet: 'owner-actions' }),
                ],
            }]),
        ],
        persistence: cloneConfig(descriptor.persistence),
        state: {
            ...cloneConfig(descriptor.state),
            object_count: registry.objects.length,
            dirty: true,
        },
        metadata: cloneConfig(descriptor.metadata),
    };
}

export function applyEditorObjectPatch(state = {}, message = {}) {
    return applyRadialMenuObjectTransformPatch(selectedRadialConfig(state), message, {
        canvasId: text(state.canvasId, DEFAULT_EDITOR_CANVAS_ID),
    });
}

export function applyEditorEffectsPatch(state = {}, message = {}) {
    return applyRadialMenuObjectEffectsPatch(selectedRadialConfig(state), message, {
        canvasId: text(state.canvasId, DEFAULT_EDITOR_CANVAS_ID),
    });
}

export function selectedTerminalScreenMaterial(state = {}) {
    const part = selectedRadialItemPart(state, 'screen');
    if (part?.material?.kind !== 'terminal-screen') return null;
    return cloneConfig(part.material);
}

export function patchSelectedTerminalScreenMaterial(state = {}, patch = {}) {
    const part = selectedRadialItemPart(state, 'screen');
    if (part?.material?.kind !== 'terminal-screen' || !isPlainObject(patch)) return null;
    const material = part.material;
    if (patch.title !== undefined) {
        material.title = text(patch.title, 'AGENT TERM').slice(0, 18);
    }
    if (patch.lines !== undefined) {
        const source = Array.isArray(patch.lines) ? patch.lines : String(patch.lines || '').split(/\r?\n/);
        material.lines = source
            .map((line) => String(line || '').trim().slice(0, 28))
            .filter(Boolean)
            .slice(0, 5);
    }
    if (patch.accent !== undefined) {
        const accent = String(patch.accent || '').trim();
        if (/^#[0-9a-fA-F]{6}$/.test(accent)) material.accent = accent;
    }
    if (patch.color !== undefined) {
        const color = String(patch.color || '').trim();
        if (/^#[0-9a-fA-F]{6}$/.test(color)) material.color = color;
    }
    return selectedTerminalScreenMaterial(state);
}

export function setSelectedItemHoverSpin(state = {}, enabled = false, speed = 1.45) {
    const item = selectedRadialItem(state);
    if (!item) return null;
    item.geometry = isPlainObject(item.geometry) ? item.geometry : {};
    if (enabled) {
        item.geometry.hoverSpinSpeed = Number.isFinite(Number(speed)) ? Number(speed) : 1.45;
    } else {
        delete item.geometry.hoverSpinSpeed;
    }
    return item.geometry.hoverSpinSpeed ?? null;
}

function ensureNestedTreeEffect(item = {}) {
    item.geometry = isPlainObject(item.geometry) ? item.geometry : {};
    const effect = isPlainObject(item.geometry.radialEffect) ? item.geometry.radialEffect : {};
    item.geometry.radialEffect = {
        kind: DEFAULT_NESTED_TREE_EFFECT.kind,
        ...effect,
    };
    return item.geometry.radialEffect;
}

export function selectedItemFractalPulse(state = {}) {
    const item = selectedRadialItem(state);
    return resolveNestedFractalPulse(item?.geometry?.radialEffect || {});
}

export function setSelectedItemFractalPulseIntensity(state = {}, intensity = 1) {
    const item = selectedRadialItem(state);
    if (!item) return null;
    const effect = ensureNestedTreeEffect(item);
    const current = resolveNestedFractalPulse(effect);
    const value = Number(intensity);
    effect.fractalPulse = {
        ...(isPlainObject(effect.fractalPulse) ? effect.fractalPulse : {}),
        intensity: Number.isFinite(value) ? Math.max(0, Math.min(3, value)) : current.intensity,
    };
    return resolveNestedFractalPulse(effect);
}
