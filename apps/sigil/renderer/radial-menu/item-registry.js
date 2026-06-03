import { avatarControlsRadialItemModule } from './items/avatar-controls.js';
import { agentTerminalRadialItemModule } from './items/agent-terminal.js';
import { annotationReticleRadialItemModule } from './items/annotation-reticle.js';
import { annotationCameraRadialItemModule } from './items/annotation-camera.js';
import { wikiBrainRadialItemModule } from './items/wiki-brain.js';

export const SIGIL_RADIAL_ITEM_MODULES = Object.freeze([
    avatarControlsRadialItemModule,
    agentTerminalRadialItemModule,
    annotationReticleRadialItemModule,
    annotationCameraRadialItemModule,
    wikiBrainRadialItemModule,
]);

const MODULES_BY_REF = new Map();
const MODULES_BY_ITEM_ID = new Map();

for (const moduleDef of SIGIL_RADIAL_ITEM_MODULES) {
    MODULES_BY_REF.set(moduleDef.ref, moduleDef);
    for (const itemId of moduleDef.itemIds || []) {
        MODULES_BY_ITEM_ID.set(itemId, moduleDef);
    }
}

export function resolveSigilRadialItemModule(item = {}) {
    const ref = item.geometry?.module_ref || item.module_ref || null;
    return MODULES_BY_REF.get(ref) || MODULES_BY_ITEM_ID.get(item.id) || null;
}

export function resolveSigilRadialItemEffectRefs(item = {}) {
    const refs = new Set();
    const moduleDef = resolveSigilRadialItemModule(item);
    for (const ref of moduleDef?.effects || []) refs.add(ref);
    for (const effect of item.effects || []) {
        if (effect?.ref) refs.add(effect.ref);
    }
    if (item.geometry?.radialEffect?.ref) refs.add(item.geometry.radialEffect.ref);
    return [...refs];
}
