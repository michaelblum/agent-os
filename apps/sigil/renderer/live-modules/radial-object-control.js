export const SIGIL_OBJECT_CONTROL_SCHEMA_VERSION = '2026-05-03';
export const SIGIL_OBJECT_CONTROL_CANVAS_ID = 'avatar-main';
export const CONTEXT_MENU_RADIAL_ITEM_ID = 'context-menu';
export const AGENT_TERMINAL_RADIAL_ITEM_ID = 'agent-terminal';
export const WIKI_BRAIN_RADIAL_ITEM_ID = 'wiki-graph';
export const CONTEXT_MENU_MODEL_OBJECT_ID = 'radial.context-menu.model';
export const AGENT_TERMINAL_MODEL_OBJECT_ID = 'radial.agent-terminal.model';
export const AGENT_TERMINAL_SCREEN_OBJECT_ID = 'radial.agent-terminal.part.screen';
export const WIKI_BRAIN_SHELL_OBJECT_ID = 'radial.wiki-brain.shell';
export const WIKI_BRAIN_TREE_OBJECT_ID = 'radial.wiki-brain.tree';
export const WIKI_BRAIN_FIBER_OBJECT_ID = WIKI_BRAIN_TREE_OBJECT_ID;
export const WIKI_BRAIN_FIBER_STEM_OBJECT_ID = 'radial.wiki-brain.fiber-stem';
export const WIKI_BRAIN_FIBER_BLOOM_OBJECT_ID = 'radial.wiki-brain.fiber-bloom';
export const WIKI_BRAIN_FRACTAL_TREE_OBJECT_ID = 'radial.wiki-brain.fractal-tree';

export const DEFAULT_RADIAL_ITEM_MODEL_TRANSFORM = {
    position: { x: 0, y: 0, z: 0 },
    scale: { x: 1, y: 1, z: 1 },
    rotationDegrees: { x: 0, y: 0, z: 0 },
};

export const DEFAULT_NESTED_TREE_EFFECT = {
    kind: 'nested-neural-tree',
    holdExitDirection: 'outward',
    shellTransform: {
        position: { x: 0, y: 0, z: 0 },
        scale: { x: 1, y: 1, z: 1 },
        rotationDegrees: { x: 0, y: 0, z: 0 },
    },
    fiberStemTransform: {
        position: { x: 0.019, y: -0.017, z: -0.004 },
        scale: { x: 0.94, y: 1.94, z: 1.05 },
        rotationDegrees: { x: -7.5, y: -19, z: -23 },
    },
    fiberBloomTransform: {
        position: { x: 0, y: 0.033, z: 0 },
        scale: { x: 1.79, y: 1.22, z: 1.68 },
        rotationDegrees: { x: 0, y: 0, z: 0 },
    },
    fractalTreeTransform: {
        position: { x: 0.02, y: -0.054, z: -0.006 },
        scale: { x: 1.85, y: 2.65, z: 2.61 },
        rotationDegrees: { x: -8, y: 86, z: 8 },
    },
    shellOpacity: {
        rest: 0.75,
        active: 0.26,
        held: 0.75,
    },
    fractalPulse: {
        intensity: 1,
        dotSizePx: 5,
        trailLength: 0.72,
        tailSteps: [0, 0.07, 0.14, 0.21, 0.28, 0.35],
        tailAlphas: [1, 0.82, 0.58, 0.34, 0.18, 0.08],
        maxSparks: 300,
        baseFrequency: 1,
        frequency: 14,
        baseConcurrent: 1,
        concurrent: 19,
        minSpeed: 0.9,
        speedJitter: 1.5,
        rootRatio: 0.8,
    },
    visibility: {
        shell: true,
        fiberStem: true,
        fiberBloom: true,
        fractalTree: true,
    },
};

const CONTRACT_UNITS = {
    position: 'scene',
    scale: 'multiplier',
    rotation: 'degrees',
};

function text(value, fallback = '') {
    const normalized = String(value ?? '').replace(/\s+/g, ' ').trim();
    return normalized || fallback;
}

