import {
  aosPath,
  binaryTimestamp,
  compactProcessDetail,
  currentMode,
  parseJSONOutput,
  repoCommitShort,
  repoRoot,
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

export function runtimeHealthNotes(runtime, prefix = './aos') {
  const notes = [];
  if (runtime.ownership_state === 'mismatch') {
    const serving = runtime.serving_pid ?? 'none';
    const lock = runtime.lock_owner_pid ?? 'none';
    const service = runtime.service_pid ?? 'none';
    notes.push(`Daemon ownership mismatch: serving pid=${serving}, lock pid=${lock}, service pid=${service}.`);
  } else if (runtime.ownership_state === 'unmanaged') {
    const owner = runtime.owner_pid ?? 'unknown';
    notes.push(`Reachable repo daemon is unmanaged: owner pid=${owner}, service pid=none. Use '${prefix} service start --mode ${runtime.mode}' or '${prefix} ready --repair'.`);
  }
  if (runtime.event_tap_expected && runtime.input_tap_status && runtime.input_tap_status !== 'active' && !runtime.input_tap) {
    notes.push(`Perception input tap is not active (status=${runtime.input_tap_status}).`);
  }
  return notes;
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
  const runtime = includeRuntime ? parse(runAOS(['__runtime', 'status-facts', '--json']), '__runtime status-facts') : undefined;
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
