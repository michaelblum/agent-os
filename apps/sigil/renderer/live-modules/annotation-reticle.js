import { toolkitSpecifier } from './content-roots.js';
import { findDisplayForPoint } from './display-utils.js';

const {
    createAnnotationSession,
    enterAnnotationSession,
    setAnnotationHoverCandidate,
    commitAnnotationPreview,
} = await import(toolkitSpecifier('workbench/annotation-session.js'));

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
    now = () => Date.now(),
} = {}) {
    let session = createAnnotationSession({ entry_source: SIGIL_ANNOTATION_ENTRY_SOURCE });
    let active = false;
    let previewPointer = null;
    let rootEvidence = null;
    let lastCommit = null;
    let lastExitReason = null;

    function enter(pointer = null) {
        const avatarPos = getAvatarPos() || pointer || { x: 0, y: 0, valid: true };
        const display = findDisplay(getDisplays(), avatarPos);
        const root = createDisplayAnnotationSubject(display, avatarPos, { role: 'root' });
        session = enterAnnotationSession(session, {
            entry_source: SIGIL_ANNOTATION_ENTRY_SOURCE,
            root,
            committed_scope_stack: [root],
            preview_scope_stack: [root],
            now: now(),
        });
        active = true;
        previewPointer = pointer ? { x: finite(pointer.x), y: finite(pointer.y), valid: true } : null;
        rootEvidence = { display: displayId(display), root };
        lastExitReason = null;
        return snapshot();
    }

    function updatePreview(pointer = null) {
        if (!active || !pointer) return snapshot();
        const displays = getDisplays();
        const display = findDisplay(displays, pointer);
        const hover = createPointerAnnotationSubject(display, pointer);
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
        const target = createDisplayAnnotationSubject(display, releasePoint, { role: 'release-target' });
        session = setAnnotationHoverCandidate(session, target, { now: now() });
        session = commitAnnotationPreview(session, { now: now(), actor: { role: 'sigil', id: 'radial-reticle' } });
        const placement = chooseAnnotationTravelPlacement({
            targetRect: displayRect,
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
        lastCommit = {
            type: 'sigil.annotation_reticle.commit',
            entry_source: SIGIL_ANNOTATION_ENTRY_SOURCE,
            committed_at: new Date(now()).toISOString(),
            root: session.root,
            root_evidence: rootEvidence,
            release_point: releasePoint,
            preview_target: target,
            target_limitation: 'display_under_release_pointer_v0',
            placement,
            session,
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
            preview_pointer: previewPointer,
            preview_target: session.hover_candidate,
            last_committed_event: lastCommit,
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
        lastExitReason = value.last_exit_reason || null;
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