function finite(value, fallback) {
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
}

export function vectorValue(value = {}, fallback = {}) {
    if (Number.isFinite(Number(value))) {
        const n = Number(value);
        return { x: n, y: n, z: n };
    }
    if (Array.isArray(value)) {
        return {
            x: finite(value[0], fallback.x ?? 0),
            y: finite(value[1], fallback.y ?? 0),
            z: finite(value[2], fallback.z ?? 0),
        };
    }
    return {
        x: finite(value.x, fallback.x ?? 0),
        y: finite(value.y, fallback.y ?? 0),
        z: finite(value.z, fallback.z ?? 0),
    };
}

export function vectorAngles(value = {}, fallback = {}) {
    if (Array.isArray(value)) {
        return {
            x: finite(value[0], fallback.x ?? 0),
            y: finite(value[1], fallback.y ?? 0),
            z: finite(value[2], fallback.z ?? 0),
        };
    }
    return {
        x: finite(value.x, fallback.x ?? 0),
        y: finite(value.y, fallback.y ?? 0),
        z: finite(value.z, fallback.z ?? 0),
    };
}

export function resolveNestedShellTransform(effect = {}) {
    const transform = effect.shellTransform || {};
    const defaults = DEFAULT_NESTED_TREE_EFFECT.shellTransform;
    return {
        position: vectorValue(transform.position, defaults.position),
        scale: vectorValue(transform.scale, defaults.scale),
        rotationDegrees: vectorAngles(transform.rotationDegrees ?? transform.rotation, defaults.rotationDegrees),
    };
}

export function resolveNestedFiberStemTransform(effect = {}) {
    const transform = effect.fiberStemTransform || effect.treeTransform || {};
    const defaults = DEFAULT_NESTED_TREE_EFFECT.fiberStemTransform;
    return {
        position: vectorValue(transform.position, defaults.position),
        scale: vectorValue(transform.scale, defaults.scale),
        rotationDegrees: vectorAngles(transform.rotationDegrees ?? transform.rotation, defaults.rotationDegrees),
    };
}

export function resolveNestedFiberBloomTransform(effect = {}) {
    const transform = effect.fiberBloomTransform || effect.treeTransform || {};
    const defaults = DEFAULT_NESTED_TREE_EFFECT.fiberBloomTransform;
    return {
        position: vectorValue(transform.position, defaults.position),
        scale: vectorValue(transform.scale, defaults.scale),
        rotationDegrees: vectorAngles(transform.rotationDegrees ?? transform.rotation, defaults.rotationDegrees),
    };
}

export function resolveNestedTreeTransform(effect = {}) {
    return resolveNestedFiberBloomTransform(effect);
}

export function resolveNestedFractalTreeTransform(effect = {}) {
    const transform = effect.fractalTreeTransform || {};
    const defaults = DEFAULT_NESTED_TREE_EFFECT.fractalTreeTransform;
    return {
        position: vectorValue(transform.position, defaults.position),
        scale: vectorValue(transform.scale, defaults.scale),
        rotationDegrees: vectorAngles(transform.rotationDegrees ?? transform.rotation, defaults.rotationDegrees),
    };
}

function finiteRange(value, fallback, min, max) {
    const n = finite(value, fallback);
    return Math.max(min, Math.min(max, n));
}

function finiteList(value, fallback = []) {
    const source = Array.isArray(value) ? value : fallback;
    const next = source
        .map((entry) => Number(entry))
        .filter((entry) => Number.isFinite(entry));
    return next.length > 0 ? next : [...fallback];
}

