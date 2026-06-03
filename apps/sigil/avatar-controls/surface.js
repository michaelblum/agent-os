import { toolkitSpecifier } from '../renderer/live-modules/content-roots.js';

const TOOLKIT_RUNTIME_BASE = toolkitSpecifier('runtime', {
    local: '../../../packages/toolkit/runtime',
});

const { createDesktopWorldInteractionRouter } = await import(`${TOOLKIT_RUNTIME_BASE}/interaction-region.js`);
import {
    DEFAULT_FAST_TRAVEL_EFFECT,
    normalizeFastTravelEffect,
} from '../renderer/transition-registry.js';
import { isTesseronSupportedShape, normalizeTesseronConfig } from '../renderer/tesseron.js';
import {
    applyAvatarControlsDescriptorUpdate,
} from './descriptors.js';
import { buildAvatarControlsSnapshot } from './snapshot-projection.js';
import { createVisualObjectBindingAdapter } from './visual-object-binding.js';
import { buildSigilAvatarCompactSurfaceViewModel } from '../avatar-editor/surface-view-model.js';

let compactSurfaceModulePromise = null;

function loadCompactSurfaceModule() {
    compactSurfaceModulePromise ||= import('../avatar-editor/compact-surface.js');
    return compactSurfaceModulePromise;
}

const MENU_WIDTH = 292;
const MENU_HEIGHT = 448;
const MENU_OFFSET = 18;
const PANEL_WIDTH = 332;
const PANEL_HEIGHT = 540;
const REF_BASE = 300;
const REF_SCALE = 1.1;
const REF_HEIGHT = 1080;

function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
}

function computeBaseScale(base) {
    const viewportHeight = typeof window !== 'undefined' && Number.isFinite(window.innerHeight)
        ? Math.max(1, window.innerHeight)
        : REF_HEIGHT;
    return (base / REF_BASE) * REF_SCALE * (REF_HEIGHT / viewportHeight);
}

function rectContainsPoint(rect, point) {
    return rect
        && Number.isFinite(rect.left)
        && Number.isFinite(rect.top)
        && Number.isFinite(rect.right)
        && Number.isFinite(rect.bottom)
        && point.x >= rect.left
        && point.y >= rect.top
        && point.x < rect.right
        && point.y < rect.bottom;
}

function elementContains(parent, child) {
    if (!parent || !child) return false;
    if (typeof parent.contains === 'function') return parent.contains(child);
    for (let cursor = child; cursor; cursor = cursor.parentElement) {
        if (cursor === parent) return true;
    }
    return false;
}

function closestAny(element, selectors = []) {
    if (!element) return null;
    const combinedSelector = selectors.join(', ');
    const combined = element.closest?.(combinedSelector);
    if (combined) return combined;
    for (let cursor = element; cursor; cursor = cursor.parentElement) {
        if (selectors.some((selector) => cursor.matches?.(selector))) return cursor;
    }
    return null;
}

function elementHiddenInTree(element, boundary = null) {
    for (let cursor = element; cursor && cursor !== boundary; cursor = cursor.parentElement) {
        if (cursor.hidden) return true;
        if (cursor.getAttribute?.('aria-hidden') === 'true') return true;
        if (cursor.classList?.contains?.('hidden')) return true;
    }
    return false;
}

function displayVisibleBoundsForPoint(displays = [], point) {
    return displays.find((entry) => {
        const rect = entry.visibleBounds || entry.visible_bounds || entry.bounds;
        return rect
            && point.x >= rect.x
            && point.y >= rect.y
            && point.x < rect.x + rect.w
            && point.y < rect.y + rect.h;
    })?.visibleBounds
        || displays.find((entry) => {
            const rect = entry.visible_bounds || entry.bounds;
            return rect
                && point.x >= rect.x
                && point.y >= rect.y
                && point.x < rect.x + rect.w
                && point.y < rect.y + rect.h;
        })?.visible_bounds
        || displays.find((entry) => {
            const rect = entry.bounds;
            return rect
                && point.x >= rect.x
                && point.y >= rect.y
                && point.x < rect.x + rect.w
                && point.y < rect.y + rect.h;
        })?.bounds
        || null;
}

function rectsOverlap(a, b) {
    return !!(a && b
        && a.x < b.x + b.w
        && a.x + a.w > b.x
        && a.y < b.y + b.h
        && a.y + a.h > b.y);
}

function overlapArea(a, b) {
    if (!rectsOverlap(a, b)) return 0;
    const x = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x));
    const y = Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
    return x * y;
}

function rectCenter(rect) {
    if (!rect) return null;
    return {
        x: rect.x + rect.w / 2,
        y: rect.y + rect.h / 2,
    };
}

function clampCenterToViewport(center, size, viewport) {
    if (!center || !viewport) return center;
    const halfW = size.w / 2;
    const halfH = size.h / 2;
    return {
        x: clamp(center.x, viewport.x + halfW, viewport.x + Math.max(halfW, viewport.w - halfW)),
        y: clamp(center.y, viewport.y + halfH, viewport.y + Math.max(halfH, viewport.h - halfH)),
    };
}

export function resolveAvatarPanelAvoidancePosition({
    avatarRect,
    panelRect,
    viewport,
    margin = 12,
} = {}) {
    if (!avatarRect || !panelRect || !viewport) return null;
    if (!rectsOverlap(avatarRect, panelRect)) return null;
    const size = { w: avatarRect.w, h: avatarRect.h };
    const current = rectCenter(avatarRect);
    const candidates = [
        { side: 'left', x: panelRect.x - margin - size.w / 2, y: current.y },
        { side: 'right', x: panelRect.x + panelRect.w + margin + size.w / 2, y: current.y },
        { side: 'above', x: current.x, y: panelRect.y - margin - size.h / 2 },
        { side: 'below', x: current.x, y: panelRect.y + panelRect.h + margin + size.h / 2 },
    ].map((candidate, index) => {
        const center = clampCenterToViewport(candidate, size, viewport);
        const rect = {
            x: center.x - size.w / 2,
            y: center.y - size.h / 2,
            w: size.w,
            h: size.h,
        };
        const dx = center.x - current.x;
        const dy = center.y - current.y;
        return {
            ...center,
            side: candidate.side,
            index,
            rect,
            overlap: overlapArea(rect, panelRect),
            distanceSquared: dx * dx + dy * dy,
        };
    });
    const separated = candidates.filter((candidate) => candidate.overlap === 0);
    const best = (separated.length > 0 ? separated : candidates)
        .sort((a, b) => (
            (a.overlap - b.overlap)
            || (a.distanceSquared - b.distanceSquared)
            || (a.index - b.index)
        ))[0];
    return best ? {
        x: best.x,
        y: best.y,
        side: best.side,
        overlap: best.overlap,
    } : null;
}

