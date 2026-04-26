import state from '../state.js';
import { normalizeFastTravelEffect } from '../transition-registry.js';
import { clampPointToDisplays, desktopWorldToNativePoint } from './display-utils.js';

function clamp01(value) {
    return Math.max(0, Math.min(1, value));
}

function lerp(a, b, t) {
    return a + ((b - a) * t);
}

function smoothstep(t) {
    const x = clamp01(t);
    return x * x * (3 - (2 * x));
}

function easeOutQuart(t) {
    return 1 - Math.pow(1 - t, 4);
}

function easeOutBack(t) {
    const x = clamp01(t);
    const c1 = 1.70158;
    const c3 = c1 + 1;
    return 1 + (c3 * Math.pow(x - 1, 3)) + (c1 * Math.pow(x - 1, 2));
}

function rgba(hex, alpha) {
    if (typeof hex !== 'string') return `rgba(255,255,255,${alpha})`;
    const value = hex.replace('#', '');
    if (value.length !== 6) return `rgba(255,255,255,${alpha})`;
    const r = parseInt(value.slice(0, 2), 16);
    const g = parseInt(value.slice(2, 4), 16);
    const b = parseInt(value.slice(4, 6), 16);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function captureImageSource(result) {
    return `data:${result.mimeType};base64,${result.base64}`;
}

function loadImage(result) {
    return new Promise((resolve, reject) => {
        const image = new Image();
        image.onload = () => resolve(image);
        image.onerror = reject;
        image.src = captureImageSource(result);
    });
}

function createCanvasOverlay() {
    let canvas = null;
    let resize = null;

    function ensure() {
        if (canvas) return canvas;
        canvas = document.createElement('canvas');
        canvas.style.position = 'absolute';
        canvas.style.inset = '0';
        canvas.style.pointerEvents = 'none';
        document.body.appendChild(canvas);

        resize = () => {
            const dpr = window.devicePixelRatio || 1;
            canvas.width = Math.floor(window.innerWidth * dpr);
            canvas.height = Math.floor(window.innerHeight * dpr);
            canvas.style.width = `${window.innerWidth}px`;
            canvas.style.height = `${window.innerHeight}px`;
            const ctx = canvas.getContext('2d');
            ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        };
        resize();
        window.addEventListener('resize', resize);
        return canvas;
    }

    function context() {
        if (!canvas) return null;
        return canvas.getContext('2d');
    }

    function clear() {
        const ctx = context();
        if (!ctx) return;
        ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);
    }

    function destroy() {
        if (resize) window.removeEventListener('resize', resize);
        resize = null;
        if (canvas) canvas.remove();
        canvas = null;
    }

    return { mount: ensure, context, clear, destroy };
}

