import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {
  discoverExperience,
  equivalentContentURLs,
  experienceEnvironment,
  mountedSurfaceMenuItemsForSurface,
  mountedSurfaceMenuProjectionFromURL,
  projectedToggleURL,
  resolveContentRoots,
  rootMap,
} from './experience-manifest.mjs';
import {
  stateDir as workspaceStateDir,
  stateRoot as workspaceStateRoot,
} from './agent-workspace/core.mjs';
import {
  pendingRoot,
  recordsDir,
  indexPath,
} from './pending-annotations-store.mjs';

export const EXPERIENCE_RUNTIME_CONTEXT_SCHEMA_VERSION = 'aos.experience-runtime-context.v0';

const LOCK_STALE_MS = 30000;

function readJSONIfExists(file) {
  try {
    return { status: 'ok', value: JSON.parse(fs.readFileSync(file, 'utf8')) };
  } catch (error) {
    if (error?.code === 'ENOENT') return { status: 'missing', value: null };
    return { status: 'corrupt', value: null, error: error.message };
  }
}

function lstatStatus(file) {
  try {
    const stat = fs.lstatSync(file);
    return {
      exists: true,
      is_directory: stat.isDirectory(),
      is_file: stat.isFile(),
      is_symlink: stat.isSymbolicLink(),
      mtime_ms: stat.mtimeMs,
    };
  } catch (error) {
    if (error?.code === 'ENOENT') return { exists: false };
    return { exists: false, error: error.message };
  }
}

function pathExists(file) {
  return lstatStatus(file).exists;
}

function normalizePathForCompare(repoRoot, value) {
  return path.resolve(repoRoot, value);
}

function run(command, args, { env = process.env, timeout = 15000 } = {}) {
  const result = spawnSync(command, args, {
    cwd: process.cwd(),
    encoding: 'utf8',
    env,
    maxBuffer: 100 * 1024 * 1024,
    timeout,
  });
  return {
    status: result.status ?? 1,
    stdout: result.stdout || '',
    stderr: result.stderr || (result.error ? result.error.message : ''),
  };
}

function runAosJSON(aos, args, {
  env = process.env,
  mode = 'repo',
  timeout = 15000,
} = {}) {
  const result = run(aos, args, {
    env: { ...env, AOS_RUNTIME_MODE: mode },
    timeout,
  });
  if (result.status !== 0) {
    return {
      ok: false,
      status: 'failed',
      exit_code: result.status,
      error: (result.stderr || result.stdout).trim() || `aos ${args.join(' ')} failed`,
    };
  }
  try {
    return {
      ok: true,
      status: 'ok',
      value: JSON.parse(result.stdout),
    };
  } catch (error) {
    return {
      ok: false,
      status: 'invalid_json',
      exit_code: result.status,
      error: error.message,
    };
  }
}

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

function commandIdentity(prefix, id) {
  return {
    path: ['experience', 'status'],
    argv: commandArgv(prefix, 'experience', 'status', id, '--json'),
    read_only: true,
  };
}

function statusRank(status) {
  return {
    current: 0,
    ready: 0,
    initialized: 0,
    ok: 0,
    not_applicable: 0,
    unknown: 1,
    missing: 2,
    not_initialized: 2,
    disabled: 2,
    stale: 2,
    drift: 2,
    mismatch: 2,
    degraded: 2,
    wrong_surface: 2,
    corrupt: 3,
    blocked: 3,
    failed: 3,
  }[status] ?? 2;
}

function worstStatus(statuses) {
  const ranked = statuses.filter(Boolean).sort((left, right) => statusRank(right) - statusRank(left));
  return ranked[0] ?? 'ok';
}

function readActiveExperience(stateDirPath, stateRootPath) {
  const scoped = path.join(stateDirPath, 'experience-state.json');
  const legacy = path.join(stateRootPath, 'experience-state.json');
  for (const file of [scoped, legacy]) {
    const read = readJSONIfExists(file);
    if (read.status === 'ok') {
      return {
        id: read.value?.active_experience || null,
        source_path: file,
        source_status: 'ok',
      };
    }
    if (read.status === 'corrupt') {
      return {
        id: null,
        source_path: file,
        source_status: 'corrupt',
        error: read.error,
      };
    }
  }
  return {
    id: null,
    source_path: scoped,
    source_status: 'missing',
  };
}