export function resolveAvatarControlsOrigin(point, options = {}) {
    const width = options.width ?? MENU_WIDTH;
    const height = options.height ?? MENU_HEIGHT;
    const offset = options.offset ?? MENU_OFFSET;
    const displays = options.displays || [];
    const visible = options.visible
        || displayVisibleBoundsForPoint(displays, point)
        || options.visibleBounds
        || null;
    const fallback = { x: point.x + offset, y: point.y + offset };
    const avatar = options.avatar;
    if (!visible || !Number.isFinite(visible.w) || !Number.isFinite(visible.h)) return fallback;

    const clampRect = (origin) => ({
        x: clamp(origin.x, visible.x, Math.max(visible.x, visible.x + visible.w - width)),
        y: clamp(origin.y, visible.y, Math.max(visible.y, visible.y + visible.h - height)),
        w: width,
        h: height,
    });

    const avatarPoint = avatar?.point;
    const radius = Math.max(0, Number(avatar?.radius) || 0);
    if (avatarPoint && Number.isFinite(avatarPoint.x) && Number.isFinite(avatarPoint.y) && radius > 0) {
        const avoid = {
            x: avatarPoint.x - radius,
            y: avatarPoint.y - radius,
            w: radius * 2,
            h: radius * 2,
        };
        const candidates = [
            { side: 'right', x: avoid.x + avoid.w + offset, y: avatarPoint.y - height / 2 },
            { side: 'left', x: avoid.x - offset - width, y: avatarPoint.y - height / 2 },
            { side: 'below', x: avatarPoint.x - width / 2, y: avoid.y + avoid.h + offset },
            { side: 'above', x: avatarPoint.x - width / 2, y: avoid.y - offset - height },
            { side: 'click', x: fallback.x, y: fallback.y },
        ].map((candidate, index) => {
            const rect = clampRect(candidate);
            return {
                ...rect,
                side: candidate.side,
                index,
                overlap: overlapArea(rect, avoid),
            };
        });
        const separated = candidates.filter((candidate) => candidate.overlap === 0);
        const best = (separated.length > 0 ? separated : candidates)
            .sort((a, b) => (a.overlap - b.overlap) || (a.index - b.index))[0];
        return { x: best.x, y: best.y };
    }

    const rect = clampRect(fallback);
    return { x: rect.x, y: rect.y };
}

export function findAvatarControlsElementAt(anchor, point, doc = document) {
    if (!anchor || !point || !Number.isFinite(point.x) || !Number.isFinite(point.y)) return null;
    const viewportHit = doc?.elementFromPoint?.(point.x, point.y);
    if (viewportHit && elementContains(anchor, viewportHit)) return viewportHit;

    const selectors = [
        'button',
        'input',
        'select',
        'textarea',
        'label',
        '.sigil-avatar-control-surface',
        '.aos-form-field',
        '[data-aos-select-content]',
        '[data-aos-select-item]',
        '[data-aos-slider-root]',
        '[data-aos-slider-control]',
        '[data-aos-slider-track]',
        '[data-aos-slider-thumb]',
    ];
    const combinedSelector = selectors.join(', ');
    const combinedCandidates = Array.from(anchor.querySelectorAll(combinedSelector) || []);
    const candidates = combinedCandidates.length
        ? combinedCandidates
        : Array.from(new Set(selectors.flatMap((selector) => (
            Array.from(anchor.querySelectorAll(selector) || [])
        ))));
    for (let i = candidates.length - 1; i >= 0; i -= 1) {
        const element = candidates[i];
        if (elementHiddenInTree(element, anchor)) continue;
        const rect = element.getBoundingClientRect?.();
        if (rectContainsPoint(rect, point)) return element;
    }
    return null;
}

export function avatarControlsMarkup() {
    return '<div id="sigil-avatar-controls" class="avatar-controls-anchor sigil-avatar-controls" role="dialog" aria-modal="false" aria-label="Sigil avatar control surface" aria-hidden="true"></div>';
}

export function avatarControlsContentProps(open) {
    const isOpen = !!open;
    return {
        'aria-label': 'Sigil avatar control surface',
        'aria-hidden': isOpen ? 'false' : 'true',
        'data-state': isOpen ? 'open' : 'closed',
        class: `avatar-controls-anchor sigil-avatar-controls${isOpen ? ' visible' : ''}`,
    };
}

export function avatarControlsSurfaceScrollDelta(event = {}) {
    const sourceOrigin = event.sourceIdentity?.sourceOrigin
        ?? event.sourceIdentity?.source_origin
        ?? event.sourceOrigin
        ?? event.source_origin
        ?? null;
    const isCanvasOrigin = sourceOrigin === 'canvas';
    const direction = isCanvasOrigin ? 1 : -1;
    const rawY = Number(event.dy ?? event.scroll?.dy ?? event.deltaY ?? event.scrollY ?? 0);
    const rawX = Number(event.dx ?? event.scroll?.dx ?? event.deltaX ?? event.scrollX ?? 0);
    const dy = Number.isFinite(rawY) ? rawY * direction : 0;
    const dx = Number.isFinite(rawX) ? rawX * direction : 0;
    return {
        dy: Object.is(dy, -0) ? 0 : dy,
        dx: Object.is(dx, -0) ? 0 : dx,
        rawY,
        rawX,
        sourceOrigin,
    };
}

