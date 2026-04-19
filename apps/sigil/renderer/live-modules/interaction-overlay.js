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

        if (snapshot.state === 'DRAG' && snapshot.dragOrigin) {
            if (snapshot.pointerPos) {
                ctx.beginPath();
                ctx.setLineDash([4, 6]);
                ctx.strokeStyle = 'rgba(255, 220, 240, 0.85)';
                ctx.lineWidth = 2;
                ctx.moveTo(snapshot.dragOrigin.x, snapshot.dragOrigin.y);
                ctx.lineTo(snapshot.pointerPos.x, snapshot.pointerPos.y);
                ctx.stroke();
                ctx.setLineDash([]);
            }
            ctx.beginPath();
            ctx.strokeStyle = 'rgba(255, 180, 220, 0.9)';
            ctx.lineWidth = 2;
            ctx.arc(snapshot.dragOrigin.x, snapshot.dragOrigin.y, snapshot.menuRingRadius, 0, Math.PI * 2);
            ctx.stroke();

            ctx.beginPath();
            ctx.strokeStyle = 'rgba(255, 180, 220, 0.35)';
            ctx.lineWidth = 1;
            ctx.arc(snapshot.dragOrigin.x, snapshot.dragOrigin.y, snapshot.dragCancelRadius, 0, Math.PI * 2);
            ctx.stroke();
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
