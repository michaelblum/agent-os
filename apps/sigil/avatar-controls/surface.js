import { toolkitSpecifier } from '../renderer/live-modules/content-roots.js';

const TOOLKIT_RUNTIME_BASE = toolkitSpecifier('runtime', {
    local: '../../../packages/toolkit/runtime',
});
const TOOLKIT_PANEL_DRAG_DROP = toolkitSpecifier('panel/drag-drop.js', {
    local: '../../../packages/toolkit/panel/drag-drop.js',
});
const TOOLKIT_PANEL_PLACEMENT = toolkitSpecifier('panel/placement.js', {
    local: '../../../packages/toolkit/panel/placement.js',
});

const { createDesktopWorldInteractionRouter } = await import(`${TOOLKIT_RUNTIME_BASE}/interaction-region.js`);
const { createDragDropController } = await import(TOOLKIT_PANEL_DRAG_DROP);
const { createAnchoredPanelPlacementPlan } = await import(TOOLKIT_PANEL_PLACEMENT);
import {
    DEFAULT_FAST_TRAVEL_EFFECT,
    normalizeFastTravelEffect,
} from '../renderer/transition-registry.js';
import { isTesseronSupportedShape, normalizeTesseronConfig } from '../renderer/tesseron.js';
import {
    applyAvatarControlsDescriptorUpdate,
} from './descriptors.js';
import { createAvatarControlsCompactSurfaceSession } from './compact-surface-session.js';
import {
    displayVisibleBoundsForPoint,
    frameToBounds,
    overlapArea,
    resolveAvatarPanelAvoidancePosition,
} from './panel-avoidance.js';
export { resolveAvatarPanelAvoidancePosition } from './panel-avoidance.js';
import { buildAvatarControlsSnapshot } from './snapshot-projection.js';
import { createVisualObjectBindingAdapter } from './visual-object-binding.js';
import { buildSigilAvatarCompactSurfaceViewModel } from '../avatar-editor/surface-view-model.js';

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

function selectorMatches(element, selector) {
    if (!element || !selector) return false;
    if (element.matches?.(selector)) return true;
    if (selector.startsWith('.')) {
        const className = selector.slice(1);
        return element.classList?.contains?.(className)
            || String(element.className || '').split(/\s+/).includes(className);
    }
    if (/^[a-z][a-z0-9-]*$/i.test(selector)) {
        return String(element.tagName || '').toLowerCase() === selector.toLowerCase();
    }
    const attrMatch = selector.match(/^\[([^=\]]+)(?:=["']?([^"'\]]+)["']?)?\]$/);
    if (attrMatch) {
        const attr = attrMatch[1];
        const expected = attrMatch[2];
        const actual = element.getAttribute?.(attr) ?? element.dataset?.[attr.replace(/^data-/, '').replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())];
        return expected == null ? actual != null : String(actual) === expected;
    }
    return false;
}

