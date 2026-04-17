import state from '../state.js';
import { clampPointToDisplays } from './display-utils.js';

function easeOutQuart(t) {
    return 1 - Math.pow(1 - t, 4);
}

export function startFastTravel(liveJs, displays, toX, toY) {
    const clamped = clampPointToDisplays(displays, toX, toY);
    const fromX = liveJs.avatarPos.valid ? liveJs.avatarPos.x : clamped.x;
    const fromY = liveJs.avatarPos.valid ? liveJs.avatarPos.y : clamped.y;
    const dist = Math.sqrt(((clamped.x - fromX) ** 2) + ((clamped.y - fromY) ** 2));
    const durationMs = Math.max(120, Math.min(300, (dist / 5000) * 1000));
    liveJs.travel = {
        fromX,
        fromY,
        toX: clamped.x,
        toY: clamped.y,
        startMs: performance.now(),
        durationMs,
    };
    state.isOmegaEnabled = true;
    state.omegaInterDimensional = true;
}

export function tickFastTravel(liveJs, onComplete) {
    const travel = liveJs.travel;
    if (!travel) return;
    const elapsed = performance.now() - travel.startMs;
    const progress = Math.max(0, Math.min(1, elapsed / travel.durationMs));
    const eased = easeOutQuart(progress);
    liveJs.avatarPos.x = travel.fromX + ((travel.toX - travel.fromX) * eased);
    liveJs.avatarPos.y = travel.fromY + ((travel.toY - travel.fromY) * eased);
    liveJs.avatarPos.valid = true;

    if (progress < 1) return;

    const landed = { x: travel.toX, y: travel.toY, valid: true };
    liveJs.avatarPos = landed;
    liveJs.currentCursor = landed;
    liveJs.cursorTarget = landed;
    liveJs.travel = null;
    state.omegaInterDimensional = false;
    if (typeof onComplete === 'function') onComplete(landed);
}
