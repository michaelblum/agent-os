import { desktopWorldToNativePoint } from './display-utils.js';

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

function easeOutCubic(t) {
    const x = clamp01(t);
    return 1 - Math.pow(1 - x, 3);
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
        if (resize) {
            window.removeEventListener('resize', resize);
            resize = null;
        }
        if (canvas) {
            canvas.remove();
            canvas = null;
        }
    }

    return {
        mount: ensure,
        context,
        clear,
        destroy,
    };
}

function drawWell(ctx, x, y, radius, depth) {
    const gradient = ctx.createRadialGradient(x, y, radius * 0.08, x, y, radius * 1.2);
    gradient.addColorStop(0, `rgba(255,255,255,${0.05 + (depth * 0.1)})`);
    gradient.addColorStop(0.22, `rgba(12, 16, 28, ${0.18 + (depth * 0.1)})`);
    gradient.addColorStop(0.65, `rgba(4, 6, 16, ${0.2 + (depth * 0.26)})`);
    gradient.addColorStop(1, `rgba(0, 0, 0, ${0.36 + (depth * 0.22)})`);
    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.arc(x, y, radius * 1.15, 0, Math.PI * 2);
    ctx.fill();
}

function drawCurvedCapture(ctx, image, x, y, radius, depth, rotation) {
    const rings = 14;
    ctx.save();
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 0.8;
    ctx.drawImage(image, x - radius, y - radius, radius * 2, radius * 2);
    ctx.restore();

    for (let index = rings; index >= 1; index -= 1) {
        const t = index / rings;
        const ringRadius = radius * t;
        const compression = Math.max(0.2, 1 - (depth * (0.68 - (0.24 * t))));
        const yCompression = Math.max(0.15, 1 - (depth * (0.82 - (0.3 * t))));
        const drift = depth * (1 - t) * radius * 0.045;
        ctx.save();
        ctx.beginPath();
        ctx.arc(x, y, ringRadius, 0, Math.PI * 2);
        ctx.clip();
        ctx.translate(x, y);
        ctx.rotate(rotation * depth * (1 - t) * 0.55);
        ctx.scale(compression, yCompression);
        ctx.globalAlpha = 0.05 + (t * 0.12);
        ctx.drawImage(image, -radius + drift, -radius + drift, radius * 2, radius * 2);
        ctx.restore();
    }
}

function drawStarburst(ctx, x, y, radius, intensity, seed, colorA, colorB) {
    if (intensity <= 0.01) return;
    const rays = 10;
    ctx.save();
    ctx.lineCap = 'round';
    for (let index = 0; index < rays; index += 1) {
        const angle = seed + ((Math.PI * 2 * index) / rays);
        const inner = radius * (0.05 + ((index % 3) * 0.01));
        const outer = radius * (0.45 + (0.3 * intensity) + ((index % 2) * 0.08));
        const gradient = ctx.createLinearGradient(
            x + (Math.cos(angle) * inner),
            y + (Math.sin(angle) * inner),
            x + (Math.cos(angle) * outer),
            y + (Math.sin(angle) * outer)
        );
        gradient.addColorStop(0, rgba(colorA, 0.9 * intensity));
        gradient.addColorStop(0.45, rgba(colorB, 0.38 * intensity));
        gradient.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.strokeStyle = gradient;
        ctx.lineWidth = 1.4 + ((index % 3) * 0.55);
        ctx.beginPath();
        ctx.moveTo(x + (Math.cos(angle) * inner), y + (Math.sin(angle) * inner));
        ctx.lineTo(x + (Math.cos(angle) * outer), y + (Math.sin(angle) * outer));
        ctx.stroke();
    }
    ctx.restore();
}

function drawLensFlare(ctx, x, y, origin, radius, intensity, accent) {
    if (!origin || intensity <= 0.01) return;
    const dx = x - origin.x;
    const dy = y - origin.y;
    const length = Math.hypot(dx, dy) || 1;
    const ux = dx / length;
    const uy = dy / length;
    const stops = [
        { distance: -0.25, size: 0.08, alpha: 0.22 },
        { distance: 0.3, size: 0.15, alpha: 0.18 },
        { distance: 0.62, size: 0.09, alpha: 0.14 },
        { distance: 1.12, size: 0.2, alpha: 0.1 },
    ];

    ctx.save();
    ctx.globalCompositeOperation = 'screen';
    for (const stop of stops) {
        const px = x - (ux * length * stop.distance);
        const py = y - (uy * length * stop.distance);
        const flareRadius = radius * stop.size * (1 + (0.35 * intensity));
        const gradient = ctx.createRadialGradient(px, py, 0, px, py, flareRadius);
        gradient.addColorStop(0, rgba('#ffffff', stop.alpha * intensity));
        gradient.addColorStop(0.6, rgba(accent, stop.alpha * 0.6 * intensity));
        gradient.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.fillStyle = gradient;
        ctx.beginPath();
        ctx.arc(px, py, flareRadius, 0, Math.PI * 2);
        ctx.fill();
    }
    ctx.restore();
}

