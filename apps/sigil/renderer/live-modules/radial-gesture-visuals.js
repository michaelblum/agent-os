function material(color, opacity = 0.75) {
    return new THREE.MeshPhongMaterial({
        color: new THREE.Color(color),
        transparent: true,
        opacity,
        shininess: 55,
        specular: new THREE.Color(0x444444),
        depthWrite: false,
    });
}

function edgeMaterial(color, opacity = 0.9) {
    return new THREE.LineBasicMaterial({
        color: new THREE.Color(color),
        transparent: true,
        opacity,
        depthWrite: false,
    });
}

function addEdges(group, mesh, color = '#ffffff', opacity = 0.55) {
    const edges = new THREE.LineSegments(
        new THREE.EdgesGeometry(mesh.geometry),
        edgeMaterial(color, opacity)
    );
    edges.scale.copy(mesh.scale);
    edges.position.copy(mesh.position);
    edges.rotation.copy(mesh.rotation);
    group.add(edges);
}

function createContextMenuGlyph() {
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

function brainLobe(x, y, z, sx, sy, sz, color) {
    const mesh = new THREE.Mesh(new THREE.IcosahedronGeometry(0.13, 0), material(color, 0.76));
    mesh.position.set(x, y, z);
    mesh.scale.set(sx, sy, sz);
    return mesh;
}

function createWikiGraphGlyph() {
    const group = new THREE.Group();
    const lobes = [
        brainLobe(-0.09, 0.05, 0, 1.05, 0.78, 0.65, '#ba8cff'),
        brainLobe(0.09, 0.05, 0, 1.05, 0.78, 0.65, '#78d8ff'),
        brainLobe(-0.07, -0.08, 0, 0.92, 0.72, 0.58, '#9ac8ff'),
        brainLobe(0.07, -0.08, 0, 0.92, 0.72, 0.58, '#d18cff'),
    ];
    for (const lobe of lobes) {
        group.add(lobe);
        addEdges(group, lobe, '#ffffff', 0.42);
    }

    const groove = new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(0, 0.18, 0.03),
        new THREE.Vector3(-0.025, 0.06, 0.04),
        new THREE.Vector3(0.018, -0.03, 0.04),
        new THREE.Vector3(-0.012, -0.18, 0.03),
    ]);
    group.add(new THREE.Line(groove, edgeMaterial('#0b1730', 0.7)));
    return group;
}

function createFallbackGlyph() {
    const group = new THREE.Group();
    const mesh = new THREE.Mesh(new THREE.DodecahedronGeometry(0.16, 0), material('#b8d8ff', 0.72));
    group.add(mesh);
    addEdges(group, mesh, '#ffffff', 0.45);
    return group;
}

function createGlyph(item = {}) {
    if (item.action === 'contextMenu' || item.id === 'context-menu') return createContextMenuGlyph();
    if (item.action === 'wikiGraph' || item.id === 'wiki-graph') return createWikiGraphGlyph();
    return createFallbackGlyph();
}

function finite(value, fallback) {
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
}

function glyphSceneRadius(glyph) {
    const box = new THREE.Box3().setFromObject(glyph);
    const size = new THREE.Vector3();
    box.getSize(size);
    const radius = Math.max(size.x, size.y, size.z) * 0.5;
    return Number.isFinite(radius) && radius > 0 ? radius : 0.25;
}

function disposeObject(object) {
    object.traverse((child) => {
        if (child.geometry) child.geometry.dispose();
        if (Array.isArray(child.material)) {
            child.material.forEach((mat) => mat.dispose?.());
        } else if (child.material) {
            child.material.dispose?.();
        }
    });
}

export function createSigilRadialGestureVisuals({ scene, projectPoint, projectRadius } = {}) {
    const group = new THREE.Group();
    group.visible = false;
    group.renderOrder = 20;
    scene.add(group);
    const glyphs = new Map();
    let lastState = { visible: false, count: 0, itemIds: [], scales: {} };
    let lastRadial = null;
    let displayProgress = 0;

    function ensureGlyph(item) {
        const id = item.id || 'item';
        let glyph = glyphs.get(id);
        if (glyph) return glyph;
        glyph = createGlyph(item);
        glyph.userData.itemId = id;
        glyph.userData.baseRadius = glyphSceneRadius(glyph);
        glyphs.set(id, glyph);
        group.add(glyph);
        return glyph;
    }

    function removeMissing(items) {
        const ids = new Set(items.map((item) => item.id || 'item'));
        for (const [id, glyph] of glyphs.entries()) {
            if (ids.has(id)) continue;
            group.remove(glyph);
            disposeObject(glyph);
            glyphs.delete(id);
        }
    }

    function update(radial, options = {}) {
        const activeRadial = radial?.phase === 'radial' ? radial : null;
        if (activeRadial) lastRadial = activeRadial;
        const source = activeRadial || lastRadial;
        const targetProgress = activeRadial
            ? Math.max(0.08, Number(activeRadial.menuProgress) || 0)
            : 0;
        const smoothing = activeRadial ? 0.42 : 0.28;
        displayProgress += (targetProgress - displayProgress) * smoothing;

        if (!source || displayProgress <= 0.015) {
            group.visible = false;
            displayProgress = 0;
            if (!activeRadial) lastRadial = null;
            lastState = { visible: false, count: 0, itemIds: [], scales: {} };
            return lastState;
        }

        const items = Array.isArray(source.items) ? source.items : [];
        removeMissing(items);
        group.visible = true;
        const time = Number(options.time) || 0;
        const progress = displayProgress;
        const scales = {};

        for (const item of items) {
            const glyph = ensureGlyph(item);
            const projected = projectPoint?.(item.center);
            glyph.visible = !!projected;
            if (!projected) continue;
            const active = activeRadial && item.id === source.activeItemId;
            glyph.position.copy(projected);
            glyph.traverse((child) => {
                if (!child.material) return;
                const opacity = Number(child.material.userData?.baseOpacity ?? child.material.opacity ?? 1);
                child.material.userData.baseOpacity = opacity;
                child.material.opacity = opacity * Math.min(1, progress * 1.4);
            });
            const itemRadius = finite(item.visualRadius, 14);
            const sceneRadius = projectRadius?.(item.center, itemRadius) ?? 0.24;
            const baseRadius = finite(glyph.userData.baseRadius, 0.25);
            const targetScale = (sceneRadius / Math.max(0.01, baseRadius)) * (active ? 1.28 : 1.0) * progress;
            glyph.scale.setScalar(targetScale);
            scales[item.id || 'item'] = targetScale;
            glyph.rotation.x = Math.sin(time * 1.7 + item.angle * 0.02) * 0.22;
            glyph.rotation.y = time * (active ? 1.6 : 0.8) + item.angle * 0.01;
            glyph.rotation.z = active ? Math.sin(time * 6) * 0.08 : 0;
        }

        lastState = {
            visible: true,
            count: items.length,
            itemIds: [...glyphs.keys()],
            activeItemId: activeRadial ? (source.activeItemId || null) : null,
            scales,
        };
        return lastState;
    }

    function destroy() {
        scene.remove(group);
        disposeObject(group);
        glyphs.clear();
    }

    function reset() {
        group.visible = false;
        lastRadial = null;
        displayProgress = 0;
        lastState = { visible: false, count: 0, itemIds: [], scales: {} };
    }

    return {
        group,
        update,
        reset,
        destroy,
        snapshot() {
            return {
                ...lastState,
                visible: group.visible && lastState.visible,
            };
        },
    };
}