function readRuntimeConfig(configFile) {
  const read = readJSONIfExists(configFile);
  return {
    status: read.status,
    path: configFile,
    value: read.value && typeof read.value === 'object' && !Array.isArray(read.value)
      ? read.value
      : {},
    error: read.error,
  };
}

function buildContentRootStatus({
  roots,
  config,
  contentStatus,
  repoRoot,
}) {
  const configuredRoots = config.content?.roots && typeof config.content.roots === 'object'
    ? config.content.roots
    : {};
  const liveRoots = contentStatus.ok && contentStatus.value?.roots && typeof contentStatus.value.roots === 'object'
    ? contentStatus.value.roots
    : {};
  const commandStatus = contentStatus.ok ? 'ok' : contentStatus.status;

  const items = roots.map((root) => {
    const configuredPath = configuredRoots[root.key] ?? null;
    const livePath = liveRoots[root.key] ?? null;
    const declaredExists = pathExists(root.path);
    const configuredStatus = !configuredPath
      ? 'missing'
      : (normalizePathForCompare(repoRoot, configuredPath) === normalizePathForCompare(repoRoot, root.path) ? 'current' : 'stale');
    const liveStatus = !contentStatus.ok
      ? 'unknown'
      : (!livePath
        ? 'missing'
        : (normalizePathForCompare(repoRoot, livePath) === normalizePathForCompare(repoRoot, root.path) ? 'current' : 'stale'));
    const declaredPathStatus = declaredExists ? 'exists' : 'missing';
    return {
      id: root.id,
      key: root.key,
      branch_scoped: root.branch_scoped,
      declared_path: root.path,
      declared_path_status: declaredPathStatus,
      configured_path: configuredPath,
      configured_status: configuredStatus,
      live_path: livePath,
      live_status: liveStatus,
      status: worstStatus([declaredPathStatus === 'exists' ? 'current' : 'missing', configuredStatus, liveStatus]),
    };
  });

  return {
    status: worstStatus(items.map((item) => item.status).concat(commandStatus === 'ok' ? [] : ['unknown'])),
    command_status: commandStatus,
    command_error: contentStatus.ok ? undefined : contentStatus.error,
    roots: items,
  };
}

function decodeProjectionStatus(rawURL, expectedProjection) {
  const projection = mountedSurfaceMenuProjectionFromURL(rawURL);
  if (projection === null) return { status: 'missing', projection: null };
  if (projection === false) return { status: 'corrupt', projection: null };
  const expectedMenuIDs = (expectedProjection?.menu || []).map((item) => item.id).sort();
  const actualMenuIDs = (projection?.menu || []).map((item) => item.id).sort();
  const sameIDs = JSON.stringify(expectedMenuIDs) === JSON.stringify(actualMenuIDs);
  const current = projection?.schema_version === expectedProjection?.schema_version
    && projection?.experience_id === expectedProjection?.experience_id
    && projection?.surface_id === expectedProjection?.surface_id
    && sameIDs;
  return {
    status: current ? 'current' : 'stale',
    projection: {
      schema_version: projection?.schema_version ?? null,
      experience_id: projection?.experience_id ?? null,
      surface_id: projection?.surface_id ?? null,
      menu_ids: actualMenuIDs,
    },
  };
}

