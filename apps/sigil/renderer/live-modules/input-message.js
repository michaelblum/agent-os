export function normalizeMessage(msg = {}) {
    const payload = (msg?.payload && typeof msg.payload === 'object' && msg.payload !== null) ? msg.payload : null;
    if (msg?.type === 'input_event' && payload) {
        return {
            ...msg,
            ...payload,
            envelope_type: msg.type,
            type: payload.type ?? msg.type,
        };
    }

    const merged = payload ? { ...payload, ...msg } : { ...msg };
    merged.type = msg?.type ?? payload?.type ?? merged.type;
    return merged;
}
