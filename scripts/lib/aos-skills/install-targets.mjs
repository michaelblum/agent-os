import path from 'node:path';
import os from 'node:os';
import { lstat, mkdir, realpath } from 'node:fs/promises';

import {
  AosSkillsError,
  expandHome,
  fileExists,
  rejectTraversal,
} from './shared.mjs';

function targetDescriptor(registry, target, explicitPath) {
  const supported = registry.supported_targets ?? {};
  if (!target) throw new AosSkillsError('aos skills requires --target <target>', 'MISSING_ARG');
  if (!Object.hasOwn(supported, target)) {
    throw new AosSkillsError(`Unsupported AOS skills target: ${target}`, 'UNSUPPORTED_TARGET', {
      target,
      supported_targets: Object.keys(supported).sort(),
    });
  }
  if (explicitPath && target !== 'path') {
    throw new AosSkillsError('--path is only valid with --target path', 'AMBIGUOUS_INSTALL_ROOT', {
      target,
    });
  }
  if (target === 'path' && !explicitPath) {
    throw new AosSkillsError('--target path requires --path <absolute-dir>', 'MISSING_ARG', {
      target,
    });
  }

  if (target === 'path') {
    rejectTraversal(explicitPath, '--path');
    const expanded = expandHome(explicitPath);
    if (!path.isAbsolute(expanded)) {
      throw new AosSkillsError('--path must be absolute for the explicit path target', 'INSTALL_ROOT_NOT_ABSOLUTE', {
        path: explicitPath,
      });
    }
    return {
      name: target,
      root: path.resolve(expanded),
      explicit_path: true,
      configured: supported[target],
    };
  }

  const homeByTarget = {
    codex: process.env.CODEX_HOME || path.join(os.homedir(), '.codex'),
    claude: process.env.CLAUDE_HOME || path.join(os.homedir(), '.claude'),
    agents: process.env.AOS_AGENTS_SKILLS_DIR
      ? path.dirname(process.env.AOS_AGENTS_SKILLS_DIR)
      : path.join(os.homedir(), '.agents'),
  };
  const rootByTarget = {
    codex: path.join(homeByTarget.codex, 'skills'),
    claude: path.join(homeByTarget.claude, 'skills'),
    agents: process.env.AOS_AGENTS_SKILLS_DIR || path.join(homeByTarget.agents, 'skills'),
  };
  rejectTraversal(rootByTarget[target], `${target} skill root`);
  const expanded = expandHome(rootByTarget[target]);
  if (!path.isAbsolute(expanded)) {
    throw new AosSkillsError(`${target} skill root must be absolute`, 'INSTALL_ROOT_NOT_ABSOLUTE', {
      target,
      path: rootByTarget[target],
    });
  }
  return {
    name: target,
    root: path.resolve(expanded),
    explicit_path: false,
    configured: supported[target],
  };
}

export async function inspectInstallRoot(target) {
  if (!(await fileExists(target.root))) {
    if (target.explicit_path) {
      throw new AosSkillsError('--target path root must already exist and be a directory', 'INSTALL_ROOT_MISSING', {
        target: target.name,
        root: target.root,
      });
    }
    return { ...target, exists: false, realpath: null };
  }
  const info = await lstat(target.root);
  if (info.isSymbolicLink()) {
    throw new AosSkillsError('AOS skills install root must not be a symlink', 'INSTALL_ROOT_SYMLINK', {
      target: target.name,
      root: target.root,
    });
  }
  if (!info.isDirectory()) {
    throw new AosSkillsError('AOS skills install root must be a directory', 'INSTALL_ROOT_NOT_DIRECTORY', {
      target: target.name,
      root: target.root,
    });
  }
  return { ...target, exists: true, realpath: await realpath(target.root) };
}

export async function resolveInstallTarget(registry, options = {}) {
  return inspectInstallRoot(targetDescriptor(registry, options.target, options.path));
}

export function installPathFor(target, skill) {
  return path.join(target.root, skill.name);
}

export function manifestPathFor(target, skill) {
  return path.join(installPathFor(target, skill), '.aos-skill-manifest.json');
}

export function targetPayload(target) {
  return {
    name: target.name,
    root: target.root,
    exists: target.exists,
    explicit_path: target.explicit_path,
  };
}

export async function ensureWritableTargetRoot(target) {
  if (!target.exists) {
    await mkdir(target.root, { recursive: true });
  }
  return inspectInstallRoot(target);
}

export function assertDestinationInsideTarget(write, target) {
  const root = path.resolve(target.root);
  const destination = path.resolve(write.destination);
  if (destination === root || !destination.startsWith(`${root}${path.sep}`)) {
    throw new AosSkillsError('AOS skills install write escapes the target root', 'PATH_TRAVERSAL', {
      skill: write.skill,
      destination,
      root,
    });
  }
}

export function assertPathInsideTarget({ absolutePath, target, skill = null }) {
  const root = path.resolve(target.root);
  const resolved = path.resolve(absolutePath);
  if (resolved === root || !resolved.startsWith(`${root}${path.sep}`)) {
    throw new AosSkillsError('AOS skills install path escapes the target root', 'PATH_TRAVERSAL', {
      skill,
      path: resolved,
      root,
    });
  }
}
