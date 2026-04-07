import state from './state.js';
import { updateOmegaGeometry } from './geometry.js';

const _lastPos = new THREE.Vector3();
const _counterSpinAxis = new THREE.Vector3(0.5, 1.0, 0).normalize();
let _lastPosInitialized = false;
let _wasCounterSpin = false;
let _counterSpinAngle = 0;

export function createOmega() {
    state.omegaGroup = new THREE.Group();
    state.omegaGroup.visible = false;
    state.scene.add(state.omegaGroup);

    updateOmegaGeometry(state.omegaGeometryType);

    // Ghost pool will be created on demand during animation
    state.omegaGhosts = [];
}

export function animateOmega(dt) {
    if (!state.omegaGroup) return;

    // --- Visibility ---
    if (!state.isOmegaEnabled) {
        state.omegaGroup.visible = false;
        _cleanupAllGhosts();
        _lastPosInitialized = false;
        return;
    }
    state.omegaGroup.visible = true;

    // --- Scale ---
    state.omegaGroup.scale.setScalar(state.omegaScale * state.z_depth * state.novaScale);

    // --- Position ---
    if (state.omegaInterDimensional) {
        // Lerp toward Alpha position with lag
        state.omegaGroup.position.lerp(state.polyGroup.position, state.omegaLagFactor);
    } else {
        state.omegaGroup.position.copy(state.polyGroup.position);
    }

    // --- Rotation ---
    if (state.omegaLockPosition) {
        // Don't change rotation — stays fixed in world space
        _wasCounterSpin = false;
    } else if (state.omegaCounterSpin) {
        // Reset angle on mode switch
        if (!_wasCounterSpin) {
            _counterSpinAngle = 0;
            _wasCounterSpin = true;
        }
        // Fresh quaternion from angle each frame — no accumulation drift
        _counterSpinAngle -= state.idleSpinSpeed;
        state.omegaGroup.quaternion.setFromAxisAngle(_counterSpinAxis, _counterSpinAngle);
    } else {
        // Normal: copy Alpha rotation
        state.omegaGroup.quaternion.copy(state.polyGroup.quaternion);
        _wasCounterSpin = false;
    }

    // --- Ghost system (only when inter-dimensional is ON) ---
    if (state.omegaInterDimensional) {
        _animateGhosts(dt);
    } else {
        _cleanupAllGhosts();
    }
}

