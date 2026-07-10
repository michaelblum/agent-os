import {
  agentOSWorktreePolicy,
  expectedBinaryPath,
  explicitStateRootOverride,
  invocationName,
} from './aos-cli.mjs';

export function permissionRequirements(permissions) {
  return [
    {
      id: 'accessibility',
      granted: Boolean(permissions.accessibility),
      required_for: ['global input tap', 'mouse/keyboard actions', 'AX element actions'],
      setup_trigger: 'AXIsProcessTrustedWithOptions prompt',
    },
    {
      id: 'screen_recording',
      granted: Boolean(permissions.screen_recording),
      required_for: ['screen capture', 'perception', 'visual debugging'],
      setup_trigger: 'CGRequestScreenCaptureAccess prompt',
    },
    {
      id: 'listen_access',
      granted: Boolean(permissions.listen_access),
      required_for: ['global input tap', 'input event fan-out', 'hotkeys'],
      setup_trigger: 'CGRequestListenEventAccess prompt',
    },
    {
      id: 'post_access',
      granted: Boolean(permissions.post_access),
      required_for: ['synthetic events', 'mouse/keyboard actions', 'AX element actions'],
      setup_trigger: 'CGRequestPostEventAccess prompt',
    },
    {
      id: 'microphone',
      granted: Boolean(permissions.microphone),
      required_for: ['voice dictation', 'local STT capture'],
      setup_trigger: 'AVCaptureDevice.requestAccess(for:.audio) prompt',
    },
  ];
}

export function evaluateReadyForTesting(daemon, permissions, setup) {
  if (daemon && daemon.inputTap.status !== 'active') {
    return { readyForTesting: false, readySource: 'daemon' };
  }
  if (daemon && daemon.permissions.accessibility !== undefined) {
    return {
      readyForTesting: Boolean(daemon.permissions.accessibility && permissions.screen_recording && setup.setup_completed),
      readySource: 'daemon',
    };
  }
  return {
    readyForTesting: Boolean(permissions.accessibility && permissions.screen_recording && setup.setup_completed),
    readySource: 'cli',
  };
}

export function readyEvaluationSnake(evaluation) {
  return {
    ready_for_testing: evaluation.readyForTesting,
    ready_source: evaluation.readySource,
  };
}

export function missingPermissionIDsFor(daemon, cli) {
  const missing = [];
  const accessibility = daemon?.permissions.accessibility ?? cli.accessibility;
  const listen = daemon?.inputTap.listenAccess ?? cli.listen_access;
  const post = daemon?.inputTap.postAccess ?? cli.post_access;
  if (!accessibility) missing.push('accessibility');
  if (!cli.screen_recording) missing.push('screen_recording');
  if (!listen) missing.push('listen_access');
  if (!post) missing.push('post_access');
  if (!cli.microphone) missing.push('microphone');
  return missing;
}

export function disagreementFor(daemon, cli) {
  if (!daemon) return undefined;
  const disagreement = {};
  if (daemon.permissions.accessibility !== undefined && daemon.permissions.accessibility !== cli.accessibility) {
    disagreement.accessibility = { cli: cli.accessibility, daemon: daemon.permissions.accessibility };
  }
  if (daemon.inputTap.listenAccess !== undefined && daemon.inputTap.listenAccess !== cli.listen_access) {
    disagreement.listen_access = { cli: cli.listen_access, daemon: daemon.inputTap.listenAccess };
  }
  if (daemon.inputTap.postAccess !== undefined && daemon.inputTap.postAccess !== cli.post_access) {
    disagreement.post_access = { cli: cli.post_access, daemon: daemon.inputTap.postAccess };
  }
  return Object.keys(disagreement).length ? disagreement : undefined;
}

export function passiveLiveViewsFor(daemon, cli) {
  return {
    cli_passive: {
      accessibility: Boolean(cli.accessibility),
      screen_recording: Boolean(cli.screen_recording),
      listen_access: Boolean(cli.listen_access),
      post_access: Boolean(cli.post_access),
      microphone: Boolean(cli.microphone),
    },
    daemon_live: daemon ? {
      accessibility: daemon.permissions.accessibility,
      listen_access: daemon.inputTap.listenAccess,
      post_access: daemon.inputTap.postAccess,
      input_tap_status: daemon.inputTap.status,
      input_tap_attempts: daemon.inputTap.attempts,
    } : undefined,
  };
}

