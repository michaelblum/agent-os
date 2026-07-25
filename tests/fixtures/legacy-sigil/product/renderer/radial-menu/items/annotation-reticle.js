import { edgeMaterial, material } from '../item-helpers.js';

export function createAnnotationReticleGlyph() {
    const group = new THREE.Group();
    const gold = material('#f4c542', 0.72);
    const bright = edgeMaterial('#fff3b0', 0.9);

    const outer = new THREE.Mesh(new THREE.TorusGeometry(0.18, 0.012, 8, 40), gold);
    const inner = new THREE.Mesh(new THREE.TorusGeometry(0.08, 0.008, 8, 32), material('#ffe48a', 0.52));
    group.add(outer);
    group.add(inner);

    const lineGeometry = new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(-0.24, 0, 0.01),
        new THREE.Vector3(-0.095, 0, 0.01),
        new THREE.Vector3(0.095, 0, 0.01),
        new THREE.Vector3(0.24, 0, 0.01),
        new THREE.Vector3(0, -0.24, 0.01),
        new THREE.Vector3(0, -0.095, 0.01),
        new THREE.Vector3(0, 0.095, 0.01),
        new THREE.Vector3(0, 0.24, 0.01),
    ]);
    group.add(new THREE.LineSegments(lineGeometry, bright));

    const center = new THREE.Mesh(new THREE.OctahedronGeometry(0.025, 0), material('#fff8d5', 0.86));
    group.add(center);
    return group;
}

export const annotationReticleRadialItemModule = {
    ref: 'sigil.radial.geometry.annotation-reticle',
    itemIds: ['annotation-mode'],
    fallbackGlyph: 'annotation-reticle',
    createGlyph: createAnnotationReticleGlyph,
};
