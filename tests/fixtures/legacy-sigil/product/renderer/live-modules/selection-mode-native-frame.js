function cloneFrame(frame = null) {
    return Array.isArray(frame) ? frame.slice(0, 4) : null;
}

export function createSelectionModeNativeFrameResolver(resolveFrame = () => null) {
    let lastFrame = null;

    function resolve() {
        const frame = cloneFrame(resolveFrame?.() || null);
        if (frame) {
            lastFrame = frame;
            return cloneFrame(frame);
        }
        return cloneFrame(lastFrame);
    }

    function reset() {
        lastFrame = null;
    }

    function snapshot() {
        return cloneFrame(lastFrame);
    }

    return {
        resolve,
        reset,
        snapshot,
    };
}
