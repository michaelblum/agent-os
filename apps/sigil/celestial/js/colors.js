import state from './state.js';
import { updateLightningColors } from './lightning.js';
import { updateMagneticColors } from './magnetic.js';
import { updateOmegaColors } from './omega.js';
import { updateSkinColorRamp } from './skins.js';

export function hexToRgba(hex, alpha) {
    let c;
    if (/^#([A-Fa-f0-9]{3}){1,2}$/.test(hex)) {
        c = hex.substring(1).split('');
        if (c.length === 3) {
            c = [c[0], c[0], c[1], c[1], c[2], c[2]];
        }
        c = '0x' + c.join('');
        return 'rgba(' + [(c >> 16) & 255, (c >> 8) & 255, c & 255].join(',') + ',' + alpha + ')';
    }
    return `rgba(255,255,255,${alpha})`;
}

export function updateMaterialTexture(material, canvasDrawer) {
    const canvas = document.createElement('canvas');
    canvasDrawer(canvas, canvas.getContext('2d'));
    const newTexture = new THREE.CanvasTexture(canvas);
    if (material.map) material.map.dispose();
    material.map = newTexture;
    material.color.setHex(0xffffff);
    material.needsUpdate = true;
    return newTexture;
}

export function drawAuraTexture(canvas, ctx, c1, c2, isCore) {
    canvas.width = 128; canvas.height = 128;
    const grad = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
    if (isCore) {
        grad.addColorStop(0, hexToRgba(c1, 1.0));
        grad.addColorStop(0.5, hexToRgba(c2, 0.4));
        grad.addColorStop(1, 'rgba(0,0,0,0)');
    } else {
        grad.addColorStop(0, hexToRgba(c1, 0.8));
        grad.addColorStop(0.5, hexToRgba(c2, 0.2));
        grad.addColorStop(1, 'rgba(0,0,0,0)');
    }
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 128, 128);
}

export function drawPulsarTexture(canvas, ctx, c1, c2) {
    canvas.width = 16; canvas.height = 256;
    const grad = ctx.createLinearGradient(0, 0, 0, 256);
    grad.addColorStop(0, hexToRgba(c2, 0));
    grad.addColorStop(0.5, hexToRgba(c1, 1));
    grad.addColorStop(1, hexToRgba(c2, 0));
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 16, 256);
}

export function drawGammaTexture(canvas, ctx, c1, c2) {
    canvas.width = 16; canvas.height = 256;
    const grad = ctx.createLinearGradient(0, 0, 0, 256);
    grad.addColorStop(0, hexToRgba(c2, 0));
    grad.addColorStop(0.3, hexToRgba(c2, 0.05));
    grad.addColorStop(0.5, hexToRgba(c1, 1));
    grad.addColorStop(0.7, hexToRgba(c2, 0.05));
    grad.addColorStop(1, hexToRgba(c2, 0));
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 16, 256);
}

export function drawAccretionTexture(canvas, ctx, c1, c2) {
    canvas.width = 512; canvas.height = 512;
    const grad = ctx.createRadialGradient(256, 256, 0, 256, 256, 256);
    grad.addColorStop(0, hexToRgba(c1, 1));
    grad.addColorStop(0.75, hexToRgba(c2, 1));
    grad.addColorStop(1, hexToRgba(c2, 0));
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 512, 512);
}

export function drawWhiteDwarf(canvas, ctx) {
    canvas.width = 128; canvas.height = 128;
    const grad = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
    grad.addColorStop(0, 'rgba(255, 255, 255, 1.0)');
    grad.addColorStop(0.2, 'rgba(255, 255, 255, 1.0)');
    grad.addColorStop(0.5, 'rgba(255, 255, 255, 0.4)');
    grad.addColorStop(1, 'rgba(255, 255, 255, 0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 128, 128);
}

export function updateFaceVertexColors() {
    if (!state.coreMesh) return;
    if (state.currentSkin !== 'none' && state.skinMaterial) { updateSkinColorRamp(false); return; }
    const geo = state.coreMesh.geometry;
    const count = geo.attributes.position.count;
    if (!geo.attributes.color || geo.attributes.color.count !== count) {
        geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(count * 3), 3));
    }
    const col = geo.attributes.color;
    geo.computeBoundingBox();
    const min = geo.boundingBox.min.y;
    const range = (geo.boundingBox.max.y - min) || 1;
    const c1 = new THREE.Color(state.colors.face[0]);
    const c2 = new THREE.Color(state.colors.face[1]);
    const tC = new THREE.Color();
    for (let i = 0; i < count; i++) {
        tC.copy(c1).lerp(c2, (geo.attributes.position.getY(i) - min) / range);
        col.setXYZ(i, tC.r, tC.g, tC.b);
    }
    col.needsUpdate = true;
    state.coreMesh.material.vertexColors = true;
    state.coreMesh.material.color.setHex(0xffffff);
    if (state.coreMesh.material.map) { state.coreMesh.material.map.dispose(); state.coreMesh.material.map = null; }
    state.coreMesh.material.needsUpdate = true;
}

