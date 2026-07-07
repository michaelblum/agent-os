import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { lstat, mkdir, readdir, readFile, realpath, stat, writeFile } from 'node:fs/promises';
import { resolvePlaywrightCliRuntime } from './playwright-cli-runtime.mjs';

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

const ALLOWED_STATUSES = new Set([
  'installable',
  'needs_split',
  'retained_local',
  'retired',
  'private_ignored',
]);

const ALLOWED_INVOCATION = new Set([
  'enabled',
  'disabled',
  'retired',
]);

const DURABLE_BACKING_PREFIXES = [
  'docs/api/',
  'docs/adr/',
  'shared/schemas/',
  'ARCHITECTURE.md',
  'CONTEXT.md',
  'CONTEXT-MAP.md',
];

export function normalizeDescription(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function formatFinding(code, message, details = {}) {
  return { code, message, ...details };
}

function isObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function parseScalar(rawValue) {
  const value = String(rawValue ?? '').trim();
  if (value === 'true') return true;
  if (value === 'false') return false;
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    return value.slice(1, -1);
  }
  return value;
}

export function parseYamlFrontmatter(lines) {
  const result = {};
  for (let i = 0; i < lines.length;) {
    const line = lines[i];
    if (!line.trim()) {
      i += 1;
      continue;
    }
    const match = line.match(/^([A-Za-z0-9_-]+):(.*)$/);
    if (!match) {
      throw new Error(`Unsupported frontmatter line: ${line}`);
    }

    const key = match[1];
    const rawValue = match[2].trimStart();

    if (rawValue === '>' || rawValue === '|') {
      const block = [];
      i += 1;
      while (i < lines.length && (/^\s+/.test(lines[i]) || !lines[i].trim())) {
        block.push(lines[i].replace(/^ {2}/, ''));
        i += 1;
      }
      result[key] = rawValue === '>'
        ? block.join(' ').replace(/\s+/g, ' ').trim()
        : block.join('\n').trim();
      continue;
    }

    if (rawValue === '') {
      const values = [];
      i += 1;
      while (i < lines.length) {
        const item = lines[i].match(/^\s*-\s+(.*)$/);
        if (!item) break;
        values.push(parseScalar(item[1]));
        i += 1;
      }
      result[key] = values;
      continue;
    }

    result[key] = parseScalar(rawValue);
    i += 1;
  }
  return result;
}

export function parseSkillPackage(raw, source = 'SKILL.md') {
  const lines = raw.split(/\r?\n/);
  if (lines[0] !== '---') {
    throw new Error(`${source} is missing YAML frontmatter start marker`);
  }

  const endIndex = lines.findIndex((line, index) => index > 0 && line === '---');
  if (endIndex === -1) {
    throw new Error(`${source} is missing YAML frontmatter end marker`);
  }

  const frontmatter = parseYamlFrontmatter(lines.slice(1, endIndex));
  const bodyLines = lines.slice(endIndex + 1);
  return {
    frontmatter,
    body: bodyLines.join('\n'),
    body_line_count: bodyLines.filter((line) => line.trim()).length,
  };
}

function relativePathAllowed(relativePath) {
  if (typeof relativePath !== 'string' || !relativePath.trim()) return false;
  if (path.isAbsolute(relativePath)) return false;
  return !relativePath.split(/[\\/]+/).includes('..');
}

function resolveInsideRepo(repoRoot, relativePath) {
  const root = path.resolve(repoRoot);
  const resolved = path.resolve(root, relativePath);
  if (resolved !== root && !resolved.startsWith(`${root}${path.sep}`)) return null;
  return resolved;
}

async function exists(absolutePath) {
  try {
    await stat(absolutePath);
    return true;
  } catch {
    return false;
  }
}

async function directSkillNames(repoRoot) {
  const skillsRoot = path.join(repoRoot, 'skills');
  const entries = await readdir(skillsRoot, { withFileTypes: true });
  const names = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const skillPath = path.join(skillsRoot, entry.name, 'SKILL.md');
    if (await exists(skillPath)) names.push(entry.name);
  }
  return names.sort();
}

function knownTargets(registry) {
  return new Set(Object.keys(registry.supported_targets ?? {}));
}

