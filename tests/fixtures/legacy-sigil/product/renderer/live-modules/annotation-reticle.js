import { toolkitSpecifier } from './content-roots.js';
import { findDisplayForPoint } from './display-utils.js';

const {
    createAnnotationSession,
    enterAnnotationSession,
    setAnnotationHoverCandidate,
    commitAnnotationPreview,
} = await import(toolkitSpecifier('workbench/annotation-session.js'));
const {
    createContextArtifactFromAnnotationSession,
    createContextSession,
} = await import(toolkitSpecifier('workbench/context-session.js'));
const {
    chooseAnnotationCandidateForScope,
    explainAnnotationCandidateChoice,
    normalizeAnnotationCandidate,
} = await import(toolkitSpecifier('workbench/annotation-candidates.js'));

export const SIGIL_ANNOTATION_RETICLE_ITEM_ID = 'annotation-mode';
export const SIGIL_ANNOTATION_CAMERA_ITEM_ID = 'annotation-camera';
export const SIGIL_ANNOTATION_ENTRY_SOURCE = 'sigil_radial';
export const CANVAS_INSPECTOR_ANNOTATION_OPEN_EVENT = 'canvas_inspector.annotation_open';

function finite(value, fallback = 0) {
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
}

function objectOrEmpty(value) {
    return value && typeof value === 'object' ? value : {};
}

function clone(value) {
    return value == null ? value : JSON.parse(JSON.stringify(value));
}

function displayId(display = null, fallback = 'display:unknown') {
    const safeDisplay = objectOrEmpty(display);
    return String(safeDisplay.display_id ?? safeDisplay.id ?? safeDisplay.cgID ?? fallback);
}

function rectFromDisplay(display = null) {
    const safeDisplay = objectOrEmpty(display);
    const source = objectOrEmpty(
        safeDisplay.visibleBounds
        || safeDisplay.visible_bounds
        || safeDisplay.bounds
        || safeDisplay.desktop_world_bounds
        || { x: 0, y: 0, w: 0, h: 0 },
    );
    const x = finite(source.x ?? source.left);
    const y = finite(source.y ?? source.top);
    const width = finite(source.w ?? source.width);
    const height = finite(source.h ?? source.height);
    if (width <= 0 || height <= 0) return null;
    return { x, y, w: width, h: height };
}

function rectToProjectionRect(rect = null) {
    if (!rect) return null;
    return { x: rect.x, y: rect.y, width: rect.w, height: rect.h };
}

function findDisplay(displays = [], point = {}) {
    const candidates = Array.isArray(displays)
        ? displays.filter((display) => display && typeof display === 'object')
        : [];
    if (!candidates.length) return null;
    return findDisplayForPoint(candidates, finite(point.x), finite(point.y)) || candidates[0] || null;
}

export function createDisplayAnnotationSubject(display = null, point = {}, options = {}) {
    const safeDisplay = objectOrEmpty(display);
    const rect = rectFromDisplay(display);
    const id = displayId(safeDisplay);
    const label = String(safeDisplay.label || safeDisplay.name || `Display ${id}`);
    const role = options.role || 'display';
    return {
        address: `sigil:display:${id}:${role}`,
        adapter_id: 'sigil-display-reticle-v0',
        root_id: id,
        root_kind: 'display',
        root_label: label,
        subject_id: `${id}:${role}`,
        subject_path: ['display', id, role],
        subject_kind: role,
        role,
        label,
        source_metadata: {
            display_id: id,
            entry_source: SIGIL_ANNOTATION_ENTRY_SOURCE,
            limitation: 'display_root_only_v0',
        },
        fallback_evidence: {
            pointer: point ? { x: finite(point.x), y: finite(point.y) } : null,
        },
        projection: {
            adapter_id: 'sigil-display-reticle-v0',
            subject_id: `${id}:${role}`,
            subject_kind: role,
            current_render_status: rect ? 'visible' : 'blocked',
            can_project_display_overlay: Boolean(rect),
            can_reveal: false,
            display_space_rect: rectToProjectionRect(rect),
            visible_display_rect: rectToProjectionRect(rect),
            coordinate_space: 'desktop_world',
            blocker_reason: rect ? '' : 'display_bounds_missing',
            refreshed_at: new Date().toISOString(),
            source_metadata: {
                display_id: id,
                limitation: 'display_root_only_v0',
            },
        },
    };
}

