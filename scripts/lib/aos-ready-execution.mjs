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

function blockedPostPermissionRecovery(reason, detail) {
  return stop({
    step: 'post_permission_recovery',
    result: 'blocked',
    detail: `${reason}: ${detail}`,
  });
}

export function postPermissionRecoveryAuthority(
  runtime,
  service,
  { mode, expectedBinaryPath } = {},
) {
  if (!runtime || runtime.mode !== mode) {
    return {
      allowed: false,
      reason: 'runtime_mode_mismatch',
      detail: `requested mode=${mode ?? 'unknown'}, runtime mode=${runtime?.mode ?? 'unknown'}`,
    };
  }
  if (runtime.ownership_state !== 'consistent' || runtime.owner_launchd_managed !== true) {
    return {
      allowed: false,
      reason: runtime.ownership_state === 'mismatch'
        ? 'daemon_ownership_mismatch'
        : 'daemon_not_launchd_managed',
      detail: `ownership state=${runtime.ownership_state ?? 'unknown'}, launchd_managed=${runtime.owner_launchd_managed === true}`,
    };
  }
  if (!service || service.status === 'unavailable') {
    return {
      allowed: false,
      reason: 'service_identity_unavailable',
      detail: service?.error ?? 'managed service status could not be read',
    };
  }
  if (service.mode !== mode) {
    return {
      allowed: false,
      reason: 'service_mode_mismatch',
      detail: `requested mode=${mode}, service mode=${service.mode ?? 'unknown'}`,
    };
  }
  if (!service.installed || !service.loaded || !service.running) {
    return {
      allowed: false,
      reason: 'managed_service_not_running',
      detail: `installed=${Boolean(service.installed)}, loaded=${Boolean(service.loaded)}, running=${Boolean(service.running)}`,
    };
  }
  const targetMatches = service.target_matches_expected === true
    && service.actual_binary_path === service.expected_binary_path
    && service.expected_binary_path === expectedBinaryPath;
  if (!targetMatches) {
    return {
      allowed: false,
      reason: 'binary_identity_mismatch',
      detail: `actual=${service.actual_binary_path ?? 'unknown'}, service_expected=${service.expected_binary_path ?? 'unknown'}, ready_expected=${expectedBinaryPath ?? 'unknown'}`,
    };
  }
  return {
    allowed: true,
    mode,
    binary_path: expectedBinaryPath,
    service_pid: service.pid,
    daemon_pid: runtime.serving_pid ?? runtime.daemon_pid,
  };
}

function liveInputTapConfirmed(response) {
  const tap = response.runtime?.input_tap;
  return response.ready_source === 'daemon'
    && (tap?.status ?? response.runtime?.input_tap_status) === 'active'
    && tap?.listen_access === true
    && tap?.post_access === true;
}

export function enforcePostPermissionLiveReadiness(response, { prefix = './aos', mode = response.mode } = {}) {
  if (!response.ready || liveInputTapConfirmed(response)) return response;

  const blocker = {
    kind: 'runtime',
    id: 'post_permission_live_readiness_unconfirmed',
    scope: 'daemon',
    message: 'Post-permission recovery requires fresh live daemon input-tap, listen, and post facts; passive CLI grants alone are insufficient.',
    blocks: ['see', 'do', 'listen'],
  };
  const blockers = [...(response.blockers ?? [])];
  if (!blockers.some((item) => item.id === blocker.id)) blockers.push(blocker);
  const blockedCapabilities = [...new Set([
    ...(response.blocked_capabilities ?? []),
    ...blocker.blocks,
  ])].sort();
  const nextActions = [
    {
      type: 'command',
      label: 'inspect the launchd target before any post-permission restart',
      command: `${prefix} service status --mode ${mode} --json`,
    },
    {
      type: 'command',
      label: 'inspect fresh live daemon input-tap facts',
      command: `${prefix} status --json`,
    },
  ];
  const notes = [
    ...(response.notes ?? []),
    'Post-permission readiness stayed fail-closed because the live daemon tap view was unavailable or stale.',
  ];
  const verdict = {
    ...response.runtime_verdict,
    ready: false,
    status: 'degraded',
    phase: 'runtime_blocked',
    diagnosis: blocker.id,
    blockers,
    blocked_capabilities: blockedCapabilities,
    next_actions: nextActions,
    notes,
  };
  return {
    ...response,
    ready: false,
    status: 'degraded',
    phase: 'runtime_blocked',
    diagnosis: blocker.id,
    blockers,
    blocked_capabilities: blockedCapabilities,
    next_actions: nextActions,
    notes,
    runtime_verdict: verdict,
  };
}

function nextPostPermissionRepairStep(response, authority) {
  if (!authority?.allowed) {
    return blockedPostPermissionRecovery(
      authority?.reason ?? 'service_identity_unavailable',
      authority?.detail ?? 'post-permission recovery authority was not established',
    );
  }
  if (response.ready) {
    return stop(response.action_trace?.length ? undefined : {
      step: 'ready_preflight',
      result: 'ready',
      detail: 'live daemon input tap is active after the post-permission user signal',
    });
  }
  if (hasTrace(response, 'service_restart')) {
    return stop({
      step: 'post_permission_recovery',
      result: 'exhausted',
      detail: 'the single managed restart was already attempted; no restart loop will run',
    });
  }

  const blockerIDs = new Set((response.blockers ?? []).map((blocker) => blocker.id));
  for (const id of [
    'agent_os_worktree_default_runtime',
    'daemon_ownership_mismatch',
    'daemon_unmanaged',
    'daemon_foreground_dev_default',
    'stale_daemons',
  ]) {
    if (blockerIDs.has(id)) {
      return blockedPostPermissionRecovery(id, 'runtime ownership must be resolved before post-permission recovery');
    }
  }

  const passive = response.permissions ?? {};
  const missingPassive = ['accessibility', 'listen_access', 'post_access']
    .filter((id) => passive[id] !== true);
  if (missingPassive.length) {
    return blockedPostPermissionRecovery(
      'post_permission_signal_unconfirmed',
      `passive grants still missing: ${missingPassive.join(', ')}`,
    );
  }

  const tap = response.runtime?.input_tap;
  const tapStatus = tap?.status ?? response.runtime?.input_tap_status;
  const needsLiveRefresh = blockerIDs.has('post_permission_live_readiness_unconfirmed')
    || blockerIDs.has('input_tap_not_active')
    || (response.blockers ?? []).some((blocker) => blocker.reason === 'post_rebuild_tcc_stale')
    || (tapStatus && tapStatus !== 'active');
  if (!needsLiveRefresh) return stop();

  return {
    type: 'restart',
    reason: 'refresh the launchd-managed daemon event tap after the explicit post-permission user signal',
  };
}

export function nextReadyExecutionStep(
  response,
  {
    repair = false,
    postPermission = false,
    postPermissionAuthority = null,
    prefix = './aos',
    mode = response.mode,
  } = {},
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

  if (postPermission) return nextPostPermissionRepairStep(response, postPermissionAuthority);

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
