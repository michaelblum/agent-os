import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  MOUNTED_SURFACE_MENU_QUERY_PARAM,
  mountedSurfaceMenuItemsForSurface,
  mountedSurfaceMenuProjectionEnvelope,
} from '../../packages/toolkit/contracts/mounted-surface-menu-projection.js';

export class ExperienceManifestError extends Error {
  constructor(message, code) {
    super(message);
    this.name = 'ExperienceManifestError';
    this.code = code;
  }
}

function envValue(env, key) {
  const value = env[key];
  return typeof value === 'string' && value && !value.startsWith('$') ? value : null;
}

export function experienceEnvironment({
  env = process.env,
  repoRoot = process.cwd(),
} = {}) {
  const resolvedRepoRoot = path.resolve(repoRoot);
  const stateRoot = envValue(env, 'AOS_STATE_ROOT')
    ? path.resolve(envValue(env, 'AOS_STATE_ROOT'))
    : path.join(os.homedir(), '.config', 'aos');
  const mode = envValue(env, 'AOS_RUNTIME_MODE') || 'repo';
  const experiencesRoot = envValue(env, 'AOS_EXPERIENCES_DIR')
    ? path.resolve(envValue(env, 'AOS_EXPERIENCES_DIR'))
    : path.join(resolvedRepoRoot, 'experiences');
  const aos = envValue(env, 'AOS_PATH')
    ? envValue(env, 'AOS_PATH')
    : path.join(resolvedRepoRoot, 'aos');
  const stateDir = path.join(stateRoot, mode);
  const normalizedEnv = {
    ...env,
    AOS_EXPERIENCES_DIR: experiencesRoot,
    AOS_PATH: aos,
    AOS_RUNTIME_MODE: mode,
    AOS_STATE_ROOT: stateRoot,
  };
  return {
    aos,
    env: normalizedEnv,
    experiencesRoot,
    mode,
    repoRoot: resolvedRepoRoot,
    stateDir,
    stateRoot,
  };
}

function readJSON(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (err) {
    throw new ExperienceManifestError(`Could not read ${file}: ${err.message}`, 'EXPERIENCE_MANIFEST_READ_FAILED');
  }
}

export function validateManifestTargets(manifest, file) {
  const surfaces = manifest.surfaces && typeof manifest.surfaces === 'object' && !Array.isArray(manifest.surfaces)
    ? manifest.surfaces
    : {};
  const surfaceIDs = new Set(Object.keys(surfaces));
  const primaryEntry = manifest.default_activation?.primary_entry;
  if (primaryEntry && !surfaceIDs.has(primaryEntry)) {
    throw new ExperienceManifestError(`Experience manifest primary_entry has no declared surface: ${primaryEntry}`, 'INVALID_EXPERIENCE_MANIFEST');
  }
  for (const item of manifest.menu || []) {
    if (!item?.surface) continue;
    if (!surfaceIDs.has(item.surface)) {
      throw new ExperienceManifestError(`Experience manifest menu item ${item.id} targets undeclared surface: ${item.surface}`, 'INVALID_EXPERIENCE_MANIFEST');
    }
  }
  return file;
}

export function discoverExperience(id, {
  experiencesRoot = experienceEnvironment().experiencesRoot,
} = {}) {
  const file = path.join(experiencesRoot, id, 'aos-experience.json');
  if (!fs.existsSync(file)) {
    throw new ExperienceManifestError(`Experience manifest not found: experiences/${id}/aos-experience.json`, 'EXPERIENCE_NOT_FOUND');
  }
  const manifest = readJSON(file);
  if (manifest.id !== id) {
    throw new ExperienceManifestError(`Manifest id ${manifest.id} does not match experience ${id}`, 'INVALID_EXPERIENCE_MANIFEST');
  }
  if (manifest.schema_version !== 0 || manifest.exclusive !== true) {
    throw new ExperienceManifestError(`Invalid experience manifest: ${file}`, 'INVALID_EXPERIENCE_MANIFEST');
  }
  validateManifestTargets(manifest, file);
  return manifest;
}

export function findExperience(id, {
  experiencesRoot = experienceEnvironment().experiencesRoot,
} = {}) {
  if (!id) return null;
  const file = path.join(experiencesRoot, id, 'aos-experience.json');
  return fs.existsSync(file) ? discoverExperience(id, { experiencesRoot }) : null;
}

export function branchName(repoRoot = process.cwd()) {
  const result = spawnSync('git', ['-C', repoRoot, 'branch', '--show-current'], {
    encoding: 'utf8',
  });
  return result.status === 0 ? result.stdout.trim() : '';
}

export function scopedRootName(prefix, repoRoot = process.cwd()) {
  const branch = branchName(repoRoot);
  if (!branch || branch === 'main') return prefix;
  const suffix = branch.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'worktree';
  return `${prefix}_${suffix}`;
}

