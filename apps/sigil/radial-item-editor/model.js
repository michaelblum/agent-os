import { DEFAULT_SIGIL_RADIAL_ITEMS } from '../renderer/radial-menu-defaults.js';
import {
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
export const RADIAL_ITEM_SOURCE = Object.freeze({
    kind: 'sigil.radial_menu.default_items',
    path: 'apps/sigil/renderer/radial-menu-defaults.js',
    export: 'DEFAULT_SIGIL_RADIAL_ITEMS',
    operation: 'replace_item_by_id',
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
    const item = selectedRadialItem(state);
    const registry = buildEditorObjectRegistry(state);
    return {
        type: 'aos.workbench.subject',
        schema_version: WORKBENCH_SUBJECT_SCHEMA_VERSION,
        id: item ? `sigil.radial_menu.item:${item.id}` : 'sigil.radial_menu.item:none',
        subject_type: 'sigil.radial_menu.item_3d',
        label: item ? text(item.label, item.id) : 'No radial item',
        owner: 'sigil.radial-item-editor',
        source: cloneConfig(RADIAL_ITEM_SOURCE),
        capabilities: [
            'canvas_object.registry',
            'canvas_object.transform.patch',
            'canvas_object.visibility.patch',
            'sigil.radial_item_editor.lock_in',
            'sigil.radial_item.preview',
        ],
        views: ['3d.preview', 'object.registry', 'production.radial.preview'],
        controls: ['object.transform', 'object.visibility', 'scene.orbit', 'lock_in'],
        persistence: {
            kind: 'agent_handoff',
            request: RADIAL_ITEM_EDITOR_LOCK_IN_TYPE,
            result: 'source.patch.result',
        },
        state: {
            item_id: item?.id || null,
            canvas_id: text(state.canvasId, DEFAULT_EDITOR_CANVAS_ID),
            object_count: registry.objects.length,
            dirty: true,
        },
        metadata: {
            action: text(item?.action),
            geometry_kind: geometryKind(item || {}),
        },
    };
}

export function applyEditorObjectPatch(state = {}, message = {}) {
    return applyRadialMenuObjectTransformPatch(selectedRadialConfig(state), message, {
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