function _animateGhosts(dt) {
    // Compute position delta from last frame
    if (!_lastPosInitialized) {
        _lastPos.copy(state.omegaGroup.position);
        _lastPosInitialized = true;
    }
    const delta = state.omegaGroup.position.distanceTo(_lastPos);
    _lastPos.copy(state.omegaGroup.position);

    // Spawn ghosts when movement detected
    if (delta > 0.01) {
        state.omegaGhostTimer -= dt;
        if (state.omegaGhostTimer <= 0) {
            _spawnGhost();
            // Evenly spread spawn interval over duration
            const interval = state.omegaGhostDuration / Math.max(state.omegaGhostCount, 1);
            state.omegaGhostTimer = interval;
        }
    }

    // Update existing ghosts
    for (let i = state.omegaGhosts.length - 1; i >= 0; i--) {
        const ghost = state.omegaGhosts[i];
        ghost.life -= dt;

        if (ghost.life <= 0) {
            // Remove dead ghost
            state.scene.remove(ghost.mesh);
            ghost.mesh.geometry.dispose();
            ghost.mesh.material.dispose();
            state.omegaGhosts.splice(i, 1);
            continue;
        }

        const progress = ghost.life / ghost.maxLife; // 1 = just born, 0 = dead

        switch (state.omegaGhostMode) {
            case 'fade':
                ghost.mesh.material.opacity = progress;
                break;

            case 'shrink':
                ghost.mesh.scale.setScalar(ghost.startScale * progress);
                break;

            case 'edgeScatter': {
                ghost.mesh.material.opacity = progress;
                const positions = ghost.mesh.geometry.attributes.position.array;
                const orig = ghost.originalPositions;
                const scatterAmount = 2.0;
                const t = 1 - progress;
                // Compute centroid from original positions
                for (let v = 0; v < positions.length; v += 3) {
                    positions[v]     = orig[v]     + (orig[v]     - ghost.centroid.x) * t * scatterAmount;
                    positions[v + 1] = orig[v + 1] + (orig[v + 1] - ghost.centroid.y) * t * scatterAmount;
                    positions[v + 2] = orig[v + 2] + (orig[v + 2] - ghost.centroid.z) * t * scatterAmount;
                }
                ghost.mesh.geometry.attributes.position.needsUpdate = true;
                break;
            }

            case 'vertexDissolve': {
                ghost.mesh.material.opacity = progress;
                const positions = ghost.mesh.geometry.attributes.position.array;
                const orig = ghost.originalPositions;
                const jitterAmount = 0.5;
                const t = 1 - progress;
                for (let v = 0; v < positions.length; v += 3) {
                    positions[v]     = orig[v]     + (Math.random() - 0.5) * jitterAmount * t;
                    positions[v + 1] = orig[v + 1] + (Math.random() - 0.5) * jitterAmount * t;
                    positions[v + 2] = orig[v + 2] + (Math.random() - 0.5) * jitterAmount * t;
                }
                ghost.mesh.geometry.attributes.position.needsUpdate = true;
                break;
            }

            case 'scaleWarp': {
                ghost.mesh.material.opacity = progress;
                const t = 1 - progress;
                const stretchFactor = 1 + t * 2;
                const compressFactor = 1 / Math.sqrt(stretchFactor);
                // Scale non-uniformly on the ghost's random axis
                const axis = ghost.randomAxis;
                // Decompose: stretch along randomAxis, compress on the other two
                // Use a simple approximation: scale in the dominant axis direction
                const sx = 1 + Math.abs(axis.x) * (stretchFactor - 1) + (1 - Math.abs(axis.x)) * (compressFactor - 1);
                const sy = 1 + Math.abs(axis.y) * (stretchFactor - 1) + (1 - Math.abs(axis.y)) * (compressFactor - 1);
                const sz = 1 + Math.abs(axis.z) * (stretchFactor - 1) + (1 - Math.abs(axis.z)) * (compressFactor - 1);
                ghost.mesh.scale.set(
                    ghost.startScale * sx,
                    ghost.startScale * sy,
                    ghost.startScale * sz
                );
                break;
            }

            default:
                // Fallback to fade
                ghost.mesh.material.opacity = progress;
                break;
        }
    }

    // Cap ghost count: remove oldest if over limit
    while (state.omegaGhosts.length > state.omegaGhostCount) {
        const oldest = state.omegaGhosts.shift();
        state.scene.remove(oldest.mesh);
        oldest.mesh.geometry.dispose();
        oldest.mesh.material.dispose();
    }
}

