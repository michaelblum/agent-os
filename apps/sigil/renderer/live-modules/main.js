import state from '../state.js';
import { updateGeometry, updateOmegaGeometry, updateInnerEdgePulse } from '../geometry.js';
import { updateAllColors } from '../colors.js';
import { createAuraObjects, animateAura } from '../aura.js';
import {
    createPhenomena,
    animatePhenomena,
    updatePulsars,
    updateGammaRays,
    updateAccretion,
    updateNeutrinos,
} from '../phenomena.js';
import { createParticleObjects, animateParticles, animateTrails } from '../particles.js';
import { createLightning, animateLightning } from '../lightning.js';
import { createMagneticField, animateMagneticField, updateMagneticTentacleCount } from '../magnetic.js';
import { createOmega, animateOmega, resetOmegaInterdimensionalTrail } from '../omega.js';
import { animateSkins } from '../skins.js';
import { applyAppearance, snapshotAppearance, DEFAULT_APPEARANCE } from '../appearance.js';
import { resolveBirthplace } from '../birthplace-resolver.js';
import { classifyRenderLoopWork, createRenderLoopScheduler, renderLoopContinuationReasons } from './render-loop.js';
import { createHostRuntime } from './host-runtime.js';
import { createInteractionOverlay } from './interaction-overlay.js';
import { createHitTargetController } from './hit-target.js';
import { createInteractionTrace } from './interaction-trace.js';
import { createVisibilityTransitionController } from './visibility-transition.js';
import { DesktopWorldSurface3D } from './desktop-world-surface-runtime.js';
import { normalizeCanvasOriginInputMessage, normalizeMessage } from './input-message.js';
import {
    clampPointToDisplays,
    computeDesktopWorldBounds,
    computeVisibleDesktopWorldBounds,
    desktopWorldToNativePoint,
    globalToUnionLocalPoint,
    nativeToDesktopWorldPoint,
    nativeToDesktopWorldRect,
    normalizeDisplays,
    normalizeCanvasFrameToDesktopWorld,
    canvasLocalRectToDesktopWorld,
} from './display-utils.js';
import { createFastTravelController } from './fast-travel.js';
import { createSigilRadialGestureMenu } from './radial-gesture-menu.js';
import { radialItemPointerMetrics } from './radial-gesture-runtime.js';
import { createRadialActivationTransitionController } from './radial-activation-transition.js';
import { createRadialMenuTargetSurface } from './radial-menu-target-surface.js';
import { createSigilRadialGestureVisuals } from './radial-gesture-visuals.js';
import { createSigilRadialItemActionDispatcher } from './radial-item-action-dispatch.js';
import {
    annotationReticleReleaseDisposition,
    buildAnnotationReticleOverlayModel,
    clearAnnotationReticleSemanticCandidatesForCanvas,
    createAnnotationReticleAcquisitionState,
    createAnnotationReticleTargetEvidenceCache,
    CANVAS_INSPECTOR_ANNOTATION_OPEN_EVENT,
    createSigilAnnotationReticleController,
    recordAnnotationReticleSemanticCandidateIds,
    reticleOuterMarginExit,
    SIGIL_ANNOTATION_CAMERA_ITEM_ID,
    SIGIL_ANNOTATION_RETICLE_ITEM_ID,
} from './annotation-reticle.js';
import { advanceMenuActivation } from './menu-activation-runtime.js';
import { createSigilInputRegionAdapter } from './input-regions.js';
import {
    createAvatarDoubleClickTracker,
} from './selection-mode-input.js';
import {
    createDefaultSelectionModeState,
    createSigilSelectionModeRuntime,
    resolveSigilAvatarIdleRotation,
    selectionModeOverlayHasActiveEffects,
} from './selection-mode-runtime.js';
import { createSelectionModeCursorModelRenderer } from './selection-mode-cursor-model-renderer.js';
import {
    createDefaultActiveContextState,
    createDefaultContextRecordingState,
    createSigilContextRecordingRuntime,
} from './context-recording-runtime.js';
import {
    contextMenuOpenCommandOpened,
    resolveContextMenuRightClickRoute,
} from './context-menu-input.js';
import {
    currentSigilRoot,
    currentToolkitRoot,
    sigilUrl,
    toolkitSpecifier,
    toolkitUrl,
    withQuery,
} from './content-roots.js';
import {
    SIGIL_OBJECT_CONTROL_CANVAS_ID,
    applyRadialMenuObjectTransformPatch,
} from './radial-object-control.js';
import { buildAvatarObjectRegistry } from './avatar-object-control.js';
import { createSigilUxTree, createSigilUxTreeShadowResolver } from './ux-tree.js';
import {
    createSigilUxTreeCommandRuntime,
    executeSigilUxTreeCommand,
} from './ux-tree-command-registry.js';
import { createSigilUxTreeReadinessAudit } from './ux-tree-readiness.js';
import { createSigilContextMenu } from '../../context-menu/menu.js';
import { loadAgent } from '../agent-loader.js';
import { createSessionVitalityController } from '../session-vitality.js';

const {
    buildNativeAxElementAnnotationCandidate,
    buildNativeWindowAnnotationCandidate,
} = await import(toolkitSpecifier('workbench/annotation-candidates.js'));
const {
    buildSemanticTargetProjectionAdapterResult,
} = await import(toolkitSpecifier('workbench/annotation-projection.js'));
const {
    BROWSER_DOM_ELEMENT_PICKER_ADAPTER_ID,
    buildBrowserDomElementAnnotationCandidate,
} = await import(toolkitSpecifier('workbench/browser-dom-element-picker.js'));
const {
    writeClipboardText,
} = await import(toolkitSpecifier('runtime/canvas.js'));

const host = createHostRuntime();
const interactionTrace = createInteractionTrace({
    storageKey: 'sigil.interactionTrace.captures',
});
const desktopWorldSurface = (
    typeof window !== 'undefined'
    && window.__aosSurfaceCanvasId
    && window.__aosSegmentDisplayId !== undefined
)
    ? new DesktopWorldSurface3D({ host, canvasId: window.__aosSurfaceCanvasId })
    : null;
const overlay = createInteractionOverlay();
const hitTarget = createHitTargetController({
    runtime: host,
    url: sigilUrl('renderer/hit-area.html'),
    size: state.avatarHitRadius * 2,
    id: 'sigil-hit-avatar-main',
});
const radialTargetSurface = createRadialMenuTargetSurface({
    runtime: host,
    url: sigilUrl('renderer/radial-menu-surface.html'),
    id: 'sigil-radial-menu-avatar-main',
});

const liveJs = {
    avatarPos: { x: 0, y: 0, valid: false },
    avatarSize: 1.0,
    pointerPos: { x: 0, y: 0 },
    avatarHover: false,
    avatarHoverProgress: 0,
    avatarParking: null,
    currentCursor: { x: 0, y: 0, valid: false },
    cursorTarget: { x: 0, y: 0, valid: false },
    globalBounds: { x: 0, y: 0, w: 0, h: 0, minX: 0, minY: 0, maxX: 0, maxY: 0 },
    visibleBounds: { x: 0, y: 0, w: 0, h: 0, minX: 0, minY: 0, maxX: 0, maxY: 0 },
    displays: [],
    currentState: 'IDLE',
    state: 'IDLE',
    currentAgentId: 'default',
    currentAgentDefinition: null,
    avatarHitRadius: state.avatarHitRadius,
    dragThreshold: state.dragThreshold,
    dragCancelRadius: state.dragCancelRadius,
    gotoRingRadius: state.gotoRingRadius,
    menuRingRadius: state.menuRingRadius,
    radialGestureMenu: null,
    travel: null,
    fastTravelEvents: [],
    mousedownPos: null,
    mousedownAvatarPos: null,
    avatarVisible: false,
    contextMenu: { open: false, bounds: null, stack: null },
    utilityCanvases: new Map(),
    utilityCanvasOpenPromises: new Map(),
    defaultAvatarSave: { dirty: false, saving: false, lastSavedAt: null, lastError: null },
    sessionVitality: null,
    lastRadialActivation: null,
    annotationReticle: null,
    selectionMode: createDefaultSelectionModeState(),
    selectionModeOverlay: null,
    selectionModeCursorModel: null,
    uxCommandRuntime: {
        lastExecution: null,
        executedCount: 0,
        fallbackCount: 0,
        trace: [],
    },
    activeContext: createDefaultActiveContextState(),
    contextRecording: createDefaultContextRecordingState(),
    annotationReticleTargetEvidence: createAnnotationReticleTargetEvidenceCache(),
    annotationReticleBrowserDomBridge: null,
    annotationReticleEvents: [],
    appearanceVersion: 0,
    appliedAppearanceVersion: null,
    lastPublishedAppearanceVersion: null,
    surfaceRenderSnapshot: null,
    surfaceRenderSnapshotReceivedAt: null,
    renderPerformanceTelemetry: { attempted: 0, sent: 0, skipped: null, lastError: null },
    renderLoop: { queued: false, suspended: false, mode: 'idle', continuationReasons: [], lastFrameAt: null },
    _resolveFirstDisplayGeometry: null,
    _pendingLifecycleComplete: null,
};
const AGENT_TERMINAL_CANVAS_ID = 'sigil-agent-terminal';
const LEGACY_CODEX_TERMINAL_CANVAS_ID = 'sigil-codex-terminal';
const AGENT_TERMINAL_URL = sigilUrl('agent-terminal/index.html', {
    query: {
        port: 17761,
        session: 'sigil-agent-terminal-agent-os',
    },
});
const AGENT_TERMINAL_PARK_SCALE = 0.24;
const WIKI_WORKBENCH_CANVAS_ID = 'sigil-wiki-workbench';
const WIKI_WORKBENCH_DEFAULT_PATH = 'aos/concepts/employer-brand-workflow-map.md';
const SIGIL_CONTENT_ROOT = currentSigilRoot();
const TOOLKIT_CONTENT_ROOT = currentToolkitRoot();
const WIKI_WORKBENCH_URL = toolkitUrl('components/wiki-subject-browser/index.html');
const WIKI_WORKBENCH_DEFAULT_URL = withQuery(WIKI_WORKBENCH_URL, {
    wiki: WIKI_WORKBENCH_DEFAULT_PATH,
    transition: 'fade-in',
});
const RENDER_PERFORMANCE_CANVAS_ID = 'sigil-render-performance';
const STATUS_PARK_SCALE = 0.2;

window.liveJs = liveJs;
window.state = state;
window.applyAppearance = applyAppearance;

let sigilUxCommandRuntime = null;
let radialGestureMenu = null;

const contextRecordingRuntime = createSigilContextRecordingRuntime({
    liveState: liveJs,
    rendererState: state,
});

const selectionModeRuntime = createSigilSelectionModeRuntime({
    liveState: liveJs,
    rendererState: state,
    getPointer: () => liveJs.pointerPos,
    getDisplays: () => liveJs.displays,
    getCandidateList: () => annotationReticleCandidateList(),
    projectPoint: (point) => stagePoint(point),
    getOverlayBounds: () => ({ x: 0, y: 0, w: window.innerWidth, h: window.innerHeight }),
    closeContextMenu: (reason) => contextMenu.close(reason),
    exitAnnotationReticle,
    clearGestureState,
    syncInputRegions: syncSigilInputRegions,
    scheduleRenderFrame,
    clearSelectionModeEntryReleasePending,
    consumeSelectionModeEntryRelease,
    isOnAvatar,
    consumeAvatarDoubleClick,
    setActiveContextProvider: contextRecordingRuntime.setActiveContextProvider,
    executeCommand: executeSelectionModeRouteCommand,
});

const SIGIL_RENDERER_RUNTIME = {
    entrypoint: 'renderer/live-modules/main.js',
    loadedAt: new Date().toISOString(),
    loadedAtMs: Date.now(),
    moduleUrl: import.meta.url,
};
window.__sigilRendererRuntime = SIGIL_RENDERER_RUNTIME;
window.__sigilBootTrace = [];
window.__sigilBootError = null;
window.__sigilBootFirstFrameAt = null;

let rendererSuspended = false;
const renderLoop = createRenderLoopScheduler(requestAnimationFrame);
const IDLE_AVATAR_MOTION_FRAME_DELAY_MS = 33;
let structuralFrameDirty = true;
let radialGestureVisuals = null;
let selectionModeCursorModelRenderer = null;
let lastRenderPerformanceFrameAt = null;
let lastRenderPerformanceSampleAt = 0;
const sessionVitality = createSessionVitalityController({
    now: () => performance.now(),
});
const DEFAULT_AGENT_WIKI_PATH = 'sigil/agents/default';
const DEFAULT_AGENT_WIKI_URL = `/wiki/${DEFAULT_AGENT_WIKI_PATH}.md`;
const INPUT_POINTER_EVENT_TYPES = new Set([
    'left_mouse_down',
    'left_mouse_up',
    'left_mouse_dragged',
    'right_mouse_down',
    'right_mouse_up',
    'right_mouse_dragged',
    'other_mouse_down',
    'other_mouse_up',
    'other_mouse_dragged',
    'mouse_moved',
    'scroll_wheel',
]);

let sigilInputRegions = null;

function nativeFrameForAvatar() {
    if (!liveJs.avatarPos.valid) return null;
    const center = desktopWorldToNativePoint(liveJs.avatarPos, liveJs.displays) || liveJs.avatarPos;
    const size = Math.max(1, Math.round(liveJs.avatarHitRadius * 2));
    const half = size / 2;
    return [
        Math.round(center.x - half),
        Math.round(center.y - half),
        size,
        size,
    ];
}

function nativeFrameForSelectionMode() {
    const bounds = liveJs.visibleBounds?.w > 0 && liveJs.visibleBounds?.h > 0
        ? liveJs.visibleBounds
        : liveJs.globalBounds;
    if (!bounds || bounds.w <= 0 || bounds.h <= 0) return null;
    const origin = desktopWorldToNativePoint({ x: bounds.x, y: bounds.y, valid: true }, liveJs.displays)
        || { x: bounds.x, y: bounds.y };
    const opposite = desktopWorldToNativePoint({ x: bounds.x + bounds.w, y: bounds.y + bounds.h, valid: true }, liveJs.displays)
        || { x: bounds.x + bounds.w, y: bounds.y + bounds.h };
    const x = Math.round(Math.min(origin.x, opposite.x));
    const y = Math.round(Math.min(origin.y, opposite.y));
    const w = Math.max(1, Math.round(Math.abs(opposite.x - origin.x) || bounds.w));
    const h = Math.max(1, Math.round(Math.abs(opposite.y - origin.y) || bounds.h));
    return [x, y, w, h];
}

function removeSigilInputRegions() {
    sigilInputRegions?.removeAll();
}

function syncSigilInputRegions() {
    sigilInputRegions?.sync();
}

function boundsWithMinMax(rect) {
    if (!rect || typeof rect.x !== 'number' || typeof rect.y !== 'number'
        || typeof rect.w !== 'number' || typeof rect.h !== 'number') return null;
    return {
        x: rect.x, y: rect.y, w: rect.w, h: rect.h,
        minX: rect.x, minY: rect.y,
        maxX: rect.x + rect.w, maxY: rect.y + rect.h,
    };
}

function recordBoot(stage, extra = {}) {
    const entry = { ts: Date.now(), stage, ...extra };
    window.__sigilBootTrace.push(entry);
    if (window.__sigilBootTrace.length > 64) window.__sigilBootTrace.shift();
    if (extra.error) window.__sigilBootError = entry;
    if (stage.startsWith('boot:')) {
        console.debug('[sigil][boot]', stage, entry);
    }
}

function bootElapsedMs() {
    const first = window.__sigilBootTrace[0];
    return first ? Date.now() - first.ts : 0;
}

function recordBootDuration(stage, startedAt, extra = {}) {
    recordBoot(stage, {
        ...extra,
        duration_ms: Math.round(performance.now() - startedAt),
        boot_elapsed_ms: bootElapsedMs(),
    });
}

function recordInteraction(stage, data = {}) {
    interactionTrace.record(stage, {
        ...data,
        state: liveJs.currentState,
        contextMenuOpen: contextMenu?.isOpen?.() ?? false,
        avatarVisible: liveJs.avatarVisible,
        avatarPos: liveJs.avatarPos,
    });
}

function runBootStep(stage, fn) {
    recordBoot(stage);
    try {
        const result = fn();
        if (result && typeof result.then === 'function') {
            return result.catch((error) => {
                recordBoot(stage, {
                    error: String(error),
                    stack: error && error.stack ? String(error.stack) : null,
                });
                throw error;
            });
        }
        return result;
    } catch (error) {
        recordBoot(stage, {
            error: String(error),
            stack: error && error.stack ? String(error.stack) : null,
        });
        throw error;
    }
}

function scheduleRenderFrame(options = {}) {
    if (options.structural !== false) structuralFrameDirty = true;
    renderLoop.schedule(animate, options);
}

function updateRenderLoopDebug(mode = renderLoop.lastMode, continuationReasons = []) {
    liveJs.renderLoop = {
        queued: renderLoop.queued,
        delayed: renderLoop.delayed,
        suspended: renderLoop.suspended || rendererSuspended,
        mode,
        continuationReasons,
        structuralDirty: structuralFrameDirty,
        work: liveJs.renderLoop?.work ?? null,
        lastFrameAt: Date.now(),
    };
}

function currentRenderLoopContinuationReasons(vitalityFrame = state.sessionVitality) {
    const radialGesture = liveJs.radialGestureMenu;
    return renderLoopContinuationReasons({
        rendererSuspended,
        visibilityTransitionActive: !!visibilityTransition.active,
        fastTravelActive: !!liveJs.travel,
        radialActivationTransitionActive: radialActivationTransition.active(),
        radialGestureActive: !!radialGesture && radialGesture.phase !== 'idle',
        contextMenuOpen: contextMenu?.isOpen?.() ?? false,
        annotationReticleActive: !!annotationReticle.active,
        selectionModeActive: liveJs.selectionMode?.active === true,
        selectionModeEffectActive: selectionModeOverlayHasActiveEffects(liveJs.selectionModeOverlay, Date.now()),
        avatarMotionActive: liveJs.avatarVisible
            && !state.isPaused
            && Number(vitalityFrame?.rotationMultiplier ?? 1) !== 0,
        currentState: liveJs.currentState,
        avatarHover: liveJs.avatarHover && liveJs.avatarVisible,
        avatarHoverProgress: liveJs.avatarHoverProgress,
        sessionVitalityRefreshing: liveJs.sessionVitality?.refreshing,
        sessionVitalityFlickerAmount: vitalityFrame?.flickerAmount,
    });
}

function isPrimarySurfaceSegment() {
    return !desktopWorldSurface || desktopWorldSurface.isPrimary;
}

function shouldProcessGlobalDaemonEvent(msg = {}) {
    if (isPrimarySurfaceSegment()) return true;
    if (
        msg.type === 'status_item.toggle'
        || msg.type === 'status_item.show'
        || msg.type === 'status_item.hide'
    ) return false;
    if (msg.type === 'display_geometry') return false;
    if (msg.type === 'input_event' || msg.envelope_type === 'input_event') return false;
    if (msg.type === 'canvas_message' && msg.id === hitTarget.hit.id) return false;
    if (msg.type === 'canvas_message' && msg.id === radialTargetSurface.id) return false;
    return true;
}

function topologyDisplay(segment) {
    const dw = segment?.dw_bounds || [0, 0, 0, 0];
    const native = segment?.native_bounds || dw;
    return {
        id: segment.display_id,
        display_id: segment.display_id,
        cgID: segment.display_id,
        is_main: segment.index === 0,
        width: dw[2],
        height: dw[3],
        bounds: { x: dw[0], y: dw[1], w: dw[2], h: dw[3] },
        visible_bounds: { x: dw[0], y: dw[1], w: dw[2], h: dw[3] },
        desktop_world_bounds: { x: dw[0], y: dw[1], w: dw[2], h: dw[3] },
        visible_desktop_world_bounds: { x: dw[0], y: dw[1], w: dw[2], h: dw[3] },
        native_bounds: { x: native[0], y: native[1], w: native[2], h: native[3] },
        native_visible_bounds: { x: native[0], y: native[1], w: native[2], h: native[3] },
        scale_factor: 1,
    };
}

function syncTopologyDisplays(topology = []) {
    if (!Array.isArray(topology) || topology.length === 0) return;
    liveJs.displays = normalizeDisplays(topology.map(topologyDisplay));
    liveJs.globalBounds = computeDesktopWorldBounds(liveJs.displays);
    liveJs.visibleBounds = computeVisibleDesktopWorldBounds(liveJs.displays);
    if (typeof liveJs._resolveFirstDisplayGeometry === 'function') {
        const resolve = liveJs._resolveFirstDisplayGeometry;
        liveJs._resolveFirstDisplayGeometry = null;
        recordBoot('boot:firstDisplayGeometry', { displays: liveJs.displays.length, boot_elapsed_ms: bootElapsedMs() });
        resolve(liveJs.displays);
    }
    if (!rendererSuspended) scheduleRenderFrame();
}

