import state from './state.js';

// --- Lightning bolt (fractal midpoint displacement) ---
class Lightning {
    constructor(start, end, isBranch = false) {
        this.start = start.clone();
        this.end = end.clone();
        this.isBranch = isBranch;
        this.maxLife = state.lightningDuration * (isBranch ? 0.5 : 1.0);
        this.life = this.maxLife;
        this.branches = [];
        this.points = [];

        this.generate();

        const coreColor = new THREE.Color(0xffffff).lerp(
            new THREE.Color(state.colors.lightning[0]),
            1 - Math.min(state.lightningBrightness, 1.0)
        );
        this.material = new THREE.LineBasicMaterial({
            color: coreColor,
            transparent: true,
            opacity: 1,
            blending: THREE.AdditiveBlending,
            linewidth: 1 + Math.random() * 0.5
        });
        this.mesh = new THREE.Line(
            new THREE.BufferGeometry().setFromPoints(this.points),
            this.material
        );
        state.scene.add(this.mesh);
    }

    generate() {
        this.points = [];
        let subPoints = [this.start, this.end];
        let iterations = this.isBranch ? 3 : 6;

        // Recursive midpoint displacement
        for (let i = 0; i < iterations; i++) {
            let next = [];
            for (let j = 0; j < subPoints.length - 1; j++) {
                let p1 = subPoints[j];
                let p2 = subPoints[j + 1];
                let mid = new THREE.Vector3().addVectors(p1, p2).multiplyScalar(0.5);
                let jitter = p1.distanceTo(p2) * 0.25;
                mid.x += (Math.random() - 0.5) * jitter;
                mid.y += (Math.random() - 0.5) * jitter;
                mid.z += (Math.random() - 0.5) * jitter;
                next.push(p1);
                next.push(mid);
            }
            next.push(subPoints[subPoints.length - 1]);
            subPoints = next;
        }
        this.points = subPoints;

        // Branching
        if (!this.isBranch) {
            let boundingRadius = state.z_depth * state.novaScale;
            let origin = state.polyGroup.position;
            for (let i = 1; i < this.points.length - 1; i++) {
                if (Math.random() < state.lightningBranching) {
                    let p = this.points[i];
                    let branchDir = new THREE.Vector3(
                        Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5
                    ).normalize();
                    let branchLen = 0.3 + Math.random() * 0.8;
                    let branchEnd = p.clone().add(branchDir.multiplyScalar(branchLen));

                    // Solid block constraint: branches shouldn't penetrate polyhedra
                    if (state.lightningSolidBlock) {
                        let distFromCenter = branchEnd.clone().sub(origin).length();
                        if (distFromCenter < boundingRadius) {
                            branchEnd.sub(origin).normalize().multiplyScalar(boundingRadius).add(origin);
                        }
                    }

                    this.branches.push(new Lightning(p, branchEnd, true));
                }
            }
        }
    }

    update(dt) {
        this.life -= dt;
        const alpha = Math.max(0, this.life / this.maxLife);

        // Flicker
        const flicker = Math.random() > 0.15 ? 1 : 0.4;
        this.material.opacity = alpha * flicker * state.lightningBrightness;

        // Corona glow pulse
        const corona = state.colors.lightning[1] ? 0.5 : 0;
        if (corona > 0) {
            this.material.opacity += Math.random() * corona * alpha * 0.5;
        }

        // Flickering re-generation (20% chance)
        if (Math.random() > 0.8 && this.life > 0.1) {
            this.branches.forEach(b => {
                state.scene.remove(b.mesh);
                b.mesh.geometry.dispose();
                b.mesh.material.dispose();
            });
            this.branches = [];
            this.generate();
            this.mesh.geometry.setFromPoints(this.points);
        } else {
            this.branches.forEach(b => b.update(dt));
        }

        if (this.life <= 0) {
            this.dispose();
            return false;
        }
        return true;
    }

    dispose() {
        state.scene.remove(this.mesh);
        this.mesh.geometry.dispose();
        this.mesh.material.dispose();
        this.branches.forEach(b => {
            state.scene.remove(b.mesh);
            b.mesh.geometry.dispose();
            b.mesh.material.dispose();
        });
        this.branches = [];
    }
}

// --- Spawn a single bolt ---
function spawnBolt() {
    const origin = state.polyGroup.position.clone();
    const boundingRadius = state.z_depth * state.novaScale;
    const actualLength = state.lightningBoltLength / 25;

    const dir = new THREE.Vector3(
        Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5
    ).normalize();

    let start, end;

    if (state.lightningOriginCenter) {
        if (state.lightningSolidBlock) {
            // Bolts erupt from polyhedra surface outward
            start = origin.clone().add(dir.clone().multiplyScalar(boundingRadius));
            end = origin.clone().add(dir.clone().multiplyScalar(boundingRadius + actualLength));
        } else {
            // Bolts from near center outward
            start = origin.clone().add(
                new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).multiplyScalar(0.2)
            );
            end = origin.clone().add(dir.clone().multiplyScalar(actualLength));
        }
    } else {
        if (state.lightningSolidBlock) {
            // Bolts strike inward but stop at polyhedra surface
            start = origin.clone().add(dir.clone().multiplyScalar(boundingRadius + actualLength));
            end = origin.clone().add(dir.clone().multiplyScalar(boundingRadius));
        } else {
            // Bolts from outside toward center
            start = origin.clone().add(dir.clone().multiplyScalar(actualLength + boundingRadius));
            end = origin.clone().add(
                new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).multiplyScalar(0.2)
            );
        }
    }

    state.lightningStrikes.push(new Lightning(start, end));
}

// --- Public API ---

export function createLightning() {
    // No setup needed -- bolts are spawned dynamically in animateLightning
}

export function animateLightning(dt) {
    if (!state.isLightningEnabled || state.isDestroyed) {
        // Clean up any active bolts when disabled
        if (state.lightningStrikes.length > 0) {
            state.lightningStrikes.forEach(b => b.dispose());
            state.lightningStrikes = [];
        }
        return;
    }

    // Spawn timer
    state.lightningTimer -= dt;
    if (state.lightningTimer <= 0) {
        spawnBolt();
        state.lightningTimer = (6.0 - state.lightningFrequency) + Math.random() * 2;
    }

    // Update active bolts
    for (let i = state.lightningStrikes.length - 1; i >= 0; i--) {
        if (!state.lightningStrikes[i].update(dt)) {
            state.lightningStrikes.splice(i, 1);
        }
    }
}

export function updateLightningColors() {
    // Bolts are short-lived and pick up colors at spawn time; nothing to update.
}
