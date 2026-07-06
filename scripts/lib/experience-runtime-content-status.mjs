import fs from 'node:fs';
import path from 'node:path';
import { worstStatus } from './experience-runtime-status-rank.mjs';

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
    if (error?.code === 'ENOENT') return { exists: false, error_code: 'ENOENT' };
    return { exists: false, error_code: error?.code || 'UNKNOWN' };
  }
}

function contentRootPathStatus(file) {
  const stat = lstatStatus(file);
  if (!stat.exists) {
    const status = stat.error_code === 'ENOENT'
      ? 'missing'
      : (['EACCES', 'EPERM'].includes(stat.error_code) ? 'unreadable' : 'unknown');
    return {
      status,
      type: null,
      mtime_ms: null,
      error_code: stat.error_code,
    };
  }
  if (stat.is_symlink) {
    return {
      status: 'symlink',
      type: 'symlink',
      mtime_ms: stat.mtime_ms,
    };
  }
  if (!stat.is_directory) {
    return {
      status: 'not_directory',
      type: stat.is_file ? 'file' : 'other',
      mtime_ms: stat.mtime_ms,
    };
  }
  try {
    fs.accessSync(file, fs.constants.R_OK | fs.constants.X_OK);
  } catch (error) {
    const status = ['EACCES', 'EPERM'].includes(error?.code) ? 'unreadable' : 'unknown';
    return {
      status,
      type: 'directory',
      mtime_ms: stat.mtime_ms,
      error_code: error?.code || 'UNKNOWN',
    };
  }
  return {
    status: 'current',
    type: 'directory',
    mtime_ms: stat.mtime_ms,
  };
}

function normalizePathForCompare(repoRoot, value) {
  return path.resolve(repoRoot, value);
}

function contentRootRepairAction({
  declaredPathStatus,
  configuredStatus,
  liveStatus,
}) {
  if (declaredPathStatus !== 'current') return 'fix_declared_path';
  if (configuredStatus !== 'current') return 'activate_experience';
  if (liveStatus === 'unknown') return 'inspect_runtime';
  if (liveStatus !== 'current') return 'activate_experience';
  return 'none';
}

export function buildContentRootStatus({
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
    const declaredPath = contentRootPathStatus(root.path);
    const configuredStatus = !configuredPath
      ? 'missing'
      : (normalizePathForCompare(repoRoot, configuredPath) === normalizePathForCompare(repoRoot, root.path) ? 'current' : 'stale');
    const liveStatus = !contentStatus.ok
      ? 'unknown'
      : (!livePath
        ? 'missing'
        : (normalizePathForCompare(repoRoot, livePath) === normalizePathForCompare(repoRoot, root.path) ? 'current' : 'stale'));
    return {
      id: root.id,
      key: root.key,
      branch_scoped: root.branch_scoped,
      declared_path: root.path,
      declared_path_status: declaredPath.status,
      declared_path_type: declaredPath.type,
      declared_path_mtime_ms: declaredPath.mtime_ms,
      ...(declaredPath.error_code ? { declared_path_error_code: declaredPath.error_code } : {}),
      configured_path: configuredPath,
      configured_status: configuredStatus,
      live_path: livePath,
      live_status: liveStatus,
      repair_action: contentRootRepairAction({
        declaredPathStatus: declaredPath.status,
        configuredStatus,
        liveStatus,
      }),
      status: worstStatus([declaredPath.status, configuredStatus, liveStatus]),
    };
  });

  return {
    status: worstStatus(items.map((item) => item.status).concat(commandStatus === 'ok' ? [] : ['unknown'])),
    command_status: commandStatus,
    command_error: contentStatus.ok ? undefined : contentStatus.error,
    roots: items,
  };
}
