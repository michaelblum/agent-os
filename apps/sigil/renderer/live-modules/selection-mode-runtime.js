import { toolkitSpecifier } from './content-roots.js';
import { createDisplayAnnotationSubject } from './annotation-reticle.js';
import { findDisplayForPoint } from './display-utils.js';
import { resolveSelectionModeInputRoute } from './selection-mode-input.js';
import {
    buildSelectionModeLineageBarModel,
    hitTestSelectionModeLineageBar,
    hitTestSelectionModeLineageItem,
} from './selection-mode-lineage-bar.js';
import {
    buildSelectionModeCursorGlyph,
    buildSelectionModeCursorTrailModel,
    buildSelectionModeVisualEffects,
    buildSelectionModeVisualStyle,
    normalizeSelectionModeEffects,
    resolveSigilAvatarIdleRotation,
    selectionModeEffectDurationMs,
    selectionModeOverlayHasActiveEffects,
} from './selection-mode-visual-model.js';

const {
    createSelectionModeContextSession,
} = await import(toolkitSpecifier('workbench/selection-mode.js'));

export {
    resolveSigilAvatarIdleRotation,
    selectionModeOverlayHasActiveEffects,
};

export function createDefaultSelectionModeState() {
    return {
        active: false,
        entered_at: null,
        rotation_started_at_ms: null,
        cursor: null,
        leaf_candidate: null,
        path_candidates: [],
        selected_node_id: '',
        hover_node_id: '',
        lineage_bar_position: null,
        lineage_bar_drag: null,
        context_session: null,
        events: [],
        effects: [],
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
    const width = Number(rect.w ?? rect.width);
    const height = Number(rect.h ?? rect.height);
    return point.x >= rect.x && point.x <= rect.x + width
        && point.y >= rect.y && point.y <= rect.y + height;
}

function candidateArea(candidate = null) {
    const rect = projectionRect(candidate);
    return rect ? rect.w * rect.h : Number.POSITIVE_INFINITY;
}

function candidateText(value = null) {
    return String(value ?? '').trim();
}

function candidateKey(candidate = null) {
    return candidateText(
        candidate?.id
        || candidate?.subject_id
        || candidate?.address
        || candidate?.subject_address,
    );
}

function candidateAdapterId(candidate = null) {
    return candidateText(candidate?.adapter_id || candidate?.projection?.adapter_id);
}

function candidateRootId(candidate = null) {
    return candidateText(
        candidate?.root_id
        || candidate?.projection?.root_id
        || candidate?.source_metadata?.root_id,
    );
}

function candidateWindowId(candidate = null) {
    return candidateText(
        candidate?.window_id
        || candidate?.source_metadata?.window_id
        || candidate?.source_metadata?.browser_window_id
        || candidate?.projection?.window_id,
    );
}

function candidatePid(candidate = null) {
    const value = candidate?.pid
        ?? candidate?.source_metadata?.pid
        ?? candidate?.source_metadata?.browser_pid
        ?? candidate?.projection?.pid;
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
}

function candidatePathDepth(candidate = null) {
    const path = Array.isArray(candidate?.subject_path)
        ? candidate.subject_path
        : (Array.isArray(candidate?.projection?.subject_path) ? candidate.projection.subject_path : []);
    return path.length;
}

function candidatesShareNativeWindow(left = null, right = null) {
    const leftWindowId = candidateWindowId(left);
    const rightWindowId = candidateWindowId(right);
    if (leftWindowId && rightWindowId && leftWindowId === rightWindowId) return true;
    const leftPid = candidatePid(left);
    const rightPid = candidatePid(right);
    return leftPid !== null && rightPid !== null && leftPid === rightPid;
}

function selectLeafCandidate(containing = []) {
    return [...containing].sort((a, b) => {
        const areaDelta = candidateArea(a) - candidateArea(b);
        if (areaDelta !== 0) return areaDelta;
        const depthDelta = candidatePathDepth(b) - candidatePathDepth(a);
        if (depthDelta !== 0) return depthDelta;
        return candidateKey(a).localeCompare(candidateKey(b));
    })[0] || null;
}

function candidateBelongsToLeafBranch(candidate = null, leaf = null) {
    if (!candidate || !leaf) return false;
    const key = candidateKey(candidate);
    const leafKey = candidateKey(leaf);
    if (key && leafKey && key === leafKey) return true;

    const adapter = candidateAdapterId(candidate);
    const leafAdapter = candidateAdapterId(leaf);
    const rootId = candidateRootId(candidate);
    const leafRootId = candidateRootId(leaf);
    const subjectId = candidateText(candidate?.subject_id || candidate?.projection?.subject_id || candidate?.id);

    if (leafAdapter === 'macos-ax') {
        if (adapter === 'macos-ax') return Boolean(leafRootId && (rootId === leafRootId || subjectId === leafRootId || key === leafRootId));
        return candidatesShareNativeWindow(candidate, leaf);
    }

    if (leafRootId && (rootId === leafRootId || subjectId === leafRootId || key === leafRootId)) return true;
    if (candidatesShareNativeWindow(candidate, leaf)) return true;
    return false;
}

function rootToLeafCandidateSort(a = null, b = null) {
    const areaDelta = candidateArea(b) - candidateArea(a);
    if (areaDelta !== 0) return areaDelta;
    const depthDelta = candidatePathDepth(a) - candidatePathDepth(b);
    if (depthDelta !== 0) return depthDelta;
    return candidateKey(a).localeCompare(candidateKey(b));
}

function candidateRoleText(candidate = null) {
    return candidateText(
        candidate?.role
        || candidate?.kind
        || candidate?.subject_kind
        || candidate?.projection?.subject_kind,
    );
}

function candidateCapabilities(candidate = null) {
    return [
        ...(Array.isArray(candidate?.capabilities) ? candidate.capabilities : []),
        ...(Array.isArray(candidate?.normalized_capabilities) ? candidate.normalized_capabilities : []),
        ...(Array.isArray(candidate?.action_names) ? candidate.action_names : []),
    ].map((item) => candidateText(item)).filter(Boolean);
}

function candidateIsBrowserTabSeam(candidate = null) {
    const adapter = candidateAdapterId(candidate);
    const role = candidateRoleText(candidate).toLowerCase();
    if (adapter === 'browser-content-seam') return true;
    return role === 'browser_tab' || role === 'browser_content_seam' || role === 'browser_page';
}

function candidateIsGenericAxGroup(candidate = null) {
    if (candidateAdapterId(candidate) !== 'macos-ax') return false;
    const role = candidateRoleText(candidate);
    if (role !== 'AXGroup' && role.toLowerCase() !== 'group') return false;
    const label = candidateText(candidate?.label || candidate?.title || candidate?.name);
    if (label && label !== 'AXGroup' && label.toLowerCase() !== 'group') return false;
    return candidateCapabilities(candidate).length === 0;
}

function collapseBrowserLineageNoise(branch = []) {
    const browserSeams = branch.filter(candidateIsBrowserTabSeam);
    if (!browserSeams.length) return branch;
    const browserRootIds = new Set(browserSeams.map(candidateRootId).filter(Boolean));
    return branch.filter((candidate) => {
        if (!candidateIsGenericAxGroup(candidate)) return true;
        const rootId = candidateRootId(candidate);
        return rootId && !browserRootIds.has(rootId);
    });
}

function selectedBranchCandidates(containing = []) {
    const leaf = selectLeafCandidate(containing);
    if (!leaf) return [];
    const branch = containing
        .filter((candidate) => candidateBelongsToLeafBranch(candidate, leaf))
        .sort(rootToLeafCandidateSort);
    const seen = new Set();
    const deduped = [];
    for (const candidate of branch) {
        const key = candidateKey(candidate);
        if (!key || seen.has(key)) continue;
        seen.add(key);
        deduped.push(candidate);
    }
    if (!seen.has(candidateKey(leaf))) deduped.push(leaf);
    return collapseBrowserLineageNoise(deduped);
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

function selectionModeRoleToken(node = {}) {
    const text = [
        node.role,
        node.kind,
        node.subject_kind,
        node.label,
        node.address,
        node.id,
    ].map((part) => String(part || '').toLowerCase()).join(' ');
    if (text.includes('browser_tab') || text.includes('browser tab') || /\btab\b/.test(text)) return 'browser_tab';
    if (text.includes('document') || /\bdom\b/.test(text)) return 'document';
    if (/\bbody\b/.test(text) || text.includes('document body')) return 'body';
    if (text.includes('native_app') || text.includes('application') || /\bapp\b/.test(text)) return 'app';
    if (text.includes('native_window') || /\bwindow\b/.test(text)) return 'window';
    if (text.includes('canvas')) return 'canvas';
    if (text.includes('display') || text.includes('screen')) return 'display';
    return '';
}

function majorSeamAncestorFrameId(path = [], highlightedNodeId = '', leafNodeId = '') {
    const targetIndex = path.findIndex((node) => node.id === highlightedNodeId);
    const index = targetIndex >= 0
        ? targetIndex
        : path.findIndex((node) => node.id === leafNodeId);
    if (index <= 0) return '';
    const seamTokens = new Set(['app', 'window', 'canvas', 'browser_tab', 'document', 'body']);
    for (let i = index - 1; i >= 0; i -= 1) {
        if (seamTokens.has(selectionModeRoleToken(path[i]))) return path[i].id || '';
    }
    return '';
}

export function buildProjectedSelectionModeOverlay(selectionMode = {}, {
    projectPoint = (point) => point,
    overlayBounds = null,
    displays = [],
    rendererState = null,
    nowMs = Date.now(),
} = {}) {
    const visualStyle = buildSelectionModeVisualStyle(rendererState);
    const visualEffects = buildSelectionModeVisualEffects(selectionMode, { projectPoint, nowMs });
    const effectsActive = visualEffects.some((effect) => effect.active);
    if (!selectionMode?.active && !selectionMode?.context_session && !effectsActive) return {
        visible: false,
        active: false,
        styles: visualStyle,
        visualEffects,
    };
    const artifact = selectionMode.context_session?.artifacts?.[0] || null;
    const path = Array.isArray(artifact?.path) ? artifact.path : [];
    const selectedNodeId = artifact?.active_target_node_id || selectionMode.selected_node_id || '';
    const leafNodeId = artifact?.acquisition?.leaf_node_id || path.at(-1)?.id || '';
    const hoverNodeId = selectionMode.hover_node_id || '';
    const highlightedNodeId = hoverNodeId || leafNodeId;
    const perimeterFillNodeId = majorSeamAncestorFrameId(path, highlightedNodeId, leafNodeId);
    const frames = path.map((node, index) => {
        const rect = projectRect(
            node.projection?.visible_display_rect
            || node.projection?.display_space_rect,
            projectPoint,
        );
        if (!rect) return null;
        const highlighted = node.id === highlightedNodeId;
        return {
            kind: highlighted ? 'highlighted_target' : (node.id === leafNodeId ? 'clicked_leaf' : 'ancestor'),
            id: node.id,
            address: node.address,
            label: node.label || node.role || node.kind || node.id,
            rect,
            index,
            active: highlighted,
            selected: node.id === selectedNodeId,
            hovered: node.id === hoverNodeId,
            leaf: node.id === leafNodeId,
            style: {
                ...(highlighted
                    ? visualStyle.frame.active
                    : (node.id === leafNodeId ? visualStyle.frame.leaf : visualStyle.frame.ancestor)),
                fill: null,
            },
            perimeterFill: node.id === perimeterFillNodeId ? {
                mode: 'edge_band',
                marginRatio: 0.15,
                style: visualStyle.frame.perimeter,
            } : null,
        };
    }).filter(Boolean);
    const cursor = selectionMode.cursor ? projectPoint(selectionMode.cursor) : null;
    const rotationStartedAtMs = Number(selectionMode.rotation_started_at_ms ?? Date.parse(selectionMode.entered_at || ''));
    const lineageModel = buildSelectionModeLineageBarModel({
        path,
        activeNodeId: selectedNodeId,
        hoverNodeId,
        leafNodeId,
        acquisitionPointer: artifact?.acquisition?.pointer || null,
        cursor: selectionMode.cursor || null,
        manualPosition: selectionMode.lineage_bar_position || null,
        displays,
        overlayBounds,
        projectPoint,
        visualStyle,
    });
    return {
        visible: selectionMode.active === true || effectsActive,
        active: selectionMode.active === true,
        cursor,
        cursorGlyph: buildSelectionModeCursorGlyph(cursor, rendererState, {
            rotationStartedAtMs: Number.isFinite(rotationStartedAtMs) ? rotationStartedAtMs : null,
        }),
        cursorTrail: buildSelectionModeCursorTrailModel(rendererState),
        frames,
        ...lineageModel,
        styles: visualStyle,
        visualEffects,
        activeNodeId: selectedNodeId,
        leafNodeId,
        hoverNodeId,
        highlightedNodeId,
        perimeterFillNodeId,
        blocker: selectionMode.blocker || null,
        eventCount: Array.isArray(selectionMode.events) ? selectionMode.events.length : 0,
    };
}

export function createSigilSelectionModeRuntime({
    liveState = {},
    rendererState = null,
    nowMs = () => Date.now(),
    nowIso = defaultNowIso,
    getPointer = () => null,
    getDisplays = () => [],
    getCandidateList = () => [],
    projectPoint = (point) => point,
    getOverlayBounds = () => null,
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
        return buildProjectedSelectionModeOverlay(selectionMode, {
            projectPoint,
            overlayBounds: getOverlayBounds(),
            displays: getDisplays(),
            rendererState,
            nowMs: nowMs(),
        });
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

    function recordEffect(phase, reason = '') {
        const effects = normalizeSelectionModeEffects(rendererState);
        const effect = phase === 'enter' ? effects.enter : effects.exit;
        const startedAtMs = nowMs();
        const entry = {
            phase,
            effect,
            reason,
            at: nowIso(),
            started_at_ms: startedAtMs,
            duration_ms: selectionModeEffectDurationMs(effect),
            anchor: liveState.selectionMode?.cursor || null,
            bounded: true,
        };
        liveState.selectionMode.effects = [
            ...(liveState.selectionMode.effects || []),
            entry,
        ].slice(-20);
        recordEvent('selection_mode_effect', entry);
        return entry;
    }

    function recordAcquireFeedback(reason = 'acquire') {
        if (rendererState) {
            rendererState.auraSpike = Math.max(Number(rendererState.auraSpike) || 0, 1);
        }
        return recordEvent('selection_mode_aura_spike', {
            reason,
            style: 'avatar_aura_spike',
            bounded: true,
        });
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
        const path = [displayRoot, ...selectedBranchCandidates(containing)];
        const seen = new Set();
        return path.filter((candidate) => {
            const key = candidateKey(candidate);
            if (!key || seen.has(key)) return false;
            seen.add(key);
            return true;
        });
    }

    function buildContextSession({
        selectedNodeId = liveState.selectionMode.selected_node_id,
        transition = 'acquire',
    } = {}) {
        const pathCandidates = Array.isArray(liveState.selectionMode.path_candidates)
            ? liveState.selectionMode.path_candidates
            : [];
        if (!pathCandidates.length) return null;
        const priorArtifact = liveState.selectionMode.context_session?.artifacts?.[0] || null;
        const retargeting = transition === 'retarget' && priorArtifact?.acquisition;
        const acquisitionPointer = retargeting
            ? priorArtifact.acquisition.pointer
            : liveState.selectionMode.cursor;
        const contextSession = createSelectionModeContextSession({
            id: liveState.selectionMode.context_session?.id,
            updated_at: nowIso(),
            pointer: acquisitionPointer,
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

    function retargetContextSession(selectedNodeId = liveState.selectionMode.selected_node_id) {
        return buildContextSession({
            selectedNodeId,
            transition: 'retarget',
        });
    }

    function reconcileOverlayLifecycle({ render = false } = {}) {
        const priorOverlay = liveState.selectionModeOverlay;
        if (liveState.selectionMode?.active === true || priorOverlay?.visible !== true) return false;
        if (selectionModeOverlayHasActiveEffects(priorOverlay, nowMs())) return false;

        const nextOverlay = buildOverlay(liveState.selectionMode);
        if (nextOverlay.visible === true || selectionModeOverlayHasActiveEffects(nextOverlay, nowMs())) return false;
        liveState.selectionModeOverlay = nextOverlay;
        if (rendererState) rendererState.selectionMode = liveState.selectionMode;
        if (render) scheduleRenderFrame();
        return true;
    }

    function enter(pointer = null, reason = 'selection-mode-enter') {
        closeContextMenu('selection-mode');
        exitAnnotationReticle('selection-mode');
        clearGestureState();
        const cursor = cursorFromPoint(pointer || getPointer());
        liveState.selectionMode = {
            ...createDefaultSelectionModeState(),
            active: true,
            entered_at: nowIso(),
            rotation_started_at_ms: nowMs(),
            cursor,
        };
        recordEffect('enter', reason);
        recordEvent('enter', { reason, cursor });
        publish({ inputRegions: true, render: true });
        return liveState.selectionMode;
    }

    function exit(reason = 'cancel') {
        if (!liveState.selectionMode?.active) return liveState.selectionMode;
        clearSelectionModeEntryReleasePending();
        recordEffect('exit', reason);
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
            hover_node_id: '',
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
        recordAcquireFeedback('acquire');
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
        const context = retargetContextSession(path[wrapped].id);
        recordEvent('select_target', {
            selected_node_id: liveState.selectionMode.selected_node_id,
        });
        publish({ render: true });
        return context;
    }

    function selectTargetNode(nodeId = '', { reason = 'lineage-click' } = {}) {
        const target = String(nodeId || '').trim();
        const path = liveState.selectionMode?.context_session?.artifacts?.[0]?.path || [];
        if (!target || !path.some((node) => node.id === target || node.address === target)) return null;
        const context = retargetContextSession(target);
        recordEvent('select_target', {
            reason,
            selected_node_id: liveState.selectionMode.selected_node_id,
        });
        publish({ render: true });
        return context;
    }

    function hitTestLineageBar(point = null) {
        const cursor = cursorFromPoint(point);
        if (!cursor) return null;
        const projected = projectPoint(cursor);
        const overlay = buildOverlay(liveState.selectionMode);
        return hitTestSelectionModeLineageBar(overlay, projected);
    }

    function hitTestLineageItem(point = null) {
        const cursor = cursorFromPoint(point);
        if (!cursor) return null;
        const projected = projectPoint(cursor);
        const overlay = buildOverlay(liveState.selectionMode);
        return hitTestSelectionModeLineageItem(overlay, projected);
    }

    function startLineageBarDrag(point = null) {
        const cursor = cursorFromPoint(point);
        if (!cursor) return false;
        const projected = projectPoint(cursor);
        const overlay = buildOverlay(liveState.selectionMode);
        const hit = hitTestSelectionModeLineageBar(overlay, projected);
        const rect = overlay?.lineageBar?.rect || null;
        if (!hit || !rect) return false;
        liveState.selectionMode.lineage_bar_drag = {
            active: true,
            moved: false,
            start: cursor,
            start_projected: projected,
            offset: {
                x: projected.x - rect.x,
                y: projected.y - rect.y,
            },
            displayId: overlay.lineageBar.activeDisplayId || null,
            item: hit.kind === 'item' ? {
                id: hit.id || '',
                nodeId: hit.nodeId || '',
            } : null,
        };
        return true;
    }

    function updateLineageBarDrag(point = null, { release = false } = {}) {
        const drag = liveState.selectionMode?.lineage_bar_drag;
        if (!drag?.active) return false;
        const cursor = cursorFromPoint(point);
        if (!cursor) return false;
        const projected = projectPoint(cursor);
        const moved = drag.moved || Math.hypot(
            projected.x - finite(drag.start_projected?.x),
            projected.y - finite(drag.start_projected?.y),
        ) >= 3;
        if (moved) {
            liveState.selectionMode.lineage_bar_position = {
                x: projected.x - finite(drag.offset?.x),
                y: projected.y - finite(drag.offset?.y),
                displayId: drag.displayId || null,
            };
        }
        liveState.selectionMode.lineage_bar_drag = release ? null : {
            ...drag,
            moved,
        };
        liveState.selectionModeOverlay = buildOverlay(liveState.selectionMode);
        if (release && !moved && drag.item?.nodeId) {
            executeCommand('selectLineageNode', { type: 'left_mouse_up', x: cursor.x, y: cursor.y }, {
                pointer: cursor,
                nodeId: drag.item.nodeId,
                lineageItemId: drag.item.id,
            });
        }
        return true;
    }

    function updateLineageHover(point = null) {
        const item = point ? hitTestLineageItem(point) : null;
        const nextHoverNodeId = item?.nodeId || '';
        if ((liveState.selectionMode.hover_node_id || '') === nextHoverNodeId) return false;
        liveState.selectionMode.hover_node_id = nextHoverNodeId;
        liveState.selectionModeOverlay = buildOverlay(liveState.selectionMode);
        return true;
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
        const context = retargetContextSession(liveState.selectionMode.selected_node_id);
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
            rotation_started_at_ms: input.rotation_started_at_ms ?? liveState.selectionMode?.rotation_started_at_ms ?? nowMs(),
            cursor: input.pointer || input.cursor || null,
            leaf_candidate: input.clicked_leaf_candidate || input.leaf_candidate || null,
            path_candidates: input.path_candidates || input.ancestor_candidates || [],
            selected_node_id: contextSession.artifacts?.[0]?.active_target_node_id || '',
            hover_node_id: '',
            lineage_bar_position: null,
            lineage_bar_drag: null,
            context_session: contextSession,
            events: [],
            effects: [],
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

    function handleInput(msg = {}) {
        if (!liveState.selectionMode?.active) return false;
        if (typeof msg.x === 'number' && typeof msg.y === 'number') {
            liveState.selectionMode.cursor = { x: msg.x, y: msg.y, valid: true };
            liveState.selectionModeOverlay = buildOverlay(liveState.selectionMode);
        }
        if (
            liveState.selectionMode.lineage_bar_drag?.active
            && (msg.type === 'mouse_moved' || msg.type === 'left_mouse_dragged')
        ) {
            updateLineageBarDrag({ x: msg.x, y: msg.y, valid: true });
            scheduleRenderFrame({ structural: false });
            return true;
        }
        if (liveState.selectionMode.lineage_bar_drag?.active && msg.type === 'left_mouse_up') {
            updateLineageBarDrag({ x: msg.x, y: msg.y, valid: true }, { release: true });
            scheduleRenderFrame({ structural: false });
            return true;
        }
        if (msg.type === 'left_mouse_down' && startLineageBarDrag({ x: msg.x, y: msg.y, valid: true })) {
            scheduleRenderFrame({ structural: false });
            return true;
        }
        const route = resolveSelectionModeInputRoute(msg, {
            consumeSelectionModeEntryRelease,
            isOnAvatar,
            consumeAvatarDoubleClick,
            hitTestLineageItem,
        });
        if (!route.handled) return false;
        if (route.direct === 'render_only') {
            updateLineageHover(
                typeof msg.x === 'number' && typeof msg.y === 'number'
                    ? { x: msg.x, y: msg.y, valid: true }
                    : null,
            );
            scheduleRenderFrame({ structural: false });
            return true;
        }
        if (route.direct === 'avatar_double_click_exit') {
            exit('avatar-double-click');
            return true;
        }
        if (route.command === 'escape') {
            exit('escape');
            return true;
        }
        if (!route.command) return true;

        executeCommand(route.command, msg, {
            pointer: route.pointer || null,
            nodeId: route.nodeId || null,
            lineageItemId: route.lineageItemId || null,
        });
        return true;
    }

    return {
        buildContextSession,
        reconcileOverlayLifecycle,
        buildProjectedOverlay: buildOverlay,
        candidatesAtPoint,
        enter,
        exit,
        acquire,
        cycleTarget,
        selectTargetNode,
        hitTestLineageItem,
        hitTestLineageBar,
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
