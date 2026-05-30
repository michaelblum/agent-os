function selectionWave(position = 0, time = 0, seed = 0) {
    return (
        Math.sin(position * 0.047 + time * 2.3 + seed) * 0.55
        + Math.sin(position * 0.113 - time * 3.1 + seed * 1.7) * 0.32
        + Math.sin(position * 0.019 + time * 1.2 + seed * 2.3) * 0.22
    ) / 1.09;
}

function gradientWithAlpha(ctx, x0, y0, x1, y1, color = 'rgba(94, 252, 210, 0.11)') {
    const gradient = ctx.createLinearGradient(x0, y0, x1, y1);
    gradient.addColorStop(0, color);
    gradient.addColorStop(0.58, color.replace(/rgba\(([^)]+),\s*[\d.]+\)/, 'rgba($1, 0.045)'));
    gradient.addColorStop(1, color.replace(/rgba\(([^)]+),\s*[\d.]+\)/, 'rgba($1, 0)'));
    return gradient;
}

function drawWavyPerimeterFill(ctx, rect = {}, perimeter = {}, {
    time = 0,
} = {}) {
    const x = Number(rect.x);
    const y = Number(rect.y);
    const width = Number(rect.width);
    const height = Number(rect.height);
    if (![x, y, width, height].every(Number.isFinite) || width <= 0 || height <= 0) return;
    const maxInset = Math.max(1, Math.min(width, height) * Number(perimeter.marginRatio || 0.15));
    const segmentCount = Math.max(10, Math.ceil((width + height) / 56));
    const amplitude = Math.min(maxInset * 0.42, 18);
    const fill = perimeter.style?.fill || 'rgba(94, 252, 210, 0.11)';
    const line = perimeter.style?.line || 'rgba(142, 221, 255, 0.42)';
    ctx.save();
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';

    function waveDepth(position, seed = 0) {
        return maxInset * (0.56 + ((selectionWave(position, time, seed) + 1) / 2) * 0.44);
    }

    function ringWave(position, seed = 0, ringAmplitude = amplitude) {
        return selectionWave(position, time, seed) * ringAmplitude;
    }

    function clampInsideMargin(value) {
        return Math.max(1, Math.min(maxInset, value));
    }

    function drawTop() {
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x + width, y);
        for (let i = segmentCount; i >= 0; i -= 1) {
            const t = i / segmentCount;
            const px = x + width * t;
            ctx.lineTo(px, y + clampInsideMargin(waveDepth(px, 0.2)));
        }
        ctx.closePath();
        ctx.fillStyle = gradientWithAlpha(ctx, x, y, x, y + maxInset, fill);
        ctx.fill();
    }

    function drawBottom() {
        ctx.beginPath();
        ctx.moveTo(x + width, y + height);
        ctx.lineTo(x, y + height);
        for (let i = 0; i <= segmentCount; i += 1) {
            const t = i / segmentCount;
            const px = x + width * t;
            ctx.lineTo(px, y + height - clampInsideMargin(waveDepth(px, 1.6)));
        }
        ctx.closePath();
        ctx.fillStyle = gradientWithAlpha(ctx, x, y + height, x, y + height - maxInset, fill);
        ctx.fill();
    }

    function drawLeft() {
        ctx.beginPath();
        ctx.moveTo(x, y + height);
        ctx.lineTo(x, y);
        for (let i = 0; i <= segmentCount; i += 1) {
            const t = i / segmentCount;
            const py = y + height * t;
            ctx.lineTo(x + clampInsideMargin(waveDepth(py, 2.4)), py);
        }
        ctx.closePath();
        ctx.fillStyle = gradientWithAlpha(ctx, x, y, x + maxInset, y, fill);
        ctx.fill();
    }

    function drawRight() {
        ctx.beginPath();
        ctx.moveTo(x + width, y);
        ctx.lineTo(x + width, y + height);
        for (let i = segmentCount; i >= 0; i -= 1) {
            const t = i / segmentCount;
            const py = y + height * t;
            ctx.lineTo(x + width - clampInsideMargin(waveDepth(py, 3.3)), py);
        }
        ctx.closePath();
        ctx.fillStyle = gradientWithAlpha(ctx, x + width, y, x + width - maxInset, y, fill);
        ctx.fill();
    }

    drawTop();
    drawRight();
    drawBottom();
    drawLeft();

    ctx.globalAlpha = 0.36;
    ctx.strokeStyle = line;
    ctx.lineWidth = 1;
    for (let ring = 0; ring < 3; ring += 1) {
        const offset = maxInset * (0.28 + ring * 0.22);
        const ringAmplitude = amplitude * (0.55 - ring * 0.12);
        ctx.beginPath();
        for (let i = 0; i <= segmentCount; i += 1) {
            const t = i / segmentCount;
            const px = x + width * t;
            const py = y + clampInsideMargin(offset + ringWave(px, 5 + ring, ringAmplitude));
            if (i === 0) ctx.moveTo(px, py);
            else ctx.lineTo(px, py);
        }
        for (let i = 0; i <= segmentCount; i += 1) {
            const t = i / segmentCount;
            const py = y + height * t;
            const px = x + width - clampInsideMargin(offset + ringWave(py, 9 + ring, ringAmplitude));
            ctx.lineTo(px, py);
        }
        for (let i = segmentCount; i >= 0; i -= 1) {
            const t = i / segmentCount;
            const px = x + width * t;
            const py = y + height - clampInsideMargin(offset + ringWave(px, 13 + ring, ringAmplitude));
            ctx.lineTo(px, py);
        }
        for (let i = segmentCount; i >= 0; i -= 1) {
            const t = i / segmentCount;
            const py = y + height * t;
            const px = x + clampInsideMargin(offset + ringWave(py, 17 + ring, ringAmplitude));
            ctx.lineTo(px, py);
        }
        ctx.closePath();
        ctx.stroke();
    }
    ctx.restore();
}

