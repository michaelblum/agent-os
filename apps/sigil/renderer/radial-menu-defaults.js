import sigilRadialMenu from './radial-menu/sigil-radial-menu.json' with { type: 'json' };

const LEGACY_WIKI_BRAIN_RADIUS_SCALE = 1.42;
const WIKI_BRAIN_RADIUS_SCALE = 1.1502;

export const SIGIL_RADIAL_MENU_DEFINITION = sigilRadialMenu;
export const TOOLKIT_RADIAL_MENU_3D_DEFAULT = {
    kind: 'aos.radial_menu_3d',
    schema_version: '2026-05-16',
    id: 'aos.radial.default-3d',
    label: 'AOS Radial Menu',
    role: 'menu',
    close_on_select: true,
    typeahead: true,
    defaults: {
        item: {
            role: 'menuitem',
            disabled: false,
            hidden: false,
            checked: false,
            current: false,
            close_on_select: true,
        },
        three: {
            item: {
                geometry: {
                    type: 'glyph',
                    module_ref: 'aos.radial.geometry.fallback',
                },
                hover: {
                    progress: {
                        approach: 'exponential',
                        factor: 0.22,
                    },
                    transform: {
                        scale: {
                            from: 1,
                            to: 1.08,
                        },
                        rotate: {
                            spin: {
                                axis: 'y',
                                rate: 1.45,
                            },
                            degrees: {
                                x: 0.12,
                                y: 0,
                                z: 0.055,
                            },
                        },
                    },
                },
            },
        },
    },
    geometry: {
        itemRadius: 1.55,
        itemHitRadius: 0.42,
        itemVisualRadius: 0.28,
        menuRadius: 1.8,
        handoffRadius: 2.25,
        reentryRadius: 1.85,
        spreadDegrees: 88,
        startAngle: -90,
        orientation: 'fixed',
    },
    items: [],
};

function isPlainObject(value) {
    return !!value && typeof value === 'object' && !Array.isArray(value);
}

function cloneConfig(value) {
    if (Array.isArray(value)) return value.map((item) => cloneConfig(item));
    if (!isPlainObject(value)) return value;
    const next = {};
    for (const [key, entry] of Object.entries(value)) {
        next[key] = cloneConfig(entry);
    }
    return next;
}

function mergeConfig(base, override) {
    if (override === undefined) return cloneConfig(base);
    if (!isPlainObject(base) || !isPlainObject(override)) return cloneConfig(override);
    const next = cloneConfig(base);
    for (const [key, value] of Object.entries(override)) {
        next[key] = isPlainObject(next[key]) && isPlainObject(value)
            ? mergeConfig(next[key], value)
            : cloneConfig(value);
    }
    return next;
}

function keyedMergeItems(baseItems = [], overrideItems = []) {
    const result = [];
    const indexes = new Map();
    for (const item of Array.isArray(baseItems) ? baseItems : []) {
        indexes.set(item.id, result.length);
        result.push(cloneConfig(item));
    }
    for (const item of Array.isArray(overrideItems) ? overrideItems : []) {
        if (!item?.id || !indexes.has(item.id)) {
            indexes.set(item?.id, result.length);
            result.push(cloneConfig(item));
            continue;
        }
        const index = indexes.get(item.id);
        result[index] = mergeConfig(result[index], item);
    }
    return result;
}

function normalizeHover(item, menuDefaults) {
    const hover = mergeConfig(menuDefaults?.three?.item?.hover || {}, item?.three?.item?.hover || {});
    const rotate = hover.transform?.rotate || {};
    const spin = rotate.spin || {};
    return mergeConfig(hover, {
        progress: {
            approach: hover.progress?.approach || 'exponential',
            factor: Number.isFinite(Number(hover.progress?.factor)) ? Number(hover.progress.factor) : 0.22,
        },
        transform: {
            scale: {
                from: Number.isFinite(Number(hover.transform?.scale?.from)) ? Number(hover.transform.scale.from) : 1,
                to: Number.isFinite(Number(hover.transform?.scale?.to)) ? Number(hover.transform.scale.to) : 1.08,
            },
            rotate: {
                spin: spin === false ? false : {
                    axis: spin.axis || 'y',
                    rate: Number.isFinite(Number(spin.rate)) ? Number(spin.rate) : 1.45,
                },
                degrees: {
                    x: Number.isFinite(Number(rotate.degrees?.x)) ? Number(rotate.degrees.x) : 0.12,
                    y: Number.isFinite(Number(rotate.degrees?.y)) ? Number(rotate.degrees.y) : 0,
                    z: Number.isFinite(Number(rotate.degrees?.z)) ? Number(rotate.degrees.z) : 0.055,
                },
            },
        },
    });
}

