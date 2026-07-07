import path from 'node:path';
import { readdir, readFile, stat } from 'node:fs/promises';

import {
  DEFAULT_BODY_LINE_BUDGET,
  REGISTRY_SCHEMA_VERSION,
  VALIDATION_SCHEMA_VERSION,
  formatFinding,
  isObject,
  normalizeDescription,
  relativePathAllowed,
  resolveInsideRepo,
} from './shared.mjs';

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
