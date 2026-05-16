import { addEdges, material } from '../item-helpers.js';

export function createContextMenuGlyph() {
    const group = new THREE.Group();
    const core = material('#7df8d7', 0.68);
    const accent = material('#d8fff5', 0.82);

    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.18, 0.035, 6, 16), core);
    group.add(ring);
    addEdges(group, ring, '#eaffff', 0.5);

    const toothGeometry = new THREE.BoxGeometry(0.075, 0.032, 0.055);
    for (let i = 0; i < 8; i += 1) {
        const angle = (i / 8) * Math.PI * 2;
        const tooth = new THREE.Mesh(toothGeometry, i % 2 === 0 ? accent : core);
        tooth.position.set(Math.cos(angle) * 0.23, Math.sin(angle) * 0.23, 0);
        tooth.rotation.z = angle;
        group.add(tooth);
    }

    const hub = new THREE.Mesh(new THREE.OctahedronGeometry(0.075, 0), accent);
    group.add(hub);
    return group;
}

export const contextMenuRadialItemModule = {
    ref: 'sigil.radial.geometry.context-menu',
    itemIds: ['context-menu'],
    fallbackGlyph: 'context-menu',
    createGlyph: createContextMenuGlyph,
};
