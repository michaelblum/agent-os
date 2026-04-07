import state from '../../js/state.js';

const _spinAxis = new THREE.Vector3(0.5, 1.0, 0).normalize();

export function animatePathing(dt) {
    if (state.isPaused) return;

    if (!state.isDestroyed) {
        let activeRotationSpeed = state.idleSpinSpeed;

        if (state.quickSpinActive) {
            let timeRemaining = state.quickSpinEndTime - performance.now();
            if (timeRemaining > 0) {
                let t = timeRemaining / 2000;
                activeRotationSpeed += state.quickSpinSpeed * t * t;
                state.polyGroup.rotateOnWorldAxis(state.quickSpinAxis, state.quickSpinSpeed * t * t);
            } else {
                state.quickSpinActive = false;
            }
        }

        state.polyGroup.rotateOnWorldAxis(_spinAxis, activeRotationSpeed);
    }

    state.polyGroup.quaternion.normalize();
}

export function setScenePosition(sx, sy) {
    state.polyGroup.position.x = sx;
    state.polyGroup.position.y = sy;
}
