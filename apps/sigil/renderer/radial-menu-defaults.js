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

export const DEFAULT_SIGIL_RADIAL_ITEMS = [
    {
        id: 'context-menu',
        label: 'Context Menu',
        action: 'contextMenu',
        geometry: CONTEXT_COG_MODEL,
    },
    {
        id: 'wiki-graph',
        label: 'Wiki Graph',
        action: 'wikiGraph',
        geometry: WIKI_BRAIN_HOLOGRAM_MODEL,
    },
];
