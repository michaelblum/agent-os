import { expectedBinaryPath, invocationName } from './aos-cli.mjs';

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

export function inputTapRecoveryGuidance(status, attempts) {
  return [
    `Input tap is not active (status=${status}, attempts=${attempts}).`,
    'Try:',
    '  ./aos service restart              # restart the managed daemon and re-check readiness',
    '  ./aos permissions setup --once     # refresh macOS permission onboarding',
    '  ./aos serve --idle-timeout none    # temporary foreground fallback for this session',
  ].join('\n');
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

export function staleGrantGuidance(mode, service) {
  const lower = service.toLowerCase();
  const panel = lower.includes('input monitoring') ? 'Input Monitoring' : lower.includes('screen') ? 'Screen Recording' : 'Accessibility';
  const entry = permissionEntryName(mode);
  if (mode === 'repo') {
    return `${panel} -> ${entry} (targeted reset via ${invocationName()} permissions reset-runtime --mode repo)`;
  }
  return `${panel} -> ${entry} (enable)`;
}

export function readyBlockers({ runtime, daemon, permissions, setup, cleanReport }, mode) {
  const blockers = [];
  const daemonPath = expectedBinaryPath(mode);
  const currentPath = expectedBinaryPath(mode);
  const staleDaemons = cleanReport?.stale_daemons || [];

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
    blockers.push({
      kind: 'runtime',
      id: 'daemon_unmanaged',
      scope: 'daemon',
      message: `Repo daemon is reachable with owner pid=${runtime.owner_pid ?? 'unknown'}, but it is not launchd-managed or an accepted foreground/dev runtime.`,
      target_path: daemonPath,
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

export function readyPhase(ready, blockers) {
  if (ready) return 'ready';
  if (blockers.some((b) => b.id === 'daemon_unreachable')) return 'runtime_blocked';
  if (blockers.some((b) => b.id === 'daemon_ownership_mismatch')) return 'runtime_blocked';
  if (blockers.some((b) => b.id === 'daemon_unmanaged')) return 'runtime_blocked';
  if (blockers.some((b) => b.id === 'stale_daemons')) return 'runtime_blocked';
  if (blockers.some((b) => b.kind === 'permission')) return 'human_required';
  if (blockers.some((b) => b.id === 'input_tap_not_active')) return 'runtime_blocked';
  if (blockers.some((b) => b.kind === 'setup')) return 'setup_required';
  return 'degraded';
}

export function readyDiagnosis(ready, blockers, daemon, permissions) {
  if (ready) return 'ready';
  if (blockers.some((b) => b.id === 'daemon_ownership_mismatch')) return 'daemon_ownership_mismatch';
  if (blockers.some((b) => b.id === 'daemon_unmanaged')) return 'daemon_unmanaged';
  if (blockers.some((b) => b.id === 'stale_daemons')) return 'stale_daemons';
  if (blockers.some((b) => b.id === 'daemon_unreachable')) return 'daemon_socket_unreachable';
  if (daemon && ((daemon.permissions.accessibility === false && permissions.accessibility)
      || daemon.inputTap.listenAccess === false
      || daemon.inputTap.postAccess === false)) {
    return 'daemon_tcc_grant_stale_or_missing';
  }
  if (blockers.some((b) => b.id === 'input_tap_not_active')) return 'input_tap_not_active';
  if (blockers.some((b) => b.kind === 'setup')) return 'permissions_onboarding_required';
  return 'not_ready';
}

function appendAction(actions, seen, action) {
  const key = `${action.type}|${action.command ?? action.label}`;
  if (seen.has(key)) return;
  seen.add(key);
  actions.push(action);
}

export function readyNextActions(blockers, setup, mode, prefix = invocationName()) {
  const actions = [];
  const seen = new Set();
  if (!blockers.length) return actions;

  const hasPermissionBlocker = blockers.some((b) => b.kind === 'permission');
  const hasRepairableRuntimeBlocker = blockers.some((b) => isRepairableRuntimeBlockerID(b.id));
  const hasUnmanagedDaemon = blockers.some((b) => b.id === 'daemon_unmanaged');

  if (hasPermissionBlocker) {
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

  if ((hasRepairableRuntimeBlocker || hasUnmanagedDaemon) && !hasPermissionBlocker) {
    if (blockers.some((b) => b.id === 'stale_daemons') || hasUnmanagedDaemon) {
      appendAction(actions, seen, {
        type: 'command',
        label: hasUnmanagedDaemon
          ? 'clean the unmanaged daemon that owns the repo socket'
          : 'clean stale daemon processes and stale runtime resources',
        command: `${prefix} clean`,
      });
    }
    if (hasRepairableRuntimeBlocker) {
      appendAction(actions, seen, {
        type: 'command',
        label: 'run automated repair: restart/recheck, then print human instructions if needed',
        command: `${prefix} ready --repair`,
      });
    }
    if (hasRepairableRuntimeBlocker && !hasUnmanagedDaemon) {
      appendAction(actions, seen, {
        type: 'command',
        label: 'restart the managed daemon and re-check readiness',
        command: `${prefix} service restart --mode ${mode}`,
      });
    }
  }

  if (!setup.setup_completed && !hasPermissionBlocker) {
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

export function readyNotes({ runtime, daemon, permissions, setup, cleanReport }, mode, prefix = invocationName()) {
  const notes = [];
  if (!runtime.daemon_running) notes.push('Daemon is not running.');
  else if (!runtime.socket_reachable) notes.push('Daemon process appears to be running, but the socket is not reachable.');

  if (daemon?.inputTap && daemon.inputTap.status !== 'active') {
    notes.push(inputTapRecoveryGuidance(daemon.inputTap.status, daemon.inputTap.attempts));
    if (daemon.inputTap.listenAccess === false || daemon.inputTap.postAccess === false) {
      notes.push(inputMonitoringSubGuidance(daemon.inputTap, expectedBinaryPath(mode)));
    }
  }
  if (!permissions.accessibility) notes.push('Accessibility permission is not granted (CLI view).');
  if (daemon?.permissions.accessibility === false) notes.push('Accessibility permission is not granted (daemon view).');
  if (!permissions.screen_recording) notes.push('Screen Recording permission is not granted.');
  if (!setup.setup_completed && setup.recommended_command) notes.push(`Run '${setup.recommended_command}' before interactive testing.`);
  if (cleanReport?.stale_daemons?.length) {
    notes.push(`Stale daemon cleanup required before readiness: ${cleanReport.stale_daemons.map((item) => item.pid).join(', ')}. Run '${prefix} clean'.`);
  }
  return notes;
}

export function permissionCheckNotes(cli, setup, daemon, mode) {
  const notes = [];
  if (!cli.accessibility) notes.push('Accessibility permission is not granted (CLI view).');
  if (!cli.screen_recording) notes.push('Screen Recording permission is not granted.');
  if (!cli.listen_access) notes.push('Input Monitoring listen access is not granted (CLI view).');
  if (!cli.post_access) notes.push('Input Monitoring post access is not granted (CLI view).');
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
  notes.push(`Run '${prefix} permissions reset-runtime --mode ${mode}' before requesting fresh prompts.`);
  notes.push(`Then run '${prefix} permissions setup --once' and '${prefix} ready --post-permission'.`);
  return notes;
}

export const SETUP_PROMPT_ORDER = [
  ['accessibility', 'accessibility'],
  ['screen_recording', 'screen-recording'],
  ['listen_access', 'listen-event'],
  ['post_access', 'post-event'],
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
    && initialPermissions.post_access;

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
