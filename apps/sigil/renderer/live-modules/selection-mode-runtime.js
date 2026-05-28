import { toolkitSpecifier } from './content-roots.js';
import { createDisplayAnnotationSubject } from './annotation-reticle.js';
import { findDisplayForPoint } from './display-utils.js';
import { resolveSelectionModeInputRoute } from './selection-mode-input.js';

const {
    createSelectionModeContextSession,
} = await import(toolkitSpecifier('workbench/selection-mode.js'));

export function createDefaultSelectionModeState() {
    return {
        active: false,
        entered_at: null,
        cursor: null,
        leaf_candidate: null,
        path_candidates: [],
        selected_node_id: '',
        context_session: null,
        events: [],
        blocker: null,
    };
}

function defaultNowIso() {
    return new Date().toISOString();
}

function finite(value, fallback = 0) {
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
}

function normalizeRect(rect = null) {
    if (!rect || typeof rect !== 'object') return null;
    const x = Number(rect.x ?? rect.left);
    const y = Number(rect.y ?? rect.top);
    const width = Number(rect.width ?? rect.w);
    const height = Number(rect.height ?? rect.h);
    if (![x, y, width, height].every(Number.isFinite) || width <= 0 || height <= 0) return null;
    return { x, y, width, height };
}

function projectionRect(candidate = null) {
    const rect = normalizeRect(
        candidate?.projection?.visible_display_rect
        || candidate?.projection?.display_space_rect
        || candidate?.visible_display_rect
        || candidate?.display_space_rect
        || candidate?.rect
    );
    return rect
        ? { x: rect.x, y: rect.y, w: rect.width, h: rect.height }
        : null;
}

function pointInRect(point = null, rect = null) {
    if (!point || !rect) return false;
    return point.x >= rect.x && point.x <= rect.x + rect.w
        && point.y >= rect.y && point.y <= rect.y + rect.h;
}

function candidateArea(candidate = null) {
    const rect = projectionRect(candidate);
    return rect ? rect.w * rect.h : Number.POSITIVE_INFINITY;
}

function cursorFromPoint(point = null) {
    if (!point) return null;
    return {
        x: finite(point.x),
        y: finite(point.y),
        valid: point.valid !== false,
    };
}

function projectRect(rect = null, projectPoint = (point) => point) {
    const normalized = normalizeRect(rect);
    if (!normalized) return null;
    const origin = projectPoint({ x: normalized.x, y: normalized.y, valid: true });
    if (!origin) return null;
    return {
        x: origin.x,
        y: origin.y,
        width: normalized.width,
        height: normalized.height,
    };
}

export function buildProjectedSelectionModeOverlay(selectionMode = {}, {
    projectPoint = (point) => point,
} = {}) {
    if (!selectionMode?.active && !selectionMode?.context_session) return { visible: false };
    const artifact = selectionMode.context_session?.artifacts?.[0] || null;
    const path = Array.isArray(artifact?.path) ? artifact.path : [];
    const activeNodeId = artifact?.active_target_node_id || selectionMode.selected_node_id || '';
    const leafNodeId = artifact?.acquisition?.leaf_node_id || path.at(-1)?.id || '';
    const frames = path.map((node, index) => {
        const rect = projectRect(
            node.projection?.visible_display_rect
            || node.projection?.display_space_rect,
            projectPoint,
        );
        if (!rect) return null;
        return {
            kind: node.id === activeNodeId ? 'active_target' : (node.id === leafNodeId ? 'clicked_leaf' : 'ancestor'),
            id: node.id,
            address: node.address,
            label: node.label || node.role || node.kind || node.id,
            rect,
            index,
            active: node.id === activeNodeId,
            leaf: node.id === leafNodeId,
        };
    }).filter(Boolean);
    return {
        visible: selectionMode.active === true,
        cursor: selectionMode.cursor ? projectPoint(selectionMode.cursor) : null,
        frames,
        activeNodeId,
        leafNodeId,
        blocker: selectionMode.blocker || null,
        eventCount: Array.isArray(selectionMode.events) ? selectionMode.events.length : 0,
    };
}

