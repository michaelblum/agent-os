function commandArgv(prefix, ...args) {
  return [prefix, ...args];
}

function addRecommendation(recommendations, recommendation) {
  if (recommendations.some((item) => item.id === recommendation.id)) return recommendation.id;
  recommendations.push({
    display_only: false,
    ...recommendation,
  });
  return recommendation.id;
}

function capability(status, blockers = []) {
  return {
    status,
    blockers,
  };
}

export function commandIdentity(prefix, id) {
  return {
    path: ['experience', 'status'],
    argv: commandArgv(prefix, 'experience', 'status', id, '--json'),
    read_only: true,
  };
}

export function buildCapabilities({
  runtime,
  pendingAnnotations,
}) {
  const serviceReady = runtime.service.status === 'ready';
  const permissionReady = runtime.permissions.ready_for_testing === true;
  const permissions = runtime.permissions.permissions || {};
  const permissionBlockers = permissionReady
    ? []
    : [
        'permissions_not_ready',
        ...(runtime.permissions.missing_permissions || []).map((permission) => `permission:${permission}`),
      ];
  const requiredPermissionBlockers = (ids) => ids
    .filter((id) => !permissions[id])
    .map((id) => `${id}_missing`);
  const annotationStoreCorrupt = pendingAnnotations.supported === true && pendingAnnotations.status === 'corrupt';
  const annotation = pendingAnnotations.supported === false
    ? capability('unsupported', [])
    : capability(
      annotationStoreCorrupt ? 'blocked' : (serviceReady && permissionReady ? 'ready' : 'degraded'),
      [
        ...(!serviceReady ? ['service_not_ready'] : []),
        ...permissionBlockers,
        ...(annotationStoreCorrupt ? ['pending_annotation_state_corrupt'] : []),
      ],
    );
  return {
    perception: capability(
      serviceReady && permissionReady && permissions.screen_recording ? 'ready' : 'blocked',
      [
        ...(!serviceReady ? ['service_not_ready'] : []),
        ...permissionBlockers,
        ...requiredPermissionBlockers(['screen_recording']),
      ],
    ),
    annotation,
    saved_ref_action: capability(
      serviceReady && permissionReady && permissions.accessibility && permissions.listen_access && permissions.post_access ? 'ready' : 'blocked',
      [
        ...(!serviceReady ? ['service_not_ready'] : []),
        ...permissionBlockers,
        ...requiredPermissionBlockers(['accessibility', 'listen_access', 'post_access']),
      ],
    ),
    evidence_handoff: capability(
      pendingAnnotations.status === 'corrupt' ? 'blocked' : 'ready',
      pendingAnnotations.status === 'corrupt' ? ['pending_annotation_state_corrupt'] : [],
    ),
  };
}

