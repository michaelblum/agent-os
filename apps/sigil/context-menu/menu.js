const TOOLKIT_RUNTIME_BASE = (
    typeof window !== 'undefined'
    && typeof location !== 'undefined'
    && /^https?:$/.test(location.protocol)
)
    ? '/toolkit/runtime'
    : (
        typeof location !== 'undefined'
        && location.protocol === 'aos:'
    )
        ? 'aos://toolkit/runtime'
        : '../../../packages/toolkit/runtime';

const { createStackMenu } = await import(`${TOOLKIT_RUNTIME_BASE}/stack-menu.js`);
const { createDesktopWorldInteractionRouter } = await import(`${TOOLKIT_RUNTIME_BASE}/interaction-region.js`);
const {
    createDesktopWorldRangeDrag,
    updateDesktopWorldRangeDrag,
} = await import(`${TOOLKIT_RUNTIME_BASE}/range-drag.js`);
import {
    DEFAULT_FAST_TRAVEL_EFFECT,
    FAST_TRAVEL_EFFECTS,
    normalizeFastTravelEffect,
} from '../renderer/transition-registry.js';
import { isTesseronSupportedShape, normalizeTesseronConfig } from '../renderer/tesseron.js';

const MENU_WIDTH = 292;
const MENU_HEIGHT = 448;
const MENU_OFFSET = 18;
const REF_BASE = 300;
const REF_SCALE = 1.1;
const REF_HEIGHT = 1080;
const GEOMETRY_OPTIONS = [
    [4, 'Tetrahedron'],
    [6, 'Hexahedron'],
    [8, 'Octahedron'],
    [12, 'Dodecahedron'],
    [20, 'Icosahedron'],
    [90, 'Tetartoid'],
    [91, 'Torus Knot'],
    [92, 'Torus'],
    [93, 'Prism'],
    [100, 'Sphere'],
];
const LINE_TRAIL_MODES = [
    ['fade', 'Fade'],
    ['shrink', 'Shrink'],
    ['edgeScatter', 'Edge Scatter'],
    ['vertexDissolve', 'Vertex Dissolve'],
    ['scaleWarp', 'Scale Warp'],
];

function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
}

function computeBaseScale(base) {
    const viewportHeight = typeof window !== 'undefined' && Number.isFinite(window.innerHeight)
        ? Math.max(1, window.innerHeight)
        : REF_HEIGHT;
    return (base / REF_BASE) * REF_SCALE * (REF_HEIGHT / viewportHeight);
}

function geometryOptions() {
    return GEOMETRY_OPTIONS
        .map(([value, label]) => `<option value="${value}">${label}</option>`)
        .join('');
}

function fastTravelEffectButtons() {
    return FAST_TRAVEL_EFFECTS
        .map((effect) => `<button type="button" role="radio" aria-checked="false" data-sigil-fast-travel-effect="${effect.id}">${effect.label}</button>`)
        .join('');
}

function lineTrailModeButtons() {
    return LINE_TRAIL_MODES
        .map(([value, label]) => `<button type="button" role="radio" aria-checked="false" data-sigil-line-trail-mode="${value}">${label}</button>`)
        .join('');
}

function optionButtons(options) {
    return options
        .map(([value, label]) => `<option value="${value}">${label}</option>`)
        .join('');
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
    if (viewportHit && anchor.contains(viewportHit)) return viewportHit;

    const candidates = Array.from(anchor.querySelectorAll(
        'input, select, button, label.checkbox-label, .ctx-select-popover, .ctx-menu-card.active, .ctx-menu-card.pushed'
    ));
    for (let i = candidates.length - 1; i >= 0; i -= 1) {
        const element = candidates[i];
        const card = element.closest?.('.ctx-menu-card');
        if (card && !card.classList.contains('active') && !card.classList.contains('pushed')) {
            continue;
        }
        const rect = element.getBoundingClientRect?.();
        if (rectContainsPoint(rect, point)) return element;
    }
    return null;
}

function subHeader(title) {
    return `
        <div class="ctx-sub-header">
            <button type="button" class="ctx-back" data-ctx-back aria-label="Back to parent"></button>
            <h3>${title}</h3>
        </div>`;
}

function controlRow(label, id, min, max, step, value) {
    return `
        <label for="${id}">${label}</label>
        <div class="ctx-range-row">
            <input type="range" id="${id}" min="${min}" max="${max}" step="${step}" value="${value}" aria-describedby="${id}-value">
            <span class="ctx-value" id="${id}-value" data-value-for="${id}">${value}</span>
        </div>`;
}