export function createPointerAnnotationSubject(display = null, point = {}) {
    const id = displayId(display);
    const x = Math.round(finite(point.x));
    const y = Math.round(finite(point.y));
    return {
        ...createDisplayAnnotationSubject(display, point, { role: 'pointer-preview' }),
        address: `sigil:display:${id}:pointer:${x}:${y}`,
        subject_id: `${id}:pointer:${x}:${y}`,
        subject_path: ['display', id, 'pointer-preview', `${x},${y}`],
        subject_kind: 'annotation_preview_pointer',
        role: 'annotation_preview_pointer',
        label: `Annotation preview ${x},${y}`,
        source_metadata: {
            display_id: id,
            entry_source: SIGIL_ANNOTATION_ENTRY_SOURCE,
            limitation: 'display_under_release_pointer_v0',
        },
        fallback_evidence: {
            pointer: { x, y },
        },
    };
}

function rectToTravelRect(rect = null) {
    if (!rect || typeof rect !== 'object') return null;
    const x = finite(rect.x ?? rect.left, NaN);
    const y = finite(rect.y ?? rect.top, NaN);
    const w = finite(rect.w ?? rect.width, NaN);
    const h = finite(rect.h ?? rect.height, NaN);
    if (![x, y, w, h].every(Number.isFinite) || w <= 0 || h <= 0) return null;
    return { x, y, w, h };
}

function subjectProjectionRect(subject = null) {
    const projection = objectOrEmpty(subject?.projection);
    return rectToTravelRect(projection.visible_display_rect || projection.display_space_rect || subject?.display_space_rect);
}

function bridgeMetadata(reason, point = null, sourceCount = 0) {
    return {
        bridge: 'sigil_reticle_annotation_candidate_bridge_v0',
        reason,
        candidate_source_count: sourceCount,
        pointer: point ? { x: finite(point.x), y: finite(point.y) } : null,
    };
}

function decisionSource(candidate = null) {
    const metadata = objectOrEmpty(candidate?.source_metadata);
    const adapter = String(candidate?.adapter_id || candidate?.projection?.adapter_id || '');
    if (adapter === 'aos-browser-dom-element-picker') return 'browser_dom_element_picker';
    if (adapter === 'macos-ax') return candidate?.subject_kind === 'native_window' ? 'native_ax_window' : 'native_ax_element';
    if (adapter === 'aos-toolkit-semantic-target') return 'aos_semantic_target';
    if (adapter === 'aos-canvas-window') return 'canvas_window';
    if (adapter === 'sigil-display-reticle-v0' || metadata.sigil_fallback) return 'display_fallback';
    return adapter || 'unknown';
}

function latestCommittedScope(session = null) {
    const stack = Array.isArray(session?.committed_scope_stack) ? session.committed_scope_stack : [];
    return stack.length ? stack[stack.length - 1] : null;
}

function liveCommittedScopeStack(session = null) {
    const stack = Array.isArray(session?.committed_scope_stack) ? session.committed_scope_stack : [];
    if (!stack.length) return [];
    const anchors = Array.isArray(session?.anchors) ? session.anchors : [];
    const liveAddresses = new Set(anchors
        .filter((anchor) => anchor?.status === 'live')
        .map((anchor) => String(anchor.address || anchor.subject?.address || ''))
        .filter(Boolean));
    if (!liveAddresses.size) return [];
    return stack.every((subject) => liveAddresses.has(String(subject?.address || ''))) ? stack : [];
}

