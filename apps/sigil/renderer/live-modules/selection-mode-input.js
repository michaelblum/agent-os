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

export function selectionModeKeyName(msg = {}) {
    return String(msg.key || msg.key_name || msg.code || '').toLowerCase();
}

export function resolveSelectionModeInputRoute(msg = {}, {
    consumeSelectionModeEntryRelease = () => false,
    isOnAvatar = () => false,
    consumeAvatarDoubleClick = () => false,
    hitTestLineageItem = () => null,
    hitTestLineageBar = () => null,
} = {}) {
    if (msg.type === 'key_down') {
        const key = selectionModeKeyName(msg);
        if (msg.key_code === 53 || key === 'escape') {
            return { handled: true, command: 'escape', gesture: 'key.escape' };
        }
        if (msg.key_code === 36 || msg.key_code === 76 || key === 'enter' || key === 'return') {
            return { handled: true, command: 'commit', gesture: 'key.enter' };
        }
        if (msg.key_code === 48 || key === 'tab') {
            return { handled: true, command: 'tabPreviousTarget', gesture: 'key.tab', delta: -1 };
        }
        if (msg.key_code === 126 || key === 'arrowup') {
            return { handled: true, command: 'arrowUpPreviousTarget', gesture: 'key.arrow_up', delta: -1 };
        }
        if (msg.key_code === 125 || key === 'arrowdown') {
            return { handled: true, command: 'arrowDownNextTarget', gesture: 'key.arrow_down', delta: 1 };
        }
        return { handled: true, direct: 'consume_unrelated_key' };
    }

    if (msg.type === 'mouse_moved' || msg.type === 'left_mouse_dragged') {
        return { handled: true, direct: 'render_only' };
    }
    if (msg.type === 'left_mouse_down') {
        return { handled: true, direct: 'consume_left_mouse_down' };
    }
    if (msg.type === 'left_mouse_up') {
        const pointer = { x: msg.x, y: msg.y, valid: true };
        if (consumeSelectionModeEntryRelease(msg)) {
            return { handled: true, direct: 'entry_release' };
        }
        if (isOnAvatar(msg.x, msg.y)) {
            if (consumeAvatarDoubleClick(msg.x, msg.y)) {
                return { handled: true, direct: 'avatar_double_click_exit' };
            }
            return { handled: true, direct: 'avatar_click' };
        }
        const lineageItem = hitTestLineageItem(pointer);
        if (lineageItem?.nodeId) {
            return {
                handled: true,
                command: 'selectLineageNode',
                gesture: 'pointer.lineage.click',
                pointer,
                nodeId: lineageItem.nodeId,
                lineageItemId: lineageItem.id || '',
            };
        }
        const lineageBar = hitTestLineageBar(pointer);
        if (lineageBar) {
            return { handled: true, direct: 'lineage_bar_chrome' };
        }
        return {
            handled: true,
            command: 'acquire',
            gesture: 'pointer.left.click',
            pointer,
        };
    }

    if (['right_mouse_down', 'right_mouse_up', 'scroll_wheel'].includes(msg.type)) {
        return { handled: true, direct: 'consume_unrelated_pointer' };
    }

    return { handled: false };
}