function drawFrame(ctx, frame = {}, style = {}, options = {}) {
    const rect = frame.rect || {};
    const x = Number(rect.x);
    const y = Number(rect.y);
    const width = Number(rect.width);
    const height = Number(rect.height);
    if (![x, y, width, height].every(Number.isFinite) || width <= 0 || height <= 0) return;
    ctx.save();
    ctx.globalAlpha = Math.max(0, Math.min(1, Number(frame.opacity) || 1));
    ctx.setLineDash(style.dash || []);
    ctx.lineWidth = style.lineWidth || 1.5;
    ctx.strokeStyle = style.stroke || 'rgba(255, 224, 120, 0.9)';
    const fill = style.fill === null ? null : (style.fill || 'rgba(255, 224, 120, 0.04)');
    const perimeterFill = frame.perimeterFill || style.perimeterFill || null;
    if (perimeterFill) drawWavyPerimeterFill(ctx, { x, y, width, height }, perimeterFill, options);
    if (fill) ctx.fillStyle = fill;
    ctx.beginPath();
    ctx.rect(Math.round(x) + 0.5, Math.round(y) + 0.5, Math.round(width), Math.round(height));
    if (fill) ctx.fill();
    ctx.stroke();
    ctx.restore();
}

function selectionCursorProjectionPoints(glyph = {}, time = 0) {
    if (Array.isArray(glyph.outline) && glyph.outline.length) {
        return glyph.outline;
    }
    const geometry = glyph.geometry || {};
    const length = Math.max(8, Number(geometry.length) || 44);
    const base = Math.max(4, Number(geometry.base) || length / 2);
    const axis = { x: Math.SQRT1_2, y: Math.SQRT1_2 };
    const perp = { x: -Math.SQRT1_2, y: Math.SQRT1_2 };
    const rotationSpeed = Math.abs(Number(glyph.animation?.rotation_speed) || 0.1);
    const vitality = Math.max(0.1, Number(glyph.animation?.session_vitality_multiplier) || 1);
    const rotationPhase = 0.72 + (0.28 * Math.sin(time * rotationSpeed * vitality * 120));
    const baseCenter = { x: axis.x * length, y: axis.y * length };
    const halfBase = (base / 2) * rotationPhase;
    return [
        { x: 0, y: 0 },
        { x: baseCenter.x + perp.x * halfBase, y: baseCenter.y + perp.y * halfBase },
        { x: baseCenter.x + axis.x * 7, y: baseCenter.y + axis.y * 7 },
        { x: baseCenter.x - perp.x * halfBase, y: baseCenter.y - perp.y * halfBase },
    ];
}

function drawSelectionCursorModel(ctx, glyph = {}, {
    x = 0,
    y = 0,
    scale = 1,
    alpha = 1,
    pulse = 0,
    time = 0,
    fill = true,
} = {}) {
    const points = selectionCursorProjectionPoints(glyph, time);
    if (!points.length) return;
    const aura = glyph.aura || {};
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(scale, scale);
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.globalAlpha = alpha;

    ctx.shadowColor = aura.primary || glyph.color?.aura_primary || 'rgba(94, 252, 210, 0.96)';
    ctx.shadowBlur = 15 + (pulse * 8);
    ctx.beginPath();
    ctx.moveTo(points[0].x, points[0].y);
    for (const point of points.slice(1)) ctx.lineTo(point.x, point.y);
    ctx.closePath();
    if (fill) {
        ctx.fillStyle = aura.core || 'rgba(12, 22, 28, 0.58)';
        ctx.fill();
    }
    ctx.strokeStyle = aura.primary || glyph.color?.aura_primary || 'rgba(94, 252, 210, 0.96)';
    ctx.lineWidth = 2.2;
    ctx.stroke();

    if (glyph.model_kind === 'sigil_model') {
        const base = points.slice(1);
        ctx.globalAlpha = alpha * 0.58;
        ctx.beginPath();
        ctx.moveTo(points[0].x, points[0].y);
        for (const point of base) {
            ctx.lineTo(point.x - 5, point.y - 2);
            ctx.moveTo(points[0].x, points[0].y);
        }
        ctx.strokeStyle = aura.secondary || glyph.color?.aura_secondary || 'rgba(142, 221, 255, 0.86)';
        ctx.lineWidth = 1.1;
        ctx.stroke();
    }

    ctx.shadowBlur = 0;
    ctx.globalAlpha = alpha * 0.78;
    ctx.beginPath();
    ctx.moveTo(points[0].x, points[0].y);
    for (const point of points.slice(1)) ctx.lineTo(point.x, point.y);
    ctx.closePath();
    ctx.strokeStyle = aura.highlight || 'rgba(255, 255, 255, 0.88)';
    ctx.lineWidth = 0.85;
    ctx.stroke();
    ctx.restore();
}

