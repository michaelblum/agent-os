import { DEFAULT_SIGIL_RADIAL_ITEMS } from '../renderer/radial-menu-defaults.js';
import {
    applyRadialMenuObjectTransformPatch,
    buildRadialMenuObjectRegistry,
} from '../renderer/live-modules/radial-object-control.js';

export const DEFAULT_EDITOR_CANVAS_ID = 'sigil-radial-item-editor';
export const DEFAULT_EDITOR_ITEM_ID = 'wiki-graph';
export const RADIAL_ITEM_EDITOR_LOCK_IN_TYPE = 'sigil.radial_item_editor.lock_in';
export const RADIAL_ITEM_EDITOR_LOCK_IN_SCHEMA_VERSION = '2026-05-03';
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
        source: cloneConfig(RADIAL_ITEM_SOURCE),
        item_id: item?.id || null,
        item: item ? cloneConfig(item) : null,
        registry: buildEditorObjectRegistry(state),
    };
}

export function applyEditorObjectPatch(state = {}, message = {}) {
    return applyRadialMenuObjectTransformPatch(selectedRadialConfig(state), message, {
        canvasId: text(state.canvasId, DEFAULT_EDITOR_CANVAS_ID),
    });
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
