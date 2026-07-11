const RESTARTABLE_BLOCKERS = new Set([
  'daemon_unreachable',
  'daemon_ownership_mismatch',
  'input_tap_not_active',
]);

function hasTrace(response, step) {
  return (response.action_trace ?? []).some((entry) => entry.step === step);
}

function stop(trace = undefined) {
  return trace ? { type: 'stop', trace } : { type: 'stop' };
}

export function nextReadyExecutionStep(
  response,
  { repair = false, postPermission = false, prefix = './aos', mode = response.mode } = {},
) {
  if (!repair) {
    return stop({
      step: 'ready_preflight',
      result: response.ready ? 'ready' : 'diagnosed',
      detail: response.ready
        ? 'managed daemon is already reachable, owned by the expected runtime, and input tap is active'
        : `${postPermission ? 'post-permission verification' : 'readiness check'} is read-only; no runtime mutation attempted`,
    });
  }

  if (response.ready) {
    return stop(response.action_trace?.length ? undefined : {
      step: 'ready_preflight',
      result: 'ready',
      detail: 'managed daemon is already reachable, owned by the expected runtime, and input tap is active',
    });
  }

  const blockers = response.blockers ?? [];
  const blockerIDs = new Set(blockers.map((blocker) => blocker.id));
  if (blockerIDs.has('agent_os_worktree_default_runtime')) {
    return stop({
      step: 'ready_preflight',
      result: 'runtime_policy_blocked',
      detail: 'linked git worktrees cannot use the default agent-os repo runtime',
    });
  }
  if (blockerIDs.has('daemon_unmanaged')) {
    return stop({
      step: 'ready_preflight',
      result: 'runtime_policy_blocked',
      detail: 'an unmanaged daemon owns the runtime; no service mutation attempted',
    });
  }

  const cleanupRequired = blockerIDs.has('stale_daemons')
    || blockerIDs.has('daemon_foreground_dev_default');
  if (cleanupRequired) {
    if (!hasTrace(response, 'clean')) return { type: 'clean' };
    return stop();
  }

  const started = hasTrace(response, 'service_start');
  const cleaned = hasTrace(response, 'clean');
  const restarted = hasTrace(response, 'service_restart');
  if (!started && !cleaned && !restarted) return { type: 'start' };

  const restartable = blockers.some((blocker) => RESTARTABLE_BLOCKERS.has(blocker.id));
  if (restartable && !restarted) return { type: 'restart' };

  const needsPermissionHandoff = blockers.some((blocker) => blocker.kind === 'permission');
  if (needsPermissionHandoff && !hasTrace(response, 'runtime_tcc_reset_handoff')) {
    return {
      type: 'permission_handoff',
      trace: {
        step: 'runtime_tcc_reset_handoff',
        result: 'human_required',
        detail: `${prefix} permissions reset-runtime --mode ${mode}`,
      },
    };
  }

  return stop();
}