export function resolveNestedFractalPulse(effect = {}) {
    const pulse = effect.fractalPulse || {};
    const defaults = DEFAULT_NESTED_TREE_EFFECT.fractalPulse;
    return {
        intensity: finiteRange(pulse.intensity, defaults.intensity, 0, 3),
        dotSizePx: finiteRange(pulse.dotSizePx, defaults.dotSizePx, 0.5, 8),
        trailLength: finiteRange(pulse.trailLength, defaults.trailLength, 0.05, 3),
        tailSteps: finiteList(pulse.tailSteps, defaults.tailSteps),
        tailAlphas: finiteList(pulse.tailAlphas, defaults.tailAlphas),
        maxSparks: Math.round(finiteRange(pulse.maxSparks, defaults.maxSparks, 1, 2000)),
        baseFrequency: finiteRange(pulse.baseFrequency, defaults.baseFrequency, 0, 60),
        frequency: finiteRange(pulse.frequency, defaults.frequency, 0, 80),
        baseConcurrent: Math.round(finiteRange(pulse.baseConcurrent, defaults.baseConcurrent, 0, 100)),
        concurrent: Math.round(finiteRange(pulse.concurrent, defaults.concurrent, 0, 200)),
        minSpeed: finiteRange(pulse.minSpeed, defaults.minSpeed, 0.05, 10),
        speedJitter: finiteRange(pulse.speedJitter, defaults.speedJitter, 0, 10),
        rootRatio: finiteRange(pulse.rootRatio, defaults.rootRatio, 0, 1),
    };
}

export function resolveNestedVisibility(effect = {}) {
    const visibility = effect.visibility || {};
    const defaults = DEFAULT_NESTED_TREE_EFFECT.visibility;
    return {
        shell: visibility.shell === undefined ? defaults.shell : !!visibility.shell,
        fiberStem: visibility.fiberStem === undefined
            ? (visibility.tree === undefined ? defaults.fiberStem : !!visibility.tree)
            : !!visibility.fiberStem,
        fiberBloom: visibility.fiberBloom === undefined
            ? (visibility.tree === undefined ? defaults.fiberBloom : !!visibility.tree)
            : !!visibility.fiberBloom,
        fractalTree: visibility.fractalTree === undefined ? defaults.fractalTree : !!visibility.fractalTree,
    };
}

export function contractTransformFromEffect(transform = {}) {
    return {
        position: vectorValue(transform.position, { x: 0, y: 0, z: 0 }),
        scale: vectorValue(transform.scale, { x: 1, y: 1, z: 1 }),
        rotation_degrees: vectorAngles(transform.rotationDegrees ?? transform.rotation_degrees, { x: 0, y: 0, z: 0 }),
    };
}

function effectTransformFromContract(transform = {}) {
    return {
        position: vectorValue(transform.position, { x: 0, y: 0, z: 0 }),
        scale: vectorValue(transform.scale, { x: 1, y: 1, z: 1 }),
        rotationDegrees: vectorAngles(transform.rotation_degrees ?? transform.rotationDegrees, { x: 0, y: 0, z: 0 }),
    };
}

function mergeTriplet(base = {}, patch = {}) {
    const next = { ...base };
    let changed = false;
    for (const axis of ['x', 'y', 'z']) {
        if (patch[axis] === undefined || patch[axis] === '') continue;
        const n = Number(patch[axis]);
        if (!Number.isFinite(n)) continue;
        next[axis] = n;
        changed = true;
    }
    return { next, changed };
}

function mergeTransformPatch(base = {}, patch = {}) {
    const current = effectTransformFromContract(base);
    let changed = false;
    const next = {
        position: { ...current.position },
        scale: { ...current.scale },
        rotationDegrees: { ...current.rotationDegrees },
    };

    if (patch.position && typeof patch.position === 'object') {
        const merged = mergeTriplet(next.position, patch.position);
        next.position = merged.next;
        changed = changed || merged.changed;
    }
    if (patch.scale && typeof patch.scale === 'object') {
        const merged = mergeTriplet(next.scale, patch.scale);
        next.scale = merged.next;
        changed = changed || merged.changed;
    }
    if (patch.rotation_degrees && typeof patch.rotation_degrees === 'object') {
        const merged = mergeTriplet(next.rotationDegrees, patch.rotation_degrees);
        next.rotationDegrees = merged.next;
        changed = changed || merged.changed;
    }

    return { transform: next, changed };
}

function geometryKind(item = {}) {
    return typeof item.geometry?.type === 'string' ? item.geometry.type.toLowerCase() : null;
}