export function resolveRepoPath(relPath, fieldName, {
  repoRoot = process.cwd(),
} = {}) {
  if (typeof relPath !== 'string' || !relPath || path.isAbsolute(relPath)) {
    throw new ExperienceManifestError(`${fieldName} must be a repo-relative path`, 'INVALID_EXPERIENCE_MANIFEST');
  }
  const resolved = path.resolve(repoRoot, relPath);
  if (resolved !== repoRoot && !resolved.startsWith(`${repoRoot}${path.sep}`)) {
    throw new ExperienceManifestError(`${fieldName} must stay under the repo: ${relPath}`, 'INVALID_EXPERIENCE_MANIFEST');
  }
  return resolved;
}

export function resolveContentRoots(manifest, {
  repoRoot = process.cwd(),
} = {}) {
  return (manifest.content_roots || []).map((root) => {
    if (!root.id || !root.path) {
      throw new ExperienceManifestError('content_roots entries require id and path', 'INVALID_EXPERIENCE_MANIFEST');
    }
    return {
      id: root.id,
      key: root.branch_scoped === false ? root.id : scopedRootName(root.id, repoRoot),
      path: resolveRepoPath(root.path, `content_roots.${root.id}.path`, { repoRoot }),
      branch_scoped: root.branch_scoped !== false,
    };
  });
}

export function rootMap(roots) {
  return Object.fromEntries(roots.map((root) => [root.id, root]));
}

export function template(value, rootsByID, {
  mode = 'repo',
  repoRoot = process.cwd(),
} = {}) {
  if (typeof value !== 'string') return value;
  return value
    .replace(/\$\{root:([A-Za-z0-9_-]+)\}/g, (_, id) => {
      const root = rootsByID[id];
      if (!root) {
        throw new ExperienceManifestError(`Unknown content root template: ${id}`, 'INVALID_EXPERIENCE_MANIFEST');
      }
      return root.key;
    })
    .replace(/\$\{mode\}/g, mode)
    .replace(/\$\{repo_root\}/g, repoRoot);
}

export function contentURLIdentity(rawURL) {
  if (typeof rawURL !== 'string' || rawURL.length === 0) return null;
  try {
    const parsed = new URL(rawURL);
    if (parsed.protocol === 'aos:') {
      const root = parsed.hostname;
      const pathPart = parsed.pathname || '';
      return { root, path: pathPart.startsWith('/') ? pathPart : `/${pathPart}`, query: parsed.search };
    }
    if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
      const host = parsed.hostname.toLowerCase();
      if (!['127.0.0.1', 'localhost', '::1'].includes(host)) return null;
      const parts = parsed.pathname.split('/').filter(Boolean);
      if (parts.length === 0) return null;
      return {
        root: parts[0],
        path: `/${parts.slice(1).join('/')}`,
        query: parsed.search,
      };
    }
  } catch {
    return null;
  }
  return null;
}

export function equivalentContentURLs(left, right) {
  if (left === right) return true;
  const leftIdentity = contentURLIdentity(left);
  const rightIdentity = contentURLIdentity(right);
  if (!leftIdentity || !rightIdentity) return false;
  return leftIdentity.root === rightIdentity.root
    && leftIdentity.path === rightIdentity.path
    && leftIdentity.query === rightIdentity.query;
}

export function encodeManifestMenuProjection(manifest, surfaceID) {
  const menu = mountedSurfaceMenuItemsForSurface(manifest.menu, surfaceID);
  return Buffer.from(JSON.stringify(mountedSurfaceMenuProjectionEnvelope({
    experienceId: manifest.id,
    surfaceId: surfaceID,
    menu,
  })), 'utf8').toString('base64url');
}

export function appendQueryParam(rawURL, key, value) {
  if (!rawURL || !value) return rawURL;
  const separator = rawURL.includes('?') ? '&' : '?';
  return `${rawURL}${separator}${encodeURIComponent(key)}=${encodeURIComponent(value)}`;
}

export function projectedToggleURL(manifest, surface, rootsByID, {
  mode = 'repo',
  repoRoot = process.cwd(),
} = {}) {
  const nextURL = template(surface.url, rootsByID, { mode, repoRoot });
  if (mountedSurfaceMenuItemsForSurface(manifest.menu, surface.id).length === 0) return nextURL;
  return appendQueryParam(nextURL, MOUNTED_SURFACE_MENU_QUERY_PARAM, encodeManifestMenuProjection(manifest, surface.id));
}

export function mountedSurfaceMenuProjectionFromURL(rawURL) {
  if (typeof rawURL !== 'string' || rawURL.length === 0) return null;
  try {
    const parsed = new URL(rawURL);
    const encoded = parsed.searchParams.get(MOUNTED_SURFACE_MENU_QUERY_PARAM);
    if (!encoded) return null;
    return JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'));
  } catch {
    return false;
  }
}

export { mountedSurfaceMenuItemsForSurface };
