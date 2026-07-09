import { toolkitSpecifier } from './content-roots.js';

const {
    createRenderPerformanceSampler,
    finiteOrNull,
} = await import(toolkitSpecifier('runtime/render-performance-sampler.js'));

export const RENDER_PERFORMANCE_CANVAS_ID = 'sigil-render-performance';

export { finiteOrNull };

export function createSigilRenderPerformanceSampler({
    liveState,
    targetId = RENDER_PERFORMANCE_CANVAS_ID,
    isPrimarySurfaceSegment = () => true,
    isPanelVisible = () => false,
    getRendererInfo = () => null,
    getRenderLoopWork = () => null,
    post = () => {},
    warn = () => {},
    throttleMs = 500,
} = {}) {
    if (!liveState || typeof liveState !== 'object') {
        throw new TypeError('createSigilRenderPerformanceSampler requires liveState');
    }
    function telemetry() {
        if (!liveState.renderPerformanceTelemetry) {
            liveState.renderPerformanceTelemetry = { attempted: 0, sent: 0, skipped: null, lastError: null };
        }
        return liveState.renderPerformanceTelemetry;
    }

    const sampler = createRenderPerformanceSampler({
        telemetry,
        source: 'sigil-avatar',
        targetId,
        isEnabled: isPrimarySurfaceSegment,
        isVisible: isPanelVisible,
        getRendererInfo,
        getRenderLoopWork,
        post,
        warn: (...args) => warn(String(args[0]).replace('[toolkit]', '[sigil]'), ...args.slice(1)),
        throttleMs,
    });

    return Object.freeze({
        postSample(sample) {
            const result = sampler.postSample(sample);
            if (result.skipped === 'disabled') {
                telemetry().skipped = 'secondary-segment';
                return { posted: false, skipped: 'secondary-segment' };
            }
            if (result.skipped === 'hidden') {
                telemetry().skipped = 'panel-hidden';
                return { posted: false, skipped: 'panel-hidden' };
            }
            return result;
        },
        reset: sampler.reset,
    });
}
