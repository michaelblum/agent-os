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

    // Charge flares (6 total)
    for (let i = 0; i < 6; i++) {
        let flare = new THREE.Group();
        let gm = new THREE.MeshBasicMaterial({
            color: 0xffffff, transparent: true, opacity: 0.6,
            blending: THREE.AdditiveBlending, depthWrite: false
        });
        let m1 = new THREE.Mesh(new THREE.OctahedronGeometry(1, 0), gm);
        m1.scale.set(1, 0.1, 0.1);
        let m2 = new THREE.Mesh(new THREE.OctahedronGeometry(1, 0), gm);
        m2.scale.set(0.1, 1, 0.1);
        flare.add(m1);
        flare.add(m2);
        flare.visible = false;

        let rx = 0, ry = 0, rz = 0;
        if (i === 1) ry = Math.PI / 2;
        else if (i === 2) rx = Math.PI / 2;
        else if (i === 3) rz = Math.PI / 4;
        else if (i === 4) { ry = Math.PI / 2; rx = Math.PI / 4; }
        else if (i === 5) { rx = Math.PI / 2; ry = Math.PI / 4; }

        flare.userData = { baseX: rx, baseY: ry, baseZ: rz, targetS: 2.0, lastScale: 0, lastSpeed: 0 };
        flare.rotation.set(rx, ry, rz);
        state.polyGroup.add(flare);
        state.chargeFlares.push(flare);
    }
}

export function fireExplosion() {
    for (let i = 0; i < 150; i++) {
        let p = new THREE.Sprite(new THREE.SpriteMaterial({
            map: state.glowSprite.material.map, color: 0xffffff,
            blending: THREE.AdditiveBlending, depthWrite: false
        }));
        p.position.copy(state.polyGroup.position);
        let phi = Math.acos(-1 + (2 * Math.random()));
        let theta = Math.sqrt(100 * Math.PI) * phi;
        let v = new THREE.Vector3(
            Math.cos(theta) * Math.sin(phi),
            Math.sin(theta) * Math.sin(phi),
            Math.cos(phi)
        ).normalize().multiplyScalar(Math.random() * 0.4 + 0.1);

        p.scale.set(0.5, 0.5, 1);
        state.scene.add(p);
        state.particles.push({ mesh: p, vel: v, life: 1.0 });
    }
}

export function fireSuperNova() {
    state.isDestroyed = true;
    state.superNovaTimer = 5.0;

    for (let i = 0; i < 150; i++) {
        let p = new THREE.Sprite(new THREE.SpriteMaterial({
            map: state.glowSprite.material.map,
            color: new THREE.Color(state.colors.edge[0]),
            blending: THREE.AdditiveBlending, depthWrite: false
        }));
        p.position.copy(state.polyGroup.position);
        let phi = Math.acos(-1 + (2 * Math.random()));
        let theta = Math.sqrt(100 * Math.PI) * phi;

        let speed = 0.5 + Math.random() * 2.0;
        let v = new THREE.Vector3(
            Math.cos(theta) * Math.sin(phi),
            Math.sin(theta) * Math.sin(phi),
            Math.cos(phi)
        ).normalize().multiplyScalar(speed);

        p.scale.set(0.6, 0.6, 1);
        state.scene.add(p);
        state.coloredParticles.push({ mesh: p, vel: v, friction: 0.90 + Math.random() * 0.08 });
    }

    fireExplosion();

    state.whiteDwarfSprite.position.copy(state.polyGroup.position);
    state.whiteDwarfSprite.material.opacity = 1.0;
    state.whiteDwarfSprite.scale.set(4.0, 4.0, 1.0);
    state.whiteDwarfSprite.visible = true;
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

    // Inward particles (sucking toward center, accelerating)
    for (let i = state.inwardParticles.length - 1; i >= 0; i--) {
        let p = state.inwardParticles[i];
        p.life -= dt * (0.4 + (1.0 - p.life) * 1.5);
        if (p.life <= 0) {
            state.scene.remove(p.mesh);
            p.mesh.material.dispose();
            state.inwardParticles.splice(i, 1);
        } else {
            p.mesh.position.lerpVectors(state.polyGroup.position, p.start, p.life);
            p.mesh.material.opacity = Math.min(1.0, p.life * 1.5);
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

    // Supernova destroyed state
    if (state.isDestroyed) {
        state.superNovaTimer -= dt;

        for (let i = state.coloredParticles.length - 1; i >= 0; i--) {
            let cp = state.coloredParticles[i];
            cp.mesh.position.add(cp.vel);
            cp.vel.multiplyScalar(cp.friction);

            if (state.superNovaTimer < 3.0) {
                cp.mesh.material.opacity = Math.max(0, state.superNovaTimer / 3.0);
            }

            if (state.superNovaTimer <= 0) {
                state.scene.remove(cp.mesh);
                cp.mesh.material.dispose();
                state.coloredParticles.splice(i, 1);
            }
        }

        if (state.superNovaTimer < 2.5) {
            state.whiteDwarfSprite.material.opacity = Math.max(0, state.superNovaTimer / 2.5);
            let ws = (state.superNovaTimer / 2.5) * 4.0 + 0.1;
            state.whiteDwarfSprite.scale.set(ws, ws, 1.0);
        }

        if (state.superNovaTimer <= 0) {
            state.isDestroyed = false;
            state.whiteDwarfSprite.visible = false;
            state.isRespawning = true;
            state.respawnTimer = 0;
        }
    }
}

export function animateTrails(dt) {
    const isMotionPaused = state.isPaused || state.isMenuOpen || state.isDraggingObject;

    if (state.isTrailEnabled && !isMotionPaused && !state.isDestroyed) {
        state.trailPositions.unshift(state.polyGroup.position.clone());
        if (state.trailPositions.length > state.trailLength) state.trailPositions.length = state.trailLength;
    } else if (!state.isTrailEnabled || state.isDestroyed) {
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
