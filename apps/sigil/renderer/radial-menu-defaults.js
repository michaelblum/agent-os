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
    src: '../assets/models/brain-hologram/scene.gltf',
    modelUid: '09d686a1a1f745cba6b2385d0c831214',
    title: 'Brain hologram',
    radiusScale: 1.42,
    material: 'source-emissive',
    attribution: {
        title: 'Brain hologram',
        titleUrl: 'https://sketchfab.com/3d-models/brain-hologram-09d686a1a1f745cba6b2385d0c831214',
        author: 'oxterium',
        authorUrl: 'https://sketchfab.com/oxterium',
        source: 'Sketchfab',
        license: 'Free Standard',
        licenseUrl: 'https://sketchfab.com/licenses',
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
