import { brokerFacts } from './aos-facts.mjs';
import { invocationName } from './aos-cli.mjs';
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
  if (blockerID === 'daemon_unmanaged') return 'Return the unmanaged owner PID and command line to Foreman; do not loop service restart.';
  if (blockerID === 'stale_daemons') return `Run ${prefix} clean once, then re-check readiness after stale owners are removed.`;
  if (blockerID === 'daemon_unreachable' || blockerID === 'socket_unreachable') return 'Return the daemon/socket blocker to Foreman unless live-start permission was explicitly supplied.';
  if (blockerID === 'input_tap_not_active') return 'Return input_tap_not_active to Foreman; do not run TCC reset unless the verdict also names a permission blocker.';
  if (['accessibility', 'screen_recording', 'listen_access', 'post_access'].includes(blockerID)) return 'Return the permission blocker to Foreman for the TCC handoff path.';
  return 'Return this runtime blocker to Foreman with the runtime_verdict.';
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
  const resolvedFacts = facts ?? brokerFacts({
    daemonRequired: false,
    includeRuntime: true,
    includeClean: true,
  });
  const verdict = runtimeVerdict(resolvedFacts, mode, prefix);
  if (verdict.ready || allowStart) {
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
