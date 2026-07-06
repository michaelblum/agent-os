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
