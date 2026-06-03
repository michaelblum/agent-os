#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

function printJSON(value) {
  process.stdout.write(`${JSON.stringify(sanitizeForJSON(value), null, 2)}\n`);
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

function parseArgs(args) {
  const options = { json: false };
  for (const arg of args) {
    if (arg === '--json') options.json = true;
    else exitError(`Unknown flag: ${arg}. Usage: ${invocationName()} doctor [--json]`, 'UNKNOWN_FLAG');
  }
  return options;
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
    exitError(`${label} failed${detail ? `: ${detail}` : ''}`, 'DOCTOR_PRIMITIVE_FAILED');
  }
  try {
    return JSON.parse(result.stdout);
  } catch {
    exitError(`${label} did not return JSON`, 'DOCTOR_PRIMITIVE_JSON_INVALID');
  }
}

function runAOS(args) {
  return run(aosPath(), args, {
    env: { ...process.env, AOS_RUNTIME_MODE: currentMode() },
  });
}

function runNodeScript(script, args) {
  return run('/usr/bin/env', ['node', script, ...args], {
    env: {
      ...process.env,
      AOS_RUNTIME_MODE: currentMode(),
      AOS_PATH: aosPath(),
      AOS_INVOCATION_DISPLAY_NAME: invocationName(),
    },
  });
}

function binaryTimestamp(file) {
  try {
    return fs.statSync(file).mtime.toISOString().replace(/\.\d{3}Z$/, 'Z');
  } catch {
    return undefined;
  }
}

function repoCommitShort() {
  const result = run('/usr/bin/git', ['-C', repoRoot(), 'rev-parse', '--short', 'HEAD']);
  return result.exitCode === 0 ? result.stdout.trim() : undefined;
}

function identity(runtime, permissionsFacts) {
  const permissionIdentity = permissionsFacts.identity ?? {};
  const mode = runtime.mode ?? currentMode();
  const value = {
    program: 'aos',
    mode,
    executable_path: permissionIdentity.executable_path || aosPath(),
    state_dir: runtime.state_dir,
    socket_path: runtime.socket_path,
  };
  if (mode === 'repo') {
    value.build_timestamp = binaryTimestamp(value.executable_path);
    value.repo_root = repoRoot();
    value.git_commit = repoCommitShort();
  }
  return value;
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

function permissionRequirements(permissions) {
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
      readyForTesting: Boolean(
        daemon.permissions.accessibility
        && permissions.screen_recording
        && setup.setup_completed,
      ),
      readySource: 'daemon',
    };
  }
  return {
    readyForTesting: Boolean(
      permissions.accessibility
      && permissions.screen_recording
      && setup.setup_completed,
    ),
    readySource: 'cli',
  };
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

function expectedBinaryPath(mode) {
  if (process.env.AOS_SERVICE_BINARY) return path.resolve(process.env.AOS_SERVICE_BINARY);
  if (mode === 'installed') {
    const installPath = process.env.AOS_INSTALL_PATH || path.join(os.homedir(), 'Applications/AOS.app');
    return path.join(installPath, 'Contents/MacOS/aos');
  }
  return path.join(repoRoot(), 'aos');
}

function runtimeHealthNotes(runtime) {
  const notes = [];
  if (runtime.ownership_state === 'mismatch') {
    const serving = runtime.serving_pid ?? 'none';
    const lock = runtime.lock_owner_pid ?? 'none';
    const service = runtime.service_pid ?? 'none';
    notes.push(`Daemon ownership mismatch: serving pid=${serving}, lock pid=${lock}, service pid=${service}.`);
  } else if (runtime.ownership_state === 'unmanaged') {
    const owner = runtime.owner_pid ?? 'unknown';
    notes.push(`Reachable repo daemon is unmanaged: owner pid=${owner}, service pid=none. Use '${invocationName()} service start --mode ${runtime.mode}' or '${invocationName()} ready --repair'.`);
  }
  if (runtime.event_tap_expected && runtime.input_tap_status && runtime.input_tap_status !== 'active' && !runtime.input_tap) {
    notes.push(`Perception input tap is not active (status=${runtime.input_tap_status}).`);
  }
  return notes;
}

