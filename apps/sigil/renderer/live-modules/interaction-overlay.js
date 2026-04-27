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
