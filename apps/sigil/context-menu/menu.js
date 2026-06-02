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
    applyContextMenuDescriptorUpdate,
} from './descriptors.js';
import { buildContextMenuSnapshot } from './snapshot-projection.js';
import { createVisualObjectBindingAdapter } from './visual-object-binding.js';

let compactSurfaceModulePromise = null;

function loadCompactSurfaceModule() {
    compactSurfaceModulePromise ||= import('../avatar-editor/compact-surface.js');
    return compactSurfaceModulePromise;
}

const MENU_WIDTH = 292;
const MENU_HEIGHT = 448;
const MENU_OFFSET = 18;
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

export function resolveContextMenuOrigin(point, options = {}) {
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

export function findContextMenuElementAt(anchor, point, doc = document) {
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

export function menuMarkup() {
    return '<div id="sigil-context-menu" class="ctx-anchor sigil-context-menu" role="dialog" aria-modal="false" aria-label="Sigil avatar control surface" aria-hidden="true"></div>';
}

export function contextMenuContentProps(open) {
    const isOpen = !!open;
    return {
        'aria-label': 'Sigil avatar control surface',
        'aria-hidden': isOpen ? 'false' : 'true',
        'data-state': isOpen ? 'open' : 'closed',
        class: `ctx-anchor sigil-context-menu${isOpen ? ' visible' : ''}`,
    };
}

export function contextMenuSurfaceScrollDelta(event = {}) {
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

export function createSigilContextMenu({
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
    trace,
    allowTestAnchorFallback = false,
} = {}) {
    const layer = document.createElement('div');
    layer.className = 'sigil-context-menu-layer';
    layer.innerHTML = menuMarkup();
    document.body.appendChild(layer);

    let anchor = layer.querySelector('#sigil-context-menu');
    if (!anchor) {
        if (allowTestAnchorFallback) {
            anchor = document.createElement('div');
            anchor.id = 'sigil-context-menu';
            anchor.className = 'ctx-anchor sigil-context-menu';
            anchor.setAttribute('role', 'dialog');
            anchor.setAttribute('aria-modal', 'false');
            anchor.setAttribute('aria-label', 'Sigil avatar control surface');
            anchor.setAttribute('aria-hidden', 'true');
            layer.appendChild(anchor);
        }
    }
    if (!anchor) {
        throw new TypeError('Sigil context menu markup must include #sigil-context-menu.');
    }
    let menuState = {
        open: false,
        bounds: null,
        activeSlider: null,
        snapshot: null,
    };
    let compactSurface = null;
    const compactValueCache = new Map();
    const interactionRouter = createDesktopWorldInteractionRouter({
        onOutsidePointer(event) {
            if (event.phase === 'up') close('outside-click');
            return true;
        },
    });

    function recordTrace(stage, data = {}) {
        trace?.record?.(`context-menu:${stage}`, data);
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
        return compactSurface?.getControlRecords?.() || [];
    }

    function snapshot() {
        return buildContextMenuSnapshot(menuState, compactSurface);
    }

    function syncSnapshot() {
        menuState.snapshot = {
            activeTab: compactSurface?.getActiveTab?.() || null,
            controlCount: compactControlRecords().length,
        };
        anchor.setAttribute('aria-hidden', menuState.open ? 'false' : 'true');
        anchor.setAttribute('data-state', menuState.open ? 'open' : 'closed');
        if (liveJs) liveJs.contextMenu = snapshot();
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
        const id = (suffix) => prefix ? `sigil-menu-${prefix}-${suffix}` : `sigil-menu-${suffix}`;
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
        const result = applyContextMenuDescriptorUpdate(id, value, descriptorContext());
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
            return;
        }
        Promise.resolve(onAvatarAction?.(id)).then((changed) => {
            if (changed) {
                void mountCompactSurface().then(() => {
                    syncFromState();
                    seedCompactValueCache();
                    syncSnapshot();
                });
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

        setControlValue('sigil-menu-shape-select', shape.type ?? state.currentGeometryType ?? state.currentType);
        setControlValue('sigil-menu-mother-scale', shape.size?.base ?? state.avatarBase ?? 153);
        syncSharedShapeParameterControls();
        shape.tesseron = normalizeTesseronConfig(shape.tesseron);
        const tesseronSupported = isTesseronSupportedShape(shape.type ?? state.currentGeometryType ?? state.currentType);
        setControlValue('sigil-menu-tesseron', null, shape.tesseron.enabled);
        setControlValue('sigil-menu-tesseron-proportion', shape.tesseron.proportion);
        setControlValue('sigil-menu-tesseron-match', null, shape.tesseron.matchMother);
        setControlDisabled('sigil-menu-tesseron', !tesseronSupported);
        setControlDisabled('sigil-menu-tesseron-proportion', !tesseronSupported || !shape.tesseron.enabled);
        setControlDisabled('sigil-menu-tesseron-match', !tesseronSupported || !shape.tesseron.enabled);
        setControlDisabled('sigil-menu-stellation', tesseronSupported && shape.tesseron.enabled);
        setControlValue('sigil-menu-stellation', shape.stellationFactor ?? 0);
        setControlValue('sigil-menu-opacity', appearance.opacity ?? 0.8);
        setControlValue('sigil-menu-edge-opacity', appearance.edgeOpacity ?? 0.6);
        setControlValue('sigil-menu-xray', null, appearance.interiorEdges);
        setControlValue('sigil-menu-specular', null, appearance.specular);
        setControlValue('sigil-menu-aura-reach', aura.reach ?? 1);
        setControlValue('sigil-menu-aura-intensity', aura.intensity ?? 1);
        setControlValue('sigil-menu-spin', avatar.transform?.idleSpin ?? state.idleSpinSpeed ?? 0.01);
        setControlValue('sigil-menu-ring', avatar.interaction?.menuRingRadius ?? state.menuRingRadius ?? 120);
        setControlValue('sigil-menu-avatar-above-menu', null, (avatar.windowing?.avatarLevel ?? state.avatarWindowLevel) === 'screen_saver');
        setControlValue('sigil-menu-pulsar', null, effects.phenomena?.pulsar?.enabled);
        setControlValue('sigil-menu-accretion', null, effects.phenomena?.accretion?.enabled);
        setControlValue('sigil-menu-gamma', null, effects.phenomena?.gamma?.enabled);
        setControlValue('sigil-menu-neutrino', null, effects.phenomena?.neutrino?.enabled);
        setControlValue('sigil-menu-lightning', null, lightning.enabled);
        setControlValue('sigil-menu-magnetic', null, magnetic.enabled);
        setControlValue('sigil-menu-line-interdim', null, state.fastTravelLineInterDimensional ?? true);
        setControlValue('sigil-menu-line-trail-enabled', null, state.fastTravelLineInterDimensional ?? true);
        setControlValue('sigil-menu-line-duration', state.fastTravelLineDuration ?? 0.22);
        setControlValue('sigil-menu-line-delay', state.fastTravelLineDelay ?? 0);
        setControlValue('sigil-menu-line-repeat-count', state.fastTravelLineRepeatCount ?? 10);
        setControlValue('sigil-menu-line-repeat-duration', state.fastTravelLineRepeatDuration ?? 2);
        setControlValue('sigil-menu-line-lag', state.fastTravelLineLag ?? 0.05);
        setControlValue('sigil-menu-line-scale', state.fastTravelLineScale ?? 1.5);
        setControlValue('sigil-menu-line-trail-mode', state.fastTravelLineTrailMode ?? 'fade');
        setControlValue(
            'sigil-menu-fast-travel-effect',
            normalizeFastTravelEffect(state.transitionFastTravelEffect, DEFAULT_FAST_TRAVEL_EFFECT)
        );
        setControlValue('sigil-menu-lightning-origin-center', null, lightning.originCenter);
        setControlValue('sigil-menu-lightning-solid-block', null, lightning.solidBlock);
        setControlValue('sigil-menu-lightning-length', lightning.boltLength ?? 100);
        setControlValue('sigil-menu-lightning-frequency', lightning.frequency ?? 2);
        setControlValue('sigil-menu-lightning-duration', lightning.duration ?? 0.8);
        setControlValue('sigil-menu-lightning-branching', lightning.branching ?? 0.08);
        setControlValue('sigil-menu-lightning-brightness', lightning.brightness ?? 1);
        setControlValue('sigil-menu-magnetic-count', magnetic.tentacleCount ?? 10);
        setControlValue('sigil-menu-magnetic-speed', magnetic.tentacleSpeed ?? 1);
        setControlValue('sigil-menu-magnetic-wander', magnetic.wander ?? 3);
        setControlValue('sigil-menu-wormhole-shading', null, state.wormholeShadingEnabled ?? true);
        setControlValue('sigil-menu-wormhole-object', null, state.wormholeObjectEnabled ?? true);
        setControlValue('sigil-menu-wormhole-particles', null, state.wormholeParticlesEnabled ?? true);
        setControlValue('sigil-menu-wormhole-radius', state.wormholeCaptureRadius ?? 96);
        setControlValue('sigil-menu-wormhole-implosion', state.wormholeImplosionDuration ?? 1.5);
        setControlValue('sigil-menu-wormhole-transit', state.wormholeTravelDuration ?? 0.5);
        setControlValue('sigil-menu-wormhole-rebound', state.wormholeReboundDuration ?? 1.2);
        setControlValue('sigil-menu-wormhole-distortion', state.wormholeDistortionStrength ?? 1.2);
        setControlValue('sigil-menu-wormhole-twist', state.wormholeTwist ?? 3.14);
        setControlValue('sigil-menu-wormhole-zoom', state.wormholeZoom ?? 3.5);
        setControlValue('sigil-menu-wormhole-object-height', state.wormholeObjectHeight ?? 0.8);
        setControlValue('sigil-menu-wormhole-object-spin', state.wormholeObjectSpin ?? 4.5);
        setControlValue('sigil-menu-wormhole-particle-density', state.wormholeParticleDensity ?? 0.05);
        setControlValue('sigil-menu-wormhole-shadow', state.wormholeTunnelShadow ?? 0.8);
        setControlValue('sigil-menu-wormhole-specular', state.wormholeSpecularIntensity ?? 0.4);
        setControlValue('sigil-menu-wormhole-light-angle', state.wormholeLightAngle ?? 2.35);
        setControlValue('sigil-menu-wormhole-flash', state.wormholeFlashIntensity ?? 1.5);
        setControlValue('sigil-menu-wormhole-white', state.wormholeWhitePointIntensity ?? 1);
        setControlValue('sigil-menu-wormhole-starburst', state.wormholeStarburstIntensity ?? 0.95);
        setControlValue('sigil-menu-wormhole-lens', state.wormholeLensFlareIntensity ?? 0.8);
        setControlValue('sigil-menu-grid-mode', state.gridMode ?? 'off');
        setControlValue('sigil-menu-omega-enabled', null, omega.enabled);
        setControlValue('sigil-menu-omega-shape', omega.shape?.type ?? state.omegaGeometryType ?? state.omegaType ?? 4);
        syncSharedShapeParameterControls('omega');
        omega.shape.tesseron = normalizeTesseronConfig(omega.shape?.tesseron);
        const omegaTesseronSupported = isTesseronSupportedShape(omega.shape?.type ?? state.omegaGeometryType ?? state.omegaType);
        setControlValue('sigil-menu-omega-tesseron', null, omega.shape.tesseron.enabled);
        setControlValue('sigil-menu-omega-tesseron-proportion', omega.shape.tesseron.proportion);
        setControlValue('sigil-menu-omega-tesseron-match', null, omega.shape.tesseron.matchMother);
        setControlDisabled('sigil-menu-omega-tesseron', !omegaTesseronSupported);
        setControlDisabled('sigil-menu-omega-tesseron-proportion', !omegaTesseronSupported || !omega.shape.tesseron.enabled);
        setControlDisabled('sigil-menu-omega-tesseron-match', !omegaTesseronSupported || !omega.shape.tesseron.enabled);
        setControlDisabled('sigil-menu-omega-stellation', omegaTesseronSupported && omega.shape.tesseron.enabled);
        setControlValue('sigil-menu-omega-scale', omega.scale ?? 1);
        setControlValue('sigil-menu-omega-stellation', omega.shape?.stellationFactor ?? 0);
        setControlValue('sigil-menu-omega-counterspin', null, omega.counterSpin);
        setControlValue('sigil-menu-omega-lock', null, omega.lockPosition);
        setControlValue('sigil-menu-trail-enabled', null, trail.enabled);
        setControlValue('sigil-menu-trail-length', trail.length ?? 20);
        setControlValue('sigil-menu-trail-opacity', trail.opacity ?? 0.5);
        setControlValue('sigil-menu-trail-fade', trail.fadeMs ?? 400);
        setControlValue('sigil-menu-trail-style', trail.style ?? 'omega');
        setControlValue('sigil-menu-cancel-radius', liveJs?.dragCancelRadius ?? state.dragCancelRadius ?? 40);
        setColorValue('sigil-menu-primary-color', colors.face?.[0]);
        setColorValue('sigil-menu-edge-color', colors.edge?.[0]);
        setColorValue('sigil-menu-face1', colors.face?.[0]);
        setColorValue('sigil-menu-face2', colors.face?.[1]);
        setColorValue('sigil-menu-edge1', colors.edge?.[0]);
        setColorValue('sigil-menu-edge2', colors.edge?.[1]);
        setColorValue('sigil-menu-aura1', colors.aura?.[0]);
        setColorValue('sigil-menu-aura2', colors.aura?.[1]);
        setColorValue('sigil-menu-lightning1', colors.lightning?.[0]);
        setColorValue('sigil-menu-lightning2', colors.lightning?.[1]);
        setColorValue('sigil-menu-magnetic1', colors.magnetic?.[0]);
        setColorValue('sigil-menu-magnetic2', colors.magnetic?.[1]);
        setColorValue('sigil-menu-grid1', colors.grid?.[0]);
        setColorValue('sigil-menu-grid2', colors.grid?.[1]);
        compactSurface?.refreshVisibility?.();
    }

    function clampToVisible(point) {
        return resolveContextMenuOrigin(point, {
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
        if (!menuState.open || !menuState.bounds || typeof projectPoint !== 'function') return;
        const local = projectPoint(menuState.bounds);
        if (!local) {
            anchor.style.display = 'none';
            return;
        }
        anchor.style.display = '';
        anchor.style.left = `${Math.round(local.x)}px`;
        anchor.style.top = `${Math.round(local.y)}px`;
    }

    function surfaceBounds() {
        if (!menuState.bounds) return null;
        const surfaceRect = anchor.querySelector('.sigil-avatar-control-surface')?.getBoundingClientRect?.();
        if (!surfaceRect || surfaceRect.width <= 0 || surfaceRect.height <= 0) return { ...menuState.bounds };
        const anchorRect = anchor.getBoundingClientRect();
        return {
            x: menuState.bounds.x + (surfaceRect.left - anchorRect.left),
            y: menuState.bounds.y + (surfaceRect.top - anchorRect.top),
            w: surfaceRect.width,
            h: surfaceRect.height,
        };
    }

    function openAt(point) {
        if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y)) return null;
        syncFromState();
        const origin = clampToVisible(point);
        menuState.open = true;
        menuState.bounds = { x: origin.x, y: origin.y, w: MENU_WIDTH, h: MENU_HEIGHT };
        if (state) state.isMenuOpen = true;
        recordTrace('open', { point, origin, bounds: menuState.bounds });
        syncPosition();
        anchor.classList.add('visible');
        syncSnapshot();
        onBoundsChange?.(snapshot());
        void mountCompactSurface().then(() => {
            if (!menuState.open) return;
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
        if (!menuState.open) return;
        menuState.open = false;
        menuState.bounds = null;
        menuState.activeSlider = null;
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
    }

    function applySnapshot(next = {}) {
        const open = !!next.open;
        menuState.open = open;
        menuState.bounds = open && next.bounds ? { ...next.bounds } : null;
        menuState.activeSlider = null;
        interactionRouter.reset();
        if (state) state.isMenuOpen = open;
        if (!open) {
            compactSurface?.destroy?.();
            compactSurface = null;
            compactValueCache.clear();
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
            if (!menuState.open) return;
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
        const target = elementAt(point);
        if (target && elementContains(anchor, target)) return true;
        const b = surfaceBounds() || menuState.bounds;
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
        return findContextMenuElementAt(anchor, local, document);
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
            const b = surfaceBounds() || menuState.bounds;
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
        const scroll = contextMenuSurfaceScrollDelta(event);
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

    function handleMenuPointer(event) {
        const kind = event.type;
        const point = event.point;
        if (kind === 'scroll_wheel') return scrollSurfaceAt(point, event);
        if (menuState.activeSlider && (kind === 'left_mouse_dragged' || kind === 'mouse_moved' || kind === 'left_mouse_up')) {
            const active = menuState.activeSlider;
            const handled = updateCompactSliderAt(active.sliderRoot, point, { commit: kind === 'left_mouse_up' });
            if (kind === 'left_mouse_up') menuState.activeSlider = null;
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
            menuState.activeSlider = { sliderRoot };
            return updateCompactSliderAt(sliderRoot, point);
        }

        if (kind === 'left_mouse_up') {
            if (sliderRoot) {
                menuState.activeSlider = null;
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
        id: 'sigil-context-menu',
        priority: 100,
        contains: containsDesktopPoint,
        onPointer: handleMenuPointer,
    });

    function handlePointerEvent(kind, point, options = {}) {
        if (!menuState.open) return false;
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

    return {
        openAt,
        close,
        isOpen() {
            return menuState.open;
        },
        bounds() {
            return menuState.bounds ? { ...menuState.bounds } : null;
        },
        interactiveBounds() {
            return surfaceBounds() || (menuState.bounds ? { ...menuState.bounds } : null);
        },
        updateSegmentPosition: syncPosition,
        containsDesktopPoint,
        handlePointerEvent,
        applySnapshot,
        snapshot,
    };
}