export function diagnosticsFor({
  active,
  requestedId,
  config,
  contentRoots,
  pendingAnnotations,
  runtime,
}) {
  const diagnostics = [];
  const add = (id, severity, message, extra = {}) => diagnostics.push({ ...extra, id, severity, message });

  if (active.source_status === 'corrupt') {
    add('active-experience-state-corrupt', 'error', 'Experience state file is corrupt.', { path: active.source_path });
  } else if (active.id !== requestedId) {
    add('active-experience-mismatch', 'warning', 'Active experience differs from requested experience.', {
      active_experience: active.id,
      requested_experience: requestedId,
      repair_action: 'activate_experience',
    });
  }
  if (config.status === 'corrupt') {
    add('runtime-config-corrupt', 'error', 'Runtime config is corrupt.', { path: config.path });
  }
  for (const root of contentRoots.roots) {
    if (root.declared_path_status !== 'current') {
      add(`content-root-declared-path-invalid:${root.key}`, 'warning', `Declared content root ${root.key} is ${root.declared_path_status}.`, {
        status: root.declared_path_status,
        repair_action: 'fix_declared_path',
        declared_path: root.declared_path,
        declared_path_type: root.declared_path_type,
        ...(root.declared_path_error_code ? { declared_path_error_code: root.declared_path_error_code } : {}),
        configured_path: root.configured_path,
        live_path: root.live_path,
      });
      continue;
    }
    if (root.configured_status !== 'current') {
      add(`content-root-config-drift:${root.key}`, 'warning', `Configured content root ${root.key} is ${root.configured_status}.`, {
        status: root.configured_status,
        repair_action: 'activate_experience',
        declared_path: root.declared_path,
        configured_path: root.configured_path,
        live_path: root.live_path,
      });
    }
    if (root.live_status === 'unknown') {
      add(`content-root-live-readback-unknown:${root.key}`, 'warning', `Live content root ${root.key} could not be read.`, {
        status: root.live_status,
        repair_action: 'inspect_runtime',
        declared_path: root.declared_path,
        configured_path: root.configured_path,
        live_path: root.live_path,
      });
    } else if (root.live_status !== 'current') {
      add(`content-root-live-drift:${root.key}`, 'warning', `Live content root ${root.key} is ${root.live_status}.`, {
        status: root.live_status,
        repair_action: 'activate_experience',
        declared_path: root.declared_path,
        configured_path: root.configured_path,
        live_path: root.live_path,
      });
    }
  }
  if (pendingAnnotations.status === 'corrupt') {
    add('pending-annotation-state-corrupt', 'error', 'Pending annotation state is corrupt.', {
      root: pendingAnnotations.root,
    });
  } else if (pendingAnnotations.supported && pendingAnnotations.status !== 'initialized') {
    add('pending-annotation-state-not-initialized', 'info', 'Pending annotation state root is not initialized yet.', {
      root: pendingAnnotations.root,
      status: pendingAnnotations.status,
    });
  }
  if (pendingAnnotations.lock?.status === 'stale') {
    add('pending-annotation-stale-lock', 'warning', 'Pending annotation mutation lock appears stale.', {
      path: pendingAnnotations.lock.path,
      owner_pid: pendingAnnotations.lock.owner_pid,
    });
  }
  for (const blocker of runtime.readiness.blockers) {
    add(`runtime:${blocker.id}`, blocker.kind === 'permission' ? 'error' : 'warning', blocker.message, blocker);
  }
  return diagnostics;
}

export function attachRecommendations({
  diagnostics,
  recommendations,
  prefix,
  requestedId,
  contentRoots,
  pendingAnnotations,
  runtime,
}) {
  const activationDiagnostics = diagnostics.filter((item) => item.repair_action === 'activate_experience');
  const needsActivation = activationDiagnostics.length > 0;
  if (needsActivation) {
    const id = addRecommendation(recommendations, {
      id: 'activate-requested-experience',
      kind: 'command',
      reason: 'Reconcile active experience and content roots.',
      argv: commandArgv(prefix, 'experience', 'activate', requestedId, '--json', '--allow-start'),
    });
    for (const item of activationDiagnostics) {
      item.recommended_next_id = id;
    }
  }
  if (runtime.readiness.status !== 'ready') {
    addRecommendation(recommendations, {
      id: 'check-runtime-readiness',
      kind: 'command',
      reason: 'Run the normal readiness gate outside this read-only context check.',
      argv: commandArgv(prefix, 'ready', '--json'),
    });
  }
  if ((runtime.permissions.missing_permissions || []).length > 0) {
    addRecommendation(recommendations, {
      id: 'permissions-setup',
      kind: 'command',
      reason: 'Record or repair missing permission onboarding state without resetting TCC.',
      argv: commandArgv(prefix, 'permissions', 'setup', '--once', '--json'),
    });
  }
  if (pendingAnnotations.supported && pendingAnnotations.status === 'not_initialized') {
    addRecommendation(recommendations, {
      id: 'pending-annotation-create-display-only',
      kind: 'hint',
      display_only: true,
      reason: 'Pending annotation state is initialized by the first annotation create flow; target details are user/session specific.',
      argv: commandArgv(prefix, 'see', 'annotation', 'create', '--target-kind', 'region', '--target-summary', '<target-summary>', '--json'),
    });
  }
  if (contentRoots.command_status !== 'ok') {
    addRecommendation(recommendations, {
      id: 'content-status',
      kind: 'command',
      reason: 'Re-run the content root readback directly.',
      argv: commandArgv(prefix, 'content', 'status', '--json'),
    });
  }
}
