import path from 'node:path';
import { lstat, readdir, readFile } from 'node:fs/promises';

import { installableTargets, loadSkillCatalog, selectedSkills } from './catalog.mjs';
import { resolveInstallTarget, installPathFor, manifestPathFor, targetPayload } from './install-targets.mjs';
import {
  AosSkillsError,
  CHECK_SCHEMA_VERSION,
  INSTALLED_SKILL_MANIFEST_SCHEMA_VERSION,
  fileExists,
  isObject,
  relativeInstallPathAllowed,
  sha256Buffer,
} from './shared.mjs';

export async function readInstalledManifest(target, skill) {
  const manifestPath = manifestPathFor(target, skill);
  try {
    return { manifest: JSON.parse(await readFile(manifestPath, 'utf8')), error: null };
  } catch (error) {
    if (error?.code === 'ENOENT') return { manifest: null, error: null };
    return { manifest: null, error };
  }
}

export function fileIdentityMap(files) {
  if (!Array.isArray(files)) return null;
  const map = new Map();
  for (const file of files) {
    if (
      !isObject(file)
      || !relativeInstallPathAllowed(file.path)
      || typeof file.sha256 !== 'string'
      || !Number.isInteger(file.bytes)
    ) {
      return null;
    }
    map.set(file.path, { sha256: file.sha256, bytes: file.bytes });
  }
  return map;
}

export function fileIdentityMapsEqual(left, right) {
  if (!left || !right || left.size !== right.size) return false;
  for (const [filePath, identity] of left.entries()) {
    const other = right.get(filePath);
    if (!other || other.sha256 !== identity.sha256 || other.bytes !== identity.bytes) return false;
  }
  return true;
}

export async function collectInstalledFiles(skillRoot) {
  const files = [];

  async function walk(current) {
    const entries = await readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      const absolutePath = path.join(current, entry.name);
      const info = await lstat(absolutePath);
      const packageRelative = path.relative(skillRoot, absolutePath).split(path.sep).join('/');
      if (info.isSymbolicLink()) {
        throw new AosSkillsError('Installed skill tree contains a symlink', 'INSTALLED_SKILL_SYMLINK', {
          path: packageRelative,
        });
      }
      if (entry.isDirectory()) {
        await walk(absolutePath);
        continue;
      }
      if (!entry.isFile()) continue;
      if (!relativeInstallPathAllowed(packageRelative)) {
        throw new AosSkillsError('Installed skill file path is unsafe', 'INSTALLED_SKILL_UNSAFE', {
          path: packageRelative,
        });
      }
      const bytes = await readFile(absolutePath);
      files.push({
        path: packageRelative,
        bytes: bytes.length,
        sha256: sha256Buffer(bytes),
      });
    }
  }

  await walk(skillRoot);
  files.sort((a, b) => a.path.localeCompare(b.path));
  return files;
}

export function installedFileDrift({ installedFiles, packageInfo }) {
  const sourceFiles = fileIdentityMap(packageInfo.files);
  const installedMap = fileIdentityMap(installedFiles);
  const expectedPaths = new Set([...sourceFiles.keys(), '.aos-skill-manifest.json']);

  for (const file of installedFiles) {
    if (!expectedPaths.has(file.path)) {
      return {
        state: 'unmanaged',
        reason: `installed path contains unmanaged file ${file.path}`,
      };
    }
  }

  for (const [filePath, identity] of sourceFiles.entries()) {
    const installed = installedMap.get(filePath);
    if (!installed) {
      return {
        state: 'stale',
        reason: `installed package file ${filePath} is missing`,
      };
    }
    if (installed.sha256 !== identity.sha256 || installed.bytes !== identity.bytes) {
      return {
        state: 'stale',
        reason: `installed package file ${filePath} differs from source`,
      };
    }
  }

  return null;
}

function manifestlessAosPackageState({ installedFiles, packageInfo }) {
  if (!installedFiles.length) return null;
  const sourceFiles = fileIdentityMap(packageInfo.files);
  for (const file of installedFiles) {
    const source = sourceFiles.get(file.path);
    if (!source || source.sha256 !== file.sha256 || source.bytes !== file.bytes) {
      return null;
    }
  }
  return {
    state: 'stale',
    reason: 'installed path contains only AOS package files but is missing the AOS manifest',
  };
}

export function countStates(items) {
  const summary = {
    ok: 0,
    missing: 0,
    stale: 0,
    unmanaged: 0,
    unsupported_target: 0,
    blocked: 0,
  };
  for (const item of items) {
    if (Object.hasOwn(summary, item.state)) summary[item.state] += 1;
  }
  return summary;
}