function applySurfaceRenderSnapshot(snapshot) {
    if (!snapshot || typeof snapshot !== 'object') return;
    if (
        snapshot.appearance
        && Number.isFinite(snapshot.appearanceVersion)
        && snapshot.appearanceVersion !== liveJs.appliedAppearanceVersion
    ) {
        applyAppearance(snapshot.appearance);
        liveJs.appliedAppearanceVersion = snapshot.appearanceVersion;
    }
    if (snapshot.avatarPos?.valid) liveJs.avatarPos = { ...snapshot.avatarPos };
    if (snapshot.renderAvatarPos?.valid) {
        liveJs.surfaceRenderSnapshot = snapshot;
        liveJs.surfaceRenderSnapshotReceivedAt = performance.now();
    }
    if (snapshot.pointerPos) liveJs.pointerPos = { ...snapshot.pointerPos };
    if (typeof snapshot.avatarHover === 'boolean') liveJs.avatarHover = snapshot.avatarHover;
    if (Number.isFinite(snapshot.avatarHoverProgress)) liveJs.avatarHoverProgress = snapshot.avatarHoverProgress;
    if ('mousedownPos' in snapshot) {
        liveJs.mousedownPos = snapshot.mousedownPos ? { ...snapshot.mousedownPos } : null;
    }
    if ('mousedownAvatarPos' in snapshot) {
        liveJs.mousedownAvatarPos = snapshot.mousedownAvatarPos ? { ...snapshot.mousedownAvatarPos } : null;
    }
    if ('radialGestureMenu' in snapshot) {
        liveJs.radialGestureMenu = snapshot.radialGestureMenu || null;
        radialGestureMenu.applySnapshot(liveJs.radialGestureMenu);
    }
    if (typeof snapshot.avatarVisible === 'boolean') liveJs.avatarVisible = snapshot.avatarVisible;
    if (snapshot.currentState) {
        liveJs.currentState = snapshot.currentState;
        liveJs.state = snapshot.currentState;
    }
    if (Number.isFinite(snapshot.appScale)) state.appScale = snapshot.appScale;
    if (Number.isFinite(snapshot.globalTime)) state.globalTime = snapshot.globalTime;
    if (snapshot.omega && typeof snapshot.omega === 'object') {
        if (typeof snapshot.omega.enabled === 'boolean') state.isOmegaEnabled = snapshot.omega.enabled;
        if (typeof snapshot.omega.interDimensional === 'boolean') state.omegaInterDimensional = snapshot.omega.interDimensional;
    }
    if (snapshot.contextMenu && typeof snapshot.contextMenu === 'object') {
        contextMenu.applySnapshot(snapshot.contextMenu);
    }
    if (snapshot.annotationReticle && typeof snapshot.annotationReticle === 'object') {
        annotationReticle.applySnapshot(snapshot.annotationReticle);
        syncAnnotationReticleSnapshot();
    }
    fastTravel.applySnapshot(snapshot.fastTravel);
    syncOmegaTrailToTravelOrigin();
    if (!rendererSuspended) scheduleRenderFrame();
}

function surfaceRenderSnapshot(renderAvatarPos) {
    const snapshot = {
        avatarPos: liveJs.avatarPos,
        renderAvatarPos,
        pointerPos: liveJs.pointerPos,
        avatarHover: liveJs.avatarHover,
        avatarHoverProgress: liveJs.avatarHoverProgress,
        mousedownPos: liveJs.mousedownPos,
        mousedownAvatarPos: liveJs.mousedownAvatarPos,
        radialGestureMenu: liveJs.radialGestureMenu,
        avatarVisible: liveJs.avatarVisible,
        currentState: liveJs.currentState,
        appScale: state.appScale,
        globalTime: state.globalTime,
        appearanceVersion: liveJs.appearanceVersion,
        omega: {
            enabled: state.isOmegaEnabled,
            interDimensional: state.omegaInterDimensional,
        },
        contextMenu: contextMenu?.snapshot?.(),
        fastTravel: fastTravel.exportSnapshot(),
        annotationReticle: liveJs.annotationReticle,
    };
    if (liveJs.lastPublishedAppearanceVersion !== liveJs.appearanceVersion) {
        snapshot.appearance = snapshotAppearance();
        liveJs.lastPublishedAppearanceVersion = liveJs.appearanceVersion;
    }
    return snapshot;
}

function desktopWorldToSegmentLocalPoint(point) {
    if (!point) return null;
    const dw = desktopWorldSurface?.segment?.dw_bounds;
    if (Array.isArray(dw) && dw.length >= 4) {
        return {
            x: point.x - dw[0],
            y: point.y - dw[1],
            valid: point.valid ?? true,
        };
    }
    const local = globalToUnionLocalPoint(point, liveJs.globalBounds);
    if (!local) return null;
    return {
        ...local,
        valid: point.valid ?? true,
    };
}

function stagePoint(point) {
    return desktopWorldToSegmentLocalPoint(point);
}

function projectRadialGestureSnapshot(radial) {
    if (!radial || typeof radial !== 'object') return null;
    return {
        ...radial,
        origin: stagePoint(radial.origin),
        pointer: stagePoint(radial.pointer),
        items: Array.isArray(radial.items)
            ? radial.items.map((item) => ({
                ...item,
                center: stagePoint(item.center),
            }))
            : [],
    };
}

function avatarDefinition() {
    return {
        kind: 'sigil.avatar.appearance',
        version: 1,
        exportedAt: new Date().toISOString(),
        appearance: snapshotAppearance(),
    };
}

function avatarDefinitionJson() {
    return JSON.stringify(avatarDefinition(), null, 2);
}

async function loadDefaultAvatarDefinition({ apply = true } = {}) {
    const agent = await loadAgent(DEFAULT_AGENT_WIKI_PATH);
    liveJs.currentAgentDefinition = agent;
    liveJs.currentAgentId = agent.id || 'default';
    if (apply && agent.appearance) applyAppearance(agent.appearance);
    recordBoot('boot:defaultAvatarLoaded', { agent_id: liveJs.currentAgentId });
    return agent;
}

function applyDefaultAvatarDefinition(agent = liveJs.currentAgentDefinition) {
    if (agent?.appearance) applyAppearance(agent.appearance);
}

function replaceDefaultAvatarAppearance(markdown, appearance) {
    const match = markdown.match(/```json\s*\n([\s\S]*?)\n```/);
    const body = match ? JSON.parse(match[1]) : { version: 1, minds: {}, instance: {} };
    body.version = body.version ?? 1;
    body.appearance = appearance;
    const json = JSON.stringify(body, null, 2);
    if (!match) return `${markdown.trimEnd()}\n\n\`\`\`json\n${json}\n\`\`\`\n`;
    return `${markdown.slice(0, match.index)}\`\`\`json\n${json}\n\`\`\`${markdown.slice(match.index + match[0].length)}`;
}

let defaultAvatarDirty = false;
let defaultAvatarSaveInFlight = false;

function updateDefaultAvatarSaveState(next = {}) {
    liveJs.defaultAvatarSave = {
        ...liveJs.defaultAvatarSave,
        dirty: defaultAvatarDirty,
        saving: defaultAvatarSaveInFlight,
        ...next,
    };
}

async function saveDefaultAvatarDefinition(reason = 'menu-close') {
    if (defaultAvatarSaveInFlight) return false;
    defaultAvatarSaveInFlight = true;
    updateDefaultAvatarSaveState({ lastError: null });
    try {
        const response = await fetch(DEFAULT_AGENT_WIKI_URL);
        if (!response.ok) throw new Error(`GET ${DEFAULT_AGENT_WIKI_URL} failed: HTTP ${response.status}`);
        const markdown = await response.text();
        const appearance = snapshotAppearance();
        const next = replaceDefaultAvatarAppearance(markdown, appearance);
        const put = await fetch(DEFAULT_AGENT_WIKI_URL, {
            method: 'PUT',
            headers: { 'Content-Type': 'text/markdown; charset=utf-8' },
            body: next,
        });
        if (!put.ok) throw new Error(`PUT ${DEFAULT_AGENT_WIKI_URL} failed: HTTP ${put.status}`);
        if (liveJs.currentAgentDefinition) {
            liveJs.currentAgentDefinition = { ...liveJs.currentAgentDefinition, appearance };
        }
        updateDefaultAvatarSaveState({
            lastSavedAt: new Date().toISOString(),
            lastSavedReason: reason,
            lastSavedFastTravel: appearance.transitions?.fastTravel ?? null,
        });
        recordBoot('save:defaultAvatar', { reason });
        return true;
    } finally {
        defaultAvatarSaveInFlight = false;
        updateDefaultAvatarSaveState();
    }
}

async function handleContextMenuClose({ reason = 'close' } = {}) {
    if (!defaultAvatarDirty) return;
    const shouldSave = window.confirm('Save changes?');
    if (!shouldSave) {
        defaultAvatarDirty = false;
        updateDefaultAvatarSaveState({ lastSkippedReason: reason });
        recordBoot('save:defaultAvatarSkipped', { reason });
        return;
    }
    try {
        await saveDefaultAvatarDefinition(reason);
        defaultAvatarDirty = false;
        updateDefaultAvatarSaveState();
    } catch (error) {
        updateDefaultAvatarSaveState({ lastError: error.message || String(error) });
        console.warn('[sigil] default avatar save failed:', error);
        window.alert?.(`Failed to save changes: ${error.message || String(error)}`);
    }
}

async function writeClipboard(text) {
    try {
        await writeClipboardText(text);
        return true;
    } catch (_) {}
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.setAttribute('readonly', '');
    textarea.style.position = 'fixed';
    textarea.style.left = '-9999px';
    document.body.appendChild(textarea);
    textarea.select();
    try {
        return document.execCommand('copy');
    } finally {
        textarea.remove();
    }
}