function closestAny(element, selectors = []) {
    if (!element) return null;
    const combinedSelector = selectors.join(', ');
    const combined = element.closest?.(combinedSelector);
    if (combined) return combined;
    for (let cursor = element; cursor; cursor = cursor.parentElement) {
        if (selectors.some((selector) => selectorMatches(cursor, selector))) return cursor;
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
        '.aos-header',
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

function canvasIdCandidate(value) {
    if (typeof value !== 'string') return null;
    const trimmed = value.trim();
    return trimmed || null;
}

function collectCanvasIdentityIds(target, identity) {
    if (!identity || typeof identity !== 'object') return;
    for (const key of [
        'sourceCanvasId',
        'source_canvas_id',
        'ownerCanvasId',
        'owner_canvas_id',
        'canvasId',
        'canvas_id',
        'id',
    ]) {
        const candidate = canvasIdCandidate(identity[key]);
        if (candidate) target.add(candidate);
    }
    for (const key of ['source', 'owner', 'canvas', 'payload']) {
        collectCanvasIdentityIds(target, identity[key]);
    }
}

function panelSourceIdentityMatches(panelId, { raw = {}, sourceIdentity = null } = {}) {
    const expected = canvasIdCandidate(panelId);
    if (!expected) return false;
    const ids = new Set();
    collectCanvasIdentityIds(ids, sourceIdentity);
    collectCanvasIdentityIds(ids, raw?.sourceIdentity);
    collectCanvasIdentityIds(ids, raw?.source_identity);
    collectCanvasIdentityIds(ids, raw);
    collectCanvasIdentityIds(ids, raw?.message);
    return ids.has(expected);
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
    panelCloseMode = 'suspend',
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
        placementPlan: null,
        activeSlider: null,
        activePanelDrag: null,
        snapshot: null,
    };
    let panelReady = false;
    let panelControls = [];
    let panelActiveTab = null;
    const usesPanel = typeof actionDispatcher === 'function' && !!panelUrl;
    const shouldSuspendPanelOnClose = panelCloseMode !== 'remove';
    const interactionRouter = createDesktopWorldInteractionRouter({
        onOutsidePointer(event) {
            if (event.phase === 'up') close('outside-click');
            return true;
        },
    });

    function positiveSize(value, fallback) {
        const number = Number(value);
        return Number.isFinite(number) && number > 0 ? number : fallback;
    }

    function plannedSurfaceSize() {
        return {
            w: positiveSize(panelWidth, PANEL_WIDTH),
            h: positiveSize(panelHeight, PANEL_HEIGHT),
        };
    }

    function setAnchorStyleProperty(name, value) {
        if (typeof anchor.style?.setProperty === 'function') {
            anchor.style.setProperty(name, value);
        } else if (anchor.style) {
            anchor.style[name] = value;
        }
    }

    function syncEmbeddedAnchorSize() {
        if (usesPanel) return;
        const size = plannedSurfaceSize();
        setAnchorStyleProperty('--sigil-avatar-controls-panel-width', `${size.w}px`);
        setAnchorStyleProperty('--sigil-avatar-controls-panel-height', `${size.h}px`);
    }

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
        return usesPanel ? panelControls || [] : compactSurfaceSession.controlRecords();
    }

    function snapshot() {
        return buildAvatarControlsSnapshot(surfaceState, compactSurfaceSession.surface(), {
            panelControls,
            panelActiveTab,
            panelId: usesPanel ? panelId : null,
        });
    }

    function syncSnapshot() {
        const controls = compactControlRecords();
        surfaceState.snapshot = {
            activeTab: compactSurfaceSession.activeTab() || panelActiveTab || null,
            controlCount: controls.length,
            surface: usesPanel ? 'toolkit-panel' : 'embedded',
            panelId: usesPanel ? panelId : null,
        };
        anchor.setAttribute('aria-hidden', surfaceState.open ? 'false' : 'true');
        anchor.setAttribute('data-state', surfaceState.open ? 'open' : 'closed');
        if (liveJs) liveJs.avatarControls = snapshot();
    }

    function avatarAnchorRect(fallbackPoint = null) {
        const point = liveJs?.avatarPos && Number.isFinite(liveJs.avatarPos.x) && Number.isFinite(liveJs.avatarPos.y)
            ? liveJs.avatarPos
            : fallbackPoint;
        const radius = Math.max(
            Number(liveJs?.avatarHitRadius) || 0,
            Number(state?.avatarHitRadius) || 0,
            40
        );
        if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y) || radius <= 0) return null;
        return {
            x: point.x - radius,
            y: point.y - radius,
            w: radius * 2,
            h: radius * 2,
        };
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

    const compactSurfaceSession = createAvatarControlsCompactSurfaceSession({
        anchor,
        state,
        document,
        visualObjectBinding,
        routeDescriptorUpdate,
        onUtilityAction,
        onAvatarAction,
        syncFromState,
        syncSnapshot,
        recordTrace,
        onClose() {
            close('panel-close-request');
        },
    });

    function compactFieldRecordByDescriptorId(id) {
        const compactSurface = compactSurfaceSession.surface();
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
        const compactSurface = compactSurfaceSession.surface();
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
        compactSurfaceSession.refreshVisibility();
    }

    function clampToVisible(point) {
        const size = plannedSurfaceSize();
        return resolveAvatarControlsOrigin(point, {
            width: size.w,
            height: size.h,
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

    function resolveInitialPlacementPlan(point) {
        const { w: width, h: height } = plannedSurfaceSize();
        const anchorRect = avatarAnchorRect(point);
        if (anchorRect) {
            const plan = createAnchoredPanelPlacementPlan({
                anchorRect,
                panelSize: { w: width, h: height },
                displays: liveJs?.displays || [],
                preferredPlacements: ['right', 'left'],
                gap: MENU_OFFSET,
                offset: { x: 0, y: 0 },
                constrainTo: 'anchor-display',
                viewportOverflowPolicy: 'flip-shift',
                cause: 'sigil.avatar.controls.open',
                workArea: (!Array.isArray(liveJs?.displays) || liveJs.displays.length === 0) && liveJs?.visibleBounds ? [
                    liveJs.visibleBounds.x,
                    liveJs.visibleBounds.y,
                    liveJs.visibleBounds.w,
                    liveJs.visibleBounds.h,
                ] : null,
            });
            const bounds = frameToBounds(plan.final_settled_frame);
            if (bounds) return { plan, bounds };
        }
        const origin = clampToVisible(point);
        const bounds = { x: origin.x, y: origin.y, w: width, h: height };
        return {
            plan: {
                requested_frame: [bounds.x, bounds.y, bounds.w, bounds.h],
                policy_adjusted_frame: [bounds.x, bounds.y, bounds.w, bounds.h],
                final_settled_frame: [bounds.x, bounds.y, bounds.w, bounds.h],
                viewport_overflow_policy: 'fallback',
                anchor_frame: anchorRect ? [anchorRect.x, anchorRect.y, anchorRect.w, anchorRect.h] : null,
                anchor_display_id: null,
                chosen_placement: 'fallback',
                cause: 'sigil.avatar.controls.open',
            },
            bounds,
        };
    }

    function syncPosition() {
        if (usesPanel) return;
        syncEmbeddedAnchorSize();
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
        if (usesPanel) return surfaceState.bounds ? { ...surfaceState.bounds } : null;
        if (!surfaceState.bounds) return null;
        const surfaceRect = anchor.querySelector('.aos-panel')?.getBoundingClientRect?.()
            || anchor.querySelector('.sigil-avatar-control-surface')?.getBoundingClientRect?.();
        if (!surfaceRect || surfaceRect.width <= 0 || surfaceRect.height <= 0) return { ...surfaceState.bounds };
        const anchorRect = anchor.getBoundingClientRect?.();
        if (!anchorRect) return { ...surfaceState.bounds };
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
        const placement = resolveInitialPlacementPlan(point);
        surfaceState.open = true;
        surfaceState.bounds = placement.bounds;
        surfaceState.placementPlan = placement.plan;
        if (state) state.isMenuOpen = true;
        recordTrace('open', { point, placement: placement.plan, bounds: surfaceState.bounds });
        syncPosition();
        if (usesPanel) {
            compactSurfaceSession.destroy();
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
                width: surfaceState.bounds.w,
                height: surfaceState.bounds.h,
                interactive: true,
                focus: true,
                window_level: 'floating',
                toggle_behavior: 'reposition',
                anchor: {
                    coordinate_space: 'desktop_world',
                    x: surfaceState.bounds.x,
                    y: surfaceState.bounds.y,
                    offset: { x: 0, y: 0 },
                },
                geometry_change: 'frame',
                geometry_cause: 'sigil.avatar.right_click',
                geometry_phase: 'settled',
                geometry: {
                    logical_surface_key: 'sigil.avatar.controls',
                },
            }).then(() => {
                sendPanelUpdate('open');
            }).catch((error) => {
                console.warn('[sigil] avatar control panel action failed:', error);
                recordTrace('panel-action-failed', { error: String(error) });
            });
            return snapshot();
        }
        void compactSurfaceSession.mount().then(() => {
            if (!surfaceState.open) return;
            syncFromState();
            compactSurfaceSession.seedValueCache();
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
        if (!usesPanel && reason === 'outside-click') {
            recordTrace('outside-click-preserved', { reason });
            return;
        }
        const panelWasRemoved = reason === 'panel-removed' || reason === 'panel-lifecycle';
        const preservePanelSession = usesPanel && shouldSuspendPanelOnClose && !panelWasRemoved;
        surfaceState.open = false;
        surfaceState.bounds = null;
        surfaceState.placementPlan = null;
        surfaceState.activeSlider = null;
        surfaceState.activePanelDrag = null;
        if (!preservePanelSession) panelReady = false;
        panelControls = [];
        panelActiveTab = null;
        interactionRouter.reset();
        compactSurfaceSession.destroy();
        if (state) state.isMenuOpen = false;
        anchor.classList.remove('visible');
        syncSnapshot();
        const nextSnapshot = snapshot();
        recordTrace('close', { reason, snapshot: nextSnapshot });
        onBoundsChange?.(nextSnapshot);
        onClose?.({ reason, snapshot: nextSnapshot });
        if (
            usesPanel
            && reason !== 'panel-lifecycle'
            && reason !== 'panel-removed'
            && reason !== 'panel-suspended'
            && reason !== 'panel-close-request'
        ) {
            const action = shouldSuspendPanelOnClose ? 'canvas.suspend' : 'panel.close';
            void dispatchPanelAction(action, { id: panelId }).catch((error) => {
                console.warn('[sigil] avatar control panel close failed:', error);
            });
        }
    }

    function applySnapshot(next = {}) {
        const open = !!next.open;
        surfaceState.open = open;
        surfaceState.bounds = open && next.bounds ? { ...next.bounds } : null;
        surfaceState.placementPlan = next.placementPlan ? { ...next.placementPlan } : null;
        surfaceState.activeSlider = null;
        surfaceState.activePanelDrag = null;
        interactionRouter.reset();
        if (state) state.isMenuOpen = open;
        if (!open) {
            panelReady = false;
            panelControls = [];
            panelActiveTab = null;
            compactSurfaceSession.destroy();
            anchor.classList.remove('visible');
            syncSnapshot();
            return;
        }
        if (usesPanel) {
            compactSurfaceSession.destroy();
            anchor.replaceChildren();
            anchor.classList.remove('visible');
            anchor.style.display = 'none';
            syncSnapshot();
            return;
        }
        syncPosition();
        anchor.classList.add('visible');
        syncSnapshot();
        const compactSurface = compactSurfaceSession.surface();
        if (compactSurface) {
            if (next.activeTab && compactSurface.getActiveTab?.() !== next.activeTab) {
                compactSurface.setActiveTab?.(next.activeTab);
            }
            syncFromState();
            compactSurfaceSession.seedValueCache();
            syncPosition();
            syncSnapshot();
            return;
        }
        void compactSurfaceSession.mount(next.activeTab || null).then(() => {
            if (!surfaceState.open) return;
            syncFromState();
            compactSurfaceSession.seedValueCache();
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

    function displayBoundsRect(display = {}) {
        const bounds = display.dw_bounds
            || display.desktopWorldBounds
            || display.desktop_world_bounds
            || display.visibleBounds
            || display.visible_bounds
            || display.bounds
            || null;
        if (!bounds) return null;
        const x = Number(bounds.x);
        const y = Number(bounds.y);
        const w = Number(bounds.w ?? bounds.width);
        const h = Number(bounds.h ?? bounds.height);
        if (![x, y, w, h].every(Number.isFinite) || w <= 0 || h <= 0) return null;
        return { x, y, w, h };
    }

    function unionDragWorkArea() {
        const displayRects = Array.isArray(liveJs?.displays)
            ? liveJs.displays.map(displayBoundsRect).filter(Boolean)
            : [];
        const rects = displayRects.length
            ? displayRects
            : [displayBoundsRect(liveJs?.visibleBounds)].filter(Boolean);
        if (!rects.length) {
            return [0, 0, Math.max(1, window.innerWidth || PANEL_WIDTH), Math.max(1, window.innerHeight || PANEL_HEIGHT)];
        }
        const minX = Math.min(...rects.map((rect) => rect.x));
        const minY = Math.min(...rects.map((rect) => rect.y));
        const maxX = Math.max(...rects.map((rect) => rect.x + rect.w));
        const maxY = Math.max(...rects.map((rect) => rect.y + rect.h));
        return [minX, minY, Math.max(1, maxX - minX), Math.max(1, maxY - minY)];
    }

    function applyEmbeddedPanelFrame(frame, phase = 'move') {
        if (!Array.isArray(frame) || frame.length < 4 || !surfaceState.open || usesPanel) return false;
        surfaceState.bounds = {
            x: Number(frame[0]),
            y: Number(frame[1]),
            w: Math.max(1, Number(frame[2])),
            h: Math.max(1, Number(frame[3])),
        };
        surfaceState.placementPlan = null;
        syncPosition();
        syncSnapshot();
        onBoundsChange?.(snapshot());
        recordTrace('embedded-panel-drag', { phase, bounds: surfaceState.bounds });
        return true;
    }

    function embeddedPanelDragHandleAt(point) {
        if (usesPanel) return null;
        const bounds = surfaceBounds() || surfaceState.bounds;
        const target = elementAt(point);
        if (target && elementContains(anchor, target)) {
            const controls = closestAny(target, ['.aos-controls', '.aos-window-controls', 'button']);
            if (controls) return null;
            const header = closestAny(target, ['.aos-header']);
            if (header) return header;
            return null;
        }
        if (
            bounds
            && Number.isFinite(point?.x)
            && Number.isFinite(point?.y)
            && point.x >= bounds.x
            && point.x < bounds.x + bounds.w
            && point.y >= bounds.y
            && point.y < bounds.y + 40
        ) {
            return anchor.querySelector('.aos-header') || anchor;
        }
        return null;
    }

    function startEmbeddedPanelDrag(point) {
        const bounds = surfaceBounds() || surfaceState.bounds;
        if (!bounds) return false;
        const controller = createDragDropController({
            getFrame: () => {
                const current = surfaceBounds() || surfaceState.bounds || bounds;
                return [current.x, current.y, current.w, current.h];
            },
            getDragWorkArea: unionDragWorkArea,
            move(screenX, screenY, offsetX, offsetY) {
                applyEmbeddedPanelFrame([
                    screenX - offsetX,
                    screenY - offsetY,
                    bounds.w,
                    bounds.h,
                ], 'move');
            },
            updateFrame(frame) {
                applyEmbeddedPanelFrame(frame, 'settled');
            },
            clampOnEnd: true,
        });
        controller.start({
            pointerId: 1,
            clientX: point.x - bounds.x,
            clientY: point.y - bounds.y,
            screenX: point.x,
            screenY: point.y,
        });
        surfaceState.activePanelDrag = { controller };
        recordTrace('embedded-panel-drag-start', { point, bounds });
        return true;
    }

    function routeEmbeddedPanelDrag(kind, point) {
        const active = surfaceState.activePanelDrag;
        if (!active) return false;
        if (kind === 'left_mouse_dragged' || kind === 'mouse_moved') {
            active.controller.move({ pointerId: 1, screenX: point.x, screenY: point.y });
            return true;
        }
        if (kind === 'left_mouse_up') {
            active.controller.end({ pointerId: 1, screenX: point.x, screenY: point.y });
            surfaceState.activePanelDrag = null;
            recordTrace('embedded-panel-drag-end', { point, bounds: surfaceState.bounds });
            return true;
        }
        return true;
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
        if (surfaceState.activePanelDrag && (kind === 'left_mouse_dragged' || kind === 'mouse_moved' || kind === 'left_mouse_up')) {
            return routeEmbeddedPanelDrag(kind, point);
        }
        if (kind === 'left_mouse_down' && embeddedPanelDragHandleAt(point)) {
            return startEmbeddedPanelDrag(point);
        }
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
            if (panelSourceIdentityMatches(panelId, { raw, sourceIdentity })) return true;
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
        if (surfaceState.activePanelDrag && (kind === 'left_mouse_dragged' || kind === 'mouse_moved' || kind === 'left_mouse_up')) {
            return routeEmbeddedPanelDrag(kind, point);
        }
        if (kind === 'left_mouse_down' && embeddedPanelDragHandleAt(point)) {
            return startEmbeddedPanelDrag(point);
        }
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
            compactSurfaceSession.routeChangedControls(payload.controls || [], payload.values || {});
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