export function postRebuildTccStalenessFor(facts, mode, prefix = invocationName()) {
  const disagreement = disagreementFor(facts.daemon, facts.permissions);
  if (!disagreement) return undefined;
  const staleFields = Object.entries(disagreement)
    .filter(([, value]) => value.cli === true && value.daemon === false)
    .map(([field]) => field);
  if (!staleFields.length) return undefined;
  const targetPath = facts.binary_identity?.path ?? expectedBinaryPath(mode);
  return {
    id: 'post_rebuild_tcc_stale',
    diagnosis: 'daemon_tcc_grant_stale_or_missing',
    reason: 'TCC has a stale registration for a previous aos binary; passive checks pass, but live privileged access fails after a rebuild.',
    stale_fields: staleFields,
    ...passiveLiveViewsFor(facts.daemon, facts.permissions),
    disagreement,
    binary_identity: {
      path: targetPath,
      exists: facts.binary_identity?.exists,
      mtime: facts.binary_identity?.mtime,
      mtime_ms: facts.binary_identity?.mtime_ms,
      size_bytes: facts.binary_identity?.size_bytes,
      cdhash: facts.binary_identity?.cdhash,
    },
    remedy: {
      type: 'manual_tcc_reset',
      summary: 'Play the stale-TCC handoff alert, end the current turn, and wait for the user to manually reset/regrant macOS TCC permissions for the rebuilt aos binary.',
      commands: [
        `${prefix} ready --post-permission`,
      ],
      human_action: 'Remove/re-add or regrant the aos entry in macOS Privacy & Security, then return to the waiting session and say: finished.',
      target_path: targetPath,
      next_user_signal: 'finished',
    },
  };
}

export function inputTapRecoveryGuidance(status, attempts) {
  return [
    `Input tap is not active (status=${status}, attempts=${attempts}).`,
    'Try:',
    '  ./aos service restart              # restart the managed daemon and re-check readiness',
    '  ./aos permissions setup --once     # refresh macOS permission onboarding',
    '  ./aos serve --idle-timeout 30m     # bounded foreground fallback for this session',
  ].join('\n');
}

export function serviceInputTapRecovery(status, attempts, restartContext = false) {
  if (restartContext) {
    return {
      note: [
        `Input tap is still not active after service restart (status=${status}, attempts=${attempts}).`,
        'Try:',
        '  ./aos permissions setup --once     # refresh macOS permission onboarding',
        '  ./aos serve --idle-timeout 30m     # bounded foreground fallback for this session',
      ].join('\n'),
      recovery: ['./aos permissions setup --once', './aos serve --idle-timeout 30m'],
    };
  }
  return {
    note: inputTapRecoveryGuidance(status, attempts),
    recovery: ['./aos service restart', './aos permissions setup --once', './aos serve --idle-timeout 30m'],
  };
}

export function serviceRuntimeRecovery(reason, mode, prefix = invocationName()) {
  if (reason === 'service_not_running') {
    return {
      recovery: [`${prefix} clean`],
      note: 'Daemon socket is owned outside the managed service. Clean/classify the unmanaged owner before treating service start as successful.',
    };
  }
  if (reason === 'daemon_ownership_mismatch') {
    return {
      recovery: [`${prefix} clean`, `${prefix} ready --repair`],
      note: 'Daemon socket ownership does not match the launchd service. Clean stale owners first; ready --repair may restart/recheck only after cleanup.',
    };
  }
  if (reason === 'socket_unreachable') {
    return {
      recovery: [`${prefix} service start --mode ${mode}`, `${prefix} clean`],
      note: 'Daemon socket was not reachable within the readiness budget.',
    };
  }
  return { recovery: [], note: undefined };
}

export function inputMonitoringSubGuidance(tap, daemonBinaryPath) {
  const listen = tap?.listenAccess ?? tap?.listen_access;
  const post = tap?.postAccess ?? tap?.post_access;
  const render = (value) => value === undefined || value === null ? 'unknown' : String(Boolean(value));
  return [
    `Daemon lacks Input Monitoring access (listen=${render(listen)}, post=${render(post)}).`,
    'In repo mode, prefer:',
    '  ./aos permissions reset-runtime --mode repo',
    '  ./aos permissions setup --once',
    '  ./aos ready --post-permission',
    'Manual Settings fallback: Privacy & Security > Input Monitoring for daemon binary:',
    `  ${daemonBinaryPath}`,
  ].join('\n');
}

export function permissionEntryName(mode) {
  return mode === 'repo' ? 'aos' : 'AOS.app';
}

export function permissionPanel(id) {
  if (id === 'accessibility') return 'Accessibility';
  if (id === 'screen_recording') return 'Screen Recording';
  if (id === 'listen_access' || id === 'post_access' || id === 'input_monitoring_listen' || id === 'input_monitoring_post') return 'Input Monitoring';
  if (id === 'microphone') return 'Microphone';
  return id;
}

export function permissionAction(blocker, mode) {
  if (mode === 'repo' && blocker.scope === 'daemon') return 'targeted reset';
  return 'enable';
}

export function permissionFixLines(blockers, mode) {
  const seen = new Set();
  const lines = [];
  for (const blocker of blockers) {
    const panel = permissionPanel(blocker.id);
    const action = permissionAction(blocker, mode);
    const key = `${panel}|${action}`;
    if (seen.has(key)) continue;
    seen.add(key);
    lines.push(`${panel} -> ${permissionEntryName(mode)} (${action})`);
  }
  return lines;
}