function saveTextFile(filename, text) {
    const blob = new Blob([text], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function appearanceFromAvatarDefinitionText(text) {
    const parsed = JSON.parse(text);
    if (parsed?.kind === 'sigil.avatar.appearance' && parsed.appearance) return parsed.appearance;
    if (parsed?.appearance) return parsed.appearance;
    return parsed;
}

function importAvatarDefinitionText(text) {
    const appearance = appearanceFromAvatarDefinitionText(text);
    applyAppearance(appearance);
    markAppearanceChanged();
    return true;
}

let appliedAvatarWindowLevel = null;

function normalizeAvatarWindowLevel(level) {
    return level === 'screen_saver' ? 'screen_saver' : 'status_bar';
}

function applyAvatarWindowLevel(level = state.avatarWindowLevel) {
    const normalized = normalizeAvatarWindowLevel(level);
    state.avatarWindowLevel = normalized;
    if (!isPrimarySurfaceSegment()) return;
    if (appliedAvatarWindowLevel === normalized) return;
    appliedAvatarWindowLevel = normalized;
    host.canvasUpdate({ id: 'avatar-main', window_level: normalized });
}

async function handleAvatarMenuAction(action) {
    const json = avatarDefinitionJson();
    if (action === 'copy') {
        try {
            await writeClipboard(json);
        } catch (error) {
            console.warn('[sigil] clipboard write failed; showing avatar JSON fallback:', error);
            window.prompt('Copy Sigil avatar JSON', json);
        }
        return false;
    }
    if (action === 'save') {
        const stamp = new Date().toISOString().replace(/[:.]/g, '-');
        saveTextFile(`sigil-avatar-${stamp}.json`, json);
        return false;
    }
    if (action === 'import') {
        const text = window.prompt('Paste Sigil avatar JSON');
        if (!text) return false;
        return importAvatarDefinitionText(text);
    }
    return false;
}

const contextMenu = createSigilContextMenu({
    state,
    liveJs,
    projectPoint: desktopWorldToSegmentLocalPoint,
    updateGeometry,
    updateOmegaGeometry,
    updateAllColors,
    updatePulsars,
    updateGammaRays,
    updateAccretion,
    updateNeutrinos,
    updateMagneticTentacleCount,
    onAppearanceChange: markAppearanceChanged,
    onUtilityAction: toggleUtilityCanvas,
    onAvatarAction: handleAvatarMenuAction,
    onAvatarWindowLevelChange: applyAvatarWindowLevel,
    onBoundsChange: syncSigilInputRegions,
    onClose: handleContextMenuClose,
    trace: interactionTrace,
});
sigilInputRegions = createSigilInputRegionAdapter({
    host,
    liveState: liveJs,
    fallbackCanvasId: 'avatar-main',
    windowObject: window,
    isPrimarySegment: isPrimarySurfaceSegment,
    avatarNativeFrame: nativeFrameForAvatar,
    avatarRegionEnabled: () => !hitTarget.hit.interactive,
    contextMenuIsOpen: () => contextMenu.isOpen(),
    contextMenuNativeFrame: () => nativeFrameFromDesktopRect(contextMenu.interactiveBounds()),
    selectionModeIsActive: () => liveJs.selectionMode?.active === true,
    selectionModeNativeFrame: nativeFrameForSelectionMode,
});
const UTILITY_CANVAS_IDS = new Set([
    '__log__',
    'surface-inspector',
    'surface-inspector',
    'sigil-interaction-trace',
    RENDER_PERFORMANCE_CANVAS_ID,
    WIKI_WORKBENCH_CANVAS_ID,
    AGENT_TERMINAL_CANVAS_ID,
    LEGACY_CODEX_TERMINAL_CANVAS_ID,
]);

function markAppearanceChanged() {
    liveJs.appearanceVersion += 1;
    defaultAvatarDirty = true;
    updateDefaultAvatarSaveState({ lastError: null });
    emitRadialMenuObjectRegistry();
    if (!rendererSuspended) scheduleRenderFrame();
}

state._onAppearanceChanged = () => {
    applyAvatarWindowLevel();
    if (!rendererSuspended) scheduleRenderFrame();
};

function mainDisplayVisibleBounds() {
    const displays = liveJs.displays || [];
    const display = displays.find((entry) => entry.index === 0 || entry.is_main || entry.isMain)
        || displays[0];
    return display?.visibleBounds || display?.visible_bounds || display?.bounds || liveJs.visibleBounds;
}

function utilityFrame(kind) {
    const visible = mainDisplayVisibleBounds() || { x: 0, y: 0, w: 1512, h: 875 };
    if (kind === 'log-console') {
        const width = Math.min(520, Math.max(420, visible.w * 0.32));
        const height = Math.min(320, Math.max(260, visible.h * 0.32));
        return [
            Math.round(visible.x + 20),
            Math.round(visible.y + visible.h - height - 20),
            Math.round(width),
            Math.round(height),
        ];
    }
    if (kind === 'sigil-interaction-trace') {
        const width = Math.min(760, Math.max(620, visible.w * 0.42));
        const height = Math.min(620, Math.max(480, visible.h * 0.58));
        return [
            Math.round(visible.x + 20),
            Math.round(visible.y + 20),
            Math.round(width),
            Math.round(height),
        ];
    }
    if (kind === 'render-performance') {
        const width = Math.min(560, Math.max(460, visible.w * 0.36));
        const height = Math.min(560, Math.max(460, visible.h * 0.52));
        return [
            Math.round(visible.x + visible.w - width - 20),
            Math.round(visible.y + visible.h - height - 20),
            Math.round(width),
            Math.round(height),
        ];
    }
    if (kind === 'wiki-workbench') {
        const width = Math.min(1180, Math.max(840, visible.w * 0.72));
        const height = Math.min(760, Math.max(560, visible.h * 0.74));
        return [
            Math.round(visible.x + (visible.w - width) / 2),
            Math.round(visible.y + 48),
            Math.round(width),
            Math.round(height),
        ];
    }

    const width = Math.min(360, Math.max(320, visible.w * 0.26));
    const height = Math.min(520, Math.max(420, visible.h * 0.55));
    return [
        Math.round(visible.x + visible.w - width - 20),
        Math.round(visible.y + 20),
        Math.round(width),
        Math.round(height),
    ];
}

function utilityConfig(kind) {
    if (kind === 'log-console') {
        return {
            id: '__log__',
            url: toolkitUrl('components/log-console/index.html'),
            frame: utilityFrame(kind),
        };
    }
    if (kind === 'sigil-interaction-trace') {
        return {
            id: 'sigil-interaction-trace',
            url: sigilUrl('diagnostics/interaction-trace/index.html'),
            frame: utilityFrame(kind),
        };
    }
    if (kind === 'render-performance') {
        return {
            id: RENDER_PERFORMANCE_CANVAS_ID,
            url: toolkitUrl('components/render-performance/index.html'),
            frame: utilityFrame(kind),
        };
    }
    if (kind === 'wiki-workbench') {
        return {
            id: WIKI_WORKBENCH_CANVAS_ID,
            url: WIKI_WORKBENCH_DEFAULT_URL,
            frame: utilityFrame(kind),
        };
    }
    if (kind === 'agent-terminal' || kind === 'codex-terminal') {
        const visible = mainDisplayVisibleBounds() || { x: 0, y: 0, w: 1512, h: 875 };
        const previousWidth = Math.min(920, Math.max(720, visible.w * 0.58));
        const width = Math.round(previousWidth * 2 / 3);
        const height = Math.min(620, Math.max(480, visible.h * 0.58));
        const defaultFrame = [
            Math.round(visible.x + visible.w - width - 28),
            Math.round(visible.y + visible.h - height - 28),
            Math.round(width),
            Math.round(height),
        ];
        return {
            id: AGENT_TERMINAL_CANVAS_ID,
            url: AGENT_TERMINAL_URL,
            frame: defaultFrame,
        };
    }
    return {
        id: 'surface-inspector',
        url: toolkitUrl('components/surface-inspector/index.html'),
        frame: utilityFrame(kind),
    };
}

function agentTerminalFrame() {
    return utilityConfig('agent-terminal').frame;
}

function agentTerminalState() {
    return liveJs.utilityCanvases.get(AGENT_TERMINAL_CANVAS_ID)
        || liveJs.utilityCanvases.get(LEGACY_CODEX_TERMINAL_CANVAS_ID)
        || null;
}

function isAgentTerminalCanvasId(id) {
    return id === AGENT_TERMINAL_CANVAS_ID || id === LEGACY_CODEX_TERMINAL_CANVAS_ID;
}

function isAgentTerminalVisible() {
    const current = agentTerminalState();
    return liveJs.avatarParking?.mode === 'terminal' || (!!current && current.suspended !== true);
}

function isUtilityCanvasVisible(id) {
    const current = liveJs.utilityCanvases.get(id);
    return !!current && current.suspended !== true;
}

function finiteOrNull(value) {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
}

function postRenderPerformanceSample({ frameStartedAt, renderStartedAt, renderEndedAt }) {
    liveJs.renderPerformanceTelemetry.attempted += 1;
    if (!isPrimarySurfaceSegment()) {
        liveJs.renderPerformanceTelemetry.skipped = 'secondary-segment';
        return;
    }
    if (!isUtilityCanvasVisible(RENDER_PERFORMANCE_CANVAS_ID)) {
        liveJs.renderPerformanceTelemetry.skipped = 'panel-hidden';
        lastRenderPerformanceFrameAt = null;
        return;
    }
    const now = renderEndedAt;
    const frameMs = lastRenderPerformanceFrameAt == null ? null : now - lastRenderPerformanceFrameAt;
    lastRenderPerformanceFrameAt = now;
    if (now - lastRenderPerformanceSampleAt < 500) {
        liveJs.renderPerformanceTelemetry.skipped = 'throttled';
        return;
    }
    if (!Number.isFinite(frameMs) || frameMs <= 0) {
        liveJs.renderPerformanceTelemetry.skipped = 'invalid-frame';
        return;
    }
    lastRenderPerformanceSampleAt = now;
    const info = state.renderer?.info;
    try {
        host.post('canvas.send', {
            target: RENDER_PERFORMANCE_CANVAS_ID,
            message: {
                type: 'render-performance/sample',
                payload: {
                    source: 'sigil-avatar',
                    targetFps: liveJs.renderLoop?.work?.visualOnly ? 30 : 60,
                    frameMs,
                    updateMs: renderStartedAt - frameStartedAt,
                    renderMs: renderEndedAt - renderStartedAt,
                    drawCalls: finiteOrNull(info?.render?.calls),
                    triangles: finiteOrNull(info?.render?.triangles),
                    points: finiteOrNull(info?.render?.points),
                    lines: finiteOrNull(info?.render?.lines),
                    geometries: finiteOrNull(info?.memory?.geometries),
                    textures: finiteOrNull(info?.memory?.textures),
                },
            },
        });
        liveJs.renderPerformanceTelemetry.sent += 1;
        liveJs.renderPerformanceTelemetry.skipped = null;
        liveJs.renderPerformanceTelemetry.lastError = null;
    } catch (error) {
        liveJs.renderPerformanceTelemetry.lastError = String(error?.message || error);
        console.warn('[sigil] render-performance sample failed:', error);
    }
}

function isAgentTerminalParkedAtStatus() {
    return liveJs.avatarParking?.mode === 'status';
}

function nativePointFromMessageOrigin(msg) {
    const x = Number(msg?.origin_x ?? msg?.payload?.origin_x);
    const y = Number(msg?.origin_y ?? msg?.payload?.origin_y);
    if (Number.isFinite(x) && Number.isFinite(y)) return { x, y };
    return null;
}

function nativePointToDesktop(nativePoint) {
    if (!nativePoint) return null;
    return nativeToDesktopWorldPoint(nativePoint, liveJs.displays) ?? nativePoint;
}

function parkAvatarAtNativePoint(nativePoint, mode, scale = AGENT_TERMINAL_PARK_SCALE) {
    const desktopPoint = nativePointToDesktop(nativePoint);
    if (!desktopPoint) return;
    if (!liveJs.avatarParking && liveJs.avatarPos.valid) {
        liveJs._avatarParkingRestore = {
            pos: { ...liveJs.avatarPos },
            scale: state.appScale,
            visible: liveJs.avatarVisible,
        };
    }
    liveJs.avatarParking = { mode, nativePoint: { ...nativePoint }, scale };
    liveJs.avatarPos = { x: desktopPoint.x, y: desktopPoint.y, valid: true };
    state.appScale = scale;
    setAvatarVisibility(true);
    setAvatarHover(false);
    emitAvatarMark();
}

function parkAvatarInTerminal(frameLike) {
    const frame = Array.isArray(frameLike) ? frameLike : agentTerminalState()?.at;
    if (!Array.isArray(frame) || frame.length < 4) return;
    parkAvatarAtNativePoint({
        x: Number(frame[0]) + 23,
        y: Number(frame[1]) + 21,
    }, 'terminal', AGENT_TERMINAL_PARK_SCALE);
}

function parkAvatarAtStatus(msg) {
    const origin = nativePointFromMessageOrigin(msg);
    if (!origin) return;
    parkAvatarAtNativePoint(origin, 'status', STATUS_PARK_SCALE);
}

function clearAvatarParking({ restoreVisible = true } = {}) {
    const restore = liveJs._avatarParkingRestore;
    const restorePos = restore?.pos;
    liveJs.avatarParking = null;
    liveJs._avatarParkingRestore = null;
    if (restorePos?.valid) {
        liveJs.avatarPos = { ...restorePos };
    }
    if (restoreVisible) {
        state.appScale = restore?.scale > 0.05 ? restore.scale : 1;
        animateVisibility(true);
    } else {
        animateVisibility(false);
    }
}

function animateUtilityCanvasFrame(id, from, to, durationMs = 180) {
    if (!Array.isArray(from) || !Array.isArray(to) || from.length < 4 || to.length < 4) return Promise.resolve();
    return new Promise((resolve) => {
        const startedAt = performance.now();
        function step(now) {
            const t = Math.min(1, (now - startedAt) / durationMs);
            const eased = 1 - Math.pow(1 - t, 3);
            const frame = from.map((value, index) => value + (to[index] - value) * eased);
            host.canvasUpdate({ id, frame });
            if (t >= 1) {
                resolve();
                return;
            }
            requestAnimationFrame(step);
        }
        requestAnimationFrame(step);
    });
}

async function collapseAgentTerminalToStatus(msg) {
    const current = agentTerminalState();
    const origin = nativePointFromMessageOrigin(msg);
    if (!current || !origin) return false;
    const targetId = isAgentTerminalCanvasId(current.id) ? current.id : AGENT_TERMINAL_CANVAS_ID;
    liveJs.pendingAgentTerminalCollapse = 'status';
    liveJs.pendingAgentTerminalStatusPoint = { ...origin };
    parkAvatarAtStatus(msg);
    const from = Array.isArray(current.at) ? current.at.map(Number) : agentTerminalFrame();
    const to = [origin.x - 14, origin.y - 14, 28, 28];
    await animateUtilityCanvasFrame(targetId, from, to, 180);
    await host.canvasSuspend(targetId);
    host.canvasUpdate({ id: targetId, frame: from });
    liveJs.utilityCanvases.set(targetId, { ...current, id: targetId, suspended: true, at: from });
    return true;
}

async function restoreAgentTerminalFromStatus() {
    const current = agentTerminalState();
    if (!current) return false;
    const targetId = isAgentTerminalCanvasId(current.id) ? current.id : AGENT_TERMINAL_CANVAS_ID;
    liveJs.pendingAgentTerminalCollapse = null;
    liveJs.pendingAgentTerminalStatusPoint = null;
    const frame = Array.isArray(current.at) ? current.at : agentTerminalFrame();
    host.canvasUpdate({ id: targetId, frame });
    await host.canvasResume(targetId);
    liveJs.utilityCanvases.set(targetId, { ...current, id: targetId, suspended: false, at: frame });
    parkAvatarInTerminal(frame);
    return true;
}

async function prewarmAgentTerminalCanvas() {
    if (liveJs._agentTerminalPrewarmStarted) return;
    liveJs._agentTerminalPrewarmStarted = true;
    liveJs.prewarmingAgentTerminal = true;
    const frame = agentTerminalFrame();
    try {
        await host.canvasCreate({
            id: AGENT_TERMINAL_CANVAS_ID,
            url: AGENT_TERMINAL_URL,
            frame,
            interactive: true,
            focus: false,
            suspended: true,
        });
        liveJs.utilityCanvases.set(AGENT_TERMINAL_CANVAS_ID, {
            id: AGENT_TERMINAL_CANVAS_ID,
            suspended: true,
            at: frame,
        });
    } catch (error) {
        // Existing sessions are common after launcher/reload; use lifecycle snapshots.
        if (!/ID_COLLISION|DUPLICATE/i.test(String(error?.message || error))) {
            console.warn('[sigil] agent terminal prewarm failed:', error);
        }
    } finally {
        liveJs.prewarmingAgentTerminal = false;
    }
}

async function toggleUtilityCanvas(kind) {
    const config = utilityConfig(kind);
    const current = liveJs.utilityCanvases.get(config.id);
    try {
        if (current && current.suspended !== true) {
            await host.canvasSuspend(config.id);
            liveJs.utilityCanvases.set(config.id, { ...current, suspended: true });
            if (isAgentTerminalCanvasId(config.id) && liveJs.avatarParking?.mode === 'terminal') {
                clearAvatarParking({ restoreVisible: true });
            }
            return;
        }
        if (current) {
            const frame = Array.isArray(current.at) ? current.at : config.frame;
            host.canvasUpdate({ id: config.id, frame });
            await host.canvasResume(config.id);
            liveJs.utilityCanvases.set(config.id, { ...current, suspended: false, at: frame });
            if (isAgentTerminalCanvasId(config.id)) {
                parkAvatarInTerminal(frame);
            }
            return;
        }
        await host.canvasCreate({
            id: config.id,
            url: config.url,
            frame: config.frame,
            interactive: true,
            focus: true,
        });
        liveJs.utilityCanvases.set(config.id, {
            id: config.id,
            suspended: false,
            at: config.frame,
        });
        if (isAgentTerminalCanvasId(config.id)) {
            parkAvatarInTerminal(config.frame);
        }
    } catch (error) {
        if (!current) {
            try {
                await host.canvasResume(config.id);
                liveJs.utilityCanvases.set(config.id, {
                    id: config.id,
                    suspended: false,
                    at: config.frame,
                });
                return;
            } catch (_) {
                // Fall through to the original warning below.
            }
        }
        console.warn('[sigil] utility toggle failed:', kind, error);
    }
}

async function ensureUtilityCanvasVisible(kind, { focus = true } = {}) {
    const config = utilityConfig(kind);
    const existingPromise = liveJs.utilityCanvasOpenPromises.get(config.id);
    if (existingPromise) return existingPromise;

    const promise = (async () => {
        const current = liveJs.utilityCanvases.get(config.id);
        const frame = Array.isArray(current?.at) ? current.at : config.frame;
        try {
            if (current) {
                host.canvasUpdate({ id: config.id, frame });
                if (current.suspended === true) await host.canvasResume(config.id);
                liveJs.utilityCanvases.set(config.id, { ...current, suspended: false, at: frame });
                return { id: config.id, frame, created: false };
            }
            await host.canvasCreate({
                id: config.id,
                url: config.url,
                frame,
                interactive: true,
                focus,
            });
            liveJs.utilityCanvases.set(config.id, {
                id: config.id,
                suspended: false,
                at: frame,
            });
            return { id: config.id, frame, created: true };
        } catch (error) {
            const message = String(error?.message || error);
            if (!current && /ID_COLLISION|DUPLICATE|already exists/i.test(message)) {
                host.canvasUpdate({ id: config.id, frame });
                await host.canvasResume(config.id);
                liveJs.utilityCanvases.set(config.id, {
                    id: config.id,
                    suspended: false,
                    at: frame,
                });
                return { id: config.id, frame, created: false, recovered: true };
            }
            throw error;
        }
    })();

    liveJs.utilityCanvasOpenPromises.set(config.id, promise);
    try {
        return await promise;
    } finally {
        if (liveJs.utilityCanvasOpenPromises.get(config.id) === promise) {
            liveJs.utilityCanvasOpenPromises.delete(config.id);
        }
    }
}

async function fetchWikiMarkdownDocument(path = WIKI_WORKBENCH_DEFAULT_PATH) {
    const wikiPath = String(path || WIKI_WORKBENCH_DEFAULT_PATH).replace(/^\/+/, '');
    const response = await fetch(`/wiki/${wikiPath}`, { cache: 'no-store' });
    if (!response.ok) throw new Error(`wiki fetch failed for ${wikiPath}: ${response.status}`);
    const content = await response.text();
    return {
        type: 'markdown_document.open',
        path: wikiPath,
        source: {
            kind: 'wiki',
            path: wikiPath,
            page: {
                path: wikiPath,
                frontmatter: {},
            },
        },
        content,
    };
}

function sendCanvasMessage(target, message) {
    host.post('canvas.send', { target, message });
}

function sendActivationUpdate(activation, phase, extra = {}) {
    const update = advanceMenuActivation(activation, phase, extra);
    liveJs.lastRadialActivation = update;
    host.post('sigil.radial_menu.activation', update);
    return update;
}

async function openWikiWorkbench(path = WIKI_WORKBENCH_DEFAULT_PATH, activation = null) {
    let currentActivation = activation;
    const canvas = await ensureUtilityCanvasVisible('wiki-workbench', { focus: true });
    if (currentActivation) {
        currentActivation = sendActivationUpdate(currentActivation, 'surface_transition', {
            target_surface: currentActivation.target_surface,
            result: {
                canvas_id: WIKI_WORKBENCH_CANVAS_ID,
            },
        });
    }
    const message = await fetchWikiMarkdownDocument(path);
    sendCanvasMessage(WIKI_WORKBENCH_CANVAS_ID, message);
    if (currentActivation) {
        sendActivationUpdate(currentActivation, 'completed', {
            result: {
                canvas_id: WIKI_WORKBENCH_CANVAS_ID,
                subject: message.source,
            },
        });
    }
    return { canvas, message };
}

function projectStageLocalToScene(localX, localY, yOffset = 0) {
    const vec = new THREE.Vector3();
    vec.set(
        (localX / window.innerWidth) * 2 - 1,
        -(localY / window.innerHeight) * 2 + 1,
        0.5
    );
    vec.unproject(state.perspCamera);
    vec.sub(state.perspCamera.position).normalize();
    const distance = -state.perspCamera.position.z / vec.z;
    const pos = new THREE.Vector3().copy(state.perspCamera.position).add(vec.multiplyScalar(distance));
    pos.y += yOffset / 10;
    return pos;
}

function projectAvatarToScene(screenX, screenY, yOffset = 0) {
    const local = desktopWorldToSegmentLocalPoint({ x: screenX, y: screenY }) ?? { x: screenX, y: screenY };
    return projectStageLocalToScene(local.x, local.y, yOffset);
}

function initScene() {
    const width = window.innerWidth;
    const height = window.innerHeight;
    state.scene = new THREE.Scene();
    state.perspCamera = new THREE.PerspectiveCamera(45, width / height, 0.1, 1000);
    state.orthoCamera = new THREE.OrthographicCamera(-width / 2, width / 2, height / 2, -height / 2, 0.1, 1000);
    state.camera = state.perspCamera;
    state.camera.position.z = 20;

    state.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    state.renderer.setSize(width, height);
    state.renderer.setPixelRatio(window.devicePixelRatio);
    state.renderer.setClearColor(0x000000, 0);
    state.renderer.domElement.style.position = 'absolute';
    state.renderer.domElement.style.inset = '0';
    state.renderer.domElement.style.zIndex = '1';
    document.body.appendChild(state.renderer.domElement);

    state.pointLight = new THREE.PointLight(0xffffff, 2, 50);
    state.scene.add(state.pointLight);
    state.scene.add(new THREE.AmbientLight(0xffffff, 0.5));

    state.polyGroup = new THREE.Group();
    state.scene.add(state.polyGroup);

    window.addEventListener('resize', onWindowResize, false);
}

function onWindowResize() {
    const width = window.innerWidth;
    const height = window.innerHeight;
    if (state.camera === state.perspCamera) {
        state.camera.aspect = width / height;
    } else {
        state.camera.left = -width / 2;
        state.camera.right = width / 2;
        state.camera.top = height / 2;
        state.camera.bottom = -height / 2;
    }
    state.camera.updateProjectionMatrix();
    state.renderer.setSize(width, height);
    if (!rendererSuspended) scheduleRenderFrame();
}

function setInteractionState(next, reason) {
    if (liveJs.currentState === next) return;
    console.log('[sigil] state:', liveJs.currentState, '→', next, reason ? '(' + reason + ')' : '');
    liveJs.currentState = next;
    liveJs.state = next;
    if (next === 'IDLE' && !liveJs.travel) postLastPositionToDaemon();
    emitAvatarMark();
    syncSigilInputRegions();
    if (!rendererSuspended) scheduleRenderFrame();
}

function postLastPositionToDaemon() {
    if (!isPrimarySurfaceSegment()) return;
    const agentId = liveJs.currentAgentId;
    const position = liveJs.avatarPos;
    if (!agentId || !position?.valid) return;
    const nativePoint = desktopWorldToNativePoint(position, liveJs.displays) || position;
    host.positionSet(agentId, nativePoint);
}

window.postLastPositionToDaemon = postLastPositionToDaemon;
window.postToHost = host.post;

function isOnAvatar(x, y) {
    if (!liveJs.avatarVisible || !liveJs.avatarPos.valid) return false;
    const dx = x - liveJs.avatarPos.x;
    const dy = y - liveJs.avatarPos.y;
    return ((dx * dx) + (dy * dy)) <= (liveJs.avatarHitRadius * liveJs.avatarHitRadius);
}

function setAvatarHover(over) {
    const next = !!over;
    if (liveJs.avatarHover === next) return;
    liveJs.avatarHover = next;
    scheduleRenderFrame();
}

function updateAvatarHoverFromPoint(x, y) {
    if (!liveJs.avatarVisible || contextMenu.isOpen()) {
        setAvatarHover(false);
        return;
    }
    if (!['IDLE', 'GOTO', 'PRESS'].includes(liveJs.currentState)) {
        setAvatarHover(false);
        return;
    }
    setAvatarHover(isOnAvatar(x, y));
}

function distance(ax, ay, bx, by) {
    return Math.hypot(ax - bx, ay - by);
}

function clearGestureState() {
    liveJs.mousedownPos = null;
    liveJs.mousedownAvatarPos = null;
    liveJs.radialGestureMenu = null;
    annotationReticleAcquisition?.reset?.();
    radialReticleItemWasActive = false;
    syncRadialTargetSurface();
    setAvatarHover(false);
}

const visibilityTransition = createVisibilityTransitionController({
    host,
    state,
    liveJs,
    projectStagePoint: stagePoint,
    getExcludedCanvasIds() {
        return ['avatar-main', hitTarget.hit.id].filter(Boolean);
    },
});

const fastTravel = createFastTravelController({
    host,
    state,
    liveJs,
    projectStagePoint: stagePoint,
    getExcludedCanvasIds() {
        return ['avatar-main', hitTarget.hit.id, radialTargetSurface.id].filter(Boolean);
    },
    canCaptureDisplayImages: isPrimarySurfaceSegment,
});
const annotationReticle = createSigilAnnotationReticleController({
    getDisplays: () => liveJs.displays,
    getAvatarPos: () => liveJs.avatarPos,
    getAvatarHitRadius: () => liveJs.avatarHitRadius,
    getAnnotationCandidates: () => annotationReticleCandidateList(),
});
const annotationReticleAcquisition = createAnnotationReticleAcquisitionState();
let radialTargetSurfaceDragActive = false;
let radialReticleItemWasActive = false;
liveJs.annotationReticle = annotationReticle.snapshot();
liveJs.annotationReticleOverlay = null;
const radialActivationTransition = createRadialActivationTransitionController({
    now: () => state.globalTime,
});
function sigilUxTreeSnapshot() {
    return createSigilUxTree({
        state: {
            ...state,
            selectionModeOverlay: liveJs.selectionModeOverlay,
            annotationReticleOverlay: liveJs.annotationReticleOverlay,
        },
        metadata: {
            current_state: liveJs.currentState,
            selection_mode_active: liveJs.selectionMode?.active === true,
            context_menu_open: contextMenu?.isOpen?.() ?? false,
        },
    });
}

function sigilUxTreeShadowResolver() {
    return createSigilUxTreeShadowResolver(sigilUxTreeSnapshot());
}

function sigilUxTreeReadiness() {
    const tree = sigilUxTreeSnapshot();
    return createSigilUxTreeReadinessAudit(tree, {
        registry: sigilUxCommandRuntime?.registry || {},
        routedCommandRoutes: sigilUxCommandRuntime?.routeCatalog?.() || [],
    });
}

const radialItemActionDispatcher = createSigilRadialItemActionDispatcher({
    agentTerminalCanvasId: AGENT_TERMINAL_CANVAS_ID,
    wikiWorkbenchCanvasId: WIKI_WORKBENCH_CANVAS_ID,
    wikiPath: WIKI_WORKBENCH_DEFAULT_PATH,
    annotationReticleItemId: SIGIL_ANNOTATION_RETICLE_ITEM_ID,
    annotationCameraItemId: SIGIL_ANNOTATION_CAMERA_ITEM_ID,
    getPointer: () => liveJs.pointerPos,
    getAvatarPos: () => liveJs.avatarPos,
    setLastRadialActivation: (activation) => {
        liveJs.lastRadialActivation = activation;
    },
    post: (type, payload) => host.post(type, payload),
    warn: (...args) => console.warn(...args),
    startActivationTransition: (activation, snapshot) => (
        radialActivationTransition.start(activation, snapshot, { startedAt: state.globalTime })
    ),
    sendActivationUpdate,
    enterAnnotationReticle,
    requestAnnotationSnapshot,
    openContextMenuAt,
    toggleUtilityCanvas,
    openWikiWorkbench,
});

sigilUxCommandRuntime = createSigilUxTreeCommandRuntime({
    liveState: liveJs,
    getTree: sigilUxTreeSnapshot,
    recordRuntime: recordUxCommandRuntime,
    radialItemActionDispatcher,
    getRadialGestureMenu: () => radialGestureMenu,
    fastTravel,
    clearGestureState,
    consumeAvatarDoubleClick,
    resetAvatarDoubleClick,
    markSelectionModeEntryReleasePending,
    setInteractionState,
    applyRadialGestureMove,
    enterSelectionMode,
    exitSelectionMode,
    acquireSelectionModeCandidates,
    cycleSelectionModeTarget,
    commitSelectionMode,
    contextMenu,
    cancelInteraction,
    wikiPath: WIKI_WORKBENCH_DEFAULT_PATH,
});

function executeRadialItemCommand(item, snapshot, context = {}) {
    return sigilUxCommandRuntime.executeRadialItem(item, snapshot, context);
}

radialGestureMenu = createSigilRadialGestureMenu({
    state,
    onCommitItem(item, snapshot, context = {}) {
        executeRadialItemCommand(item, snapshot, context);
    },
});
let omegaTrailTravelKey = null;

function travelVectorKey(travel) {
    if (!travel) return null;
    const from = travel.from ?? { x: travel.fromX, y: travel.fromY };
    const to = travel.to ?? { x: travel.toX, y: travel.toY };
    if (!Number.isFinite(Number(from.x)) || !Number.isFinite(Number(from.y))) return null;
    if (!Number.isFinite(Number(to.x)) || !Number.isFinite(Number(to.y))) return null;
    return [
        travel.effect,
        Math.round(Number(from.x) || 0),
        Math.round(Number(from.y) || 0),
        Math.round(Number(to.x) || 0),
        Math.round(Number(to.y) || 0),
        Math.round(Number(travel.startMs) || 0),
    ].join(':');
}

function syncOmegaTrailToTravelOrigin() {
    const travel = liveJs.travel;
    const key = travelVectorKey(travel);
    if (!key) {
        omegaTrailTravelKey = null;
        return;
    }
    if (omegaTrailTravelKey === key) return;
    omegaTrailTravelKey = key;
    const origin = travel.from ?? { x: travel.fromX, y: travel.fromY, valid: true };
    if (!origin?.valid) return;
    resetOmegaInterdimensionalTrail(projectAvatarToScene(origin.x, origin.y));
}

function queueFastTravel(x, y) {
    const travel = fastTravel.start(x, y, { pointer: { x, y, valid: true } });
    syncOmegaTrailToTravelOrigin();
    if (desktopWorldSurface?.isPrimary) {
        desktopWorldSurface.publishState(surfaceRenderSnapshot(liveJs.avatarPos));
    }
    if (travel?.effect === 'line') {
        const travelKey = travelVectorKey(travel);
        const timeoutMs = Math.max(1, Number(travel.durationMs) || 0) + 40;
        window.setTimeout(() => {
            if (travelVectorKey(liveJs.travel) !== travelKey) return;
            fastTravel.tick(0, () => {
                postLastPositionToDaemon();
                syncHitTargetToAvatar();
            });
            if (desktopWorldSurface?.isPrimary) {
                desktopWorldSurface.publishState(surfaceRenderSnapshot(liveJs.avatarPos));
            }
            if (!rendererSuspended) scheduleRenderFrame();
        }, timeoutMs);
    }
    if (!rendererSuspended) scheduleRenderFrame();
}

function annotationReticleRectFromAt(at = null) {
    const parts = Array.isArray(at) ? at : [];
    const [x, y, w, h] = parts.map((value) => Number(value));
    if (![x, y, w, h].every(Number.isFinite) || w <= 0 || h <= 0) return null;
    return { x, y, w, h };
}

function annotationReticleRectFromObject(rect = null) {
    if (!rect || typeof rect !== 'object') return null;
    const x = Number(rect.x ?? rect.left);
    const y = Number(rect.y ?? rect.top);
    const w = Number(rect.w ?? rect.width);
    const h = Number(rect.h ?? rect.height);
    if (![x, y, w, h].every(Number.isFinite) || w <= 0 || h <= 0) return null;
    return { x, y, w, h };
}

function annotationReticleProjectionRect(rect = null) {
    const normalized = annotationReticleRectFromObject(rect);
    return normalized
        ? {
            x: normalized.x,
            y: normalized.y,
            w: normalized.w,
            h: normalized.h,
        }
        : null;
}

function annotationReticleIsBrowserDomElementTarget(target = {}) {
    return target?.kind === 'element_target'
        || target?.surface_type === 'browser_page'
        || target?.adapter_id === BROWSER_DOM_ELEMENT_PICKER_ADAPTER_ID;
}

function annotationReticleBrowserContentRect(canvasId = '', payload = {}, target = {}) {
    const explicit = annotationReticleProjectionRect(
        target.browser_content_rect
        || target.content_rect
        || payload.browser_content_rect
        || payload.content_rect
    );
    if (explicit) return explicit;
    const sourcePath = String(target.source_path || payload.source_path || '');
    if (sourcePath.includes('docs/design/fixtures/browser-dom-element-picker-v0/controlled-page.html')) {
        return annotationReticleCanvasDesktopWorldRect(canvasId);
    }
    return null;
}

function annotationReticleBrowserContentRectFromWindow(payload = {}) {
    return annotationReticleProjectionRect(
        payload.browser_content_rect
        || payload.content_rect
        || payload.browserContentRect
    );
}

function annotationReticleBrowserSessionFromWindow(payload = {}) {
    return String(
        payload.browser_session_id
        || payload.browser_session
        || payload.session_id
        || payload.session
        || ''
    ).trim();
}

function annotationReticleBrowserContentRectFromAxElement(payload = {}, windowPayload = {}) {
    const role = String(payload.role || payload.ax_role || payload.kind || '').toLowerCase();
    const bounds = annotationReticleRectFromObject(payload.bounds || payload.frame || payload.rect);
    if (!bounds || (role && role !== 'axgroup' && role !== 'group' && role !== 'webarea' && role !== 'axwebarea')) return null;
    const windowBounds = annotationReticleRectFromObject(windowPayload.bounds || windowPayload.frame || windowPayload.rect);
    if (windowBounds) {
        const tolerance = 2;
        const inside = bounds.x >= windowBounds.x - tolerance
            && bounds.y >= windowBounds.y - tolerance
            && bounds.x + bounds.w <= windowBounds.x + windowBounds.w + tolerance
            && bounds.y + bounds.h <= windowBounds.y + windowBounds.h + tolerance;
        if (!inside) return null;
    }
    return nativeToDesktopWorldRect(bounds, liveJs.displays) || annotationReticleProjectionRect(bounds);
}

function recordAnnotationReticleBrowserDomBridge(stage, evidence = {}) {
    const entry = {
        stage,
        reason: evidence.reason || '',
        blocker_reason: evidence.blocker_reason || '',
        code: evidence.code || evidence.error_code || '',
        error_code: evidence.error_code || evidence.code || '',
        status: evidence.status || '',
        browser_session_id: evidence.session_id || evidence.browser_session_id || '',
        browser_window_id: evidence.browser_window_id || '',
        content_rect: evidence.content_rect || null,
        point: evidence.point || null,
        request_key: evidence.request_key || '',
        pending_request_key: evidence.pending_request_key || '',
        candidate_id: evidence.candidate_id || '',
        anchor_candidate_id: evidence.anchor_candidate_id || '',
        anchor_source: evidence.anchor_source || '',
        anchor_window_id: evidence.anchor_window_id || '',
        rejection_reason: evidence.rejection_reason || '',
        skipped: Array.isArray(evidence.skipped) ? evidence.skipped : [],
        rejection_reasons: Array.isArray(evidence.rejection_reasons) ? evidence.rejection_reasons : [],
        request_scope_address: evidence.request_scope_address || '',
        active_scope_address: evidence.active_scope_address || '',
        message: evidence.message || '',
        updated_at: Date.now(),
    };
    liveJs.annotationReticleBrowserDomBridge = entry;
    recordAnnotationReticleEvent(stage, entry);
    return entry;
}

function annotationReticleBrowserDomBridgeBlockerFromError(error = null) {
    const code = String(error?.code || error?.error_code || '').trim();
    const message = String(error?.responseMessage || error?.message || error || '');
    const normalizedCode = code || (message.match(/^([A-Z0-9_]+):/)?.[1] || '');
    switch (normalizedCode) {
        case 'BROWSER_SESSION_UNRESOLVED':
            return { blocker_reason: 'browser_session_unresolved', code: normalizedCode };
        case 'BROWSER_DOM_POINT_UNRESOLVED':
            return { blocker_reason: 'browser_dom_point_unresolved', code: normalizedCode };
        case 'BROWSER_CONTENT_INSET_UNRESOLVED':
            return { blocker_reason: 'browser_content_inset_unresolved', code: normalizedCode };
        case 'BROWSER_SESSION_NOT_LOCAL':
            return { blocker_reason: 'browser_session_not_local', code: normalizedCode };
        case 'NATIVE_AX_ROOT_MISMATCH':
            return { blocker_reason: 'native_ax_root_mismatch', code: normalizedCode };
        case 'BROWSER_DOM_TARGET_INVALID_JSON':
            return { blocker_reason: 'browser_dom_target_invalid_json', code: normalizedCode };
        case 'BROWSER_DOM_TARGET_FAILED':
            return { blocker_reason: 'browser_dom_target_failed', code: normalizedCode };
        default:
            return { blocker_reason: 'browser_dom_request_failed', code: normalizedCode };
    }
}

function annotationReticleNativeWindowIdFromValue(value = null) {
    const metadata = value?.source_metadata || value?.source_tree_node_metadata || value?.metadata || {};
    return String(
        value?.window_id
        || metadata.window_id
        || value?.projection?.window_id
        || ''
    ).trim();
}

function annotationReticleNativeWindowPidFromValue(value = null) {
    const metadata = value?.source_metadata || value?.source_tree_node_metadata || value?.metadata || {};
    const pid = value?.pid ?? metadata.pid ?? value?.projection?.pid;
    return Number.isFinite(Number(pid)) ? Number(pid) : null;
}

function annotationReticleNativeWindowKindFromValue(value = null) {
    if (!value || typeof value !== 'object') return '';
    const kind = String(
        value.root_kind
        || value.subject_kind
        || value.root?.kind
        || value.subject?.kind
        || value.role
        || ''
    ).trim();
    return kind === 'native_window' ? kind : '';
}

function annotationReticleNativeBrowserWindowAnchor(candidate = null, activeScope = null) {
    const subject = candidate && typeof candidate === 'object' ? candidate : null;
    if (!subject) return null;
    const isNativeWindow = subject.adapter_id === 'macos-ax'
        && annotationReticleNativeWindowKindFromValue(subject) === 'native_window';
    if (!isNativeWindow) return null;
    const activeIsNativeWindow = activeScope?.adapter_id === 'macos-ax'
        && annotationReticleNativeWindowKindFromValue(activeScope) === 'native_window';
    return {
        candidate: subject,
        source: activeIsNativeWindow && activeScope?.address === subject.address
            ? 'active_scope'
            : 'selected_native_window',
        candidate_id: String(subject.id || subject.subject_id || subject.subject?.id || subject.root?.id || ''),
        address: subject.address || '',
        window_id: annotationReticleNativeWindowIdFromValue(subject),
        pid: annotationReticleNativeWindowPidFromValue(subject),
    };
}

function annotationReticleWindowEventMatchesAnchor(windowEvent = null, anchor = null) {
    if (!windowEvent || !anchor) return false;
    const eventWindowId = String(windowEvent.window_id || windowEvent.windowID || windowEvent.id || '').trim();
    if (anchor.window_id && eventWindowId && anchor.window_id !== eventWindowId) return false;
    const eventPid = Number.isFinite(Number(windowEvent.pid ?? windowEvent.app_pid ?? windowEvent.owner_pid))
        ? Number(windowEvent.pid ?? windowEvent.app_pid ?? windowEvent.owner_pid)
        : null;
    if (anchor.pid !== null && eventPid !== null && anchor.pid !== eventPid) return false;
    return Boolean(eventWindowId || eventPid !== null);
}

function annotationReticleBrowserDomBridgeEvidence(pointer = null, anchorCandidate = null) {
    const activeScope = annotationReticle.snapshot()?.active_scope || null;
    const anchor = annotationReticleNativeBrowserWindowAnchor(anchorCandidate, activeScope)
        || annotationReticleNativeBrowserWindowAnchor(activeScope, activeScope);
    if (!anchor) {
        return { ok: false, blocker_reason: 'browser_native_window_scope_required' };
    }
    const windowEvent = liveJs.annotationReticleTargetEvidence.latestNativeWindowEvent || {};
    const scopedWindowEvent = annotationReticleWindowEventMatchesAnchor(windowEvent, anchor) ? windowEvent : {};
    const axElementEvent = scopedWindowEvent === windowEvent
        ? (liveJs.annotationReticleTargetEvidence.latestNativeAxElementEvent || {})
        : {};
    const sessionId = annotationReticleBrowserSessionFromWindow(scopedWindowEvent);
    const eventWindowId = String(scopedWindowEvent.window_id || scopedWindowEvent.windowID || scopedWindowEvent.id || '').trim();
    const windowId = eventWindowId || anchor.window_id;
    if (!sessionId && !windowId) return {
        ok: false,
        blocker_reason: 'browser_session_unresolved',
        anchor_candidate_id: anchor.candidate_id,
        anchor_source: anchor.source,
        anchor_window_id: anchor.window_id,
    };
    const anchorRect = annotationReticleProjectionRect(
        anchor.candidate?.projection?.visible_display_rect
        || anchor.candidate?.projection?.display_space_rect
        || anchor.candidate?.display_space_rect
        || anchor.candidate?.source_metadata?.bounds
    );
    const contentRect = annotationReticleBrowserContentRectFromWindow(scopedWindowEvent)
        || annotationReticleBrowserContentRectFromAxElement(axElementEvent, scopedWindowEvent)
        || annotationReticleBrowserContentRectFromAxElement(axElementEvent, { ...scopedWindowEvent, bounds: anchorRect });
    if (!contentRect) return {
        ok: false,
        blocker_reason: 'browser_content_inset_unresolved',
        session_id: sessionId,
        browser_window_id: windowId,
        anchor_candidate_id: anchor.candidate_id,
        anchor_source: anchor.source,
        anchor_window_id: anchor.window_id,
    };
    if (!pointer || !Number.isFinite(Number(pointer.x)) || !Number.isFinite(Number(pointer.y))) {
        return {
            ok: false,
            blocker_reason: 'browser_dom_point_unresolved',
            session_id: sessionId,
            browser_window_id: windowId,
            content_rect: contentRect,
            anchor_candidate_id: anchor.candidate_id,
            anchor_source: anchor.source,
            anchor_window_id: anchor.window_id,
        };
    }
    return {
        ok: true,
        session_id: sessionId,
        browser_window_id: windowId,
        active_scope_address: activeScope?.address || '',
        anchor_scope_address: anchor.address,
        anchor_candidate_id: anchor.candidate_id,
        anchor_source: anchor.source,
        anchor_window_id: anchor.window_id,
        browser_pid: Number.isFinite(Number(scopedWindowEvent.pid ?? scopedWindowEvent.app_pid ?? scopedWindowEvent.owner_pid))
            ? Number(scopedWindowEvent.pid ?? scopedWindowEvent.app_pid ?? scopedWindowEvent.owner_pid)
            : anchor.pid,
        content_rect: contentRect,
        point: {
            x: Number(pointer.x) - contentRect.x,
            y: Number(pointer.y) - contentRect.y,
        },
    };
}

function annotationReticleCanvasDesktopWorldRect(canvasId = '') {
    const id = String(canvasId || '').trim();
    if (!id) return null;
    const canvas = liveJs.annotationReticleTargetEvidence.canvases.get(id);
    return normalizeCanvasFrameToDesktopWorld(canvas, liveJs.displays)?.rect || null;
}

function annotationReticleNativeRectToDesktopWorld(rect = null) {
    const normalized = annotationReticleRectFromObject(rect);
    if (!normalized) return null;
    return nativeToDesktopWorldRect(normalized, liveJs.displays);
}

function annotationReticleProjectionSpace(projection = {}) {
    return String(projection.coordinate_space || projection.coordinateSpace || '').toLowerCase();
}

function annotationReticleCandidateInDesktopWorld(candidate = null) {
    if (!candidate || typeof candidate !== 'object') return null;
    const projection = candidate.projection && typeof candidate.projection === 'object'
        ? candidate.projection
        : null;
    const space = annotationReticleProjectionSpace(projection);
    if (!projection || !space || space === 'desktop_world') return candidate;
    if (space !== 'native_display' && space !== 'native' && space !== 'screen' && space !== 'native_desktop') {
        return candidate;
    }

    const displayRect = projection.display_space_rect || candidate.display_space_rect || candidate.rect;
    const visibleRect = projection.visible_display_rect || displayRect;
    const desktopDisplayRect = annotationReticleNativeRectToDesktopWorld(displayRect);
    const desktopVisibleRect = annotationReticleNativeRectToDesktopWorld(visibleRect);
    if (!desktopDisplayRect || !desktopVisibleRect) {
        return {
            ...candidate,
            blocker_reason: candidate.blocker_reason || 'desktop_world_projection_unavailable',
            projection: {
                ...projection,
                can_project_display_overlay: false,
                projectable: false,
                blocker_reason: projection.blocker_reason || 'desktop_world_projection_unavailable',
            },
        };
    }

    return {
        ...candidate,
        display_space_rect: desktopDisplayRect,
        visible_display_rect: desktopVisibleRect,
        projection: {
            ...projection,
            display_space_rect: desktopDisplayRect,
            visible_display_rect: desktopVisibleRect,
            coordinate_space: 'desktop_world',
            source_coordinate_space: projection.coordinate_space || 'native_display',
        },
        source_metadata: {
            ...(candidate.source_metadata || {}),
            source_coordinate_space: projection.coordinate_space || 'native_display',
        },
    };
}

function annotationReticleUpsertCandidate(candidate = null) {
    const normalized = annotationReticleCandidateInDesktopWorld(candidate);
    if (!normalized?.id && !normalized?.subject_id) return;
    const key = String(normalized.id || normalized.subject_id);
    liveJs.annotationReticleTargetEvidence.candidates.set(key, normalized);
}

function annotationReticleRemoveCandidate(id = '') {
    if (!id) return;
    clearAnnotationReticleSemanticCandidatesForCanvas(liveJs.annotationReticleTargetEvidence, id);
    liveJs.annotationReticleTargetEvidence.candidates.delete(String(id));
    liveJs.annotationReticleTargetEvidence.canvases.delete(String(id));
}

function annotationReticleCandidateList() {
    return [...liveJs.annotationReticleTargetEvidence.candidates.values()];
}

function annotationReticleRefreshCanvasCandidates() {
    for (const canvas of liveJs.annotationReticleTargetEvidence.canvases.values()) {
        annotationReticleUpsertCandidate(annotationReticleCanvasCandidate(canvas));
    }
}

function annotationReticleCanvasCandidate(canvas = null) {
    const id = String(canvas?.id || '').trim();
    if (!id || id === 'avatar-main' || id === hitTarget.hit.id || id === radialTargetSurface.id) return null;
    if (canvas?.suspended === true) return null;
    const frame = normalizeCanvasFrameToDesktopWorld(canvas, liveJs.displays);
    const rect = frame?.rect || null;
    const frameBlocked = frame?.status === 'blocked' || frame?.projectable === false;
    const projectionBase = {
        adapter_id: 'aos-canvas-window',
        root_id: id,
        subject_id: id,
        subject_kind: 'canvas_window',
        source_coordinate_space: frame?.source_coordinate_space || '',
        native_display_rect: frame?.native_rect || null,
        canvas_frame_source: frame?.source_frame || '',
        canvas_frame_inference: frame?.inference || '',
        canvas_frame_ambiguity: frame?.ambiguity || null,
        refreshed_at: new Date().toISOString(),
    };
    const sourceMetadataBase = {
        adapter_scope: 'sigil_cached_canvas_lifecycle',
        canvas_id: id,
        source_coordinate_space: frame?.source_coordinate_space || '',
        native_display_rect: frame?.native_rect || null,
        canvas_frame_source: frame?.source_frame || '',
        canvas_frame_inference: frame?.inference || '',
        canvas_frame_ambiguity: frame?.ambiguity || null,
        parent: canvas.parent || null,
        track: canvas.track || null,
    };
    if (!rect) {
        return frameBlocked ? {
            id,
            subject_id: id,
            subject_path: ['canvas', id],
            root_id: id,
            root_label: canvas.title || canvas.name || id,
            root_kind: 'canvas',
            subject_kind: 'canvas_window',
            label: canvas.title || canvas.name || id,
            adapter_id: 'aos-canvas-window',
            projection: {
                ...projectionBase,
                status: 'blocked',
                projectable: false,
                can_project_display_overlay: false,
                can_reveal: false,
                coordinate_space: 'desktop_world',
                blocker: frame.blocker || { reason: frame.blocker_reason || 'canvas_frame_blocked' },
                blocker_reason: frame.blocker_reason || frame.blocker?.reason || 'canvas_frame_blocked',
            },
            source_metadata: {
                ...sourceMetadataBase,
                blocker: frame.blocker || { reason: frame.blocker_reason || 'canvas_frame_blocked' },
            },
        } : null;
    }
    return {
        id,
        subject_id: id,
        subject_path: ['canvas', id],
        root_id: id,
        root_label: canvas.title || canvas.name || id,
        root_kind: 'canvas',
        subject_kind: 'canvas_window',
        label: canvas.title || canvas.name || id,
        adapter_id: 'aos-canvas-window',
        projection: {
            ...projectionBase,
            status: 'visible',
            projectable: true,
            can_project_display_overlay: true,
            can_reveal: true,
            visible_display_rect: rect,
            display_space_rect: rect,
            coordinate_space: 'desktop_world',
        },
        source_metadata: {
            ...sourceMetadataBase,
        },
    };
}

function annotationReticleSemanticTargetForDesktopWorld(canvasId = '', target = {}) {
    const declaredSpace = String(
        target.coordinate_space
        || target.coordinateSpace
        || target.rect_coordinate_space
        || target.display_rect_coordinate_space
        || ''
    ).toLowerCase();
    if (declaredSpace === 'desktop_world') return target;

    const sourceRect = annotationReticleProjectionRect(
        target.display_space_rect
        || target.display_bounds
        || target.bounds
        || target.rect
    );
    if (!sourceRect) return target;

    const sourceCoordinateSpace = declaredSpace || 'canvas_local';
    const desktopRect = (
        sourceCoordinateSpace === 'native_display'
        || sourceCoordinateSpace === 'native'
        || sourceCoordinateSpace === 'screen'
        || sourceCoordinateSpace === 'native_desktop'
    )
        ? nativeToDesktopWorldRect(sourceRect, liveJs.displays)
        : canvasLocalRectToDesktopWorld(
            liveJs.annotationReticleTargetEvidence.canvases.get(String(canvasId || '').trim()),
            sourceRect,
            liveJs.displays,
        );

    if (!desktopRect) return {
        ...target,
        current_render_status: 'blocked',
        blocker_reason: target.blocker_reason || 'desktop_world_projection_unavailable',
        coordinate_space: sourceCoordinateSpace,
    };

    return {
        ...target,
        display_space_rect: desktopRect,
        visible_display_rect: desktopRect,
        local_space_rect: target.local_space_rect || target.local_bounds || sourceRect,
        coordinate_space: 'desktop_world',
        source_coordinate_space: sourceCoordinateSpace,
    };
}

function annotationReticleHandleCanvasLifecycle(msg = {}) {
    const canvas = msg.canvas && typeof msg.canvas === 'object'
        ? { ...msg.canvas, id: msg.canvas_id || msg.canvas.id, at: msg.at || msg.canvas.at }
        : { id: msg.canvas_id || msg.id, at: msg.at, suspended: msg.suspended };
    const id = String(canvas.id || '').trim();
    if (!id) return;
    if (msg.action === 'removed') {
        annotationReticleRemoveCandidate(id);
        return;
    }
    liveJs.annotationReticleTargetEvidence.canvases.set(id, canvas);
    annotationReticleUpsertCandidate(annotationReticleCanvasCandidate(canvas));
}

function annotationReticleHandleSemanticTargets(payload = {}) {
    const canvasId = String(payload.canvas_id || payload.surface_id || payload.id || payload.source_canvas_id || '').trim();
    const targets = Array.isArray(payload.semantic_targets)
        ? payload.semantic_targets
        : (Array.isArray(payload.targets) ? payload.targets : []);
    if (!canvasId) return;
    clearAnnotationReticleSemanticCandidatesForCanvas(liveJs.annotationReticleTargetEvidence, canvasId);
    if (!targets.length) return;
    const candidateIds = [];
    for (const target of targets) {
        if (annotationReticleIsBrowserDomElementTarget(target)) {
            const candidate = buildBrowserDomElementAnnotationCandidate({
                ...target,
                surface_id: target.surface_id || canvasId,
                surface_type: 'browser_page',
                kind: 'element_target',
            }, {
                content_rect: annotationReticleBrowserContentRect(canvasId, payload, target),
                root_label: target.source_url || target.surface_id || canvasId,
                refreshed_at: target.refreshed_at || payload.refreshed_at || new Date().toISOString(),
                provenance_source_payload_id: target.payload_id || payload.payload_id || target.id,
                browser_attachment: target.browser_attachment || payload.browser_attachment || 'explicit_local_page',
                browser_session_id: target.browser_session_id || payload.browser_session_id,
                browser_window_id: target.browser_window_id || payload.browser_window_id,
                browser_pid: target.browser_pid || payload.browser_pid,
            });
            annotationReticleUpsertCandidate(candidate);
            candidateIds.push(candidate.id);
            continue;
        }
        const desktopTarget = annotationReticleSemanticTargetForDesktopWorld(canvasId, target);
        const projection = buildSemanticTargetProjectionAdapterResult(desktopTarget, {
            canvas_id: canvasId,
            refreshed_at: desktopTarget.refreshed_at || payload.refreshed_at || new Date().toISOString(),
            provenance_source_payload_id: desktopTarget.payload_id || payload.payload_id,
        });
        const candidate = {
            id: projection.subject_id,
            subject_id: projection.subject_id,
            subject_path: projection.subject_path,
            root_id: projection.root_id,
            root_label: canvasId,
            root_kind: 'canvas',
            subject_kind: projection.subject_kind,
            label: desktopTarget.name || desktopTarget.label || desktopTarget.role || projection.subject_id,
            adapter_id: 'aos-toolkit-semantic-target',
            projection,
            source_metadata: {
                ...desktopTarget,
                adapter_scope: 'sigil_cached_semantic_targets',
                canvas_id: canvasId,
            },
        };
        annotationReticleUpsertCandidate(candidate);
        candidateIds.push(candidate.id);
    }
    recordAnnotationReticleSemanticCandidateIds(liveJs.annotationReticleTargetEvidence, canvasId, candidateIds);
}

let pendingAnnotationReticleBrowserDomRequestKey = '';

function annotationReticleRequestBrowserDomTarget(pointer = null, reason = 'preview', anchorCandidate = null) {
    if (!annotationReticle.active) return false;
    const evidence = annotationReticleBrowserDomBridgeEvidence(pointer, anchorCandidate);
    if (!evidence.ok) {
        recordAnnotationReticleBrowserDomBridge('browser_dom_bridge_blocked', {
            ...evidence,
            reason,
        });
        return false;
    }
    const requestKey = [
        evidence.session_id,
        evidence.browser_window_id,
        Math.round(evidence.point.x),
        Math.round(evidence.point.y),
        reason,
    ].join(':');
    if (pendingAnnotationReticleBrowserDomRequestKey === requestKey) return true;
    pendingAnnotationReticleBrowserDomRequestKey = requestKey;
    recordAnnotationReticleBrowserDomBridge('browser_dom_bridge_request', {
        ...evidence,
        reason,
        request_key: requestKey,
    });
    host.request('browser_dom.element_target', {
        browser_session_id: evidence.session_id,
        browser_window_id: evidence.browser_window_id,
        browser_pid: evidence.browser_pid,
        point: evidence.point,
        browser_content_rect: evidence.content_rect,
    }, { timeoutMs: 2500 })
        .then((msg) => {
            if (pendingAnnotationReticleBrowserDomRequestKey !== requestKey) {
                recordAnnotationReticleBrowserDomBridge('browser_dom_bridge_stale_response', {
                    reason,
                    browser_session_id: evidence.session_id,
                    browser_window_id: evidence.browser_window_id,
                    request_key: requestKey,
                    pending_request_key: pendingAnnotationReticleBrowserDomRequestKey,
                    blocker_reason: 'browser_dom_stale_response',
                });
                return;
            }
            pendingAnnotationReticleBrowserDomRequestKey = '';
            const currentScope = annotationReticle.snapshot()?.active_scope || null;
            if (annotationReticle.active && evidence.active_scope_address && currentScope?.address !== evidence.active_scope_address) {
                recordAnnotationReticleBrowserDomBridge('browser_dom_bridge_stale_scope', {
                    reason,
                    browser_session_id: evidence.session_id,
                    browser_window_id: evidence.browser_window_id,
                    request_scope_address: evidence.active_scope_address,
                    active_scope_address: currentScope?.address || '',
                    blocker_reason: 'browser_dom_request_scope_mismatch',
                });
                return;
            }
            const payload = msg.payload || msg;
            const target = payload.target || payload;
            if (!annotationReticleIsBrowserDomElementTarget(target)) {
                recordAnnotationReticleBrowserDomBridge('browser_dom_bridge_no_target', {
                    reason,
                    browser_session_id: evidence.session_id,
                    browser_window_id: evidence.browser_window_id,
                    blocker_reason: payload.blocker_reason || target?.blocker_reason || 'no_dom_target_at_point',
                    skipped: Array.isArray(payload.skipped) ? payload.skipped : [],
                    rejection_reasons: Array.isArray(payload.rejection_reasons) ? payload.rejection_reasons : [],
                    message: payload.message || '',
                });
                return;
            }
            const candidate = buildBrowserDomElementAnnotationCandidate({
                ...target,
                browser_session_id: evidence.session_id,
                browser_window_id: evidence.browser_window_id,
                browser_pid: evidence.browser_pid,
                skipped: Array.isArray(payload.skipped) ? payload.skipped : (Array.isArray(target.skipped) ? target.skipped : []),
                rejection_reasons: Array.isArray(payload.rejection_reasons) ? payload.rejection_reasons : [],
            }, {
                content_rect: payload.browser_content_rect || evidence.content_rect,
                root_label: target.source_url || target.surface_id || evidence.session_id,
                refreshed_at: new Date().toISOString(),
                browser_attachment: 'explicit_local_page',
                browser_session_id: evidence.session_id,
                browser_window_id: evidence.browser_window_id,
                browser_pid: evidence.browser_pid,
                provenance: 'sigil_reticle_browser_dom_bridge',
            });
            annotationReticleUpsertCandidate(candidate);
            annotationReticle.updatePreview(pointer);
            syncAnnotationReticleSnapshot();
            const decisionReport = liveJs.annotationReticle?.decision_report || null;
            const rejected = Array.isArray(decisionReport?.rejected) ? decisionReport.rejected : [];
            const rejection = rejected.find((entry) => String(entry.id || '') === String(candidate.id || candidate.subject_id || ''));
            if (rejection) {
                recordAnnotationReticleBrowserDomBridge('browser_dom_bridge_candidate_rejected', {
                    reason,
                    browser_session_id: evidence.session_id,
                    browser_window_id: evidence.browser_window_id,
                    candidate_id: candidate.id,
                    blocker_reason: rejection.reason || 'browser_dom_candidate_rejected',
                    rejection_reason: rejection.reason || '',
                });
                return;
            }
            recordAnnotationReticleBrowserDomBridge('browser_dom_bridge_target', {
                reason,
                browser_session_id: evidence.session_id,
                browser_window_id: evidence.browser_window_id,
                candidate_id: candidate.id,
                skipped: candidate.source_metadata?.skipped_stack || [],
                rejection_reasons: candidate.source_metadata?.rejection_reasons || [],
            });
        })
        .catch((error) => {
            if (pendingAnnotationReticleBrowserDomRequestKey === requestKey) pendingAnnotationReticleBrowserDomRequestKey = '';
            const blocker = annotationReticleBrowserDomBridgeBlockerFromError(error);
            recordAnnotationReticleBrowserDomBridge('browser_dom_bridge_failed', {
                reason,
                browser_session_id: evidence.session_id,
                browser_window_id: evidence.browser_window_id,
                blocker_reason: blocker.blocker_reason,
                code: blocker.code,
                status: error?.status || '',
                message: String(error?.message || error),
            });
        });
    return true;
}

function annotationReticleHandleNativeWindow(payload = {}) {
    liveJs.annotationReticleTargetEvidence.latestNativeWindowEvent = payload;
    annotationReticleUpsertCandidate(buildNativeWindowAnnotationCandidate(payload, {
        refreshed_at: payload.ts || new Date().toISOString(),
        source_event_id: payload.ref || payload.id || '',
    }));
}

function annotationReticleHandleNativeAxElement(payload = {}) {
    liveJs.annotationReticleTargetEvidence.latestNativeAxElementEvent = payload;
    const windowEvent = liveJs.annotationReticleTargetEvidence.latestNativeWindowEvent;
    const windowCandidate = buildNativeWindowAnnotationCandidate(windowEvent || {}, {
        refreshed_at: windowEvent?.ts || new Date().toISOString(),
    });
    const activeScope = annotationReticle.snapshot()?.active_scope || null;
    const selectedRoot = activeScope?.adapter_id === 'macos-ax' || activeScope?.root_kind === 'native_window'
        ? activeScope
        : windowCandidate;
    annotationReticleUpsertCandidate(buildNativeAxElementAnnotationCandidate(payload, {
        selected_root: selectedRoot,
        window: windowEvent,
        refreshed_at: payload.ts || new Date().toISOString(),
        source_event_id: payload.ref || payload.id || '',
    }));
}

function syncAnnotationReticleSnapshot() {
    liveJs.annotationReticle = annotationReticle.snapshot();
    state.annotationReticle = liveJs.annotationReticle;
    liveJs.annotationReticleOverlay = buildProjectedAnnotationReticleOverlay(liveJs.annotationReticle);
    return liveJs.annotationReticle;
}

function projectAnnotationRect(rect = null) {
    if (!rect) return null;
    const origin = stagePoint({ x: rect.x, y: rect.y, valid: true });
    if (!origin) return null;
    return {
        x: origin.x,
        y: origin.y,
        width: rect.width,
        height: rect.height,
    };
}

function projectAnnotationOverlayEntry(entry = null) {
    if (!entry?.rect) return null;
    const rect = projectAnnotationRect(entry.rect);
    if (!rect) return null;
    return { ...entry, rect };
}

function buildProjectedAnnotationReticleOverlay(snapshot = liveJs.annotationReticle) {
    const model = buildAnnotationReticleOverlayModel(snapshot);
    return {
        ...model,
        frames: model.frames.map(projectAnnotationOverlayEntry).filter(Boolean),
        hover: projectAnnotationOverlayEntry(model.hover),
        anchors: model.anchors.map(projectAnnotationOverlayEntry).filter(Boolean),
    };
}

function buildProjectedSelectionModeOverlay(selectionMode = liveJs.selectionMode) {
    return selectionModeRuntime.buildProjectedOverlay(selectionMode);
}

function recordAnnotationReticleEvent(stage, event = {}) {
    const entry = {
        ts: Date.now(),
        stage,
        ...event,
    };
    if (!Array.isArray(liveJs.annotationReticleEvents)) liveJs.annotationReticleEvents = [];
    liveJs.annotationReticleEvents.push(entry);
    if (liveJs.annotationReticleEvents.length > 40) liveJs.annotationReticleEvents.shift();
    host.post('sigil.annotation_reticle.event', entry);
    return entry;
}

function enterAnnotationReticle(pointer = null, reason = 'radial-reticle') {
    annotationReticle.enter(pointer);
    syncAnnotationReticleSnapshot();
    recordAnnotationReticleEvent('enter', {
        reason,
        pointer,
        root_evidence: liveJs.annotationReticle.root_evidence,
    });
    return liveJs.annotationReticle;
}

let pendingAnnotationReticlePreviewPointer = null;
let pendingAnnotationReticlePreviewFrame = 0;

function flushAnnotationReticlePreview() {
    pendingAnnotationReticlePreviewFrame = 0;
    const pointer = pendingAnnotationReticlePreviewPointer;
    pendingAnnotationReticlePreviewPointer = null;
    if (!pointer || !annotationReticle.active) return;
    annotationReticle.updatePreview(pointer);
    syncAnnotationReticleSnapshot();
    annotationReticleRequestBrowserDomTarget(pointer, 'preview', liveJs.annotationReticle?.preview_target || null);
}

function updateAnnotationReticlePreview(pointer = null) {
    if (!annotationReticle.active) return liveJs.annotationReticle;
    if (!pointer) return liveJs.annotationReticle;
    pendingAnnotationReticlePreviewPointer = { x: Number(pointer.x), y: Number(pointer.y), valid: true };
    if (!pendingAnnotationReticlePreviewFrame) {
        pendingAnnotationReticlePreviewFrame = requestAnimationFrame(flushAnnotationReticlePreview);
    }
    return liveJs.annotationReticle;
}

function exitAnnotationReticle(reason = 'exit') {
    pendingAnnotationReticlePreviewPointer = null;
    if (pendingAnnotationReticlePreviewFrame) {
        cancelAnimationFrame(pendingAnnotationReticlePreviewFrame);
        pendingAnnotationReticlePreviewFrame = 0;
    }
    if (!annotationReticle.active) {
        syncAnnotationReticleSnapshot();
        return liveJs.annotationReticle;
    }
    annotationReticle.exit(reason);
    syncAnnotationReticleSnapshot();
    recordAnnotationReticleEvent('exit', { reason });
    return liveJs.annotationReticle;
}

function commitAnnotationReticleRelease(x, y) {
    if (!annotationReticle.active) return null;
    if (pendingAnnotationReticlePreviewFrame) {
        cancelAnimationFrame(pendingAnnotationReticlePreviewFrame);
        flushAnnotationReticlePreview();
    }
    annotationReticle.updatePreview({ x, y, valid: true });
    syncAnnotationReticleSnapshot();
    annotationReticleRequestBrowserDomTarget({ x, y, valid: true }, 'release', liveJs.annotationReticle?.preview_target || null);
    const event = annotationReticle.commitRelease({ x, y, valid: true });
    syncAnnotationReticleSnapshot();
    if (event) {
        updateActiveContextFromReticle(event.context_session, 'reticle-commit');
        recordAnnotationReticleEvent('commit', event);
    }
    return event;
}

function requestAnnotationSnapshot(reason = 'radial-camera') {
    const event = annotationReticle.requestSnapshotEvent();
    syncAnnotationReticleSnapshot();
    const reticleContextSession = event.context_session || liveJs.annotationReticle?.context_session || null;
    const {
        contextSession,
        contextKeyframe,
        contextUnavailable,
    } = contextRecordingRuntime.resolveReticleBundleContext({
        reticleContextSession,
        event,
        reason,
    });
    recordAnnotationReticleEvent('snapshot_request', {
        type: event.type,
        reason,
        request: event,
        context_session: contextSession,
        context_keyframe: contextKeyframe,
    });
    if (!event.available && !contextSession) return false;
    host.post('canvas_inspector.capture_bundle', {
        trigger: 'sigil_radial_camera',
        reason,
        anchor_count: event.anchor_count,
        context_session: contextSession,
        context_keyframe: contextKeyframe,
        context_unavailable: contextUnavailable,
    });
    return true;
}

function requestCanvasInspectorAnnotationToggle(reason = 'sigil-radial') {
    void ensureUtilityCanvasVisible('surface-inspector', { focus: false }).then((canvas) => {
        window.setTimeout(() => {
            sendCanvasMessage(canvas.id, {
                type: CANVAS_INSPECTOR_ANNOTATION_OPEN_EVENT,
                reason: `sigil_${reason}`,
            });
        }, canvas.created ? 250 : 0);
    }).catch((error) => {
        recordAnnotationReticleEvent('annotation_toggle_failed', {
            reason,
            error: String(error?.message || error),
        });
    });
}

function updateActiveContextFromReticle(contextSession = null, reason = 'reticle') {
    return contextRecordingRuntime.updateActiveContextFromReticle(contextSession, reason);
}

function appendContextRecordingKeyframe(keyframe = liveJs.activeContext?.context_keyframe, options = {}) {
    return contextRecordingRuntime.appendContextRecordingKeyframe(keyframe, options);
}

function appendContextRecordingEvent(event = {}) {
    return contextRecordingRuntime.appendContextRecordingEvent(event);
}

function enterSelectionMode(pointer = null, reason = 'avatar-double-click') {
    return selectionModeRuntime.enter(pointer, reason);
}

function exitSelectionMode(reason = 'cancel') {
    return selectionModeRuntime.exit(reason);
}

function recordUxCommandRuntime(result = {}, { fallback = false } = {}) {
    const entry = {
        ts: Date.now(),
        matched: result.matched === true,
        executed: result.executed === true,
        command_id: result.command_id || null,
        binding_id: result.binding_id || null,
        handler_ref: result.handler_ref || null,
        reason: result.reason || '',
        errors: Array.isArray(result.errors) ? result.errors : [],
        input: result.input || null,
        fallback,
    };
    liveJs.uxCommandRuntime = {
        lastExecution: entry,
        executedCount: (liveJs.uxCommandRuntime?.executedCount || 0) + (entry.executed ? 1 : 0),
        fallbackCount: (liveJs.uxCommandRuntime?.fallbackCount || 0) + (entry.fallback ? 1 : 0),
        trace: [
            ...(liveJs.uxCommandRuntime?.trace || []),
            entry,
        ].slice(-20),
    };
    recordInteraction('ux-command', entry);
    return entry;
}

function executeSelectionModeRouteCommand(command = '', msg = {}, options = {}) {
    if (command === 'selectBadge') {
        return selectionModeRuntime.selectTargetNode(options.nodeId || msg.nodeId || msg.node_id || '', {
            reason: 'badge-click',
        });
    }
    return sigilUxCommandRuntime?.executeSelectionModeRoute(command, msg, options) || null;
}

function acquireSelectionModeCandidates(point = null) {
    return selectionModeRuntime.acquire(point);
}

function cycleSelectionModeTarget(delta = -1) {
    return selectionModeRuntime.cycleTarget(delta);
}

function commitSelectionMode(reason = 'selection-mode-commit') {
    return selectionModeRuntime.commit(reason);
}

function setSelectionModeNodeComment(nodeId = '', text = '', options = {}) {
    return selectionModeRuntime.setNodeComment(nodeId, text, options);
}

function createSelectionModeContextFromDebugInput(input = {}) {
    return selectionModeRuntime.createContextFromDebugInput(input);
}

function handleSelectionModeInput(msg = {}) {
    return selectionModeRuntime.handleInput(msg);
}

function readSelectionModeCursorModelSnapshot() {
    liveJs.selectionModeCursorModel = selectionModeCursorModelRenderer?.snapshot?.() || null;
    return liveJs.selectionModeCursorModel;
}

function refreshSelectionModeCursorModelSnapshot(overlay = liveJs.selectionModeOverlay) {
    selectionModeCursorModelRenderer?.update(overlay || null, { time: state.globalTime });
    return readSelectionModeCursorModelSnapshot();
}

function annotationReticleItemMetrics(radial = liveJs.radialGestureMenu) {
    const item = radial?.items?.find((candidate) => candidate.id === SIGIL_ANNOTATION_RETICLE_ITEM_ID);
    if (!item) return null;
    return radialItemPointerMetrics(radial, item);
}

function updateAnnotationReticleAcquisition(radial = liveJs.radialGestureMenu) {
    const metrics = annotationReticleItemMetrics(radial);
    return annotationReticleAcquisition.update(radial, metrics);
}

function pointInRadialTargetSurface(point = null, surface = radialTargetSurface.snapshot()) {
    if (!point || !Array.isArray(surface?.frame) || surface.frame.length < 4) return false;
    const [x, y, w, h] = surface.frame.map(Number);
    if (![x, y, w, h].every(Number.isFinite)) return false;
    return point.x >= x && point.x <= x + w && point.y >= y && point.y <= y + h;
}

function radialTargetSurfaceReceiptEvidence(payload = {}) {
    const surface = radialTargetSurface.snapshot();
    const localPoint = Number.isFinite(Number(payload.clientX)) && Number.isFinite(Number(payload.clientY))
        ? { x: Number(payload.clientX), y: Number(payload.clientY) }
        : Number.isFinite(Number(payload.itemX)) && Number.isFinite(Number(payload.itemY))
        ? { x: Number(payload.itemX), y: Number(payload.itemY) }
        : null;
    const worldPoint = localPoint && Array.isArray(surface.frame)
        ? { x: Number(surface.frame[0]) + localPoint.x, y: Number(surface.frame[1]) + localPoint.y, valid: true }
        : null;
    return {
        itemId: payload.itemId,
        itemAction: payload.itemAction ?? null,
        currentState: liveJs.currentState,
        radialPhase: liveJs.radialGestureMenu?.phase ?? null,
        surfaceInteractive: surface.interactive,
        surfaceFrame: surface.frame,
        surfaceTargets: surface.targets,
        childSurfaceBounds: payload.surfaceBounds ?? null,
        childLocalPoint: localPoint,
        worldPoint,
        pointInsideSurfaceAtReceipt: pointInRadialTargetSurface(worldPoint, surface),
    };
}

function applyRadialTargetSurfaceDragPayload(payload = {}, receipt = radialTargetSurfaceReceiptEvidence(payload)) {
    const point = receipt.worldPoint;
    if (!point || (liveJs.currentState !== 'RADIAL' && liveJs.currentState !== 'FAST_TRAVEL')) return false;
    const update = radialGestureMenu.move(point);
    applyRadialGestureMove(update, point.x, point.y);
    return true;
}

function emitStatusItemState() {
    if (!isPrimarySurfaceSegment()) return;
    host.post('status_item.state', {
        visible: liveJs.avatarVisible,
    });
}

// canvas_object.marks — publish the avatar's current desktop position so the
// Surface Inspector can mark it on its minimap and indented tree list.
// Event-driven via setAvatarPosition + visibility changes; a ~5 s heartbeat
// keeps the mark alive inside the inspector's 10 s TTL while idle-visible.
const MARKS_CANVAS_ID = SIGIL_OBJECT_CONTROL_CANVAS_ID;
const MARKS_OBJECT_ID = 'avatar';
const MARKS_HEARTBEAT_MS = 5000;
let _lastMarkEmitAt = 0;

function emitRadialMenuObjectRegistry() {
    if (!isPrimarySurfaceSegment()) return;
    const registry = buildAvatarObjectRegistry(state, {
        canvasId: SIGIL_OBJECT_CONTROL_CANVAS_ID,
        avatarPos: liveJs.avatarPos,
        avatarVisible: liveJs.avatarVisible,
    });
    host.post('canvas_object.registry', registry);
}

function handleCanvasObjectTransformPatch(msg = {}) {
    if (!isPrimarySurfaceSegment()) return;
    const result = applyRadialMenuObjectTransformPatch(state.radialGestureMenu, msg, {
        canvasId: SIGIL_OBJECT_CONTROL_CANVAS_ID,
    });
    if (result.status !== 'applied') {
        console.warn('[sigil] object transform patch rejected:', result.reason, result.message || result.target?.object_id);
    }
    host.post('canvas_object.transform.result', result);
    emitRadialMenuObjectRegistry();
    scheduleRenderFrame();
}

function radialGestureObjectMarks() {
    const radial = liveJs.radialGestureMenu;
    if (!radial || radial.phase !== 'radial' || !Array.isArray(radial.items)) return [];
    return radial.items
        .filter((item) => item?.id && item?.center)
        .map((item) => ({
            id: `radial-${item.id}`,
            x: Math.round(Number(item.center.x) || 0),
            y: Math.round(Number(item.center.y) || 0),
            name: item.label || item.id,
            color: item.id === radial.activeItemId ? '#ffffff' : '#8cf8ff',
            w: Math.max(44, Math.round(Number(item.hitRadius || item.visualRadius || 24) * 2)),
            h: Math.max(44, Math.round(Number(item.hitRadius || item.visualRadius || 24) * 2)),
            minimap_size_mode: 'desktop_world',
            rect: true,
            ellipse: true,
            cross: false,
        }));
}

function emitAvatarMark() {
    if (!isPrimarySurfaceSegment()) return;
    if (!liveJs.avatarPos.valid) return;
    if (!liveJs.avatarVisible) {
        host.post('canvas_object.marks', {
            canvas_id: MARKS_CANVAS_ID,
            objects: [],
        });
        _lastMarkEmitAt = performance.now();
        return;
    }
    const objects = [{
        id: MARKS_OBJECT_ID,
        x: Math.round(liveJs.avatarPos.x),
        y: Math.round(liveJs.avatarPos.y),
        name: 'Avatar',
    }, ...radialGestureObjectMarks()];
    host.post('canvas_object.marks', {
        canvas_id: MARKS_CANVAS_ID,
        objects,
    });
    _lastMarkEmitAt = performance.now();
}

function startMarkHeartbeat() {
    if (startMarkHeartbeat._started) return;
    startMarkHeartbeat._started = true;
    setInterval(() => {
        if (!isPrimarySurfaceSegment()) return;
        if (!liveJs.avatarVisible || !liveJs.avatarPos.valid) return;
        if (performance.now() - _lastMarkEmitAt < MARKS_HEARTBEAT_MS - 500) return;
        emitAvatarMark();
    }, MARKS_HEARTBEAT_MS);
}

function setAvatarVisibility(visible) {
    const next = !!visible;
    if (liveJs.avatarVisible === next && !visibilityTransition.active) return;
    liveJs.avatarVisible = next;
    if (!next) {
        contextMenu.close('avatar-hidden');
        radialGestureMenu.cancel('avatar-hidden');
        clearGestureState();
        liveJs.currentState = 'IDLE';
        liveJs.state = 'IDLE';
    }
    emitStatusItemState();
    emitAvatarMark();
    syncSigilInputRegions();
    syncHitTargetToAvatar();
    if (!rendererSuspended) scheduleRenderFrame();
}

function animateVisibility(visible, lifecycleAction = null, origin = null) {
    const targetVisible = !!visible;
    if (liveJs.avatarVisible === targetVisible && !visibilityTransition.active) return;
    if (targetVisible) setAvatarVisibility(true);
    visibilityTransition.begin({
        targetVisible,
        lifecycleAction,
        origin,
        avatarPos: liveJs.avatarPos.valid ? { ...liveJs.avatarPos } : null,
    });
    if (!rendererSuspended) scheduleRenderFrame();
}

function toggleAvatarVisibility(origin = null) {
    animateVisibility(!liveJs.avatarVisible, null, origin);
}

function setAvatarPosition(x, y) {
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    const next = liveJs.displays.length > 0
        ? clampPointToDisplays(liveJs.displays, x, y)
        : { x, y };
    liveJs.avatarPos = { x: next.x, y: next.y, valid: true };
    postLastPositionToDaemon();
    emitAvatarMark();
    syncSigilInputRegions();
    syncHitTargetToAvatar();
    if (!rendererSuspended) scheduleRenderFrame();
}

function syncHitTargetToAvatar() {
    if (!isPrimarySurfaceSegment() || !liveJs.avatarPos.valid) return;
    hitTarget.setSize(state.avatarHitRadius * 2);
    hitTarget.syncWorldCenter(
        liveJs.avatarPos,
        liveJs.avatarVisible && ['IDLE', 'PRESS', 'RADIAL', 'FAST_TRAVEL'].includes(liveJs.currentState),
        { displays: liveJs.displays }
    );
}

function cancelInteraction(reason) {
    if (liveJs.currentState === 'IDLE') return;
    recordInteraction('interaction:cancel', { reason });
    radialGestureMenu.cancel(reason);
    exitAnnotationReticle(reason);
    clearGestureState();
    fastTravel.clearGesture(reason);
    setInteractionState('IDLE', reason);
}

let lastContextMenuOpenAt = 0;
let lastContextMenuOpenPoint = null;
const recentDaemonPointerEvents = new Map();
const HIT_ECHO_SUPPRESS_MS = 450;
const HIT_ECHO_SUPPRESS_DISTANCE = 6;
const avatarDoubleClickTracker = createAvatarDoubleClickTracker({
    now: () => performance.now(),
    distance,
    isOnAvatar,
    getAvatarHitRadius: () => liveJs.avatarHitRadius,
});

function consumeAvatarDoubleClick(x, y) {
    return avatarDoubleClickTracker.consumeAvatarDoubleClick(x, y);
}

function resetAvatarDoubleClick() {
    avatarDoubleClickTracker.resetAvatarDoubleClick();
}

function markSelectionModeEntryReleasePending() {
    avatarDoubleClickTracker.markSelectionModeEntryReleasePending();
}

function clearSelectionModeEntryReleasePending() {
    avatarDoubleClickTracker.clearSelectionModeEntryReleasePending();
}

function consumeSelectionModeEntryRelease(msg = {}) {
    return avatarDoubleClickTracker.consumeSelectionModeEntryRelease(msg);
}

function rememberDaemonPointerEvent(msg = {}) {
    if (msg.sourceOrigin === 'canvas' || msg.source_origin === 'canvas') return;
    if (
        msg.type !== 'left_mouse_down'
        && msg.type !== 'left_mouse_dragged'
        && msg.type !== 'left_mouse_up'
    ) return;
    if (!Number.isFinite(msg.x) || !Number.isFinite(msg.y)) return;
    recentDaemonPointerEvents.set(msg.type, {
        x: msg.x,
        y: msg.y,
        at: performance.now(),
    });
}

function isRecentDaemonPointerEcho(kind, point) {
    const prior = recentDaemonPointerEvents.get(kind);
    if (!prior || !point) return false;
    const elapsed = performance.now() - prior.at;
    if (elapsed < 0 || elapsed > HIT_ECHO_SUPPRESS_MS) return false;
    return distance(point.x, point.y, prior.x, prior.y) <= HIT_ECHO_SUPPRESS_DISTANCE;
}

function isDuplicateContextMenuOpenClick(x, y) {
    if (!lastContextMenuOpenPoint) {
        recordInteraction('context-menu:duplicate-check', { x, y, duplicate: false, reason: 'no-prior-open' });
        return false;
    }
    const elapsed = performance.now() - lastContextMenuOpenAt;
    if (elapsed > 900) {
        recordInteraction('context-menu:duplicate-check', { x, y, elapsed, duplicate: false, reason: 'elapsed' });
        return false;
    }
    const tolerance = Math.max(16, Math.min(80, Number(state.avatarHitRadius) || 0));
    const delta = distance(x, y, lastContextMenuOpenPoint.x, lastContextMenuOpenPoint.y);
    const duplicate = delta <= tolerance;
    recordInteraction('context-menu:duplicate-check', { x, y, elapsed, tolerance, delta, duplicate });
    return duplicate;
}

function openContextMenuAt(x, y, options = {}) {
    if (!liveJs.avatarVisible) {
        recordInteraction('context-menu:open-rejected', { x, y, options, reason: 'avatar-hidden' });
        return false;
    }
    if (!options.force && liveJs.currentState !== 'IDLE') {
        recordInteraction('context-menu:open-rejected', { x, y, options, reason: 'state-not-idle' });
        return false;
    }
    if (!options.force && !isOnAvatar(x, y)) {
        recordInteraction('context-menu:open-rejected', { x, y, options, reason: 'not-on-avatar' });
        return false;
    }
    cancelInteraction('context-menu');
    contextMenu.openAt({ x, y, valid: true });
    lastContextMenuOpenAt = performance.now();
    lastContextMenuOpenPoint = { x, y };
    syncSigilInputRegions();
    if (!rendererSuspended) scheduleRenderFrame();
    recordInteraction('context-menu:open-request', { x, y, options });
    return true;
}

function syncRadialTargetSurface() {
    if (!isPrimarySurfaceSegment()) return false;
    return radialTargetSurface.sync(liveJs.radialGestureMenu, { displays: liveJs.displays });
}

function applyRadialGestureMove(update, x, y) {
    liveJs.radialGestureMenu = update?.snapshot ?? radialGestureMenu.snapshot();
    syncRadialTargetSurface();
    emitAvatarMark();
    const reticleAcquisition = updateAnnotationReticleAcquisition(liveJs.radialGestureMenu);
    if (liveJs.radialGestureMenu?.phase === 'radial') {
        if (liveJs.radialGestureMenu.activeItemId === SIGIL_ANNOTATION_RETICLE_ITEM_ID) {
            radialReticleItemWasActive = true;
        } else {
            const metrics = annotationReticleItemMetrics(liveJs.radialGestureMenu);
            if (metrics && metrics.relation !== 'outward') radialReticleItemWasActive = false;
        }
    }
    const reticleMetrics = annotationReticleItemMetrics(liveJs.radialGestureMenu);
    const crossedReticleAtHandoff = update?.enteredFastTravel
        && update?.priorActiveItemId === SIGIL_ANNOTATION_RETICLE_ITEM_ID
        && reticleOuterMarginExit(reticleMetrics, liveJs.radialGestureMenu);
    const liveReticleHandoff = radialReticleItemWasActive
        && liveJs.radialGestureMenu?.phase === 'fastTravel'
        && reticleOuterMarginExit(reticleMetrics, liveJs.radialGestureMenu);
    if (liveJs.radialGestureMenu?.phase === 'fastTravel' && (reticleAcquisition.acquire || crossedReticleAtHandoff || liveReticleHandoff)) {
        radialReticleItemWasActive = false;
        if (!annotationReticle.active) enterAnnotationReticle({ x, y, valid: true }, 'drag-through-reticle');
        else updateAnnotationReticlePreview({ x, y, valid: true });
    } else if (annotationReticle.active) {
        updateAnnotationReticlePreview({ x, y, valid: true });
    }
    if (update?.enteredFastTravel) {
        fastTravel.beginGesture({ ...liveJs.avatarPos });
        fastTravel.updateGesture({ x, y, valid: true });
        setInteractionState('FAST_TRAVEL', 'radial-handoff-fast-travel');
        return true;
    }
    if (update?.reenteredRadial) {
        fastTravel.clearGesture('radial-reentry');
        exitAnnotationReticle('radial-reentry');
        setInteractionState('RADIAL', 'radial-reentry');
        return true;
    }
    if (liveJs.currentState === 'FAST_TRAVEL') {
        fastTravel.updateGesture({ x, y, valid: true });
    }
    return false;
}

function handleLeftMouseDown(x, y) {
    switch (liveJs.currentState) {
        case 'IDLE':
            if (!isOnAvatar(x, y)) return;
            sigilUxCommandRuntime.executeAvatarPressBegin({ type: 'left_mouse_down', x, y }, {
                pointer: { x, y, valid: true },
            });
            return;
        case 'GOTO':
            if (isOnAvatar(x, y)) {
                if (consumeAvatarDoubleClick(x, y)) {
                    sigilUxCommandRuntime.executeSelectionModeEnter({ type: 'left_mouse_down', x, y }, {
                        pointer: { x, y, valid: true },
                    });
                    return;
                }
                clearGestureState();
                setInteractionState('IDLE', 'goto-click-on-avatar');
                return;
            }
            liveJs.mousedownPos = { x, y };
            return;
        default:
            return;
    }
}

function handleLeftMouseUp(x, y) {
    switch (liveJs.currentState) {
        case 'PRESS':
            if (
                liveJs.mousedownPos
                && distance(x, y, liveJs.mousedownPos.x, liveJs.mousedownPos.y) >= liveJs.dragThreshold
            ) {
                clearGestureState();
                queueFastTravel(x, y);
                setInteractionState('IDLE', 'press-release-fast-travel');
                return;
            }
            sigilUxCommandRuntime.executeAvatarGotoBegin({ type: 'left_mouse_up', x, y }, {
                pointer: { x, y, valid: true },
            });
            return;
        case 'RADIAL': {
            const result = radialGestureMenu.release({ x, y, valid: true }, {
                input: {
                    kind: 'gesture',
                    source: 'sigil.avatar',
                    pointer: { x, y },
                    state: liveJs.currentState,
                },
            });
            const annotationDisposition = annotationReticleReleaseDisposition(result);
            if (annotationDisposition.exit) exitAnnotationReticle(annotationDisposition.reason);
            clearGestureState();
            fastTravel.clearGesture(result?.committed?.type === 'item' ? 'radial-item' : 'radial-release');
            setInteractionState('IDLE', result?.committed?.type === 'item' ? 'radial-release-item' : 'radial-release-cancel');
            return;
        }
        case 'FAST_TRAVEL': {
            const releaseDistanceFromDown = liveJs.mousedownPos
                ? distance(x, y, liveJs.mousedownPos.x, liveJs.mousedownPos.y)
                : 0;
            const result = radialGestureMenu.release({ x, y, valid: true }, {
                input: {
                    kind: 'gesture',
                    source: 'sigil.avatar',
                    pointer: { x, y },
                    state: liveJs.currentState,
                },
            });
            const annotationCommit = commitAnnotationReticleRelease(x, y);
            clearGestureState();
            if (annotationCommit?.placement?.point) {
                const point = annotationCommit.placement.point;
                queueFastTravel(point.x, point.y);
                setInteractionState('IDLE', 'annotation-reticle-release');
                return;
            }
            if (result?.committed?.type === 'fastTravel') {
                queueFastTravel(x, y);
                setInteractionState('IDLE', 'radial-release-fast-travel');
                return;
            }
            if (
                !annotationReticle.active
                && releaseDistanceFromDown >= liveJs.dragThreshold
                && !result?.committed
            ) {
                queueFastTravel(x, y);
                setInteractionState('IDLE', 'radial-fast-travel-release-fallback');
                return;
            }
            fastTravel.clearGesture(result?.committed?.type === 'item' ? 'radial-fast-travel-item' : 'radial-fast-travel-cancel');
            setInteractionState('IDLE', result?.committed?.type === 'item' ? 'radial-fast-travel-item' : 'radial-fast-travel-cancel');
            return;
        }
        case 'GOTO':
            clearGestureState();
            if (!isOnAvatar(x, y)) {
                queueFastTravel(x, y);
                setInteractionState('IDLE', 'goto-release-fast-travel');
            }
            return;
        default:
            return;
    }
}

function handleMouseMove(x, y) {
    if (liveJs.currentState === 'RADIAL' || liveJs.currentState === 'FAST_TRAVEL') {
        const update = radialGestureMenu.move({ x, y, valid: true });
        applyRadialGestureMove(update, x, y);
        return;
    }
    if (liveJs.currentState !== 'PRESS' || !liveJs.mousedownPos) return;
    if (distance(x, y, liveJs.mousedownPos.x, liveJs.mousedownPos.y) < liveJs.dragThreshold) return;
    sigilUxCommandRuntime.executeAvatarRadialBegin({ type: 'left_mouse_dragged', x, y }, {
        pointer: { x, y, valid: true },
    });
}

function handleInputEvent(msg) {
    if (
        msg?.type === 'right_mouse_down'
        || msg?.type === 'right_mouse_up'
        || msg?.type === 'left_mouse_down'
        || msg?.type === 'left_mouse_up'
        || msg?.type === 'scroll_wheel'
        || (contextMenu.isOpen() && msg?.type !== 'mouse_moved')
    ) {
        recordInteraction('input', {
            type: msg.type,
            x: msg.x,
            y: msg.y,
            dx: msg.dx,
            dy: msg.dy,
            sourceOrigin: msg.sourceOrigin ?? msg.source_origin ?? null,
            sourceCanvasId: msg.sourceCanvasId ?? msg.source_canvas_id ?? null,
            envelopeType: msg.envelope_type ?? null,
            radialTargetSurfaceActive: radialTargetSurface.snapshot().interactive,
            pointerInsideRadialTargetSurface: pointInRadialTargetSurface(
                Number.isFinite(Number(msg.x)) && Number.isFinite(Number(msg.y))
                    ? { x: Number(msg.x), y: Number(msg.y), valid: true }
                    : null
            ),
        });
    }
    if (typeof msg.x === 'number' && typeof msg.y === 'number') {
        liveJs.pointerPos = { x: msg.x, y: msg.y };
        liveJs.cursorTarget = { x: msg.x, y: msg.y, valid: true };
        if (!liveJs.currentCursor.valid) {
            liveJs.currentCursor = { x: msg.x, y: msg.y, valid: true };
        }
        if (msg.type === 'mouse_moved') updateAvatarHoverFromPoint(msg.x, msg.y);
        rememberDaemonPointerEvent(msg);
    }

    if (handleSelectionModeInput(msg)) return;

    if (
        contextMenu.isOpen()
        && ['left_mouse_down', 'left_mouse_dragged', 'left_mouse_up', 'mouse_moved', 'scroll_wheel'].includes(msg.type)
        && typeof msg.x === 'number'
        && typeof msg.y === 'number'
    ) {
        const point = { x: msg.x, y: msg.y, valid: true };
        const inMenu = contextMenu.containsDesktopPoint(point);
        if (msg.type !== 'mouse_moved') recordInteraction('context-menu:route-attempt', { type: msg.type, point, inMenu });
        const sourceOrigin = msg.sourceOrigin ?? msg.source_origin ?? null;
        const sourceCanvasId = msg.sourceCanvasId ?? msg.source_canvas_id ?? null;
        const ownerCanvasId = msg.ownerCanvasId ?? msg.owner_canvas_id ?? null;
        const sourceIdentity = sourceOrigin || sourceCanvasId || ownerCanvasId
            ? { sourceOrigin, sourceCanvasId, ownerCanvasId }
            : null;
        const routeOptions = {
            raw: msg,
            ...(sourceIdentity ? { sourceIdentity } : {}),
            ...(sourceOrigin === 'canvas' && sourceCanvasId === hitTarget.hit.id ? { regionId: 'sigil-context-menu' } : {}),
        };
        if ((inMenu || msg.type !== 'left_mouse_down') && contextMenu.handlePointerEvent(msg.type, point, routeOptions)) {
            if (msg.type !== 'mouse_moved') recordInteraction('context-menu:routed', { type: msg.type, point, inMenu });
            return;
        }
        if (msg.type === 'left_mouse_down') {
            recordInteraction('context-menu:outside-left-down', { point });
            contextMenu.close('outside-click');
        }
    }

    switch (msg.type) {
        case 'left_mouse_down':
            handleLeftMouseDown(msg.x, msg.y);
            return;
        case 'left_mouse_up':
            handleLeftMouseUp(msg.x, msg.y);
            return;
        case 'left_mouse_dragged':
        case 'mouse_moved':
            handleMouseMove(msg.x, msg.y);
            return;
        case 'right_mouse_down':
            recordInteraction('context-menu:right-down', { x: msg.x, y: msg.y, open: contextMenu.isOpen() });
            {
                const route = resolveContextMenuRightClickRoute(msg, {
                    isOpen: contextMenu.isOpen(),
                    isDuplicateOpenClick: isDuplicateContextMenuOpenClick,
                });
                if (route.direct === 'duplicate_open_echo') {
                    recordInteraction('context-menu:right-down-duplicate-ignored', { x: msg.x, y: msg.y });
                    return;
                }
                if (route.command === 'toggle') {
                    recordInteraction('context-menu:right-down-close-open-menu', { x: msg.x, y: msg.y });
                    sigilUxCommandRuntime.executeContextMenuRightClick(route, msg);
                    return;
                }
                if (route.command === 'open') {
                    const result = sigilUxCommandRuntime.executeContextMenuRightClick(route, msg);
                    if (contextMenuOpenCommandOpened(result)) return;
                    contextMenu.close('right-click-away');
                    cancelInteraction('right-click');
                    return;
                }
                contextMenu.close('right-click-away');
                cancelInteraction('right-click');
                return;
            }
        case 'key_down':
            if (msg.key_code === 53) {
                contextMenu.close('escape');
                cancelInteraction('escape');
            }
            return;
        default:
            return;
    }
}

function pointFromHitPayload(payload = {}) {
    const localX = Number(payload.offsetX);
    const localY = Number(payload.offsetY);
    const frame = hitTarget.hit.frame;
    if (Number.isFinite(localX) && Number.isFinite(localY) && Array.isArray(frame) && frame.length >= 4) {
        const nativePoint = {
            x: Number(frame[0]) + localX,
            y: Number(frame[1]) + localY,
        };
        return nativeToDesktopWorldPoint(nativePoint, liveJs.displays) ?? nativePoint;
    }

    const screenX = Number(payload.x ?? payload.screenX);
    const screenY = Number(payload.y ?? payload.screenY);
    if (Number.isFinite(screenX) && Number.isFinite(screenY)) {
        return nativeToDesktopWorldPoint({ x: screenX, y: screenY }, liveJs.displays) ?? { x: screenX, y: screenY };
    }
    return null;
}

function nativeFrameFromDesktopRect(rect) {
    if (!rect) return null;
    const native = desktopWorldToNativePoint({ x: rect.x, y: rect.y }, liveJs.displays);
    if (!native) return null;
    return [native.x, native.y, rect.w, rect.h];
}

function handleHitCanvasEvent(payload = {}) {
    const sourceCanvasId = payload.sourceCanvasId ?? payload.source_canvas_id ?? hitTarget.hit.id;
    const ownerCanvasId = payload.ownerCanvasId ?? payload.owner_canvas_id ?? payload.parent_canvas_id ?? null;
    if (payload.source !== 'sigil-hit' && payload.source_origin !== 'canvas' && sourceCanvasId !== hitTarget.hit.id) return;
    interactionTrace.record('hit-canvas', {
        kind: payload.kind,
        sourceCanvasId,
        ownerCanvasId,
        offsetX: payload.offsetX,
        offsetY: payload.offsetY,
        dx: payload.dx,
        dy: payload.dy,
        contextMenuOpen: contextMenu.isOpen(),
        hitFrame: hitTarget.hit.frame,
    });
    if (payload.kind === 'right_mouse_down' || payload.kind === 'right_mouse_up' || payload.kind === 'right_mouse_dragged') {
        interactionTrace.record('hit-canvas:ignored', { kind: payload.kind, reason: 'right-button-daemon-authority' });
        return;
    }
    const isLeftHitEvent = payload.kind === 'left_mouse_down'
        || payload.kind === 'left_mouse_dragged'
        || payload.kind === 'left_mouse_up';
    if (payload.kind === 'left_mouse_down' || payload.kind === 'left_mouse_dragged' || payload.kind === 'left_mouse_up') {
        if (!contextMenu.isOpen()) {
            interactionTrace.record('hit-canvas:ignored', { kind: payload.kind, reason: 'menu-closed' });
            return;
        }
    }
    const point = pointFromHitPayload(payload);
    if (!point) {
        interactionTrace.record('hit-canvas:ignored', { kind: payload.kind, reason: 'no-point' });
        return;
    }
    if (isLeftHitEvent && !contextMenu.containsDesktopPoint(point)) {
        interactionTrace.record('hit-canvas:ignored', { kind: payload.kind, reason: 'outside-menu', point });
        return;
    }
    if (isLeftHitEvent && isRecentDaemonPointerEcho(payload.kind, point)) {
        interactionTrace.record('hit-canvas:ignored', { kind: payload.kind, reason: 'daemon-echo', point });
        return;
    }
    const normalized = normalizeCanvasOriginInputMessage({ type: 'canvas_message', id: sourceCanvasId, payload }, {
        desktopWorld: point,
        sourceCanvasId,
        ownerCanvasId,
        sourceEvent: payload.kind,
        native: Array.isArray(hitTarget.hit.frame)
            ? {
                x: Number(hitTarget.hit.frame[0]) + Number(payload.offsetX ?? 0),
                y: Number(hitTarget.hit.frame[1]) + Number(payload.offsetY ?? 0),
            }
            : null,
    });
    if (!normalized) {
        interactionTrace.record('hit-canvas:ignored', { kind: payload.kind, reason: 'normalization-failed', point });
        return;
    }
    handleInputEvent({
        ...normalized,
        envelope_type: normalized.envelopeType,
    });
}

function handleRadialTargetSurfaceEvent(payload = {}) {
    if (payload.source !== 'sigil-radial-menu-surface') return;
    const receipt = radialTargetSurfaceReceiptEvidence(payload);
    interactionTrace.record('radial-surface', {
        kind: payload.kind,
        ...receipt,
    });
    if (payload.kind === 'radial_surface_ready') {
        radialTargetSurface.refreshPayload();
        return;
    }
    if (payload.kind === 'radial_item_pointer_down') {
        radialTargetSurfaceDragActive = false;
        return;
    }
    if (payload.kind === 'radial_item_pointer_move' || payload.kind === 'radial_surface_pointer_move') {
        if ((Number(payload.buttons) & 1) === 1) {
            radialTargetSurfaceDragActive = applyRadialTargetSurfaceDragPayload(payload, receipt) || radialTargetSurfaceDragActive;
        }
        return;
    }
    if (payload.kind === 'radial_item_pointer_enter' || payload.kind === 'radial_item_pointer_leave') {
        if ((Number(payload.buttons) & 1) === 1) {
            applyRadialTargetSurfaceDragPayload(payload, receipt);
        }
        return;
    }
    if (payload.kind === 'radial_item_pointer_up') {
        if (radialTargetSurfaceDragActive && receipt.worldPoint) {
            radialTargetSurfaceDragActive = false;
            handleLeftMouseUp(receipt.worldPoint.x, receipt.worldPoint.y);
        }
        return;
    }
    if (payload.kind === 'radial_cancel') {
        radialGestureMenu.cancel('radial-surface-cancel');
        exitAnnotationReticle('radial-surface-cancel');
        clearGestureState();
        fastTravel.clearGesture('radial-surface-cancel');
        setInteractionState('IDLE', 'radial-surface-cancel');
        return;
    }
    if (payload.kind !== 'radial_item_click') return;
    if (liveJs.currentState !== 'RADIAL' || !liveJs.radialGestureMenu) {
        if (payload.itemId === SIGIL_ANNOTATION_CAMERA_ITEM_ID || payload.itemAction === 'annotationSnapshot') {
            const recoveryItem = {
                id: payload.itemId || SIGIL_ANNOTATION_CAMERA_ITEM_ID,
                action: payload.itemAction || 'annotationSnapshot',
            };
            const commandResult = executeRadialItemCommand(recoveryItem, null, {
                input: {
                    kind: 'click',
                    source: 'sigil.radial-target-surface',
                    item_id: payload.itemId,
                    canvas_id: radialTargetSurface.id,
                },
                source: 'sigil.radial-target-surface',
                pointer: receipt.worldPoint || liveJs.pointerPos,
                reason: 'radial-camera-target-surface-recovery',
            });
            interactionTrace.record('radial-surface:recovered', {
                reason: 'camera-click-after-radial-cleanup',
                requested: commandResult.handler_result?.requested || null,
                command_id: commandResult.command_id,
                executed: commandResult.executed,
                ...receipt,
            });
            clearGestureState();
            fastTravel.clearGesture('radial-surface-camera-recovery');
            setInteractionState('IDLE', 'radial-surface-camera-recovery');
            return;
        }
        interactionTrace.record('radial-surface:ignored', {
            reason: 'state-not-radial',
            itemId: payload.itemId,
            ...receipt,
        });
        return;
    }
    const item = liveJs.radialGestureMenu.items?.find((candidate) => candidate.id === payload.itemId);
    if (!item?.center) {
        interactionTrace.record('radial-surface:ignored', {
            reason: 'missing-item',
            itemId: payload.itemId,
            ...receipt,
        });
        return;
    }
    const result = radialGestureMenu.release({ ...item.center, valid: true }, {
        input: {
            kind: 'click',
            source: 'sigil.radial-target-surface',
            pointer: { x: item.center.x, y: item.center.y },
            item_id: payload.itemId,
            canvas_id: radialTargetSurface.id,
        },
        source: 'sigil.radial-target-surface',
    });
    const annotationDisposition = annotationReticleReleaseDisposition(result);
    if (annotationDisposition.exit) exitAnnotationReticle(annotationDisposition.reason);
    clearGestureState();
    fastTravel.clearGesture(result?.committed?.type === 'item' ? 'radial-surface-item' : 'radial-surface-release');
    setInteractionState('IDLE', result?.committed?.type === 'item' ? 'radial-surface-item' : 'radial-surface-release');
}

function originFromMessage(msg = {}) {
    const x = Number(msg.origin_x ?? msg.originX);
    const y = Number(msg.origin_y ?? msg.originY);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
    return nativeToDesktopWorldPoint({ x, y }, liveJs.displays) ?? { x, y, valid: true };
}

function desktopWorldPointFromInputMessage(msg = {}) {
    const authority = msg.coordinateAuthority ?? msg.coordinate_authority ?? null;
    const desktopWorld = msg.desktop_world ?? msg.desktopWorld ?? null;
    if (desktopWorld && authority === 'daemon') {
        const x = Number(desktopWorld.x);
        const y = Number(desktopWorld.y);
        if (Number.isFinite(x) && Number.isFinite(y)) return { x, y };
    }
    if (msg.envelope_type === 'input_region.event' || msg.envelopeType === 'input_region.event') {
        const x = Number(msg.x);
        const y = Number(msg.y);
        if (Number.isFinite(x) && Number.isFinite(y)) return { x, y };
    }
    return nativeToDesktopWorldPoint({ x: msg.x, y: msg.y }, liveJs.displays) ?? { x: msg.x, y: msg.y };
}

function publishSessionVitalitySnapshot() {
    const snapshot = sessionVitality.snapshot();
    liveJs.sessionVitality = snapshot;
    state.sessionVitality = snapshot.factors;
    scheduleRenderFrame();
    return snapshot;
}

function handleSessionTelemetryEnvelope(envelope = {}) {
    let changed = false;
    const telemetry = envelope.type === 'agent.session.telemetry'
        ? envelope
        : envelope.telemetry;
    if (telemetry?.type === 'agent.session.telemetry') {
        sessionVitality.applyTelemetry(telemetry);
        changed = true;
    }

    const lifecycle = envelope.type === 'agent.session.lifecycle'
        ? [envelope]
        : (Array.isArray(envelope.lifecycle_events) ? envelope.lifecycle_events : []);
    for (const event of lifecycle) {
        if (event?.type !== 'agent.session.lifecycle') continue;
        sessionVitality.applyLifecycle(event);
        if (['context_compaction_started', 'context_compacted', 'handoff_started', 'handoff_completed'].includes(event.event)) {
            state.auraSpike = Math.max(state.auraSpike || 0, 1);
        }
        changed = true;
    }

    if (changed) {
        publishSessionVitalitySnapshot();
    }
    return changed;
}

function handleHostMessage(rawMsg) {
    const msg = normalizeMessage(rawMsg);
    if (
        msg?.type === 'input_event'
        || msg?.envelope_type === 'input_event'
        || msg?.type === 'right_mouse_down'
        || msg?.type === 'right_mouse_up'
        || msg?.type === 'left_mouse_down'
        || msg?.type === 'left_mouse_up'
        || msg?.type === 'scroll_wheel'
        || msg?.type === 'canvas_message'
    ) {
        interactionTrace.record('host-message', {
            rawType: rawMsg?.type,
            type: msg?.type,
            envelopeType: msg?.envelope_type ?? null,
            canvasId: msg?.id ?? rawMsg?.id ?? null,
            kind: msg?.kind ?? rawMsg?.kind ?? rawMsg?.payload?.kind ?? null,
            x: msg?.x,
            y: msg?.y,
            dx: msg?.dx,
            dy: msg?.dy,
            source: msg?.source ?? rawMsg?.source ?? rawMsg?.payload?.source ?? null,
            primarySegment: isPrimarySurfaceSegment(),
        });
    }
    if (!shouldProcessGlobalDaemonEvent(msg)) return;

    if (msg.type === 'agent.session.telemetry' || msg.type === 'agent.session.lifecycle') {
        handleSessionTelemetryEnvelope(msg);
        return;
    }

    if (msg.type === 'canvas_lifecycle') {
        annotationReticleHandleCanvasLifecycle(msg);
        const canvasId = msg.canvas_id || msg.canvas?.id;
        if (UTILITY_CANVAS_IDS.has(canvasId)) {
            if (msg.action === 'removed') {
                liveJs.utilityCanvases.delete(canvasId);
            } else {
                liveJs.utilityCanvases.set(canvasId, {
                    ...(msg.canvas || {}),
                    id: canvasId,
                    suspended: msg.suspended ?? msg.canvas?.suspended ?? false,
                    at: msg.at ?? msg.canvas?.at ?? null,
                });
            }
            if (isAgentTerminalCanvasId(canvasId)) {
                const suspended = msg.suspended ?? msg.canvas?.suspended;
                if (msg.action === 'removed') {
                    clearAvatarParking({ restoreVisible: true });
                    liveJs.pendingAgentTerminalCollapse = null;
                    liveJs.pendingAgentTerminalStatusPoint = null;
                    liveJs.prewarmingAgentTerminal = false;
                } else if (liveJs.prewarmingAgentTerminal) {
                    if (suspended === true) {
                        liveJs.utilityCanvases.set(canvasId, {
                            ...(agentTerminalState() || {}),
                            id: canvasId,
                            suspended: true,
                            at: agentTerminalFrame(),
                        });
                    }
                } else if (suspended === true) {
                    if (liveJs.pendingAgentTerminalCollapse === 'status' || isAgentTerminalParkedAtStatus()) {
                        const statusPoint = liveJs.pendingAgentTerminalStatusPoint || liveJs.avatarParking?.nativePoint;
                        parkAvatarAtStatus({ origin_x: statusPoint?.x, origin_y: statusPoint?.y });
                    } else if (liveJs.avatarParking?.mode === 'terminal') {
                        clearAvatarParking({ restoreVisible: true });
                    }
                } else {
                    if (liveJs.pendingAgentTerminalCollapse === 'status') {
                        const statusPoint = liveJs.pendingAgentTerminalStatusPoint || liveJs.avatarParking?.nativePoint;
                        parkAvatarAtStatus({ origin_x: statusPoint?.x, origin_y: statusPoint?.y });
                    } else {
                        liveJs.pendingAgentTerminalCollapse = null;
                        liveJs.pendingAgentTerminalStatusPoint = null;
                        const frame = msg.at ?? msg.canvas?.at;
                        parkAvatarInTerminal(frame);
                    }
                }
            }
        }
        return;
    }

    if (msg.type === 'live_appearance') {
        if (msg.appearance) applyAppearance(msg.appearance);
        markAppearanceChanged();
        return;
    }

    if (msg.type === 'canvas_object.transform.patch') {
        handleCanvasObjectTransformPatch(msg);
        return;
    }

    if (msg.type === 'status_item.toggle') {
        if (isAgentTerminalVisible()) {
            void collapseAgentTerminalToStatus(msg).catch((error) => {
                console.warn('[sigil] agent terminal collapse failed:', error);
            });
            return;
        }
        if (isAgentTerminalParkedAtStatus() && agentTerminalState()?.suspended === true) {
            void restoreAgentTerminalFromStatus().catch((error) => {
                console.warn('[sigil] agent terminal restore failed:', error);
            });
            return;
        }
        const origin = originFromMessage(msg);
        if (msg.target_state === 'visible') animateVisibility(true, 'enter', origin);
        else if (msg.target_state === 'hidden') animateVisibility(false, 'exit', origin);
        else toggleAvatarVisibility(origin);
        return;
    }

    if (msg.type === 'status_item.show') {
        animateVisibility(true, null, originFromMessage(msg));
        return;
    }

    if (msg.type === 'status_item.hide') {
        animateVisibility(false, null, originFromMessage(msg));
        return;
    }

    if (msg.type === 'sigil.set_position') {
        setAvatarPosition(Number(msg.x), Number(msg.y));
        return;
    }

    if (msg.type === 'sigil.set_effects') {
        if (typeof msg.paused === 'boolean') {
            const changed = state.isPaused !== msg.paused;
            state.isPaused = msg.paused;
            if (changed && !rendererSuspended) scheduleRenderFrame();
        }
        return;
    }

    if (msg.type === 'sigil.set_geometry') {
        if (Number.isFinite(Number(msg.geometry))) {
            updateGeometry(Number(msg.geometry));
            markAppearanceChanged();
        }
        return;
    }

    if (msg.type === 'lifecycle') {
        const origin = originFromMessage(msg);
        if (msg.action === 'enter') {
            animateVisibility(true, 'enter', origin);
        } else if (msg.action === 'exit') {
            animateVisibility(false, 'exit', origin);
        } else if (msg.action === 'suspend') {
            if (liveJs.selectionMode?.active) exitSelectionMode('cleanup');
            rendererSuspended = true;
            removeSigilInputRegions();
            renderLoop.suspend();
        } else if (msg.action === 'resume') {
            rendererSuspended = false;
            renderLoop.resume();
            liveJs._pendingLifecycleComplete = 'resume';
            syncSigilInputRegions();
            scheduleRenderFrame();
        }
        return;
    }

    if (msg.type === 'display_geometry') {
        liveJs.displays = normalizeDisplays(msg.displays || []);
        liveJs.globalBounds = boundsWithMinMax(msg.desktop_world_bounds)
            ?? computeDesktopWorldBounds(liveJs.displays);
        liveJs.visibleBounds = boundsWithMinMax(msg.visible_desktop_world_bounds)
            ?? computeVisibleDesktopWorldBounds(liveJs.displays);
        annotationReticleRefreshCanvasCandidates();
        syncSigilInputRegions();
        if (typeof liveJs._resolveFirstDisplayGeometry === 'function') {
            const resolve = liveJs._resolveFirstDisplayGeometry;
            liveJs._resolveFirstDisplayGeometry = null;
            recordBoot('boot:firstDisplayGeometry', { displays: liveJs.displays.length, boot_elapsed_ms: bootElapsedMs() });
            resolve(liveJs.displays);
        }
        return;
    }

    if (msg.type === 'bootstrap') {
        const payload = msg.payload || msg;
        if (Array.isArray(payload.canvases)) {
            for (const canvas of payload.canvases) {
                annotationReticleHandleCanvasLifecycle({ action: 'snapshot', canvas, canvas_id: canvas.id, at: canvas.at });
            }
        }
        if (payload.semantic_targets || payload.targets) annotationReticleHandleSemanticTargets(payload);
        if (payload.window) annotationReticleHandleNativeWindow({ ...payload.window, ts: payload.ts || Date.now(), ref: payload.ref || '' });
        if (payload.element) annotationReticleHandleNativeAxElement({ ...payload.element, ts: payload.ts || Date.now(), ref: payload.ref || '' });
        return;
    }

    if (msg.type === 'canvas_inspector.semantic_targets') {
        annotationReticleHandleSemanticTargets(msg.payload || msg);
        return;
    }

    if (msg.type === 'window_entered' || msg.event === 'window_entered') {
        const payload = msg.payload || msg.data || msg;
        annotationReticleHandleNativeWindow({ ...payload, ts: msg.ts || payload.ts || Date.now(), ref: msg.ref || payload.ref || '' });
        return;
    }

    if (msg.type === 'element_focused' || msg.event === 'element_focused') {
        const payload = msg.payload || msg.data || msg;
        annotationReticleHandleNativeAxElement({ ...payload, ts: msg.ts || payload.ts || Date.now(), ref: msg.ref || payload.ref || '' });
        return;
    }

    if (msg.type === 'canvas_message' && isAgentTerminalCanvasId(msg.id)) {
        if (msg.payload?.type === 'agent_terminal.avatar_toggle'
            || msg.payload?.type === 'codex_terminal.avatar_toggle') {
            void toggleUtilityCanvas('agent-terminal');
            return;
        }
        if (msg.payload?.type === 'agent_terminal.session_telemetry') {
            handleSessionTelemetryEnvelope(msg.payload.payload || {});
        }
        return;
    }

    if (msg.type === 'canvas_message' && msg.id === hitTarget.hit.id) {
        handleHitCanvasEvent(msg.payload || {});
        return;
    }

    if (msg.type === 'canvas_message' && msg.id === radialTargetSurface.id) {
        handleRadialTargetSurfaceEvent(msg.payload || {});
        return;
    }

    if (INPUT_POINTER_EVENT_TYPES.has(msg.type) && typeof msg.x === 'number' && typeof msg.y === 'number') {
        const worldPoint = desktopWorldPointFromInputMessage(msg);
        handleInputEvent({ ...msg, x: worldPoint.x, y: worldPoint.y });
        return;
    }

    handleInputEvent(msg);
}

function awaitFirstDisplayGeometry() {
    if (liveJs.displays.length > 0) return Promise.resolve(liveJs.displays);
    recordBoot('boot:awaitFirstDisplayGeometry');
    return new Promise((resolve) => {
        liveJs._resolveFirstDisplayGeometry = resolve;
    });
}

async function getLastPositionFromDaemon(agentId) {
    try {
        return await host.positionGet(agentId, { timeoutMs: 250 });
    } catch (error) {
        console.warn('[sigil] lastPosition lookup failed; falling back to birthplace:', error);
        return null;
    }
}

let primarySurfaceServicesStarted = false;

function startPrimarySurfaceServices() {
    if (primarySurfaceServicesStarted) return;
    primarySurfaceServicesStarted = true;
    host.subscribe([
        'display_geometry',
        'input_event',
        'canvas_message',
        'canvas_lifecycle',
        'window_entered',
        'element_focused',
        'canvas_inspector.semantic_targets',
    ], { snapshot: true });
    startMarkHeartbeat();
    emitRadialMenuObjectRegistry();
    void hitTarget.ensureCreated()
        .then(() => {
            syncHitTargetToAvatar();
            scheduleRenderFrame();
        })
        .catch((error) => {
            console.error('[sigil] avatar hit target create failed:', error);
        });
    void radialTargetSurface.ensureCreated()
        .then(() => {
            syncRadialTargetSurface();
            scheduleRenderFrame();
        })
        .catch((error) => {
            console.error('[sigil] radial menu target surface create failed:', error);
        });
}

async function setupHostSurface() {
    host.install();
    host.onMessage(handleHostMessage);
    overlay.mount();
    visibilityTransition.mount();
    fastTravel.mount();

    if (!desktopWorldSurface) {
        startPrimarySurfaceServices();
        return;
    }

    await desktopWorldSurface.start({
        onInit({ topology }) {
            syncTopologyDisplays(topology);
            desktopWorldSurface.runOnPrimary(() => startPrimarySurfaceServices());
        },
        onTopologyChange({ topology }) {
            syncTopologyDisplays(topology);
            onWindowResize();
            desktopWorldSurface.refreshCamera(state.camera);
        },
        becamePrimary() {
            startPrimarySurfaceServices();
        },
        onState(snapshot) {
            applySurfaceRenderSnapshot(snapshot);
            if (!rendererSuspended) scheduleRenderFrame();
        },
    });
    desktopWorldSurface.mountScene({
        scene: state.scene,
        camera: state.camera,
        renderer: state.renderer,
    });
}

async function init() {
    runBootStep('initScene', () => initScene());
    runBootStep('createRadialGestureVisuals', () => {
        radialGestureVisuals = createSigilRadialGestureVisuals({
            scene: state.scene,
            projectPoint: (point) => point?.valid === false ? null : projectAvatarToScene(point.x, point.y),
            projectRadius(point, radius) {
                if (!point || point.valid === false) return null;
                const center = projectAvatarToScene(point.x, point.y);
                const edge = projectAvatarToScene(point.x + radius, point.y);
                return center.distanceTo(edge);
            },
        });
    });
    runBootStep('createSelectionModeCursorModelRenderer', () => {
        selectionModeCursorModelRenderer = createSelectionModeCursorModelRenderer({
            scene: state.scene,
            projectPoint: (point) => point?.valid === false ? null : projectStageLocalToScene(point.x, point.y),
            projectRadius(point, radius) {
                if (!point || point.valid === false) return null;
                const center = projectStageLocalToScene(point.x, point.y);
                const edge = projectStageLocalToScene(point.x + radius, point.y);
                return center.distanceTo(edge);
            },
        });
    });
    runBootStep('createAuraObjects', () => createAuraObjects());
    runBootStep('createParticleObjects', () => createParticleObjects());
    runBootStep('createPhenomena', () => createPhenomena());
    runBootStep('createLightning', () => createLightning());
    runBootStep('createMagneticField', () => createMagneticField());
    runBootStep('createOmega', () => createOmega());
    runBootStep('updateGeometry', () => updateGeometry(state.currentGeometryType ?? state.currentType));
    runBootStep('updateAllColors', () => updateAllColors());
    state.polyGroup.scale.set(state.z_depth, state.z_depth, state.z_depth);
    await runBootStep('setupHostSurface', () => setupHostSurface());
    if (!rendererSuspended) scheduleRenderFrame();
}

function clearHiddenFrame(renderAvatarPos, frameStartedAt) {
    state.appScale = 0;
    state.polyGroup.scale.setScalar(0);
    if (state.omegaGroup) state.omegaGroup.visible = false;
    if (isPrimarySurfaceSegment()) {
        if (liveJs.selectionMode?.active) exitSelectionMode('cleanup');
        hitTarget.sync({ x: -10000, y: -10000, valid: true }, false);
        removeSigilInputRegions();
    }
    overlay.draw({ state: 'IDLE', avatarPos: null, dragOrigin: null });
    refreshSelectionModeCursorModelSnapshot(null);
    radialActivationTransition.clear();
    radialGestureVisuals?.reset?.();
    visibilityTransition.draw({ avatarStagePos: null });
    fastTravel.draw();
    const renderStartedAt = performance.now();
    state.renderer.clear(true, true, true);
    postRenderPerformanceSample({
        frameStartedAt,
        renderStartedAt,
        renderEndedAt: performance.now(),
    });

    if (window.__sigilBootFirstFrameAt === null) {
        window.__sigilBootFirstFrameAt = Date.now();
        recordBoot('boot:firstFrame', { boot_elapsed_ms: bootElapsedMs() });
    }
    if (desktopWorldSurface?.isPrimary) {
        desktopWorldSurface.publishState(surfaceRenderSnapshot(renderAvatarPos));
    }
    if (isPrimarySurfaceSegment() && liveJs._pendingLifecycleComplete) {
        host.post('lifecycle.complete', { action: liveJs._pendingLifecycleComplete });
        liveJs._pendingLifecycleComplete = null;
    }
    updateRenderLoopDebug('idle', []);
}

function animate() {
    if (rendererSuspended) return;

    const frameStartedAt = performance.now();
    const dt = 0.016;
    const primarySegment = isPrimarySurfaceSegment();
    if (
        primarySegment
        || !Number.isFinite(liveJs.surfaceRenderSnapshot?.globalTime)
        || performance.now() - Number(liveJs.surfaceRenderSnapshotReceivedAt || 0) > 250
    ) {
        state.globalTime += dt;
    } else {
        state.globalTime = liveJs.surfaceRenderSnapshot.globalTime;
    }

    let renderAvatarPos = liveJs.surfaceRenderSnapshot?.renderAvatarPos?.valid
        ? liveJs.surfaceRenderSnapshot.renderAvatarPos
        : liveJs.avatarPos;

    const fastTravelState = liveJs.travel
        ? (
            primarySegment
                ? fastTravel.tick(dt, () => {
                    postLastPositionToDaemon();
                    syncHitTargetToAvatar();
                })
                : fastTravel.preview()
        )
        : null;

    if (primarySegment) {
        renderAvatarPos = liveJs.avatarPos;
        const transitionState = visibilityTransition.active
            ? visibilityTransition.tick(dt, { avatarPos: liveJs.avatarPos.valid ? { ...liveJs.avatarPos } : null })
            : null;
        if (transitionState?.appScale != null) {
            state.appScale = transitionState.appScale;
        }
        if (transitionState?.avatarPos?.valid) {
            renderAvatarPos = transitionState.avatarPos;
        }
        if (transitionState && !transitionState.active) {
            state.appScale = transitionState.appScale;
            setAvatarVisibility(transitionState.targetVisible);
            if (transitionState.lifecycleAction) {
                host.post('lifecycle.complete', { action: transitionState.lifecycleAction });
            }
        }
    }
    if (fastTravelState?.appScale != null) {
        state.appScale = fastTravelState.appScale;
    }
    if (fastTravelState?.avatarPos?.valid) {
        renderAvatarPos = fastTravelState.avatarPos;
    }
    const vitalityFrame = sessionVitality.tick(dt, performance.now());
    state.sessionVitality = vitalityFrame;
    liveJs.sessionVitality = sessionVitality.snapshot();

    const visualActive = liveJs.avatarVisible
        || !!visibilityTransition.active
        || !!liveJs.travel
        || !!annotationReticle.active
        || !!liveJs.annotationReticleOverlay?.visible
        || liveJs.selectionMode?.active === true
        || !!liveJs.selectionModeOverlay?.visible
        || radialActivationTransition.active()
        || state.appScale > 0.001;
    if (!visualActive) {
        clearHiddenFrame(renderAvatarPos, frameStartedAt);
        return;
    }
    const selectionModeOverlayCleanupFrame = selectionModeRuntime.reconcileOverlayLifecycle();

    if (renderAvatarPos.valid) {
        const avatarStagePos = stagePoint(renderAvatarPos);
        const projected = projectAvatarToScene(renderAvatarPos.x, renderAvatarPos.y);
        state.polyGroup.position.copy(projected);
        state.pointLight.position.copy(state.polyGroup.position);
        state.pointLight.intensity = 2 * (Number.isFinite(vitalityFrame.brightnessMultiplier) ? vitalityFrame.brightnessMultiplier : 1);
        window.__sigilRenderDebug = {
            desktopWorld: {
                x: Math.round(renderAvatarPos.x),
                y: Math.round(renderAvatarPos.y),
            },
            stage_local: avatarStagePos ? {
                x: Math.round(avatarStagePos.x),
                y: Math.round(avatarStagePos.y),
            } : null,
            globalBounds: liveJs.globalBounds,
        };
    }

    if (!state.isPaused) {
        const rotationMultiplier = Number.isFinite(vitalityFrame.rotationMultiplier)
            ? vitalityFrame.rotationMultiplier
            : 1;
        const idleRotation = resolveSigilAvatarIdleRotation(state);
        state.polyGroup.rotation.y += idleRotation.visible_avatar_y_speed * rotationMultiplier;
        state.polyGroup.rotation.x += idleRotation.visible_avatar_x_speed * rotationMultiplier;
    }

    const hoverTarget = liveJs.avatarHover && liveJs.avatarVisible && liveJs.currentState === 'IDLE' ? 1 : 0;
    liveJs.avatarHoverProgress += (hoverTarget - liveJs.avatarHoverProgress) * Math.min(1, dt * 14);

    animateParticles(dt);
    animatePhenomena(dt);
    animateAura(dt);
    animateLightning(dt);
    animateMagneticField(dt);
    animateOmega(dt);
    animateSkins(dt);
    animateTrails(dt);
    updateInnerEdgePulse(false);
    updateInnerEdgePulse(true);

    const avatarStagePos = stagePoint(renderAvatarPos);
    const dragOriginStage = stagePoint(liveJs.mousedownAvatarPos);
    const activeRadialActivationTransition = radialActivationTransition.tick(state.globalTime);
    const continuationReasons = currentRenderLoopContinuationReasons(vitalityFrame);
    const work = classifyRenderLoopWork({
        continuationReasons,
        structuralDirty: structuralFrameDirty || selectionModeOverlayCleanupFrame,
    });
    structuralFrameDirty = false;
    liveJs.renderLoop.work = {
        visualOnly: work.visualOnly,
        structural: work.structural,
        overlay: work.overlay,
        publishState: work.publishState,
        idleMotionDelayMs: work.visualOnly ? IDLE_AVATAR_MOTION_FRAME_DELAY_MS : 0,
    };

    if (work.structural) {
        contextMenu.updateSegmentPosition();

        if (primarySegment && contextMenu.isOpen()) {
            hitTarget.syncWorldRect(contextMenu.interactiveBounds(), true, { displays: liveJs.displays });
        } else if (primarySegment && liveJs.avatarParking) {
            hitTarget.sync({ x: -10000, y: -10000, valid: true }, false);
        } else if (primarySegment && liveJs.avatarPos.valid) {
            syncHitTargetToAvatar();
        }
        if (primarySegment) {
            syncRadialTargetSurface();
            syncSigilInputRegions();
        }
    }
    if (work.overlay) {
        overlay.draw({
            state: liveJs.currentState,
            avatarPos: avatarStagePos,
            dragOrigin: dragOriginStage,
            avatarHover: liveJs.avatarHover,
            avatarHoverProgress: liveJs.avatarHoverProgress,
            radialGesture: projectRadialGestureSnapshot(liveJs.radialGestureMenu),
            annotationReticle: liveJs.annotationReticle,
            annotationReticleOverlay: liveJs.annotationReticleOverlay || buildProjectedAnnotationReticleOverlay(liveJs.annotationReticle),
            selectionMode: liveJs.selectionMode,
            selectionModeOverlay: liveJs.selectionModeOverlay || buildProjectedSelectionModeOverlay(liveJs.selectionMode),
            fastTravelEffect: state.transitionFastTravelEffect,
            time: state.globalTime,
            wallTimeMs: Date.now(),
            gotoRingRadius: liveJs.gotoRingRadius,
            avatarHitRadius: liveJs.avatarHitRadius,
            menuRingRadius: liveJs.menuRingRadius,
            dragCancelRadius: liveJs.dragCancelRadius,
        });
    }
    if (
        liveJs.selectionModeOverlay?.visible === true
        || liveJs.selectionModeOverlay?.active === true
        || liveJs.selectionModeCursorModel?.visible === true
    ) {
        refreshSelectionModeCursorModelSnapshot(liveJs.selectionModeOverlay || null);
    } else {
        readSelectionModeCursorModelSnapshot();
    }
    if (work.structural || activeRadialActivationTransition) {
        radialGestureVisuals?.update(liveJs.radialGestureMenu, {
            time: state.globalTime,
            activationTransition: activeRadialActivationTransition,
        });
    }
    if (activeRadialActivationTransition?.completed) {
        radialActivationTransition.clear();
        radialGestureVisuals?.reset?.();
    }
    visibilityTransition.draw({ avatarStagePos });
    fastTravel.draw();

    if (window.__sigilBootFirstFrameAt === null) {
        window.__sigilBootFirstFrameAt = Date.now();
        recordBoot('boot:firstFrame', { boot_elapsed_ms: bootElapsedMs() });
    }
    const vitalityScale = Number.isFinite(vitalityFrame.scaleMultiplier) ? vitalityFrame.scaleMultiplier : 1;
    state.polyGroup.scale.setScalar(state.baseScale * state.z_depth * state.appScale * vitalityScale * (1 + liveJs.avatarHoverProgress * 0.055));
    if (desktopWorldSurface?.isPrimary && work.publishState) {
        desktopWorldSurface.publishState(surfaceRenderSnapshot(renderAvatarPos));
    }
    const renderStartedAt = performance.now();
    state.renderer.render(state.scene, state.camera);
    postRenderPerformanceSample({
        frameStartedAt,
        renderStartedAt,
        renderEndedAt: performance.now(),
    });

    if (primarySegment && liveJs._pendingLifecycleComplete) {
        host.post('lifecycle.complete', { action: liveJs._pendingLifecycleComplete });
        liveJs._pendingLifecycleComplete = null;
    }

    updateRenderLoopDebug(continuationReasons.length ? 'continuous' : 'idle', continuationReasons);
    if (continuationReasons.length > 0) {
        renderLoop.schedule(animate, {
            mode: 'continuous',
            structural: false,
            delayMs: work.visualOnly ? IDLE_AVATAR_MOTION_FRAME_DELAY_MS : 0,
        });
    }
}

window.__sigilDebug = {
    dispatch(msg) {
        handleHostMessage(msg);
        return liveJs.currentState;
    },
    dispatchDesktop(msg) {
        handleInputEvent(msg);
        return liveJs.currentState;
    },
    snapshot() {
        return {
            runtime: {
                ...SIGIL_RENDERER_RUNTIME,
                contentRoots: {
                    sigil: SIGIL_CONTENT_ROOT,
                    toolkit: TOOLKIT_CONTENT_ROOT,
                },
                utilityUrls: {
                    wikiWorkbench: WIKI_WORKBENCH_DEFAULT_URL,
                    agentTerminal: AGENT_TERMINAL_URL,
                },
                bootFirstFrameAt: window.__sigilBootFirstFrameAt,
                bootTraceFirstAt: window.__sigilBootTrace?.[0]?.ts ?? null,
            },
            state: liveJs.currentState,
            avatarPos: liveJs.avatarPos,
            travel: liveJs.travel,
            fastTravel: fastTravel.exportSnapshot(),
            radialGestureMenu: liveJs.radialGestureMenu,
            radialGestureVisuals: radialGestureVisuals?.snapshot?.() ?? null,
            radialActivationTransition: radialActivationTransition.snapshot(),
            annotationReticle: liveJs.annotationReticle,
            selectionMode: liveJs.selectionMode,
            selectionModeOverlay: liveJs.selectionModeOverlay,
            selectionModeCursorModel: readSelectionModeCursorModelSnapshot(),
            uxCommandRuntime: liveJs.uxCommandRuntime,
            activeContext: liveJs.activeContext,
            contextRecording: liveJs.contextRecording,
            annotationReticleOverlay: liveJs.annotationReticleOverlay,
            annotationReticleBrowserDomBridge: liveJs.annotationReticleBrowserDomBridge,
            annotationReticleEvents: liveJs.annotationReticleEvents,
            avatarHover: liveJs.avatarHover,
            avatarHoverProgress: liveJs.avatarHoverProgress,
            contextMenu: contextMenu?.snapshot?.(),
            fastTravelEffect: state.transitionFastTravelEffect,
            fastTravelEvents: liveJs.fastTravelEvents,
            interactionTrace: {
                count: interactionTrace.snapshot().count,
                enabled: interactionTrace.snapshot().enabled,
            },
            avatarVisible: liveJs.avatarVisible,
            renderLoop: liveJs.renderLoop,
            sessionVitality: liveJs.sessionVitality,
            hitTargetId: hitTarget.hit.id,
            hitTargetReady: hitTarget.hit.ready,
            hitTargetFrame: hitTarget.hit.frame,
            hitTargetInteractive: hitTarget.hit.interactive,
            inputRegions: sigilInputRegions?.snapshot?.() ?? null,
            radialTargetSurface: radialTargetSurface.snapshot(),
            uxTree: sigilUxTreeSnapshot(),
            uxTreeReadiness: sigilUxTreeReadiness(),
            transition: visibilityTransition.active?.effect ?? null,
            surface: desktopWorldSurface ? {
                segment: desktopWorldSurface.segment,
                isPrimary: desktopWorldSurface.isPrimary,
                latency: desktopWorldSurface.stateLatencySnapshot(),
            } : null,
        };
    },
    refreshSelectionModeCursorModel() {
        return refreshSelectionModeCursorModelSnapshot(liveJs.selectionModeOverlay || null);
    },
    avatarDefinition,
    importAvatarDefinitionText,
    utilityConfig(kind) {
        return utilityConfig(kind);
    },
    uxTree() {
        return sigilUxTreeSnapshot();
    },
    uxTreeShadow(input) {
        return sigilUxTreeShadowResolver().resolve(input || {});
    },
    uxTreeReadiness() {
        return sigilUxTreeReadiness();
    },
    uxTreeCommand(input, registry = {}) {
        return executeSigilUxTreeCommand(sigilUxTreeSnapshot(), {
            input: input || {},
            registry,
            context: { source: 'debug-api' },
        });
    },
    openWikiWorkbench(path) {
        return openWikiWorkbench(path || WIKI_WORKBENCH_DEFAULT_PATH);
    },
    fastTravelPreview() {
        return fastTravel.preview();
    },
    interactionTrace() {
        return interactionTrace.snapshot({
            runtime: {
                ...SIGIL_RENDERER_RUNTIME,
                contentRoots: {
                    sigil: SIGIL_CONTENT_ROOT,
                    toolkit: TOOLKIT_CONTENT_ROOT,
                },
                bootFirstFrameAt: window.__sigilBootFirstFrameAt,
                bootTraceFirstAt: window.__sigilBootTrace?.[0]?.ts ?? null,
            },
            snapshot: this.snapshot(),
        });
    },
    clearInteractionTrace() {
        interactionTrace.clear();
        return interactionTrace.snapshot();
    },
    armInteractionTrace(label = 'manual') {
        return interactionTrace.arm(label);
    },
    stopInteractionTrace(reason = 'manual') {
        return interactionTrace.stop(reason);
    },
    latestInteractionTraceCapture() {
        return interactionTrace.latestCapture();
    },
    setInteractionTraceEnabled(value) {
        return interactionTrace.setEnabled(value);
    },
    createSelectionModeContext(input = {}) {
        return createSelectionModeContextFromDebugInput(input);
    },
    enterSelectionMode(pointer = liveJs.pointerPos) {
        return enterSelectionMode(pointer, 'debug-api');
    },
    cancelSelectionMode(reason = 'debug-api') {
        return exitSelectionMode(reason);
    },
    commitSelectionMode(reason = 'debug-api') {
        return commitSelectionMode(reason);
    },
    setSelectionModeNodeComment(nodeId = '', text = '', options = {}) {
        return setSelectionModeNodeComment(nodeId, text, options);
    },
    appendActiveContextKeyframe(options = {}) {
        return appendContextRecordingKeyframe(liveJs.activeContext?.context_keyframe, options);
    },
    appendContextRecordingEvent(event = {}) {
        return appendContextRecordingEvent(event);
    },
    exportContextRecording() {
        return contextRecordingRuntime.exportContextRecording();
    },
};

export async function boot() {
    recordBoot('boot:start');

    runBootStep('applyDefaultAppearance', () => applyAppearance(DEFAULT_APPEARANCE));
    const defaultAvatarPromise = runBootStep('loadDefaultAvatarDefinition', () => loadDefaultAvatarDefinition({ apply: false }));
    await runBootStep('init', () => init());

    const displaysStartedAt = performance.now();
    const displaysPromise = awaitFirstDisplayGeometry().then((displays) => {
        recordBootDuration('boot:awaitFirstDisplayGeometry', displaysStartedAt, { displays: displays.length });
        return displays;
    });
    const [displays, defaultAvatar] = await Promise.all([displaysPromise, defaultAvatarPromise]);
    runBootStep('applyDefaultAvatarDefinition', () => applyDefaultAvatarDefinition(defaultAvatar));
    emitRadialMenuObjectRegistry();

    recordBoot('boot:displayReady', { displays: displays.length });
    if (isPrimarySurfaceSegment()) void prewarmAgentTerminalCanvas();

    let position = await getLastPositionFromDaemon(liveJs.currentAgentId);
    if (position) {
        position = nativeToDesktopWorldPoint(position, displays) ?? position;
    }
    if (!position) {
        position = resolveBirthplace(liveJs.currentAgentDefinition?.instance?.birthplace ?? {
            anchor: 'nonant',
            nonant: 'bottom-right',
            display: 'main',
        }, displays);
    }
    liveJs.avatarPos = { x: position.x, y: position.y, valid: true };
    state.appScale = 0;
    setAvatarVisibility(false);

    recordBoot('boot:avatarPositionReady', {
        x: Math.round(liveJs.avatarPos.x),
        y: Math.round(liveJs.avatarPos.y),
        boot_elapsed_ms: bootElapsedMs(),
    });
    window.headsup.statusItemReady = true;
    emitStatusItemState();
}
