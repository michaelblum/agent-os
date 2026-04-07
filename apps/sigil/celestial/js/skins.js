// Skin manager — procedural surface material system
// Creates ShaderMaterial from uber-shader, manages color ramp textures

import state from './state.js';
import { skinVertexShader, skinFragmentShader } from './shaders/skin-shaders.js';

const SKIN_TYPE_MAP = {
    'rocky': 0,
    'gas-giant': 1,
    'ice': 2,
    'volcanic': 3,
    'solar': 4
};

/** Create a 256x1 DataTexture interpolating between two hex colors */
export function createColorRampTexture(hex1, hex2) {
    const data = new Uint8Array(256 * 4);
    const c1 = new THREE.Color(hex1);
    const c2 = new THREE.Color(hex2);
    const tmp = new THREE.Color();

    for (let i = 0; i < 256; i++) {
        const t = i / 255;
        tmp.copy(c1).lerp(c2, t);
        data[i * 4 + 0] = Math.round(tmp.r * 255);
        data[i * 4 + 1] = Math.round(tmp.g * 255);
        data[i * 4 + 2] = Math.round(tmp.b * 255);
        data[i * 4 + 3] = 255;
    }

    const tex = new THREE.DataTexture(data, 256, 1, THREE.RGBAFormat);
    tex.minFilter = THREE.LinearFilter;
    tex.magFilter = THREE.LinearFilter;
    tex.needsUpdate = true;
    return tex;
}

/** Update an existing color ramp DataTexture in-place from face colors */
export function updateSkinColorRamp(isOmega) {
    const ramp = isOmega ? state.omegaSkinColorRamp : state.skinColorRamp;
    if (!ramp) return;

    const colors = isOmega ? state.colors.omegaFace : state.colors.face;
    const c1 = new THREE.Color(colors[0]);
    const c2 = new THREE.Color(colors[1]);
    const tmp = new THREE.Color();
    const data = ramp.image.data;

    for (let i = 0; i < 256; i++) {
        const t = i / 255;
        tmp.copy(c1).lerp(c2, t);
        data[i * 4 + 0] = Math.round(tmp.r * 255);
        data[i * 4 + 1] = Math.round(tmp.g * 255);
        data[i * 4 + 2] = Math.round(tmp.b * 255);
    }
    ramp.needsUpdate = true;
}

/** Create a ShaderMaterial for the given skin name */
function createSkinMaterial(skinName, faceColors, opacity, isSpecular) {
    const skinType = SKIN_TYPE_MAP[skinName];
    if (skinType === undefined) return null;

    const colorRamp = createColorRampTexture(faceColors[0], faceColors[1]);

    const material = new THREE.ShaderMaterial({
        uniforms: {
            time: { value: 0.0 },
            noiseScale: { value: 3.0 },
            noiseOctaves: { value: 4 },
            roughness: { value: 0.3 },
            colorRamp: { value: colorRamp },
            skinType: { value: skinType },
            lightPosition: { value: new THREE.Vector3(5, 5, 5) },
            uOpacity: { value: opacity },
            uSpecular: { value: isSpecular ? 1.0 : 0.0 }
        },
        vertexShader: skinVertexShader,
        fragmentShader: skinFragmentShader,
        transparent: opacity < 0.99,
        depthWrite: opacity >= 0.99,
        side: opacity >= 0.99 ? THREE.FrontSide : THREE.DoubleSide,
        polygonOffset: true,
        polygonOffsetFactor: 1,
        polygonOffsetUnits: 1
    });

    return { material, colorRamp };
}

/** Apply or remove a skin on the main or omega shape */
export function applySkin(skinName, isOmega) {
    const mesh = isOmega ? state.omegaCoreMesh : state.coreMesh;
    if (!mesh) return;

    // Store the skin name
    if (isOmega) {
        state.omegaSkin = skinName;
    } else {
        state.currentSkin = skinName;
    }

    if (skinName === 'none') {
        // Revert to MeshPhongMaterial
        const oldMat = isOmega ? state.omegaSkinMaterial : state.skinMaterial;
        const oldRamp = isOmega ? state.omegaSkinColorRamp : state.skinColorRamp;
        if (oldMat) oldMat.dispose();
        if (oldRamp) oldRamp.dispose();

        if (isOmega) {
            state.omegaSkinMaterial = null;
            state.omegaSkinColorRamp = null;
        } else {
            state.skinMaterial = null;
            state.skinColorRamp = null;
        }

        // Rebuild MeshPhongMaterial
        const opacity = isOmega ? state.omegaOpacity : state.currentOpacity;
        const specEnabled = isOmega ? state.omegaIsSpecularEnabled : state.isSpecularEnabled;
        const isSolid = opacity >= 0.99;
        const newMat = new THREE.MeshPhongMaterial({
            transparent: !isSolid,
            opacity: opacity,
            shininess: specEnabled ? 80 : 0,
            specular: specEnabled ? new THREE.Color(0x333333) : new THREE.Color(0x000000),
            side: isSolid ? THREE.FrontSide : THREE.DoubleSide,
            depthWrite: isSolid,
            polygonOffset: true,
            polygonOffsetFactor: 1,
            polygonOffsetUnits: 1
        });
        mesh.material = newMat;
        return;
    }

    // Apply shader skin
    const opacity = isOmega ? state.omegaOpacity : state.currentOpacity;
    const specEnabled = isOmega ? state.omegaIsSpecularEnabled : state.isSpecularEnabled;
    const faceColors = isOmega ? state.colors.omegaFace : state.colors.face;

    const result = createSkinMaterial(skinName, faceColors, opacity, specEnabled);
    if (!result) return;

    // Dispose old material
    const oldMat = mesh.material;
    if (oldMat) oldMat.dispose();
    const oldRamp = isOmega ? state.omegaSkinColorRamp : state.skinColorRamp;
    if (oldRamp) oldRamp.dispose();

    mesh.material = result.material;

    if (isOmega) {
        state.omegaSkinMaterial = result.material;
        state.omegaSkinColorRamp = result.colorRamp;
    } else {
        state.skinMaterial = result.material;
        state.skinColorRamp = result.colorRamp;
    }
}

/** Update time and light uniforms each frame */
export function animateSkins(dt) {
    [state.skinMaterial, state.omegaSkinMaterial].forEach(mat => {
        if (!mat) return;
        mat.uniforms.time.value += dt;
        // Light position is the directional light at (5,5,5) world space
        mat.uniforms.lightPosition.value.set(5, 5, 5);
    });
}
