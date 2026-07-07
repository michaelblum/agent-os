import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { lstat } from 'node:fs/promises';

export const REGISTRY_SCHEMA_VERSION = 'aos.root-skills.registry.v0';
export const VALIDATION_SCHEMA_VERSION = 'aos.skills.validation.v0';
export const LIST_SCHEMA_VERSION = 'aos.skills.list.v0';
export const CHECK_SCHEMA_VERSION = 'aos.skills.check.v0';
export const INSTALL_PLAN_SCHEMA_VERSION = 'aos.skills.install.plan.v0';
export const INSTALL_SCHEMA_VERSION = 'aos.skills.install.v0';
export const COMPANION_CHECK_SCHEMA_VERSION = 'aos.skills.companion.check.v0';
export const COMPANION_INSTALL_PLAN_SCHEMA_VERSION = 'aos.skills.companion.install.plan.v0';
export const INSTALLED_SKILL_MANIFEST_SCHEMA_VERSION = 'aos.installed-skill-manifest.v0';
export const DEFAULT_BODY_LINE_BUDGET = 180;

export function normalizeDescription(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

export function formatFinding(code, message, details = {}) {
  return { code, message, ...details };
}

export function isObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

export function formatJSON(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

export class AosSkillsError extends Error {
  constructor(message, code, details = {}) {
    super(message);
    this.name = 'AosSkillsError';
    this.code = code;
    this.details = details;
  }

  toJSON() {
    return { code: this.code, error: this.message, ...this.details };
  }
}

export function sha256Buffer(value) {
  return createHash('sha256').update(value).digest('hex');
}

export function sha256Text(value) {
  return sha256Buffer(Buffer.from(value, 'utf8'));
}

export function expandHome(value) {
  if (value === '~') return os.homedir();
  if (value?.startsWith('~/')) return path.join(os.homedir(), value.slice(2));
  return value;
}

export function pathSegments(value) {
  return String(value).split(/[\\/]+/).filter(Boolean);
}

export function rejectTraversal(value, label = 'path') {
  if (pathSegments(value).includes('..')) {
    throw new AosSkillsError(`${label} must not contain path traversal segments`, 'PATH_TRAVERSAL', { path: value });
  }
}

export function relativePathAllowed(relativePath) {
  if (typeof relativePath !== 'string' || !relativePath.trim()) return false;
  if (path.isAbsolute(relativePath)) return false;
  return !relativePath.split(/[\\/]+/).includes('..');
}

export function relativeInstallPathAllowed(relativePath) {
  return relativePathAllowed(relativePath) && relativePath !== '.';
}

export function resolveInsideRepo(repoRoot, relativePath) {
  const root = path.resolve(repoRoot);
  const resolved = path.resolve(root, relativePath);
  if (resolved !== root && !resolved.startsWith(`${root}${path.sep}`)) return null;
  return resolved;
}

export async function fileExists(absolutePath) {
  try {
    await lstat(absolutePath);
    return true;
  } catch {
    return false;
  }
}