function isDurableBacking(relativePath) {
  return DURABLE_BACKING_PREFIXES.some((prefix) => relativePath === prefix || relativePath.startsWith(prefix));
}

async function validateReferencePath({ repoRoot, skillName, field, relativePath, errors }) {
  if (typeof relativePath !== 'string' || !relativePath.trim()) {
    errors.push(formatFinding('INVALID_REFERENCE', `${skillName} has an invalid ${field} reference`, {
      skill: skillName,
      field,
      reference: relativePath,
    }));
    return;
  }
  if (/^https?:\/\//.test(relativePath)) return;
  if (!relativePathAllowed(relativePath)) {
    errors.push(formatFinding('UNSAFE_REFERENCE', `${skillName} ${field} must be repo-relative and stay inside the repo`, {
      skill: skillName,
      field,
      reference: relativePath,
    }));
    return;
  }
  const absolutePath = resolveInsideRepo(repoRoot, relativePath);
  if (!absolutePath || !(await exists(absolutePath))) {
    errors.push(formatFinding('MISSING_REFERENCE', `${skillName} references a missing file`, {
      skill: skillName,
      field,
      reference: relativePath,
    }));
  }
}

function validateRegistryShape(registry, errors) {
  if (!isObject(registry)) {
    errors.push(formatFinding('REGISTRY_NOT_OBJECT', 'registry must be a JSON object'));
    return;
  }
  if (registry.schema_version !== REGISTRY_SCHEMA_VERSION) {
    errors.push(formatFinding('REGISTRY_SCHEMA_VERSION', `registry schema_version must be ${REGISTRY_SCHEMA_VERSION}`, {
      actual: registry.schema_version,
    }));
  }
  if (!isObject(registry.supported_targets)) {
    errors.push(formatFinding('SUPPORTED_TARGETS_REQUIRED', 'registry must define supported_targets'));
  }
  if (!Array.isArray(registry.skills)) {
    errors.push(formatFinding('SKILLS_REQUIRED', 'registry must define skills[]'));
  }
}

function validateSkillShape(skill, errors) {
  if (!isObject(skill)) {
    errors.push(formatFinding('SKILL_NOT_OBJECT', 'each registry skill must be an object'));
    return false;
  }
  for (const field of ['name', 'path', 'description', 'status', 'ownership']) {
    if (typeof skill[field] !== 'string' || !skill[field].trim()) {
      errors.push(formatFinding('SKILL_REQUIRED_FIELD', `registry skill is missing ${field}`, {
        skill: skill.name ?? null,
        field,
      }));
    }
  }
  if (typeof skill.installable !== 'boolean') {
    errors.push(formatFinding('INSTALLABLE_BOOLEAN_REQUIRED', `${skill.name ?? '<unknown>'} installable must be boolean`, {
      skill: skill.name ?? null,
    }));
  }
  if (!Array.isArray(skill.target_support)) {
    errors.push(formatFinding('TARGET_SUPPORT_REQUIRED', `${skill.name ?? '<unknown>'} target_support must be an array`, {
      skill: skill.name ?? null,
    }));
  }
  if (!Array.isArray(skill.references)) {
    errors.push(formatFinding('REFERENCES_REQUIRED', `${skill.name ?? '<unknown>'} references must be an array`, {
      skill: skill.name ?? null,
    }));
  }
  if (!Array.isArray(skill.backing)) {
    errors.push(formatFinding('BACKING_REQUIRED', `${skill.name ?? '<unknown>'} backing must be an array`, {
      skill: skill.name ?? null,
    }));
  }
  if (skill.status && !ALLOWED_STATUSES.has(skill.status)) {
    errors.push(formatFinding('UNKNOWN_STATUS', `${skill.name ?? '<unknown>'} has unknown status`, {
      skill: skill.name ?? null,
      status: skill.status,
    }));
  }
  if (skill.invocation && !ALLOWED_INVOCATION.has(skill.invocation)) {
    errors.push(formatFinding('UNKNOWN_INVOCATION', `${skill.name ?? '<unknown>'} has unknown invocation`, {
      skill: skill.name ?? null,
      invocation: skill.invocation,
    }));
  }
  return Boolean(skill.name && skill.path);
}

function validateSkillPath(repoRoot, skill, errors) {
  if (!relativePathAllowed(skill.path)) {
    errors.push(formatFinding('UNSAFE_SKILL_PATH', `${skill.name} path must be repo-relative and stay inside the repo`, {
      skill: skill.name,
      path: skill.path,
    }));
    return null;
  }
  if (!skill.path.startsWith('skills/')) {
    errors.push(formatFinding('SKILL_PATH_ROOT', `${skill.name} path must live under skills/`, {
      skill: skill.name,
      path: skill.path,
    }));
  }
  const absolutePath = resolveInsideRepo(repoRoot, skill.path);
  if (!absolutePath) {
    errors.push(formatFinding('UNSAFE_SKILL_PATH', `${skill.name} path escapes the repo`, {
      skill: skill.name,
      path: skill.path,
    }));
    return null;
  }
  const folderName = path.basename(skill.path);
  if (folderName !== skill.name) {
    errors.push(formatFinding('FOLDER_NAME_MISMATCH', `${skill.name} path folder must match skill name`, {
      skill: skill.name,
      folder: folderName,
    }));
  }
  return absolutePath;
}

function validateFrontmatter({ skill, parsed, errors }) {
  const { frontmatter } = parsed;
  if (typeof frontmatter.name !== 'string' || !frontmatter.name.trim()) {
    errors.push(formatFinding('FRONTMATTER_NAME_REQUIRED', `${skill.name} SKILL.md must define name`, { skill: skill.name }));
  } else if (frontmatter.name !== skill.name) {
    errors.push(formatFinding('FRONTMATTER_NAME_MISMATCH', `${skill.name} frontmatter name must match registry name`, {
      skill: skill.name,
      frontmatter_name: frontmatter.name,
    }));
  }

  if (typeof frontmatter.description !== 'string' || !frontmatter.description.trim()) {
    errors.push(formatFinding('FRONTMATTER_DESCRIPTION_REQUIRED', `${skill.name} SKILL.md must define description`, { skill: skill.name }));
  } else if (normalizeDescription(frontmatter.description) !== normalizeDescription(skill.description)) {
    errors.push(formatFinding('DESCRIPTION_MISMATCH', `${skill.name} registry description must match SKILL.md frontmatter`, {
      skill: skill.name,
    }));
  }
}

function validateStateSemantics({ skill, parsed, errors }) {
  const retired = parsed.frontmatter.retired === true;
  const disabled = parsed.frontmatter['disable-model-invocation'] === true;

  if (retired && skill.status !== 'retired') {
    errors.push(formatFinding('RETIRED_STATUS_MISMATCH', `${skill.name} has retired frontmatter but registry status is not retired`, {
      skill: skill.name,
      status: skill.status,
    }));
  }
  if (skill.status === 'retired' && !retired) {
    errors.push(formatFinding('RETIRED_FRONTMATTER_REQUIRED', `${skill.name} retired registry entries must set retired: true`, {
      skill: skill.name,
    }));
  }
  if (skill.status === 'retired' && (skill.installable || skill.target_support?.length)) {
    errors.push(formatFinding('RETIRED_NOT_INSTALLABLE', `${skill.name} retired entries cannot be installable`, {
      skill: skill.name,
    }));
  }
  if (skill.status === 'retired' && !/retired/i.test(parsed.body)) {
    errors.push(formatFinding('RETIRED_BODY_REQUIRED', `${skill.name} retired entries must explain retirement in body`, {
      skill: skill.name,
    }));
  }
  if (disabled && skill.invocation !== 'disabled') {
    errors.push(formatFinding('DISABLED_INVOCATION_MISMATCH', `${skill.name} disables model invocation but registry invocation is not disabled`, {
      skill: skill.name,
      invocation: skill.invocation,
    }));
  }
  if (disabled && skill.installable) {
    errors.push(formatFinding('DISABLED_NOT_INSTALLABLE', `${skill.name} disabled model-invocation skills cannot be installable`, {
      skill: skill.name,
    }));
  }
}

function validateTargets({ skill, registry, errors }) {
  const targets = knownTargets(registry);
  for (const target of skill.target_support ?? []) {
    if (!targets.has(target)) {
      errors.push(formatFinding('UNKNOWN_TARGET', `${skill.name} target_support includes an unknown target`, {
        skill: skill.name,
        target,
      }));
    }
  }
  if (skill.installable && skill.status !== 'installable') {
    errors.push(formatFinding('INSTALLABLE_STATUS_MISMATCH', `${skill.name} installable entries must use status installable`, {
      skill: skill.name,
      status: skill.status,
    }));
  }
  if (skill.status === 'installable' && !skill.installable) {
    errors.push(formatFinding('INSTALLABLE_BOOLEAN_MISMATCH', `${skill.name} status installable requires installable true`, {
      skill: skill.name,
    }));
  }
  if (skill.installable && !(skill.target_support ?? []).length) {
    errors.push(formatFinding('INSTALLABLE_TARGET_REQUIRED', `${skill.name} installable entries need target_support`, {
      skill: skill.name,
    }));
  }
}

function validateBodyBudget({ skill, parsed, registry, errors, warnings }) {
  const maxLines = skill.body_budget?.max_lines ?? registry.body_line_budget ?? DEFAULT_BODY_LINE_BUDGET;
  if (!Number.isInteger(maxLines) || maxLines <= 0) {
    errors.push(formatFinding('INVALID_BODY_BUDGET', `${skill.name} body budget must be a positive integer`, {
      skill: skill.name,
      max_lines: maxLines,
    }));
    return;
  }

  if (parsed.body_line_count <= maxLines) return;

  const hasSplitReference = skill.body_budget?.exception === 'needs_split'
    || skill.body_budget?.reference_split === true
    || skill.status === 'needs_split';

  if (!hasSplitReference || !(skill.references ?? []).length) {
    errors.push(formatFinding('BODY_BUDGET_EXCEEDED', `${skill.name} exceeds body budget without reference split or needs_split exception`, {
      skill: skill.name,
      body_lines: parsed.body_line_count,
      max_lines: maxLines,
    }));
    return;
  }

  if (skill.status === 'needs_split' && !(skill.split_to ?? []).length) {
    errors.push(formatFinding('NEEDS_SPLIT_TARGETS_REQUIRED', `${skill.name} needs_split entries must list split_to targets`, {
      skill: skill.name,
    }));
    return;
  }

  warnings.push(formatFinding('BODY_BUDGET_EXCEPTION', `${skill.name} exceeds body budget and is explicitly tracked for split/reference cleanup`, {
    skill: skill.name,
    body_lines: parsed.body_line_count,
    max_lines: maxLines,
  }));
}

function validateDurableBacking({ skill, errors }) {
  if (!skill.claims_durable_behavior) return;
  const backing = skill.backing ?? [];
  if (!backing.some(isDurableBacking)) {
    errors.push(formatFinding('DURABLE_BACKING_REQUIRED', `${skill.name} claims durable repo behavior but lacks docs/API/schema backing`, {
      skill: skill.name,
      backing,
    }));
  }
}

export async function validateSkillRegistry(options = {}) {
  const repoRoot = path.resolve(options.repoRoot ?? process.cwd());
  const registryRelativePath = options.registryPath ?? 'skills/registry.json';
  const registryPath = path.isAbsolute(registryRelativePath)
    ? registryRelativePath
    : path.join(repoRoot, registryRelativePath);
  const errors = [];
  const warnings = [];
  const skillResults = [];

  let registry;
  try {
    registry = JSON.parse(await readFile(registryPath, 'utf8'));
  } catch (error) {
    return {
      schema_version: VALIDATION_SCHEMA_VERSION,
      ok: false,
      registry_path: registryPath,
      summary: { skills: 0, errors: 1, warnings: 0 },
      skills: [],
      errors: [formatFinding('REGISTRY_READ_FAILED', `Could not read registry: ${error.message}`)],
      warnings,
    };
  }

  validateRegistryShape(registry, errors);
  const directNames = await directSkillNames(repoRoot);
  const registeredNames = [];
  const seen = new Set();

  for (const skill of registry.skills ?? []) {
    if (!validateSkillShape(skill, errors)) continue;
    registeredNames.push(skill.name);
    if (seen.has(skill.name)) {
      errors.push(formatFinding('DUPLICATE_SKILL', `${skill.name} appears more than once in the registry`, {
        skill: skill.name,
      }));
      continue;
    }
    seen.add(skill.name);

    const absoluteSkillPath = validateSkillPath(repoRoot, skill, errors);
    if (!absoluteSkillPath) continue;
    const skillFile = path.join(absoluteSkillPath, 'SKILL.md');
    let parsed;
    try {
      parsed = parseSkillPackage(await readFile(skillFile, 'utf8'), path.relative(repoRoot, skillFile));
    } catch (error) {
      errors.push(formatFinding('SKILL_PARSE_FAILED', `${skill.name} SKILL.md could not be parsed: ${error.message}`, {
        skill: skill.name,
      }));
      continue;
    }

    validateFrontmatter({ skill, parsed, errors });
    validateStateSemantics({ skill, parsed, errors });
    validateTargets({ skill, registry, errors });
    validateBodyBudget({ skill, parsed, registry, errors, warnings });
    validateDurableBacking({ skill, errors });

    for (const reference of skill.references ?? []) {
      await validateReferencePath({ repoRoot, skillName: skill.name, field: 'references', relativePath: reference, errors });
    }
    for (const reference of skill.backing ?? []) {
      await validateReferencePath({ repoRoot, skillName: skill.name, field: 'backing', relativePath: reference, errors });
    }
    for (const authority of parsed.frontmatter.authority ?? []) {
      await validateReferencePath({ repoRoot, skillName: skill.name, field: 'frontmatter.authority', relativePath: authority, errors });
    }

    skillResults.push({
      name: skill.name,
      path: skill.path,
      status: skill.status,
      installable: skill.installable,
      target_support: skill.target_support ?? [],
      body_lines: parsed.body_line_count,
      body_line_budget: skill.body_budget?.max_lines ?? registry.body_line_budget ?? DEFAULT_BODY_LINE_BUDGET,
      claims_durable_behavior: skill.claims_durable_behavior === true,
    });
  }

  for (const name of directNames) {
    if (!seen.has(name)) {
      errors.push(formatFinding('UNREGISTERED_SKILL', `${name} has SKILL.md but is missing from skills/registry.json`, {
        skill: name,
      }));
    }
  }

  for (const name of registeredNames) {
    if (!directNames.includes(name)) {
      errors.push(formatFinding('MISSING_SKILL_DIR', `${name} is registered but no matching direct skill package exists`, {
        skill: name,
      }));
    }
  }

  skillResults.sort((a, b) => a.name.localeCompare(b.name));

  return {
    schema_version: VALIDATION_SCHEMA_VERSION,
    ok: errors.length === 0,
    registry_path: path.relative(repoRoot, registryPath),
    registry_schema_version: registry.schema_version ?? null,
    supported_targets: Object.keys(registry.supported_targets ?? {}).sort(),
    summary: {
      skills: skillResults.length,
      errors: errors.length,
      warnings: warnings.length,
    },
    skills: skillResults,
    errors,
    warnings,
  };
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

function sha256Buffer(value) {
  return createHash('sha256').update(value).digest('hex');
}

function sha256Text(value) {
  return sha256Buffer(Buffer.from(value, 'utf8'));
}

function expandHome(value) {
  if (value === '~') return os.homedir();
  if (value?.startsWith('~/')) return path.join(os.homedir(), value.slice(2));
  return value;
}

function pathSegments(value) {
  return String(value).split(/[\\/]+/).filter(Boolean);
}

function rejectTraversal(value, label = 'path') {
  if (pathSegments(value).includes('..')) {
    throw new AosSkillsError(`${label} must not contain path traversal segments`, 'PATH_TRAVERSAL', { path: value });
  }
}

function relativeInstallPathAllowed(relativePath) {
  return relativePathAllowed(relativePath) && relativePath !== '.';
}

async function readRegistry(repoRoot, registryPath = 'skills/registry.json') {
  const absolutePath = path.isAbsolute(registryPath)
    ? registryPath
    : path.join(repoRoot, registryPath);
  return {
    path: absolutePath,
    registry: JSON.parse(await readFile(absolutePath, 'utf8')),
  };
}

async function fileExists(absolutePath) {
  try {
    await lstat(absolutePath);
    return true;
  } catch {
    return false;
  }
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

function installableTargets(skill) {
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

async function inspectInstallRoot(target) {
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

function selectedSkills(registry, names = []) {
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

function installPathFor(target, skill) {
  return path.join(target.root, skill.name);
}

function manifestPathFor(target, skill) {
  return path.join(installPathFor(target, skill), '.aos-skill-manifest.json');
}

async function readInstalledManifest(target, skill) {
  const manifestPath = manifestPathFor(target, skill);
  try {
    return { manifest: JSON.parse(await readFile(manifestPath, 'utf8')), error: null };
  } catch (error) {
    if (error?.code === 'ENOENT') return { manifest: null, error: null };
    return { manifest: null, error };
  }
}

function fileIdentityMap(files) {
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

function fileIdentityMapsEqual(left, right) {
  if (!left || !right || left.size !== right.size) return false;
  for (const [filePath, identity] of left.entries()) {
    const other = right.get(filePath);
    if (!other || other.sha256 !== identity.sha256 || other.bytes !== identity.bytes) return false;
  }
  return true;
}

async function collectInstalledFiles(skillRoot) {
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

function installedFileDrift({ installedFiles, packageInfo }) {
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

function countStates(items) {
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

async function checkOneSkill({ target, skill, packageInfo }) {
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
    target: {
      name: target.name,
      root: target.root,
      exists: target.exists,
      explicit_path: target.explicit_path,
    },
    summary: countStates(checks),
    skills: checks,
  };
}

function installedManifestFor({ skill, packageInfo }) {
  return {
    schema_version: INSTALLED_SKILL_MANIFEST_SCHEMA_VERSION,
    managed_by: 'aos',
    name: skill.name,
    source_path: skill.path,
    source_digest: packageInfo.digest,
    files: packageInfo.files,
  };
}

function plannedFileWrites({ target, skill, packageInfo }) {
  const skillRoot = installPathFor(target, skill);
  const writes = [];
  for (const file of packageInfo.files) {
    const destination = path.resolve(skillRoot, file.path);
    if (!destination.startsWith(`${path.resolve(skillRoot)}${path.sep}`)) {
      throw new AosSkillsError('Planned skill write escapes the skill directory', 'PATH_TRAVERSAL', {
        skill: skill.name,
        path: file.path,
      });
    }
    writes.push({
      skill: skill.name,
      kind: 'package_file',
      source_path: path.join(skill.path, file.path).split(path.sep).join('/'),
      destination,
      bytes: file.bytes,
      sha256: file.sha256,
      source_digest: packageInfo.digest,
    });
  }

  const manifest = installedManifestFor({ skill, packageInfo });
  const manifestBody = formatJSON(manifest);
  writes.push({
    skill: skill.name,
    kind: 'manifest',
    source_path: null,
    destination: path.join(skillRoot, '.aos-skill-manifest.json'),
    bytes: Buffer.byteLength(manifestBody),
    sha256: sha256Text(manifestBody),
    source_digest: packageInfo.digest,
  });
  return writes;
}

function targetPayload(target) {
  return {
    name: target.name,
    root: target.root,
    exists: target.exists,
    explicit_path: target.explicit_path,
  };
}

async function ensureWritableTargetRoot(target) {
  if (!target.exists) {
    await mkdir(target.root, { recursive: true });
  }
  return inspectInstallRoot(target);
}

async function buildInstallPlan(options = {}, { prepareTargetForWrite = false } = {}) {
  const catalog = await loadSkillCatalog(options);
  let target = await resolveInstallTarget(catalog.registry, options);
  if (prepareTargetForWrite) {
    target = await ensureWritableTargetRoot(target);
  }
  const requestedNames = options.skills ?? [];
  const candidates = requestedNames.length
    ? selectedSkills(catalog.registry, requestedNames)
    : (catalog.registry.skills ?? []).filter((skill) => skill.installable);
  const checks = [];
  const planned_writes = [];
  const blocked = [];

  for (const skill of candidates) {
    const packageInfo = catalog.packages.get(skill.name);
    const check = await checkOneSkill({ target, skill, packageInfo });
    checks.push(check);
    if (!skill.installable || !(skill.target_support ?? []).includes(target.name)) {
      blocked.push({
        skill: skill.name,
        code: 'UNSUPPORTED_SKILL',
        reason: check.reason,
      });
      continue;
    }
    if (['unmanaged', 'blocked'].includes(check.state)) {
      blocked.push({
        skill: skill.name,
        code: check.state === 'unmanaged' ? 'UNMANAGED_INSTALLED_SKILL' : 'BLOCKED_INSTALLED_SKILL',
        reason: check.reason,
      });
      continue;
    }
    if (check.state === 'ok') continue;
    planned_writes.push(...plannedFileWrites({ target, skill, packageInfo }));
  }

  const status = blocked.length ? 'blocked' : 'dry_run';
  const payload = {
    schema_version: INSTALL_PLAN_SCHEMA_VERSION,
    status,
    dry_run: options.dryRun === true,
    target: targetPayload(target),
    selected_skills: candidates.map((skill) => skill.name).sort(),
    summary: {
      selected: candidates.length,
      planned_writes: planned_writes.length,
      blocked: blocked.length,
      states: countStates(checks),
    },
    skills: checks.sort((a, b) => a.name.localeCompare(b.name)),
    planned_writes,
    blocked,
  };
  return { payload, catalog, target, candidates };
}

export async function planSkillInstall(options = {}) {
  if (!options.dryRun) {
    throw new AosSkillsError('aos skills install planning requires --dry-run', 'DRY_RUN_REQUIRED');
  }
  const { payload } = await buildInstallPlan(options);
  return payload;
}

function assertDestinationInsideTarget(write, target) {
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

async function materializePlannedWrite({ write, catalog, skill, packageInfo }) {
  if (write.kind === 'package_file') {
    const source = path.join(catalog.repoRoot, write.source_path);
    const body = await readFile(source);
    const sha256 = sha256Buffer(body);
    if (sha256 !== write.sha256 || body.length !== write.bytes) {
      throw new AosSkillsError('Source skill package changed during install planning', 'SOURCE_PACKAGE_CHANGED', {
        skill: write.skill,
        source_path: write.source_path,
      });
    }
    return body;
  }
  if (write.kind === 'manifest') {
    return Buffer.from(formatJSON(installedManifestFor({ skill, packageInfo })), 'utf8');
  }
  throw new AosSkillsError(`Unknown planned write kind: ${write.kind}`, 'UNKNOWN_WRITE_KIND', {
    kind: write.kind,
  });
}

async function applyPlannedWrite({ write, catalog, target, skill, packageInfo }) {
  assertDestinationInsideTarget(write, target);
  const destination = path.resolve(write.destination);
  const body = await materializePlannedWrite({ write, catalog, skill, packageInfo });
  await mkdir(path.dirname(destination), { recursive: true });
  const parentRealpath = await realpath(path.dirname(destination));
  if (target.realpath && parentRealpath !== target.realpath && !parentRealpath.startsWith(`${target.realpath}${path.sep}`)) {
    throw new AosSkillsError('AOS skills install write escapes the resolved target root', 'PATH_TRAVERSAL', {
      skill: write.skill,
      destination,
      root: target.realpath,
    });
  }
  await writeFile(destination, body);
  return {
    skill: write.skill,
    kind: write.kind,
    destination,
    bytes: body.length,
    sha256: sha256Buffer(body),
    source_digest: write.source_digest,
  };
}

export async function installSkills(options = {}) {
  const { payload: plan, catalog, target, candidates } = await buildInstallPlan(
    { ...options, dryRun: false },
    { prepareTargetForWrite: true },
  );

  if (plan.blocked.length) {
    return {
      ...plan,
      schema_version: INSTALL_SCHEMA_VERSION,
      status: 'blocked',
      dry_run: false,
      summary: {
        ...plan.summary,
        written: 0,
      },
    };
  }

  const byName = new Map(candidates.map((skill) => [skill.name, skill]));
  const written = [];
  for (const write of plan.planned_writes) {
    const skill = byName.get(write.skill);
    const packageInfo = catalog.packages.get(write.skill);
    written.push(await applyPlannedWrite({ write, catalog, target, skill, packageInfo }));
  }

  const postChecks = [];
  for (const skill of candidates) {
    postChecks.push(await checkOneSkill({
      target,
      skill,
      packageInfo: catalog.packages.get(skill.name),
    }));
  }
  postChecks.sort((a, b) => a.name.localeCompare(b.name));

  return {
    ...plan,
    schema_version: INSTALL_SCHEMA_VERSION,
    status: 'installed',
    dry_run: false,
    target: targetPayload(target),
    summary: {
      selected: candidates.length,
      planned_writes: plan.planned_writes.length,
      written: written.length,
      blocked: 0,
      states_before: plan.summary.states,
      states_after: countStates(postChecks),
    },
    skills: postChecks,
    written,
  };
}

function requirePlaywrightCompanionName(name) {
  if (!name) {
    throw new AosSkillsError('aos skills companion requires --name playwright-cli', 'MISSING_ARG', {
      flag: '--name',
    });
  }
  if (name !== 'playwright-cli') {
    throw new AosSkillsError(`Unsupported AOS skills companion: ${name}`, 'UNSUPPORTED_COMPANION', {
      companion: name,
      supported_companions: ['playwright-cli'],
    });
  }
}

async function resolveCompanionTarget(catalog, options = {}) {
  return resolveInstallTarget(catalog.registry, options);
}

async function detectPlaywrightCompanionInstall(target) {
  if (!target.exists) {
    return {
      state: 'missing',
      reason: 'target skill root does not exist',
      detected_skills: [],
    };
  }

  const detected = [];
  const entries = await readdir(target.root, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const skillFile = path.join(target.root, entry.name, 'SKILL.md');
    let raw;
    try {
      raw = await readFile(skillFile, 'utf8');
    } catch {
      continue;
    }
    if (/playwright/i.test(raw) && /(playwright-cli|@playwright\/cli|browser automation)/i.test(raw)) {
      detected.push({
        name: entry.name,
        path: path.join(target.root, entry.name),
      });
    }
  }

  if (!detected.length) {
    return {
      state: 'missing',
      reason: 'no Playwright CLI companion skill package detected in target',
      detected_skills: [],
    };
  }
  return {
    state: 'installed',
    reason: 'Playwright CLI companion skill package detected in target',
    detected_skills: detected.sort((a, b) => a.name.localeCompare(b.name)),
  };
}

function companionRuntimePayload(options = {}) {
  return resolvePlaywrightCliRuntime({
    repoRoot: path.resolve(options.repoRoot ?? process.cwd()),
    env: options.env ?? process.env,
  });
}

export async function checkSkillCompanion(options = {}) {
  requirePlaywrightCompanionName(options.name);
  const catalog = await loadSkillCatalog(options);
  const target = await resolveCompanionTarget(catalog, options);
  const runtime = companionRuntimePayload(options);
  const installation = await detectPlaywrightCompanionInstall(target);
  const status = runtime.status === 'ok' ? 'success' : 'blocked';
  return {
    schema_version: COMPANION_CHECK_SCHEMA_VERSION,
    status,
    companion: {
      name: 'playwright-cli',
      owner: 'playwright-cli',
      vendored_by_aos: false,
    },
    runtime,
    target: targetPayload(target),
    installation,
  };
}

export async function planSkillCompanionInstall(options = {}) {
  requirePlaywrightCompanionName(options.name);
  if (!options.dryRun) {
    throw new AosSkillsError('Playwright CLI companion install is dry-run-only in AOS', 'DRY_RUN_REQUIRED');
  }
  const catalog = await loadSkillCatalog(options);
  const target = await resolveCompanionTarget(catalog, options);
  const runtime = companionRuntimePayload(options);
  const installation = await detectPlaywrightCompanionInstall(target);
  const blocked = runtime.status === 'ok'
    ? []
    : [{
      companion: 'playwright-cli',
      code: runtime.code ?? 'PLAYWRIGHT_CLI_UNAVAILABLE',
      reason: runtime.error ?? 'Playwright CLI runtime unavailable',
    }];
  return {
    schema_version: COMPANION_INSTALL_PLAN_SCHEMA_VERSION,
    status: blocked.length ? 'blocked' : 'dry_run',
    dry_run: true,
    companion: {
      name: 'playwright-cli',
      owner: 'playwright-cli',
      vendored_by_aos: false,
    },
    runtime,
    target: targetPayload(target),
    installation,
    planned_invocation: blocked.length
      ? null
      : {
        executable: runtime.path,
        argv: ['install', '--skills'],
        note: 'AOS reports this external Playwright CLI invocation but does not run it in dry-run mode.',
      },
    planned_aos_writes: [],
    blocked,
  };
}