function buildStatusItemStatus({
  manifest,
  rootsByID,
  config,
  showList,
  mode,
  repoRoot,
}) {
  const surface = manifest.status_item?.toggle_surface ?? null;
  const configured = config.status_item && typeof config.status_item === 'object'
    ? config.status_item
    : {};
  if (!surface) {
    return {
      status: 'not_applicable',
      configured,
      expected: null,
      target: { status: 'not_applicable' },
      mounted_surface: { status: 'not_applicable' },
      menu_projection: { status: 'not_applicable' },
    };
  }

  const expectedURL = projectedToggleURL(manifest, surface, rootsByID, { mode, repoRoot });
  const configuredURL = configured.toggle_url || null;
  const configuredID = configured.toggle_id || null;
  const enabled = configured.enabled !== false && configured.enabled !== 'false';
  let targetStatus = 'current';
  const drift = [];
  if (!enabled) {
    targetStatus = 'disabled';
    drift.push('status_item.disabled');
  } else if (configuredID !== surface.id) {
    targetStatus = 'wrong_surface';
    drift.push('status_item.toggle_id');
  } else if (!configuredURL) {
    targetStatus = 'missing';
    drift.push('status_item.toggle_url');
  } else if (!equivalentContentURLs(configuredURL, expectedURL)) {
    targetStatus = 'drift';
    drift.push('status_item.toggle_url');
  }

  const canvases = showList.ok && Array.isArray(showList.value?.canvases) ? showList.value.canvases : [];
  const canvas = canvases.find((item) => item?.id === surface.id) ?? null;
  const mountedURL = typeof canvas?.url === 'string' ? canvas.url : null;
  const mountedStatus = !showList.ok
    ? 'unknown'
    : (!canvas
      ? 'missing'
      : (equivalentContentURLs(mountedURL, expectedURL) ? 'current' : 'stale'));
  const expectedMenu = mountedSurfaceMenuItemsForSurface(manifest.menu, surface.id);
  const expectedProjection = expectedMenu.length
    ? mountedSurfaceMenuProjectionFromURL(expectedURL)
    : null;
  const targetProjection = expectedMenu.length
    ? decodeProjectionStatus(configuredURL, expectedProjection)
    : { status: 'not_applicable', projection: null };
  const mountedProjection = expectedMenu.length && mountedURL
    ? decodeProjectionStatus(mountedURL, expectedProjection)
    : (expectedMenu.length ? { status: 'missing', projection: null } : { status: 'not_applicable', projection: null });
  const menuProjectionStatus = expectedMenu.length
    ? worstStatus([targetProjection.status, mountedStatus === 'missing' ? 'missing' : mountedProjection.status])
    : 'not_applicable';

  return {
    status: worstStatus([targetStatus, mountedStatus, menuProjectionStatus]),
    configured: {
      enabled,
      toggle_id: configuredID,
      toggle_url: configuredURL,
      toggle_track: configured.toggle_track ?? null,
      icon: configured.icon ?? null,
    },
    expected: {
      label: manifest.status_item?.label ?? null,
      toggle_id: surface.id,
      toggle_url: expectedURL,
      toggle_track: surface.track ?? null,
    },
    target: {
      status: targetStatus,
      current_url: configuredURL,
      expected_url: expectedURL,
      drift,
    },
    mounted_surface: {
      status: mountedStatus,
      id: surface.id,
      url: mountedURL,
      lifecycle_state: canvas?.lifecycleState ?? null,
      suspended: canvas?.suspended ?? null,
      show_list_status: showList.ok ? 'ok' : showList.status,
      show_list_error: showList.ok ? undefined : showList.error,
    },
    menu_projection: {
      status: menuProjectionStatus,
      expected_menu_count: expectedMenu.length,
      expected_menu_ids: expectedMenu.map((item) => item.id),
      status_item_target: targetProjection,
      mounted_surface: mountedProjection,
    },
  };
}

function processGone(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return null;
  try {
    process.kill(pid, 0);
    return false;
  } catch (error) {
    return error?.code === 'ESRCH' ? true : null;
  }
}

function lockStatus(root) {
  const lockDir = path.join(root, '.mutation.lock');
  const stat = lstatStatus(lockDir);
  if (!stat.exists) return { status: 'absent', path: lockDir };
  let owner = null;
  try {
    owner = JSON.parse(fs.readFileSync(path.join(lockDir, 'owner.json'), 'utf8'));
  } catch {
    owner = null;
  }
  const pid = Number(owner?.pid);
  const gone = processGone(pid);
  const ageMs = Math.max(0, Date.now() - (stat.mtime_ms ?? Date.now()));
  const stale = gone === true || (!Number.isInteger(pid) && ageMs >= LOCK_STALE_MS);
  return {
    status: stale ? 'stale' : 'active',
    path: lockDir,
    owner_pid: Number.isInteger(pid) ? pid : null,
    age_ms: Math.round(ageMs),
  };
}