function resolveMenuConfig(menu, base) {
    const merged = mergeConfig(base, menu);
    merged.items = keyedMergeItems(base.items, menu.items).map((item) => {
        const itemDefaults = merged.defaults?.item || {};
        const threeItemDefaults = merged.defaults?.three?.item || {};
        const next = mergeConfig(itemDefaults, item);
        next.three = mergeConfig({ item: threeItemDefaults }, next.three || {});
        next.three.item.hover = normalizeHover(next, merged.defaults || {});
        const children = (Array.isArray(next.children) ? next.children : [])
            .filter((child) => isPlainObject(child))
            .map((child) => {
                const childDefaults = merged.defaults?.item || {};
                const childNext = mergeConfig(childDefaults, child);
                childNext.three = mergeConfig({ item: merged.defaults?.three?.item || {} }, childNext.three || {});
                childNext.three.item.hover = normalizeHover(childNext, merged.defaults || {});
                childNext.logical = {
                    id: childNext.id,
                    label: childNext.label,
                    action: childNext.action ?? null,
                    disabled: !!childNext.disabled,
                    hidden: !!childNext.hidden,
                    checked: !!childNext.checked,
                    current: !!childNext.current,
                    role: childNext.role || 'menuitem',
                    shortcut: childNext.shortcut || null,
                    typeahead: childNext.typeahead || childNext.label || childNext.id,
                    close_on_select: childNext.close_on_select !== false,
                    target_surface: cloneConfig(childNext.target_surface || null),
                    action_payload: cloneConfig(childNext.action_payload || null),
                    submenu_ref: childNext.submenu_ref || null,
                    children: [],
                };
                return childNext;
            });
        if (children.length > 0) next.children = children;
        next.logical = {
            id: next.id,
            label: next.label,
            action: next.action ?? null,
            disabled: !!next.disabled,
            hidden: !!next.hidden,
            checked: !!next.checked,
            current: !!next.current,
            role: next.role || 'menuitem',
            shortcut: next.shortcut || null,
            typeahead: next.typeahead || next.label || next.id,
            close_on_select: next.close_on_select !== false,
            target_surface: cloneConfig(next.target_surface || null),
            action_payload: cloneConfig(next.action_payload || null),
            submenu_ref: next.submenu_ref || null,
            children: children.map((child) => cloneConfig(child.logical)),
        };
        return next;
    });
    merged.logical_items = merged.items.map((item) => cloneConfig(item.logical));
    return merged;
}

export const RESOLVED_SIGIL_RADIAL_MENU = resolveMenuConfig(sigilRadialMenu, TOOLKIT_RADIAL_MENU_3D_DEFAULT);

export const DEFAULT_SIGIL_RADIAL_ITEMS = cloneConfig(RESOLVED_SIGIL_RADIAL_MENU.items);

function itemGeometry(id) {
    return cloneConfig(DEFAULT_SIGIL_RADIAL_ITEMS.find((item) => item.id === id)?.geometry || {});
}

export const CONTEXT_COG_MODEL = itemGeometry('context-menu');
export const WIKI_BRAIN_HOLOGRAM_MODEL = itemGeometry('wiki-graph');
export const AGENT_TERMINAL_TABLET_MODEL = itemGeometry('agent-terminal');
export const ANNOTATION_RETICLE_GEOMETRY = itemGeometry('annotation-mode');
export const ANNOTATION_CAMERA_GEOMETRY = itemGeometry('annotation-camera');

function normalizeRadialItemOverride(item) {
    const next = cloneConfig(item);
    if (!isPlainObject(next)) return next;

    if (next.id === 'codex-terminal') {
        next.id = 'agent-terminal';
        if (next.action === 'codexTerminal') next.action = 'agentTerminal';
        if (next.label === 'Codex Terminal') next.label = 'Agent Terminal';
    }

    if (next.id === 'wiki-graph' && isPlainObject(next.geometry)) {
        if (next.geometry.material === 'translucent-brain') {
            next.geometry.material = WIKI_BRAIN_HOLOGRAM_MODEL.material;
        }
        if (Number(next.geometry.radiusScale) === LEGACY_WIKI_BRAIN_RADIUS_SCALE) {
            next.geometry.radiusScale = WIKI_BRAIN_RADIUS_SCALE;
        }
    }

    return next;
}

const DEFAULT_SIGIL_RADIAL_ITEMS_BY_ID = new Map(
    DEFAULT_SIGIL_RADIAL_ITEMS.map((item) => [item.id, item])
);

export function normalizeSigilRadialItems(items) {
    if (!Array.isArray(items) || items.length === 0) {
        return cloneConfig(DEFAULT_SIGIL_RADIAL_ITEMS);
    }
    return items.map((item) => {
        const normalized = normalizeRadialItemOverride(item);
        const defaults = DEFAULT_SIGIL_RADIAL_ITEMS_BY_ID.get(normalized?.id);
        return defaults ? mergeConfig(defaults, normalized) : normalized;
    });
}

export function normalizeSigilRadialGestureMenu(menu = {}) {
    const source = isPlainObject(menu) ? menu : {};
    const geometry = RESOLVED_SIGIL_RADIAL_MENU.geometry || {};
    return {
        ...cloneConfig(geometry),
        id: RESOLVED_SIGIL_RADIAL_MENU.id,
        kind: RESOLVED_SIGIL_RADIAL_MENU.kind,
        schema_version: RESOLVED_SIGIL_RADIAL_MENU.schema_version,
        role: RESOLVED_SIGIL_RADIAL_MENU.role,
        logical_items: cloneConfig(RESOLVED_SIGIL_RADIAL_MENU.logical_items),
        ...cloneConfig(source),
        items: normalizeSigilRadialItems(source.items),
    };
}