export function permissionResetSafeSequenceLines(blockers, mode, prefix = invocationName()) {
  const targetPath = expectedBinaryPath(mode);
  const lines = [
    `Runtime mode: ${mode}`,
    `Target binary: ${targetPath}`,
    `1. Agent: run ${prefix} permissions reset-runtime --mode ${mode}`,
    `2. Agent: run ${prefix} permissions setup --once`,
    '3. Human: grant the macOS permission prompt, or physically remove/re-add the repo-mode aos runtime in System Settings if the grant remains stale.',
    '4. Human: return to the waiting session and say: finished',
    `5. Session: run ${prefix} ready --post-permission`,
    'Manual Settings removal is required when reset-runtime reports targeted reset unavailable or the grant remains stale.',
  ];
  if (blockers.some((blocker) => blocker.id === 'screen_recording')) {
    lines.splice(4, 0, 'Screen Recording can be re-requested by permissions setup after reset.');
  }
  return lines;
}

export function staleTccTerminalHandoff(tccStaleness, prefix = invocationName()) {
  if (!tccStaleness || tccStaleness.id !== 'post_rebuild_tcc_stale') return undefined;
  return {
    type: 'manual_tcc_reset',
    reason: 'post_rebuild_tcc_stale',
    terminal: true,
    alert: 'three_chimes',
    instruction: 'End the current turn. Do not run reset-runtime, setup, ready, service restart, or other TCC-backed probes until the user says finished.',
    next_user_signal: 'finished',
    human_action: tccStaleness.remedy.human_action,
    target_path: tccStaleness.remedy.target_path,
    resume_command: `${prefix} ready --post-permission`,
  };
}

export function staleGrantGuidance(mode, service) {
  const lower = service.toLowerCase();
  const panel = lower.includes('input monitoring') ? 'Input Monitoring' : lower.includes('screen') ? 'Screen Recording' : 'Accessibility';
  const entry = permissionEntryName(mode);
  if (mode === 'repo') {
    return `${panel} -> ${entry} (targeted reset via ${invocationName()} permissions reset-runtime --mode repo)`;
  }
  return `${panel} -> ${entry} (enable)`;
}

export function foregroundDevRuntimeAllowed(env = process.env) {
  if (env.AOS_ALLOW_FOREGROUND_DEV === '1') return true;
  return explicitStateRootOverride(env);
}

export function defaultRootForegroundDevBlocked(runtime, env = process.env) {
  return runtime?.ownership_kind === 'foreground_dev'
    && !foregroundDevRuntimeAllowed(env);
}