function liveCommittedAnchors(session = null) {
    const stack = Array.isArray(session?.committed_scope_stack) ? session.committed_scope_stack : [];
    if (!stack.length) return [];
    const committedAddresses = new Set(stack
        .map((subject) => String(subject?.address || ''))
        .filter(Boolean));
    return (Array.isArray(session?.anchors) ? session.anchors : [])
        .filter((anchor) => anchor?.status === 'live' && committedAddresses.has(String(anchor.address || anchor.subject?.address || '')));
}

function contextSourceMetadataFromReticleEvent(event = {}, options = {}) {
    const previewTarget = objectOrEmpty(options.preview_target || event.preview_target);
    return {
        source: 'sigil_annotation_reticle',
        entry_source: SIGIL_ANNOTATION_ENTRY_SOURCE,
        release_pointer: clone(options.release_point || event.release_point || null),
        fallback: Boolean(options.fallback ?? event.fallback),
        blocker_reason: String(options.blocker_reason ?? event.blocker_reason ?? ''),
        target_limitation: String(options.target_limitation ?? event.target_limitation ?? ''),
        root_evidence: clone(options.root_evidence || event.root_evidence || null),
        placement: clone(options.placement || event.placement || null),
        preview_target: previewTarget.address ? {
            address: previewTarget.address,
            adapter_id: previewTarget.adapter_id || '',
            root_id: previewTarget.root?.id || previewTarget.root_id || '',
            subject_id: previewTarget.subject?.id || previewTarget.subject_id || '',
            subject_kind: previewTarget.subject?.kind || previewTarget.subject_kind || '',
            source_metadata: clone(previewTarget.source_metadata || {}),
        } : null,
        ...(options.source_metadata || {}),
    };
}

export function createSigilAnnotationReticleContextSession(snapshotOrSession = {}, options = {}) {
    const event = options.event || snapshotOrSession?.last_committed_event || snapshotOrSession;
    const sourceSession = snapshotOrSession?.session || event?.session || snapshotOrSession;
    const normalizedSession = createAnnotationSession(sourceSession || {
        entry_source: SIGIL_ANNOTATION_ENTRY_SOURCE,
    });
    const anchors = liveCommittedAnchors(normalizedSession);
    if (!anchors.length) return null;

    const updatedAt = options.updated_at || options.now || event?.committed_at || normalizedSession.updated_at || Date.now();
    const sourceMetadata = contextSourceMetadataFromReticleEvent(event, options);
    const artifact = createContextArtifactFromAnnotationSession(normalizedSession, {
        id: options.artifact_id,
        kind: options.kind || 'selection',
        mode: SIGIL_ANNOTATION_ENTRY_SOURCE,
        pointer: options.release_point || event?.release_point || null,
        candidate_report: options.decision_report || event?.decision_report || {},
        source_metadata: sourceMetadata,
        metadata: {
            source: 'sigil_annotation_reticle',
            source_event_type: event?.type || 'sigil.annotation_reticle.commit',
            committed_at: event?.committed_at || '',
            fallback: Boolean(options.fallback ?? event?.fallback),
            blocker_reason: String(options.blocker_reason ?? event?.blocker_reason ?? ''),
            target_limitation: String(options.target_limitation ?? event?.target_limitation ?? ''),
            root_evidence: clone(options.root_evidence || event?.root_evidence || null),
            placement: clone(options.placement || event?.placement || null),
            live_anchor_count: anchors.length,
            ...(options.artifact_metadata || {}),
        },
        now: updatedAt,
    });

    return createContextSession({
        id: options.id || options.session_id,
        created_at: options.created_at || updatedAt,
        updated_at: updatedAt,
        active: normalizedSession.active,
        entry_source: SIGIL_ANNOTATION_ENTRY_SOURCE,
        source_annotation_session: normalizedSession,
        artifacts: [artifact],
        active_artifact_id: artifact.id,
        metadata: {
            source: 'sigil_annotation_reticle',
            source_event_type: event?.type || 'sigil.annotation_reticle.commit',
            context_adapter: 'sigil_annotation_reticle_context_session_v0',
            fallback: Boolean(options.fallback ?? event?.fallback),
            blocker_reason: String(options.blocker_reason ?? event?.blocker_reason ?? ''),
            target_limitation: String(options.target_limitation ?? event?.target_limitation ?? ''),
            live_anchor_count: anchors.length,
            ...(options.metadata || {}),
        },
    });
}