function isNative3dRadialItem(item = {}) {
    const kind = geometryKind(item);
    return kind === 'gltf' || kind === 'glb';
}

function ensureGeometry(item = {}) {
    if (!item.geometry || typeof item.geometry !== 'object' || Array.isArray(item.geometry)) {
        item.geometry = {};
    }
    return item.geometry;
}

function modelObjectIdForItem(item = {}) {
    if (item.id === CONTEXT_MENU_RADIAL_ITEM_ID) return CONTEXT_MENU_MODEL_OBJECT_ID;
    if (item.id === AGENT_TERMINAL_RADIAL_ITEM_ID) return AGENT_TERMINAL_MODEL_OBJECT_ID;
    return item.id ? `radial.${item.id}.model` : null;
}

function partObjectIdForItem(item = {}, part = {}) {
    const itemId = text(item.id, 'radial-item').replace(/[^a-zA-Z0-9_-]/g, '-');
    const partId = text(part.id, 'part').replace(/[^a-zA-Z0-9_-]/g, '-');
    return `radial.${itemId}.part.${partId}`;
}

function modelNameForItem(item = {}) {
    const label = text(item.label || item.geometry?.title || item.id, 'Radial Item');
    return `${label} Model`;
}

function partNameForItem(item = {}, part = {}) {
    return text(part.name || part.label, `${modelNameForItem(item)} Part`);
}

export function resolveRadialItemModelTransform(item = {}) {
    const transform = item.geometry?.modelTransform || {};
    const defaults = DEFAULT_RADIAL_ITEM_MODEL_TRANSFORM;
    return {
        position: vectorValue(transform.position, defaults.position),
        scale: vectorValue(transform.scale, defaults.scale),
        rotationDegrees: vectorAngles(transform.rotationDegrees ?? transform.rotation, defaults.rotationDegrees),
    };
}

export function resolveRadialItemModelVisibility(item = {}) {
    const visibility = item.geometry?.visibility || {};
    if (visibility.model !== undefined) return !!visibility.model;
    if (item.geometry?.modelVisible !== undefined) return !!item.geometry.modelVisible;
    return true;
}

export function radialItemParts(item = {}) {
    return Array.isArray(item.geometry?.parts)
        ? item.geometry.parts.filter((part) => part?.id)
        : [];
}

export function resolveRadialItemPartTransform(part = {}) {
    const transform = part.transform || {};
    return {
        position: vectorValue(transform.position, { x: 0, y: 0, z: 0 }),
        scale: vectorValue(transform.scale, { x: 1, y: 1, z: 1 }),
        rotationDegrees: vectorAngles(transform.rotationDegrees ?? transform.rotation, { x: 0, y: 0, z: 0 }),
    };
}

export function resolveRadialItemPartVisibility(part = {}) {
    return part.visible === undefined ? true : !!part.visible;
}

function findRadialItem(radialGestureMenu = {}, predicate = () => false) {
    const items = Array.isArray(radialGestureMenu?.items) ? radialGestureMenu.items : [];
    return items.find(predicate) || null;
}

export function findWikiBrainRadialItem(radialGestureMenu = {}) {
    return findRadialItem(radialGestureMenu, (item) => item?.id === WIKI_BRAIN_RADIAL_ITEM_ID);
}

function wikiBrainEffect(item = {}) {
    const effect = item?.geometry?.radialEffect;
    if (!effect || typeof effect !== 'object') return null;
    if (effect.kind !== DEFAULT_NESTED_TREE_EFFECT.kind) return null;
    return effect;
}

export function resolveWikiBrainEffect(item = {}) {
    const effect = wikiBrainEffect(item);
    if (!effect) return null;
    return {
        ...DEFAULT_NESTED_TREE_EFFECT,
        ...effect,
        shellOpacity: {
            ...DEFAULT_NESTED_TREE_EFFECT.shellOpacity,
            ...(effect.shellOpacity || {}),
        },
        fractalPulse: resolveNestedFractalPulse(effect),
        visibility: resolveNestedVisibility(effect),
        shellTransform: resolveNestedShellTransform(effect),
        fiberStemTransform: resolveNestedFiberStemTransform(effect),
        fiberBloomTransform: resolveNestedFiberBloomTransform(effect),
        fractalTreeTransform: resolveNestedFractalTreeTransform(effect),
    };
}