export function readyBlockers({ runtime, daemon, permissions, setup, cleanReport }, mode) {
  const blockers = [];
  const daemonPath = expectedBinaryPath(mode);
  const currentPath = expectedBinaryPath(mode);
  const staleDaemons = cleanReport?.stale_daemons || [];
  const worktreePolicy = agentOSWorktreePolicy({ mode });

  if (!worktreePolicy.allowed) {
    blockers.push({
      kind: 'runtime',
      id: worktreePolicy.id,
      scope: 'repo',
      message: worktreePolicy.message,
      target_path: daemonPath,
      worktree: worktreePolicy.worktree,
      blocks: ['see', 'do', 'show', 'tell', 'listen', 'content', 'experience', 'service'],
    });
  }

  if (!runtime.socket_reachable) {
    blockers.push({
      kind: 'runtime',
      id: 'daemon_unreachable',
      scope: 'daemon',
      message: runtime.daemon_running
        ? 'Daemon process appears to be running, but the socket is not reachable.'
        : 'Daemon is not running or did not become reachable.',
      target_path: daemonPath,
      blocks: ['see', 'do', 'show', 'tell', 'listen'],
    });
  }

  if (runtime.ownership_state === 'mismatch') {
    blockers.push({
      kind: 'runtime',
      id: 'daemon_ownership_mismatch',
      scope: 'daemon',
      message: `Daemon ownership mismatch: serving pid=${runtime.serving_pid ?? 'none'}, lock pid=${runtime.lock_owner_pid ?? 'none'}, service pid=${runtime.service_pid ?? 'none'}.`,
      target_path: daemonPath,
      blocks: ['see', 'do', 'show', 'tell', 'listen'],
    });
  }

  if (runtime.ownership_state === 'unmanaged') {
    const ownerProcess = runtime.owner_process;
    const ownerCommand = ownerProcess?.command_line
      ? ` command=${ownerProcess.command_line}`
      : ownerProcess?.command_line_unavailable_reason
        ? ` command=unavailable (${ownerProcess.command_line_unavailable_reason})`
        : '';
    blockers.push({
      kind: 'runtime',
      id: 'daemon_unmanaged',
      scope: 'daemon',
      message: `Repo daemon is reachable with owner pid=${runtime.owner_pid ?? 'unknown'}, but it is not launchd-managed or an accepted foreground/dev runtime.${ownerCommand}`,
      target_path: daemonPath,
      owner_process: ownerProcess,
      blocks: ['see', 'do', 'show', 'tell', 'listen'],
    });
  }

  if (defaultRootForegroundDevBlocked(runtime)) {
    const ownerProcess = runtime.owner_process;
    const ownerCommand = ownerProcess?.command_line
      ? ` command=${ownerProcess.command_line}`
      : ownerProcess?.command_line_unavailable_reason
        ? ` command=unavailable (${ownerProcess.command_line_unavailable_reason})`
        : '';
    blockers.push({
      kind: 'runtime',
      id: 'daemon_foreground_dev_default',
      scope: 'daemon',
      message: `Default AOS runtime is owned by a foreground dev daemon pid=${runtime.owner_pid ?? 'unknown'}. The shared one-screen runtime must be launchd-managed; foreground dev daemons require an isolated AOS_STATE_ROOT.${ownerCommand}`,
      target_path: daemonPath,
      owner_process: ownerProcess,
      blocks: ['see', 'do', 'show', 'tell', 'listen'],
    });
  }

  if (staleDaemons.length) {
    blockers.push({
      kind: 'runtime',
      id: 'stale_daemons',
      scope: 'daemon',
      message: `Stale AOS daemon process(es) detected: ${staleDaemons.map((item) => item.pid).join(', ')}. Run cleanup before treating this runtime as ready.`,
      target_path: daemonPath,
      blocks: ['see', 'do', 'show', 'tell', 'listen'],
    });
  }

  if (!permissions.accessibility) {
    blockers.push({
      kind: 'permission',
      id: 'accessibility',
      scope: 'cli',
      message: 'CLI lacks Accessibility permission.',
      target_path: currentPath,
      settings_url: 'x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility',
      blocks: ['see', 'do', 'inspect'],
    });
  }

  if (daemon?.permissions.accessibility === false) {
    blockers.push({
      kind: 'permission',
      id: 'accessibility',
      scope: 'daemon',
      reason: permissions.accessibility ? 'post_rebuild_tcc_stale' : 'daemon_permission_missing',
      message: staleGrantGuidance(mode, 'Accessibility'),
      target_path: daemonPath,
      settings_url: 'x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility',
      blocks: ['see', 'do', 'inspect', 'listen'],
    });
  }

  if (!permissions.screen_recording) {
    blockers.push({
      kind: 'permission',
      id: 'screen_recording',
      scope: 'cli',
      message: 'CLI lacks Screen Recording permission.',
      target_path: currentPath,
      settings_url: 'x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture',
      blocks: ['see'],
    });
  }

  if (!permissions.microphone) {
    blockers.push({
      kind: 'permission',
      id: 'microphone',
      scope: 'cli',
      message: 'CLI lacks Microphone permission for voice dictation.',
      target_path: currentPath,
      settings_url: 'x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone',
      blocks: ['listen'],
    });
  }

  if (daemon?.inputTap && daemon.inputTap.status !== 'active') {
    blockers.push({
      kind: 'runtime',
      id: 'input_tap_not_active',
      scope: 'daemon',
      message: `Daemon input tap is not active (status=${daemon.inputTap.status}, attempts=${daemon.inputTap.attempts}).`,
      target_path: daemonPath,
      blocks: ['see', 'do', 'listen'],
    });
  }

  if (daemon?.inputTap.listenAccess === false) {
    blockers.push({
      kind: 'permission',
      id: 'input_monitoring_listen',
      scope: 'daemon',
      reason: permissions.listen_access ? 'post_rebuild_tcc_stale' : 'daemon_permission_missing',
      message: staleGrantGuidance(mode, 'Input Monitoring listen access'),
      target_path: daemonPath,
      settings_url: 'x-apple.systempreferences:com.apple.preference.security?Privacy_ListenEvent',
      blocks: ['see', 'listen'],
    });
  }

  if (daemon?.inputTap.postAccess === false) {
    blockers.push({
      kind: 'permission',
      id: 'input_monitoring_post',
      scope: 'daemon',
      reason: permissions.post_access ? 'post_rebuild_tcc_stale' : 'daemon_permission_missing',
      message: staleGrantGuidance(mode, 'Input Monitoring post access'),
      target_path: daemonPath,
      settings_url: 'x-apple.systempreferences:com.apple.preference.security?Privacy_ListenEvent',
      blocks: ['do'],
    });
  }

  if (!setup.setup_completed) {
    blockers.push({
      kind: 'setup',
      id: 'permissions_onboarding',
      message: 'Permission onboarding has not completed for this runtime identity.',
      blocks: ['see', 'do', 'inspect'],
    });
  }

  return blockers;
}

export function isRepairableRuntimeBlockerID(id) {
  return id === 'daemon_unreachable'
    || id === 'daemon_ownership_mismatch'
    || id === 'stale_daemons'
    || id === 'input_tap_not_active';
}

