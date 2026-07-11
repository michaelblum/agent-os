export function readyExecutionPlan(
  response,
  { repair = false, postPermission = false } = {},
) {
  const blockers = response.blockers ?? [];
  const blockerIDs = new Set(blockers.map((blocker) => blocker.id));
  const mode = repair ? 'repair' : (postPermission ? 'post_permission_check' : 'check');
  const base = {
    mode,
    diagnosis: response.diagnosis,
    next_actions: response.next_actions ?? [],
    mutation_allowed: repair,
    actions: [],
    action_trace: [],
  };

  if (!repair) {
    return {
      ...base,
      action_trace: [{
        step: 'ready_preflight',
        result: response.ready ? 'ready' : 'diagnosed',
        detail: response.ready
          ? 'managed daemon is already reachable, owned by the expected runtime, and input tap is active'
          : `${postPermission ? 'post-permission verification' : 'readiness check'} is read-only; no runtime mutation attempted`,
      }],
    };
  }

  if (response.ready) {
    return {
      ...base,
      action_trace: [{
        step: 'ready_preflight',
        result: 'ready',
        detail: 'managed daemon is already reachable, owned by the expected runtime, and input tap is active',
      }],
    };
  }

  if (blockerIDs.has('agent_os_worktree_default_runtime')) {
    return {
      ...base,
      action_trace: [{
        step: 'ready_preflight',
        result: 'runtime_policy_blocked',
        detail: 'linked git worktrees cannot use the default agent-os repo runtime',
      }],
    };
  }

  if (blockerIDs.has('daemon_unmanaged')) {
    return {
      ...base,
      action_trace: [{
        step: 'ready_preflight',
        result: 'runtime_policy_blocked',
        detail: 'an unmanaged daemon owns the runtime; no service mutation attempted',
      }],
    };
  }

  if (blockerIDs.has('stale_daemons') || blockerIDs.has('daemon_foreground_dev_default')) {
    return {
      ...base,
      actions: ['clean', 'restart_if_needed', 'permission_handoff_if_needed'],
      action_trace: [{
        step: 'ready_preflight',
        result: 'cleanup_required',
        detail: 'cleanup must run before service start or restart',
      }],
    };
  }

  return {
    ...base,
    actions: ['start', 'restart_if_needed', 'permission_handoff_if_needed'],
  };
}