export function resolveSigilAnnotationReticleTarget({
    candidates = [],
    display = null,
    pointer = null,
    role = 'pointer-preview',
    activeScope = null,
} = {}) {
    const sourceCandidates = Array.isArray(candidates) ? candidates : [];
    const decision = explainAnnotationCandidateChoice(sourceCandidates, activeScope, pointer);
    const chosen = chooseAnnotationCandidateForScope(sourceCandidates, activeScope, pointer);
    if (chosen) {
        const normalized = normalizeAnnotationCandidate({
            ...chosen,
            source_metadata: {
                ...objectOrEmpty(chosen.source_metadata || chosen.source_tree_node_metadata || chosen.metadata),
                ...bridgeMetadata(activeScope ? 'scoped_projectable_candidate_under_pointer' : 'projectable_candidate_under_pointer', pointer, sourceCandidates.length),
                active_scope_address: activeScope?.address || '',
                sigil_fallback: false,
                target_source: decisionSource(chosen),
            },
        });
        decision.selected = {
            ...objectOrEmpty(decision.selected),
            source: decisionSource(normalized),
        };
        return {
            subject: normalized,
            fallback: false,
            blocker_reason: '',
            target_limitation: '',
            decision_report: decision,
        };
    }
    const fallback = role === 'release-target'
        ? createDisplayAnnotationSubject(display, pointer, { role })
        : createPointerAnnotationSubject(display, pointer);
    const blockerReason = sourceCandidates.length
        ? (decision.fallback_reason || 'no_projectable_candidate_under_pointer')
        : 'annotation_candidate_cache_empty';
    decision.fallback_reason = blockerReason;
    return {
        subject: {
            ...fallback,
            source_metadata: {
                ...objectOrEmpty(fallback.source_metadata),
                ...bridgeMetadata(blockerReason, pointer, sourceCandidates.length),
                sigil_fallback: true,
                target_source: 'display_fallback',
            },
            projection: {
                ...objectOrEmpty(fallback.projection),
                source_metadata: {
                    ...objectOrEmpty(fallback.projection?.source_metadata),
                    ...bridgeMetadata(blockerReason, pointer, sourceCandidates.length),
                    sigil_fallback: true,
                    target_source: 'display_fallback',
                },
            },
            blocker_reason: blockerReason,
            blocker: { reason: blockerReason },
        },
        fallback: true,
        blocker_reason: blockerReason,
        target_limitation: 'display_under_release_pointer_v0',
        decision_report: decision,
    };
}

function semanticCandidateKey(candidate = null) {
    const key = candidate?.id || candidate?.subject_id || candidate;
    return key ? String(key) : '';
}

export function createAnnotationReticleTargetEvidenceCache() {
    return {
        candidates: new Map(),
        canvases: new Map(),
        semanticTargetsByCanvas: new Map(),
        latestNativeWindowEvent: null,
        latestNativeAxElementEvent: null,
    };
}

export function clearAnnotationReticleSemanticCandidatesForCanvas(evidence = null, canvasId = '') {
    const id = String(canvasId || '').trim();
    if (!evidence || !id) return [];
    const owned = evidence.semanticTargetsByCanvas?.get(id);
    const ownedIds = owned instanceof Set
        ? [...owned]
        : (Array.isArray(owned) ? owned.map(semanticCandidateKey) : []);
    const removed = [];
    for (const candidateId of ownedIds) {
        if (!candidateId) continue;
        if (evidence.candidates?.delete(String(candidateId))) removed.push(String(candidateId));
    }
    evidence.semanticTargetsByCanvas?.delete(id);
    return removed;
}

