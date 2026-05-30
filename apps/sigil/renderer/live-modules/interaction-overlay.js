function drawFrame(ctx, frame = {}, style = {}) {
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
    ctx.fillStyle = style.fill || 'rgba(255, 224, 120, 0.04)';
    ctx.beginPath();
    ctx.rect(Math.round(x) + 0.5, Math.round(y) + 0.5, Math.round(width), Math.round(height));
    ctx.fill();
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

function drawSelectionModeEffect(ctx, effect = {}, styles = {}, {
    time = 0,
    nowMs = Date.now(),
} = {}) {
    const anchor = effect.anchor || {};
    const x = Number(anchor.x);
    const y = Number(anchor.y);
    if (![x, y].every(Number.isFinite)) return;
    const startedAtMs = Number(effect.started_at_ms);
    const durationMs = Math.max(80, Number(effect.duration_ms) || 520);
    const progress = Number.isFinite(startedAtMs)
        ? Math.max(0, Math.min(1, (Number(nowMs) - startedAtMs) / durationMs))
        : Math.max(0, Math.min(1, Number(effect.progress) || 0));
    if (progress >= 1) return;

    const reverse = effect.effect === 'reverse_supernova' || effect.phase === 'exit';
    const primary = styles.effect?.primary || styles.aura?.primary || 'rgba(94, 252, 210, 0.96)';
    const secondary = styles.effect?.secondary || styles.aura?.secondary || 'rgba(142, 221, 255, 0.86)';
    const highlight = styles.effect?.highlight || styles.aura?.highlight || 'rgba(255, 255, 255, 0.88)';
    const glow = styles.effect?.glow || styles.aura?.glow || 'rgba(94, 252, 210, 0.34)';
    const travel = reverse ? 1 - progress : progress;
    const c4 = (2 * Math.PI) / 3;
    const novaScale = reverse
        ? Math.pow(Math.max(0, travel), 3)
        : (progress === 0 ? 0 : progress === 1 ? 1 : Math.pow(2, -10 * progress) * Math.sin((progress * 10 - 0.75) * c4) + 1);
    const shock = reverse ? 1 - Math.pow(1 - progress, 3) : Math.min(1, progress / 0.42);
    const shockAlpha = Math.max(0, 1 - Math.pow(shock, 2));
    const particleT = reverse ? 1 - progress : progress;
    const particleAlpha = reverse ? Math.max(0, 1 - progress * 0.9) : Math.max(0, 1 - progress * 0.78);
    const seed = String(effect.id || `${effect.phase}:${effect.started_at_ms || effect.at || ''}`)
        .split('')
        .reduce((acc, char) => (acc + char.charCodeAt(0)) % 997, 0);

    ctx.save();
    ctx.globalCompositeOperation = 'screen';
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.shadowColor = glow;
    ctx.shadowBlur = 18;

    const shockSphereRadius = Math.max(1, shock * 96);
    ctx.globalAlpha = 0.5 * shockAlpha;
    ctx.strokeStyle = highlight;
    ctx.lineWidth = Math.max(1, 2.4 * (1 - shock));
    ctx.beginPath();
    ctx.arc(x, y, shockSphereRadius, 0, Math.PI * 2);
    ctx.stroke();

    const diskRadius = Math.max(1, shock * 54);
    ctx.globalAlpha = 0.8 * shockAlpha;
    ctx.strokeStyle = primary;
    ctx.lineWidth = Math.max(1, 4.2 * (1 - shock));
    ctx.beginPath();
    ctx.ellipse(x, y, diskRadius, diskRadius * 0.24, 0, 0, Math.PI * 2);
    ctx.stroke();

    const particleCount = 54;
    for (let i = 0; i < particleCount; i += 1) {
        const angle = ((i * 2.399963229728653) + seed * 0.017) % (Math.PI * 2);
        const speed = 22 + ((i * 37 + seed) % 64);
        const distance = reverse ? speed * (1 - particleT) : speed * particleT;
        const px = x + Math.cos(angle) * distance;
        const py = y + Math.sin(angle) * distance;
        const tail = reverse ? Math.max(2, 7 * particleT) : Math.max(2, 7 * (1 - particleT));
        ctx.globalAlpha = particleAlpha * (0.26 + ((i % 5) * 0.035));
        ctx.strokeStyle = i % 3 === 0 ? highlight : (i % 2 === 0 ? primary : secondary);
        ctx.lineWidth = i % 7 === 0 ? 1.5 : 1;
        ctx.beginPath();
        ctx.moveTo(px - Math.cos(angle) * tail, py - Math.sin(angle) * tail);
        ctx.lineTo(px, py);
        ctx.stroke();
    }

    const glowRadius = Math.max(8, 32 * Math.max(0.18, novaScale));
    const coreGlow = ctx.createRadialGradient(x, y, 0, x, y, glowRadius);
    coreGlow.addColorStop(0, highlight);
    coreGlow.addColorStop(0.35, primary);
    coreGlow.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.globalAlpha = reverse ? 0.72 * Math.max(0, 1 - progress) : 0.72 * Math.max(0, 1 - progress * 0.65);
    ctx.fillStyle = coreGlow;
    ctx.beginPath();
    ctx.arc(x, y, glowRadius, 0, Math.PI * 2);
    ctx.fill();

    ctx.globalAlpha = reverse ? Math.max(0, 0.9 * (1 - progress)) : Math.max(0, 0.92 * (1 - progress * 0.45));
    ctx.fillStyle = highlight;
    ctx.beginPath();
    ctx.arc(x, y, Math.max(1.4, 4.2 * Math.max(0.2, novaScale)), 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
}

function drawSelectionBadge(ctx, badge = {}, styles = {}) {
    const rect = badge.rect || {};
    const x = Number(rect.x);
    const y = Number(rect.y);
    const width = Number(rect.width);
    const height = Number(rect.height);
    if (![x, y, width, height].every(Number.isFinite) || width <= 0 || height <= 0) return;
    const active = badge.active === true;
    const leaf = badge.leaf === true;
    const token = badge.token || '';
    const key = token === 'display' || token === 'body' || token === 'app' || token === 'window';
    const badgeStyle = active
        ? styles.badge?.active
        : (leaf ? { ...styles.badge?.inactive, ...styles.badge?.leaf } : styles.badge?.inactive);
    ctx.save();
    ctx.lineJoin = 'round';
    ctx.shadowColor = badgeStyle?.shadow || (active ? 'rgba(94, 252, 210, 0.84)' : (key ? 'rgba(142, 221, 255, 0.52)' : 'rgba(94, 252, 210, 0.42)'));
    ctx.shadowBlur = active ? 16 : 8;
    ctx.fillStyle = badgeStyle?.fill || (active
        ? 'rgba(8, 24, 26, 0.88)'
        : (leaf ? 'rgba(29, 27, 18, 0.82)' : 'rgba(11, 17, 26, 0.78)'));
    ctx.strokeStyle = badgeStyle?.stroke || (active
        ? 'rgba(94, 252, 210, 0.96)'
        : (key ? 'rgba(142, 221, 255, 0.9)' : 'rgba(170, 210, 255, 0.72)'));
    ctx.lineWidth = active ? 2.3 : 1.4;
    ctx.beginPath();
    ctx.roundRect(Math.round(x) + 0.5, Math.round(y) + 0.5, width, height, 8);
    ctx.fill();
    ctx.stroke();

    if (leaf || active) {
        ctx.shadowBlur = 0;
        ctx.globalAlpha = active ? 0.92 : 0.72;
        ctx.beginPath();
        ctx.strokeStyle = leaf ? (badgeStyle?.ring || styles.badge?.leaf?.ring || 'rgba(255, 224, 120, 0.88)') : (styles.highlight?.stroke || 'rgba(255, 255, 255, 0.82)');
        ctx.lineWidth = 1;
        ctx.roundRect(Math.round(x - 3) + 0.5, Math.round(y - 3) + 0.5, width + 6, height + 6, 10);
        ctx.stroke();
        ctx.globalAlpha = 1;
    }

    ctx.shadowBlur = 0;
    ctx.font = `${badge.kind === 'secondary' ? 10 : 12}px system-ui, -apple-system, BlinkMacSystemFont, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = badgeStyle?.text || (active ? 'rgba(214, 255, 245, 0.98)' : 'rgba(238, 248, 255, 0.94)');
    ctx.fillText(String(badge.label || ''), x + width / 2, y + height / 2 + 0.5);
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
            fill: frame.style?.fill || (active ? 'rgba(94, 252, 210, 0.035)' : 'rgba(170, 210, 255, 0.018)'),
            dash: active || leaf ? [] : [5, 10],
            lineWidth: active ? 1.8 : 1,
        });
    }

    for (const group of overlay.badgeGroups || []) {
        const primary = (overlay.badges || []).find((badge) => badge.id === group.primaryId);
        if (!primary || !group.secondaryIds?.length) continue;
        for (const secondaryId of group.secondaryIds) {
            const secondary = overlay.badges.find((badge) => badge.id === secondaryId);
            if (!secondary) continue;
            ctx.save();
            ctx.globalAlpha = 0.5;
            ctx.strokeStyle = styles.connector?.stroke || 'rgba(142, 221, 255, 0.42)';
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(primary.rect.x + primary.rect.width / 2, primary.rect.y + primary.rect.height / 2);
            ctx.lineTo(secondary.rect.x + secondary.rect.width / 2, secondary.rect.y + secondary.rect.height / 2);
            ctx.stroke();
            ctx.restore();
        }
    }
    for (const badge of overlay.badges || []) {
        drawSelectionBadge(ctx, badge, styles);
    }

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

export function createInteractionOverlay() {
    let canvas = null;
    let resize = null;
    const selectionCursorTrail = [];

    function ensureCanvas() {
        if (canvas) return canvas;
        canvas = document.createElement('canvas');
        canvas.style.position = 'absolute';
        canvas.style.inset = '0';
        canvas.style.zIndex = '0';
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

        if (
            snapshot.state === 'FAST_TRAVEL'
            && snapshot.fastTravelEffect === 'line'
            && snapshot.radialGesture?.phase === 'fastTravel'
            && snapshot.radialGesture.origin
            && snapshot.radialGesture.pointer
        ) {
            const radial = snapshot.radialGesture;
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
