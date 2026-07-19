import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { explicitStateRootOverride } from './aos-cli.mjs';
import { experienceRuntimeEnv } from './experience-runtime-env.mjs';

export class ExperienceManifestError extends Error {
  constructor(message, code) {
    super(message);
    this.name = 'ExperienceManifestError';
    this.code = code;
  }
}

export const experienceEnvironment = experienceRuntimeEnv;

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
  for (const item of manifest.menu || []) {
    if (!item?.surface) continue;
    if (!surfaceIDs.has(item.surface)) {
      throw new ExperienceManifestError(`Experience manifest menu item ${item.id} targets undeclared surface: ${item.surface}`, 'INVALID_EXPERIENCE_MANIFEST');
    }
  }
  return file;
}

export function normalizeExperienceManifest(manifest) {
  if (manifest.schema_version === 1) {
    const hasRetiredFields = Object.hasOwn(manifest, 'default_activation')
      || Object.hasOwn(manifest, 'status_item')
      || Object.hasOwn(manifest.vanilla_fallback || {}, 'status_item');
    if (hasRetiredFields) {
      throw new ExperienceManifestError(
        'Experience manifest v1 contains retired status-item activation fields',
        'INVALID_EXPERIENCE_MANIFEST',
      );
    }
    return manifest;
  }
  if (manifest.schema_version !== 0) {
    throw new ExperienceManifestError('Unsupported experience manifest schema version', 'INVALID_EXPERIENCE_MANIFEST');
  }

  const {
    $schema: _legacySchema,
    default_activation: _legacyActivation,
    status_item: _legacyStatusItem,
    vanilla_fallback: legacyFallback,
    ...normalized
  } = manifest;
  return {
    ...normalized,
    schema_version: 1,
    vanilla_fallback: {
      tools: Array.isArray(legacyFallback?.tools) ? [...legacyFallback.tools] : [],
    },
  };
}

export function discoverExperience(id, {
  experiencesRoot = experienceEnvironment().experiencesRoot,
} = {}) {
  const file = path.join(experiencesRoot, id, 'aos-experience.json');
  if (!fs.existsSync(file)) {
    throw new ExperienceManifestError(`Experience manifest not found: experiences/${id}/aos-experience.json`, 'EXPERIENCE_NOT_FOUND');
  }
  const sourceManifest = readJSON(file);
  if (sourceManifest.id !== id) {
    throw new ExperienceManifestError(`Manifest id ${sourceManifest.id} does not match experience ${id}`, 'INVALID_EXPERIENCE_MANIFEST');
  }
  if (![0, 1].includes(sourceManifest.schema_version) || sourceManifest.exclusive !== true) {
    throw new ExperienceManifestError(`Invalid experience manifest: ${file}`, 'INVALID_EXPERIENCE_MANIFEST');
  }
  const manifest = normalizeExperienceManifest(sourceManifest);
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

export function contentRootScope(env = process.env) {
  const raw = (env.AOS_EXPERIENCE_CONTENT_ROOT_SCOPE || env.AOS_CONTENT_ROOT_SCOPE || '').toLowerCase();
  if (!raw || raw === 'canonical' || raw === 'single') return 'canonical';
  if (['branch', 'scoped', 'parallel', 'worktree'].includes(raw)) return 'branch';
  throw new ExperienceManifestError(`Unknown content root scope: ${raw}`, 'INVALID_CONTENT_ROOT_SCOPE');
}

export function branchScopedContentRootsEnabled(env = process.env) {
  if (contentRootScope(env) !== 'branch') return false;
  if (explicitStateRootOverride(env)) return true;
  throw new ExperienceManifestError(
    'Branch-scoped content roots require an explicit non-default AOS_STATE_ROOT; default agent-os runtime uses canonical root names.',
    'BRANCH_SCOPED_CONTENT_ROOTS_REQUIRE_STATE_ROOT',
  );
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
  env = process.env,
} = {}) {
  const useBranchScopedRoots = branchScopedContentRootsEnabled(env);
  return (manifest.content_roots || []).map((root) => {
    if (!root.id || !root.path) {
      throw new ExperienceManifestError('content_roots entries require id and path', 'INVALID_EXPERIENCE_MANIFEST');
    }
    const declaredBranchScoped = root.branch_scoped !== false;
    const activeBranchScoped = useBranchScopedRoots && declaredBranchScoped;
    return {
      id: root.id,
      key: activeBranchScoped ? scopedRootName(root.id, repoRoot) : root.id,
      path: resolveRepoPath(root.path, `content_roots.${root.id}.path`, { repoRoot }),
      branch_scoped: activeBranchScoped,
      declared_branch_scoped: declaredBranchScoped,
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