export function recordAnnotationReticleSemanticCandidateIds(evidence = null, canvasId = '', candidateIds = []) {
    const id = String(canvasId || '').trim();
    if (!evidence || !id) return [];
    const ids = [...new Set((Array.isArray(candidateIds) ? candidateIds : [])
        .map((candidateId) => String(candidateId || '').trim())
        .filter(Boolean))];
    if (ids.length) {
        evidence.semanticTargetsByCanvas?.set(id, new Set(ids));
    } else {
        evidence.semanticTargetsByCanvas?.delete(id);
    }
    return ids;
}

function distance(a, b) {
    return Math.hypot(finite(a.x) - finite(b.x), finite(a.y) - finite(b.y));
}

function pointFitsDisplay(point, displayRect, halfWidth, halfHeight) {
    return point.x - halfWidth >= displayRect.x
        && point.x + halfWidth <= displayRect.x + displayRect.w
        && point.y - halfHeight >= displayRect.y
        && point.y + halfHeight <= displayRect.y + displayRect.h;
}

function candidate(label, x, y, status = label) {
    return { label, status, point: { x, y, valid: true } };
}

export function chooseAnnotationTravelPlacement({
    targetRect,
    displayRect,
    releasePoint,
    avatarHitRadius = 40,
    margin = 16,
} = {}) {
    const target = targetRect || displayRect;
    const display = displayRect || targetRect;
    if (!target || !display) {
        return {
            point: releasePoint ? { x: finite(releasePoint.x), y: finite(releasePoint.y), valid: true } : null,
            placement_status: 'unresolved',
            candidates_considered: [],
        };
    }
    const half = Math.max(1, finite(avatarHitRadius, 40));
    const offset = half + Math.max(0, finite(margin, 16));
    const release = releasePoint || { x: target.x + target.w / 2, y: target.y + target.h / 2 };
    const outside = [
        candidate('outside_top_left', target.x - offset, target.y - offset, 'outside_corner'),
        candidate('outside_top_right', target.x + target.w + offset, target.y - offset, 'outside_corner'),
        candidate('outside_bottom_left', target.x - offset, target.y + target.h + offset, 'outside_corner'),
        candidate('outside_bottom_right', target.x + target.w + offset, target.y + target.h + offset, 'outside_corner'),
    ].sort((a, b) => distance(a.point, release) - distance(b.point, release));
    const inside = [
        candidate('inside_top_left', target.x + offset, target.y + offset, 'inside_corner'),
        candidate('inside_top_right', target.x + target.w - offset, target.y + offset, 'inside_corner'),
        candidate('inside_bottom_left', target.x + offset, target.y + target.h - offset, 'inside_corner'),
        candidate('inside_bottom_right', target.x + target.w - offset, target.y + target.h - offset, 'inside_corner'),
    ].sort((a, b) => distance(a.point, release) - distance(b.point, release));
    const edges = [
        candidate('edge_top', target.x + target.w / 2, target.y + offset, 'edge_midpoint'),
        candidate('edge_right', target.x + target.w - offset, target.y + target.h / 2, 'edge_midpoint'),
        candidate('edge_bottom', target.x + target.w / 2, target.y + target.h - offset, 'edge_midpoint'),
        candidate('edge_left', target.x + offset, target.y + target.h / 2, 'edge_midpoint'),
    ].sort((a, b) => distance(a.point, release) - distance(b.point, release));
    const candidates = [...outside, ...inside, ...edges];
    const chosen = candidates.find((entry) => pointFitsDisplay(entry.point, display, half, half));
    if (chosen) {
        return {
            point: chosen.point,
            placement_status: chosen.status,
            candidate: chosen.label,
            candidates_considered: candidates.map((entry) => entry.label),
        };
    }
    return {
        point: {
            x: target.x + target.w / 2,
            y: target.y + target.h / 2,
            valid: true,
        },
        placement_status: 'constrained',
        candidate: 'target_center',
        candidates_considered: [...candidates.map((entry) => entry.label), 'target_center'],
    };
}

