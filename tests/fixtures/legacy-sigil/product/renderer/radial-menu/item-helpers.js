export function material(color, opacity = 0.75) {
    return new THREE.MeshPhongMaterial({
        color: new THREE.Color(color),
        transparent: true,
        opacity,
        shininess: 55,
        specular: new THREE.Color(0x444444),
        depthWrite: false,
    });
}

export function edgeMaterial(color, opacity = 0.9) {
    return new THREE.LineBasicMaterial({
        color: new THREE.Color(color),
        transparent: true,
        opacity,
        depthWrite: false,
    });
}

export function addEdges(group, mesh, color = '#ffffff', opacity = 0.55) {
    const edges = new THREE.LineSegments(
        new THREE.EdgesGeometry(mesh.geometry),
        edgeMaterial(color, opacity)
    );
    edges.scale.copy(mesh.scale);
    edges.position.copy(mesh.position);
    edges.rotation.copy(mesh.rotation);
    group.add(edges);
}
