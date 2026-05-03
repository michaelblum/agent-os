export const CONTEXT_COG_MODEL = {
    type: 'gltf',
    src: '../assets/models/cog/scene.gltf',
    modelUid: '158a1e27214841589dce6d7361f1a422',
    title: 'Cog',
    radiusScale: 1.02,
    material: 'sigil-hologram',
    rotationDegrees: { x: 90, y: 0, z: 0 },
    attribution: {
        title: 'Cog',
        titleUrl: 'https://sketchfab.com/3d-models/cog-158a1e27214841589dce6d7361f1a422',
        author: 'Jiri Kuba',
        authorUrl: 'https://sketchfab.com/kuba.jirka',
        source: 'Sketchfab',
        license: 'CC-BY-4.0',
        licenseUrl: 'http://creativecommons.org/licenses/by/4.0/',
    },
};

export const WIKI_BRAIN_HOLOGRAM_MODEL = {
    type: 'gltf',
    src: '../assets/models/human-brain/scene.gltf',
    modelUid: '49bcdf19c1904c76a456b31838b0d7ac',
    title: 'Human Brain',
    radiusScale: 1.42,
    normalizedRadius: 0.28,
    material: 'translucent-brain-shell',
    hoverSpinSpeed: 0,
    hoverYawDegrees: 10,
    radialEffect: {
        kind: 'nested-neural-tree',
        holdExitDirection: 'outward',
        shellOpacity: {
            rest: 0.75,
            active: 0.26,
            held: 0.75,
        },
    },
    attribution: {
        title: 'Human Brain',
        titleUrl: 'https://sketchfab.com/3d-models/human-brain-49bcdf19c1904c76a456b31838b0d7ac',
        author: 'Versal',
        authorUrl: 'https://sketchfab.com/versal',
        source: 'Sketchfab',
        license: 'CC-BY-4.0',
        licenseUrl: 'http://creativecommons.org/licenses/by/4.0/',
    },
};

export const AGENT_TERMINAL_TABLET_MODEL = {
    type: 'gltf',
    src: '../assets/models/low-poly-sci-fi-tablet/scene.gltf',
    modelUid: 'ee1fde7ec1514fd5a61790809ebd46a6',
    title: 'Low Poly Sci-Fi Tablet',
    radiusScale: 1.18,
    normalizedRadius: 0.3,
    rotationDegrees: { x: 90, y: 0, z: 0 },
    attribution: {
        title: 'Low Poly Sci-Fi Tablet',
        titleUrl: 'https://sketchfab.com/3d-models/low-poly-sci-fi-tablet-ee1fde7ec1514fd5a61790809ebd46a6',
        author: 'Snooze',
        authorUrl: 'https://sketchfab.com/Snooze',
        source: 'Sketchfab',
        license: 'CC-BY-4.0',
        licenseUrl: 'http://creativecommons.org/licenses/by/4.0/',
    },
};

export const DEFAULT_SIGIL_RADIAL_ITEMS = [
    {
        id: 'context-menu',
        label: 'Context Menu',
        action: 'contextMenu',
        geometry: CONTEXT_COG_MODEL,
    },
    {
        id: 'agent-terminal',
        label: 'Agent Terminal',
        action: 'agentTerminal',
        geometry: AGENT_TERMINAL_TABLET_MODEL,
    },
    {
        id: 'wiki-graph',
        label: 'Wiki Graph',
        action: 'wikiGraph',
        geometry: WIKI_BRAIN_HOLOGRAM_MODEL,
    },
];

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
    if (!isPlainObject(base) || !isPlainObject(override)) {
        return cloneConfig(override === undefined ? base : override);
    }
    const next = cloneConfig(base);
    for (const [key, value] of Object.entries(override)) {
        next[key] = isPlainObject(next[key]) && isPlainObject(value)
            ? mergeConfig(next[key], value)
            : cloneConfig(value);
    }
    return next;
}

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
    return {
        ...cloneConfig(source),
        items: normalizeSigilRadialItems(source.items),
    };
}
