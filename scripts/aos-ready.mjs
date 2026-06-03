#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

function printJSON(value) {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

function exitError(message, code) {
  process.stderr.write(`{\n  "code" : "${code}",\n  "error" : "${message}"\n}\n`);
  process.exit(1);
}

function repoRoot() {
  if (process.env.AOS_REPO_ROOT) return path.resolve(process.env.AOS_REPO_ROOT);
  const scriptDir = path.dirname(new URL(import.meta.url).pathname);
  return path.resolve(scriptDir, '..');
}

function aosPath() {
  return process.env.AOS_PATH || path.join(repoRoot(), 'aos');
}

function invocationName() {
  return process.env.AOS_INVOCATION_DISPLAY_NAME || './aos';
}

function currentMode() {
  const override = process.env.AOS_RUNTIME_MODE?.toLowerCase();
  if (override === 'repo' || override === 'installed') return override;
  return 'repo';
}

function installAppPath() {
  return process.env.AOS_INSTALL_PATH || path.join(os.homedir(), 'Applications/AOS.app');
}

function expectedBinaryPath(mode) {
  if (process.env.AOS_SERVICE_BINARY) return path.resolve(process.env.AOS_SERVICE_BINARY);
  if (mode === 'installed') return path.join(installAppPath(), 'Contents/MacOS/aos');
  return path.join(repoRoot(), 'aos');
}

function run(executable, args, options = {}) {
  const result = spawnSync(executable, args, {
    cwd: options.cwd ?? repoRoot(),
    env: options.env ?? process.env,
    encoding: 'utf8',
  });
  return {
    exitCode: result.status ?? 127,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? (result.error ? `${result.error.message}\n` : ''),
  };
}

function parseJSONOutput(result, label) {
  if (result.exitCode !== 0) {
    const detail = (result.stderr || result.stdout).trim();
    exitError(`${label} failed${detail ? `: ${detail}` : ''}`, 'READY_PRIMITIVE_FAILED');
  }
  try {
    return JSON.parse(result.stdout);
  } catch {
    exitError(`${label} did not return JSON`, 'READY_PRIMITIVE_JSON_INVALID');
  }
}

function runAOS(args) {
  return run(aosPath(), args, {
    env: { ...process.env, AOS_RUNTIME_MODE: currentMode() },
  });
}

function runNodeScript(script, args) {
  return run('/usr/bin/env', ['node', script, ...args], {
    env: { ...process.env, AOS_RUNTIME_MODE: currentMode(), AOS_PATH: aosPath() },
  });
}

function compactProcessDetail(output) {
  const combined = [output.stderr, output.stdout]
    .map((part) => String(part || '').trim())
    .filter(Boolean)
    .join('\n')
    .trim();
  if (!combined) return undefined;

  try {
    const object = JSON.parse(combined);
    if (object.error && typeof object.error === 'object') {
      const code = object.error.code ?? 'unknown';
      const message = object.error.message ?? '';
      return message ? `error=${code}: ${message}` : `error=${code}`;
    }
    const parts = [
      object.status ? `status=${object.status}` : null,
      object.reason ? `reason=${object.reason}` : null,
      object.input_tap?.status ? `tap=${object.input_tap.status}` : null,
      object.input_tap?.attempts !== undefined ? `attempts=${object.input_tap.attempts}` : null,
    ].filter(Boolean);
    if (parts.length) return parts.join(' ');
  } catch {
    // Fall through to clipped text.
  }

  const clipped = combined.split(/\r?\n/).slice(0, 6).join('\n');
  return clipped.length <= 700 ? clipped : `${clipped.slice(0, 700)}...`;
}

function parseArgs(args) {
  const options = { json: false, repair: false, postPermission: false };
  for (const arg of args) {
    if (arg === '--json') options.json = true;
    else if (arg === '--repair') options.repair = true;
    else if (arg === '--post-permission') options.postPermission = true;
    else exitError(`Unknown flag: ${arg}. Usage: ${invocationName()} ready [--json] [--repair] [--post-permission]`, 'UNKNOWN_FLAG');
  }
  return options;
}

function permissionEntryName(mode) {
  return mode === 'repo' ? 'aos' : 'AOS.app';
}

function permissionPanel(id) {
  if (id === 'accessibility') return 'Accessibility';
  if (id === 'screen_recording') return 'Screen Recording';
  if (id === 'listen_access' || id === 'post_access' || id === 'input_monitoring_listen' || id === 'input_monitoring_post') return 'Input Monitoring';
  return id;
}

function permissionAction(blocker, mode) {
  if (mode === 'repo' && blocker.scope === 'daemon') return 'targeted reset';
  return 'enable';
}

function permissionFixLines(blockers, mode) {
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

function permissionResetSafeSequenceLines(blockers, mode, prefix) {
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

function staleGrantGuidance(mode, service) {
  const lower = service.toLowerCase();
  const panel = lower.includes('input monitoring') ? 'Input Monitoring' : lower.includes('screen') ? 'Screen Recording' : 'Accessibility';
  const entry = permissionEntryName(mode);
  if (mode === 'repo') {
    return `${panel} -> ${entry} (targeted reset via ${invocationName()} permissions reset-runtime --mode repo)`;
  }
  return `${panel} -> ${entry} (enable)`;
}

function inputTapRecoveryGuidance(status, attempts) {
  return [
    `Input tap is not active (status=${status}, attempts=${attempts}).`,
    'Try:',
    '  ./aos service restart              # restart the managed daemon and re-check readiness',
    '  ./aos permissions setup --once     # refresh macOS permission onboarding',
    '  ./aos serve --idle-timeout none    # temporary foreground fallback for this session',
  ].join('\n');
}

function inputMonitoringSubGuidance(tap, daemonBinaryPath) {
  const render = (value) => value === undefined || value === null ? 'unknown' : String(Boolean(value));
  return [
    `Daemon lacks Input Monitoring access (listen=${render(tap?.listen_access)}, post=${render(tap?.post_access)}).`,
    'In repo mode, prefer:',
    '  ./aos permissions reset-runtime --mode repo',
    '  ./aos permissions setup --once',
    '  ./aos ready --post-permission',
    'Manual Settings fallback: Privacy & Security > Input Monitoring for daemon binary:',
    `  ${daemonBinaryPath}`,
  ].join('\n');
}

function setupState(marker) {
  return {
    marker_exists: Boolean(marker.marker_exists),
    marker_path: marker.marker_path,
    completed_at: marker.completed_at,
    bundle_path: marker.bundle_path,
    current_bundle_path: marker.current_bundle_path,
    bundle_matches_current: Boolean(marker.bundle_matches_current),
    setup_completed: Boolean(marker.setup_completed),
    recommended_command: marker.setup_completed ? undefined : 'aos permissions setup --once',
  };
}

function daemonView(daemonHealth) {
  if (!daemonHealth?.reachable || !daemonHealth.input_tap) return null;
  return {
    inputTap: {
      status: daemonHealth.input_tap.status,
      attempts: daemonHealth.input_tap.attempts,
      listenAccess: daemonHealth.input_tap.listen_access,
      postAccess: daemonHealth.input_tap.post_access,
    },
    permissions: {
      accessibility: daemonHealth.permissions?.accessibility,
    },
  };
}

function evaluateReadyForTesting(daemon, permissions, setup) {
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

function currentFacts() {
  const permissionsFacts = parseJSONOutput(runAOS(['__permissions', 'facts', '--json']), '__permissions facts');
  const setup = setupState(parseJSONOutput(runAOS(['__permissions', 'setup-marker', 'get', '--json']), '__permissions setup-marker get'));
  const daemonHealth = parseJSONOutput(runAOS(['__daemon', 'health', '--json']), '__daemon health');
  const runtime = parseJSONOutput(runAOS(['__runtime', 'status-facts', '--json']), '__runtime status-facts');
  const cleanResult = runNodeScript('scripts/aos-clean.mjs', ['--dry-run', '--json']);
  let cleanReport;
  if (cleanResult.exitCode === 0) {
    try {
      cleanReport = JSON.parse(cleanResult.stdout);
    } catch {
      cleanReport = { status: 'unknown', stale_daemons: [], canvases: [], notes: ['clean dry-run failed'] };
    }
  } else {
    cleanReport = { status: 'unknown', stale_daemons: [], canvases: [], notes: [compactProcessDetail(cleanResult) || 'clean dry-run failed'] };
  }
  return {
    permissions: permissionsFacts.permissions,
    setup,
    daemonHealth,
    daemon: daemonView(daemonHealth),
    runtime,
    cleanReport,
  };
}

function readyBlockers({ runtime, daemon, permissions, setup, cleanReport }, mode) {
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

function isRepairableRuntimeBlockerID(id) {
  return id === 'daemon_unreachable'
    || id === 'daemon_ownership_mismatch'
    || id === 'stale_daemons'
    || id === 'input_tap_not_active';
}

function readyPhase(ready, blockers) {
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

function readyDiagnosis(ready, blockers, daemon, permissions) {
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

function readyNextActions(blockers, setup, mode, prefix) {
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

function readyNotes({ runtime, daemon, permissions, setup, cleanReport }, mode) {
  const notes = [];
  if (!runtime.daemon_running) notes.push('Daemon is not running.');
  else if (!runtime.socket_reachable) notes.push('Daemon process appears to be running, but the socket is not reachable.');

  if (daemon?.inputTap && daemon.inputTap.status !== 'active') {
    notes.push(inputTapRecoveryGuidance(daemon.inputTap.status, daemon.inputTap.attempts));
    if (daemon.inputTap.listenAccess === false || daemon.inputTap.postAccess === false) {
      notes.push(inputMonitoringSubGuidance({
        listen_access: daemon.inputTap.listenAccess,
        post_access: daemon.inputTap.postAccess,
      }, expectedBinaryPath(mode)));
    }
  }
  if (!permissions.accessibility) notes.push('Accessibility permission is not granted (CLI view).');
  if (daemon?.permissions.accessibility === false) notes.push('Accessibility permission is not granted (daemon view).');
  if (!permissions.screen_recording) notes.push('Screen Recording permission is not granted.');
  if (!setup.setup_completed && setup.recommended_command) notes.push(`Run '${setup.recommended_command}' before interactive testing.`);
  if (cleanReport?.stale_daemons?.length) {
    notes.push(`Stale daemon cleanup required before readiness: ${cleanReport.stale_daemons.map((item) => item.pid).join(', ')}. Run '${invocationName()} clean'.`);
  }
  return notes;
}

function sanitizeForJSON(value) {
  if (Array.isArray(value)) return value.map(sanitizeForJSON);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value)
      .filter(([, child]) => child !== undefined)
      .map(([key, child]) => [key, sanitizeForJSON(child)]));
  }
  return value;
}

function buildReadyResponse(startup, actionTrace, mode, prefix) {
  const facts = currentFacts();
  const evaluation = evaluateReadyForTesting(facts.daemon, facts.permissions, facts.setup);
  const blockers = readyBlockers(facts, mode);
  const ready = Boolean(facts.runtime.socket_reachable && evaluation.readyForTesting && blockers.length === 0);
  const blockedCapabilities = [...new Set(blockers.flatMap((blocker) => blocker.blocks || []))].sort();
  const phase = readyPhase(ready, blockers);
  const diagnosis = readyDiagnosis(ready, blockers, facts.daemon, facts.permissions);
  return sanitizeForJSON({
    status: ready ? 'ok' : 'degraded',
    ready,
    phase,
    diagnosis,
    mode,
    ready_source: evaluation.readySource,
    startup,
    runtime: facts.runtime,
    permissions: facts.permissions,
    permissions_setup: facts.setup,
    blocked_capabilities: blockedCapabilities,
    blockers,
    next_actions: readyNextActions(blockers, facts.setup, mode, prefix),
    action_trace: actionTrace,
    notes: readyNotes(facts, mode),
  });
}

function serviceCommandString(mode, prefix, action) {
  return `${prefix} service ${action} --mode ${mode} --json`;
}

function decideReadyStartup({ repair, mode, prefix }) {
  const skipServiceStart = process.env.AOS_TEST_SKIP_READY_SERVICE_START === '1';
  const skippedStartup = {
    attempted: false,
    command: serviceCommandString(mode, prefix, 'start'),
    exit_code: 0,
    status: 'skipped',
  };

  if (skipServiceStart) {
    return {
      startup: skippedStartup,
      actionTrace: [{
        step: 'service_start',
        result: 'skipped',
        detail: 'AOS_TEST_SKIP_READY_SERVICE_START=1',
      }],
    };
  }

  if (!repair) {
    const preflight = buildReadyResponse(skippedStartup, [], mode, prefix);
    if (preflight.ready) {
      return {
        startup: skippedStartup,
        actionTrace: [{
          step: 'ready_preflight',
          result: 'ready',
          detail: 'managed daemon is already reachable, owned by the expected runtime, and input tap is active',
        }],
      };
    }
  }

  const result = runNodeScript('scripts/aos-service.mjs', ['start', '--mode', mode, '--json']);
  return {
    startup: {
      attempted: true,
      command: serviceCommandString(mode, prefix, 'start'),
      exit_code: result.exitCode,
      status: result.exitCode === 0 ? 'ok' : 'degraded',
    },
    actionTrace: [{
      step: 'service_start',
      result: result.exitCode === 0 ? 'ok' : 'degraded',
      detail: result.exitCode === 0 ? undefined : compactProcessDetail(result),
    }],
  };
}

function waitForReadyResponse(startup, actionTrace, mode, prefix, budgetMs) {
  const deadline = Date.now() + budgetMs;
  while (Date.now() < deadline) {
    const response = buildReadyResponse(startup, actionTrace, mode, prefix);
    if (response.ready) {
      const trace = [...actionTrace, {
        step: 'wait_for_recovery',
        result: 'ready',
        detail: 'daemon became ready during repair wait',
      }];
      return buildReadyResponse(startup, trace, mode, prefix);
    }
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 500);
  }
  const trace = [...actionTrace, {
    step: 'wait_for_recovery',
    result: 'timed_out',
    detail: `daemon did not become ready within ${budgetMs}ms`,
  }];
  return buildReadyResponse(startup, trace, mode, prefix);
}

function readyAutoRepairReason(response, postPermission) {
  if (response.ready) return null;
  const blockerIDs = new Set(response.blockers.map((blocker) => blocker.id));
  const hasRepairableRuntimeBlocker = response.blockers.some((blocker) => isRepairableRuntimeBlockerID(blocker.id));
  if (blockerIDs.has('stale_daemons')) return null;
  if (blockerIDs.has('daemon_unmanaged')) return null;
  if (postPermission && hasRepairableRuntimeBlocker) return 'post-permission bounded daemon restart/recheck';
  if (blockerIDs.has('daemon_ownership_mismatch')) return 'automatic after daemon ownership mismatch';
  if (blockerIDs.has('input_tap_not_active')) return 'automatic after input tap inactive';
  return null;
}

function runReadyRuntimeRepair(startup, actionTrace, mode, prefix, budgetMs, reason) {
  const result = runNodeScript('scripts/aos-service.mjs', ['restart', '--mode', mode, '--json']);
  const detail = [reason, compactProcessDetail(result)].filter(Boolean).join('\n');
  const trace = [...actionTrace, {
    step: 'service_restart',
    result: result.exitCode === 0 ? 'ok' : 'degraded',
    detail: detail || undefined,
  }];
  return waitForReadyResponse(startup, trace, mode, prefix, budgetMs);
}

function runReadyCleanRepair(startup, actionTrace, mode, prefix) {
  const result = runAOS(['clean', '--json']);
  const trace = [...actionTrace, {
    step: 'clean',
    result: result.exitCode === 0 ? 'ok' : 'failed',
    detail: compactProcessDetail(result),
  }];
  return buildReadyResponse(startup, trace, mode, prefix);
}

function printReadyHumanHandoff(response, mode, prefix) {
  if (response.phase !== 'human_required') return;
  const permissionBlockers = response.blockers.filter((blocker) => blocker.kind === 'permission');
  if (!permissionBlockers.length) return;

  process.stdout.write('\n');
  process.stdout.write('Human action needed:\n');
  process.stdout.write('Preferred permission reset sequence:\n');
  for (const line of permissionResetSafeSequenceLines(permissionBlockers, mode, prefix)) {
    process.stdout.write(`  ${line}\n`);
  }
  process.stdout.write('Affected permissions:\n');
  for (const line of permissionFixLines(permissionBlockers, mode)) {
    process.stdout.write(`  ${line}\n`);
  }
  process.stdout.write('Manual Settings removal is only the fallback if reset-runtime reports that targeted reset is unavailable or failed.\n');
}

function printText(response, mode, prefix) {
  if (response.ready) {
    process.stdout.write(`ready=true mode=${mode} daemon=reachable tap=${response.runtime.input_tap_status ?? 'unknown'}\n`);
    return;
  }

  const daemonState = response.runtime.socket_reachable ? 'reachable' : (response.runtime.daemon_running ? 'running' : 'down');
  process.stdout.write(`ready=false phase=${response.phase} diagnosis=${response.diagnosis} mode=${mode} daemon=${daemonState} tap=${response.runtime.input_tap_status ?? 'unknown'} blocked=${response.blocked_capabilities.join(',')}\n`);
  if (response.action_trace.length) {
    process.stdout.write('Action trace:\n');
    for (const step of response.action_trace) {
      process.stdout.write(`  ${step.step}: ${step.result}\n`);
      if (step.detail) process.stdout.write(`    ${step.detail}\n`);
    }
  }
  for (const blocker of response.blockers) {
    if (response.phase === 'human_required' && blocker.kind === 'permission') continue;
    process.stdout.write(`- ${blocker.message}\n`);
    if (blocker.target_path) process.stdout.write(`  target: ${blocker.target_path}\n`);
    if (blocker.settings_url) process.stdout.write(`  settings: ${blocker.settings_url}\n`);
  }
  printReadyHumanHandoff(response, mode, prefix);
  if (response.next_actions.length) {
    process.stdout.write('Next:\n');
    for (const action of response.next_actions) {
      if (response.phase === 'human_required' && action.type === 'open_settings') continue;
      if (action.command) process.stdout.write(`  ${action.command}  # ${action.label}\n`);
      else process.stdout.write(`  ${action.label}\n`);
    }
  }
}

const options = parseArgs(process.argv.slice(2));
const mode = currentMode();
const prefix = invocationName();
const decision = decideReadyStartup({ repair: options.repair, mode, prefix });
let response = buildReadyResponse(decision.startup, decision.actionTrace, mode, prefix);

if (!options.repair && process.env.AOS_TEST_SKIP_READY_SERVICE_START !== '1') {
  const reason = readyAutoRepairReason(response, options.postPermission);
  if (reason) {
    response = runReadyRuntimeRepair(
      decision.startup,
      response.action_trace,
      mode,
      prefix,
      options.postPermission ? 20_000 : 10_000,
      reason,
    );
  }
}

if (options.repair && !response.ready) {
  if (response.blockers.some((blocker) => blocker.id === 'stale_daemons')) {
    response = runReadyCleanRepair(decision.startup, response.action_trace, mode, prefix);
  }
  if (response.blockers.some((blocker) => isRepairableRuntimeBlockerID(blocker.id))) {
    response = runReadyRuntimeRepair(decision.startup, response.action_trace, mode, prefix, 20_000, null);
  }
  if (!response.ready && response.blockers.some((blocker) => blocker.kind === 'permission')) {
    const trace = [...response.action_trace, {
      step: 'runtime_tcc_reset_handoff',
      result: 'human_required',
      detail: `${prefix} permissions reset-runtime --mode ${mode}`,
    }];
    response = buildReadyResponse(decision.startup, trace, mode, prefix);
  }
} else if (!options.repair) {
  response = buildReadyResponse(decision.startup, response.action_trace, mode, prefix);
}

if (options.json) printJSON(response);
else printText(response, mode, prefix);

process.exit(response.ready ? 0 : 1);
