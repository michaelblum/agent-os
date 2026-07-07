import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { lstat, mkdir, readFile, realpath, rename, rm, writeFile } from 'node:fs/promises';

import { loadSkillCatalog, selectedSkills } from './catalog.mjs';
import {
  assertDestinationInsideTarget,
  assertPathInsideTarget,
  ensureWritableTargetRoot,
  installPathFor,
  resolveInstallTarget,
  targetPayload,
} from './install-targets.mjs';
import {
  checkOneSkill,
  collectInstalledFiles,
  countStates,
  installedFileDrift,
} from './installed-state.mjs';
import {
  AosSkillsError,
  INSTALL_PLAN_SCHEMA_VERSION,
  INSTALL_SCHEMA_VERSION,
  INSTALLED_SKILL_MANIFEST_SCHEMA_VERSION,
  fileExists,
  formatJSON,
  sha256Buffer,
  sha256Text,
} from './shared.mjs';

const STAGING_DIR_NAME = '.aos-skills-staging';

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

async function prepareCleanStagingRoot(target) {
  const stagingRoot = path.join(target.root, STAGING_DIR_NAME);
  assertPathInsideTarget({ absolutePath: stagingRoot, target });
  if (await fileExists(stagingRoot)) {
    const info = await lstat(stagingRoot);
    if (info.isSymbolicLink() || !info.isDirectory()) {
      throw new AosSkillsError('AOS skills staging path is blocked by a non-directory', 'STAGING_ROOT_BLOCKED', {
        target: target.name,
        path: stagingRoot,
      });
    }
    await rm(stagingRoot, { recursive: true, force: true });
  }
  await mkdir(stagingRoot, { recursive: true });
  const stagingRealpath = await realpath(stagingRoot);
  if (target.realpath && !stagingRealpath.startsWith(`${target.realpath}${path.sep}`)) {
    throw new AosSkillsError('AOS skills staging root escapes the resolved target root', 'PATH_TRAVERSAL', {
      target: target.name,
      path: stagingRoot,
      root: target.realpath,
    });
  }
  return stagingRoot;
}

async function writeStagedSkill({ stageSkillRoot, writes, catalog, target, skill, packageInfo }) {
  const finalSkillRoot = installPathFor(target, skill);
  const written = [];
  for (const write of writes) {
    assertDestinationInsideTarget(write, target);
    const relativeDestination = path.relative(finalSkillRoot, path.resolve(write.destination));
    const stagedDestination = path.resolve(stageSkillRoot, relativeDestination);
    if (!stagedDestination.startsWith(`${path.resolve(stageSkillRoot)}${path.sep}`)) {
      throw new AosSkillsError('AOS skills staged write escapes the staged skill directory', 'PATH_TRAVERSAL', {
        skill: skill.name,
        destination: stagedDestination,
        root: stageSkillRoot,
      });
    }
    const body = await materializePlannedWrite({ write, catalog, skill, packageInfo });
    await mkdir(path.dirname(stagedDestination), { recursive: true });
    await writeFile(stagedDestination, body);
    written.push({
      skill: write.skill,
      kind: write.kind,
      destination: path.resolve(write.destination),
      bytes: body.length,
      sha256: sha256Buffer(body),
      source_digest: write.source_digest,
    });
  }
  return written;
}

async function verifyStagedSkill({ stageSkillRoot, skill, packageInfo }) {
  let manifest;
  try {
    manifest = JSON.parse(await readFile(path.join(stageSkillRoot, '.aos-skill-manifest.json'), 'utf8'));
  } catch (error) {
    throw new AosSkillsError('Staged skill manifest is missing or unreadable', 'STAGED_MANIFEST_INVALID', {
      skill: skill.name,
      reason: error.message,
    });
  }
  if (
    manifest.schema_version !== INSTALLED_SKILL_MANIFEST_SCHEMA_VERSION
    || manifest.managed_by !== 'aos'
    || manifest.name !== skill.name
    || manifest.source_digest !== packageInfo.digest
  ) {
    throw new AosSkillsError('Staged skill manifest does not match the source package', 'STAGED_MANIFEST_INVALID', {
      skill: skill.name,
    });
  }
  const stagedFiles = await collectInstalledFiles(stageSkillRoot);
  const drift = installedFileDrift({ installedFiles: stagedFiles, packageInfo });
  if (drift) {
    throw new AosSkillsError('Staged skill package does not match the source package', 'STAGED_PACKAGE_INVALID', {
      skill: skill.name,
      reason: drift.reason,
    });
  }
}

