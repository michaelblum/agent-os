import path from 'node:path';
import { readdir, readFile } from 'node:fs/promises';

import { loadSkillCatalog } from './catalog.mjs';
import { resolveInstallTarget, targetPayload } from './install-targets.mjs';
import { parseSkillPackage } from './validation.mjs';
import {
  AosSkillsError,
  COMPANION_CHECK_SCHEMA_VERSION,
  COMPANION_INSTALL_PLAN_SCHEMA_VERSION,
} from './shared.mjs';
import { resolvePlaywrightCliRuntime } from '../playwright-cli-runtime.mjs';

const PLAYWRIGHT_COMPANION_NAMES = new Set(['playwright', 'playwright-cli']);
const PLAYWRIGHT_OWNER_FIELDS = ['owner', 'managed_by', 'generated_by', 'package_owner'];

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

function parseCompanionFrontmatter(raw, source) {
  try {
    return parseSkillPackage(raw, source).frontmatter;
  } catch {
    return null;
  }
}

function hasPlaywrightOwnedIdentity({ entryName, frontmatter }) {
  if (!frontmatter) return false;
  const packageName = frontmatter.name;
  if (!PLAYWRIGHT_COMPANION_NAMES.has(entryName) || !PLAYWRIGHT_COMPANION_NAMES.has(packageName)) {
    return false;
  }
  return PLAYWRIGHT_OWNER_FIELDS.some((field) => frontmatter[field] === 'playwright-cli');
}

function playwrightCandidateReason({ raw }) {
  if (/playwright/i.test(raw) && /(playwright-cli|@playwright\/cli|browser automation)/i.test(raw)) {
    return 'text mentions Playwright CLI companion concepts but lacks Playwright-owned package metadata';
  }
  return null;
}

async function detectPlaywrightCompanionInstall(target) {
  if (!target.exists) {
    return {
      state: 'missing',
      reason: 'target skill root does not exist',
      detected_skills: [],
      candidates: [],
    };
  }

  const detected = [];
  const candidates = [];
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
    const frontmatter = parseCompanionFrontmatter(raw, path.join(entry.name, 'SKILL.md'));
    if (hasPlaywrightOwnedIdentity({ entryName: entry.name, frontmatter })) {
      detected.push({
        name: entry.name,
        package_name: frontmatter.name,
        owner: 'playwright-cli',
        path: path.join(target.root, entry.name),
      });
      continue;
    }
    const candidateReason = playwrightCandidateReason({ raw, frontmatter });
    if (candidateReason) {
      candidates.push({
        name: entry.name,
        path: path.join(target.root, entry.name),
        reason: candidateReason,
      });
    }
  }

  if (detected.length) {
    return {
      state: 'installed',
      reason: 'Playwright CLI companion skill package detected in target',
      detected_skills: detected.sort((a, b) => a.name.localeCompare(b.name)),
      candidates: candidates.sort((a, b) => a.name.localeCompare(b.name)),
    };
  }
  if (candidates.length) {
    return {
      state: 'candidate_detected',
      reason: 'Playwright-looking skill content found without Playwright-owned package identity',
      detected_skills: [],
      candidates: candidates.sort((a, b) => a.name.localeCompare(b.name)),
    };
  }
  return {
    state: 'missing',
    reason: 'no Playwright CLI companion skill package detected in target',
    detected_skills: [],
    candidates: [],
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
