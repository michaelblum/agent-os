function defaultNow() {
    return typeof performance !== 'undefined' && typeof performance.now === 'function'
        ? performance.now()
        : Date.now();
}

function defaultDistance(ax, ay, bx, by) {
    return Math.hypot(ax - bx, ay - by);
}

export function createAvatarDoubleClickTracker({
    now = defaultNow,
    distance = defaultDistance,
    isOnAvatar = () => false,
    getAvatarHitRadius = () => 0,
    doubleClickMs = 520,
    minDistance = 10,
} = {}) {
    let lastAvatarClick = null;
    let selectionModeEntryReleasePending = false;

    function resetAvatarDoubleClick() {
        lastAvatarClick = null;
    }

    function consumeAvatarDoubleClick(x, y) {
        if (!Number.isFinite(x) || !Number.isFinite(y) || !isOnAvatar(x, y)) {
            resetAvatarDoubleClick();
            return false;
        }
        const at = now();
        const prior = lastAvatarClick;
        lastAvatarClick = { x, y, at };
        if (!prior) return false;
        return at - prior.at <= doubleClickMs
            && distance(x, y, prior.x, prior.y) <= Math.max(minDistance, getAvatarHitRadius());
    }

    function markSelectionModeEntryReleasePending() {
        selectionModeEntryReleasePending = true;
    }

    function clearSelectionModeEntryReleasePending() {
        selectionModeEntryReleasePending = false;
    }

    function consumeSelectionModeEntryRelease(msg = {}) {
        if (!selectionModeEntryReleasePending || msg.type !== 'left_mouse_up') return false;
        selectionModeEntryReleasePending = false;
        return true;
    }

    return {
        consumeAvatarDoubleClick,
        resetAvatarDoubleClick,
        markSelectionModeEntryReleasePending,
        clearSelectionModeEntryReleasePending,
        consumeSelectionModeEntryRelease,
        snapshot() {
            return {
                lastAvatarClick,
                selectionModeEntryReleasePending,
            };
        },
    };
}