export function menuMarkup() {
    return `
    <div id="sigil-context-menu" class="ctx-anchor sigil-context-menu" role="dialog" aria-modal="false" aria-label="Sigil avatar context menu" aria-hidden="true">
        <div id="sigil-menu-root" class="ctx-menu-card active" role="region" aria-label="Sigil context menu root">
            <div class="ctx-tabs" role="tablist" aria-label="Sigil context menu sections">
                <button id="sigil-menu-tab-shape" class="ctx-tab active" role="tab" aria-label="Shape" aria-selected="true" aria-controls="sigil-menu-shape" data-ctx-tab="sigil-menu-shape" title="Shape">
                    <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="3" width="12" height="12"></rect><rect x="9" y="9" width="12" height="12"></rect><line x1="3" y1="3" x2="9" y2="9"></line><line x1="15" y1="3" x2="21" y2="9"></line><line x1="3" y1="15" x2="9" y2="21"></line><line x1="15" y1="15" x2="21" y2="21"></line></svg>
                </button>
                <button id="sigil-menu-tab-look" class="ctx-tab" role="tab" aria-label="Look" aria-selected="false" aria-controls="sigil-menu-look" data-ctx-tab="sigil-menu-look" title="Look">
                    <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="10"></circle><path d="M12 2v10l8.5-5.5"></path><path d="M12 12l-8.5 5.5"></path><path d="M12 12l-8.5-5.5"></path><path d="M12 12v10"></path><path d="M12 12l8.5 5.5"></path></svg>
                </button>
                <button id="sigil-menu-tab-effects" class="ctx-tab" role="tab" aria-label="Effects" aria-selected="false" aria-controls="sigil-menu-effects" data-ctx-tab="sigil-menu-effects" title="Effects">
                    <svg viewBox="0 0 24 24" aria-hidden="true"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>
                </button>
                <button id="sigil-menu-tab-world" class="ctx-tab" role="tab" aria-label="World" aria-selected="false" aria-controls="sigil-menu-world" data-ctx-tab="sigil-menu-world" title="World">
                    <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="2"></rect><line x1="3" y1="9" x2="21" y2="9"></line><line x1="3" y1="15" x2="21" y2="15"></line><line x1="9" y1="3" x2="9" y2="21"></line><line x1="15" y1="3" x2="15" y2="21"></line></svg>
                </button>
            </div>

            <div id="sigil-menu-shape" class="ctx-panel active" role="tabpanel" aria-labelledby="sigil-menu-tab-shape">
                <div class="ctx-heading-row">
                    <h3>Shape</h3>
                    <div class="ctx-segmented" role="radiogroup" aria-label="Shape target">
                        <button type="button" role="radio" aria-checked="true" class="active" data-sigil-shape-scope="alpha">Alpha</button>
                        <button type="button" role="radio" aria-checked="false" data-sigil-shape-scope="omega">Omega</button>
                    </div>
                </div>
                <div class="ctx-shape-scope active" role="group" aria-label="Alpha shape controls" data-sigil-shape-panel="alpha">
                    <label for="sigil-menu-shape-select">Geometry</label>
                    <select id="sigil-menu-shape-select">
                        ${geometryOptions()}
                    </select>
                    ${controlRow('Mother Scale', 'sigil-menu-mother-scale', 40, 400, 1, 153)}
                    <label class="checkbox-label"><input type="checkbox" id="sigil-menu-tesseron"> Tesseron</label>
                    ${controlRow('Child Proportion', 'sigil-menu-tesseron-proportion', 0.12, 0.9, 0.01, 0.5)}
                    <label class="checkbox-label"><input type="checkbox" id="sigil-menu-tesseron-match"> Match Mother</label>
                    ${controlRow('Stellation', 'sigil-menu-stellation', -1, 2, 0.05, 0)}
                    ${controlRow('Face Opacity', 'sigil-menu-opacity', 0, 1, 0.01, 0.8)}
                    ${controlRow('Edge Opacity', 'sigil-menu-edge-opacity', 0, 1, 0.01, 0.6)}
                    <div class="ctx-row">
                        <label class="checkbox-label"><input type="checkbox" id="sigil-menu-xray"> X-Ray</label>
                        <label class="checkbox-label"><input type="checkbox" id="sigil-menu-specular"> Specular</label>
                    </div>
                </div>
                <div class="ctx-shape-scope" role="group" aria-label="Omega shape controls" data-sigil-shape-panel="omega" aria-hidden="true">
                    <label class="checkbox-label"><input type="checkbox" id="sigil-menu-omega-enabled"> Enable Omega</label>
                    <label for="sigil-menu-omega-shape">Geometry</label>
                    <select id="sigil-menu-omega-shape">
                        ${geometryOptions()}
                    </select>
                    <label class="checkbox-label"><input type="checkbox" id="sigil-menu-omega-tesseron"> Tesseron</label>
                    ${controlRow('Child Proportion', 'sigil-menu-omega-tesseron-proportion', 0.12, 0.9, 0.01, 0.5)}
                    <label class="checkbox-label"><input type="checkbox" id="sigil-menu-omega-tesseron-match"> Match Mother</label>
                    ${controlRow('Scale', 'sigil-menu-omega-scale', 0.1, 5, 0.05, 1)}
                    ${controlRow('Stellation', 'sigil-menu-omega-stellation', -1, 2, 0.05, 0)}
                    <div class="ctx-row">
                        <label class="checkbox-label"><input type="checkbox" id="sigil-menu-omega-counterspin"> Counter Spin</label>
                        <label class="checkbox-label"><input type="checkbox" id="sigil-menu-omega-lock"> Lock Pos</label>
                    </div>
                </div>
            </div>

            <div id="sigil-menu-look" class="ctx-panel" role="tabpanel" aria-labelledby="sigil-menu-tab-look" aria-hidden="true">
                <h3>Appearance</h3>
                <label for="sigil-menu-primary-color">Primary Color</label>
                <input type="color" id="sigil-menu-primary-color" value="#4488ff">
                <label for="sigil-menu-edge-color">Edge Color</label>
                <input type="color" id="sigil-menu-edge-color" value="#ffffff">
                <div class="ctx-divider"></div>
                <button class="ctx-trigger" data-ctx-open="sigil-menu-core-colors">Core Colors</button>
                <button class="ctx-trigger" data-ctx-open="sigil-menu-effect-colors">Effect Colors</button>
            </div>

            <div id="sigil-menu-effects" class="ctx-panel" role="tabpanel" aria-labelledby="sigil-menu-tab-effects" aria-hidden="true">
                <h3>Effects</h3>
                <div class="ctx-row">
                    <label class="checkbox-label"><input type="checkbox" id="sigil-menu-pulsar"> Pulsar</label>
                    <label class="checkbox-label"><input type="checkbox" id="sigil-menu-accretion"> Accretion</label>
                </div>
                <div class="ctx-row">
                    <label class="checkbox-label"><input type="checkbox" id="sigil-menu-gamma"> Gamma</label>
                    <label class="checkbox-label"><input type="checkbox" id="sigil-menu-neutrino"> Neutrino</label>
                </div>
                <div class="ctx-row">
                    <label class="checkbox-label"><input type="checkbox" id="sigil-menu-lightning"> Lightning</label>
                    <label class="checkbox-label"><input type="checkbox" id="sigil-menu-magnetic"> Magnetic</label>
                </div>
                <div class="ctx-divider"></div>
                ${controlRow('Aura Reach', 'sigil-menu-aura-reach', 0, 3, 0.01, 1)}
                ${controlRow('Aura Intensity', 'sigil-menu-aura-intensity', 0, 3, 0.01, 1)}
                ${controlRow('Spin Speed', 'sigil-menu-spin', 0, 0.1, 0.001, 0.01)}
                <div class="ctx-section">
                    <div class="ctx-section-title">Travel</div>
                    <label class="checkbox-label"><input type="checkbox" id="sigil-menu-line-interdim"> Line Inter-dimensional Trail</label>
                    <div id="sigil-menu-fast-travel-effect-label" class="ctx-field-label">Mode</div>
                    <div class="ctx-segmented ctx-segmented-wide" role="radiogroup" aria-labelledby="sigil-menu-fast-travel-effect-label">
                        ${fastTravelEffectButtons()}
                    </div>
                </div>
                <div class="ctx-divider"></div>
                <button class="ctx-trigger" data-ctx-open="sigil-menu-line-card">Line Trail Settings</button>
                <button class="ctx-trigger" data-ctx-open="sigil-menu-wormhole-card">Wormhole Settings</button>
                <button class="ctx-trigger" data-ctx-open="sigil-menu-lightning-card">Lightning Settings</button>
                <button class="ctx-trigger" data-ctx-open="sigil-menu-magnetic-card">Magnetic Settings</button>
                <button class="ctx-trigger" data-ctx-open="sigil-menu-path-card">Path & Trail</button>
            </div>

            <div id="sigil-menu-world" class="ctx-panel" role="tabpanel" aria-labelledby="sigil-menu-tab-world" aria-hidden="true">
                <h3>World</h3>
                <label for="sigil-menu-grid-mode">Grid Mode</label>
                <select id="sigil-menu-grid-mode">
                    <option value="off">Off</option>
                    <option value="flat">2D Flat</option>
                    <option value="3d">3D Volumetric</option>
                </select>
                ${controlRow('Menu Ring', 'sigil-menu-ring', 40, 260, 1, 120)}
                <label class="checkbox-label"><input type="checkbox" id="sigil-menu-avatar-above-menu"> Avatar Above Menu Bar</label>
                <div class="ctx-divider"></div>
                <button class="ctx-trigger" data-sigil-action="toggle-inspector">Canvas Inspector</button>
                <button class="ctx-trigger" data-sigil-action="toggle-trace">Interaction Trace</button>
                <button class="ctx-trigger" data-sigil-action="toggle-log">Console Log</button>
                <div class="ctx-divider"></div>
                <div class="ctx-actions">
                    <button class="ctx-action-text" data-sigil-avatar-action="copy" title="Copy avatar JSON">Copy</button>
                    <button class="ctx-action-text" data-sigil-avatar-action="save" title="Save avatar JSON">Save</button>
                    <button class="ctx-action-text" data-sigil-avatar-action="import" title="Import avatar JSON">Import</button>
                </div>
            </div>
        </div>

        <div id="sigil-menu-core-colors" class="ctx-menu-card ctx-sub" role="region" aria-label="Core colors" aria-hidden="true">
            ${subHeader('Core Colors')}
            <div class="ctx-field-label">Faces</div>
            <div class="ctx-color-row"><input type="color" id="sigil-menu-face1"><input type="color" id="sigil-menu-face2"></div>
            <div class="ctx-field-label">Edges</div>
            <div class="ctx-color-row"><input type="color" id="sigil-menu-edge1"><input type="color" id="sigil-menu-edge2"></div>
            <div class="ctx-field-label">Aura</div>
            <div class="ctx-color-row"><input type="color" id="sigil-menu-aura1"><input type="color" id="sigil-menu-aura2"></div>
        </div>

        <div id="sigil-menu-effect-colors" class="ctx-menu-card ctx-sub" role="region" aria-label="Effect colors" aria-hidden="true">
            ${subHeader('Effect Colors')}
            <div class="ctx-field-label">Lightning</div>
            <div class="ctx-color-row"><input type="color" id="sigil-menu-lightning1"><input type="color" id="sigil-menu-lightning2"></div>
            <div class="ctx-field-label">Magnetic</div>
            <div class="ctx-color-row"><input type="color" id="sigil-menu-magnetic1"><input type="color" id="sigil-menu-magnetic2"></div>
            <div class="ctx-field-label">Grid</div>
            <div class="ctx-color-row"><input type="color" id="sigil-menu-grid1"><input type="color" id="sigil-menu-grid2"></div>
        </div>

        <div id="sigil-menu-lightning-card" class="ctx-menu-card ctx-sub" role="region" aria-label="Lightning settings" aria-hidden="true">
            ${subHeader('Lightning')}
            <label class="checkbox-label"><input type="checkbox" id="sigil-menu-lightning-origin-center"> Origin at Center</label>
            <label class="checkbox-label"><input type="checkbox" id="sigil-menu-lightning-solid-block"> Solid Block</label>
            ${controlRow('Length', 'sigil-menu-lightning-length', 10, 240, 1, 100)}
            ${controlRow('Frequency', 'sigil-menu-lightning-frequency', 0, 8, 0.1, 2)}
            ${controlRow('Duration', 'sigil-menu-lightning-duration', 0.1, 5, 0.1, 0.8)}
            ${controlRow('Branching', 'sigil-menu-lightning-branching', 0, 0.5, 0.01, 0.08)}
            ${controlRow('Brightness', 'sigil-menu-lightning-brightness', 0.1, 5, 0.1, 1)}
        </div>

        <div id="sigil-menu-magnetic-card" class="ctx-menu-card ctx-sub" role="region" aria-label="Magnetic settings" aria-hidden="true">
            ${subHeader('Magnetic')}
            ${controlRow('Tentacles', 'sigil-menu-magnetic-count', 0, 40, 1, 10)}
            ${controlRow('Speed', 'sigil-menu-magnetic-speed', 0, 4, 0.05, 1)}
            ${controlRow('Wander', 'sigil-menu-magnetic-wander', 0, 8, 0.1, 3)}
        </div>

        <div id="sigil-menu-line-card" class="ctx-menu-card ctx-sub" role="region" aria-label="Line trail settings" aria-hidden="true">
            ${subHeader('Line Trail')}
            <label class="checkbox-label"><input type="checkbox" id="sigil-menu-line-trail-enabled"> Inter-dimensional Trail</label>
            ${controlRow('Travel Duration', 'sigil-menu-line-duration', 0.05, 1.2, 0.01, 0.22)}
            ${controlRow('Start Delay', 'sigil-menu-line-delay', 0, 0.8, 0.01, 0)}
            ${controlRow('Repeated Objects', 'sigil-menu-line-repeat-count', 0, 80, 1, 10)}
            ${controlRow('Object Lifetime', 'sigil-menu-line-repeat-duration', 0.1, 5, 0.05, 2)}
            ${controlRow('Object Delay', 'sigil-menu-line-lag', 0, 0.4, 0.005, 0.05)}
            ${controlRow('Object Scale', 'sigil-menu-line-scale', 0.1, 4, 0.05, 1.5)}
            <div id="sigil-menu-line-trail-effect-label" class="ctx-field-label">Trail Effect</div>
            <div class="ctx-segmented ctx-segmented-wide ctx-segmented-wrap" role="radiogroup" aria-labelledby="sigil-menu-line-trail-effect-label">
                ${lineTrailModeButtons()}
            </div>
        </div>

        <div id="sigil-menu-wormhole-card" class="ctx-menu-card ctx-sub" role="region" aria-label="Wormhole settings" aria-hidden="true">
            ${subHeader('Wormhole')}
            <label class="checkbox-label"><input type="checkbox" id="sigil-menu-wormhole-shading"> Shader Shading</label>
            <label class="checkbox-label"><input type="checkbox" id="sigil-menu-wormhole-object"> Travel Object</label>
            <label class="checkbox-label"><input type="checkbox" id="sigil-menu-wormhole-particles"> Wispy Particles</label>
            ${controlRow('Capture Radius', 'sigil-menu-wormhole-radius', 56, 220, 2, 96)}
            ${controlRow('Opening', 'sigil-menu-wormhole-implosion', 0.08, 3, 0.01, 1.5)}
            ${controlRow('Object Travel', 'sigil-menu-wormhole-transit', 0.1, 1.2, 0.01, 0.5)}
            ${controlRow('Closing', 'sigil-menu-wormhole-rebound', 0.12, 3, 0.01, 1.2)}
            ${controlRow('Pinch Strength', 'sigil-menu-wormhole-distortion', -3, 3, 0.01, 1.2)}
            ${controlRow('Twist', 'sigil-menu-wormhole-twist', -15, 15, 0.01, 3.14)}
            ${controlRow('Tunnel Zoom', 'sigil-menu-wormhole-zoom', 0.1, 10, 0.01, 3.5)}
            ${controlRow('Object Height', 'sigil-menu-wormhole-object-height', 0.05, 2, 0.01, 0.8)}
            ${controlRow('Object Spin', 'sigil-menu-wormhole-object-spin', 0, 12, 0.05, 4.5)}
            ${controlRow('Particle Density', 'sigil-menu-wormhole-particle-density', 0, 1, 0.01, 0.05)}
            ${controlRow('Tunnel Shadow', 'sigil-menu-wormhole-shadow', 0, 1, 0.01, 0.8)}
            ${controlRow('Surface Highlight', 'sigil-menu-wormhole-specular', 0, 2, 0.01, 0.4)}
            ${controlRow('Light Angle', 'sigil-menu-wormhole-light-angle', 0, 6.283, 0.001, 2.35)}
            ${controlRow('Flash', 'sigil-menu-wormhole-flash', 0, 5, 0.01, 1.5)}
            ${controlRow('White Point', 'sigil-menu-wormhole-white', 0.1, 2, 0.01, 1)}
            ${controlRow('Starburst', 'sigil-menu-wormhole-starburst', 0, 2, 0.01, 0.95)}
            ${controlRow('Lens Flare', 'sigil-menu-wormhole-lens', 0, 2, 0.01, 0.8)}
        </div>

        <div id="sigil-menu-path-card" class="ctx-menu-card ctx-sub" role="region" aria-label="Path and trail settings" aria-hidden="true">
            ${subHeader('Path & Trail')}
            <label class="checkbox-label"><input type="checkbox" id="sigil-menu-trail-enabled"> Trail</label>
            ${controlRow('Trail Length', 'sigil-menu-trail-length', 0, 120, 1, 20)}
            ${controlRow('Trail Opacity', 'sigil-menu-trail-opacity', 0, 1, 0.01, 0.5)}
            ${controlRow('Trail Fade', 'sigil-menu-trail-fade', 100, 2000, 50, 400)}
            <label for="sigil-menu-trail-style">Trail Style</label>
            <select id="sigil-menu-trail-style">
                <option value="omega">Omega</option>
                <option value="soft">Soft</option>
            </select>
            ${controlRow('Drag Cancel Radius', 'sigil-menu-cancel-radius', 10, 120, 1, 40)}
        </div>
    </div>`;
}