export function createSigilSelectionModeRuntime({
    liveState = {},
    rendererState = null,
    nowIso = defaultNowIso,
    getPointer = () => null,
    getDisplays = () => [],
    getCandidateList = () => [],
    projectPoint = (point) => point,
    closeContextMenu = () => {},
    exitAnnotationReticle = () => {},
    clearGestureState = () => {},
    syncInputRegions = () => {},
    scheduleRenderFrame = () => {},
    clearSelectionModeEntryReleasePending = () => {},
    consumeSelectionModeEntryRelease = () => false,
    isOnAvatar = () => false,
    consumeAvatarDoubleClick = () => false,
    setActiveContextProvider = () => null,
    executeCommand = () => null,
} = {}) {
    if (!liveState.selectionMode) liveState.selectionMode = createDefaultSelectionModeState();
    if (liveState.selectionModeOverlay === undefined) liveState.selectionModeOverlay = null;

    function buildOverlay(selectionMode = liveState.selectionMode) {
        return buildProjectedSelectionModeOverlay(selectionMode, { projectPoint });
    }

    function publish({ inputRegions = false, render = false } = {}) {
        liveState.selectionModeOverlay = buildOverlay(liveState.selectionMode);
        if (rendererState) rendererState.selectionMode = liveState.selectionMode;
        if (inputRegions) syncInputRegions();
        if (render) scheduleRenderFrame();
        return liveState.selectionMode;
    }

    function recordEvent(type, extra = {}) {
        const entry = {
            type,
            at: nowIso(),
            ...extra,
        };
        liveState.selectionMode.events = [...(liveState.selectionMode.events || []), entry].slice(-40);
        return entry;
    }

    function displayCandidate(point = null) {
        const cursor = cursorFromPoint(point || getPointer()) || { x: 0, y: 0, valid: true };
        const displays = Array.isArray(getDisplays()) ? getDisplays() : [];
        const display = findDisplayForPoint(displays, cursor.x, cursor.y)
            || displays[0]
            || null;
        return createDisplayAnnotationSubject(display, cursor, {
            role: 'selection-root',
        });
    }

    function candidatesAtPoint(point = null) {
        const cursor = cursorFromPoint(point || getPointer()) || { x: 0, y: 0, valid: true };
        const displayRoot = displayCandidate(cursor);
        const containing = getCandidateList()
            .filter((candidate) => pointInRect(cursor, projectionRect(candidate)))
            .sort((a, b) => candidateArea(b) - candidateArea(a));
        const path = [displayRoot, ...containing];
        const seen = new Set();
        return path.filter((candidate) => {
            const key = String(candidate?.id || candidate?.subject_id || candidate?.address || '');
            if (!key || seen.has(key)) return false;
            seen.add(key);
            return true;
        });
    }

    function buildContextSession({ selectedNodeId = liveState.selectionMode.selected_node_id } = {}) {
        const pathCandidates = Array.isArray(liveState.selectionMode.path_candidates)
            ? liveState.selectionMode.path_candidates
            : [];
        if (!pathCandidates.length) return null;
        const contextSession = createSelectionModeContextSession({
            id: liveState.selectionMode.context_session?.id,
            updated_at: nowIso(),
            pointer: liveState.selectionMode.cursor,
            clicked_leaf_candidate: liveState.selectionMode.leaf_candidate || pathCandidates.at(-1),
            path_candidates: pathCandidates,
            selected_target_id: selectedNodeId || liveState.selectionMode.selected_node_id || pathCandidates.at(-1)?.id,
            adapter_blockers: liveState.selectionMode.blocker ? [liveState.selectionMode.blocker] : [],
            session_metadata: {
                source: 'sigil_selection_mode_runtime',
            },
        });
        const artifact = contextSession.artifacts?.[0] || null;
        liveState.selectionMode.context_session = contextSession;
        liveState.selectionMode.selected_node_id = artifact?.active_target_node_id || '';
        liveState.selectionModeOverlay = buildOverlay(liveState.selectionMode);
        return contextSession;
    }

    function enter(pointer = null, reason = 'avatar-double-click') {
        closeContextMenu('selection-mode');
        exitAnnotationReticle('selection-mode');
        clearGestureState();
        const cursor = cursorFromPoint(pointer || getPointer());
        liveState.selectionMode = {
            ...createDefaultSelectionModeState(),
            active: true,
            entered_at: nowIso(),
            cursor,
        };
        recordEvent('enter', { reason, cursor });
        publish({ inputRegions: true, render: true });
        return liveState.selectionMode;
    }

    function exit(reason = 'cancel') {
        if (!liveState.selectionMode?.active) return liveState.selectionMode;
        clearSelectionModeEntryReleasePending();
        recordEvent('exit', { reason });
        liveState.selectionMode = {
            ...liveState.selectionMode,
            active: false,
            blocker: reason === 'cancel' ? { status: 'cancelled', reason } : liveState.selectionMode.blocker,
        };
        publish({ inputRegions: true, render: true });
        return liveState.selectionMode;
    }

    function acquire(point = null) {
        const cursor = cursorFromPoint(point || getPointer()) || { x: 0, y: 0, valid: true };
        const pathCandidates = candidatesAtPoint(cursor);
        const leaf = pathCandidates.at(-1) || null;
        liveState.selectionMode = {
            ...liveState.selectionMode,
            cursor,
            leaf_candidate: leaf,
            path_candidates: pathCandidates,
            selected_node_id: leaf?.id || leaf?.subject_id || leaf?.address || '',
            blocker: pathCandidates.length > 1 ? null : {
                status: 'degraded',
                reason: 'selection_mode_only_display_fallback_available',
            },
        };
        recordEvent('acquire', {
            cursor,
            path_candidate_count: pathCandidates.length,
            leaf_candidate_id: leaf?.id || leaf?.subject_id || leaf?.address || '',
        });
        const contextSession = buildContextSession();
        publish({ render: true });
        return contextSession;
    }

    function cycleTarget(delta = -1) {
        const contextSession = liveState.selectionMode?.context_session;
        const path = contextSession?.artifacts?.[0]?.path || [];
        if (!path.length) return null;
        const current = path.findIndex((node) => node.id === liveState.selectionMode.selected_node_id);
        const nextIndex = (current >= 0 ? current : path.length - 1) + delta;
        const wrapped = ((nextIndex % path.length) + path.length) % path.length;
        const context = buildContextSession({ selectedNodeId: path[wrapped].id });
        recordEvent('select_target', {
            selected_node_id: liveState.selectionMode.selected_node_id,
        });
        publish({ render: true });
        return context;
    }

    function commit(reason = 'selection-mode-commit') {
        const contextSession = liveState.selectionMode?.context_session || buildContextSession();
        if (!contextSession) return null;
        const activeContext = setActiveContextProvider({
            source: 'selection_mode',
            contextSession,
            trigger: 'selection_mode_commit',
            reason,
        });
        recordEvent('commit', {
            reason,
            context_session_id: contextSession.id,
            context_keyframe_id: activeContext?.context_keyframe?.id || '',
        });
        exit('commit');
        return contextSession;
    }

    function setNodeComment(nodeId = '', text = '', options = {}) {
        const target = String(nodeId || liveState.selectionMode?.selected_node_id || '').trim();
        const path = liveState.selectionMode?.path_candidates || [];
        const contextPath = liveState.selectionMode?.context_session?.artifacts?.[0]?.path || [];
        const targetIndex = contextPath.findIndex((node) => node.id === target || node.address === target);
        const nextPath = path.map((candidate, index) => {
            const key = String(candidate.id || candidate.node_id || candidate.subject_id || candidate.address || '').trim();
            if (key !== target && index !== targetIndex) return candidate;
            return {
                ...candidate,
                comments: [
                    ...(Array.isArray(candidate.comments) ? candidate.comments : []),
                    {
                        id: options.id || `comment:selection-mode:${Date.now()}`,
                        text,
                        actor: options.actor || { role: 'operator', id: 'human' },
                        created_at: options.created_at || nowIso(),
                        updated_at: options.updated_at || nowIso(),
                    },
                ],
            };
        });
        liveState.selectionMode.path_candidates = nextPath;
        const context = buildContextSession({ selectedNodeId: liveState.selectionMode.selected_node_id });
        publish();
        return context;
    }

    function createContextFromDebugInput(input = {}) {
        const contextSession = createSelectionModeContextSession(input, {
            updated_at: input.updated_at || nowIso(),
        });
        liveState.selectionMode = {
            active: Boolean(input.active ?? false),
            entered_at: input.entered_at || null,
            cursor: input.pointer || input.cursor || null,
            leaf_candidate: input.clicked_leaf_candidate || input.leaf_candidate || null,
            path_candidates: input.path_candidates || input.ancestor_candidates || [],
            selected_node_id: contextSession.artifacts?.[0]?.active_target_node_id || '',
            context_session: contextSession,
            events: [],
            blocker: input.blocker || null,
        };
        setActiveContextProvider({
            source: 'selection_mode_debug',
            contextSession,
            trigger: 'selection_mode_debug',
            reason: 'debug-api',
        });
        publish();
        return contextSession;
    }

    function fallbackForRoute(route = {}) {
        return () => {
            if (route.command === 'commit') {
                commit('enter');
                return;
            }
            if (route.command === 'tabPreviousTarget' || route.command === 'arrowUpPreviousTarget') {
                cycleTarget(-1);
                return;
            }
            if (route.command === 'arrowDownNextTarget') {
                cycleTarget(1);
                return;
            }
            if (route.command === 'acquire') {
                acquire(route.pointer);
            }
        };
    }

    function handleInput(msg = {}) {
        if (!liveState.selectionMode?.active) return false;
        if (typeof msg.x === 'number' && typeof msg.y === 'number') {
            liveState.selectionMode.cursor = { x: msg.x, y: msg.y, valid: true };
            liveState.selectionModeOverlay = buildOverlay(liveState.selectionMode);
        }
        const route = resolveSelectionModeInputRoute(msg, {
            consumeSelectionModeEntryRelease,
            isOnAvatar,
            consumeAvatarDoubleClick,
        });
        if (!route.handled) return false;
        if (route.direct === 'render_only') {
            scheduleRenderFrame();
            return true;
        }
        if (route.direct === 'avatar_double_click_exit') {
            exit('avatar-double-click');
            return true;
        }
        if (!route.command) return true;

        executeCommand(route.command, msg, {
            pointer: route.pointer || null,
            fallback: fallbackForRoute(route),
        });
        return true;
    }

    return {
        buildContextSession,
        buildProjectedOverlay: buildOverlay,
        candidatesAtPoint,
        enter,
        exit,
        acquire,
        cycleTarget,
        commit,
        setNodeComment,
        createContextFromDebugInput,
        handleInput,
        snapshot() {
            return {
                selectionMode: liveState.selectionMode || createDefaultSelectionModeState(),
                selectionModeOverlay: liveState.selectionModeOverlay || buildOverlay(liveState.selectionMode),
            };
        },
    };
}
