import { addEdges, edgeMaterial, material } from '../item-helpers.js';

function brainLobe(x, y, z, sx, sy, sz, color) {
    const mesh = new THREE.Mesh(new THREE.IcosahedronGeometry(0.13, 0), material(color, 0.76));
    mesh.position.set(x, y, z);
    mesh.scale.set(sx, sy, sz);
    return mesh;
}

export function createWikiGraphGlyph() {
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

export function resolveWikiBrainEffectConfig(item = {}, helpers = {}) {
    const effect = item.geometry?.radialEffect;
    if (!effect || typeof effect !== 'object') return null;
    if (effect.kind !== 'nested-neural-tree') return null;
    const defaults = helpers.DEFAULT_NESTED_TREE_EFFECT || {};
    const merged = {
        ...defaults,
        ...effect,
        shellOpacity: {
            ...defaults.shellOpacity,
            ...(effect.shellOpacity || {}),
        },
    };
    merged.visibility = helpers.resolveNestedVisibility(merged);
    merged.shellTransform = helpers.resolveNestedShellTransform(merged);
    merged.fiberOpticsTransform = helpers.resolveNestedFiberOpticsTransform(merged);
    merged.fiberStemTransform = helpers.resolveNestedFiberStemTransform(merged);
    merged.fiberBloomTransform = helpers.resolveNestedFiberBloomTransform(merged);
    merged.fractalTreeTransform = helpers.resolveNestedFractalTreeTransform(merged);
    merged.fiberPulse = helpers.resolveNestedFiberPulse(merged);
    merged.fractalPulse = helpers.resolveNestedFractalPulse(merged);
    return merged;
}

export function createWikiBrainEffectHost(group, item = {}, helpers = {}) {
    const modelHost = new THREE.Group();
    modelHost.name = `${item.id || 'radial-item'}-model-host`;
    group.userData.modelHost = modelHost;
    group.userData.radialItemModelTransform = helpers.resolveRadialItemModelTransform(item);
    group.userData.radialItemModelVisible = helpers.resolveRadialItemModelVisibility(item);

    const effect = resolveWikiBrainEffectConfig(item, helpers);
    if (!effect) return null;

    const composite = new THREE.Group();
    composite.name = `${item.id || 'radial-item'}-effect-composite`;
    helpers.applyObjectTransform(composite, helpers.resolveRadialItemModelTransform(item), helpers.DEFAULT_RADIAL_ITEM_MODEL_TRANSFORM);
    composite.visible = helpers.resolveRadialItemModelVisibility(item);
    const fiberEffect = helpers.createNestedNeuralTreeEffect();
    fiberEffect.name = `${item.id || 'radial-item'}-fiber-optics`;
    const fiberStemEffect = fiberEffect.userData.stem;
    const fiberBloomEffect = fiberEffect.userData.bloom;
    const fractalTreeEffect = helpers.createFractalBrainTreeEffect(effect.fractalPulse);
    fractalTreeEffect.name = `${item.id || 'radial-item'}-fractal-tree`;
    helpers.applyNestedShellTransform(modelHost, effect.shellTransform);
    helpers.applyObjectTransform(fiberEffect, effect.fiberOpticsTransform, helpers.DEFAULT_RADIAL_ITEM_MODEL_TRANSFORM);
    helpers.applyNestedFiberStemTransform(fiberStemEffect, effect.fiberStemTransform);
    helpers.applyNestedFiberBloomTransform(fiberBloomEffect, effect.fiberBloomTransform);
    helpers.applyNestedFractalTreeTransform(fractalTreeEffect, effect.fractalTreeTransform);
    composite.add(modelHost, fiberEffect, fractalTreeEffect);
    group.add(composite);
    group.userData.radialEffectConfig = effect;
    group.userData.radialEffectComposite = composite;
    group.userData.radialEffectTree = fiberEffect;
    group.userData.radialEffectFiber = fiberEffect;
    group.userData.radialEffectFiberStem = fiberStemEffect;
    group.userData.radialEffectFiberBloom = fiberBloomEffect;
    group.userData.radialEffectFractalTree = fractalTreeEffect;
    syncWikiBrainEffectConfig(group, item, helpers);
    group.userData.radialEffectState = {
        activation: 0,
        treeProgress: 0,
        fractalTreeProgress: 0,
        heldProgress: 0,
        shellOpacity: effect.shellOpacity.rest,
        relation: null,
        holding: false,
    };
    return modelHost;
}

export function syncWikiBrainEffectConfig(glyph, item = {}, helpers = {}) {
    if (!glyph?.userData?.radialEffectTree) return;
    const effect = resolveWikiBrainEffectConfig(item, helpers);
    if (!effect) return;
    glyph.userData.radialEffectConfig = effect;
    glyph.userData.radialItemModelTransform = helpers.resolveRadialItemModelTransform(item);
    glyph.userData.radialItemModelVisible = helpers.resolveRadialItemModelVisibility(item);
    glyph.userData.radialEffectShellTransform = effect.shellTransform;
    glyph.userData.radialEffectFiberOpticsTransform = effect.fiberOpticsTransform;
    glyph.userData.radialEffectFiberStemTransform = effect.fiberStemTransform;
    glyph.userData.radialEffectFiberBloomTransform = effect.fiberBloomTransform;
    glyph.userData.radialEffectFractalTreeTransform = effect.fractalTreeTransform;
    glyph.userData.radialEffectFiberPulse = effect.fiberPulse;
    glyph.userData.radialEffectFractalPulse = effect.fractalPulse;
    glyph.userData.radialEffectVisibility = effect.visibility;
}

export const wikiBrainRadialItemModule = {
    ref: 'sigil.radial.geometry.wiki-brain',
    itemIds: ['wiki-graph'],
    effects: ['sigil.radial.effect.nested-neural-tree'],
    createGlyph: createWikiGraphGlyph,
    createEffectHost: createWikiBrainEffectHost,
    syncEffectConfig: syncWikiBrainEffectConfig,
};