export function selectionCursorShouldUseCanvasProjection(glyph = null) {
    return !!glyph && glyph.model_kind !== 'sigil_model';
}

export function avatarHoverDecorationVisible(snapshot = {}) {
    return snapshot.avatarVisible === true
        && snapshot.avatarHover === true
        && Number(snapshot.avatarHoverProgress) > 0.01
        && snapshot.avatarPos?.valid === true;
}

function trailPointForAge(history = [], ageSeconds = 0, fallback = null) {
    if (!history.length) return fallback;
    const targetTime = history.at(-1).time - ageSeconds;
    for (let i = history.length - 1; i >= 0; i -= 1) {
        if (history[i].time <= targetTime) return history[i];
    }
    return history[0] || fallback;
}

function recordSelectionCursorTrail(history = [], cursor = null, time = 0, maxAge = 3) {
    if (!cursor || !Number.isFinite(cursor.x) || !Number.isFinite(cursor.y)) {
        history.length = 0;
        return;
    }
    const prior = history.at(-1);
    if (!prior || Math.hypot(prior.x - cursor.x, prior.y - cursor.y) >= 1 || time - prior.time >= 0.024) {
        history.push({ x: cursor.x, y: cursor.y, time });
    }
    while (history.length && time - history[0].time > maxAge) history.shift();
}

function clamp01(value) {
    return Math.max(0, Math.min(1, Number(value) || 0));
}

function easeOutCubic(value) {
    const t = clamp01(value);
    return 1 - Math.pow(1 - t, 3);
}

function easeOutExpo(value) {
    const t = clamp01(value);
    return t >= 1 ? 1 : 1 - Math.pow(2, -10 * t);
}

function seededUnit(seed = 0, index = 0, salt = 0) {
    const value = Math.sin((seed + 1) * 12.9898 + (index + 1) * 78.233 + (salt + 1) * 37.719) * 43758.5453123;
    return value - Math.floor(value);
}

function drawGlowDisk(ctx, x, y, radius, {
    alpha = 1,
    center = 'rgba(255,255,255,0.9)',
    middle = 'rgba(255,255,255,0.24)',
    edge = 'rgba(255,255,255,0)',
} = {}) {
    if (radius <= 0 || alpha <= 0) return;
    const gradient = ctx.createRadialGradient(x, y, 0, x, y, radius);
    gradient.addColorStop(0, center);
    gradient.addColorStop(0.42, middle);
    gradient.addColorStop(1, edge);
    ctx.globalAlpha = alpha;
    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fill();
}

function drawSupernovaParticleCloud(ctx, {
    x,
    y,
    seed,
    timelineT,
    primary,
    secondary,
    highlight,
}) {
    const outward = easeOutExpo(timelineT);
    const inverse = 1 - timelineT;
    const whiteCount = 92;
    for (let i = 0; i < whiteCount; i += 1) {
        const angle = ((i * 2.399963229728653) + seed * 0.021 + seededUnit(seed, i, 2) * 0.22) % (Math.PI * 2);
        const speed = 44 + seededUnit(seed, i, 3) * 130;
        const drift = speed * outward;
        const jitter = (seededUnit(seed, i, 4) - 0.5) * 10 * Math.sin(timelineT * Math.PI);
        const px = x + Math.cos(angle) * (drift + jitter);
        const py = y + Math.sin(angle) * (drift + jitter);
        const tail = 4 + 16 * inverse;
        const alpha = Math.max(0, 1 - timelineT * 0.82)
            * (0.18 + seededUnit(seed, i, 5) * 0.42);
        if (alpha <= 0.002) continue;
        ctx.globalAlpha = alpha;
        ctx.strokeStyle = i % 5 === 0 ? highlight : 'rgba(255,255,255,0.92)';
        ctx.lineWidth = i % 11 === 0 ? 1.8 : 1;
        ctx.beginPath();
        ctx.moveTo(px - Math.cos(angle) * tail, py - Math.sin(angle) * tail);
        ctx.lineTo(px, py);
        ctx.stroke();
    }

    const coloredCount = 118;
    for (let i = 0; i < coloredCount; i += 1) {
        const angle = ((i * 2.399963229728653) + Math.PI * 0.17 + seed * 0.015 + seededUnit(seed, i, 8) * 0.3) % (Math.PI * 2);
        const frictionStop = 0.62 + seededUnit(seed, i, 9) * 0.42;
        const maxDistance = 56 + seededUnit(seed, i, 10) * 170;
        const frictionTravel = 1 - Math.pow(1 - timelineT, 2.8);
        const distance = maxDistance * frictionStop * frictionTravel;
        const px = x + Math.cos(angle) * distance;
        const py = y + Math.sin(angle) * distance * (0.82 + seededUnit(seed, i, 11) * 0.36);
        const tail = 5 + 18 * Math.max(0.12, 1 - timelineT);
        const alpha = Math.max(0, 1 - timelineT * 0.62)
            * (0.14 + seededUnit(seed, i, 12) * 0.5);
        if (alpha <= 0.002) continue;
        ctx.globalAlpha = alpha;
        ctx.strokeStyle = i % 3 === 0 ? primary : (i % 3 === 1 ? secondary : highlight);
        ctx.lineWidth = i % 13 === 0 ? 2 : 1;
        ctx.beginPath();
        ctx.moveTo(px - Math.cos(angle) * tail, py - Math.sin(angle) * tail);
        ctx.lineTo(px, py);
        ctx.stroke();
    }
}

