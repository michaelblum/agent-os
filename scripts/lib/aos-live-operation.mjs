import { brokerFacts } from './aos-facts.mjs';
import { agentOSWorktreePolicy, invocationName } from './aos-cli.mjs';
import { runtimeVerdict } from './aos-readiness.mjs';

export function primaryRuntimeBlocker(verdict) {
  if (verdict?.diagnosis && verdict.diagnosis !== 'not_ready') {
    if (verdict.diagnosis === 'daemon_socket_unreachable') return 'socket_unreachable';
    return verdict.diagnosis;
  }
  const blocker = verdict?.blockers?.[0];
  if (blocker?.id === 'input_monitoring_listen') return 'listen_access';
  if (blocker?.id === 'input_monitoring_post') return 'post_access';
  if (blocker?.id === 'daemon_socket_unreachable') return 'socket_unreachable';
  if (blocker?.id === 'daemon_unreachable' && verdict?.ownership?.state === 'unreachable') return 'socket_unreachable';
  return blocker?.id || verdict?.diagnosis || 'runtime_blocked';
}

export function runtimeHandoffText(blockerID, prefix = invocationName()) {
  if (blockerID === 'agent_os_worktree_default_runtime') return 'Run AOS from the primary agent-os checkout, or set AOS_STATE_ROOT for an isolated runtime. Do not use linked worktrees with the default repo runtime.';
  if (blockerID === 'daemon_unmanaged') return 'Return the unmanaged owner PID and command line to the operator; do not loop service restart.';
  if (blockerID === 'daemon_foreground_dev_default') return `Run ${prefix} clean once, then re-check readiness; foreground dev daemons must use an isolated AOS_STATE_ROOT.`;
  if (blockerID === 'stale_daemons') return `Run ${prefix} clean once, then re-check readiness after stale owners are removed.`;
  if (blockerID === 'daemon_unreachable' || blockerID === 'socket_unreachable') return 'Return the daemon/socket blocker to the operator unless live-start permission was explicitly supplied.';
  if (blockerID === 'input_tap_not_active') return 'Return input_tap_not_active to the operator; do not run TCC reset unless the verdict also names a permission blocker.';
  if (['accessibility', 'screen_recording', 'listen_access', 'post_access'].includes(blockerID)) return 'Return the permission blocker to the operator for the TCC handoff path.';
  return 'Return this runtime blocker to the operator with the runtime_verdict.';
}

export function runtimeFailurePayload({
  operationId,
  condition,
  timeoutMs,
  verdict,
  prefix = invocationName(),
  code = 'RUNTIME_BLOCKED',
  error = 'Runtime is not ready for this live operation.',
} = {}) {
  const blocker = primaryRuntimeBlocker(verdict);
  return {
    status: 'failure',
    code,
    error,
    blocker,
    operation_id: operationId,
    ...(condition ? { pending_condition: condition } : {}),
    ...(timeoutMs !== undefined ? { timeout_ms: timeoutMs } : {}),
    runtime_verdict: verdict,
    next_action: runtimeHandoffText(blocker, prefix),
  };
}

export function worktreePolicyFailurePayload({
  operationId,
  policy,
} = {}) {
  return {
    status: 'failure',
    code: 'AGENT_OS_WORKTREE_DEFAULT_RUNTIME',
    error: policy?.message ?? 'agent-os linked git worktrees cannot use the default repo runtime.',
    blocker: 'agent_os_worktree_default_runtime',
    operation_id: operationId,
    worktree: policy?.worktree,
    next_action: runtimeHandoffText('agent_os_worktree_default_runtime'),
  };
}

export function guardAgentOSWorktreeDefaultRuntime({ operationId, mode = 'repo' } = {}) {
  const policy = agentOSWorktreePolicy({ mode });
  if (policy.allowed) return { ok: true, policy };
  return {
    ok: false,
    policy,
    failure: worktreePolicyFailurePayload({ operationId, policy }),
  };
}

export function guardedLiveOperation({
  operationId,
  allowStart = false,
  mode = 'repo',
  prefix = invocationName(),
  facts = null,
} = {}) {
  if (process.env.AOS_BYPASS_PREFLIGHT === '1') {
    return { ok: true, preflight: null };
  }
  const worktreeGuard = guardAgentOSWorktreeDefaultRuntime({ operationId, mode });
  if (!worktreeGuard.ok) {
    return {
      ok: false,
      preflight: null,
      failure: worktreeGuard.failure,
    };
  }
  const resolvedFacts = facts ?? brokerFacts({
    daemonRequired: false,
    includeRuntime: true,
    includeClean: true,
  });
  const verdict = runtimeVerdict(resolvedFacts, mode, prefix);
  const cleanupRequired = (verdict.blockers ?? []).some((blocker) => [
    'daemon_ownership_mismatch',
    'daemon_unmanaged',
    'agent_os_worktree_default_runtime',
    'daemon_foreground_dev_default',
    'stale_daemons',
  ].includes(blocker.id));
  if (verdict.ready || (allowStart && !cleanupRequired)) {
    return { ok: true, preflight: verdict };
  }
  return {
    ok: false,
    preflight: verdict,
    failure: runtimeFailurePayload({
      operationId,
      verdict,
      prefix,
      code: 'LIVE_START_NOT_ALLOWED',
      error: 'Live operation would require starting or repairing AOS, but --allow-start was not supplied.',
    }),
  };
}
