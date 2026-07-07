import path from 'node:path';
import { lstat, readdir, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

import {
  AosSkillsError,
  LIST_SCHEMA_VERSION,
  relativeInstallPathAllowed,
  resolveInsideRepo,
  sha256Buffer,
} from './shared.mjs';
import { validateSkillRegistry } from './validation.mjs';

async function readRegistry(repoRoot, registryPath = 'skills/registry.json') {
  const absolutePath = path.isAbsolute(registryPath)
    ? registryPath
    : path.join(repoRoot, registryPath);
  return {
    path: absolutePath,
    registry: JSON.parse(await readFile(absolutePath, 'utf8')),
  };
}

async function collectPackageFiles(packageRoot, repoRoot) {
  const files = [];

  async function walk(current) {
    const entries = await readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      const absolutePath = path.join(current, entry.name);
      const info = await lstat(absolutePath);
      const repoRelative = path.relative(repoRoot, absolutePath);
      if (info.isSymbolicLink()) {
        throw new AosSkillsError('Skill packages must not contain symlinks', 'SKILL_PACKAGE_UNSAFE', {
          path: repoRelative,
        });
      }
      if (entry.isDirectory()) {
        await walk(absolutePath);
        continue;
      }
      if (!entry.isFile()) continue;
      const packageRelative = path.relative(packageRoot, absolutePath);
      if (!relativeInstallPathAllowed(packageRelative)) {
        throw new AosSkillsError('Skill package file path is unsafe', 'SKILL_PACKAGE_UNSAFE', {
          path: repoRelative,
        });
      }
      const bytes = await readFile(absolutePath);
      files.push({
        path: packageRelative.split(path.sep).join('/'),
        bytes: bytes.length,
        sha256: sha256Buffer(bytes),
      });
    }
  }

  await walk(packageRoot);
  files.sort((a, b) => a.path.localeCompare(b.path));
  return files;
}

function packageDigest(files) {
  const hash = createHash('sha256');
  for (const file of files) {
    hash.update(file.path);
    hash.update('\0');
    hash.update(file.sha256);
    hash.update('\0');
    hash.update(String(file.bytes));
    hash.update('\0');
  }
  return hash.digest('hex');
}

export function installableTargets(skill) {
  return skill.installable ? [...(skill.target_support ?? [])].sort() : [];
}

function skillSummary(skill, packageInfo = null) {
  return {
    name: skill.name,
    path: skill.path,
    description: skill.description,
    status: skill.status,
    installable: skill.installable === true,
    target_support: [...(skill.target_support ?? [])].sort(),
    references: skill.references ?? [],
    ownership: skill.ownership,
    source_digest: packageInfo?.digest ?? null,
    package_files: packageInfo?.files?.length ?? null,
  };
}

export async function loadSkillCatalog(options = {}) {
  const repoRoot = path.resolve(options.repoRoot ?? process.cwd());
  const validation = await validateSkillRegistry(options);
  if (!validation.ok) {
    throw new AosSkillsError('AOS skill registry validation failed', 'SKILL_REGISTRY_INVALID', {
      validation,
    });
  }

  const { registry, path: absoluteRegistryPath } = await readRegistry(repoRoot, options.registryPath);
  const packages = new Map();
  for (const skill of registry.skills ?? []) {
    const skillRoot = resolveInsideRepo(repoRoot, skill.path);
    if (!skillRoot) {
      throw new AosSkillsError('Skill path escapes the repo', 'UNSAFE_SKILL_PATH', {
        skill: skill.name,
        path: skill.path,
      });
    }
    const files = await collectPackageFiles(skillRoot, repoRoot);
    packages.set(skill.name, {
      files,
      digest: packageDigest(files),
      root: skillRoot,
    });
  }

  return {
    repoRoot,
    registry,
    registry_path: path.relative(repoRoot, absoluteRegistryPath),
    validation,
    packages,
  };
}

export function selectedSkills(registry, names = []) {
  const skills = registry.skills ?? [];
  if (!names.length) return skills;
  const byName = new Map(skills.map((skill) => [skill.name, skill]));
  return names.map((name) => {
    const skill = byName.get(name);
    if (!skill) {
      throw new AosSkillsError(`Unknown AOS skill: ${name}`, 'UNKNOWN_SKILL', { skill: name });
    }
    return skill;
  });
}

export async function listSkills(options = {}) {
  const catalog = await loadSkillCatalog(options);
  const skills = (catalog.registry.skills ?? [])
    .map((skill) => skillSummary(skill, catalog.packages.get(skill.name)))
    .sort((a, b) => a.name.localeCompare(b.name));

  return {
    schema_version: LIST_SCHEMA_VERSION,
    status: 'success',
    registry_path: catalog.registry_path,
    registry_schema_version: catalog.registry.schema_version,
    supported_targets: Object.keys(catalog.registry.supported_targets ?? {}).sort(),
    skills,
    summary: {
      total: skills.length,
      installable: skills.filter((skill) => skill.installable).length,
      needs_split: skills.filter((skill) => skill.status === 'needs_split').length,
      retained_local: skills.filter((skill) => skill.status === 'retained_local').length,
      retired: skills.filter((skill) => skill.status === 'retired').length,
      private_ignored: skills.filter((skill) => skill.status === 'private_ignored').length,
    },
  };
}