export function createSigilAvatarControls({
    state,
    liveJs,
    projectPoint,
    updateGeometry,
    updatePrimaryStellation,
    updatePrimaryAppearance,
    updatePrimaryTesseronProportion,
    updateOmegaGeometry,
    updateAllColors,
    updatePulsars,
    updateGammaRays,
    updateAccretion,
    updateNeutrinos,
    updateMagneticTentacleCount,
    onAppearanceChange,
    onUtilityAction,
    onAvatarAction,
    onAvatarWindowLevelChange,
    onBoundsChange,
    onClose,
    actionDispatcher = null,
    panelId = 'sigil-avatar-controls-avatar-main',
    panelUrl = null,
    panelFrameToBounds = null,
    panelWidth = PANEL_WIDTH,
    panelHeight = PANEL_HEIGHT,
    trace,
    allowTestAnchorFallback = false,
} = {}) {
    const layer = document.createElement('div');
    layer.className = 'sigil-avatar-controls-layer';
    layer.innerHTML = avatarControlsMarkup();
    document.body.appendChild(layer);

    let anchor = layer.querySelector('#sigil-avatar-controls');
    if (!anchor) {
        if (allowTestAnchorFallback) {
            anchor = document.createElement('div');
            anchor.id = 'sigil-avatar-controls';
            anchor.className = 'avatar-controls-anchor sigil-avatar-controls';
            anchor.setAttribute('role', 'dialog');
            anchor.setAttribute('aria-modal', 'false');
            anchor.setAttribute('aria-label', 'Sigil avatar control surface');
            anchor.setAttribute('aria-hidden', 'true');
            layer.appendChild(anchor);
        }
    }
    if (!anchor) {
        throw new TypeError('Sigil avatar controls markup must include #sigil-avatar-controls.');
    }
    let surfaceState = {
        open: false,
        bounds: null,
        activeSlider: null,
        snapshot: null,
    };
    let compactSurface = null;
    let panelReady = false;
    let panelControls = [];
    let panelActiveTab = null;
    let panelEmbeddedFallbackActive = false;
    const compactValueCache = new Map();
    const usesPanel = typeof actionDispatcher === 'function' && !!panelUrl;
    const interactionRouter = createDesktopWorldInteractionRouter({
        onOutsidePointer(event) {
            if (event.phase === 'up') close('outside-click');
            return true;
        },
    });

    function recordTrace(stage, data = {}) {
        trace?.record?.(`avatar-controls:${stage}`, data);
    }

    function describeElement(element) {
        if (!element) return null;
        return {
            tag: element.tagName || null,
            id: element.id || null,
            className: element.className || null,
            type: element.type || null,
            dataset: element.dataset ? { ...element.dataset } : null,
        };
    }

    function compactControlRecords() {
        return compactSurface?.getControlRecords?.() || panelControls || [];
    }

    function snapshot() {
        return buildAvatarControlsSnapshot(surfaceState, compactSurface, {
            panelControls,
            panelActiveTab,
            panelId: usesPanel ? panelId : null,
        });
    }

    function syncSnapshot() {
        surfaceState.snapshot = {
            activeTab: compactSurface?.getActiveTab?.() || panelActiveTab || null,
            controlCount: compactControlRecords().length,
            surface: usesPanel ? 'toolkit-panel' : 'embedded',
            panelId: usesPanel ? panelId : null,
        };
        anchor.setAttribute('aria-hidden', surfaceState.open ? 'false' : 'true');
        anchor.setAttribute('data-state', surfaceState.open ? 'open' : 'closed');
        if (liveJs) liveJs.avatarControls = snapshot();
    }

    function setControlValue(id, value, checked = null) {
        compactFieldRecordByDescriptorId(id)?.control?.setValue?.(checked !== null ? !!checked : value, { emit: false });
    }

    function setControlDisabled(id, disabled) {
        compactFieldRecordByDescriptorId(id)?.control?.setDisabled?.(disabled);
    }

    function setColorValue(id, value) {
        if (typeof value === 'string') {
            compactFieldRecordByDescriptorId(id)?.control?.setValue?.(value, { emit: false });
        }
    }

    function syncSharedShapeParameterControls(prefix = '') {
        const id = (suffix) => prefix ? `sigil-avatar-controls-${prefix}-${suffix}` : `sigil-avatar-controls-${suffix}`;
        setControlValue(id('tetartoid-a'), state.tetartoidA ?? 1);
        setControlValue(id('tetartoid-b'), state.tetartoidB ?? 1);
        setControlValue(id('tetartoid-c'), state.tetartoidC ?? 1);
        setControlValue(id('torus-radius'), state.torusRadius ?? 1);
        setControlValue(id('torus-tube'), state.torusTube ?? 0.4);
        setControlValue(id('torus-arc'), state.torusArc ?? 1);
        setControlValue(id('prism-top-radius'), state.cylinderTopRadius ?? 1);
        setControlValue(id('prism-bottom-radius'), state.cylinderBottomRadius ?? 1);
        setControlValue(id('prism-height'), state.cylinderHeight ?? 2);
        setControlValue(id('prism-sides'), state.cylinderSides ?? 32);
        setControlValue(id('box-width'), state.boxWidth ?? 1);
        setControlValue(id('box-height'), state.boxHeight ?? 1);
        setControlValue(id('box-depth'), state.boxDepth ?? 1);
    }

    function descriptorContext() {
        return {
            state,
            liveJs,
            updateGeometry,
            updatePrimaryStellation,
            updatePrimaryAppearance,
            updatePrimaryTesseronProportion,
            updateOmegaGeometry,
            updateAllColors,
            updatePulsars,
            updateGammaRays,
            updateAccretion,
            updateNeutrinos,
            updateMagneticTentacleCount,
            onAppearanceChange,
            onAvatarWindowLevelChange,
            setControlDisabled,
            setControlValue,
            computeBaseScale,
        };
    }

    function routeDescriptorUpdate(id, value) {
        const result = applyAvatarControlsDescriptorUpdate(id, value, descriptorContext());
        if (result?.descriptor) recordTrace('descriptor-update', {
            id,
            descriptorId: result.descriptor.id,
            route: result.route,
            value: result.value,
            persisted: result.persisted,
        });
        return result;
    }

    const visualObjectBinding = createVisualObjectBindingAdapter({
        descriptorContext,
        recordTrace,
    });

    function cacheKey(value) {
        if (value === undefined) return 'undefined';
        try {
            return JSON.stringify(value);
        } catch {
            return String(value);
        }
    }

    function seedCompactValueCache(surface = compactSurface) {
        compactValueCache.clear();
        if (!surface) return;
        for (const tab of surface.viewModel.tabs || []) {
            for (const section of tab.sections || []) {
                for (const control of section.controls || []) {
                    compactValueCache.set(control.id, cacheKey(control.value));
                }
            }
        }
        for (const control of surface.viewModel.projection_tools || []) {
            compactValueCache.set(control.id, cacheKey(control.value));
        }
    }

    function seedCompactValueCacheFromViewModel(viewModel = null) {
        if (!viewModel) return;
        compactValueCache.clear();
        for (const tab of viewModel.tabs || []) {
            for (const section of tab.sections || []) {
                for (const control of section.controls || []) {
                    compactValueCache.set(control.id, cacheKey(control.value));
                }
            }
        }
        for (const control of viewModel.projection_tools || []) {
            compactValueCache.set(control.id, cacheKey(control.value));
        }
    }

    function routeChangedControls(controls = [], values = {}) {
        let changed = false;
        for (const control of controls) {
            if (!control?.id || !Object.prototype.hasOwnProperty.call(values, control.id)) continue;
            const value = values[control.id];
            const nextKey = cacheKey(value);
            if (compactValueCache.get(control.id) === nextKey) continue;
            compactValueCache.set(control.id, nextKey);
            const result = routeDescriptorUpdate(control.descriptor_id || control.id, value);
            changed ||= !!result;
        }
        if (changed) {
            syncFromState();
            syncSnapshot();
            sendPanelUpdate('control-change');
        }
        return changed;
    }

    function handleCompactProjectionAction(payload = {}) {
        const control = payload.control || {};
        const id = control.descriptor_id || control.id;
        routeDescriptorUpdate(id, id);
        if (id?.startsWith?.('toggle-')) {
            onUtilityAction?.(control.action_id || id);
            syncSnapshot();
            sendPanelUpdate('projection-action');
            return;
        }
        Promise.resolve(onAvatarAction?.(id)).then((changed) => {
            if (changed) {
                if (usesPanel) {
                    syncFromState();
                    syncSnapshot();
                    sendPanelUpdate('avatar-action');
                } else {
                    void mountCompactSurface().then(() => {
                        syncFromState();
                        seedCompactValueCache();
                        syncSnapshot();
                    });
                }
            }
        }).catch((error) => {
            console.warn('[sigil] avatar control surface action failed:', error);
        });
    }

    async function mountCompactSurface(activeTab = null) {
        const { createSigilAvatarCompactControlSurface } = await loadCompactSurfaceModule();
        const previousSurface = compactSurface;
        const previousTab = previousSurface?.getActiveTab?.();
        const previousScrollTop = previousSurface?.el?.scrollTop ?? 0;
        const previousScrollLeft = previousSurface?.el?.scrollLeft ?? 0;
        compactSurface?.destroy?.();
        compactSurface = createSigilAvatarCompactControlSurface(anchor, state || {}, {
            document,
            defaultTab: activeTab || previousTab || undefined,
            visualObjectBinding: {
                state,
                routeHandlers: visualObjectBinding.routeHandlers,
                rendererSyncHandlers: visualObjectBinding.rendererSyncHandlers,
            },
            onControlChange() {
                queueMicrotask(() => {
                    syncFromState();
                    syncSnapshot();
                });
            },
            onProjectionChange(payload = {}) {
                routeChangedControls(payload.controls || [], payload.values || {});
            },
            onProjectionAction: handleCompactProjectionAction,
            onTabChange(payload = {}) {
                recordTrace('surface-tab', { value: payload.value });
                syncSnapshot();
            },
        });
        if (previousScrollTop > 0 || previousScrollLeft > 0) {
            compactSurface.el.scrollTop = previousScrollTop;
            compactSurface.el.scrollLeft = previousScrollLeft;
        }
        seedCompactValueCache(compactSurface);
        syncSnapshot();
        return compactSurface;
    }

    function compactFieldRecordByDescriptorId(id) {
        if (!compactSurface || !id) return null;
        for (const entry of compactSurface.forms.values()) {
            const fields = Array.from(entry.el.querySelectorAll?.('.aos-form-field') || []);
            const fieldEl = fields.find((element) => element.dataset?.descriptorId === id);
            if (!fieldEl) continue;
            const fieldId = fieldEl.dataset.aosFieldId;
            const field = entry.form.getField(fieldId);
            if (field) return { ...field, form: entry.form, section: entry.section, tab: entry.tab };
        }
        for (const form of compactSurface.projectionForms.values()) {
            const fields = Array.from(form.el.querySelectorAll?.('.aos-form-field') || []);
            const fieldEl = fields.find((element) => element.dataset?.descriptorId === id);
            if (!fieldEl) continue;
            const fieldId = fieldEl.dataset.aosFieldId;
            const field = form.getField(fieldId);
            if (field) return { ...field, form };
        }
        return null;
    }

    function compactFieldRecordForElement(element) {
        const fieldEl = closestAny(element, ['.aos-form-field']);
        const fieldId = fieldEl?.dataset?.aosFieldId;
        if (!fieldId || !compactSurface) return null;
        for (const entry of compactSurface.forms.values()) {
            if (!elementContains(entry.el, fieldEl)) continue;
            const field = entry.form.getField(fieldId);
            if (field) return { ...field, form: entry.form, section: entry.section, tab: entry.tab };
        }
        for (const form of compactSurface.projectionForms.values()) {
            if (!elementContains(form.el, fieldEl)) continue;
            const field = form.getField(fieldId);
            if (field) return { ...field, form };
        }
        return null;
    }

    function snappedSliderValue(raw, field = {}) {
        const min = Number.isFinite(Number(field.min)) ? Number(field.min) : 0;
        const max = Number.isFinite(Number(field.max)) ? Number(field.max) : 100;
        const step = Number.isFinite(Number(field.step)) && Number(field.step) > 0 ? Number(field.step) : 1;
        const clamped = clamp(raw, min, max);
        return Math.round((clamped - min) / step) * step + min;
    }

    function updateCompactSliderAt(sliderRoot, point, options = {}) {
        const record = compactFieldRecordForElement(sliderRoot);
        const local = localClientPoint(point);
        const track = sliderRoot?.querySelector?.('[data-aos-slider-track]');
        const rect = track?.getBoundingClientRect?.() || sliderRoot?.getBoundingClientRect?.();
        if (!record || !local || !rect || !Number.isFinite(rect.left) || !Number.isFinite(rect.width) || rect.width <= 0) {
            return false;
        }
        const min = Number.isFinite(Number(record.field.min)) ? Number(record.field.min) : 0;
        const max = Number.isFinite(Number(record.field.max)) ? Number(record.field.max) : 100;
        const ratio = clamp((local.x - rect.left) / rect.width, 0, 1);
        const value = snappedSliderValue(min + ((max - min) * ratio), record.field);
        const current = Number(record.control.getValue?.());
        if (!Number.isFinite(current) || current !== value || options.commit) {
            record.control.setValue(value, { emit: !!options.commit });
        }
        if (options.commit) record.control.el?.dispatchEvent?.(new Event('commit', { bubbles: true }));
        return true;
    }

    function syncFromState() {
        if (!state) return;
        const avatar = state.avatar ?? {};
        const shape = avatar.shape ?? {};
        const appearance = avatar.appearance ?? {};
        const effects = avatar.effects ?? {};
        const aura = effects.aura ?? {};
        const lightning = effects.lightning ?? {};
        const magnetic = effects.magnetic ?? {};
        const omega = effects.omega ?? {};
        const trail = effects.trail ?? {};
        const colors = appearance.colors ?? state.colors ?? {};

        setControlValue('sigil-avatar-controls-shape-select', shape.type ?? state.currentGeometryType ?? state.currentType);
        setControlValue('sigil-avatar-controls-mother-scale', shape.size?.base ?? state.avatarBase ?? 153);
        syncSharedShapeParameterControls();
        shape.tesseron = normalizeTesseronConfig(shape.tesseron);
        const tesseronSupported = isTesseronSupportedShape(shape.type ?? state.currentGeometryType ?? state.currentType);
        setControlValue('sigil-avatar-controls-tesseron', null, shape.tesseron.enabled);
        setControlValue('sigil-avatar-controls-tesseron-proportion', shape.tesseron.proportion);
        setControlValue('sigil-avatar-controls-tesseron-match', null, shape.tesseron.matchMother);
        setControlDisabled('sigil-avatar-controls-tesseron', !tesseronSupported);
        setControlDisabled('sigil-avatar-controls-tesseron-proportion', !tesseronSupported || !shape.tesseron.enabled);
        setControlDisabled('sigil-avatar-controls-tesseron-match', !tesseronSupported || !shape.tesseron.enabled);
        setControlDisabled('sigil-avatar-controls-stellation', tesseronSupported && shape.tesseron.enabled);
        setControlValue('sigil-avatar-controls-stellation', shape.stellationFactor ?? 0);
        setControlValue('sigil-avatar-controls-opacity', appearance.opacity ?? 0.8);
        setControlValue('sigil-avatar-controls-edge-opacity', appearance.edgeOpacity ?? 0.6);
        setControlValue('sigil-avatar-controls-xray', null, appearance.interiorEdges);
        setControlValue('sigil-avatar-controls-specular', null, appearance.specular);
        setControlValue('sigil-avatar-controls-aura-reach', aura.reach ?? 1);
        setControlValue('sigil-avatar-controls-aura-intensity', aura.intensity ?? 1);
        setControlValue('sigil-avatar-controls-spin', avatar.transform?.idleSpin ?? state.idleSpinSpeed ?? 0.01);
        setControlValue('sigil-avatar-controls-ring', avatar.interaction?.menuRingRadius ?? state.menuRingRadius ?? 120);
        setControlValue('sigil-avatar-controls-avatar-above-menu', null, (avatar.windowing?.avatarLevel ?? state.avatarWindowLevel) === 'screen_saver');
        setControlValue('sigil-avatar-controls-pulsar', null, effects.phenomena?.pulsar?.enabled);
        setControlValue('sigil-avatar-controls-accretion', null, effects.phenomena?.accretion?.enabled);
        setControlValue('sigil-avatar-controls-gamma', null, effects.phenomena?.gamma?.enabled);
        setControlValue('sigil-avatar-controls-neutrino', null, effects.phenomena?.neutrino?.enabled);
        setControlValue('sigil-avatar-controls-lightning', null, lightning.enabled);
        setControlValue('sigil-avatar-controls-magnetic', null, magnetic.enabled);
        setControlValue('sigil-avatar-controls-line-interdim', null, state.fastTravelLineInterDimensional ?? true);
        setControlValue('sigil-avatar-controls-line-trail-enabled', null, state.fastTravelLineInterDimensional ?? true);
        setControlValue('sigil-avatar-controls-line-duration', state.fastTravelLineDuration ?? 0.22);
        setControlValue('sigil-avatar-controls-line-delay', state.fastTravelLineDelay ?? 0);
        setControlValue('sigil-avatar-controls-line-repeat-count', state.fastTravelLineRepeatCount ?? 10);
        setControlValue('sigil-avatar-controls-line-repeat-duration', state.fastTravelLineRepeatDuration ?? 2);
        setControlValue('sigil-avatar-controls-line-lag', state.fastTravelLineLag ?? 0.05);
        setControlValue('sigil-avatar-controls-line-scale', state.fastTravelLineScale ?? 1.5);
        setControlValue('sigil-avatar-controls-line-trail-mode', state.fastTravelLineTrailMode ?? 'fade');
        setControlValue(
            'sigil-avatar-controls-fast-travel-effect',
            normalizeFastTravelEffect(state.transitionFastTravelEffect, DEFAULT_FAST_TRAVEL_EFFECT)
        );
        setControlValue('sigil-avatar-controls-lightning-origin-center', null, lightning.originCenter);
        setControlValue('sigil-avatar-controls-lightning-solid-block', null, lightning.solidBlock);
        setControlValue('sigil-avatar-controls-lightning-length', lightning.boltLength ?? 100);
        setControlValue('sigil-avatar-controls-lightning-frequency', lightning.frequency ?? 2);
        setControlValue('sigil-avatar-controls-lightning-duration', lightning.duration ?? 0.8);
        setControlValue('sigil-avatar-controls-lightning-branching', lightning.branching ?? 0.08);
        setControlValue('sigil-avatar-controls-lightning-brightness', lightning.brightness ?? 1);
        setControlValue('sigil-avatar-controls-magnetic-count', magnetic.tentacleCount ?? 10);
        setControlValue('sigil-avatar-controls-magnetic-speed', magnetic.tentacleSpeed ?? 1);
        setControlValue('sigil-avatar-controls-magnetic-wander', magnetic.wander ?? 3);
        setControlValue('sigil-avatar-controls-wormhole-shading', null, state.wormholeShadingEnabled ?? true);
        setControlValue('sigil-avatar-controls-wormhole-object', null, state.wormholeObjectEnabled ?? true);
        setControlValue('sigil-avatar-controls-wormhole-particles', null, state.wormholeParticlesEnabled ?? true);
        setControlValue('sigil-avatar-controls-wormhole-radius', state.wormholeCaptureRadius ?? 96);
        setControlValue('sigil-avatar-controls-wormhole-implosion', state.wormholeImplosionDuration ?? 1.5);
        setControlValue('sigil-avatar-controls-wormhole-transit', state.wormholeTravelDuration ?? 0.5);
        setControlValue('sigil-avatar-controls-wormhole-rebound', state.wormholeReboundDuration ?? 1.2);
        setControlValue('sigil-avatar-controls-wormhole-distortion', state.wormholeDistortionStrength ?? 1.2);
        setControlValue('sigil-avatar-controls-wormhole-twist', state.wormholeTwist ?? 3.14);
        setControlValue('sigil-avatar-controls-wormhole-zoom', state.wormholeZoom ?? 3.5);
        setControlValue('sigil-avatar-controls-wormhole-object-height', state.wormholeObjectHeight ?? 0.8);
        setControlValue('sigil-avatar-controls-wormhole-object-spin', state.wormholeObjectSpin ?? 4.5);
        setControlValue('sigil-avatar-controls-wormhole-particle-density', state.wormholeParticleDensity ?? 0.05);
        setControlValue('sigil-avatar-controls-wormhole-shadow', state.wormholeTunnelShadow ?? 0.8);
        setControlValue('sigil-avatar-controls-wormhole-specular', state.wormholeSpecularIntensity ?? 0.4);
        setControlValue('sigil-avatar-controls-wormhole-light-angle', state.wormholeLightAngle ?? 2.35);
        setControlValue('sigil-avatar-controls-wormhole-flash', state.wormholeFlashIntensity ?? 1.5);
        setControlValue('sigil-avatar-controls-wormhole-white', state.wormholeWhitePointIntensity ?? 1);
        setControlValue('sigil-avatar-controls-wormhole-starburst', state.wormholeStarburstIntensity ?? 0.95);
        setControlValue('sigil-avatar-controls-wormhole-lens', state.wormholeLensFlareIntensity ?? 0.8);
        setControlValue('sigil-avatar-controls-grid-mode', state.gridMode ?? 'off');
        setControlValue('sigil-avatar-controls-omega-enabled', null, omega.enabled);
        setControlValue('sigil-avatar-controls-omega-shape', omega.shape?.type ?? state.omegaGeometryType ?? state.omegaType ?? 4);
        syncSharedShapeParameterControls('omega');
        omega.shape.tesseron = normalizeTesseronConfig(omega.shape?.tesseron);
        const omegaTesseronSupported = isTesseronSupportedShape(omega.shape?.type ?? state.omegaGeometryType ?? state.omegaType);
        setControlValue('sigil-avatar-controls-omega-tesseron', null, omega.shape.tesseron.enabled);
        setControlValue('sigil-avatar-controls-omega-tesseron-proportion', omega.shape.tesseron.proportion);
        setControlValue('sigil-avatar-controls-omega-tesseron-match', null, omega.shape.tesseron.matchMother);
        setControlDisabled('sigil-avatar-controls-omega-tesseron', !omegaTesseronSupported);
        setControlDisabled('sigil-avatar-controls-omega-tesseron-proportion', !omegaTesseronSupported || !omega.shape.tesseron.enabled);
        setControlDisabled('sigil-avatar-controls-omega-tesseron-match', !omegaTesseronSupported || !omega.shape.tesseron.enabled);
        setControlDisabled('sigil-avatar-controls-omega-stellation', omegaTesseronSupported && omega.shape.tesseron.enabled);
        setControlValue('sigil-avatar-controls-omega-scale', omega.scale ?? 1);
        setControlValue('sigil-avatar-controls-omega-stellation', omega.shape?.stellationFactor ?? 0);
        setControlValue('sigil-avatar-controls-omega-counterspin', null, omega.counterSpin);
        setControlValue('sigil-avatar-controls-omega-lock', null, omega.lockPosition);
        setControlValue('sigil-avatar-controls-trail-enabled', null, trail.enabled);
        setControlValue('sigil-avatar-controls-trail-length', trail.length ?? 20);
        setControlValue('sigil-avatar-controls-trail-opacity', trail.opacity ?? 0.5);
        setControlValue('sigil-avatar-controls-trail-fade', trail.fadeMs ?? 400);
        setControlValue('sigil-avatar-controls-trail-style', trail.style ?? 'omega');
        setControlValue('sigil-avatar-controls-cancel-radius', liveJs?.dragCancelRadius ?? state.dragCancelRadius ?? 40);
        setColorValue('sigil-avatar-controls-primary-color', colors.face?.[0]);
        setColorValue('sigil-avatar-controls-edge-color', colors.edge?.[0]);
        setColorValue('sigil-avatar-controls-face1', colors.face?.[0]);
        setColorValue('sigil-avatar-controls-face2', colors.face?.[1]);
        setColorValue('sigil-avatar-controls-edge1', colors.edge?.[0]);
        setColorValue('sigil-avatar-controls-edge2', colors.edge?.[1]);
        setColorValue('sigil-avatar-controls-aura1', colors.aura?.[0]);
        setColorValue('sigil-avatar-controls-aura2', colors.aura?.[1]);
        setColorValue('sigil-avatar-controls-lightning1', colors.lightning?.[0]);
        setColorValue('sigil-avatar-controls-lightning2', colors.lightning?.[1]);
        setColorValue('sigil-avatar-controls-magnetic1', colors.magnetic?.[0]);
        setColorValue('sigil-avatar-controls-magnetic2', colors.magnetic?.[1]);
        setColorValue('sigil-avatar-controls-grid1', colors.grid?.[0]);
        setColorValue('sigil-avatar-controls-grid2', colors.grid?.[1]);
        compactSurface?.refreshVisibility?.();
    }

    function clampToVisible(point) {
        return resolveAvatarControlsOrigin(point, {
            width: usesPanel ? panelWidth : MENU_WIDTH,
            height: usesPanel ? panelHeight : MENU_HEIGHT,
            displays: liveJs?.displays || [],
            visibleBounds: liveJs?.visibleBounds,
            avatar: {
                point: liveJs?.avatarPos,
                radius: Math.max(
                    Number(liveJs?.avatarHitRadius) || 0,
                    Number(state?.avatarHitRadius) || 0,
                    40
                ),
            },
        });
    }

    function syncPosition() {
        if (usesPanel && !panelEmbeddedFallbackActive) return;
        if (!surfaceState.open || !surfaceState.bounds || typeof projectPoint !== 'function') return;
        const local = projectPoint(surfaceState.bounds);
        if (!local) {
            anchor.style.display = 'none';
            return;
        }
        anchor.style.display = '';
        anchor.style.left = `${Math.round(local.x)}px`;
        anchor.style.top = `${Math.round(local.y)}px`;
    }

    function surfaceBounds() {
        if (usesPanel && !panelEmbeddedFallbackActive) return surfaceState.bounds ? { ...surfaceState.bounds } : null;
        if (!surfaceState.bounds) return null;
        const surfaceRect = anchor.querySelector('.sigil-avatar-control-surface')?.getBoundingClientRect?.();
        if (!surfaceRect || surfaceRect.width <= 0 || surfaceRect.height <= 0) return { ...surfaceState.bounds };
        const anchorRect = anchor.getBoundingClientRect();
        return {
            x: surfaceState.bounds.x + (surfaceRect.left - anchorRect.left),
            y: surfaceState.bounds.y + (surfaceRect.top - anchorRect.top),
            w: surfaceRect.width,
            h: surfaceRect.height,
        };
    }

    function openAt(point) {
        if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y)) return null;
        syncFromState();
        const origin = clampToVisible(point);
        surfaceState.open = true;
        surfaceState.bounds = {
            x: origin.x,
            y: origin.y,
            w: usesPanel ? panelWidth : MENU_WIDTH,
            h: usesPanel ? panelHeight : MENU_HEIGHT,
        };
        if (state) state.isMenuOpen = true;
        recordTrace('open', { point, origin, bounds: surfaceState.bounds });
        syncPosition();
        if (usesPanel) {
            compactSurface?.destroy?.();
            compactSurface = null;
            panelEmbeddedFallbackActive = false;
            anchor.replaceChildren();
            anchor.classList.remove('visible');
            anchor.style.display = 'none';
        } else {
            anchor.classList.add('visible');
        }
        syncSnapshot();
        onBoundsChange?.(snapshot());
        if (usesPanel) {
            void dispatchPanelAction('panel.toggle', {
                id: panelId,
                url: panelUrl,
                width: panelWidth,
                height: panelHeight,
                interactive: true,
                focus: true,
                window_level: 'floating',
                toggle_behavior: 'reposition',
                anchor: {
                    coordinate_space: 'desktop_world',
                    x: point.x,
                    y: point.y,
                    offset: { x: MENU_OFFSET, y: MENU_OFFSET },
                },
                geometry_change: 'frame',
                geometry_cause: 'sigil.avatar.right_click',
                geometry_phase: 'settled',
                geometry: {
                    logical_surface_key: 'sigil.avatar.controls',
                },
            }).then(() => {
                sendPanelUpdate('open');
                globalThis.setTimeout?.(() => {
                    recordTrace('panel-embedded-fallback-check', {
                        open: surfaceState.open,
                        panelControlCount: panelControls.length,
                        compactSurfaceActive: !!compactSurface,
                        panelReady,
                        panelActiveTab,
                    });
                    if (!surfaceState.open || panelControls.length > 0 || compactSurface) return;
                    panelEmbeddedFallbackActive = true;
                    anchor.classList.add('visible');
                    anchor.style.display = '';
                    void mountCompactSurface(panelActiveTab || null).then(() => {
                        if (!surfaceState.open || !panelEmbeddedFallbackActive) return;
                        syncFromState();
                        seedCompactValueCache();
                        syncPosition();
                        syncSnapshot();
                        onBoundsChange?.(snapshot());
                        recordTrace('panel-embedded-fallback', { reason: 'panel-controls-timeout' });
                    }).catch((error) => {
                        console.warn('[sigil] avatar control embedded fallback failed:', error);
                        recordTrace('panel-embedded-fallback-failed', { error: String(error) });
                    });
                }, 750);
            }).catch((error) => {
                console.warn('[sigil] avatar control panel action failed:', error);
                recordTrace('panel-action-failed', { error: String(error) });
            });
            return snapshot();
        }
        void mountCompactSurface().then(() => {
            if (!surfaceState.open) return;
            syncFromState();
            seedCompactValueCache();
            syncPosition();
            syncSnapshot();
            onBoundsChange?.(snapshot());
        }).catch((error) => {
            console.warn('[sigil] avatar control surface mount failed:', error);
            recordTrace('surface-mount-failed', { error: String(error) });
        });
        return snapshot();
    }

    function close(reason = 'close') {
        if (!surfaceState.open) return;
        surfaceState.open = false;
        surfaceState.bounds = null;
        surfaceState.activeSlider = null;
        panelReady = false;
        panelControls = [];
        panelActiveTab = null;
        panelEmbeddedFallbackActive = false;
        interactionRouter.reset();
        compactSurface?.destroy?.();
        compactSurface = null;
        compactValueCache.clear();
        if (state) state.isMenuOpen = false;
        anchor.classList.remove('visible');
        syncSnapshot();
        const nextSnapshot = snapshot();
        recordTrace('close', { reason, snapshot: nextSnapshot });
        onBoundsChange?.(nextSnapshot);
        onClose?.({ reason, snapshot: nextSnapshot });
        if (usesPanel && reason !== 'panel-lifecycle' && reason !== 'panel-close-request') {
            void dispatchPanelAction('panel.close', { id: panelId }).catch((error) => {
                console.warn('[sigil] avatar control panel close failed:', error);
            });
        }
    }

    function applySnapshot(next = {}) {
        const open = !!next.open;
        surfaceState.open = open;
        surfaceState.bounds = open && next.bounds ? { ...next.bounds } : null;
        surfaceState.activeSlider = null;
        interactionRouter.reset();
        if (state) state.isMenuOpen = open;
        if (!open) {
            compactSurface?.destroy?.();
            compactSurface = null;
            panelEmbeddedFallbackActive = false;
            compactValueCache.clear();
            panelReady = false;
            panelControls = [];
            panelActiveTab = null;
            anchor.classList.remove('visible');
            syncSnapshot();
            return;
        }
        syncPosition();
        anchor.classList.add('visible');
        syncSnapshot();
        if (compactSurface) {
            if (next.activeTab && compactSurface.getActiveTab?.() !== next.activeTab) {
                compactSurface.setActiveTab?.(next.activeTab);
            }
            syncFromState();
            seedCompactValueCache();
            syncPosition();
            syncSnapshot();
            return;
        }
        void mountCompactSurface(next.activeTab || null).then(() => {
            if (!surfaceState.open) return;
            syncFromState();
            seedCompactValueCache();
            syncPosition();
            syncSnapshot();
        }).catch((error) => {
            console.warn('[sigil] avatar control surface snapshot mount failed:', error);
            recordTrace('surface-snapshot-mount-failed', { error: String(error) });
        });
    }

    function containsDesktopPoint(point) {
        if (!point) return false;
        if (usesPanel) {
            const b = surfaceState.bounds;
            return !!(b
                && point.x >= b.x
                && point.y >= b.y
                && point.x < b.x + b.w
                && point.y < b.y + b.h);
        }
        const target = elementAt(point);
        if (target && elementContains(anchor, target)) return true;
        const b = surfaceBounds() || surfaceState.bounds;
        return !!(b
            && point.x >= b.x
            && point.y >= b.y
            && point.x < b.x + b.w
            && point.y < b.y + b.h);
    }

    function localClientPoint(point) {
        if (!point || typeof projectPoint !== 'function') return null;
        return projectPoint(point);
    }

    function elementAt(point) {
        const local = localClientPoint(point);
        if (!local) return null;
        return findAvatarControlsElementAt(anchor, local, document);
    }

    function activeScrollableSurface(target) {
        return closestAny(target, ['.sigil-avatar-control-surface'])
            || anchor.querySelector('.sigil-avatar-control-surface');
    }

    function scrollSurfaceAt(point, event = {}) {
        const target = elementAt(point);
        let surface = null;
        if (target && elementContains(anchor, target)) {
            surface = activeScrollableSurface(target);
        } else {
            const b = surfaceBounds() || surfaceState.bounds;
            if (
                !b
                || point.x < b.x
                || point.y < b.y
                || point.x >= b.x + b.w
                || point.y >= b.y + b.h
            ) {
                return false;
            }
            surface = activeScrollableSurface(null);
        }
        if (!surface) return false;
        const scroll = avatarControlsSurfaceScrollDelta(event);
        if (scroll.dy === 0 && scroll.dx === 0) return false;
        surface.scrollTop += scroll.dy;
        surface.scrollLeft += scroll.dx;
        recordTrace('scroll', {
            point,
            target: describeElement(target),
            surface: describeElement(surface),
            dx: scroll.dx,
            dy: scroll.dy,
            rawDx: scroll.rawX,
            rawDy: scroll.rawY,
            sourceOrigin: scroll.sourceOrigin,
            scrollTop: surface.scrollTop,
            scrollLeft: surface.scrollLeft,
        });
        syncSnapshot();
        return true;
    }

    function normalizeBoundsRect(rect) {
        if (!rect || typeof rect !== 'object') return null;
        const x = Number(rect.x);
        const y = Number(rect.y);
        const w = Number(rect.w ?? rect.width);
        const h = Number(rect.h ?? rect.height);
        if (![x, y, w, h].every(Number.isFinite) || w <= 0 || h <= 0) return null;
        return { x, y, w, h };
    }

    function boundsFromFrame(frame) {
        if (!frame) return null;
        if (typeof panelFrameToBounds === 'function') {
            const converted = normalizeBoundsRect(panelFrameToBounds(frame));
            if (converted) return converted;
        }
        if (Array.isArray(frame) && frame.length >= 4) {
            return normalizeBoundsRect({
                x: frame[0],
                y: frame[1],
                w: frame[2],
                h: frame[3],
            });
        }
        return normalizeBoundsRect(frame);
    }

    function updatePanelFrame(frame, reason = 'panel-frame') {
        if (!usesPanel || !surfaceState.open) return false;
        const bounds = boundsFromFrame(frame);
        if (!bounds) return false;
        surfaceState.bounds = bounds;
        recordTrace('panel-frame', { reason, bounds });
        syncSnapshot();
        onBoundsChange?.(snapshot());
        return true;
    }

    function handleMenuPointer(event) {
        const kind = event.type;
        const point = event.point;
        if (kind === 'scroll_wheel') return scrollSurfaceAt(point, event);
        if (surfaceState.activeSlider && (kind === 'left_mouse_dragged' || kind === 'mouse_moved' || kind === 'left_mouse_up')) {
            const active = surfaceState.activeSlider;
            const handled = updateCompactSliderAt(active.sliderRoot, point, { commit: kind === 'left_mouse_up' });
            if (kind === 'left_mouse_up') surfaceState.activeSlider = null;
            return handled;
        }
        if (kind !== 'left_mouse_down' && kind !== 'left_mouse_up') return true;

        const target = elementAt(point);
        if (!target || !elementContains(anchor, target)) {
            recordTrace('pointer:no-target', { kind, point, target: describeElement(target) });
            return true;
        }
        const input = closestAny(target, [
            'input',
            'button',
            'label',
            '[data-aos-select-item]',
            '[data-aos-select-trigger]',
            '[data-aos-slider-root]',
            '[data-aos-slider-control]',
            '[data-aos-slider-track]',
            '[data-aos-slider-thumb]',
        ]);
        recordTrace('pointer:target', {
            kind,
            point,
            target: describeElement(target),
            input: describeElement(input),
        });
        if (!input) return true;

        const sliderRoot = closestAny(input, ['[data-aos-slider-root]']);
        if (kind === 'left_mouse_down' && sliderRoot) {
            surfaceState.activeSlider = { sliderRoot };
            return updateCompactSliderAt(sliderRoot, point);
        }

        if (kind === 'left_mouse_up') {
            if (sliderRoot) {
                surfaceState.activeSlider = null;
                return updateCompactSliderAt(sliderRoot, point, { commit: true });
            }
            if (input.matches('input[type="checkbox"]')) {
                input.checked = !input.checked;
                input.dispatchEvent(new Event('change', { bubbles: true }));
                recordTrace('checkbox-toggle', { id: input.id, checked: input.checked, via: 'input' });
                return true;
            }
            if (input.matches('label')) {
                const checkbox = input.querySelector('input[type="checkbox"]');
                if (checkbox) {
                    checkbox.checked = !checkbox.checked;
                    checkbox.dispatchEvent(new Event('change', { bubbles: true }));
                    recordTrace('checkbox-toggle', { id: checkbox.id, checked: checkbox.checked, via: 'label' });
                    return true;
                }
            }
            if (input.matches('button, [data-aos-select-item], [data-aos-select-trigger]')) {
                recordTrace('click', { input: describeElement(input) });
                input.click();
                syncSnapshot();
                return true;
            }
        }
        return true;
    }

    interactionRouter.registerRegion({
        id: 'sigil-avatar-controls',
        priority: 100,
        contains: containsDesktopPoint,
        onPointer: handleMenuPointer,
    });

    function handlePointerEvent(kind, point, options = {}) {
        if (!surfaceState.open) return false;
        if (usesPanel) {
            const raw = options.raw || {};
            const sourceIdentity = options.sourceIdentity || raw.sourceIdentity || {};
            const sourceCanvasId = sourceIdentity.sourceCanvasId
                || sourceIdentity.source_canvas_id
                || raw.sourceCanvasId
                || raw.source_canvas_id
                || null;
            const ownerCanvasId = sourceIdentity.ownerCanvasId
                || sourceIdentity.owner_canvas_id
                || raw.ownerCanvasId
                || raw.owner_canvas_id
                || null;
            if (sourceCanvasId === panelId || ownerCanvasId === panelId) return true;
            if (panelEmbeddedFallbackActive) {
                return interactionRouter.route(
                    { type: kind, x: point.x, y: point.y, ...raw },
                    {
                        source: options.source || 'global',
                        sourceIdentity,
                        regionId: options.regionId,
                    }
                );
            }
            const inside = containsDesktopPoint(point);
            if (!inside && kind === 'left_mouse_down') return false;
            return inside || kind !== 'left_mouse_down';
        }
        const raw = options.raw || {};
        const sourceIdentity = options.sourceIdentity || raw.sourceIdentity || (
            raw.sourceOrigin || raw.source_origin || raw.sourceCanvasId || raw.source_canvas_id
                ? {
                    sourceOrigin: raw.sourceOrigin ?? raw.source_origin ?? null,
                    sourceCanvasId: raw.sourceCanvasId ?? raw.source_canvas_id ?? null,
                    ownerCanvasId: raw.ownerCanvasId ?? raw.owner_canvas_id ?? null,
                }
                : null
        );
        return interactionRouter.route(
            { type: kind, x: point.x, y: point.y, ...raw },
            {
                source: options.source || 'global',
                sourceIdentity,
                regionId: options.regionId,
            }
        );
    }

    syncFromState();
    syncSnapshot();

    function buildPanelUpdatePayload(reason = 'sync') {
        const viewModel = buildSigilAvatarCompactSurfaceViewModel(state || {});
        seedCompactValueCacheFromViewModel(viewModel);
        return {
            reason,
            panel_id: panelId,
            view_model: viewModel,
            active_tab: panelActiveTab || surfaceState.snapshot?.activeTab || null,
        };
    }

    function dispatchPanelAction(action, payload = {}) {
        if (!usesPanel) return Promise.resolve(null);
        return Promise.resolve(actionDispatcher(action, {
            ...payload,
            source: {
                app: 'sigil',
                surface: 'avatar',
                canvas_id: 'avatar-main',
            },
        }));
    }

    function sendPanelUpdate(reason = 'sync') {
        if (!usesPanel || !surfaceState.open || !panelReady) return false;
        const message = {
            type: 'sigil.avatar_panel.update',
            payload: buildPanelUpdatePayload(reason),
        };
        void dispatchPanelAction('canvas.send', {
            target: panelId,
            message,
        }).catch((error) => {
            console.warn('[sigil] avatar control panel update failed:', error);
        });
        return true;
    }

    function handlePanelMessage(message = {}) {
        const type = message.type;
        const payload = message.payload || message;
        if (type === 'sigil.avatar_panel.ready') {
            panelReady = true;
            sendPanelUpdate('ready');
            return true;
        }
        if (type === 'sigil.avatar_panel.snapshot') {
            updatePanelFrame(payload.frame || payload.panel_frame, payload.reason || 'snapshot');
            panelControls = Array.isArray(payload.controls) ? payload.controls : [];
            panelActiveTab = payload.active_tab || payload.activeTab || panelActiveTab;
            syncSnapshot();
            onBoundsChange?.(snapshot());
            return true;
        }
        if (type === 'sigil.avatar_panel.tab_change') {
            panelActiveTab = payload.value || payload.active_tab || payload.activeTab || panelActiveTab;
            syncSnapshot();
            return true;
        }
        if (type === 'sigil.avatar_panel.control_change' || type === 'sigil.avatar_panel.projection_change') {
            routeChangedControls(payload.controls || [], payload.values || {});
            return true;
        }
        if (type === 'sigil.avatar_panel.projection_action') {
            handleCompactProjectionAction(payload);
            return true;
        }
        if (type === 'sigil.avatar_panel.close') {
            close('panel-close-request');
            return true;
        }
        return false;
    }

    return {
        openAt,
        close,
        isOpen() {
            return surfaceState.open;
        },
        usesExternalPanel() {
            return usesPanel;
        },
        bounds() {
            return surfaceState.bounds ? { ...surfaceState.bounds } : null;
        },
        interactiveBounds() {
            if (usesPanel) return null;
            return surfaceBounds() || (surfaceState.bounds ? { ...surfaceState.bounds } : null);
        },
        updateSegmentPosition: syncPosition,
        containsDesktopPoint,
        handlePointerEvent,
        handlePanelMessage,
        updatePanelFrame,
        sendPanelUpdate,
        applySnapshot,
        snapshot,
    };
}
