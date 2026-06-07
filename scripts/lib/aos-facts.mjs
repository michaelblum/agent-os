import {
  aosPath,
  binaryTimestamp,
  compactProcessDetail,
  currentMode,
  parseJSONOutput,
  repoCommitShort,
  repoRoot,
  run,
  runAOS,
  runNodeScript,
} from './aos-cli.mjs';

export function setupState(marker) {
  const setupCompleted = Boolean(marker.setup_completed);
  const state = {
    marker_exists: Boolean(marker.marker_exists),
    marker_path: marker.marker_path,
    completed_at: marker.completed_at,
    bundle_path: marker.bundle_path,
    current_bundle_path: marker.current_bundle_path,
    bundle_matches_current: Boolean(marker.bundle_matches_current),
    setup_completed: setupCompleted,
  };
  if (!setupCompleted) state.recommended_command = 'aos permissions setup --once';
  return state;
}

export function daemonView(daemonHealth) {
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

export function daemonViewFromHealth(health) {
  if (!health?.reachable || !health.input_tap) {
    return { comparable: null, block: { reachable: false } };
  }

  const tap = {
    status: health.input_tap.status,
    attempts: health.input_tap.attempts,
  };
  if (health.input_tap.listen_access !== undefined) tap.listen_access = Boolean(health.input_tap.listen_access);
  if (health.input_tap.post_access !== undefined) tap.post_access = Boolean(health.input_tap.post_access);

  const block = {
    reachable: true,
    input_tap: tap,
  };
  if (health.permissions?.accessibility !== undefined) {
    block.accessibility = Boolean(health.permissions.accessibility);
  }

  return {
    comparable: daemonView(health),
    block,
  };
}

export function identity(runtime, permissionsFacts) {
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

function processCommandLine(pid) {
  if (!Number.isInteger(pid)) {
    return { status: 'unavailable', unavailable_reason: 'owner pid unavailable' };
  }
  const result = run('/bin/ps', ['-p', String(pid), '-o', 'command=']);
  if (result.exitCode !== 0) {
    return {
      status: 'unavailable',
      unavailable_reason: compactProcessDetail(result) || `ps did not return command line for PID ${pid}`,
    };
  }
  const commandLine = result.stdout.trim();
  if (!commandLine) {
    return { status: 'unavailable', unavailable_reason: `ps returned an empty command line for PID ${pid}` };
  }
  return { status: 'available', command_line: commandLine };
}

export function enrichRuntimeOwnership(runtime) {
  if (!runtime || runtime.ownership_state !== 'unmanaged') return runtime;
  const pid = Number.isInteger(runtime.owner_pid) ? runtime.owner_pid : runtime.serving_pid;
  const command = processCommandLine(pid);
  const ownerProcess = {
    pid,
    command_line_status: command.status,
    command_line: command.command_line,
    command_line_unavailable_reason: command.unavailable_reason,
  };
  return {
    ...runtime,
    owner_process: ownerProcess,
    owner_command_line: command.command_line,
    owner_command_line_status: command.status,
    owner_command_line_unavailable_reason: command.unavailable_reason,
  };
}

export function cleanReport() {
  const result = runNodeScript('scripts/aos-clean.mjs', ['--dry-run', '--json']);
  if (result.exitCode === 0) {
    try {
      return JSON.parse(result.stdout);
    } catch {
      return { status: 'unknown', stale_daemons: [], canvases: [], notes: ['clean dry-run failed'] };
    }
  }
  return {
    status: 'unknown',
    stale_daemons: [],
    canvases: [],
    notes: [compactProcessDetail(result) || 'clean dry-run failed'],
  };
}

export function brokerFacts({
  failureCode,
  jsonCode,
  daemonRequired = true,
  includeRuntime = true,
  includeClean = false,
} = {}) {
  const parse = (result, label) => parseJSONOutput(result, label, { failureCode, jsonCode });
  const permissionsFacts = parse(runAOS(['__permissions', 'facts', '--json']), '__permissions facts');
  const setup = setupState(parse(runAOS(['__permissions', 'setup-marker', 'get', '--json']), '__permissions setup-marker get'));
  const daemonResult = runAOS(['__daemon', 'health', '--json']);
  let daemonHealth = null;
  if (daemonRequired) {
    daemonHealth = parse(daemonResult, '__daemon health');
  } else if (daemonResult.exitCode === 0) {
    try {
      daemonHealth = JSON.parse(daemonResult.stdout);
    } catch {
      daemonHealth = null;
    }
  }
  const runtime = includeRuntime ? enrichRuntimeOwnership(parse(runAOS(['__runtime', 'status-facts', '--json']), '__runtime status-facts')) : undefined;
  return {
    permissionsFacts,
    permissions: permissionsFacts.permissions ?? {},
    setup,
    daemonHealth,
    daemon: daemonView(daemonHealth),
    runtime,
    cleanReport: includeClean ? cleanReport() : undefined,
  };
}