export function createSigilAnnotationReticleController({
    getDisplays = () => [],
    getAvatarPos = () => null,
    getAvatarHitRadius = () => 40,
    getAnnotationCandidates = () => [],
    now = () => Date.now(),
} = {}) {
    let session = createAnnotationSession({ entry_source: SIGIL_ANNOTATION_ENTRY_SOURCE });
    let active = false;
    let previewPointer = null;
    let rootEvidence = null;
    let lastCommit = null;
    let lastExitReason = null;
    let lastScopeBlocker = null;
    let lastDecisionReport = null;
    let contextSession = null;

    function enter(pointer = null) {
        const avatarPos = getAvatarPos() || pointer || { x: 0, y: 0, valid: true };
        const display = findDisplay(getDisplays(), avatarPos);
        const root = createDisplayAnnotationSubject(display, avatarPos, { role: 'root' });
        const priorScopeStack = liveCommittedScopeStack(session);
        const committedScopeStack = priorScopeStack.length ? priorScopeStack : [root];
        lastScopeBlocker = priorScopeStack.length ? null : (session.anchors?.length ? 'previous_scope_not_live' : null);
        session = enterAnnotationSession(session, {
            entry_source: SIGIL_ANNOTATION_ENTRY_SOURCE,
            root: priorScopeStack[0] || root,
            committed_scope_stack: committedScopeStack,
            preview_scope_stack: committedScopeStack,
            now: now(),
        });
        active = true;
        previewPointer = pointer ? { x: finite(pointer.x), y: finite(pointer.y), valid: true } : null;
        rootEvidence = {
            display: displayId(display),
            root: session.root,
            active_scope: latestCommittedScope(session),
            blocker_reason: lastScopeBlocker || '',
        };
        lastExitReason = null;
        return snapshot();
    }

    function updatePreview(pointer = null) {
        if (!active || !pointer) return snapshot();
        const displays = getDisplays();
        const display = findDisplay(displays, pointer);
        const resolved = resolveSigilAnnotationReticleTarget({
            candidates: getAnnotationCandidates(pointer),
            display,
            pointer,
            role: 'pointer-preview',
            activeScope: latestCommittedScope(session),
        });
        const hover = resolved.subject;
        lastDecisionReport = resolved.decision_report || null;
        previewPointer = { x: finite(pointer.x), y: finite(pointer.y), valid: true };
        session = setAnnotationHoverCandidate(session, hover, { now: now() });
        return snapshot();
    }

    function exit(reason = 'exit') {
        active = false;
        previewPointer = null;
        lastExitReason = reason;
        session = createAnnotationSession({
            ...session,
            active: false,
            hover_candidate: null,
            preview_scope_stack: session.committed_scope_stack,
            updated_at: now(),
        });
        return snapshot();
    }

    function commitRelease(pointer = null) {
        if (!active) return null;
        updatePreview(pointer);
        const displays = getDisplays();
        const display = findDisplay(displays, pointer || previewPointer);
        const displayRect = rectFromDisplay(display);
        const releasePoint = pointer ? { x: finite(pointer.x), y: finite(pointer.y), valid: true } : previewPointer;
        const resolved = resolveSigilAnnotationReticleTarget({
            candidates: getAnnotationCandidates(releasePoint),
            display,
            pointer: releasePoint,
            role: 'release-target',
            activeScope: latestCommittedScope(session),
        });
        const target = resolved.subject;
        lastDecisionReport = resolved.decision_report || null;
        session = setAnnotationHoverCandidate(session, target, { now: now() });
        session = commitAnnotationPreview(session, { now: now(), actor: { role: 'sigil', id: 'radial-reticle' } });
        const targetRect = subjectProjectionRect(target) || displayRect;
        const placement = chooseAnnotationTravelPlacement({
            targetRect,
            displayRect,
            releasePoint,
            avatarHitRadius: getAvatarHitRadius(),
        });
        active = false;
        previewPointer = releasePoint;
        lastExitReason = 'commit';
        session = createAnnotationSession({
            ...session,
            active: false,
            updated_at: now(),
        });
        const commitEvent = {
            type: 'sigil.annotation_reticle.commit',
            entry_source: SIGIL_ANNOTATION_ENTRY_SOURCE,
            committed_at: new Date(now()).toISOString(),
            root: session.root,
            root_evidence: rootEvidence,
            active_scope: latestCommittedScope(session),
            release_point: releasePoint,
            preview_target: target,
            target_limitation: resolved.target_limitation,
            fallback: resolved.fallback,
            blocker_reason: resolved.blocker_reason,
            decision_report: resolved.decision_report || null,
            placement,
            session,
        };
        contextSession = createSigilAnnotationReticleContextSession(commitEvent);
        lastCommit = {
            ...commitEvent,
            context_session: contextSession,
        };
        return lastCommit;
    }

    function requestSnapshotEvent() {
        return {
            type: 'sigil.annotation_reticle.snapshot_request',
            entry_source: SIGIL_ANNOTATION_ENTRY_SOURCE,
            requested_at: new Date(now()).toISOString(),
            available: cameraAvailable(),
            anchor_count: liveAnchors().length,
            session,
            context_session: contextSession,
        };
    }

    function liveAnchors() {
        return session.anchors.filter((anchor) => anchor.status === 'live');
    }

    function cameraAvailable() {
        return liveAnchors().length > 0;
    }

    function snapshot() {
        return {
            active,
            entry_source: SIGIL_ANNOTATION_ENTRY_SOURCE,
            root_evidence: rootEvidence,
            active_scope: latestCommittedScope(session),
            scope_blocker_reason: lastScopeBlocker || '',
            preview_pointer: previewPointer,
            preview_target: session.hover_candidate,
            decision_report: lastDecisionReport,
            last_committed_event: lastCommit,
            context_session: contextSession,
            last_exit_reason: lastExitReason,
            camera_available: cameraAvailable(),
            live_anchor_count: liveAnchors().length,
            session,
        };
    }

    function applySnapshot(value = null) {
        if (!value || typeof value !== 'object') return;
        active = Boolean(value.active);
        previewPointer = value.preview_pointer || null;
        rootEvidence = value.root_evidence || null;
        lastCommit = value.last_committed_event || null;
        contextSession = value.context_session || lastCommit?.context_session || null;
        lastExitReason = value.last_exit_reason || null;
        lastDecisionReport = value.decision_report || null;
        session = createAnnotationSession(value.session || {
            active,
            entry_source: SIGIL_ANNOTATION_ENTRY_SOURCE,
        });
    }

    return {
        enter,
        updatePreview,
        exit,
        commitRelease,
        requestSnapshotEvent,
        snapshot,
        applySnapshot,
        get active() {
            return active;
        },
        get cameraAvailable() {
            return cameraAvailable();
        },
    };
}

