import { toolkitSpecifier } from './content-roots.js';

export const {
    normalizeCanvasInputMessage,
    normalizeCanvasOriginInputMessage,
} = await import(toolkitSpecifier('runtime/input-events.js', {
    local: '../../../../packages/toolkit/runtime/input-events.js',
}));

export function normalizeMessage(msg = {}) {
    const toolkitMessage = normalizeCanvasInputMessage(msg);
    if (toolkitMessage) {
        return {
            ...toolkitMessage,
            envelope_type: toolkitMessage.envelopeType,
        };
    }

    const payload = (msg?.payload && typeof msg.payload === 'object' && msg.payload !== null) ? msg.payload : null;
    const merged = payload ? { ...payload, ...msg } : { ...msg };
    merged.type = msg?.type ?? payload?.type ?? merged.type;
    return merged;
}