export async function checkOneSkill({ target, skill, packageInfo }) {
  const installPath = installPathFor(target, skill);
  const manifestPath = manifestPathFor(target, skill);
  const base = {
    name: skill.name,
    status: skill.status,
    installable: skill.installable === true,
    target_support: installableTargets(skill),
    install_path: installPath,
    manifest_path: manifestPath,
    source_digest: packageInfo.digest,
    installed_digest: null,
  };

  if (!skill.installable || !(skill.target_support ?? []).includes(target.name)) {
    return {
      ...base,
      state: 'unsupported_target',
      reason: skill.installable
        ? `target ${target.name} is not supported for this skill`
        : `skill status is ${skill.status}`,
    };
  }
  if (!target.exists) {
    return {
      ...base,
      state: 'missing',
      reason: 'target skill root does not exist',
    };
  }
  if (!(await fileExists(installPath))) {
    return {
      ...base,
      state: 'missing',
      reason: 'skill is not installed',
    };
  }
  const info = await lstat(installPath);
  if (info.isSymbolicLink()) {
    return {
      ...base,
      state: 'blocked',
      reason: 'installed skill path is a symlink',
    };
  }
  if (!info.isDirectory()) {
    return {
      ...base,
      state: 'blocked',
      reason: 'installed skill path is not a directory',
    };
  }

  const manifestResult = await readInstalledManifest(target, skill);
  if (manifestResult.error) {
    return {
      ...base,
      state: 'blocked',
      reason: `installed manifest is unreadable: ${manifestResult.error.message}`,
    };
  }
  const manifest = manifestResult.manifest;
  if (!manifest) {
    let installedFiles;
    try {
      installedFiles = await collectInstalledFiles(installPath);
    } catch (error) {
      if (error instanceof AosSkillsError) {
        return {
          ...base,
          state: 'blocked',
          reason: error.message,
        };
      }
      throw error;
    }
    const partial = manifestlessAosPackageState({ installedFiles, packageInfo });
    if (partial) {
      return {
        ...base,
        ...partial,
      };
    }
    return {
      ...base,
      state: 'unmanaged',
      reason: 'installed path exists without an AOS manifest',
    };
  }
  if (
    manifest.schema_version !== INSTALLED_SKILL_MANIFEST_SCHEMA_VERSION
    || manifest.managed_by !== 'aos'
    || manifest.name !== skill.name
  ) {
    return {
      ...base,
      state: 'unmanaged',
      installed_digest: manifest.source_digest ?? null,
      reason: 'installed manifest is not an AOS-managed copy for this skill',
    };
  }
  const sourceFileMap = fileIdentityMap(packageInfo.files);
  const manifestFileMap = fileIdentityMap(manifest.files);
  if (!manifestFileMap || !fileIdentityMapsEqual(manifestFileMap, sourceFileMap)) {
    return {
      ...base,
      state: 'stale',
      installed_digest: manifest.source_digest ?? null,
      reason: 'installed manifest file list differs from the source package',
    };
  }
  if (manifest.source_digest !== packageInfo.digest) {
    return {
      ...base,
      state: 'stale',
      installed_digest: manifest.source_digest ?? null,
      reason: 'installed digest differs from the source package',
    };
  }
  let installedFiles;
  try {
    installedFiles = await collectInstalledFiles(installPath);
  } catch (error) {
    if (error instanceof AosSkillsError) {
      return {
        ...base,
        state: 'blocked',
        installed_digest: manifest.source_digest ?? null,
        reason: error.message,
      };
    }
    throw error;
  }
  const drift = installedFileDrift({ installedFiles, packageInfo });
  if (drift) {
    return {
      ...base,
      state: drift.state,
      installed_digest: manifest.source_digest ?? null,
      reason: drift.reason,
    };
  }
  return {
    ...base,
    state: 'ok',
    installed_digest: manifest.source_digest,
    reason: 'installed digest matches the source package',
  };
}

export async function checkSkills(options = {}) {
  const catalog = await loadSkillCatalog(options);
  const target = await resolveInstallTarget(catalog.registry, options);
  const checks = [];
  for (const skill of selectedSkills(catalog.registry, options.skills ?? [])) {
    checks.push(await checkOneSkill({
      target,
      skill,
      packageInfo: catalog.packages.get(skill.name),
    }));
  }
  checks.sort((a, b) => a.name.localeCompare(b.name));
  return {
    schema_version: CHECK_SCHEMA_VERSION,
    status: 'success',
    target: targetPayload(target),
    summary: countStates(checks),
    skills: checks,
  };
}