function registryObject({ objectId, name, transform, visible = true, metadata = {} }) {
    return {
        object_id: objectId,
        name,
        kind: 'three.object3d',
        capabilities: ['transform.read', 'transform.patch', 'visibility.read', 'visibility.patch'],
        transform: contractTransformFromEffect(transform),
        units: CONTRACT_UNITS,
        visible: !!visible,
        metadata,
    };
}

function wikiBrainObjectTargets() {
    return {
        [WIKI_BRAIN_SHELL_OBJECT_ID]: {
            key: 'shellTransform',
            visibilityKey: 'shell',
            resolve: resolveNestedShellTransform,
            name: 'Wiki Brain Shell',
            role: 'shell',
        },
        [WIKI_BRAIN_FIBER_OBJECT_ID]: {
            key: 'fiberBloomTransform',
            visibilityKey: 'fiberBloom',
            resolve: resolveNestedFiberBloomTransform,
            name: 'Wiki Brain Fiber Bloom',
            role: 'fiber-bloom',
        },
        [WIKI_BRAIN_FIBER_STEM_OBJECT_ID]: {
            key: 'fiberStemTransform',
            visibilityKey: 'fiberStem',
            resolve: resolveNestedFiberStemTransform,
            name: 'Wiki Brain Fiber Stem',
            role: 'fiber-stem',
        },
        [WIKI_BRAIN_FIBER_BLOOM_OBJECT_ID]: {
            key: 'fiberBloomTransform',
            visibilityKey: 'fiberBloom',
            resolve: resolveNestedFiberBloomTransform,
            name: 'Wiki Brain Fiber Bloom',
            role: 'fiber-bloom',
        },
        [WIKI_BRAIN_FRACTAL_TREE_OBJECT_ID]: {
            key: 'fractalTreeTransform',
            visibilityKey: 'fractalTree',
            resolve: resolveNestedFractalTreeTransform,
            name: 'Wiki Brain Fractal Tree',
            role: 'fractal-tree',
        },
    };
}

function buildWikiBrainRegistryObjects(radialGestureMenu = {}, { includeItemMetadata = false } = {}) {
    const item = findWikiBrainRadialItem(radialGestureMenu);
    const effect = resolveWikiBrainEffect(item);
    if (!effect) return [];
    const objectSpecs = [
        WIKI_BRAIN_SHELL_OBJECT_ID,
        WIKI_BRAIN_FIBER_STEM_OBJECT_ID,
        WIKI_BRAIN_FIBER_BLOOM_OBJECT_ID,
        WIKI_BRAIN_FRACTAL_TREE_OBJECT_ID,
    ];
    const targets = wikiBrainObjectTargets();
    return objectSpecs.map((objectId) => {
        const target = targets[objectId];
        return registryObject({
            objectId,
            name: target.name,
            transform: target.resolve(effect),
            visible: effect.visibility[target.visibilityKey],
            metadata: {
                role: target.role,
                ...(includeItemMetadata ? {
                    item_id: item.id,
                    item_label: item.label || item.id,
                    editor: '3d-radial-item',
                } : {}),
            },
        });
    });
}

export function buildWikiBrainObjectRegistry(radialGestureMenu = {}, options = {}) {
    const canvasId = text(options.canvasId, SIGIL_OBJECT_CONTROL_CANVAS_ID);
    return {
        type: 'canvas_object.registry',
        schema_version: SIGIL_OBJECT_CONTROL_SCHEMA_VERSION,
        canvas_id: canvasId,
        objects: buildWikiBrainRegistryObjects(radialGestureMenu),
    };
}

