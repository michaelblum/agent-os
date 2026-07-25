import { toolkitSpecifier } from './content-roots.js';
import {
    AGENT_TERMINAL_CANVAS_ID,
    AGENT_TERMINAL_URL,
    LEGACY_CODEX_TERMINAL_CANVAS_ID,
    createSigilUtilityCanvasIdSet,
    utilityConfig as createUtilityConfig,
} from './utility-canvas-config.js';

const {
    createUtilitySurfaceManager,
} = await import(toolkitSpecifier('runtime/utility-surface-manager.js'));

export function createSigilUtilityCanvasRuntime({
    host,
    liveState,
    avatarParking,
    avatarPanel = null,
    publishStatusMenuItems = () => {},
    nativePointFromMessageOrigin,
    statusCollapseFrameFromOrigin,
    consoleObject = console,
    performanceObject = globalThis.performance || { now: () => Date.now() },
    requestAnimationFrameFn = globalThis.requestAnimationFrame || ((callback) => setTimeout(() => callback(performanceObject.now()), 16)),
} = {}) {
    if (!host) throw new Error('createSigilUtilityCanvasRuntime requires host');
    if (!liveState) throw new Error('createSigilUtilityCanvasRuntime requires liveState');

    const utilityCanvasIds = createSigilUtilityCanvasIdSet([
        avatarPanel?.id,
    ].filter(Boolean));

    function utilityConfig(kind) {
        return createUtilityConfig(kind, {
            displays: liveState.displays || [],
            visibleBounds: liveState.visibleBounds,
        });
    }

    function agentTerminalFrame() {
        return utilityConfig('agent-terminal').frame;
    }

    function agentTerminalState() {
        return liveState.utilityCanvases.get(AGENT_TERMINAL_CANVAS_ID)
            || liveState.utilityCanvases.get(LEGACY_CODEX_TERMINAL_CANVAS_ID)
            || null;
    }

    function isAgentTerminalCanvasId(id) {
        return id === AGENT_TERMINAL_CANVAS_ID || id === LEGACY_CODEX_TERMINAL_CANVAS_ID;
    }

    function isAgentTerminalParkedAtStatus() {
        return avatarParking.isParkedAtStatus();
    }

    function parkAvatarInTerminal(frameLike) {
        const frame = Array.isArray(frameLike) ? frameLike : agentTerminalState()?.at;
        return avatarParking.parkInTerminal(frame);
    }

    function parkAvatarAtStatus(msg) {
        return avatarParking.parkAtStatusMessage(msg);
    }

    function clearAvatarParking({ restoreVisible = true } = {}) {
        return avatarParking.clear({ restoreVisible });
    }

    const manager = createUtilitySurfaceManager({
        host,
        states: liveState.utilityCanvases,
        openPromises: liveState.utilityCanvasOpenPromises,
        managedIds: utilityCanvasIds,
        resolveConfig: utilityConfig,
        logger: { warn() {} },
        onSuspend({ config }) {
            if (isAgentTerminalCanvasId(config.id) && liveState.avatarParking?.mode === 'terminal') {
                clearAvatarParking({ restoreVisible: true });
            }
        },
        onResume({ config, frame }) {
            if (isAgentTerminalCanvasId(config.id)) {
                parkAvatarInTerminal(frame);
            }
        },
        onCreate({ config, frame, suspended }) {
            if (!suspended && isAgentTerminalCanvasId(config.id)) {
                parkAvatarInTerminal(frame);
            }
        },
    });
    let agentTerminalTransition = null;

    function isUtilityCanvasVisible(id) {
        return manager.isVisible(id);
    }

    function isAgentTerminalVisible() {
        const current = agentTerminalState();
        return liveState.avatarParking?.mode === 'terminal' || (!!current && current.suspended !== true);
    }

    function animateUtilityCanvasFrame(id, from, to, durationMs = 180) {
        if (!Array.isArray(from) || !Array.isArray(to) || from.length < 4 || to.length < 4) {
            return Promise.resolve();
        }
        return new Promise((resolve, reject) => {
            const startedAt = performanceObject.now();
            function step(now) {
                try {
                    const t = Math.min(1, (now - startedAt) / durationMs);
                    const eased = 1 - Math.pow(1 - t, 3);
                    const frame = from.map((value, index) => value + (to[index] - value) * eased);
                    host.canvasUpdate({ id, frame });
                    if (t >= 1) {
                        resolve();
                        return;
                    }
                    requestAnimationFrameFn(step);
                } catch (error) {
                    reject(error);
                }
            }
            requestAnimationFrameFn(step);
        });
    }

    async function runAgentTerminalTransition({
        kind,
        targetId,
        mutateHost,
        rollbackHost,
        commit,
    }) {
        if (agentTerminalTransition) return false;
        const hadState = liveState.utilityCanvases.has(targetId);
        const previousState = liveState.utilityCanvases.get(targetId);
        const previousPending = liveState.pendingAgentTerminalCollapse;
        const previousStatusPoint = liveState.pendingAgentTerminalStatusPoint;
        const transition = { kind, targetId, removed: false };
        agentTerminalTransition = transition;
        try {
            await mutateHost();
            if (transition.removed) {
                throw new Error(`agent terminal was removed during ${kind}`);
            }
            commit();
            return true;
        } catch (error) {
            if (!transition.removed) {
                try {
                    await rollbackHost();
                } catch (rollbackError) {
                    consoleObject.warn(`[sigil] agent terminal ${kind} rollback failed:`, rollbackError);
                }
                if (hadState) liveState.utilityCanvases.set(targetId, previousState);
                else liveState.utilityCanvases.delete(targetId);
                liveState.pendingAgentTerminalCollapse = previousPending;
                liveState.pendingAgentTerminalStatusPoint = previousStatusPoint;
            }
            throw error;
        } finally {
            if (agentTerminalTransition === transition) agentTerminalTransition = null;
        }
    }

    async function collapseAgentTerminalToStatus(msg) {
        const current = agentTerminalState();
        const origin = nativePointFromMessageOrigin(msg);
        if (!current || !origin) return false;
        const targetId = isAgentTerminalCanvasId(current.id) ? current.id : AGENT_TERMINAL_CANVAS_ID;
        const from = Array.isArray(current.at) ? current.at.map(Number) : agentTerminalFrame();
        const to = statusCollapseFrameFromOrigin(origin);
        let suspendAttempted = false;
        return runAgentTerminalTransition({
            kind: 'collapse',
            targetId,
            async mutateHost() {
                await animateUtilityCanvasFrame(targetId, from, to, 180);
                suspendAttempted = true;
                await host.canvasSuspend(targetId);
                host.canvasUpdate({ id: targetId, frame: from });
            },
            async rollbackHost() {
                let rollbackError = null;
                try {
                    host.canvasUpdate({ id: targetId, frame: from });
                } catch (error) {
                    rollbackError = error;
                }
                if (suspendAttempted) {
                    try {
                        await host.canvasResume(targetId);
                    } catch (error) {
                        rollbackError ||= error;
                    }
                }
                if (rollbackError) throw rollbackError;
            },
            commit() {
                liveState.utilityCanvases.set(targetId, { ...current, id: targetId, suspended: true, at: from });
                liveState.pendingAgentTerminalCollapse = 'status';
                liveState.pendingAgentTerminalStatusPoint = { ...origin };
                parkAvatarAtStatus(msg);
            },
        });
    }

    async function restoreAgentTerminalFromStatus() {
        const current = agentTerminalState();
        if (!current) return false;
        const targetId = isAgentTerminalCanvasId(current.id) ? current.id : AGENT_TERMINAL_CANVAS_ID;
        const frame = Array.isArray(current.at) ? current.at : agentTerminalFrame();
        let resumeAttempted = false;
        return runAgentTerminalTransition({
            kind: 'restore',
            targetId,
            async mutateHost() {
                host.canvasUpdate({ id: targetId, frame });
                resumeAttempted = true;
                await host.canvasResume(targetId);
            },
            async rollbackHost() {
                if (resumeAttempted) await host.canvasSuspend(targetId);
            },
            commit() {
                liveState.utilityCanvases.set(targetId, { ...current, id: targetId, suspended: false, at: frame });
                liveState.pendingAgentTerminalCollapse = null;
                liveState.pendingAgentTerminalStatusPoint = null;
                parkAvatarInTerminal(frame);
            },
        });
    }

    async function prewarmAgentTerminalCanvas() {
        if (liveState._agentTerminalPrewarmStarted) return;
        liveState._agentTerminalPrewarmStarted = true;
        liveState.prewarmingAgentTerminal = true;
        try {
            return await manager.prewarm({
                id: AGENT_TERMINAL_CANVAS_ID,
                url: AGENT_TERMINAL_URL,
                frame: agentTerminalFrame(),
                interactive: true,
            }, { focus: false });
        } catch (error) {
            liveState._agentTerminalPrewarmStarted = false;
            consoleObject.warn('[sigil] agent terminal prewarm failed:', error);
            return null;
        } finally {
            liveState.prewarmingAgentTerminal = false;
        }
    }

    async function prewarmAvatarPanelCanvas() {
        if (!avatarPanel?.usesExternalPanel?.()) return;
        if (liveState._avatarPanelPrewarmStarted) return;
        liveState._avatarPanelPrewarmStarted = true;
        try {
            await manager.prewarm({
                id: avatarPanel.id,
                url: avatarPanel.url,
                frame: avatarPanel.frame,
                interactive: true,
                window_level: 'floating',
            }, { focus: false });
        } catch (error) {
            consoleObject.warn('[sigil] avatar panel prewarm failed:', error);
        }
    }

    async function toggleUtilityCanvas(kind) {
        try {
            await manager.toggle(kind);
        } catch (error) {
            consoleObject.warn('[sigil] utility toggle failed:', kind, error);
        } finally {
            publishStatusMenuItems();
        }
    }

    async function ensureUtilityCanvasVisible(kind, { focus = true } = {}) {
        try {
            return await manager.ensureVisible(kind, { focus });
        } finally {
            publishStatusMenuItems();
        }
    }

    function handleCanvasLifecycle(msg = {}) {
        const canvasId = msg.canvas_id || msg.canvas?.id;
        const result = manager.handleLifecycle(msg);
        if (!result.handled) return false;

        if (isAgentTerminalCanvasId(canvasId)) {
            const suspended = msg.suspended ?? msg.canvas?.suspended;
            if (agentTerminalTransition?.targetId === canvasId) {
                if (msg.action === 'removed') agentTerminalTransition.removed = true;
                else {
                    publishStatusMenuItems();
                    return true;
                }
            }
            if (msg.action === 'removed') {
                clearAvatarParking({ restoreVisible: true });
                liveState.pendingAgentTerminalCollapse = null;
                liveState.pendingAgentTerminalStatusPoint = null;
                liveState.prewarmingAgentTerminal = false;
            } else if (liveState.prewarmingAgentTerminal) {
                if (suspended === true) {
                    liveState.utilityCanvases.set(canvasId, {
                        ...(agentTerminalState() || {}),
                        id: canvasId,
                        suspended: true,
                        at: agentTerminalFrame(),
                    });
                }
            } else if (suspended === true) {
                if (liveState.pendingAgentTerminalCollapse === 'status' || isAgentTerminalParkedAtStatus()) {
                    const statusPoint = liveState.pendingAgentTerminalStatusPoint || liveState.avatarParking?.nativePoint;
                    parkAvatarAtStatus({ origin_x: statusPoint?.x, origin_y: statusPoint?.y });
                } else if (liveState.avatarParking?.mode === 'terminal') {
                    clearAvatarParking({ restoreVisible: true });
                }
            } else if (liveState.pendingAgentTerminalCollapse === 'status') {
                const statusPoint = liveState.pendingAgentTerminalStatusPoint || liveState.avatarParking?.nativePoint;
                parkAvatarAtStatus({ origin_x: statusPoint?.x, origin_y: statusPoint?.y });
            } else {
                liveState.pendingAgentTerminalCollapse = null;
                liveState.pendingAgentTerminalStatusPoint = null;
                const frame = msg.at ?? msg.canvas?.at;
                parkAvatarInTerminal(frame);
            }
        }
        publishStatusMenuItems();
        return true;
    }

    return {
        utilityCanvasIds,
        utilityConfig,
        agentTerminalFrame,
        agentTerminalState,
        isAgentTerminalCanvasId,
        isAgentTerminalVisible,
        isUtilityCanvasVisible,
        isAgentTerminalParkedAtStatus,
        parkAvatarInTerminal,
        parkAvatarAtStatus,
        clearAvatarParking,
        collapseAgentTerminalToStatus,
        restoreAgentTerminalFromStatus,
        prewarmAgentTerminalCanvas,
        prewarmAvatarPanelCanvas,
        toggleUtilityCanvas,
        ensureUtilityCanvasVisible,
        handleCanvasLifecycle,
        snapshot: manager.snapshot,
    };
}
