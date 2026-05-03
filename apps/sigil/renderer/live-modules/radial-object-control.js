export const SIGIL_OBJECT_CONTROL_SCHEMA_VERSION = '2026-05-03';
export const SIGIL_OBJECT_CONTROL_CANVAS_ID = 'avatar-main';
export const WIKI_BRAIN_RADIAL_ITEM_ID = 'wiki-graph';
export const WIKI_BRAIN_SHELL_OBJECT_ID = 'radial.wiki-brain.shell';
export const WIKI_BRAIN_TREE_OBJECT_ID = 'radial.wiki-brain.tree';
export const WIKI_BRAIN_FIBER_OBJECT_ID = WIKI_BRAIN_TREE_OBJECT_ID;
export const WIKI_BRAIN_FIBER_STEM_OBJECT_ID = 'radial.wiki-brain.fiber-stem';
export const WIKI_BRAIN_FIBER_BLOOM_OBJECT_ID = 'radial.wiki-brain.fiber-bloom';
export const WIKI_BRAIN_FRACTAL_TREE_OBJECT_ID = 'radial.wiki-brain.fractal-tree';

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

export function findWikiBrainRadialItem(radialGestureMenu = {}) {
    const items = Array.isArray(radialGestureMenu?.items) ? radialGestureMenu.items : [];
    return items.find((item) => item?.id === WIKI_BRAIN_RADIAL_ITEM_ID) || null;
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

export function buildWikiBrainObjectRegistry(radialGestureMenu = {}, options = {}) {
    const canvasId = text(options.canvasId, SIGIL_OBJECT_CONTROL_CANVAS_ID);
    const item = findWikiBrainRadialItem(radialGestureMenu);
    const effect = resolveWikiBrainEffect(item);
    return {
        type: 'canvas_object.registry',
        schema_version: SIGIL_OBJECT_CONTROL_SCHEMA_VERSION,
        canvas_id: canvasId,
        objects: effect ? [
            registryObject({
                objectId: WIKI_BRAIN_SHELL_OBJECT_ID,
                name: 'Wiki Brain Shell',
                transform: effect.shellTransform,
                visible: effect.visibility.shell,
                metadata: { role: 'shell' },
            }),
            registryObject({
                objectId: WIKI_BRAIN_FIBER_STEM_OBJECT_ID,
                name: 'Wiki Brain Fiber Stem',
                transform: effect.fiberStemTransform,
                visible: effect.visibility.fiberStem,
                metadata: { role: 'fiber-stem' },
            }),
            registryObject({
                objectId: WIKI_BRAIN_FIBER_BLOOM_OBJECT_ID,
                name: 'Wiki Brain Fiber Bloom',
                transform: effect.fiberBloomTransform,
                visible: effect.visibility.fiberBloom,
                metadata: { role: 'fiber-bloom' },
            }),
            registryObject({
                objectId: WIKI_BRAIN_FRACTAL_TREE_OBJECT_ID,
                name: 'Wiki Brain Fractal Tree',
                transform: effect.fractalTreeTransform,
                visible: effect.visibility.fractalTree,
                metadata: { role: 'fractal-tree' },
            }),
        ] : [],
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

    const item = findWikiBrainRadialItem(radialGestureMenu);
    const effect = wikiBrainEffect(item);
    if (!item || !effect) {
        return resultFor(message, 'rejected', {
            reason: 'not_ready',
            message: 'wiki brain radial effect is not available',
        });
    }

    const objectId = message.target.object_id;
    const target = {
        [WIKI_BRAIN_SHELL_OBJECT_ID]: {
            key: 'shellTransform',
            visibilityKey: 'shell',
            resolve: resolveNestedShellTransform,
        },
        [WIKI_BRAIN_FIBER_OBJECT_ID]: {
            key: 'fiberBloomTransform',
            visibilityKey: 'fiberBloom',
            resolve: resolveNestedFiberBloomTransform,
        },
        [WIKI_BRAIN_FIBER_STEM_OBJECT_ID]: {
            key: 'fiberStemTransform',
            visibilityKey: 'fiberStem',
            resolve: resolveNestedFiberStemTransform,
        },
        [WIKI_BRAIN_FIBER_BLOOM_OBJECT_ID]: {
            key: 'fiberBloomTransform',
            visibilityKey: 'fiberBloom',
            resolve: resolveNestedFiberBloomTransform,
        },
        [WIKI_BRAIN_FRACTAL_TREE_OBJECT_ID]: {
            key: 'fractalTreeTransform',
            visibilityKey: 'fractalTree',
            resolve: resolveNestedFractalTreeTransform,
        },
    }[objectId] || null;
    if (!target) {
        return resultFor(message, 'rejected', {
            reason: 'unknown_object',
            message: `unknown object ${objectId}`,
        });
    }
    if (!message.patch || typeof message.patch !== 'object') {
        return resultFor(message, 'rejected', {
            reason: 'invalid_patch',
            message: 'transform patch requires patch object',
        });
    }

    const current = target.resolve(effect);
    const merged = mergeTransformPatch(current, message.patch);
    let visibilityChanged = false;
    let visibility = resolveNestedVisibility(effect);
    if (message.patch.visible !== undefined) {
        if (typeof message.patch.visible !== 'boolean') {
            return resultFor(message, 'rejected', {
                reason: 'invalid_patch',
                message: 'visible patch must be boolean',
            });
        }
        visibility = {
            ...visibility,
            [target.visibilityKey]: message.patch.visible,
        };
        visibilityChanged = true;
    }
    if (!merged.changed && !visibilityChanged) {
        return resultFor(message, 'rejected', {
            reason: 'invalid_patch',
            message: 'patch did not contain numeric transform axes or visibility',
        });
    }

    if (merged.changed) effect[target.key] = merged.transform;
    if (visibilityChanged) effect.visibility = visibility;
    return resultFor(message, 'applied', {
        transform: contractTransformFromEffect(merged.changed ? merged.transform : current),
        visible: visibility[target.visibilityKey],
    });
}
