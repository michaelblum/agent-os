export function buildServiceStatus(serviceStatus) {
  if (!serviceStatus.ok) {
    return {
      status: serviceStatus.status === 'failed' ? 'failed' : 'unknown',
      command_status: serviceStatus.status,
      canonical_status: null,
      error: serviceStatus.error,
      running: null,
    };
  }
  const value = serviceStatus.value;
  const canonicalStatus = typeof value.status === 'string' ? value.status : 'unknown';
  const status = canonicalStatus === 'ok'
    ? 'ready'
    : (canonicalStatus === 'degraded' ? 'degraded' : 'unknown');
  return {
    status,
    canonical_status: canonicalStatus,
    reason: value.reason ?? null,
    mode: value.mode ?? null,
    installed: value.installed ?? null,
    loaded: Boolean(value.loaded),
    running: Boolean(value.running),
    pid: value.pid ?? null,
    label: value.label ?? value.launchd_label ?? null,
    launchd_label: value.launchd_label ?? value.label ?? null,
    actual_binary_path: value.actual_binary_path ?? null,
    expected_binary_path: value.expected_binary_path ?? null,
    actual_log_path: value.actual_log_path ?? null,
    expected_log_path: value.expected_log_path ?? null,
    target_matches_expected: value.target_matches_expected ?? null,
    log_path_matches_expected: value.log_path_matches_expected ?? null,
    plist_path: value.plist_path ?? null,
    state_dir: value.state_dir ?? null,
    notes: value.notes ?? [],
  };
}

export function buildPermissionStatus(permissionStatus) {
  if (!permissionStatus.ok) {
    return {
      status: 'unknown',
      command_status: permissionStatus.status,
      error: permissionStatus.error,
      ready_for_testing: null,
      missing_permissions: [],
    };
  }
  const value = permissionStatus.value;
  const readyForTesting = Boolean(value.ready_for_testing);
  return {
    status: readyForTesting ? 'ready' : 'degraded',
    canonical_status: value.status ?? null,
    ready_for_testing: readyForTesting,
    ready_source: value.ready_source ?? null,
    permissions: value.permissions ?? {},
    cli_view: value.cli_view ?? {},
    daemon_view: value.daemon_view ?? {},
    requirements: value.requirements ?? [],
    missing_permissions: value.missing_permissions ?? [],
    notes: value.notes ?? [],
  };
}

export function buildRuntimeSummary({
  mode,
  stateRootPath,
  stateDirPath,
  service,
  permissions,
}) {
  const blockers = [];
  if (service.status !== 'ready') {
    blockers.push({
      id: 'service_not_ready',
      kind: 'service',
      status: service.status,
      message: 'AOS repo service is not reporting ready from passive service status.',
    });
  }
  if (permissions.status !== 'ready') {
    blockers.push({
      id: 'permissions_not_ready',
      kind: 'permission',
      status: permissions.status,
      message: 'Permission preflight is not ready for testing.',
    });
    for (const permission of permissions.missing_permissions || []) {
      blockers.push({
        id: `permission:${permission}`,
        kind: 'permission',
        message: `${permission} permission is missing or unknown.`,
      });
    }
  }
  return {
    mode,
    state_root: stateRootPath,
    state_dir: stateDirPath,
    repo_mode: mode === 'repo',
    installed_mode: mode === 'installed',
    service,
    permissions,
    readiness: {
      status: blockers.length ? 'degraded' : 'ready',
      ready: blockers.length === 0,
      blockers,
    },
  };
}
