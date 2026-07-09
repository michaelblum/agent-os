import { sigilUrl, toolkitUrl, withQuery } from './content-roots.js';
import { RENDER_PERFORMANCE_CANVAS_ID } from './render-performance-telemetry.js';

export { RENDER_PERFORMANCE_CANVAS_ID };

export const AGENT_TERMINAL_CANVAS_ID = 'sigil-agent-terminal';
export const LEGACY_CODEX_TERMINAL_CANVAS_ID = 'sigil-codex-terminal';
export const AGENT_TERMINAL_PARK_SCALE = 0.24;
export const STATUS_PARK_SCALE = 0.2;
export const WIKI_WORKBENCH_CANVAS_ID = 'sigil-wiki-workbench';
export const WIKI_WORKBENCH_DEFAULT_PATH = 'aos/concepts/runtime-modes.md';
export const DEFAULT_UTILITY_VISIBLE_BOUNDS = Object.freeze({ x: 0, y: 0, w: 1512, h: 875 });

export const SIGIL_UTILITY_CANVAS_IDS = Object.freeze([
    '__log__',
    'surface-inspector',
    'sigil-interaction-trace',
    RENDER_PERFORMANCE_CANVAS_ID,
    WIKI_WORKBENCH_CANVAS_ID,
    AGENT_TERMINAL_CANVAS_ID,
    LEGACY_CODEX_TERMINAL_CANVAS_ID,
]);

export function sigilAgentTerminalUrl(options = {}) {
    return sigilUrl('agent-terminal/index.html', {
        ...options,
        query: {
            port: 17761,
            session: 'sigil-agent-terminal-agent-os',
            ...(options.query || {}),
        },
    });
}

export function wikiWorkbenchUrl(options = {}) {
    return toolkitUrl('components/wiki-subject-browser/index.html', options);
}

export function wikiWorkbenchDefaultUrl(options = {}) {
    const { query = null, ...urlOptions } = options;
    return withQuery(wikiWorkbenchUrl(urlOptions), {
        wiki: WIKI_WORKBENCH_DEFAULT_PATH,
        transition: 'fade-in',
        ...(query || {}),
    });
}

export const AGENT_TERMINAL_URL = sigilAgentTerminalUrl();
export const WIKI_WORKBENCH_URL = wikiWorkbenchUrl();
export const WIKI_WORKBENCH_DEFAULT_URL = wikiWorkbenchDefaultUrl();

export function createSigilUtilityCanvasIdSet(extraIds = []) {
    return new Set([
        ...SIGIL_UTILITY_CANVAS_IDS,
        ...extraIds.filter(Boolean),
    ]);
}

export function mainDisplayVisibleBounds({
    displays = [],
    visibleBounds = null,
} = {}) {
    const display = displays.find((entry) => entry.index === 0 || entry.is_main || entry.isMain)
        || displays[0];
    return display?.visibleBounds || display?.visible_bounds || display?.bounds || visibleBounds;
}

function resolveVisibleBounds(options = {}) {
    return mainDisplayVisibleBounds(options) || DEFAULT_UTILITY_VISIBLE_BOUNDS;
}

export function utilityFrame(kind, options = {}) {
    const visible = resolveVisibleBounds(options);
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
    if (kind === 'agent-terminal' || kind === 'codex-terminal') {
        const previousWidth = Math.min(920, Math.max(720, visible.w * 0.58));
        const width = Math.round(previousWidth * 2 / 3);
        const height = Math.min(620, Math.max(480, visible.h * 0.58));
        return [
            Math.round(visible.x + visible.w - width - 28),
            Math.round(visible.y + visible.h - height - 28),
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

export function utilityConfig(kind, options = {}) {
    if (kind === 'log-console') {
        return {
            id: '__log__',
            url: toolkitUrl('components/log-console/index.html', options),
            frame: utilityFrame(kind, options),
        };
    }
    if (kind === 'sigil-interaction-trace') {
        return {
            id: 'sigil-interaction-trace',
            url: sigilUrl('diagnostics/interaction-trace/index.html', options),
            frame: utilityFrame(kind, options),
        };
    }
    if (kind === 'render-performance') {
        return {
            id: RENDER_PERFORMANCE_CANVAS_ID,
            url: toolkitUrl('components/render-performance/index.html', options),
            frame: utilityFrame(kind, options),
        };
    }
    if (kind === 'wiki-workbench') {
        return {
            id: WIKI_WORKBENCH_CANVAS_ID,
            url: wikiWorkbenchDefaultUrl(options),
            frame: utilityFrame(kind, options),
        };
    }
    if (kind === 'agent-terminal' || kind === 'codex-terminal') {
        return {
            id: AGENT_TERMINAL_CANVAS_ID,
            url: sigilAgentTerminalUrl(options),
            frame: utilityFrame(kind, options),
        };
    }
    return {
        id: 'surface-inspector',
        url: toolkitUrl('components/surface-inspector/index.html', options),
        frame: utilityFrame(kind, options),
    };
}