function buildPendingAnnotationStatus({
  env,
  manifest,
}) {
  const supported = (manifest.menu || []).some((item) => item?.kind === 'operator_annotation' || item?.create_pending_annotation === true);
  const root = pendingRoot(env);
  const records = recordsDir(env);
  const index = indexPath(env);
  const rootStat = lstatStatus(root);
  const recordsStat = lstatStatus(records);
  const lock = lockStatus(root);
  const base = {
    supported,
    root,
    records_dir: records,
    index_path: index,
    lock,
  };

  if (!supported) {
    return { status: 'not_applicable', ...base };
  }
  if (!rootStat.exists) {
    return {
      status: 'not_initialized',
      ...base,
      root_status: 'missing',
      record_count: 0,
    };
  }
  if (rootStat.is_symlink || !rootStat.is_directory) {
    return {
      status: 'corrupt',
      ...base,
      root_status: rootStat.is_symlink ? 'symlink' : 'not_directory',
      record_count: 0,
    };
  }
  if (recordsStat.exists && (recordsStat.is_symlink || !recordsStat.is_directory)) {
    return {
      status: 'corrupt',
      ...base,
      root_status: 'exists',
      records_status: recordsStat.is_symlink ? 'symlink' : 'not_directory',
      record_count: 0,
    };
  }

  let recordCount = 0;
  if (recordsStat.exists) {
    try {
      recordCount = fs.readdirSync(records).filter((name) => name.endsWith('.json') && !name.includes('.tmp-')).length;
    } catch {
      return {
        status: 'corrupt',
        ...base,
        root_status: 'exists',
        records_status: 'unreadable',
        record_count: 0,
      };
    }
  }
  const indexRead = readJSONIfExists(index);
  const indexStatus = indexRead.status === 'missing'
    ? 'missing'
    : (indexRead.status === 'ok' ? 'present' : 'corrupt');
  return {
    status: lock.status === 'stale' ? 'stale' : (recordsStat.exists ? 'initialized' : 'not_initialized'),
    ...base,
    root_status: 'exists',
    records_status: recordsStat.exists ? 'exists' : 'missing',
    index_status: indexStatus,
    record_count: recordCount,
  };
}

function buildServiceStatus(serviceStatus) {
  if (!serviceStatus.ok) {
    return {
      status: 'unknown',
      command_status: serviceStatus.status,
      error: serviceStatus.error,
      running: null,
    };
  }
  const value = serviceStatus.value;
  return {
    status: value.running && value.target_matches_expected !== false ? 'ready' : 'degraded',
    mode: value.mode ?? null,
    loaded: Boolean(value.loaded),
    running: Boolean(value.running),
    pid: value.pid ?? null,
    label: value.label ?? value.launchd_label ?? null,
    target_matches_expected: value.target_matches_expected ?? null,
    state_dir: value.state_dir ?? null,
    notes: value.notes ?? [],
  };
}

function buildPermissionStatus(permissionStatus) {
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
  return {
    status: value.ready_for_testing && (value.missing_permissions || []).length === 0 ? 'ready' : 'degraded',
    ready_for_testing: Boolean(value.ready_for_testing),
    ready_source: value.ready_source ?? null,
    permissions: value.permissions ?? {},
    daemon_view: value.daemon_view ?? {},
    missing_permissions: value.missing_permissions ?? [],
    notes: value.notes ?? [],
  };
}