function drawSelectionModeEffect(ctx, effect = {}, styles = {}, {
    time = 0,
    nowMs = Date.now(),
} = {}) {
    const anchor = effect.anchor || {};
    const x = Number(anchor.x);
    const y = Number(anchor.y);
    if (![x, y].every(Number.isFinite)) return;
    const startedAtMs = Number(effect.started_at_ms);
    const durationMs = Math.max(80, Number(effect.duration_ms) || 720);
    const progress = Number.isFinite(startedAtMs)
        ? Math.max(0, Math.min(1, (Number(nowMs) - startedAtMs) / durationMs))
        : Math.max(0, Math.min(1, Number(effect.progress) || 0));
    if (progress >= 1) return;

    const reverse = effect.effect === 'reverse_supernova' || effect.phase === 'exit';
    const timelineT = reverse ? 1 - progress : progress;
    const primary = styles.effect?.primary || styles.aura?.primary || 'rgba(94, 252, 210, 0.96)';
    const secondary = styles.effect?.secondary || styles.aura?.secondary || 'rgba(142, 221, 255, 0.86)';
    const highlight = styles.effect?.highlight || styles.aura?.highlight || 'rgba(255, 255, 255, 0.88)';
    const glow = styles.effect?.glow || styles.aura?.glow || 'rgba(94, 252, 210, 0.34)';
    const shockT = Math.min(1, timelineT / 0.42);
    const shockAlpha = Math.max(0, 1 - Math.pow(shockT, 2));
    const coreT = 1 - timelineT * 0.68;
    const seed = String(effect.id || `${effect.phase}:${effect.started_at_ms || effect.at || ''}`)
        .split('')
        .reduce((acc, char) => (acc + char.charCodeAt(0)) % 997, 0);

    ctx.save();
    ctx.globalCompositeOperation = 'screen';
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.shadowColor = glow;
    ctx.shadowBlur = 28;

    const haloRadius = 46 + 120 * easeOutCubic(timelineT);
    drawGlowDisk(ctx, x, y, haloRadius, {
        alpha: Math.max(0, 0.38 * (1 - timelineT * 0.72)),
        center: highlight,
        middle: primary,
    });

    const shockSphereRadius = Math.max(1, shockT * 190);
    ctx.globalAlpha = 0.55 * shockAlpha;
    ctx.strokeStyle = highlight;
    ctx.lineWidth = Math.max(1, 3.2 * (1 - shockT));
    ctx.beginPath();
    ctx.arc(x, y, shockSphereRadius, 0, Math.PI * 2);
    ctx.stroke();

    const diskRadius = Math.max(1, shockT * 126);
    ctx.globalAlpha = 0.86 * shockAlpha;
    ctx.strokeStyle = primary;
    ctx.lineWidth = Math.max(1, 5.4 * (1 - shockT));
    ctx.beginPath();
    ctx.ellipse(x, y, diskRadius, diskRadius * 0.22, -0.08, 0, Math.PI * 2);
    ctx.stroke();

    const beamCount = 10;
    for (let i = 0; i < beamCount; i += 1) {
        const angle = (i / beamCount) * Math.PI * 2 + time * 0.35 + seed * 0.009;
        const inner = 8 + 14 * (1 - timelineT);
        const outer = 52 + 138 * easeOutCubic(timelineT) * (0.72 + seededUnit(seed, i, 20) * 0.5);
        const alpha = Math.max(0, Math.sin(timelineT * Math.PI) * 0.22);
        if (alpha <= 0.002) continue;
        ctx.globalAlpha = alpha;
        ctx.strokeStyle = i % 2 === 0 ? secondary : primary;
        ctx.lineWidth = i % 3 === 0 ? 2.4 : 1.4;
        ctx.beginPath();
        ctx.moveTo(x + Math.cos(angle) * inner, y + Math.sin(angle) * inner);
        ctx.lineTo(x + Math.cos(angle) * outer, y + Math.sin(angle) * outer);
        ctx.stroke();
    }

    drawSupernovaParticleCloud(ctx, {
        x,
        y,
        seed,
        timelineT,
        primary,
        secondary,
        highlight,
    });

    const dwarfRadius = Math.max(2, 8 + 24 * Math.max(0, coreT));
    drawGlowDisk(ctx, x, y, dwarfRadius * 2.1, {
        alpha: Math.max(0, 0.82 * (1 - timelineT * 0.48)),
        center: 'rgba(255,255,255,1)',
        middle: highlight,
    });

    ctx.globalAlpha = Math.max(0, 0.95 * (1 - timelineT * 0.38));
    ctx.fillStyle = 'rgba(255,255,255,0.95)';
    ctx.beginPath();
    ctx.arc(x, y, dwarfRadius * 0.28, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();
}

function fitLineageText(ctx, text = '', maxWidth = 0) {
    const source = String(text || '');
    if (maxWidth <= 0) return '';
    if (ctx.measureText(source).width <= maxWidth) return source;
    if (maxWidth < 16) return source.slice(0, 1);
    const ellipsis = '...';
    let next = source;
    while (next.length > 1 && ctx.measureText(`${next}${ellipsis}`).width > maxWidth) {
        next = next.slice(0, -1);
    }
    return next.length > 1 ? `${next}${ellipsis}` : source.slice(0, 1);
}

function drawSelectionLineageBar(ctx, lineageBar = {}) {
    if (lineageBar?.visible !== true) return;
    const rect = lineageBar.rect || {};
    const x = Number(rect.x);
    const y = Number(rect.y);
    const width = Number(rect.width);
    const height = Number(rect.height);
    if (![x, y, width, height].every(Number.isFinite) || width <= 0 || height <= 0) return;
    const style = lineageBar.style || {};
    ctx.save();
    ctx.lineJoin = 'round';
    ctx.shadowColor = style.surface?.shadow || 'rgba(94, 252, 210, 0.24)';
    ctx.shadowBlur = 12;
    ctx.fillStyle = style.surface?.fill || 'rgba(8, 12, 18, 0.72)';
    ctx.strokeStyle = style.surface?.stroke || 'rgba(142, 221, 255, 0.54)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.roundRect(Math.round(x) + 0.5, Math.round(y) + 0.5, width, height, 10);
    ctx.fill();
    ctx.stroke();
    ctx.shadowBlur = 0;

    ctx.beginPath();
    ctx.rect(x, y, width, height);
    ctx.clip();

    ctx.font = '11px system-ui, -apple-system, BlinkMacSystemFont, sans-serif';
    ctx.textBaseline = 'middle';

    for (const separator of lineageBar.separators || []) {
        const separatorRect = separator.rect || {};
        const sx = Number(separatorRect.x);
        const sy = Number(separatorRect.y);
        const sw = Number(separatorRect.width);
        const sh = Number(separatorRect.height);
        if (![sx, sy, sw, sh].every(Number.isFinite)) continue;
        ctx.fillStyle = style.separator?.text || 'rgba(238, 248, 255, 0.36)';
        ctx.textAlign = 'center';
        ctx.fillText(separator.label || '>', sx + sw / 2, sy + sh / 2 + 0.5);
    }

    for (const item of lineageBar.items || []) {
        const itemRect = item.rect || {};
        const ix = Number(itemRect.x);
        const iy = Number(itemRect.y);
        const iw = Number(itemRect.width);
        const ih = Number(itemRect.height);
        if (![ix, iy, iw, ih].every(Number.isFinite) || iw <= 0 || ih <= 0) continue;
        const itemStyle = item.hovered
            ? style.hovered
            : (item.selected ? style.selected : style.item);
        ctx.fillStyle = itemStyle?.fill || 'rgba(255, 255, 255, 0.065)';
        ctx.strokeStyle = itemStyle?.stroke || 'rgba(255, 255, 255, 0.1)';
        ctx.lineWidth = item.selected || item.hovered ? 1.3 : 1;
        ctx.beginPath();
        ctx.roundRect(Math.round(ix) + 0.5, Math.round(iy) + 0.5, Math.round(iw), Math.round(ih), 7);
        ctx.fill();
        ctx.stroke();

        if (item.leaf && !item.selected && !item.hovered) {
            ctx.globalAlpha = 0.74;
            ctx.strokeStyle = style.leaf?.stroke || 'rgba(142, 221, 255, 0.82)';
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.roundRect(Math.round(ix + 2) + 0.5, Math.round(iy + 2) + 0.5, Math.max(1, Math.round(iw - 4)), Math.max(1, Math.round(ih - 4)), 5);
            ctx.stroke();
            ctx.globalAlpha = 1;
        }

        ctx.fillStyle = itemStyle?.text || 'rgba(238, 248, 255, 0.9)';
        ctx.textAlign = 'center';
        ctx.fillText(fitLineageText(ctx, item.label || '', Math.max(4, iw - 12)), ix + iw / 2, iy + ih / 2 + 0.5);
    }
    ctx.restore();
}

function activeSelectionModeVisualEffects(overlay = {}, nowMs = Date.now()) {
    if (!Array.isArray(overlay.visualEffects)) return [];
    return overlay.visualEffects.filter((effect) => {
        const startedAtMs = Number(effect?.started_at_ms);
        const durationMs = Number(effect?.duration_ms);
        if (!Number.isFinite(startedAtMs) || !Number.isFinite(durationMs)) return effect?.active === true;
        return Number(nowMs) - startedAtMs < durationMs;
    });
}

function drawSelectionMode(ctx, overlay = {}, snapshot = {}, trailHistory = []) {
    const nowMs = Number(snapshot.wallTimeMs) || Date.now();
    const visualEffects = activeSelectionModeVisualEffects(overlay, nowMs);
    const modeVisible = overlay?.active === true || (overlay?.active !== false && overlay?.visible === true);
    if (!modeVisible && !visualEffects.length) return;
    const time = Number(snapshot.time) || 0;
    const trail = overlay.cursorTrail?.timing || snapshot.selectionModeTrail || snapshot.selectionTrail || {};
    const trailScale = Math.max(0.4, Number(trail.scale) || 1);
    const repeatCount = Math.max(0, Math.min(24, Math.round(Number(trail.repeatCount) || 0)));
    const duration = Math.max(0.05, Number(trail.duration) || 0.22);
    const delay = Math.max(0, Number(trail.delay) || 0);
    const lag = Math.max(0.01, Math.min(0.5, Number(trail.lag) || 0.05));
    const repeatDuration = Math.max(duration, Number(trail.repeatDuration) || 2);
    const pulse = 0.5 + (0.5 * Math.sin(time * 7));
    const cursor = overlay.cursor;
    const glyph = overlay.cursorGlyph;
    const styles = overlay.styles || {};

    recordSelectionCursorTrail(trailHistory, cursor, time, Math.max(1, repeatDuration + 0.5));

    ctx.save();
    ctx.lineJoin = 'round';
    for (const effect of visualEffects) {
        drawSelectionModeEffect(ctx, effect, styles, { time, nowMs });
    }
    if (!modeVisible) {
        ctx.restore();
        return;
    }
    for (const frame of overlay.frames || []) {
        const active = frame.active === true;
        const leaf = frame.leaf === true;
        drawFrame(ctx, frame, {
            stroke: frame.style?.stroke || (active ? 'rgba(94, 252, 210, 0.58)' : (leaf ? 'rgba(255, 224, 120, 0.48)' : 'rgba(170, 210, 255, 0.22)')),
            fill: frame.style?.fill ?? null,
            dash: active || leaf ? [] : [5, 10],
            lineWidth: active ? 1.8 : 1,
        }, { time });
    }

    drawSelectionLineageBar(ctx, overlay.lineageBar);

    if (cursor && Number.isFinite(cursor.x) && Number.isFinite(cursor.y) && selectionCursorShouldUseCanvasProjection(glyph)) {
        for (let i = repeatCount; i >= 1; i -= 1) {
            const age = delay + (duration * lag * i);
            const sample = trailPointForAge(trailHistory, age, cursor);
            const progress = i / Math.max(1, repeatCount);
            const mode = String(trail.trailMode || 'fade');
            const alpha = mode === 'hold'
                ? 0.18 + (0.25 * (1 - progress))
                : Math.max(0.04, 0.38 * (1 - progress));
            drawSelectionCursorModel(ctx, glyph, {
                x: sample.x,
                y: sample.y,
                scale: Math.max(0.36, trailScale * (0.58 + (1 - progress) * 0.2)),
                alpha,
                pulse: 0,
                time: sample.time,
                fill: false,
            });
        }
        drawSelectionCursorModel(ctx, glyph, {
            x: cursor.x,
            y: cursor.y,
            scale: Math.max(0.42, trailScale * 0.62),
            alpha: 0.96,
            pulse,
            time,
            fill: true,
        });
    }
    ctx.restore();
}

function fastTravelLineGesture(snapshot = {}) {
    if (snapshot.radialGesture?.phase === 'fastTravel' && snapshot.radialGesture.origin && snapshot.radialGesture.pointer) {
        return snapshot.radialGesture;
    }
    if (snapshot.fastTravelGesture?.phase === 'fastTravel' && snapshot.fastTravelGesture.origin && snapshot.fastTravelGesture.pointer) {
        return snapshot.fastTravelGesture;
    }
    return null;
}

export function createInteractionOverlay() {
    let canvas = null;
    let resize = null;
    const selectionCursorTrail = [];

    function ensureCanvas() {
        if (canvas) return canvas;
        canvas = document.createElement('canvas');
        canvas.style.position = 'absolute';
        canvas.style.inset = '0';
        canvas.style.zIndex = '3';
        canvas.style.pointerEvents = 'none';
        document.body.appendChild(canvas);

        resize = () => {
            const dpr = window.devicePixelRatio || 1;
            canvas.width = Math.floor(window.innerWidth * dpr);
            canvas.height = Math.floor(window.innerHeight * dpr);
            canvas.style.width = window.innerWidth + 'px';
            canvas.style.height = window.innerHeight + 'px';
            const ctx = canvas.getContext('2d');
            ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        };
        resize();
        window.addEventListener('resize', resize);
        return canvas;
    }

    function draw(snapshot) {
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        ctx.clearRect(0, 0, canvas.width, canvas.height);

        if (snapshot.state === 'GOTO' && snapshot.avatarPos?.valid) {
            ctx.beginPath();
            ctx.setLineDash([6, 6]);
            ctx.strokeStyle = 'rgba(180, 220, 255, 0.8)';
            ctx.lineWidth = 2;
            ctx.arc(snapshot.avatarPos.x, snapshot.avatarPos.y, snapshot.gotoRingRadius, 0, Math.PI * 2);
            ctx.stroke();
            ctx.setLineDash([]);
            return;
        }

        if (avatarHoverDecorationVisible(snapshot)) {
            const progress = Math.max(0, Math.min(1, snapshot.avatarHoverProgress));
            const radius = (snapshot.avatarHitRadius || 40) + (7 * progress);
            ctx.save();
            ctx.globalAlpha = 0.82 * progress;
            ctx.beginPath();
            ctx.strokeStyle = 'rgba(125, 248, 215, 0.9)';
            ctx.lineWidth = 1.5 + progress;
            ctx.arc(snapshot.avatarPos.x, snapshot.avatarPos.y, radius, 0, Math.PI * 2);
            ctx.stroke();
            ctx.beginPath();
            ctx.strokeStyle = 'rgba(255, 255, 255, 0.24)';
            ctx.lineWidth = 1;
            ctx.arc(snapshot.avatarPos.x, snapshot.avatarPos.y, radius + 5, 0, Math.PI * 2);
            ctx.stroke();
            ctx.restore();
        }

        if (snapshot.radialGesture?.phase === 'radial' && snapshot.radialGesture.origin) {
            const radial = snapshot.radialGesture;
            const origin = radial.origin;
            const menuRadius = radial.radii?.menu ?? snapshot.menuRingRadius;
            const handoffRadius = radial.radii?.handoff ?? menuRadius;

            ctx.save();
            ctx.globalAlpha = 0.9;
            ctx.beginPath();
            ctx.strokeStyle = 'rgba(130, 220, 255, 0.55)';
            ctx.lineWidth = 1.5;
            ctx.arc(origin.x, origin.y, menuRadius * radial.menuProgress, 0, Math.PI * 2);
            ctx.stroke();

            ctx.beginPath();
            ctx.setLineDash([5, 8]);
            ctx.strokeStyle = 'rgba(255, 255, 255, 0.2)';
            ctx.lineWidth = 1;
            ctx.arc(origin.x, origin.y, handoffRadius, 0, Math.PI * 2);
            ctx.stroke();
            ctx.setLineDash([]);

            ctx.restore();
            return;
        }

        const lineGesture = fastTravelLineGesture(snapshot);
        if (
            snapshot.state === 'FAST_TRAVEL'
            && snapshot.fastTravelEffect === 'line'
            && lineGesture
        ) {
            const radial = lineGesture;
            const origin = radial.origin;
            const pointer = radial.pointer;
            const dx = pointer.x - origin.x;
            const dy = pointer.y - origin.y;
            const length = Math.hypot(dx, dy);
            if (length > 1) {
                const nx = dx / length;
                const ny = dy / length;
                const pulse = 0.5 + (0.5 * Math.sin((snapshot.time || 0) * 8));
                const handoffRadius = radial.radii?.handoff ?? snapshot.menuRingRadius;
                const startX = origin.x + (nx * Math.min(handoffRadius, length - 1));
                const startY = origin.y + (ny * Math.min(handoffRadius, length - 1));
                const annotationReticle = snapshot.annotationReticle?.active === true;
                const arrowLength = Math.min(24, Math.max(12, length * 0.11));
                const wing = Math.PI * 0.78;
                const tailFade = Math.min(1, Math.max(0.18, (length - handoffRadius) / Math.max(1, handoffRadius * 0.72)));
                const glowGradient = ctx.createLinearGradient(startX, startY, pointer.x, pointer.y);
                glowGradient.addColorStop(0, annotationReticle ? 'rgba(244, 197, 66, 0)' : 'rgba(83, 245, 215, 0)');
                glowGradient.addColorStop(
                    Math.min(0.42, 0.18 + (0.18 * tailFade)),
                    annotationReticle ? 'rgba(244, 197, 66, 0.46)' : 'rgba(83, 245, 215, 0.42)'
                );
                glowGradient.addColorStop(1, annotationReticle ? 'rgba(255, 224, 120, 0.96)' : 'rgba(83, 245, 215, 0.95)');
                const dashGradient = ctx.createLinearGradient(startX, startY, pointer.x, pointer.y);
                dashGradient.addColorStop(0, 'rgba(255, 255, 255, 0)');
                dashGradient.addColorStop(
                    Math.min(0.48, 0.22 + (0.18 * tailFade)),
                    annotationReticle ? 'rgba(255, 223, 126, 0.46)' : 'rgba(255, 255, 255, 0.42)'
                );
                dashGradient.addColorStop(1, annotationReticle ? 'rgba(255, 243, 176, 0.9)' : 'rgba(255, 255, 255, 0.86)');

                ctx.save();
                ctx.lineCap = 'round';
                ctx.lineJoin = 'round';

                ctx.globalAlpha = 0.32 + (0.16 * pulse);
                ctx.beginPath();
                ctx.strokeStyle = glowGradient;
                ctx.lineWidth = 7;
                ctx.moveTo(startX, startY);
                ctx.lineTo(pointer.x, pointer.y);
                ctx.stroke();

                ctx.globalAlpha = 0.9;
                ctx.setLineDash([10, 7]);
                ctx.lineDashOffset = -((snapshot.time || 0) * 42);
                ctx.beginPath();
                ctx.strokeStyle = dashGradient;
                ctx.lineWidth = 2;
                ctx.moveTo(startX, startY);
                ctx.lineTo(pointer.x, pointer.y);
                ctx.stroke();
                ctx.setLineDash([]);

                ctx.beginPath();
                ctx.strokeStyle = annotationReticle ? 'rgba(255, 224, 120, 0.96)' : 'rgba(83, 245, 215, 0.95)';
                ctx.lineWidth = 2.2;
                ctx.arc(pointer.x, pointer.y, 13 + (pulse * 3), 0, Math.PI * 2);
                ctx.stroke();

                const angle = Math.atan2(dy, dx);
                if (annotationReticle) {
                    const cross = 10 + (pulse * 2);
                    ctx.beginPath();
                    ctx.moveTo(pointer.x - cross, pointer.y);
                    ctx.lineTo(pointer.x + cross, pointer.y);
                    ctx.moveTo(pointer.x, pointer.y - cross);
                    ctx.lineTo(pointer.x, pointer.y + cross);
                    ctx.stroke();
                } else {
                    ctx.beginPath();
                    ctx.moveTo(pointer.x, pointer.y);
                    ctx.lineTo(
                        pointer.x + Math.cos(angle + wing) * arrowLength,
                        pointer.y + Math.sin(angle + wing) * arrowLength
                    );
                    ctx.moveTo(pointer.x, pointer.y);
                    ctx.lineTo(
                        pointer.x + Math.cos(angle - wing) * arrowLength,
                        pointer.y + Math.sin(angle - wing) * arrowLength
                    );
                    ctx.stroke();
                }

                ctx.globalAlpha = 0.38;
                ctx.beginPath();
                ctx.strokeStyle = 'rgba(255, 255, 255, 0.7)';
                ctx.lineWidth = 1;
                ctx.arc(origin.x, origin.y, Math.max(10, snapshot.avatarHitRadius * 0.42), 0, Math.PI * 2);
                ctx.stroke();
                ctx.restore();
            }
        }

        const annotationOverlay = snapshot.annotationReticleOverlay;
        if (annotationOverlay?.visible) {
            ctx.save();
            ctx.lineJoin = 'round';
            for (const frame of annotationOverlay.frames || []) {
                drawFrame(ctx, frame, {
                    stroke: frame.active ? 'rgba(255, 224, 120, 0.96)' : 'rgba(255, 224, 120, 0.72)',
                    fill: 'rgba(255, 224, 120, 0.035)',
                    dash: frame.active ? [] : [10, 8],
                    lineWidth: frame.active ? 2.4 : 1.6,
                });
            }
            for (const anchor of annotationOverlay.anchors || []) {
                drawFrame(ctx, anchor, {
                    stroke: 'rgba(255, 245, 176, 0.82)',
                    fill: 'rgba(255, 245, 176, 0.05)',
                    dash: [5, 5],
                    lineWidth: 1.5,
                });
            }
            if (annotationOverlay.hover) {
                drawFrame(ctx, annotationOverlay.hover, {
                    stroke: 'rgba(255, 255, 255, 0.9)',
                    fill: 'rgba(255, 255, 255, 0.04)',
                    dash: [4, 4],
                    lineWidth: 1.4,
                });
            }
            ctx.restore();
        }

        drawSelectionMode(ctx, snapshot.selectionModeOverlay, snapshot, selectionCursorTrail);

    }

    function clear() {
        if (canvas) {
            const ctx = canvas.getContext('2d');
            ctx.clearRect(0, 0, canvas.width, canvas.height);
        }
        selectionCursorTrail.length = 0;
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
        selectionCursorTrail.length = 0;
    }

    return {
        mount: ensureCanvas,
        draw,
        clear,
        destroy,
    };
}
