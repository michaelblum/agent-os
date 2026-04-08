import state from '../../renderer/state.js';

// Drifting spin axis — slowly wanders for organic rotation feel
const _spinAxis = new THREE.Vector3(0.5, 1.0, 0).normalize();
const _driftTarget = new THREE.Vector3(0.5, 1.0, 0).normalize();
let _driftTimer = 0;
const _DRIFT_INTERVAL = 4.0; // seconds between new drift targets
const _DRIFT_BLEND = 0.005;  // how fast axis blends toward target
const _MOMENTUM_CUTOFF = 0.0005; // below this, kill residual rotation
const _angularVelocity = new THREE.Vector3(); // reusable vector for consolidated rotation

export function updatePathVisual() {
    if (state.pathLine) {
        state.scene.remove(state.pathLine);
        state.pathLine.geometry.dispose();
        state.pathLine.material.dispose();
        state.pathLine = null;
    }
    if (!state.isShowPathEnabled || !state.isPathEnabled) return;

    const pts = state.pathType === 'curve'
        ? state.smoothCurve.getPoints(100)
        : [...state.pathPoints, state.pathPoints[0]];
    const geo = new THREE.BufferGeometry().setFromPoints(pts);
    const mat = new THREE.LineBasicMaterial({
        color: new THREE.Color(state.colors.edge[0]),
        linewidth: 2, transparent: true, opacity: 0.5, depthWrite: false
    });
    state.pathLine = new THREE.Line(geo, mat);
    state.scene.add(state.pathLine);
}