function drawSingularity(ctx, x, y, radius, intensity) {
    const glowRadius = radius * (1.2 + (intensity * 1.4));
    const glow = ctx.createRadialGradient(x, y, 0, x, y, glowRadius);
    glow.addColorStop(0, `rgba(255,255,255,${0.92 * intensity})`);
    glow.addColorStop(0.35, `rgba(255,255,255,${0.34 * intensity})`);
    glow.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.save();
    ctx.globalCompositeOperation = 'screen';
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(x, y, glowRadius, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = `rgba(255,255,255,${0.9 * intensity})`;
    ctx.beginPath();
    ctx.arc(x, y, Math.max(1.2, radius * 0.38), 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
}

function drawSnapRing(ctx, x, y, radius, amount, accent) {
    if (amount <= 0.01) return;
    ctx.save();
    ctx.strokeStyle = rgba(accent, 0.32 * (1 - amount));
    ctx.lineWidth = 2.5 - amount;
    ctx.beginPath();
    ctx.arc(x, y, radius * (0.6 + (amount * 1.1)), 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
}

function loadImage(result) {
    return new Promise((resolve, reject) => {
        const image = new Image();
        image.onload = () => resolve(image);
        image.onerror = reject;
        image.src = captureImageSource(result);
    });
}

function interpolatePoint(a, b, t) {
    if (!a || !b) return b ?? a ?? null;
    return {
        x: lerp(a.x, b.x, t),
        y: lerp(a.y, b.y, t),
        valid: true,
    };
}

function createScaleTransition({ state, targetVisible, lifecycleAction, origin }) {
    return {
        effect: 'scale',
        targetVisible,
        lifecycleAction,
        origin,
        elapsed: 0,
        duration: Math.max(0.08, Number(state.transitionScaleDuration) || 0.18),
        fromScale: Number.isFinite(state.appScale) ? state.appScale : (targetVisible ? 0 : 1),
        toScale: targetVisible ? 1 : 0,
    };
}

function createWormholeTransition({ state, targetVisible, lifecycleAction, origin, avatarPos }) {
    const implosion = Math.max(0.08, Number(state.wormholeImplosionDuration) || 0.22);
    const rebound = Math.max(0.12, Number(state.wormholeReboundDuration) || 0.34);
    return {
        effect: 'wormhole',
        targetVisible,
        lifecycleAction,
        origin,
        avatarPos,
        elapsed: 0,
        duration: implosion + rebound,
        implosionDuration: implosion,
        reboundDuration: rebound,
        captureRadius: Math.max(56, Number(state.wormholeCaptureRadius) || 96),
        distortion: Math.max(0.1, Number(state.wormholeDistortionStrength) || 0.82),
        whitePoint: Math.max(0.1, Number(state.wormholeWhitePointIntensity) || 1.0),
        starburst: Math.max(0, Number(state.wormholeStarburstIntensity) || 0.95),
        lensFlare: Math.max(0, Number(state.wormholeLensFlareIntensity) || 0.8),
        seed: Math.random() * Math.PI * 2,
        capture: null,
        captureError: null,
        captureRequested: false,
    };
}

function wormholeAppScale(active) {
    const collapseT = clamp01(active.elapsed / active.implosionDuration);
    const reboundT = clamp01((active.elapsed - active.implosionDuration) / active.reboundDuration);
    if (active.targetVisible) {
        if (active.elapsed <= active.implosionDuration) {
            return lerp(0.02, 0.12, smoothstep(collapseT));
        }
        const release = easeOutBack(reboundT);
        return Math.max(0, 0.08 + (release * 0.92));
    }
    if (active.elapsed <= active.implosionDuration) {
        return Math.max(0, lerp(1, 0.03, smoothstep(collapseT)));
    }
    return Math.max(0, 0.03 * (1 - easeOutCubic(reboundT)));
}

function drawWormholeFrame({ active, ctx, avatarStagePos, originStage, accentA, accentB }) {
    if (!avatarStagePos?.valid) return;
    const progress = clamp01(active.elapsed / active.duration);
    const collapseT = clamp01(active.elapsed / active.implosionDuration);
    const reboundT = clamp01((active.elapsed - active.implosionDuration) / active.reboundDuration);
    const collapse = smoothstep(collapseT);
    const rebound = active.elapsed > active.implosionDuration ? easeOutBack(reboundT) : 0;

    const depth = active.targetVisible
        ? (1 - Math.min(1, rebound * 0.86))
        : Math.min(1, collapse + (reboundT * 0.15));
    const starburst = Math.max(0, active.starburst * (active.targetVisible ? depth : collapse * (1 - (reboundT * 0.25))));
    const flare = Math.max(0, active.lensFlare * (active.targetVisible ? depth : collapse * (1 - reboundT)));
    const patchRadius = active.captureRadius * (1.05 + (0.1 * (1 - progress)));
    const rotation = (active.seed * 0.35) + (progress * 0.65);

    drawWell(ctx, avatarStagePos.x, avatarStagePos.y, patchRadius, depth * active.distortion);

    if (active.capture?.image) {
        drawCurvedCapture(
            ctx,
            active.capture.image,
            avatarStagePos.x,
            avatarStagePos.y,
            patchRadius,
            depth * active.distortion,
            rotation
        );
    }

    drawSnapRing(ctx, avatarStagePos.x, avatarStagePos.y, patchRadius, reboundT, accentB);
    drawStarburst(ctx, avatarStagePos.x, avatarStagePos.y, patchRadius, starburst, active.seed, accentA, accentB);
    drawLensFlare(ctx, avatarStagePos.x, avatarStagePos.y, originStage, patchRadius, flare, accentA);
    drawSingularity(
        ctx,
        avatarStagePos.x,
        avatarStagePos.y,
        patchRadius * 0.08,
        active.whitePoint * (0.7 + (0.3 * (active.targetVisible ? depth : collapse)))
    );
}

export function createVisibilityTransitionController({
    host,
    state,
    liveJs,
    projectStagePoint,
    getExcludedCanvasIds,
}) {
    const overlay = createCanvasOverlay();
    let active = null;

    async function requestWormholeCapture(transition) {
        if (transition.captureRequested || !transition.avatarPos?.valid) return;
        transition.captureRequested = true;
        const nativeCenter = desktopWorldToNativePoint(transition.avatarPos, liveJs.displays) ?? transition.avatarPos;
        const region = {
            x: nativeCenter.x - transition.captureRadius,
            y: nativeCenter.y - transition.captureRadius,
            width: transition.captureRadius * 2,
            height: transition.captureRadius * 2,
        };

        try {
            const result = await host.captureRegion(region, {
                format: 'jpg',
                quality: 'med',
                timeoutMs: 1750,
                excludeCanvasIds: getExcludedCanvasIds(),
            });
            const image = await loadImage(result);
            if (active !== transition) return;
            transition.capture = { image, region: result.region };
        } catch (error) {
            if (active !== transition) return;
            transition.captureError = error;
            console.warn('[sigil] wormhole capture failed:', error);
        }
    }

    function effectFor(targetVisible) {
        const requested = targetVisible ? state.transitionEnterEffect : state.transitionExitEffect;
        return requested === 'wormhole' ? 'wormhole' : 'scale';
    }

    function begin({ targetVisible, lifecycleAction = null, origin = null, avatarPos = null }) {
        const effect = effectFor(targetVisible);
        active = effect === 'wormhole'
            ? createWormholeTransition({ state, targetVisible, lifecycleAction, origin, avatarPos })
            : createScaleTransition({ state, targetVisible, lifecycleAction, origin });

        overlay.mount();
        overlay.clear();
        if (active.effect === 'wormhole') {
            void requestWormholeCapture(active);
        }
        return active;
    }

    function tick(dt, { avatarPos = null } = {}) {
        if (!active) {
            overlay.clear();
            return null;
        }
        active.elapsed += dt;
        if (avatarPos?.valid) {
            active.avatarPos = avatarPos;
        }

        let appScale = state.appScale;
        const progress = clamp01(active.elapsed / active.duration);
        let renderAvatarPos = avatarPos;
        if (active.effect === 'scale') {
            appScale = lerp(active.fromScale, active.toScale, smoothstep(progress));
            if (active.origin && avatarPos?.valid) {
                const travel = smoothstep(progress);
                renderAvatarPos = active.targetVisible
                    ? interpolatePoint(active.origin, avatarPos, travel)
                    : interpolatePoint(avatarPos, active.origin, travel);
            }
            overlay.clear();
        } else {
            appScale = wormholeAppScale(active);
        }

        if (progress >= 1) {
            const completed = {
                targetVisible: active.targetVisible,
                lifecycleAction: active.lifecycleAction,
                appScale: active.effect === 'scale' ? active.toScale : (active.targetVisible ? 1 : 0),
                avatarPos,
            };
            active = null;
            overlay.clear();
            return completed;
        }

        return {
            active: true,
            appScale,
            avatarPos: renderAvatarPos,
        };
    }

    function draw({ avatarStagePos = null } = {}) {
        const ctx = overlay.context();
        if (!ctx) return;
        ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);
        if (!active || active.effect !== 'wormhole' || !avatarStagePos?.valid) return;

        const originStage = active.origin ? projectStagePoint(active.origin) : null;
        const faceColors = state.colors?.face ?? ['#ffffff', '#88ccff'];
        drawWormholeFrame({
            active,
            ctx,
            avatarStagePos,
            originStage,
            accentA: faceColors[0],
            accentB: faceColors[1],
        });
    }

    return {
        mount() {
            overlay.mount();
        },
        begin,
        tick,
        draw,
        clear() {
            overlay.clear();
        },
        destroy() {
            active = null;
            overlay.destroy();
        },
        get active() {
            return active;
        },
    };
}