function _spawnGhost() {
    if (!state.omegaWireframeMesh) return;

    // Clone the geometry so each ghost has independent vertex positions
    const ghostGeo = state.omegaWireframeMesh.geometry.clone();

    // Store original positions for scatter/dissolve effects
    const originalPositions = new Float32Array(ghostGeo.attributes.position.array);

    // Compute centroid from original positions for edgeScatter
    let cx = 0, cy = 0, cz = 0;
    const posCount = originalPositions.length / 3;
    for (let i = 0; i < originalPositions.length; i += 3) {
        cx += originalPositions[i];
        cy += originalPositions[i + 1];
        cz += originalPositions[i + 2];
    }
    cx /= posCount;
    cy /= posCount;
    cz /= posCount;

    // Create a new material so opacity changes don't affect Omega itself
    const ghostMat = new THREE.LineBasicMaterial({
        color: new THREE.Color(state.colors.omegaEdge[0]),
        transparent: true,
        opacity: 1.0,
        depthWrite: false,
        blending: THREE.NormalBlending
    });

    // Copy vertex colors if they exist on the source
    if (state.omegaWireframeMesh.geometry.attributes.color) {
        ghostGeo.setAttribute('color', state.omegaWireframeMesh.geometry.attributes.color.clone());
        ghostMat.vertexColors = true;
        ghostMat.color.setHex(0xffffff);
    }

    const ghostMesh = new THREE.LineSegments(ghostGeo, ghostMat);

    // Copy world transform from omegaGroup
    ghostMesh.position.copy(state.omegaGroup.position);
    ghostMesh.quaternion.copy(state.omegaGroup.quaternion);

    const currentScale = state.omegaScale * state.z_depth * state.novaScale;
    ghostMesh.scale.setScalar(currentScale);

    state.scene.add(ghostMesh);

    state.omegaGhosts.push({
        mesh: ghostMesh,
        life: state.omegaGhostDuration,
        maxLife: state.omegaGhostDuration,
        startScale: currentScale,
        randomAxis: new THREE.Vector3(
            Math.random() - 0.5,
            Math.random() - 0.5,
            Math.random() - 0.5
        ).normalize(),
        originalPositions: originalPositions,
        centroid: new THREE.Vector3(cx, cy, cz)
    });
}

function _cleanupAllGhosts() {
    for (const ghost of state.omegaGhosts) {
        state.scene.remove(ghost.mesh);
        ghost.mesh.geometry.dispose();
        ghost.mesh.material.dispose();
    }
    state.omegaGhosts.length = 0;
    state.omegaGhostTimer = 0;
}

export function updateOmegaColors() {
    // Update face vertex colors
    if (state.omegaCoreMesh) {
        const geo = state.omegaCoreMesh.geometry;
        const count = geo.attributes.position.count;
        if (!geo.attributes.color || geo.attributes.color.count !== count) {
            geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(count * 3), 3));
        }
        const col = geo.attributes.color;
        geo.computeBoundingBox();
        const min = geo.boundingBox.min.y;
        const range = (geo.boundingBox.max.y - min) || 1;
        const c1 = new THREE.Color(state.colors.omegaFace[0]);
        const c2 = new THREE.Color(state.colors.omegaFace[1]);
        const tC = new THREE.Color();
        for (let i = 0; i < count; i++) {
            tC.copy(c1).lerp(c2, (geo.attributes.position.getY(i) - min) / range);
            col.setXYZ(i, tC.r, tC.g, tC.b);
        }
        col.needsUpdate = true;
        state.omegaCoreMesh.material.vertexColors = true;
        state.omegaCoreMesh.material.color.setHex(0xffffff);
        if (state.omegaCoreMesh.material.map) { state.omegaCoreMesh.material.map.dispose(); state.omegaCoreMesh.material.map = null; }
        state.omegaCoreMesh.material.needsUpdate = true;
    }

    // Update edge material color
    if (state.omegaWireframeMesh) {
        const geo = state.omegaWireframeMesh.geometry;
        const count = geo.attributes.position.count;
        if (!geo.attributes.color || geo.attributes.color.count !== count) {
            geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(count * 3), 3));
        }
        const col = geo.attributes.color;
        geo.computeBoundingBox();
        const min = geo.boundingBox.min.y;
        const range = (geo.boundingBox.max.y - min) || 1;
        const c1 = new THREE.Color(state.colors.omegaEdge[0]);
        const c2 = new THREE.Color(state.colors.omegaEdge[1]);
        const tC = new THREE.Color();
        for (let i = 0; i < count; i++) {
            tC.copy(c1).lerp(c2, (geo.attributes.position.getY(i) - min) / range);
            col.setXYZ(i, tC.r, tC.g, tC.b);
        }
        col.needsUpdate = true;
        state.omegaWireframeMesh.material.vertexColors = true;
        state.omegaWireframeMesh.material.color.setHex(0xffffff);
        state.omegaWireframeMesh.material.needsUpdate = true;
    }
}