export function updateEdgeVertexColors() {
    if (!state.wireframeMesh) return;
    const geo = state.wireframeMesh.geometry;
    const count = geo.attributes.position.count;
    if (!geo.attributes.color || geo.attributes.color.count !== count) {
        geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(count * 3), 3));
    }
    const col = geo.attributes.color;
    geo.computeBoundingBox();
    const min = geo.boundingBox.min.y;
    const range = (geo.boundingBox.max.y - min) || 1;
    const c1 = new THREE.Color(state.colors.edge[0]);
    const c2 = new THREE.Color(state.colors.edge[1]);
    const tC = new THREE.Color();
    for (let i = 0; i < count; i++) {
        tC.copy(c1).lerp(c2, (geo.attributes.position.getY(i) - min) / range);
        col.setXYZ(i, tC.r, tC.g, tC.b);
    }
    col.needsUpdate = true;
    state.wireframeMesh.material.vertexColors = true;
    state.wireframeMesh.material.color.setHex(0xffffff);
    state.wireframeMesh.material.needsUpdate = true;
}

export function updateAllColors() {
    updateFaceVertexColors();
    updateEdgeVertexColors();

    // Update grid colors
    if (state.gridHelper && state.gridHelper.visible) {
        const pos = state.gridHelper.geometry.attributes.basePosition;
        const col = state.gridHelper.geometry.attributes.color;
        const c1 = new THREE.Color(state.colors.grid[0]);
        const c2 = new THREE.Color(state.colors.grid[1]);
        const tC = new THREE.Color();
        for (let i = 0; i < pos.count; i++) {
            let dist = Math.sqrt(Math.pow(pos.getX(i), 2) + Math.pow(pos.getY(i), 2));
            tC.copy(c1).lerp(c2, Math.min(dist / 50.0, 1.0));
            col.setXYZ(i, tC.r, tC.g, tC.b);
        }
        col.needsUpdate = true;
    }

    // Point light
    state.pointLight.color.copy(
        new THREE.Color(state.colors.face[0]).lerp(new THREE.Color(state.colors.face[1]), 0.5)
    );

    // Path line
    if (state.pathLine) state.pathLine.material.color.copy(new THREE.Color(state.colors.edge[0]));

    // Aura textures
    updateMaterialTexture(state.glowSprite.material, (canv, ctx) =>
        drawAuraTexture(canv, ctx, state.colors.aura[0], state.colors.aura[1], false));
    let coreTex = updateMaterialTexture(state.coreSprite.material, (canv, ctx) =>
        drawAuraTexture(canv, ctx, state.colors.aura[0], state.colors.aura[1], true));
    updateMaterialTexture(state.chargeSpheroid.material, (canv, ctx) =>
        drawAuraTexture(canv, ctx, '#ffffff', state.colors.aura[0], true));

    // Trail sprites share the core texture
    state.trailSprites.forEach(s => s.material.map = coreTex);

    // Phenomena textures
    updateMaterialTexture(state.beamMat, (canv, ctx) =>
        drawPulsarTexture(canv, ctx, state.colors.pulsar[0], state.colors.pulsar[1]));
    updateMaterialTexture(state.gammaBeamMat, (canv, ctx) =>
        drawGammaTexture(canv, ctx, state.colors.gamma[0], state.colors.gamma[1]));
    updateMaterialTexture(state.diskMat, (canv, ctx) =>
        drawAccretionTexture(canv, ctx, state.colors.accretion[0], state.colors.accretion[1]));
    updateMaterialTexture(state.neutrinoMat, (canv, ctx) =>
        drawAuraTexture(canv, ctx, state.colors.neutrino[0], state.colors.neutrino[1], true));

    // Lightning, magnetic, omega colors
    updateLightningColors();
    updateMagneticColors();
    updateOmegaColors();
}