function clonePoint(point) {
    if (!point || typeof point !== 'object') return null;
    const x = Number(point.x);
    const y = Number(point.y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
    return { x, y, valid: point.valid ?? true };
}

function cloneCurve(curve) {
    if (!curve || typeof curve !== 'object') return null;
    return {
        x: Number(curve.x) || 0,
        y: Number(curve.y) || 0,
        amount: Number(curve.amount) || 0,
    };
}

function durationForDistance(from, to) {
    const dist = Math.hypot(to.x - from.x, to.y - from.y);
    return Math.max(120, Math.min(300, (dist / 5000) * 1000));
}

function lineTravel(liveJs, displays, toX, toY) {
    const clamped = clampPointToDisplays(displays, toX, toY);
    const fromX = liveJs.avatarPos.valid ? liveJs.avatarPos.x : clamped.x;
    const fromY = liveJs.avatarPos.valid ? liveJs.avatarPos.y : clamped.y;
    liveJs.travel = {
        effect: 'line',
        phase: 'line',
        previousOmegaEnabled: state.isOmegaEnabled,
        fromX,
        fromY,
        toX: clamped.x,
        toY: clamped.y,
        from: { x: fromX, y: fromY, valid: true },
        to: { x: clamped.x, y: clamped.y, valid: true },
        startMs: performance.now(),
        durationMs: durationForDistance({ x: fromX, y: fromY }, clamped),
    };
    state.isOmegaEnabled = true;
    state.omegaInterDimensional = true;
    return liveJs.travel;
}

function tickLineTravel(liveJs, onComplete) {
    const travel = liveJs.travel;
    if (!travel) return null;
    const elapsed = performance.now() - travel.startMs;
    const progress = clamp01(elapsed / travel.durationMs);
    const eased = easeOutQuart(progress);
    liveJs.avatarPos.x = travel.fromX + ((travel.toX - travel.fromX) * eased);
    liveJs.avatarPos.y = travel.fromY + ((travel.toY - travel.fromY) * eased);
    liveJs.avatarPos.valid = true;

    if (progress < 1) return { active: true, effect: 'line', phase: 'line' };

    const landed = { x: travel.toX, y: travel.toY, valid: true };
    liveJs.avatarPos = landed;
    liveJs.currentCursor = landed;
    liveJs.cursorTarget = landed;
    liveJs.travel = null;
    state.isOmegaEnabled = travel.previousOmegaEnabled ?? false;
    state.omegaInterDimensional = false;
    if (typeof onComplete === 'function') onComplete(landed);
    return { active: false, effect: 'line', phase: 'complete', avatarPos: landed, appScale: 1 };
}

function vectorBetween(a, b) {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const length = Math.hypot(dx, dy) || 1;
    return {
        dx,
        dy,
        length,
        ux: dx / length,
        uy: dy / length,
    };
}

function curveFor(from, to, radius) {
    const vector = vectorBetween(from, to);
    const amount = Math.min(radius * 1.1, vector.length * 0.18);
    return {
        x: vector.ux * amount,
        y: vector.uy * amount,
        amount,
    };
}

function drawCurvedPatch(ctx, image, center, radius, depth, curve, sign) {
    if (!image) return;
    const rings = 11;
    ctx.save();
    ctx.globalAlpha = 0.25 + (0.18 * depth);
    ctx.drawImage(image, center.x - radius, center.y - radius, radius * 2, radius * 2);
    ctx.restore();

    for (let index = rings; index >= 1; index -= 1) {
        const t = index / rings;
        const ringRadius = radius * t;
        const sink = (1 - t) * depth;
        const cx = center.x + (curve.x * sign * sink);
        const cy = center.y + (curve.y * sign * sink);
        const compression = Math.max(0.16, 1 - (depth * (0.72 - (0.25 * t))));
        ctx.save();
        ctx.beginPath();
        ctx.arc(cx, cy, ringRadius, 0, Math.PI * 2);
        ctx.clip();
        ctx.translate(cx, cy);
        ctx.rotate(sign * depth * (1 - t) * 0.9);
        ctx.scale(compression, Math.max(0.14, compression * 0.82));
        ctx.globalAlpha = 0.04 + (t * 0.1);
        ctx.drawImage(image, -radius, -radius, radius * 2, radius * 2);
        ctx.restore();
    }
}

function drawTunnel(ctx, tunnel, other, radius, open, options) {
    if (!tunnel || open <= 0.001) return;
    const faceColors = state.colors?.face ?? ['#ffffff', '#88ccff'];
    const accentA = faceColors[0];
    const accentB = faceColors[1];
    const vector = other ? vectorBetween(tunnel, other) : { ux: 1, uy: 0, length: 0 };
    const curve = other ? curveFor(tunnel, other, radius) : { x: 0, y: 0 };
    const depth = smoothstep(open);
    const sign = options?.sign ?? 1;
    const time = options?.time ?? 0;
    const capture = options?.capture;

    drawCurvedPatch(ctx, capture?.image, tunnel, radius, depth, curve, sign);

    const well = ctx.createRadialGradient(tunnel.x, tunnel.y, radius * 0.04, tunnel.x, tunnel.y, radius * 1.35);
    well.addColorStop(0, `rgba(255,255,255,${0.16 * depth})`);
    well.addColorStop(0.18, `rgba(5, 10, 22, ${0.18 + (0.22 * depth)})`);
    well.addColorStop(0.62, `rgba(3, 5, 14, ${0.20 + (0.34 * depth)})`);
    well.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = well;
    ctx.beginPath();
    ctx.arc(tunnel.x, tunnel.y, radius * (0.62 + (0.58 * depth)), 0, Math.PI * 2);
    ctx.fill();

    ctx.save();
    ctx.translate(tunnel.x, tunnel.y);
    ctx.rotate(Math.atan2(vector.uy, vector.ux));
    for (let index = 0; index < 8; index += 1) {
        const t = index / 8;
        const ringX = curve.amount * sign * depth * t * 0.92;
        const ringRadius = radius * (1 - (t * 0.72)) * (0.52 + (0.48 * depth));
        ctx.strokeStyle = rgba(index % 2 ? accentA : accentB, (0.18 + (0.28 * (1 - t))) * depth);
        ctx.lineWidth = Math.max(0.8, 2.2 * (1 - t));
        ctx.beginPath();
        ctx.ellipse(ringX, 0, ringRadius, ringRadius * (0.38 + (0.22 * t)), 0, 0, Math.PI * 2);
        ctx.stroke();
    }
    ctx.restore();

    ctx.save();
    ctx.globalCompositeOperation = 'screen';
    for (let index = 0; index < 18; index += 1) {
        const n = index + 1;
        const angle = (n * 2.399963) + (time * (0.7 + ((index % 5) * 0.13)));
        const spiral = ((time * 0.45) + ((index * 0.061) % 1)) % 1;
        const pr = radius * (0.12 + (spiral * 0.92)) * depth;
        const px = tunnel.x + (Math.cos(angle) * pr) + (curve.x * sign * depth * (1 - spiral) * 0.55);
        const py = tunnel.y + (Math.sin(angle) * pr) + (curve.y * sign * depth * (1 - spiral) * 0.55);
        const particleRadius = 1.2 + ((index % 4) * 0.55);
        const particle = ctx.createRadialGradient(px, py, 0, px, py, particleRadius * 3.5);
        particle.addColorStop(0, rgba('#ffffff', 0.68 * depth * (1 - (spiral * 0.4))));
        particle.addColorStop(0.5, rgba(accentA, 0.26 * depth));
        particle.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.fillStyle = particle;
        ctx.beginPath();
        ctx.arc(px, py, particleRadius * 3.5, 0, Math.PI * 2);
        ctx.fill();
    }
    ctx.restore();

    const burst = depth * (options?.burst ?? 0.65);
    ctx.save();
    ctx.globalCompositeOperation = 'screen';
    ctx.lineCap = 'round';
    for (let index = 0; index < 12; index += 1) {
        const angle = (Math.PI * 2 * index / 12) + (time * 0.2);
        const inner = radius * 0.05;
        const outer = radius * (0.45 + (0.25 * burst) + ((index % 3) * 0.04));
        const gradient = ctx.createLinearGradient(
            tunnel.x + (Math.cos(angle) * inner),
            tunnel.y + (Math.sin(angle) * inner),
            tunnel.x + (Math.cos(angle) * outer),
            tunnel.y + (Math.sin(angle) * outer)
        );
        gradient.addColorStop(0, rgba('#ffffff', 0.42 * burst));
        gradient.addColorStop(0.45, rgba(accentB, 0.2 * burst));
        gradient.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.strokeStyle = gradient;
        ctx.lineWidth = 1.1 + ((index % 3) * 0.5);
        ctx.beginPath();
        ctx.moveTo(tunnel.x + (Math.cos(angle) * inner), tunnel.y + (Math.sin(angle) * inner));
        ctx.lineTo(tunnel.x + (Math.cos(angle) * outer), tunnel.y + (Math.sin(angle) * outer));
        ctx.stroke();
    }
    ctx.restore();

    const singularity = ctx.createRadialGradient(tunnel.x, tunnel.y, 0, tunnel.x, tunnel.y, radius * 0.22);
    singularity.addColorStop(0, rgba('#ffffff', 0.9 * depth));
    singularity.addColorStop(0.35, rgba(accentA, 0.38 * depth));
    singularity.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = singularity;
    ctx.beginPath();
    ctx.arc(tunnel.x, tunnel.y, radius * 0.22, 0, Math.PI * 2);
    ctx.fill();
}

export function startFastTravel(liveJs, displays, toX, toY) {
    return lineTravel(liveJs, displays, toX, toY);
}

export function tickFastTravel(liveJs, onComplete) {
    return tickLineTravel(liveJs, onComplete);
}

export function createFastTravelController({
    host,
    state: rendererState,
    liveJs,
    projectStagePoint,
    getExcludedCanvasIds,
}) {
    const overlay = createCanvasOverlay();
    let gesture = null;

    function record(stage, extra = {}) {
        const entry = { ts: Date.now(), stage, ...extra };
        if (!Array.isArray(liveJs.fastTravelEvents)) liveJs.fastTravelEvents = [];
        liveJs.fastTravelEvents.push(entry);
        if (liveJs.fastTravelEvents.length > 80) liveJs.fastTravelEvents.shift();
        console.debug('[sigil][fast-travel]', stage, entry);
    }

    function effect() {
        return normalizeFastTravelEffect(rendererState.transitionFastTravelEffect);
    }

    async function requestCapture(travel, point, slot) {
        const nativeCenter = desktopWorldToNativePoint(point, liveJs.displays) ?? point;
        const radius = travel.captureRadius;
        try {
            const result = await host.captureRegion({
                x: nativeCenter.x - radius,
                y: nativeCenter.y - radius,
                width: radius * 2,
                height: radius * 2,
            }, {
                format: 'jpg',
                quality: 'med',
                timeoutMs: 1750,
                excludeCanvasIds: getExcludedCanvasIds(),
            });
            const image = await loadImage(result);
            if (liveJs.travel !== travel) return;
            travel.captures[slot] = { image, region: result.region };
            record(`wormhole.capture.${slot}`, { ok: true });
        } catch (error) {
            if (liveJs.travel !== travel) return;
            travel.captureErrors[slot] = String(error);
            record(`wormhole.capture.${slot}`, { ok: false, error: String(error) });
        }
    }

    function beginGesture(origin) {
        if (effect() !== 'wormhole' || !origin?.valid) return;
        gesture = {
            effect: 'wormhole',
            origin: { x: origin.x, y: origin.y, valid: true },
            pointer: { x: origin.x, y: origin.y, valid: true },
            openedAt: performance.now(),
        };
        record('wormhole.entry.created', {
            x: Math.round(origin.x),
            y: Math.round(origin.y),
        });
    }

    function updateGesture(point) {
        if (!gesture || !point) return;
        gesture.pointer = { x: point.x, y: point.y, valid: true };
        const dist = Math.hypot(point.x - gesture.origin.x, point.y - gesture.origin.y);
        if (!gesture.exitCreated && dist > Math.max(42, rendererState.avatarHitRadius * 1.15)) {
            gesture.exitCreated = true;
            record('wormhole.exit.created', {
                x: Math.round(point.x),
                y: Math.round(point.y),
            });
        }
    }

    function clearGesture(reason = 'clear') {
        if (gesture) record('wormhole.gesture.clear', { reason });
        gesture = null;
        if (!liveJs.travel) overlay.clear();
    }

    function exportSnapshot() {
        const now = performance.now();
        const travel = liveJs.travel;
        return {
            gesture: gesture ? {
                effect: gesture.effect,
                origin: clonePoint(gesture.origin),
                pointer: clonePoint(gesture.pointer),
                openedElapsedMs: Math.max(0, now - gesture.openedAt),
                exitCreated: !!gesture.exitCreated,
            } : null,
            travel: travel ? {
                effect: travel.effect,
                phase: travel.phase,
                fromX: travel.fromX,
                fromY: travel.fromY,
                toX: travel.toX,
                toY: travel.toY,
                from: clonePoint(travel.from) ?? { x: travel.fromX, y: travel.fromY, valid: true },
                to: clonePoint(travel.to) ?? { x: travel.toX, y: travel.toY, valid: true },
                pointer: clonePoint(travel.pointer),
                elapsedMs: Math.max(0, now - travel.startMs),
                durationMs: travel.durationMs,
                entryMs: travel.entryMs,
                transitMs: travel.transitMs,
                exitMs: travel.exitMs,
                captureRadius: travel.captureRadius,
                curve: cloneCurve(travel.curve),
            } : null,
        };
    }

    function applySnapshot(snapshot) {
        if (!snapshot || typeof snapshot !== 'object') return;
        const now = performance.now();
        if (snapshot.gesture) {
            gesture = {
                effect: snapshot.gesture.effect,
                origin: clonePoint(snapshot.gesture.origin),
                pointer: clonePoint(snapshot.gesture.pointer),
                openedAt: now - Math.max(0, Number(snapshot.gesture.openedElapsedMs) || 0),
                exitCreated: !!snapshot.gesture.exitCreated,
            };
        } else {
            gesture = null;
        }

        if (snapshot.travel) {
            const travel = snapshot.travel;
            const from = clonePoint(travel.from) ?? { x: Number(travel.fromX) || 0, y: Number(travel.fromY) || 0, valid: true };
            const to = clonePoint(travel.to) ?? { x: Number(travel.toX) || from.x, y: Number(travel.toY) || from.y, valid: true };
            liveJs.travel = {
                effect: travel.effect,
                phase: travel.phase,
                fromX: Number(travel.fromX) || from.x,
                fromY: Number(travel.fromY) || from.y,
                toX: Number(travel.toX) || to.x,
                toY: Number(travel.toY) || to.y,
                from,
                to,
                pointer: clonePoint(travel.pointer) ?? to,
                startMs: now - Math.max(0, Number(travel.elapsedMs) || 0),
                durationMs: Number(travel.durationMs) || durationForDistance(from, to),
                entryMs: Number(travel.entryMs) || 160,
                transitMs: Number(travel.transitMs) || 80,
                exitMs: Number(travel.exitMs) || 220,
                captureRadius: Number(travel.captureRadius) || Math.max(56, Number(rendererState.wormholeCaptureRadius) || 96),
                curve: cloneCurve(travel.curve) ?? curveFor(from, to, Number(travel.captureRadius) || 96),
                captures: {},
                captureErrors: {},
            };
        } else {
            liveJs.travel = null;
            if (!gesture) overlay.clear();
        }
    }

    function start(toX, toY, options = {}) {
        const currentEffect = effect();
        if (currentEffect !== 'wormhole') {
            clearGesture('line-start');
            return lineTravel(liveJs, liveJs.displays, toX, toY);
        }

        const clamped = clampPointToDisplays(liveJs.displays, toX, toY);
        const from = liveJs.avatarPos.valid
            ? { x: liveJs.avatarPos.x, y: liveJs.avatarPos.y, valid: true }
            : { x: clamped.x, y: clamped.y, valid: true };
        const to = { x: clamped.x, y: clamped.y, valid: true };
        const radius = Math.max(56, Number(rendererState.wormholeCaptureRadius) || 96);
        const travel = {
            effect: 'wormhole',
            phase: 'entry',
            fromX: from.x,
            fromY: from.y,
            toX: to.x,
            toY: to.y,
            previousOmegaEnabled: state.isOmegaEnabled,
            from,
            to,
            pointer: options.pointer ?? to,
            startMs: performance.now(),
            durationMs: Math.max(520, durationForDistance(from, to) + 420),
            entryMs: Math.max(160, (Number(rendererState.wormholeImplosionDuration) || 0.22) * 1000),
            transitMs: Math.max(80, Math.min(180, durationForDistance(from, to) * 0.5)),
            exitMs: Math.max(220, (Number(rendererState.wormholeReboundDuration) || 0.34) * 1000),
            captureRadius: radius,
            curve: curveFor(from, to, radius),
            captures: {},
            captureErrors: {},
        };
        travel.durationMs = travel.entryMs + travel.transitMs + travel.exitMs;
        liveJs.travel = travel;
        state.isOmegaEnabled = true;
        state.omegaInterDimensional = true;
        record('wormhole.release', {
            from: { x: Math.round(from.x), y: Math.round(from.y) },
            to: { x: Math.round(to.x), y: Math.round(to.y) },
        });
        void requestCapture(travel, from, 'entry');
        void requestCapture(travel, to, 'exit');
        gesture = null;
        return travel;
    }

    function tick(dt, onComplete) {
        const travel = liveJs.travel;
        if (!travel) return null;
        if (travel.effect !== 'wormhole') return tickLineTravel(liveJs, onComplete);

        const elapsed = performance.now() - travel.startMs;
        const entryEnd = travel.entryMs;
        const transitEnd = travel.entryMs + travel.transitMs;
        const progress = clamp01(elapsed / travel.durationMs);

        let appScale = rendererState.appScale;
        let renderAvatarPos = liveJs.avatarPos;
        let phase = 'entry';

        if (elapsed <= entryEnd) {
            const t = smoothstep(elapsed / travel.entryMs);
            appScale = Math.max(0.02, 1 - (0.96 * t));
            renderAvatarPos = travel.from;
        } else if (elapsed <= transitEnd) {
            phase = 'transit';
            appScale = 0.02;
            const t = smoothstep((elapsed - entryEnd) / travel.transitMs);
            renderAvatarPos = {
                x: lerp(travel.from.x, travel.to.x, t),
                y: lerp(travel.from.y, travel.to.y, t),
                valid: true,
            };
        } else {
            phase = 'exit';
            if (liveJs.avatarPos.x !== travel.to.x || liveJs.avatarPos.y !== travel.to.y) {
                liveJs.avatarPos = { ...travel.to };
            }
            const t = clamp01((elapsed - transitEnd) / travel.exitMs);
            const rebound = easeOutBack(t);
            appScale = Math.max(0, 0.08 + (0.92 * rebound));
            renderAvatarPos = travel.to;
        }

        if (travel.phase !== phase) {
            travel.phase = phase;
            record(`wormhole.phase.${phase}`, { progress: Number(progress.toFixed(3)) });
        }

        if (progress < 1) {
            return { active: true, effect: 'wormhole', phase, appScale, avatarPos: renderAvatarPos };
        }

        const landed = { ...travel.to };
        liveJs.avatarPos = landed;
        liveJs.currentCursor = landed;
        liveJs.cursorTarget = landed;
        liveJs.travel = null;
        state.isOmegaEnabled = travel.previousOmegaEnabled ?? false;
        state.omegaInterDimensional = false;
        overlay.clear();
        record('wormhole.complete', {
            x: Math.round(landed.x),
            y: Math.round(landed.y),
        });
        if (typeof onComplete === 'function') onComplete(landed);
        return { active: false, effect: 'wormhole', phase: 'complete', appScale: 1, avatarPos: landed };
    }

    function draw() {
        const ctx = overlay.context();
        if (!ctx) return;
        ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);
        const now = performance.now() / 1000;
        const radius = Math.max(56, Number(rendererState.wormholeCaptureRadius) || 96);

        if (gesture) {
            const origin = projectStagePoint(gesture.origin);
            const pointer = projectStagePoint(gesture.pointer);
            if (!origin?.valid) return;
            const dist = pointer ? Math.hypot(pointer.x - origin.x, pointer.y - origin.y) : 0;
            const open = smoothstep(Math.min(1, (performance.now() - gesture.openedAt) / 180));
            drawTunnel(ctx, origin, pointer, radius, open, { sign: 1, time: now, burst: 0.45 });
            if (pointer && dist > Math.max(42, rendererState.avatarHitRadius * 1.15)) {
                drawTunnel(ctx, pointer, origin, radius * 0.82, open * smoothstep((dist - 42) / 140), { sign: -1, time: now + 0.31, burst: 0.35 });
            }
            return;
        }

        const travel = liveJs.travel;
        if (!travel || travel.effect !== 'wormhole') return;
        const elapsed = performance.now() - travel.startMs;
        const entryOpen = elapsed <= travel.entryMs
            ? smoothstep(elapsed / travel.entryMs)
            : Math.max(0, 1 - smoothstep((elapsed - travel.entryMs) / (travel.transitMs + 80)));
        const exitStart = travel.entryMs * 0.35;
        const exitOpen = elapsed <= exitStart
            ? 0
            : (elapsed < travel.entryMs + travel.transitMs
                ? smoothstep((elapsed - exitStart) / Math.max(1, travel.entryMs + travel.transitMs - exitStart))
                : Math.max(0, 1 - smoothstep((elapsed - travel.entryMs - travel.transitMs) / travel.exitMs)));
        const from = projectStagePoint(travel.from);
        const to = projectStagePoint(travel.to);
        if (from?.valid) {
            drawTunnel(ctx, from, to, travel.captureRadius, entryOpen, {
                sign: 1,
                time: now,
                capture: travel.captures.entry,
                burst: travel.phase === 'entry' ? 0.9 : 0.55,
            });
        }
        if (to?.valid) {
            drawTunnel(ctx, to, from, travel.captureRadius * 0.92, exitOpen, {
                sign: -1,
                time: now + 0.37,
                capture: travel.captures.exit,
                burst: travel.phase === 'exit' ? 1.0 : 0.45,
            });
        }
    }

    return {
        mount() {
            overlay.mount();
        },
        beginGesture,
        updateGesture,
        clearGesture,
        start,
        tick,
        draw,
        exportSnapshot,
        applySnapshot,
        destroy() {
            gesture = null;
            overlay.destroy();
        },
        get activeGesture() {
            return gesture;
        },
        get activeEffect() {
            return liveJs.travel?.effect ?? gesture?.effect ?? null;
        },
    };
}
