import { toolkitSpecifier } from './content-roots.js';

const {
    createCanvasHostRuntime,
    createCanvasResponseError,
} = await import(toolkitSpecifier('runtime/canvas-host-runtime.js'));

export { createCanvasResponseError };

export function createHostRuntime(options = {}) {
    return createCanvasHostRuntime({
        requestIdPrefix: 'sigil',
        loggerLabel: 'sigil',
        globalObject: typeof window !== 'undefined' ? window : globalThis,
        bridgeGlobalName: 'headsup',
        messageHandlerName: 'headsup',
        ...options,
    });
}