export function readyAutoRepairReason(response, { postPermission = false } = {}) {
  if (response.ready) return null;
  if ((response.blockers ?? []).some((blocker) => blocker.kind === 'permission')) return null;
  const blockerIDs = new Set((response.blockers ?? []).map((blocker) => blocker.id));
  const hasRepairableRuntimeBlocker = (response.blockers ?? [])
    .some((blocker) => isRepairableRuntimeBlockerID(blocker.id));
  if (blockerIDs.has('stale_daemons')) return null;
  if (blockerIDs.has('daemon_unmanaged')) return null;
  if (postPermission && hasRepairableRuntimeBlocker) return 'post-permission bounded daemon restart/recheck';
  if (blockerIDs.has('daemon_ownership_mismatch')) return 'automatic after daemon ownership mismatch';
  if (blockerIDs.has('input_tap_not_active')) return 'automatic after input tap inactive';
  return null;
}

export function hasRestartableReadyRuntimeBlocker(response) {
  const blockers = response.blockers ?? [];
  if (blockers.some((blocker) => blocker.id === 'stale_daemons')) return false;
  return blockers.some((blocker) => isRepairableRuntimeBlockerID(blocker.id));
}

function compactPrimaryBlocker(blocker) {
  if (!blocker) return undefined;
  const compact = {
    kind: blocker.kind,
    id: blocker.id,
  };
  if (blocker.scope !== undefined) compact.scope = blocker.scope;
  if (blocker.reason !== undefined) compact.reason = blocker.reason;
  return compact;
}

function decisionFor(phase, diagnosis, actionReason, blocker) {
  return {
    phase,
    diagnosis,
    action_reason: actionReason,
    primary_blocker: compactPrimaryBlocker(blocker),
  };
}

export function readyDecision(ready, blockers, daemon, permissions) {
  if (ready) return decisionFor('ready', 'ready', 'ready', undefined);
  const find = (predicate) => blockers.find(predicate);
  let blocker = find((b) => b.id === 'agent_os_worktree_default_runtime');
  if (blocker) return decisionFor('runtime_blocked', blocker.id, blocker.id, blocker);
  blocker = find((b) => b.id === 'daemon_ownership_mismatch');
  if (blocker) return decisionFor('runtime_blocked', blocker.id, 'runtime_repair', blocker);
  blocker = find((b) => b.id === 'daemon_unmanaged');
  if (blocker) return decisionFor('runtime_blocked', blocker.id, 'runtime_cleanup', blocker);
  blocker = find((b) => b.id === 'daemon_foreground_dev_default');
  if (blocker) return decisionFor('runtime_blocked', blocker.id, 'runtime_cleanup', blocker);
  blocker = find((b) => b.id === 'stale_daemons');
  if (blocker) return decisionFor('runtime_blocked', blocker.id, 'runtime_cleanup', blocker);
  blocker = find((b) => b.id === 'daemon_unreachable');
  if (blocker) return decisionFor('runtime_blocked', 'daemon_socket_unreachable', 'runtime_repair', blocker);
  const staleTccBlocker = find((b) => b.reason === 'post_rebuild_tcc_stale');
  const daemonPermissionBlocker = find((b) => b.kind === 'permission' && b.scope === 'daemon');
  if (daemon && ((daemon.permissions.accessibility === false && permissions.accessibility)
      || daemon.inputTap.listenAccess === false
      || daemon.inputTap.postAccess === false)) {
    return decisionFor(
      'human_required',
      'daemon_tcc_grant_stale_or_missing',
      staleTccBlocker ? 'post_rebuild_tcc_stale' : 'permission',
      staleTccBlocker ?? daemonPermissionBlocker,
    );
  }
  blocker = find((b) => b.kind === 'permission');
  if (blocker) return decisionFor('human_required', 'not_ready', 'permission', blocker);
  blocker = find((b) => b.id === 'input_tap_not_active');
  if (blocker) return decisionFor('runtime_blocked', blocker.id, 'runtime_repair', blocker);
  blocker = find((b) => b.kind === 'setup');
  if (blocker) return decisionFor('setup_required', 'permissions_onboarding_required', 'setup', blocker);
  return decisionFor('degraded', 'not_ready', 'recheck', undefined);
}

export function readyPhase(ready, blockers) {
  return readyDecision(ready, blockers, null, {}).phase;
}

export function readyDiagnosis(ready, blockers, daemon, permissions) {
  return readyDecision(ready, blockers, daemon, permissions).diagnosis;
}

function appendAction(actions, seen, action) {
  const key = `${action.type}|${action.command ?? action.label}`;
  if (seen.has(key)) return;
  seen.add(key);
  actions.push(action);
}

