export function nativePointFromMessageOrigin(msg = null) {
    const x = Number(msg?.origin_x ?? msg?.payload?.origin_x);
    const y = Number(msg?.origin_y ?? msg?.payload?.origin_y);
    if (Number.isFinite(x) && Number.isFinite(y)) return { x, y };
    return null;
}

export function terminalParkingPointFromFrame(frameLike, {
    xOffset = 23,
    yOffset = 21,
} = {}) {
    if (!Array.isArray(frameLike) || frameLike.length < 2) return null;
    const x = Number(frameLike[0]);
    const y = Number(frameLike[1]);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
    return { x: x + xOffset, y: y + yOffset };
}

export function statusCollapseFrameFromOrigin(origin, {
    size = 28,
} = {}) {
    const x = Number(origin?.x);
    const y = Number(origin?.y);
    const n = Number(size);
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(n) || n <= 0) return null;
    const offset = n / 2;
    return [x - offset, y - offset, n, n];
}

export function createSigilAvatarParkingController({
    liveState,
    renderState,
    terminalScale = 0.24,
    statusScale = 0.2,
    nativePointToDesktop = (point) => point,
    setAvatarVisibility = () => {},
    animateVisibility = () => {},
    setAvatarHover = () => {},
    emitAvatarMark = () => {},
} = {}) {
    if (!liveState || typeof liveState !== 'object') {
        throw new TypeError('createSigilAvatarParkingController requires liveState');
    }
    if (!renderState || typeof renderState !== 'object') {
        throw new TypeError('createSigilAvatarParkingController requires renderState');
    }

    function parkAtNativePoint(nativePoint, mode, scale = terminalScale) {
        const desktopPoint = nativePointToDesktop(nativePoint);
        if (!desktopPoint) return false;
        if (!liveState.avatarParking && liveState.avatarPos?.valid) {
            liveState._avatarParkingRestore = {
                pos: { ...liveState.avatarPos },
                scale: renderState.appScale,
                visible: liveState.avatarVisible,
            };
        }
        liveState.avatarParking = { mode, nativePoint: { ...nativePoint }, scale };
        liveState.avatarPos = { x: desktopPoint.x, y: desktopPoint.y, valid: true };
        renderState.appScale = scale;
        setAvatarVisibility(true);
        setAvatarHover(false);
        emitAvatarMark();
        return true;
    }

    function parkInTerminal(frameLike) {
        const point = terminalParkingPointFromFrame(frameLike);
        if (!point) return false;
        return parkAtNativePoint(point, 'terminal', terminalScale);
    }

    function parkAtStatusMessage(msg) {
        const origin = nativePointFromMessageOrigin(msg);
        if (!origin) return false;
        return parkAtNativePoint(origin, 'status', statusScale);
    }

    function clear({ restoreVisible = true } = {}) {
        const restore = liveState._avatarParkingRestore;
        const restorePos = restore?.pos;
        liveState.avatarParking = null;
        liveState._avatarParkingRestore = null;
        if (restorePos?.valid) {
            liveState.avatarPos = { ...restorePos };
        }
        if (restoreVisible) {
            renderState.appScale = restore?.scale > 0.05 ? restore.scale : 1;
            animateVisibility(true);
        } else {
            animateVisibility(false);
        }
        return {
            restoredPosition: !!restorePos?.valid,
            restoreVisible,
        };
    }

    return Object.freeze({
        clear,
        isParkedAtStatus() {
            return liveState.avatarParking?.mode === 'status';
        },
        parkAtNativePoint,
        parkAtStatusMessage,
        parkInTerminal,
    });
}