export function buildRadialMenuObjectRegistry(radialGestureMenu = {}, options = {}) {
    const canvasId = text(options.canvasId, SIGIL_OBJECT_CONTROL_CANVAS_ID);
    const items = Array.isArray(radialGestureMenu?.items) ? radialGestureMenu.items : [];
    const objects = [];

    for (const item of items) {
        if (!item?.id) continue;
        if (item.id === WIKI_BRAIN_RADIAL_ITEM_ID && resolveWikiBrainEffect(item)) {
            objects.push(...buildWikiBrainRegistryObjects(radialGestureMenu, {
                includeItemMetadata: true,
            }));
            continue;
        }
        if (!isNative3dRadialItem(item)) continue;
        const objectId = modelObjectIdForItem(item);
        if (!objectId) continue;
        objects.push(registryObject({
            objectId,
            name: modelNameForItem(item),
            transform: resolveRadialItemModelTransform(item),
            visible: resolveRadialItemModelVisibility(item),
            metadata: {
                role: 'model',
                item_id: item.id,
                item_label: item.label || item.id,
                target: 'model-host',
                editor: '3d-radial-item',
            },
        }));
        for (const part of radialItemParts(item)) {
            objects.push(registryObject({
                objectId: partObjectIdForItem(item, part),
                name: partNameForItem(item, part),
                transform: resolveRadialItemPartTransform(part),
                visible: resolveRadialItemPartVisibility(part),
                metadata: {
                    role: 'model-part',
                    item_id: item.id,
                    item_label: item.label || item.id,
                    part_id: part.id,
                    part_kind: part.kind || 'object3d',
                    target: 'model-part',
                    editor: '3d-radial-item',
                },
            }));
        }
    }

    return {
        type: 'canvas_object.registry',
        schema_version: SIGIL_OBJECT_CONTROL_SCHEMA_VERSION,
        canvas_id: canvasId,
        objects,
    };
}

function resultFor(message, status, fields = {}) {
    return {
        type: 'canvas_object.transform.result',
        schema_version: SIGIL_OBJECT_CONTROL_SCHEMA_VERSION,
        request_id: text(message?.request_id, 'missing-request'),
        target: {
            canvas_id: text(message?.target?.canvas_id, SIGIL_OBJECT_CONTROL_CANVAS_ID),
            object_id: text(message?.target?.object_id, 'unknown'),
        },
        status,
        ...fields,
    };
}

export function applyWikiBrainTransformPatch(radialGestureMenu = {}, message = {}, options = {}) {
    return applyRadialMenuObjectTransformPatch(radialGestureMenu, message, options);
}

export function applyRadialMenuObjectTransformPatch(radialGestureMenu = {}, message = {}, options = {}) {
    const canvasId = text(options.canvasId, SIGIL_OBJECT_CONTROL_CANVAS_ID);
    if (message.type && message.type !== 'canvas_object.transform.patch') {
        return resultFor(message, 'rejected', {
            reason: 'contract_mismatch',
            message: `unexpected message type ${message.type}`,
        });
    }
    if (!message.request_id || !message.target || typeof message.target !== 'object') {
        return resultFor(message, 'rejected', {
            reason: 'contract_mismatch',
            message: 'transform patch requires request_id and target',
        });
    }
    if (message.target.canvas_id !== canvasId) {
        return resultFor(message, 'stale', {
            reason: 'unknown_object',
            message: `target canvas ${message.target.canvas_id} is not ${canvasId}`,
        });
    }

    const objectId = message.target.object_id;
    if (!message.patch || typeof message.patch !== 'object') {
        return resultFor(message, 'rejected', {
            reason: 'invalid_patch',
            message: 'transform patch requires patch object',
        });
    }

    const wikiItem = findWikiBrainRadialItem(radialGestureMenu);
    const wikiEffect = wikiBrainEffect(wikiItem);
    const wikiTarget = wikiItem && wikiEffect ? wikiBrainObjectTargets()[objectId] || null : null;
    if (wikiTarget) {
        return applyWikiBrainObjectPatch({ message, effect: wikiEffect, target: wikiTarget });
    }

    const item = findRadialItem(radialGestureMenu, (entry) => (
        isNative3dRadialItem(entry) && modelObjectIdForItem(entry) === objectId
    ));
    if (item) {
        return applyRadialItemModelObjectPatch({ message, item });
    }

    const partTarget = findRadialItemPartTarget(radialGestureMenu, objectId);
    if (partTarget) {
        return applyRadialItemPartObjectPatch({ message, ...partTarget });
    }

    return resultFor(message, 'rejected', {
        reason: 'unknown_object',
        message: `unknown object ${objectId}`,
    });
}