export function createSigilContextMenu({
    state,
    liveJs,
    projectPoint,
    updateGeometry,
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
} = {}) {
    const layer = document.createElement('div');
    layer.className = 'sigil-context-menu-layer';
    layer.innerHTML = menuMarkup();
    document.body.appendChild(layer);

    const anchor = layer.querySelector('#sigil-context-menu');
    let menuState = {
        open: false,
        bounds: null,
        activeRange: null,
        snapshot: null,
    };
    let selectPopover = null;
    const interactionRouter = createDesktopWorldInteractionRouter({
        onOutsidePointer(event) {
            if (event.phase === 'up') close('outside-click');
            return true;
        },
    });
    let stack = null;
    stack = createStackMenu(anchor, {
        rootId: 'sigil-menu-root',
        onChange: () => syncSnapshot(),
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

    function syncSnapshot() {
        syncAccessibilityState();
        if (!stack) return;
        menuState.snapshot = stack.snapshot();
        if (liveJs) liveJs.contextMenu = snapshot();
    }

    function syncAccessibilityState() {
        anchor.setAttribute('aria-hidden', menuState.open ? 'false' : 'true');
        anchor.querySelectorAll('.ctx-menu-card').forEach((card) => {
            const visible = card.classList.contains('active') || card.classList.contains('pushed');
            card.setAttribute('aria-hidden', visible ? 'false' : 'true');
        });
        anchor.querySelectorAll('.ctx-panel').forEach((panel) => {
            panel.setAttribute('aria-hidden', panel.classList.contains('active') ? 'false' : 'true');
        });
        anchor.querySelectorAll('[data-ctx-tab]').forEach((tab) => {
            const active = tab.classList.contains('active');
            tab.setAttribute('aria-selected', active ? 'true' : 'false');
            tab.setAttribute('tabindex', active ? '0' : '-1');
        });
        anchor.querySelectorAll('.ctx-trigger[data-ctx-open]').forEach((trigger) => {
            const target = anchor.querySelector(`#${trigger.dataset.ctxOpen}`);
            const expanded = !!target && target.classList.contains('active');
            trigger.setAttribute('aria-haspopup', 'true');
            trigger.setAttribute('aria-expanded', expanded ? 'true' : 'false');
        });
        anchor.querySelectorAll('[data-sigil-shape-scope]').forEach((button) => {
            button.setAttribute('aria-checked', button.classList.contains('active') ? 'true' : 'false');
        });
        anchor.querySelectorAll('[data-sigil-shape-panel]').forEach((panel) => {
            panel.setAttribute('aria-hidden', panel.classList.contains('active') ? 'false' : 'true');
        });
        anchor.querySelectorAll('[data-sigil-fast-travel-effect], [data-sigil-line-trail-mode]').forEach((button) => {
            button.setAttribute('aria-checked', button.classList.contains('active') ? 'true' : 'false');
        });
        anchor.querySelectorAll('select').forEach((select) => {
            select.setAttribute('aria-expanded', selectPopover?.selectId === select.id ? 'true' : 'false');
        });
    }

    function snapshot() {
        return {
            open: menuState.open,
            bounds: menuState.bounds ? { ...menuState.bounds } : null,
            stack: menuState.snapshot,
        };
    }

    function setValueLabel(id, value) {
        const label = layer.querySelector(`[data-value-for="${id}"]`);
        if (!label) return;
        const n = Number(value);
        label.textContent = Number.isFinite(n) && Math.abs(n) < 10
            ? n.toFixed(id.includes('spin') ? 3 : 2)
            : String(value);
    }

    function setControlValue(id, value, checked = null) {
        const el = layer.querySelector(`#${id}`);
        if (!el) return;
        if (checked !== null && 'checked' in el) el.checked = !!checked;
        else el.value = value;
        setValueLabel(id, el.value);
    }

    function setControlDisabled(id, disabled) {
        const el = layer.querySelector(`#${id}`);
        if (!el) return;
        el.disabled = !!disabled;
    }

    function setColorValue(id, value) {
        const el = layer.querySelector(`#${id}`);
        if (!el || typeof value !== 'string') return;
        el.value = value;
    }

    function setSegmentedChoice(selector, activeValue) {
        layer.querySelectorAll(selector).forEach((button) => {
            const value = button.dataset.sigilFastTravelEffect
                ?? button.dataset.sigilLineTrailMode
                ?? button.dataset.value;
            button.classList.toggle('active', value === activeValue);
            button.setAttribute('aria-checked', value === activeValue ? 'true' : 'false');
        });
    }

    function closeSelectPopover(reason = 'close') {
        if (!selectPopover) return;
        const { element, selectId } = selectPopover;
        element.remove();
        selectPopover = null;
        const select = selectId ? anchor.querySelector(`#${selectId}`) : null;
        if (select) select.setAttribute('aria-expanded', 'false');
        recordTrace('select-close', { reason, selectId });
        syncSnapshot();
    }

    function syncSelectPopover() {
        if (!selectPopover) return;
        const select = anchor.querySelector(`#${selectPopover.selectId}`);
        if (!select) {
            closeSelectPopover('missing-select');
            return;
        }
        selectPopover.element.querySelectorAll('[data-ctx-select-option]').forEach((button) => {
            const selected = button.dataset.ctxSelectOption === select.value;
            button.classList.toggle('active', selected);
            button.setAttribute('aria-selected', selected ? 'true' : 'false');
        });
    }

    function openSelectPopover(select) {
        if (!select || select.disabled) return;
        if (selectPopover?.selectId === select.id) {
            closeSelectPopover('toggle');
            return;
        }
        closeSelectPopover('switch-select');
        const popover = document.createElement('div');
        popover.className = 'ctx-select-popover';
        popover.setAttribute('role', 'listbox');
        popover.dataset.ctxSelectFor = select.id;
        popover.setAttribute('aria-label', select.getAttribute('aria-label') || select.id || 'Select option');
        Array.from(select.options).forEach((option) => {
            const button = document.createElement('button');
            button.type = 'button';
            button.dataset.ctxSelectOption = option.value;
            button.setAttribute('role', 'option');
            button.textContent = option.textContent || option.value;
            if (option.disabled) button.disabled = true;
            button.addEventListener('click', (event) => {
                event.preventDefault();
                event.stopPropagation();
                if (button.disabled) return;
                select.value = button.dataset.ctxSelectOption;
                select.dispatchEvent(new Event('change', { bubbles: true }));
                recordTrace('select-option', { id: select.id, value: select.value });
                closeSelectPopover('selected');
                syncSnapshot();
            });
            popover.appendChild(button);
        });
        select.insertAdjacentElement('afterend', popover);
        selectPopover = { selectId: select.id, element: popover };
        syncSelectPopover();
        recordTrace('select-open', { id: select.id, value: select.value, count: select.options.length });
        syncSnapshot();
    }

    function syncFromState() {
        if (!state) return;
        setControlValue('sigil-menu-shape-select', state.currentGeometryType ?? state.currentType);
        setControlValue('sigil-menu-mother-scale', state.avatarBase ?? 153);
        state.tesseron = normalizeTesseronConfig(state.tesseron);
        const tesseronSupported = isTesseronSupportedShape(state.currentGeometryType ?? state.currentType);
        setControlValue('sigil-menu-tesseron', null, state.tesseron.enabled);
        setControlValue('sigil-menu-tesseron-proportion', state.tesseron.proportion);
        setControlValue('sigil-menu-tesseron-match', null, state.tesseron.matchMother);
        setControlDisabled('sigil-menu-tesseron', !tesseronSupported);
        setControlDisabled('sigil-menu-tesseron-proportion', !tesseronSupported || !state.tesseron.enabled);
        setControlDisabled('sigil-menu-tesseron-match', !tesseronSupported || !state.tesseron.enabled);
        setControlDisabled('sigil-menu-stellation', tesseronSupported && state.tesseron.enabled);
        setControlValue('sigil-menu-stellation', state.stellationFactor ?? 0);
        setControlValue('sigil-menu-opacity', state.currentOpacity ?? 0.8);
        setControlValue('sigil-menu-edge-opacity', state.currentEdgeOpacity ?? 0.6);
        setControlValue('sigil-menu-xray', null, state.isInteriorEdgesEnabled);
        setControlValue('sigil-menu-specular', null, state.isSpecularEnabled);
        setControlValue('sigil-menu-aura-reach', state.auraReach ?? 1);
        setControlValue('sigil-menu-aura-intensity', state.auraIntensity ?? 1);
        setControlValue('sigil-menu-spin', state.idleSpinSpeed ?? 0.01);
        setControlValue('sigil-menu-ring', state.menuRingRadius ?? 120);
        setControlValue('sigil-menu-avatar-above-menu', null, state.avatarWindowLevel === 'screen_saver');
        setControlValue('sigil-menu-pulsar', null, state.isPulsarEnabled);
        setControlValue('sigil-menu-accretion', null, state.isAccretionEnabled);
        setControlValue('sigil-menu-gamma', null, state.isGammaEnabled);
        setControlValue('sigil-menu-neutrino', null, state.isNeutrinosEnabled);
        setControlValue('sigil-menu-lightning', null, state.isLightningEnabled);
        setControlValue('sigil-menu-magnetic', null, state.isMagneticEnabled);
        setControlValue('sigil-menu-line-interdim', null, state.fastTravelLineInterDimensional ?? true);
        setControlValue('sigil-menu-line-trail-enabled', null, state.fastTravelLineInterDimensional ?? true);
        setControlValue('sigil-menu-line-duration', state.fastTravelLineDuration ?? 0.22);
        setControlValue('sigil-menu-line-delay', state.fastTravelLineDelay ?? 0);
        setControlValue('sigil-menu-line-repeat-count', state.fastTravelLineRepeatCount ?? 10);
        setControlValue('sigil-menu-line-repeat-duration', state.fastTravelLineRepeatDuration ?? 2);
        setControlValue('sigil-menu-line-lag', state.fastTravelLineLag ?? 0.05);
        setControlValue('sigil-menu-line-scale', state.fastTravelLineScale ?? 1.5);
        setSegmentedChoice('[data-sigil-line-trail-mode]', state.fastTravelLineTrailMode ?? 'fade');
        setSegmentedChoice(
            '[data-sigil-fast-travel-effect]',
            normalizeFastTravelEffect(state.transitionFastTravelEffect, DEFAULT_FAST_TRAVEL_EFFECT)
        );
        setControlValue('sigil-menu-lightning-origin-center', null, state.lightningOriginCenter);
        setControlValue('sigil-menu-lightning-solid-block', null, state.lightningSolidBlock);
        setControlValue('sigil-menu-lightning-length', state.lightningBoltLength ?? 100);
        setControlValue('sigil-menu-lightning-frequency', state.lightningFrequency ?? 2);
        setControlValue('sigil-menu-lightning-duration', state.lightningDuration ?? 0.8);
        setControlValue('sigil-menu-lightning-branching', state.lightningBranching ?? 0.08);
        setControlValue('sigil-menu-lightning-brightness', state.lightningBrightness ?? 1);
        setControlValue('sigil-menu-magnetic-count', state.magneticTentacleCount ?? 10);
        setControlValue('sigil-menu-magnetic-speed', state.magneticTentacleSpeed ?? 1);
        setControlValue('sigil-menu-magnetic-wander', state.magneticWander ?? 3);
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
        setControlValue('sigil-menu-omega-enabled', null, state.isOmegaEnabled);
        setControlValue('sigil-menu-omega-shape', state.omegaGeometryType ?? state.omegaType ?? 4);
        state.omegaTesseron = normalizeTesseronConfig(state.omegaTesseron);
        const omegaTesseronSupported = isTesseronSupportedShape(state.omegaGeometryType ?? state.omegaType);
        setControlValue('sigil-menu-omega-tesseron', null, state.omegaTesseron.enabled);
        setControlValue('sigil-menu-omega-tesseron-proportion', state.omegaTesseron.proportion);
        setControlValue('sigil-menu-omega-tesseron-match', null, state.omegaTesseron.matchMother);
        setControlDisabled('sigil-menu-omega-tesseron', !omegaTesseronSupported);
        setControlDisabled('sigil-menu-omega-tesseron-proportion', !omegaTesseronSupported || !state.omegaTesseron.enabled);
        setControlDisabled('sigil-menu-omega-tesseron-match', !omegaTesseronSupported || !state.omegaTesseron.enabled);
        setControlDisabled('sigil-menu-omega-stellation', omegaTesseronSupported && state.omegaTesseron.enabled);
        setControlValue('sigil-menu-omega-scale', state.omegaScale ?? 1);
        setControlValue('sigil-menu-omega-stellation', state.omegaStellationFactor ?? 0);
        setControlValue('sigil-menu-omega-counterspin', null, state.omegaCounterSpin);
        setControlValue('sigil-menu-omega-lock', null, state.omegaLockPosition);
        setControlValue('sigil-menu-trail-enabled', null, state.isTrailEnabled);
        setControlValue('sigil-menu-trail-length', state.trailLength ?? 20);
        setControlValue('sigil-menu-trail-opacity', state.trailOpacity ?? 0.5);
        setControlValue('sigil-menu-trail-fade', state.trailFadeMs ?? 400);
        setControlValue('sigil-menu-trail-style', state.trailStyle ?? 'omega');
        setControlValue('sigil-menu-cancel-radius', liveJs?.dragCancelRadius ?? state.dragCancelRadius ?? 40);
        setColorValue('sigil-menu-primary-color', state.colors?.face?.[0]);
        setColorValue('sigil-menu-edge-color', state.colors?.edge?.[0]);
        setColorValue('sigil-menu-face1', state.colors?.face?.[0]);
        setColorValue('sigil-menu-face2', state.colors?.face?.[1]);
        setColorValue('sigil-menu-edge1', state.colors?.edge?.[0]);
        setColorValue('sigil-menu-edge2', state.colors?.edge?.[1]);
        setColorValue('sigil-menu-aura1', state.colors?.aura?.[0]);
        setColorValue('sigil-menu-aura2', state.colors?.aura?.[1]);
        setColorValue('sigil-menu-lightning1', state.colors?.lightning?.[0]);
        setColorValue('sigil-menu-lightning2', state.colors?.lightning?.[1]);
        setColorValue('sigil-menu-magnetic1', state.colors?.magnetic?.[0]);
        setColorValue('sigil-menu-magnetic2', state.colors?.magnetic?.[1]);
        setColorValue('sigil-menu-grid1', state.colors?.grid?.[0]);
        setColorValue('sigil-menu-grid2', state.colors?.grid?.[1]);
        syncSelectPopover();
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

    function openAt(point) {
        if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y)) return null;
        syncFromState();
        const origin = clampToVisible(point);
        menuState.open = true;
        menuState.bounds = { x: origin.x, y: origin.y, w: MENU_WIDTH, h: MENU_HEIGHT };
        if (state) state.isMenuOpen = true;
        recordTrace('open', { point, origin, bounds: menuState.bounds });
        syncPosition();
        stack.open({ x: parseFloat(anchor.style.left) || 0, y: parseFloat(anchor.style.top) || 0 });
        syncSnapshot();
        onBoundsChange?.(snapshot());
        return snapshot();
    }

    function close(reason = 'close') {
        if (!menuState.open) return;
        closeSelectPopover(reason);
        menuState.open = false;
        menuState.bounds = null;
        menuState.activeRange = null;
        interactionRouter.reset();
        if (state) state.isMenuOpen = false;
        stack.close(reason);
        syncSnapshot();
        const nextSnapshot = snapshot();
        recordTrace('close', { reason, snapshot: nextSnapshot });
        onBoundsChange?.(nextSnapshot);
        onClose?.({ reason, snapshot: nextSnapshot });
    }

    function applySnapshot(next = {}) {
        const open = !!next.open;
        closeSelectPopover('snapshot');
        menuState.open = open;
        menuState.bounds = open && next.bounds ? { ...next.bounds } : null;
        menuState.activeRange = null;
        interactionRouter.reset();
        if (state) state.isMenuOpen = open;
        if (!open) {
            stack.close('snapshot');
            syncSnapshot();
            return;
        }
        syncPosition();
        anchor.classList.add('visible');
        stack.applySnapshot(next.stack || {});
        syncSnapshot();
    }

    function visibleCardBounds() {
        if (!menuState.bounds) return null;
        const anchorRect = anchor.getBoundingClientRect();
        const cards = Array.from(anchor.querySelectorAll('.ctx-menu-card.active, .ctx-menu-card.pushed'))
            .map((card) => card.getBoundingClientRect())
            .filter((rect) => rect.width > 0 && rect.height > 0);
        if (cards.length === 0) return { ...menuState.bounds };

        const left = Math.min(...cards.map((rect) => rect.left));
        const top = Math.min(...cards.map((rect) => rect.top));
        const right = Math.max(...cards.map((rect) => rect.right));
        const bottom = Math.max(...cards.map((rect) => rect.bottom));
        return {
            x: menuState.bounds.x + (left - anchorRect.left),
            y: menuState.bounds.y + (top - anchorRect.top),
            w: right - left,
            h: bottom - top,
        };
    }

    function containsDesktopPoint(point) {
        if (!point) return false;
        const target = elementAt(point);
        if (target && anchor.contains(target)) return true;
        const b = visibleCardBounds() || menuState.bounds;
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

    function activeScrollableCard(target) {
        const targetCard = target?.closest?.('.ctx-menu-card.active, .ctx-menu-card.pushed');
        if (targetCard) return targetCard;
        return anchor.querySelector('.ctx-menu-card.active');
    }

    function scrollCardAt(point, event = {}) {
        const target = elementAt(point);
        let card = null;
        if (target && anchor.contains(target)) {
            card = activeScrollableCard(target);
        } else {
            const b = visibleCardBounds() || menuState.bounds;
            if (
                !b
                || point.x < b.x
                || point.y < b.y
                || point.x >= b.x + b.w
                || point.y >= b.y + b.h
            ) {
                return false;
            }
            card = activeScrollableCard(null);
        }
        if (!card) return false;
        const rawY = Number(event.dy ?? event.deltaY ?? event.scrollY ?? 0);
        const rawX = Number(event.dx ?? event.deltaX ?? event.scrollX ?? 0);
        if (!Number.isFinite(rawY) && !Number.isFinite(rawX)) return false;
        card.scrollTop += Number.isFinite(rawY) ? rawY : 0;
        card.scrollLeft += Number.isFinite(rawX) ? rawX : 0;
        recordTrace('scroll', {
            point,
            target: describeElement(target),
            card: describeElement(card),
            dx: rawX,
            dy: rawY,
            scrollTop: card.scrollTop,
            scrollLeft: card.scrollLeft,
        });
        syncSnapshot();
        return true;
    }

    function handleMenuPointer(event) {
        const kind = event.type;
        const point = event.point;
        if (kind === 'scroll_wheel') return scrollCardAt(point, event);
        const active = menuState.activeRange;
        if (active && (kind === 'left_mouse_dragged' || kind === 'mouse_moved')) {
            return updateDesktopWorldRangeDrag(active, point);
        }
        if (active && kind === 'left_mouse_up') {
            menuState.activeRange = null;
            return updateDesktopWorldRangeDrag(active, point, { commit: true });
        }

        if (kind !== 'left_mouse_down' && kind !== 'left_mouse_up') return true;

        const target = elementAt(point);
        if (!target || !anchor.contains(target)) {
            recordTrace('pointer:no-target', { kind, point, target: describeElement(target) });
            return true;
        }
        const input = target.closest?.('input, select, button, label.checkbox-label, .ctx-menu-card.pushed');
        recordTrace('pointer:target', {
            kind,
            point,
            target: describeElement(target),
            input: describeElement(input),
        });
        if (!input) return true;

        if (kind === 'left_mouse_down' && input.matches('input[type="range"]')) {
            menuState.activeRange = createDesktopWorldRangeDrag(input, {
                anchor,
                desktopBounds: menuState.bounds,
            });
            return updateDesktopWorldRangeDrag(menuState.activeRange, point);
        }

        if (kind === 'left_mouse_up') {
            if (input.matches('input[type="checkbox"]')) {
                closeSelectPopover('checkbox');
                input.checked = !input.checked;
                input.dispatchEvent(new Event('change', { bubbles: true }));
                recordTrace('checkbox-toggle', { id: input.id, checked: input.checked, via: 'input' });
                return true;
            }
            if (input.matches('label.checkbox-label')) {
                closeSelectPopover('checkbox-label');
                const checkbox = input.querySelector('input[type="checkbox"]');
                if (checkbox) {
                    checkbox.checked = !checkbox.checked;
                    checkbox.dispatchEvent(new Event('change', { bubbles: true }));
                    recordTrace('checkbox-toggle', { id: checkbox.id, checked: checkbox.checked, via: 'label' });
                }
                return true;
            }
            if (input.matches('select')) {
                openSelectPopover(input);
                return true;
            }
            if (input.matches('button, .ctx-menu-card.pushed')) {
                if (!input.closest?.('.ctx-select-popover')) closeSelectPopover('button');
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
        return interactionRouter.route(
            { type: kind, x: point.x, y: point.y, ...(options.raw || {}) },
            {
                source: options.assumeInside ? 'hit' : 'global',
                assumeInside: options.assumeInside,
                regionId: options.assumeInside ? 'sigil-context-menu' : undefined,
            }
        );
    }

    function bindControls() {
        const onRange = (id, setter) => {
            const el = layer.querySelector(`#${id}`);
            if (!el) return;
            el.addEventListener('input', () => {
                const value = Number(el.value);
                setValueLabel(id, value);
                setter?.(value);
                onAppearanceChange?.({ controlId: id, value });
            });
        };
        const onCheckbox = (id, setter) => {
            const el = layer.querySelector(`#${id}`);
            if (!el) return;
            el.addEventListener('change', () => {
                const value = !!el.checked;
                setter?.(value);
                onAppearanceChange?.({ controlId: id, value });
            });
        };
        const onSelect = (id, setter) => {
            const el = layer.querySelector(`#${id}`);
            if (!el) return;
            el.addEventListener('change', () => {
                const value = Number(el.value);
                setter?.(value);
                onAppearanceChange?.({ controlId: id, value });
            });
        };
        const onChoice = (id, setter) => {
            const el = layer.querySelector(`#${id}`);
            if (!el) return;
            el.addEventListener('change', () => {
                setter?.(el.value);
                onAppearanceChange?.({ controlId: id, value: el.value });
            });
        };
        const onColor = (id, colorKey, index) => {
            const el = layer.querySelector(`#${id}`);
            if (!el) return;
            el.addEventListener('input', () => {
                if (!state.colors[colorKey]) state.colors[colorKey] = ['#ffffff', '#ffffff'];
                state.colors[colorKey][index] = el.value;
                updateAllColors?.();
                onAppearanceChange?.({ controlId: id, value: el.value });
            });
        };
        const onAction = (action, handler) => {
            const el = layer.querySelector(`[data-sigil-action="${action}"]`);
            if (!el) return;
            el.addEventListener('click', (event) => {
                event.preventDefault();
                event.stopPropagation();
                handler?.();
            });
        };

        onRange('sigil-menu-stellation', (value) => {
            state.stellationFactor = value;
            updateGeometry?.(state.currentGeometryType ?? state.currentType);
        });
        onSelect('sigil-menu-shape-select', (value) => {
            state.currentGeometryType = value;
            state.currentType = value;
            const supported = isTesseronSupportedShape(value);
            setControlDisabled('sigil-menu-tesseron', !supported);
            setControlDisabled('sigil-menu-stellation', supported && !!state.tesseron?.enabled);
            updateGeometry?.(value);
        });
        onRange('sigil-menu-mother-scale', (value) => {
            state.avatarBase = value;
            state.baseScale = computeBaseScale(value);
        });
        onCheckbox('sigil-menu-tesseron', (value) => {
            state.tesseron = normalizeTesseronConfig(state.tesseron);
            state.tesseron.enabled = value;
            setControlDisabled('sigil-menu-stellation', value);
            setControlDisabled('sigil-menu-tesseron-proportion', !value);
            setControlDisabled('sigil-menu-tesseron-match', !value);
            updateGeometry?.(state.currentGeometryType ?? state.currentType);
        });
        onRange('sigil-menu-tesseron-proportion', (value) => {
            state.tesseron = normalizeTesseronConfig(state.tesseron);
            state.tesseron.proportion = value;
            updateGeometry?.(state.currentGeometryType ?? state.currentType);
        });
        onCheckbox('sigil-menu-tesseron-match', (value) => {
            state.tesseron = normalizeTesseronConfig(state.tesseron);
            state.tesseron.matchMother = value;
            if (!value) {
                state.tesseron.child.opacity ??= state.currentOpacity;
                state.tesseron.child.edgeOpacity ??= state.currentEdgeOpacity;
                state.tesseron.child.maskEnabled ??= state.isMaskEnabled;
                state.tesseron.child.interiorEdges ??= state.isInteriorEdgesEnabled;
                state.tesseron.child.specular ??= state.isSpecularEnabled;
            }
            updateGeometry?.(state.currentGeometryType ?? state.currentType);
        });
        onRange('sigil-menu-opacity', (value) => {
            state.currentOpacity = value;
            updateGeometry?.(state.currentGeometryType ?? state.currentType);
        });
        onRange('sigil-menu-edge-opacity', (value) => {
            state.currentEdgeOpacity = value;
            updateGeometry?.(state.currentGeometryType ?? state.currentType);
        });
        onCheckbox('sigil-menu-xray', (value) => {
            state.isInteriorEdgesEnabled = value;
            updateGeometry?.(state.currentGeometryType ?? state.currentType);
        });
        onCheckbox('sigil-menu-specular', (value) => {
            state.isSpecularEnabled = value;
            updateGeometry?.(state.currentGeometryType ?? state.currentType);
        });
        onRange('sigil-menu-aura-reach', (value) => { state.auraReach = value; });
        onRange('sigil-menu-aura-intensity', (value) => { state.auraIntensity = value; });
        onCheckbox('sigil-menu-pulsar', (value) => {
            state.isPulsarEnabled = value;
            if (value && state.pulsarRayCount <= 0) state.pulsarRayCount = 1;
            updatePulsars?.(state.pulsarRayCount);
        });
        onCheckbox('sigil-menu-accretion', (value) => {
            state.isAccretionEnabled = value;
            if (value && state.accretionDiskCount <= 0) state.accretionDiskCount = 1;
            updateAccretion?.(state.accretionDiskCount);
        });
        onCheckbox('sigil-menu-gamma', (value) => {
            state.isGammaEnabled = value;
            if (value && state.gammaRayCount <= 0) state.gammaRayCount = 3;
            updateGammaRays?.(state.gammaRayCount);
        });
        onCheckbox('sigil-menu-neutrino', (value) => {
            state.isNeutrinosEnabled = value;
            if (value && state.neutrinoJetCount <= 0) state.neutrinoJetCount = 1;
            updateNeutrinos?.(state.neutrinoJetCount);
        });
        onCheckbox('sigil-menu-lightning', (value) => { state.isLightningEnabled = value; });
        onCheckbox('sigil-menu-magnetic', (value) => { state.isMagneticEnabled = value; });
        onCheckbox('sigil-menu-line-interdim', (value) => {
            state.fastTravelLineInterDimensional = value;
            setControlValue('sigil-menu-line-trail-enabled', null, value);
        });
        onCheckbox('sigil-menu-line-trail-enabled', (value) => {
            state.fastTravelLineInterDimensional = value;
            setControlValue('sigil-menu-line-interdim', null, value);
        });
        onRange('sigil-menu-line-duration', (value) => { state.fastTravelLineDuration = value; });
        onRange('sigil-menu-line-delay', (value) => { state.fastTravelLineDelay = value; });
        onRange('sigil-menu-line-repeat-count', (value) => { state.fastTravelLineRepeatCount = value; });
        onRange('sigil-menu-line-repeat-duration', (value) => { state.fastTravelLineRepeatDuration = value; });
        onRange('sigil-menu-line-lag', (value) => { state.fastTravelLineLag = value; });
        onRange('sigil-menu-line-scale', (value) => { state.fastTravelLineScale = value; });
        layer.querySelectorAll('[data-sigil-line-trail-mode]').forEach((button) => {
            button.addEventListener('click', (event) => {
                event.preventDefault();
                event.stopPropagation();
                const value = button.dataset.sigilLineTrailMode || 'fade';
                state.fastTravelLineTrailMode = value;
                setSegmentedChoice('[data-sigil-line-trail-mode]', value);
                onAppearanceChange?.({ controlId: 'sigil-menu-line-trail-mode', value });
                syncSnapshot();
            });
        });
        layer.querySelectorAll('[data-sigil-fast-travel-effect]').forEach((button) => {
            button.addEventListener('click', (event) => {
                event.preventDefault();
                event.stopPropagation();
                const value = normalizeFastTravelEffect(button.dataset.sigilFastTravelEffect, DEFAULT_FAST_TRAVEL_EFFECT);
                state.transitionFastTravelEffect = value;
                setSegmentedChoice('[data-sigil-fast-travel-effect]', value);
                onAppearanceChange?.({ controlId: 'sigil-menu-fast-travel-effect', value });
                syncSnapshot();
            });
        });
        onCheckbox('sigil-menu-lightning-origin-center', (value) => { state.lightningOriginCenter = value; });
        onCheckbox('sigil-menu-lightning-solid-block', (value) => { state.lightningSolidBlock = value; });
        onRange('sigil-menu-lightning-length', (value) => { state.lightningBoltLength = value; });
        onRange('sigil-menu-lightning-frequency', (value) => { state.lightningFrequency = value; });
        onRange('sigil-menu-lightning-duration', (value) => { state.lightningDuration = value; });
        onRange('sigil-menu-lightning-branching', (value) => { state.lightningBranching = value; });
        onRange('sigil-menu-lightning-brightness', (value) => { state.lightningBrightness = value; });
        onRange('sigil-menu-magnetic-count', (value) => {
            updateMagneticTentacleCount?.(value);
        });
        onRange('sigil-menu-magnetic-speed', (value) => { state.magneticTentacleSpeed = value; });
        onRange('sigil-menu-magnetic-wander', (value) => { state.magneticWander = value; });
        onCheckbox('sigil-menu-wormhole-shading', (value) => { state.wormholeShadingEnabled = value; });
        onCheckbox('sigil-menu-wormhole-object', (value) => { state.wormholeObjectEnabled = value; });
        onCheckbox('sigil-menu-wormhole-particles', (value) => { state.wormholeParticlesEnabled = value; });
        onRange('sigil-menu-wormhole-radius', (value) => { state.wormholeCaptureRadius = value; });
        onRange('sigil-menu-wormhole-implosion', (value) => { state.wormholeImplosionDuration = value; });
        onRange('sigil-menu-wormhole-transit', (value) => { state.wormholeTravelDuration = value; });
        onRange('sigil-menu-wormhole-rebound', (value) => { state.wormholeReboundDuration = value; });
        onRange('sigil-menu-wormhole-distortion', (value) => { state.wormholeDistortionStrength = value; });
        onRange('sigil-menu-wormhole-twist', (value) => { state.wormholeTwist = value; });
        onRange('sigil-menu-wormhole-zoom', (value) => { state.wormholeZoom = value; });
        onRange('sigil-menu-wormhole-object-height', (value) => { state.wormholeObjectHeight = value; });
        onRange('sigil-menu-wormhole-object-spin', (value) => { state.wormholeObjectSpin = value; });
        onRange('sigil-menu-wormhole-particle-density', (value) => { state.wormholeParticleDensity = value; });
        onRange('sigil-menu-wormhole-shadow', (value) => { state.wormholeTunnelShadow = value; });
        onRange('sigil-menu-wormhole-specular', (value) => { state.wormholeSpecularIntensity = value; });
        onRange('sigil-menu-wormhole-light-angle', (value) => { state.wormholeLightAngle = value; });
        onRange('sigil-menu-wormhole-flash', (value) => { state.wormholeFlashIntensity = value; });
        onRange('sigil-menu-wormhole-white', (value) => { state.wormholeWhitePointIntensity = value; });
        onRange('sigil-menu-wormhole-starburst', (value) => { state.wormholeStarburstIntensity = value; });
        onRange('sigil-menu-wormhole-lens', (value) => { state.wormholeLensFlareIntensity = value; });
        onChoice('sigil-menu-grid-mode', (value) => { state.gridMode = value; });
        onRange('sigil-menu-ring', (value) => {
            state.menuRingRadius = value;
            if (liveJs) liveJs.menuRingRadius = value;
        });
        onCheckbox('sigil-menu-avatar-above-menu', (value) => {
            const level = value ? 'screen_saver' : 'status_bar';
            state.avatarWindowLevel = level;
            onAvatarWindowLevelChange?.(level);
        });
        onCheckbox('sigil-menu-omega-enabled', (value) => { state.isOmegaEnabled = value; });
        onSelect('sigil-menu-omega-shape', (value) => {
            state.omegaGeometryType = value;
            state.omegaType = value;
            const supported = isTesseronSupportedShape(value);
            setControlDisabled('sigil-menu-omega-tesseron', !supported);
            setControlDisabled('sigil-menu-omega-stellation', supported && !!state.omegaTesseron?.enabled);
            updateOmegaGeometry?.(value);
        });
        onCheckbox('sigil-menu-omega-tesseron', (value) => {
            state.omegaTesseron = normalizeTesseronConfig(state.omegaTesseron);
            state.omegaTesseron.enabled = value;
            setControlDisabled('sigil-menu-omega-stellation', value);
            setControlDisabled('sigil-menu-omega-tesseron-proportion', !value);
            setControlDisabled('sigil-menu-omega-tesseron-match', !value);
            updateOmegaGeometry?.(state.omegaGeometryType ?? state.omegaType);
        });
        onRange('sigil-menu-omega-tesseron-proportion', (value) => {
            state.omegaTesseron = normalizeTesseronConfig(state.omegaTesseron);
            state.omegaTesseron.proportion = value;
            updateOmegaGeometry?.(state.omegaGeometryType ?? state.omegaType);
        });
        onCheckbox('sigil-menu-omega-tesseron-match', (value) => {
            state.omegaTesseron = normalizeTesseronConfig(state.omegaTesseron);
            state.omegaTesseron.matchMother = value;
            updateOmegaGeometry?.(state.omegaGeometryType ?? state.omegaType);
        });
        onRange('sigil-menu-omega-stellation', (value) => {
            state.omegaStellationFactor = value;
            updateOmegaGeometry?.(state.omegaGeometryType ?? state.omegaType);
        });
        onRange('sigil-menu-omega-scale', (value) => { state.omegaScale = value; });
        onCheckbox('sigil-menu-omega-counterspin', (value) => { state.omegaCounterSpin = value; });
        onCheckbox('sigil-menu-omega-lock', (value) => { state.omegaLockPosition = value; });
        onCheckbox('sigil-menu-trail-enabled', (value) => { state.isTrailEnabled = value; });
        onRange('sigil-menu-trail-length', (value) => { state.trailLength = value; });
        onRange('sigil-menu-trail-opacity', (value) => { state.trailOpacity = value; });
        onRange('sigil-menu-trail-fade', (value) => { state.trailFadeMs = value; });
        onChoice('sigil-menu-trail-style', (value) => { state.trailStyle = value; });
        onRange('sigil-menu-cancel-radius', (value) => {
            state.dragCancelRadius = value;
            if (liveJs) liveJs.dragCancelRadius = value;
        });
        onColor('sigil-menu-primary-color', 'face', 0);
        onColor('sigil-menu-edge-color', 'edge', 0);
        onColor('sigil-menu-face1', 'face', 0);
        onColor('sigil-menu-face2', 'face', 1);
        onColor('sigil-menu-edge1', 'edge', 0);
        onColor('sigil-menu-edge2', 'edge', 1);
        onColor('sigil-menu-aura1', 'aura', 0);
        onColor('sigil-menu-aura2', 'aura', 1);
        onColor('sigil-menu-lightning1', 'lightning', 0);
        onColor('sigil-menu-lightning2', 'lightning', 1);
        onColor('sigil-menu-magnetic1', 'magnetic', 0);
        onColor('sigil-menu-magnetic2', 'magnetic', 1);
        onColor('sigil-menu-grid1', 'grid', 0);
        onColor('sigil-menu-grid2', 'grid', 1);
        onAction('toggle-inspector', () => onUtilityAction?.('canvas-inspector'));
        onAction('toggle-trace', () => onUtilityAction?.('sigil-interaction-trace'));
        onAction('toggle-log', () => onUtilityAction?.('log-console'));

        layer.querySelectorAll('[data-sigil-shape-scope]').forEach((button) => {
            button.addEventListener('click', (event) => {
                event.preventDefault();
                event.stopPropagation();
                const scope = button.dataset.sigilShapeScope || 'alpha';
                layer.querySelectorAll('[data-sigil-shape-scope]').forEach((entry) => {
                    entry.classList.toggle('active', entry === button);
                    entry.setAttribute('aria-checked', entry === button ? 'true' : 'false');
                });
                layer.querySelectorAll('[data-sigil-shape-panel]').forEach((panel) => {
                    panel.classList.toggle('active', panel.dataset.sigilShapePanel === scope);
                    panel.setAttribute('aria-hidden', panel.dataset.sigilShapePanel === scope ? 'false' : 'true');
                });
                syncSnapshot();
            });
        });

        layer.querySelectorAll('[data-sigil-avatar-action]').forEach((button) => {
            button.addEventListener('click', (event) => {
                event.preventDefault();
                event.stopPropagation();
                const action = button.dataset.sigilAvatarAction;
                Promise.resolve(onAvatarAction?.(action)).then((changed) => {
                    if (changed) {
                        syncFromState();
                        syncSnapshot();
                    }
                }).catch((error) => {
                    console.warn('[sigil] avatar menu action failed:', error);
                });
            });
        });

        anchor.addEventListener('wheel', (event) => {
            if (!menuState.open) return;
            if (!anchor.contains(event.target)) return;
            event.preventDefault();
            event.stopPropagation();
            const card = activeScrollableCard(event.target);
            if (!card) return;
            card.scrollTop += event.deltaY;
            card.scrollLeft += event.deltaX;
            syncSnapshot();
        }, { passive: false });
    }

    bindControls();
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
            return visibleCardBounds() || (menuState.bounds ? { ...menuState.bounds } : null);
        },
        updateSegmentPosition: syncPosition,
        containsDesktopPoint,
        handlePointerEvent,
        applySnapshot,
        snapshot,
    };
}
