export function createRenderLoopScheduler(requestFrame) {
    let suspended = false;
    let queued = false;

    function schedule(onFrame) {
        if (suspended || queued) return;
        queued = true;
        requestFrame(() => {
            queued = false;
            onFrame();
        });
    }

    return {
        schedule,
        suspend() {
            suspended = true;
        },
        resume() {
            suspended = false;
        },
        get suspended() {
            return suspended;
        },
        get queued() {
            return queued;
        },
    };
}