export function reticleOuterMarginExit(metrics = null, radial = null) {
    if (!metrics || !radial) return false;
    if (metrics.relation !== 'outward') return false;
    const item = Array.isArray(radial.items)
        ? radial.items.find((candidate) => candidate?.id === metrics.itemId)
        : null;
    if (!item) return false;
    const lateralLimit = Math.max(0, finite(item.hitRadius, finite(item.visualRadius, 0)));
    if (metrics.lateralDistance > lateralLimit) return false;
    const handoffRadius = finite(radial.radii?.handoff, finite(radial.handoffRadius, metrics.pointerDistance));
    const outerMargin = Math.max(lateralLimit, handoffRadius - metrics.centerDistance + lateralLimit);
    return metrics.axialDistance > 0 && metrics.axialDistance <= outerMargin;
}

export function createAnnotationReticleAcquisitionState({ itemId = SIGIL_ANNOTATION_RETICLE_ITEM_ID } = {}) {
    let candidateItemId = null;

    function reset() {
        candidateItemId = null;
    }

    function update(radial = null, metrics = null) {
        if (!radial || !metrics || metrics.itemId !== itemId) {
            reset();
            return { acquire: false, candidateItemId };
        }
        if (radial.phase === 'radial' && metrics.relation === 'inside') {
            candidateItemId = metrics.itemId;
            return { acquire: false, candidateItemId };
        }
        if (radial.phase === 'radial' && candidateItemId === metrics.itemId && metrics.relation === 'outward') {
            return { acquire: false, candidateItemId };
        }
        if (radial.phase === 'fastTravel' && candidateItemId === metrics.itemId && reticleOuterMarginExit(metrics, radial)) {
            return { acquire: true, candidateItemId };
        }
        if (radial.phase === 'radial') reset();
        if (radial.phase === 'fastTravel' && candidateItemId === metrics.itemId) reset();
        return { acquire: false, candidateItemId };
    }

    function snapshot() {
        return { candidateItemId };
    }

    return {
        reset,
        update,
        snapshot,
    };
}

