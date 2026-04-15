import state from './state.js';

export function createParticleObjects() {
    // Shockwave sphere
    state.shockwaveSphere = new THREE.Mesh(
        new THREE.SphereGeometry(1, 32, 32),
        new THREE.MeshBasicMaterial({
            color: 0xffffff, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending
        })
    );
    state.shockwaveSphere.visible = false;
    state.scene.add(state.shockwaveSphere);

    // Shockwave disk
    state.shockwaveDisk = new THREE.Mesh(
        new THREE.RingGeometry(0.01, 1, 64),
        new THREE.MeshBasicMaterial({
            color: 0xffffff, transparent: true, opacity: 0, side: THREE.DoubleSide,
            depthWrite: false, blending: THREE.AdditiveBlending
        })
    );
    state.shockwaveDisk.visible = false;
    state.scene.add(state.shockwaveDisk);

    // Trail sprite pool
    for (let i = 0; i < 200; i++) {
        let s = new THREE.Sprite(new THREE.SpriteMaterial({
            blending: THREE.AdditiveBlending, depthWrite: false
        }));
        s.visible = false;
        state.scene.add(s);
        state.trailSprites.push(s);
    }
}

export function animateParticles(dt) {
    // White particles
    for (let i = state.particles.length - 1; i >= 0; i--) {
        let p = state.particles[i];
        p.mesh.position.add(p.vel);
        p.life -= dt;
        p.mesh.material.opacity = p.life;
        if (p.life <= 0) {
            state.scene.remove(p.mesh);
            p.mesh.material.dispose();
            state.particles.splice(i, 1);
        }
    }

    // Shockwave
    if (state.isShockwaveActive) {
        state.shockwaveTime += dt;

        let tSph = Math.min(state.shockwaveTime / 0.4, 1.0);
        let sphScale = tSph * 400;
        state.shockwaveSphere.scale.set(sphScale, sphScale, sphScale);
        state.shockwaveSphere.material.opacity = 0.5 * (1.0 - Math.pow(tSph, 2));

        let tDsk = Math.min(state.shockwaveTime / 0.4, 1.0);
        let dskScale = tDsk * 200;
        state.shockwaveDisk.scale.set(dskScale, dskScale, 1);
        state.shockwaveDisk.material.opacity = 0.8 * (1.0 - Math.pow(tDsk, 2));

        if (tSph >= 1.0 && tDsk >= 1.0) {
            state.isShockwaveActive = false;
        }
    }
}

export function animateTrails(dt) {
    const isMotionPaused = state.isPaused || state.isMenuOpen || state.isDraggingObject;

    if (state.isTrailEnabled && !isMotionPaused) {
        state.trailPositions.unshift(state.polyGroup.position.clone());
        if (state.trailPositions.length > state.trailLength) state.trailPositions.length = state.trailLength;
    } else if (!state.isTrailEnabled) {
        state.trailPositions = [];
    }

    for (let i = 0; i < state.trailSprites.length; i++) {
        if (i < state.trailPositions.length) {
            state.trailSprites[i].visible = true;
            state.trailSprites[i].position.copy(state.trailPositions[i]);
            let progress = i / state.trailPositions.length;
            state.trailSprites[i].material.opacity = state.currentOpacity * (1.0 - progress);
            let tScale = state.z_depth * 0.5 * (1.0 - progress * 0.5);
            state.trailSprites[i].scale.set(tScale, tScale, 1);
        } else {
            state.trailSprites[i].visible = false;
        }
    }
}
