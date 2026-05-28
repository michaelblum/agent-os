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

function drawSelectionMode(ctx, overlay = {}, snapshot = {}) {
    if (!overlay?.visible) return;
    const time = Number(snapshot.time) || 0;
    const trail = snapshot.selectionTrail || {};
    const trailScale = Math.max(0.4, Number(trail.scale) || 1);
    const lag = Math.max(0, Math.min(0.5, Number(trail.lag) || 0.05));
    const pulse = 0.5 + (0.5 * Math.sin(time * 7));

    ctx.save();
    ctx.lineJoin = 'round';
    for (const frame of overlay.frames || []) {
        const active = frame.active === true;
        const leaf = frame.leaf === true;
        drawFrame(ctx, frame, {
            stroke: active ? 'rgba(94, 252, 210, 0.96)' : (leaf ? 'rgba(255, 224, 120, 0.88)' : 'rgba(170, 210, 255, 0.62)'),
            fill: active ? 'rgba(94, 252, 210, 0.07)' : 'rgba(170, 210, 255, 0.035)',
            dash: active ? [] : [7, 7],
            lineWidth: active ? 2.5 : 1.4,
        });
        const rect = frame.rect || {};
        if (Number.isFinite(rect.x) && Number.isFinite(rect.y)) {
            const label = `${frame.index + 1}`;
            ctx.save();
            ctx.font = '11px system-ui, -apple-system, BlinkMacSystemFont, sans-serif';
            ctx.textBaseline = 'middle';
            ctx.textAlign = 'center';
            ctx.fillStyle = active ? 'rgba(94, 252, 210, 0.96)' : 'rgba(20, 30, 42, 0.86)';
            ctx.strokeStyle = active ? 'rgba(8, 18, 24, 0.94)' : 'rgba(170, 210, 255, 0.74)';
            ctx.lineWidth = 1.5;
            const bx = rect.x + 12;
            const by = rect.y - 10;
            ctx.beginPath();
            ctx.roundRect(bx - 9, by - 9, 18, 18, 5);
            ctx.fill();
            ctx.stroke();
            ctx.fillStyle = active ? 'rgba(8, 18, 24, 0.96)' : 'rgba(255, 255, 255, 0.92)';
            ctx.fillText(label, bx, by + 0.5);
            ctx.restore();
        }
    }

    const cursor = overlay.cursor;
    if (cursor && Number.isFinite(cursor.x) && Number.isFinite(cursor.y)) {
        const tail = 18 * trailScale;
        const tailX = cursor.x - (tail * (0.65 + lag));
        const tailY = cursor.y + (tail * 0.34);
        const gradient = ctx.createLinearGradient(tailX, tailY, cursor.x, cursor.y);
        gradient.addColorStop(0, 'rgba(94, 252, 210, 0)');
        gradient.addColorStop(1, 'rgba(94, 252, 210, 0.82)');
        ctx.lineCap = 'round';
        ctx.globalAlpha = 0.84;
        ctx.beginPath();
        ctx.strokeStyle = gradient;
        ctx.lineWidth = 4 + pulse;
        ctx.moveTo(tailX, tailY);
        ctx.lineTo(cursor.x, cursor.y);
        ctx.stroke();

        ctx.globalAlpha = 0.9;
        ctx.strokeStyle = 'rgba(94, 252, 210, 0.96)';
        ctx.fillStyle = 'rgba(12, 22, 28, 0.45)';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(cursor.x, cursor.y - (14 * trailScale));
        ctx.lineTo(cursor.x + (10 * trailScale), cursor.y + (10 * trailScale));
        ctx.lineTo(cursor.x + (1 * trailScale), cursor.y + (7 * trailScale));
        ctx.lineTo(cursor.x - (7 * trailScale), cursor.y + (15 * trailScale));
        ctx.closePath();
        ctx.fill();
        ctx.stroke();

        ctx.globalAlpha = 0.34 + (0.18 * pulse);
        ctx.beginPath();
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.88)';
        ctx.lineWidth = 1.2;
        ctx.arc(cursor.x, cursor.y, 18 + (pulse * 4), 0, Math.PI * 2);
        ctx.stroke();
    }
    ctx.restore();
}

export function createInteractionOverlay() {
    let canvas = null;
    let resize = null;

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

        if (snapshot.avatarHoverProgress > 0.01 && snapshot.avatarPos?.valid) {
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

        drawSelectionMode(ctx, snapshot.selectionModeOverlay, snapshot);

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
        mount: ensureCanvas,
        draw,
        destroy,
    };
}