export function animatePathing(dt) {
    // In 3D grid mode, the object stays at origin — no spinning, no pathing, no momentum
    if (state.gridMode === '3d') {
        // Auto-move: sinusoidal drift like the 3D grid demo
        if (state.isPathEnabled) {
            state.grid3dTime = (state.grid3dTime || 0) + dt * state.grid3dTimeScale;
            const t = state.grid3dTime;
            const ox = Math.sin(t) * 6;
            const oy = Math.sin(t * 1.5) * 3;
            const oz = Math.cos(t * 0.8) * 6;

            if (state.grid3dRelativeMotion) {
                // Relative motion: polyGroup stays at origin visually,
                // but we store the "logical" position so grid3d can offset the grid
                state._grid3dLogicalPos = state._grid3dLogicalPos || new THREE.Vector3();
                state._grid3dLogicalPos.set(ox, oy, oz);
                state.polyGroup.position.set(0, 0, 0);
            } else {
                // Normal: mass moves through the grid
                state.polyGroup.position.set(ox, oy, oz);
                state._grid3dLogicalPos = null;
            }
        } else {
            state._grid3dLogicalPos = null;
        }
        // Keep camera looking at origin
        state.camera.lookAt(0, 0, 0);
        return;
    }

    const isMotionPaused = state.isPaused || state.isMenuOpen || state.isDraggingObject || state.isPanningObject || state.isPanningCamera;

    // Camera tracking
    if (state.isCenteredView) {
        let lerpFactor = 0.1;
        state.perspCamera.position.x += (state.polyGroup.position.x - state.perspCamera.position.x) * lerpFactor;
        state.perspCamera.position.y += (state.polyGroup.position.y - state.perspCamera.position.y) * lerpFactor;
        state.orthoCamera.position.x += (state.polyGroup.position.x - state.orthoCamera.position.x) * lerpFactor;
        state.orthoCamera.position.y += (state.polyGroup.position.y - state.orthoCamera.position.y) * lerpFactor;
    } else {
        let lerpFactor = 0.1;
        state.perspCamera.position.x += (0 - state.perspCamera.position.x) * lerpFactor;
        state.perspCamera.position.y += (0 - state.perspCamera.position.y) * lerpFactor;
        state.orthoCamera.position.x += (0 - state.orthoCamera.position.x) * lerpFactor;
        state.orthoCamera.position.y += (0 - state.orthoCamera.position.y) * lerpFactor;
    }

    // Path line z-offset
    if (state.pathLine) {
        let pathZOffset = ((state.z_depth - state.depth_range.min) / (state.depth_range.max - state.depth_range.min)) * 2.0 - 1.0;
        state.pathLine.position.z = pathZOffset;
    }

    // Movement
    if (!isMotionPaused && !state.isDestroyed) {
        if (state.isPathEnabled) {
            let pathZOffset = ((state.z_depth - state.depth_range.min) / (state.depth_range.max - state.depth_range.min)) * 2.0 - 1.0;

            if (state.pathType === 'curve') {
                state.pathProgress += (state.pathSpeed * 0.02) * dt;
                if (state.pathProgress > 1) state.pathProgress -= 1;
                let rawPt = state.smoothCurve.getPointAt(state.pathProgress);
                state.targetPosition.set(rawPt.x, rawPt.y, rawPt.z + pathZOffset);
            } else {
                let p0 = state.pathPoints[state.currentPathIndex];
                let p1 = state.pathPoints[(state.currentPathIndex + 1) % state.pathPoints.length];
                let segmentLength = p0.distanceTo(p1);

                state.segmentProgress += (state.pathSpeed * 1.5 / segmentLength) * dt;
                if (state.segmentProgress >= 1.0) {
                    state.segmentProgress = 0;
                    state.currentPathIndex = (state.currentPathIndex + 1) % state.pathPoints.length;
                } else {
                    let easedT = Math.sin((state.segmentProgress - 0.5) * Math.PI) * 0.5 + 0.5;
                    let rawPt = new THREE.Vector3().copy(p0).lerp(p1, easedT);
                    state.targetPosition.set(rawPt.x, rawPt.y, rawPt.z + pathZOffset);
                }
            }
            state.polyGroup.position.lerp(state.targetPosition, 0.2);
        } else {
            state.polyGroup.position.lerp(state.targetPosition, 0.08);
        }

        // Drift the spin axis slowly for organic rotation feel
        _driftTimer += dt;
        if (_driftTimer >= _DRIFT_INTERVAL) {
            _driftTimer = 0;
            _driftTarget.set(Math.random() - 0.5, Math.random() - 0.5 + 0.5, Math.random() - 0.5).normalize();
        }
        _spinAxis.lerp(_driftTarget, _DRIFT_BLEND).normalize();

        // Consolidate all rotation sources into a single angular velocity vector.
        // Multiple rotateOnWorldAxis calls on different axes compound into twisting;
        // summing into one vector and rotating once avoids this.
        _angularVelocity.copy(_spinAxis).multiplyScalar(state.idleSpinSpeed);

        if (state.quickSpinActive) {
            let timeRemaining = state.quickSpinEndTime - performance.now();
            if (timeRemaining > 0) {
                let t = timeRemaining / 2000;
                _angularVelocity.addScaledVector(state.quickSpinAxis, state.quickSpinSpeed * t * t);
            } else {
                state.quickSpinActive = false;
            }
        }

        // Move rotation (from click-to-follow) — blend into spin axis over time
        if (state.moveRotationSpeed > _MOMENTUM_CUTOFF) {
            _angularVelocity.addScaledVector(state.moveRotationAxis, state.moveRotationSpeed);
            if (!state.isPathEnabled) state.moveRotationSpeed *= 0.96;
        } else {
            state.moveRotationSpeed = 0;
        }

        // Apply single consolidated rotation
        const totalSpeed = _angularVelocity.length();
        if (totalSpeed > 0.00001) {
            _angularVelocity.normalize();
            state.polyGroup.rotateOnWorldAxis(_angularVelocity, totalSpeed);
        }
    }

    // Residual drag momentum — also consolidated as single rotation
    if (!isMotionPaused && !state.isPathEnabled && !state.isDestroyed && state.dragMomentumSpeed > _MOMENTUM_CUTOFF) {
        state.polyGroup.rotateOnWorldAxis(state.dragMomentumAxis, state.dragMomentumSpeed);
        state.dragMomentumSpeed *= 0.95;
    } else if (state.dragMomentumSpeed > 0) {
        state.dragMomentumSpeed = 0;
    }

    // Normalize quaternion to prevent floating-point drift
    state.polyGroup.quaternion.normalize();
}