function appendRuntimeCleanupActions(actions, seen, blockers, prefix) {
  const hasUnmanagedDaemon = blockers.some((b) => b.id === 'daemon_unmanaged');
  const hasDefaultForegroundDevDaemon = blockers.some((b) => b.id === 'daemon_foreground_dev_default');
  const hasStaleDaemons = blockers.some((b) => b.id === 'stale_daemons');
  const hasRepairableRuntimeBlocker = blockers.some((b) => isRepairableRuntimeBlockerID(b.id));
  let label = 'clean stale daemon processes and stale runtime resources';
  if (hasDefaultForegroundDevDaemon) label = 'clean the foreground dev daemon that owns the default repo runtime';
  else if (hasUnmanagedDaemon) label = 'clean the unmanaged daemon that owns the repo socket';
  appendAction(actions, seen, {
    type: 'command',
    label,
    command: `${prefix} clean`,
  });
  if (hasRepairableRuntimeBlocker && !hasUnmanagedDaemon) {
    appendAction(actions, seen, {
      type: 'command',
      label: hasStaleDaemons
        ? 'run automated repair only after cleanup has removed stale daemon owners'
        : 'run automated repair: restart/recheck, then print human instructions if needed',
      command: `${prefix} ready --repair`,
    });
  }
}

export function readyNextActions(decision, blockers, setup, mode, prefix = invocationName()) {
  const actions = [];
  const seen = new Set();
  if (!blockers.length) return actions;

  const hasStaleDaemons = blockers.some((b) => b.id === 'stale_daemons');
  const primary = decision.action_reason;

  if (primary === 'post_rebuild_tcc_stale') {
    appendAction(actions, seen, {
      type: 'manual_tcc_reset',
      label: 'play the stale-TCC handoff alert, end the turn, and wait for the user to say finished after manual TCC reset/regrant',
      reason: 'post_rebuild_tcc_stale',
      terminal: true,
      next_user_signal: 'finished',
    });
    appendAction(actions, seen, {
      type: 'command',
      label: 'after the user says finished, run the bounded post-permission readiness check',
      command: `${prefix} ready --post-permission`,
      after_user_signal: 'finished',
    });
    return actions;
  }

  if (primary === 'agent_os_worktree_default_runtime') {
    appendAction(actions, seen, {
      type: 'manual',
      label: 'run AOS from the primary agent-os checkout, or set an explicit AOS_STATE_ROOT for isolated runtime tests',
      reason: 'agent_os_worktree_default_runtime',
    });
    appendAction(actions, seen, {
      type: 'command',
      label: 're-check readiness from the primary checkout or isolated runtime',
      command: `${prefix} ready`,
    });
    return actions;
  }

  if (primary === 'runtime_cleanup') {
    appendRuntimeCleanupActions(actions, seen, blockers, prefix);
    appendAction(actions, seen, {
      type: 'command',
      label: 're-check readiness',
      command: `${prefix} ready`,
    });
    return actions;
  }

  if (primary === 'permission') {
    appendAction(actions, seen, {
      type: 'command',
      label: 'stop the managed daemon and run or classify targeted reset for this runtime identity',
      command: `${prefix} permissions reset-runtime --mode ${mode}`,
    });
    appendAction(actions, seen, {
      type: 'command',
      label: 'request fresh macOS permission prompts after reset-runtime completes',
      command: `${prefix} permissions setup --once`,
    });
    appendAction(actions, seen, {
      type: 'command',
      label: 'bounded handoff check after permissions have been granted',
      command: `${prefix} ready --post-permission`,
    });
  }

  if (primary === 'runtime_repair') {
    appendAction(actions, seen, {
      type: 'command',
      label: 'run automated repair: restart/recheck, then print human instructions if needed',
      command: `${prefix} ready --repair`,
    });
    if (!hasStaleDaemons) {
      appendAction(actions, seen, {
        type: 'command',
        label: 'restart the managed daemon and re-check readiness',
        command: `${prefix} service restart --mode ${mode}`,
      });
    }
  }

  if (primary === 'setup') {
    appendAction(actions, seen, {
      type: 'command',
      label: 'run permission onboarding',
      command: setup.recommended_command ?? `${prefix} permissions setup --once`,
    });
  }

  appendAction(actions, seen, {
    type: 'command',
    label: 're-check readiness',
    command: `${prefix} ready`,
  });
  return actions;
}