export function annotationReticleReleaseDisposition(result = null) {
    const committed = result?.committed || null;
    if (committed?.type !== 'item') return {
        exit: false,
        reason: '',
    };
    if (committed.itemId !== SIGIL_ANNOTATION_RETICLE_ITEM_ID) return {
        exit: false,
        reason: '',
    };
    return {
        exit: true,
        reason: 'annotation-reticle-item-click',
    };
}

function projectionRectForSubject(subject = null) {
    const projection = objectOrEmpty(subject?.projection);
    const rect = objectOrEmpty(projection.visible_display_rect || projection.display_space_rect);
    const x = finite(rect.x ?? rect.left, NaN);
    const y = finite(rect.y ?? rect.top, NaN);
    const width = finite(rect.width ?? rect.w, NaN);
    const height = finite(rect.height ?? rect.h, NaN);
    if (![x, y, width, height].every(Number.isFinite) || width <= 0 || height <= 0) return null;
    return { x, y, width, height };
}

function frameEntry(kind, subject = null, options = {}) {
    const rect = projectionRectForSubject(subject);
    if (!rect) return null;
    return {
        kind,
        address: subject?.address || null,
        label: subject?.label || subject?.root_label || kind,
        rect,
        active: !!options.active,
        opacity: Number.isFinite(Number(options.opacity)) ? Number(options.opacity) : 1,
    };
}

function opacityForDepth(index, count, floor = 0.75) {
    if (count <= 1) return 1;
    const t = index / (count - 1);
    return floor + (t * (1 - floor));
}

export function buildAnnotationReticleOverlayModel(snapshot = null) {
    if (!snapshot || typeof snapshot !== 'object') {
        return { visible: false, frames: [], anchors: [], hover: null };
    }
    const session = objectOrEmpty(snapshot.session);
    const previewStack = Array.isArray(session.preview_scope_stack) ? session.preview_scope_stack : [];
    const committedStack = Array.isArray(session.committed_scope_stack) ? session.committed_scope_stack : [];
    const scopeStack = previewStack.length ? previewStack : committedStack;
    const frames = scopeStack
        .map((subject, index) => frameEntry(index === scopeStack.length - 1 ? 'current_scope' : 'scope', subject, {
            active: index === scopeStack.length - 1,
            opacity: opacityForDepth(index, scopeStack.length),
        }))
        .filter(Boolean);
    const hover = frameEntry('hover_candidate', session.hover_candidate || snapshot.preview_target, {
        active: true,
        opacity: 0.92,
    });
    const anchors = Array.isArray(session.anchors)
        ? session.anchors
            .map((anchor) => frameEntry('live_anchor', {
                address: anchor.address,
                label: anchor.label || anchor.address || 'Annotation anchor',
                projection: anchor.projection,
            }, { opacity: 0.82 }))
            .filter(Boolean)
        : [];
    return {
        visible: !!snapshot.active || anchors.length > 0,
        frames,
        hover,
        anchors,
    };
}
