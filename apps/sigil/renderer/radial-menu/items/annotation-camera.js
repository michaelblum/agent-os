import { addEdges, material } from '../item-helpers.js';

export function createAnnotationCameraGlyph() {
    const group = new THREE.Group();
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.16, 0.07), material('#f4c542', 0.66));
    body.position.y = -0.015;
    group.add(body);
    addEdges(group, body, '#fff3b0', 0.56);

    const lens = new THREE.Mesh(new THREE.TorusGeometry(0.055, 0.012, 8, 28), material('#ffe48a', 0.78));
    lens.position.z = 0.043;
    lens.position.y = -0.015;
    group.add(lens);

    const prism = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.04, 0.06), material('#fff2a0', 0.7));
    prism.position.set(-0.055, 0.09, 0);
    group.add(prism);
    return group;
}

export const annotationCameraRadialItemModule = {
    ref: 'sigil.radial.geometry.annotation-camera',
    itemIds: ['annotation-camera'],
    fallbackGlyph: 'annotation-camera',
    createGlyph: createAnnotationCameraGlyph,
};