async function promoteStagedSkill({ stageSkillRoot, stagingRoot, target, skill, packageInfo }) {
  const finalSkillRoot = installPathFor(target, skill);
  const current = await checkOneSkill({ target, skill, packageInfo });
  if (current.state === 'ok') {
    await rm(stageSkillRoot, { recursive: true, force: true });
    return false;
  }
  if (['unmanaged', 'blocked', 'unsupported_target'].includes(current.state)) {
    throw new AosSkillsError('AOS skills install target changed before finalization', 'INSTALL_TARGET_CHANGED', {
      skill: skill.name,
      state: current.state,
      reason: current.reason,
    });
  }

  let backupRoot = null;
  if (await fileExists(finalSkillRoot)) {
    backupRoot = path.join(stagingRoot, `${skill.name}.backup-${randomUUID()}`);
    await rename(finalSkillRoot, backupRoot);
  }

  try {
    await rename(stageSkillRoot, finalSkillRoot);
  } catch (error) {
    if (backupRoot) {
      try {
        await rename(backupRoot, finalSkillRoot);
      } catch (restoreError) {
        throw new AosSkillsError('AOS skills install failed and rollback failed', 'INSTALL_ROLLBACK_FAILED', {
          skill: skill.name,
          install_error: error.message,
          rollback_error: restoreError.message,
        });
      }
    }
    throw error;
  }

  if (backupRoot) await rm(backupRoot, { recursive: true, force: true });
  return true;
}

async function applyStagedSkill({ writes, catalog, target, skill, packageInfo, stagingRoot }) {
  const stageSkillRoot = path.join(stagingRoot, `${skill.name}.stage-${randomUUID()}`);
  await mkdir(stageSkillRoot, { recursive: true });
  const stagedRealpath = await realpath(stageSkillRoot);
  const stagingRealpath = await realpath(stagingRoot);
  if (stagedRealpath !== stagingRealpath && !stagedRealpath.startsWith(`${stagingRealpath}${path.sep}`)) {
    throw new AosSkillsError('AOS skills staged skill root escapes the staging root', 'PATH_TRAVERSAL', {
      skill: skill.name,
      path: stageSkillRoot,
      root: stagingRoot,
    });
  }
  try {
    const written = await writeStagedSkill({ stageSkillRoot, writes, catalog, target, skill, packageInfo });
    await verifyStagedSkill({ stageSkillRoot, skill, packageInfo });
    const promoted = await promoteStagedSkill({ stageSkillRoot, stagingRoot, target, skill, packageInfo });
    return promoted ? written : [];
  } catch (error) {
    await rm(stageSkillRoot, { recursive: true, force: true });
    throw error;
  }
}

function groupWritesBySkill(plannedWrites) {
  const grouped = new Map();
  for (const write of plannedWrites) {
    const writes = grouped.get(write.skill) ?? [];
    writes.push(write);
    grouped.set(write.skill, writes);
  }
  return grouped;
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
  const plannedBySkill = groupWritesBySkill(plan.planned_writes);
  const written = [];
  let stagingRoot = null;
  try {
    if (plan.planned_writes.length) {
      stagingRoot = await prepareCleanStagingRoot(target);
    }
    for (const [skillName, writes] of plannedBySkill.entries()) {
      const skill = byName.get(skillName);
      const packageInfo = catalog.packages.get(skillName);
      written.push(...await applyStagedSkill({
        writes,
        catalog,
        target,
        skill,
        packageInfo,
        stagingRoot,
      }));
    }
  } finally {
    if (stagingRoot) await rm(stagingRoot, { recursive: true, force: true });
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