export function readyNotes({ runtime, daemon, permissions, setup, cleanReport }, mode, prefix = invocationName(), tccStaleness = undefined) {
  const notes = [];
  if (tccStaleness) {
    notes.push(tccStaleness.reason);
    notes.push(tccStaleness.remedy.summary);
    notes.push(`After the user says ${tccStaleness.remedy.next_user_signal}, run '${prefix} ready --post-permission'.`);
    return notes;
  }
  if (!runtime.daemon_running) notes.push('Daemon is not running.');
  else if (!runtime.socket_reachable) notes.push('Daemon process appears to be running, but the socket is not reachable.');
  if (runtime.ownership_state === 'mismatch') {
    const serving = runtime.serving_pid ?? 'none';
    const lock = runtime.lock_owner_pid ?? 'none';
    const service = runtime.service_pid ?? 'none';
    notes.push(`Daemon ownership mismatch: serving pid=${serving}, lock pid=${lock}, service pid=${service}.`);
  } else if (runtime.ownership_state === 'unmanaged') {
    const owner = runtime.owner_pid ?? 'unknown';
    const command = runtime.owner_process?.command_line
      ? ` command=${runtime.owner_process.command_line}`
      : runtime.owner_process?.command_line_unavailable_reason
        ? ` command unavailable: ${runtime.owner_process.command_line_unavailable_reason}`
        : ' command unavailable';
    notes.push(`Reachable repo daemon is unmanaged: owner pid=${owner};${command}. Do not loop service start/restart or ready repair while this owner controls the repo socket.`);
    notes.push(`Run '${prefix} clean' once for cleanup-owned stale resources; if the owner remains, return the owner PID and command line to Foreman/human.`);
  }
  if (defaultRootForegroundDevBlocked(runtime)) {
    const owner = runtime.owner_pid ?? 'unknown';
    const command = runtime.owner_process?.command_line
      ? ` command=${runtime.owner_process.command_line}`
      : runtime.owner_process?.command_line_unavailable_reason
        ? ` command unavailable: ${runtime.owner_process.command_line_unavailable_reason}`
        : ' command unavailable';
    notes.push(`Default AOS runtime is owned by a foreground dev daemon: owner pid=${owner};${command}. Run '${prefix} clean' or rerun foreground development under an isolated AOS_STATE_ROOT.`);
  }
  const worktreePolicy = agentOSWorktreePolicy({ mode });
  if (!worktreePolicy.allowed) {
    notes.push(`${worktreePolicy.message} worktree=${worktreePolicy.worktree?.repo_root ?? 'unknown'} git_dir=${worktreePolicy.worktree?.git_dir ?? 'unknown'} common_git_dir=${worktreePolicy.worktree?.git_common_dir ?? 'unknown'}.`);
  }
  if (runtime.event_tap_expected && runtime.input_tap_status && runtime.input_tap_status !== 'active' && !runtime.input_tap) {
    notes.push(`Perception input tap is not active (status=${runtime.input_tap_status}).`);
  }

  if (daemon?.inputTap && daemon.inputTap.status !== 'active') {
    notes.push(inputTapRecoveryGuidance(daemon.inputTap.status, daemon.inputTap.attempts));
    if (daemon.inputTap.listenAccess === false || daemon.inputTap.postAccess === false) {
      notes.push(inputMonitoringSubGuidance(daemon.inputTap, expectedBinaryPath(mode)));
    }
  }
  if (!permissions.accessibility) notes.push('Accessibility permission is not granted (CLI view).');
  if (daemon?.permissions.accessibility === false) notes.push('Accessibility permission is not granted (daemon view).');
  if (!permissions.screen_recording) notes.push('Screen Recording permission is not granted.');
  if (!permissions.microphone) notes.push('Microphone permission is not granted.');
  if (!setup.setup_completed && setup.recommended_command) notes.push(`Run '${setup.recommended_command}' before interactive testing.`);
  if (cleanReport?.stale_daemons?.length) {
    notes.push(`Stale daemon cleanup required before readiness: ${cleanReport.stale_daemons.map((item) => item.pid).join(', ')}. Run '${prefix} clean'.`);
  }
  return notes;
}

export function runtimeVerdict(facts, mode, prefix = invocationName()) {
  const evaluation = evaluateReadyForTesting(facts.daemon, facts.permissions, facts.setup);
  const blockers = readyBlockers(facts, mode);
  const ready = Boolean(facts.runtime.socket_reachable && evaluation.readyForTesting && blockers.length === 0);
  const blockedCapabilities = [...new Set(blockers.flatMap((blocker) => blocker.blocks || []))].sort();
  const tccStaleness = postRebuildTccStalenessFor(facts, mode, prefix);
  const decision = readyDecision(ready, blockers, facts.daemon, facts.permissions);
  const selectedTccStaleness = tccStaleness?.diagnosis === decision.diagnosis ? tccStaleness : undefined;
  const terminalHandoff = staleTccTerminalHandoff(selectedTccStaleness, prefix);
  return {
    ready,
    status: ready ? 'ok' : 'degraded',
    phase: decision.phase,
    diagnosis: decision.diagnosis,
    ready_source: evaluation.readySource,
    ready_for_testing: evaluation.readyForTesting,
    blockers,
    blocked_capabilities: blockedCapabilities,
    tcc_staleness: tccStaleness,
    terminal_handoff: terminalHandoff,
    notes: readyNotes(facts, mode, prefix, selectedTccStaleness),
    next_actions: readyNextActions(decision, blockers, facts.setup, mode, prefix),
    ownership: {
      state: facts.runtime.ownership_state,
      kind: facts.runtime.ownership_kind,
      owner_pid: facts.runtime.owner_pid,
      serving_pid: facts.runtime.serving_pid,
      lock_owner_pid: facts.runtime.lock_owner_pid,
      service_pid: facts.runtime.service_pid,
      owner_launchd_managed: facts.runtime.owner_launchd_managed,
      owner_process: facts.runtime.owner_process,
    },
    cleanup: {
      status: facts.cleanReport?.status,
      foreground_dev_owners: facts.cleanReport?.foreground_dev_owners ?? [],
      stale_daemons: facts.cleanReport?.stale_daemons ?? [],
      stale_locks: facts.cleanReport?.stale_locks ?? [],
      canvases: facts.cleanReport?.canvases ?? [],
      notes: facts.cleanReport?.notes ?? [],
    },
  };
}

