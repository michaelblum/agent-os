export function createInteractionOverlay() {
    let canvas = null;
    let resize = null;

    function ensureCanvas() {
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
                const arrowLength = Math.min(24, Math.max(12, length * 0.11));
                const wing = Math.PI * 0.78;

                ctx.save();
                ctx.lineCap = 'round';
                ctx.lineJoin = 'round';

                ctx.globalAlpha = 0.32 + (0.16 * pulse);
                ctx.beginPath();
                ctx.strokeStyle = 'rgba(83, 245, 215, 0.95)';
                ctx.lineWidth = 7;
                ctx.moveTo(startX, startY);
                ctx.lineTo(pointer.x, pointer.y);
                ctx.stroke();

                ctx.globalAlpha = 0.9;
                ctx.setLineDash([10, 7]);
                ctx.lineDashOffset = -((snapshot.time || 0) * 42);
                ctx.beginPath();
                ctx.strokeStyle = 'rgba(255, 255, 255, 0.82)';
                ctx.lineWidth = 2;
                ctx.moveTo(startX, startY);
                ctx.lineTo(pointer.x, pointer.y);
                ctx.stroke();
                ctx.setLineDash([]);

                ctx.beginPath();
                ctx.strokeStyle = 'rgba(83, 245, 215, 0.95)';
                ctx.lineWidth = 2.2;
                ctx.arc(pointer.x, pointer.y, 13 + (pulse * 3), 0, Math.PI * 2);
                ctx.stroke();

                const angle = Math.atan2(dy, dx);
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

                ctx.globalAlpha = 0.38;
                ctx.beginPath();
                ctx.strokeStyle = 'rgba(255, 255, 255, 0.7)';
                ctx.lineWidth = 1;
                ctx.arc(origin.x, origin.y, Math.max(10, snapshot.avatarHitRadius * 0.42), 0, Math.PI * 2);
                ctx.stroke();
                ctx.restore();
            }
        }

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