function serviceState(mode) {
  const status = parseJSONOutput(
    runNodeScript('scripts/aos-service.mjs', ['status', '--mode', mode, '--json']),
    'aos-service status',
  );
  return {
    label: status.label ?? status.launchd_label,
    installed: Boolean(status.installed),
    loaded: Boolean(status.loaded),
    running: Boolean(status.running),
    pid: status.pid,
    plist_path: status.plist_path,
    actual_binary_path: status.actual_binary_path,
    expected_binary_path: status.expected_binary_path,
    actual_log_path: status.actual_log_path,
    expected_log_path: status.expected_log_path,
    target_matches_expected: Boolean(status.target_matches_expected),
    log_path_matches_expected: Boolean(status.log_path_matches_expected),
    notes: status.notes ?? [],
  };
}

function platformState() {
  const swVers = run('/usr/bin/sw_vers', ['-productVersion']);
  return {
    os: 'macOS',
    version: swVers.exitCode === 0 ? swVers.stdout.trim() : os.release(),
  };
}

function doctorNotes({ runtime, permissions, setup, service }) {
  const notes = [];
  if (!runtime.daemon_running) notes.push('Daemon is not running.');
  else if (!runtime.socket_reachable) notes.push('Daemon process appears to be running, but the socket is not reachable.');
  notes.push(...runtimeHealthNotes(runtime));
  if (runtime.other_mode_socket_reachable) {
    notes.push(`BROKEN STATE: ${runtime.mode} runtime is active while the ${runtime.mode === 'repo' ? 'installed' : 'repo'} socket is also reachable.`);
  }
  if (!permissions.accessibility) notes.push('Accessibility permission is not granted.');
  if (!permissions.screen_recording) notes.push('Screen Recording permission is not granted.');
  if (!setup.setup_completed && setup.recommended_command) {
    notes.push(`Run '${setup.recommended_command}' before interactive testing.`);
  }
  if (!service.target_matches_expected) {
    notes.push(`AOS launch agent target does not match the expected ${runtime.mode} runtime binary.`);
  }
  if (!service.log_path_matches_expected) {
    notes.push(`AOS launch agent log path does not match the expected ${runtime.mode} state directory.`);
  }
  if (runtime.legacy_state_items?.length) {
    notes.push(`Legacy shared runtime state still exists in ${runtime.legacy_state_dir}.`);
  }
  if (runtime.repo_artifacts?.length) {
    notes.push(`Repo build artifacts are still present: ${runtime.repo_artifacts.join(', ')}.`);
  }
  if (runtime.socket_reachable && runtime.input_tap && runtime.input_tap.status !== 'active') {
    notes.push(inputTapRecoveryGuidance(runtime.input_tap.status, runtime.input_tap.attempts));
    if (runtime.input_tap.listen_access === false || runtime.input_tap.post_access === false) {
      notes.push(inputMonitoringSubGuidance(runtime.input_tap, expectedBinaryPath(runtime.mode)));
    }
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

async function buildDoctorResponse() {
  const mode = currentMode();
  const permissionsFacts = parseJSONOutput(runAOS(['__permissions', 'facts', '--json']), '__permissions facts');
  const permissions = permissionsFacts.permissions ?? {};
  const setup = setupState(parseJSONOutput(runAOS(['__permissions', 'setup-marker', 'get', '--json']), '__permissions setup-marker get'));
  const daemonHealth = parseJSONOutput(runAOS(['__daemon', 'health', '--json']), '__daemon health');
  const runtime = parseJSONOutput(runAOS(['__runtime', 'status-facts', '--json']), '__runtime status-facts');
  const service = serviceState(mode);
  const evaluation = evaluateReadyForTesting(daemonView(daemonHealth), permissions, setup);
  const notes = doctorNotes({ runtime, permissions, setup, service });

  return sanitizeForJSON({
    status: notes.length ? 'degraded' : 'ok',
    platform: platformState(),
    identity: identity(runtime, permissionsFacts),
    permissions,
    permissions_requirements: permissionRequirements(permissions),
    permissions_setup: setup,
    runtime,
    aos_service: service,
    ready_for_testing: evaluation.readyForTesting,
    ready_source: evaluation.readySource,
    notes,
  });
}

parseArgs(process.argv.slice(2));
printJSON(await buildDoctorResponse());