export function permissionCheckNotes(cli, setup, daemon, mode) {
  const notes = [];
  if (!cli.accessibility) notes.push('Accessibility permission is not granted (CLI view).');
  if (!cli.screen_recording) notes.push('Screen Recording permission is not granted.');
  if (!cli.listen_access) notes.push('Input Monitoring listen access is not granted (CLI view).');
  if (!cli.post_access) notes.push('Input Monitoring post access is not granted (CLI view).');
  if (!cli.microphone) notes.push('Microphone permission is not granted.');
  if (!setup.marker_exists) {
    notes.push('Permission onboarding has not been completed for this runtime identity.');
  } else if (!setup.bundle_matches_current && !setup.setup_completed) {
    notes.push('Permission onboarding marker belongs to a different app bundle path.');
  }
  if (setup.recommended_command) {
    notes.push(`Run '${setup.recommended_command}' before interactive testing.`);
  }
  if (!daemon) {
    notes.push('Daemon unreachable; readiness computed from CLI preflights only.');
  } else if (daemon.inputTap.status !== 'active') {
    notes.push(inputTapRecoveryGuidance(daemon.inputTap.status, daemon.inputTap.attempts));
    if (daemon.inputTap.listenAccess === false || daemon.inputTap.postAccess === false) {
      notes.push(inputMonitoringSubGuidance(daemon.inputTap, expectedBinaryPath(mode)));
    }
  }
  return notes;
}

export function permissionRecoveryNotes(missing, mode, prefix = invocationName()) {
  const notes = [];
  if (missing.includes('accessibility')) {
    notes.push('Daemon or CLI Accessibility permission is stale or missing.');
  }
  if (missing.includes('screen_recording')) {
    notes.push('Screen Recording permission is still not granted.');
  }
  if (missing.includes('listen_access') || missing.includes('post_access')) {
    notes.push('Daemon-owned Input Monitoring permission is stale or missing.');
  }
  if (missing.includes('microphone')) {
    notes.push('Microphone permission is still not granted.');
  }
  notes.push(`Run '${prefix} permissions reset-runtime --mode ${mode}' before requesting fresh prompts.`);
  notes.push(`Then run '${prefix} permissions setup --once' and '${prefix} ready --post-permission'.`);
  return notes;
}

export const SETUP_PROMPT_ORDER = [
  ['accessibility', 'accessibility'],
  ['screen_recording', 'screen-recording'],
  ['listen_access', 'listen-event'],
  ['post_access', 'post-event'],
  ['microphone', 'microphone'],
];

export function planPermissionSetup({ initialPermissions, initialSetup, initialMissing, once = false, mode = 'repo', prefix = invocationName() }) {
  if (once && initialSetup.setup_completed && initialMissing.length === 0) {
    return { branch: 'already_complete', status: 'ok', completed: true, promptOrder: [], writeMarker: false, restartServices: false, notes: ['Permissions are already granted; onboarding was skipped.'] };
  }
  if (once && initialSetup.setup_completed && initialMissing.length > 0) {
    return { branch: 'completed_but_missing', status: 'degraded', completed: false, promptOrder: [], writeMarker: false, restartServices: false, notes: permissionRecoveryNotes(initialMissing, mode, prefix) };
  }

  const allCLIGranted = initialPermissions.accessibility
    && initialPermissions.screen_recording
    && initialPermissions.listen_access
    && initialPermissions.post_access
    && initialPermissions.microphone;

  if (once && allCLIGranted && initialMissing.length === 0) {
    return { branch: 'record_marker_without_prompts', status: 'ok', completed: true, promptOrder: [], writeMarker: true, restartServices: true, notes: [] };
  }
  if (once && allCLIGranted && initialMissing.length > 0) {
    return { branch: 'cli_granted_daemon_missing', status: 'degraded', completed: false, promptOrder: [], writeMarker: false, restartServices: false, notes: permissionRecoveryNotes(initialMissing, mode, prefix) };
  }

  return {
    branch: 'prompt_missing',
    status: 'pending',
    completed: false,
    promptOrder: SETUP_PROMPT_ORDER
      .filter(([permissionID]) => !initialPermissions[permissionID])
      .map(([permissionID, primitiveID]) => ({ permissionID, primitiveID })),
    writeMarker: false,
    restartServices: false,
    notes: [],
  };
}

export function runSetupPromptPlan({ plan, prompt }) {
  const notes = [...plan.notes];
  for (const item of plan.promptOrder) {
    const response = prompt(item);
    if (response.granted !== true) {
      notes.push(`${item.permissionID} permission setup was cancelled before completion.`);
      break;
    }
  }
  return notes;
}