function buildRuntimeSummary({
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
  for (const permission of permissions.missing_permissions || []) {
    blockers.push({
      id: `permission:${permission}`,
      kind: 'permission',
      message: `${permission} permission is missing or unknown.`,
    });
  }
  if (permissions.status !== 'ready') {
    blockers.push({
      id: 'permissions_not_ready',
      kind: 'permission',
      status: permissions.status,
      message: 'Permission preflight is not ready for testing.',
    });
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

function capability(status, blockers = []) {
  return {
    status,
    blockers,
  };
}

function buildCapabilities({
  runtime,
  statusItem,
  pendingAnnotations,
}) {
  const serviceReady = runtime.service.status === 'ready';
  const permissions = runtime.permissions.permissions || {};
  const targetReady = statusItem.target.status === 'current';
  const mountedReady = ['current', 'not_applicable'].includes(statusItem.mounted_surface.status);
  return {
    perception: capability(
      serviceReady && permissions.screen_recording ? 'ready' : 'blocked',
      [
        ...(!serviceReady ? ['service_not_ready'] : []),
        ...(!permissions.screen_recording ? ['screen_recording_missing'] : []),
      ],
    ),
    annotation: capability(
      !pendingAnnotations.supported
        ? 'unsupported'
        : (serviceReady && targetReady && mountedReady && pendingAnnotations.status !== 'corrupt' ? 'ready' : 'degraded'),
      [
        ...(!serviceReady ? ['service_not_ready'] : []),
        ...(!targetReady ? ['status_item_target_not_current'] : []),
        ...(!mountedReady ? ['mounted_surface_not_current'] : []),
        ...(pendingAnnotations.status === 'corrupt' ? ['pending_annotation_state_corrupt'] : []),
      ],
    ),
    saved_ref_action: capability(
      serviceReady && permissions.accessibility && permissions.listen_access && permissions.post_access ? 'ready' : 'blocked',
      [
        ...(!serviceReady ? ['service_not_ready'] : []),
        ...(!permissions.accessibility ? ['accessibility_missing'] : []),
        ...(!permissions.listen_access ? ['listen_access_missing'] : []),
        ...(!permissions.post_access ? ['post_access_missing'] : []),
      ],
    ),
    evidence_handoff: capability(
      pendingAnnotations.status === 'corrupt' ? 'blocked' : 'ready',
      pendingAnnotations.status === 'corrupt' ? ['pending_annotation_state_corrupt'] : [],
    ),
  };
}

function diagnosticsFor({
  active,
  requestedId,
  config,
  contentRoots,
  statusItem,
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
    });
  }
  if (config.status === 'corrupt') {
    add('runtime-config-corrupt', 'error', 'Runtime config is corrupt.', { path: config.path });
  }
  for (const root of contentRoots.roots) {
    if (root.status !== 'current') {
      add(`content-root:${root.key}`, root.status === 'missing' ? 'warning' : 'warning', `Content root ${root.key} is ${root.status}.`, {
        status: root.status,
        declared_path: root.declared_path,
        configured_path: root.configured_path,
        live_path: root.live_path,
      });
    }
  }
  if (statusItem.target.status !== 'current' && statusItem.target.status !== 'not_applicable') {
    add('status-item-target-drift', 'warning', 'Status item target does not match the requested experience.', {
      status: statusItem.target.status,
      current_url: statusItem.target.current_url,
      expected_url: statusItem.target.expected_url,
    });
  }
  if (!['current', 'not_applicable'].includes(statusItem.mounted_surface.status)) {
    add('mounted-surface-drift', 'warning', 'Mounted status surface is missing, stale, or unknown.', {
      status: statusItem.mounted_surface.status,
      surface_id: statusItem.mounted_surface.id,
      url: statusItem.mounted_surface.url,
    });
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

function attachRecommendations({
  diagnostics,
  recommendations,
  prefix,
  requestedId,
  statusItem,
  contentRoots,
  pendingAnnotations,
  runtime,
}) {
  const needsActivation = diagnostics.some((item) => [
    'active-experience-mismatch',
    'status-item-target-drift',
    'mounted-surface-drift',
  ].includes(item.id) || item.id.startsWith('content-root:'));
  if (needsActivation) {
    const id = addRecommendation(recommendations, {
      id: 'activate-requested-experience',
      kind: 'command',
      reason: 'Reconcile active experience, content roots, status item target, and mounted surface.',
      argv: commandArgv(prefix, 'experience', 'activate', requestedId, '--json', '--allow-start'),
    });
    for (const item of diagnostics) {
      if ([
        'active-experience-mismatch',
        'status-item-target-drift',
        'mounted-surface-drift',
      ].includes(item.id) || item.id.startsWith('content-root:')) {
        item.recommended_next_id = id;
      }
    }
  }
  if (statusItem.mounted_surface.status === 'stale') {
    addRecommendation(recommendations, {
      id: 'remove-stale-mounted-surface',
      kind: 'command',
      reason: 'Remove the stale mounted surface before reactivation if activation cannot reconcile it.',
      argv: commandArgv(prefix, 'show', 'remove', '--id', statusItem.mounted_surface.id),
    });
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

export function buildExperienceRuntimeContext(id, {
  env = process.env,
  repoRoot = process.cwd(),
  prefix = env.AOS_INVOCATION_DISPLAY_NAME || './aos',
} = {}) {
  const runtimeEnv = experienceEnvironment({ env, repoRoot });
  const stateRootPath = workspaceStateRoot(env);
  const stateDirPath = workspaceStateDir(env);
  const manifest = discoverExperience(id, { experiencesRoot: runtimeEnv.experiencesRoot });
  const roots = resolveContentRoots(manifest, { repoRoot: runtimeEnv.repoRoot });
  const rootsByID = rootMap(roots);
  const active = readActiveExperience(stateDirPath, stateRootPath);
  const config = readRuntimeConfig(path.join(stateDirPath, 'config.json'));
  const service = buildServiceStatus(runAosJSON(runtimeEnv.aos, ['service', 'status', '--mode', runtimeEnv.mode, '--json'], {
    env,
    mode: runtimeEnv.mode,
  }));
  const permissions = buildPermissionStatus(runAosJSON(runtimeEnv.aos, ['permissions', 'check', '--json'], {
    env,
    mode: runtimeEnv.mode,
  }));
  const contentStatus = runAosJSON(runtimeEnv.aos, ['content', 'status', '--json'], {
    env,
    mode: runtimeEnv.mode,
  });
  const showList = runAosJSON(runtimeEnv.aos, ['show', 'list', '--json'], {
    env,
    mode: runtimeEnv.mode,
  });
  const contentRoots = buildContentRootStatus({
    roots,
    config: config.value,
    contentStatus,
    repoRoot: runtimeEnv.repoRoot,
  });
  const statusItem = buildStatusItemStatus({
    manifest,
    rootsByID,
    config: config.value,
    showList,
    mode: runtimeEnv.mode,
    repoRoot: runtimeEnv.repoRoot,
  });
  const pendingAnnotations = buildPendingAnnotationStatus({ env, manifest });
  const runtime = buildRuntimeSummary({
    mode: runtimeEnv.mode,
    stateRootPath,
    stateDirPath,
    service,
    permissions,
  });
  const diagnostics = diagnosticsFor({
    active,
    requestedId: id,
    config,
    contentRoots,
    statusItem,
    pendingAnnotations,
    runtime,
  });
  const capabilities = buildCapabilities({
    runtime,
    statusItem,
    pendingAnnotations,
  });
  const recommendations = [];
  attachRecommendations({
    diagnostics,
    recommendations,
    prefix,
    requestedId: id,
    statusItem,
    contentRoots,
    pendingAnnotations,
    runtime,
  });
  const status = diagnostics.some((item) => item.severity === 'error')
    ? 'blocked'
    : (diagnostics.some((item) => item.severity === 'warning') ? 'degraded' : 'ok');
  return {
    schema_version: EXPERIENCE_RUNTIME_CONTEXT_SCHEMA_VERSION,
    status,
    code: 'OK',
    command: commandIdentity(prefix, id),
    experience: {
      requested_id: id,
      id: manifest.id,
      title: manifest.title,
      version: manifest.version,
      exclusive: manifest.exclusive,
    },
    active_experience: {
      id: active.id,
      status: active.source_status === 'corrupt'
        ? 'corrupt'
        : (active.id === id ? 'current' : 'mismatch'),
      source_path: active.source_path,
    },
    runtime,
    state: {
      root: stateRootPath,
      mode_root: stateDirPath,
      experience_state_path: path.join(stateDirPath, 'experience-state.json'),
      config_path: config.path,
      config_status: config.status,
      pending_annotations_root: pendingAnnotations.root,
    },
    content_roots: contentRoots,
    status_item: statusItem,
    pending_annotations: pendingAnnotations,
    diagnostics,
    capabilities,
    recommended_next: recommendations,
  };
}