function findRadialItemPartTarget(radialGestureMenu = {}, objectId = '') {
    const items = Array.isArray(radialGestureMenu?.items) ? radialGestureMenu.items : [];
    for (const item of items) {
        if (!isNative3dRadialItem(item)) continue;
        for (const part of radialItemParts(item)) {
            if (partObjectIdForItem(item, part) === objectId) return { item, part };
        }
    }
    return null;
}

function rejectInvalidVisibilityPatch(message) {
    return resultFor(message, 'rejected', {
        reason: 'invalid_patch',
        message: 'visible patch must be boolean',
    });
}

function rejectEmptyPatch(message) {
    return resultFor(message, 'rejected', {
        reason: 'invalid_patch',
        message: 'patch did not contain numeric transform axes or visibility',
    });
}

function applyWikiBrainObjectPatch({ message, effect, target }) {
    const current = target.resolve(effect);
    const merged = mergeTransformPatch(current, message.patch);
    let visibilityChanged = false;
    let visibility = resolveNestedVisibility(effect);
    if (message.patch.visible !== undefined) {
        if (typeof message.patch.visible !== 'boolean') {
            return rejectInvalidVisibilityPatch(message);
        }
        visibility = {
            ...visibility,
            [target.visibilityKey]: message.patch.visible,
        };
        visibilityChanged = true;
    }
    if (!merged.changed && !visibilityChanged) {
        return rejectEmptyPatch(message);
    }

    if (merged.changed) effect[target.key] = merged.transform;
    if (visibilityChanged) effect.visibility = visibility;
    return resultFor(message, 'applied', {
        transform: contractTransformFromEffect(merged.changed ? merged.transform : current),
        visible: visibility[target.visibilityKey],
    });
}

function applyRadialItemModelObjectPatch({ message, item }) {
    const geometry = ensureGeometry(item);
    const current = resolveRadialItemModelTransform(item);
    const merged = mergeTransformPatch(current, message.patch);
    let visibilityChanged = false;
    let visible = resolveRadialItemModelVisibility(item);

    if (message.patch.visible !== undefined) {
        if (typeof message.patch.visible !== 'boolean') {
            return rejectInvalidVisibilityPatch(message);
        }
        visible = message.patch.visible;
        visibilityChanged = true;
    }
    if (!merged.changed && !visibilityChanged) {
        return rejectEmptyPatch(message);
    }

    if (merged.changed) geometry.modelTransform = merged.transform;
    if (visibilityChanged) {
        geometry.visibility = {
            ...(geometry.visibility || {}),
            model: visible,
        };
    }
    return resultFor(message, 'applied', {
        transform: contractTransformFromEffect(merged.changed ? merged.transform : current),
        visible,
    });
}

function applyRadialItemPartObjectPatch({ message, part }) {
    const current = resolveRadialItemPartTransform(part);
    const merged = mergeTransformPatch(current, message.patch);
    let visibilityChanged = false;
    let visible = resolveRadialItemPartVisibility(part);

    if (message.patch.visible !== undefined) {
        if (typeof message.patch.visible !== 'boolean') {
            return rejectInvalidVisibilityPatch(message);
        }
        visible = message.patch.visible;
        visibilityChanged = true;
    }
    if (!merged.changed && !visibilityChanged) {
        return rejectEmptyPatch(message);
    }

    if (merged.changed) part.transform = merged.transform;
    if (visibilityChanged) part.visible = visible;
    return resultFor(message, 'applied', {
        transform: contractTransformFromEffect(merged.changed ? merged.transform : current),
        visible,
    });
}
