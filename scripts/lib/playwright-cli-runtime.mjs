import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

export const MIN_PLAYWRIGHT_CLI_VERSION = '0.1.8';

function repoRootFromHere() {
  return path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..');
}

function executable(file) {
  try {
    fs.accessSync(file, fs.constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function pathCandidate(name, env) {
  for (const dir of String(env.PATH || '').split(':')) {
    if (!dir) continue;
    const candidate = path.join(dir, name);
    if (executable(candidate)) return candidate;
  }
  return null;
}

function resolveSymlinks(file) {
  let current = file;
  for (let i = 0; i < 16; i += 1) {
    let target;
    try {
      target = fs.readlinkSync(current);
    } catch {
      break;
    }
    current = path.isAbsolute(target) ? target : path.resolve(path.dirname(current), target);
  }
  return current;
}

function packageVersion(binaryPath) {
  let dir = path.dirname(resolveSymlinks(binaryPath));
  for (let i = 0; i < 20; i += 1) {
    const pkg = path.join(dir, 'package.json');
    try {
      const parsed = JSON.parse(fs.readFileSync(pkg, 'utf8'));
      if (parsed?.name === '@playwright/cli' && typeof parsed.version === 'string') {
        return parsed.version;
      }
    } catch {
      // Keep walking.
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

function parseVersion(value) {
  const base = String(value || '').split('-')[0];
  const parts = base.split('.').map((part) => {
    if (!/^[0-9]+$/.test(part)) return null;
    return Number(part);
  });
  return parts.some((part) => part === null) ? [] : parts;
}

export function compareVersions(a, b) {
  const left = parseVersion(a);
  const right = parseVersion(b);
  if (left.length === 0 || right.length === 0) return null;
  const count = Math.max(left.length, right.length);
  for (let i = 0; i < count; i += 1) {
    const av = left[i] ?? 0;
    const bv = right[i] ?? 0;
    if (av < bv) return -1;
    if (av > bv) return 1;
  }
  return 0;
}

function binaryVersion(executablePath, env) {
  const result = spawnSync(executablePath, ['--version'], {
    encoding: 'utf8',
    env,
  });
  if (result.error || result.status !== 0) {
    return {
      ok: false,
      code: 'PLAYWRIGHT_CLI_PROBE_FAILED',
      error: result.error?.message || result.stderr || result.stdout || 'version probe failed',
    };
  }
  return {
    ok: true,
    version: String(result.stdout || '').trim(),
  };
}

function candidateResult({ executablePath, source, env, minimumVersion }) {
  const pkgVersion = packageVersion(executablePath);
  let version = pkgVersion;
  let versionSource = pkgVersion ? 'package.json' : 'binary-version';
  if (!version) {
    const probe = binaryVersion(executablePath, env);
    if (!probe.ok) {
      return {
        status: 'probe_failed',
        code: probe.code,
        error: `Version probe failed: ${probe.error}`,
        path: executablePath,
        source,
        minimum: minimumVersion,
        remediation: 'Use AOS_PLAYWRIGHT_CLI to point at a working @playwright/cli executable, or run scripts/aos-playwright-cli once to populate the repo-owned npx cache.',
      };
    }
    version = probe.version;
  }
  const cmp = compareVersions(version, minimumVersion);
  if (cmp === null) {
    return {
      status: 'probe_failed',
      code: 'PLAYWRIGHT_CLI_PROBE_FAILED',
      error: `Version probe failed: unparseable version: ${version}`,
      path: executablePath,
      source,
      minimum: minimumVersion,
      version,
      version_source: versionSource,
      remediation: 'Use AOS_PLAYWRIGHT_CLI to point at a supported @playwright/cli executable.',
    };
  }
  if (cmp < 0) {
    return {
      status: 'too_old',
      code: 'PLAYWRIGHT_CLI_TOO_OLD',
      error: `@playwright/cli ${version} is below the minimum ${minimumVersion}.`,
      path: executablePath,
      source,
      minimum: minimumVersion,
      version,
      version_source: versionSource,
      remediation: 'Use scripts/aos-playwright-cli or update AOS_PLAYWRIGHT_CLI to @playwright/cli >= 0.1.8.',
    };
  }
  return {
    status: 'ok',
    path: executablePath,
    source,
    minimum: minimumVersion,
    version,
    version_source: versionSource,
  };
}

export function resolvePlaywrightCliRuntime(options = {}) {
  const env = options.env || process.env;
  const repoRoot = options.repoRoot || repoRootFromHere();
  const minimumVersion = options.minimumVersion || MIN_PLAYWRIGHT_CLI_VERSION;
  const candidates = [];

  if (env.AOS_PLAYWRIGHT_CLI) {
    const overridePath = path.resolve(env.AOS_PLAYWRIGHT_CLI);
    if (!executable(overridePath)) {
      return {
        status: 'missing',
        code: 'PLAYWRIGHT_CLI_NOT_FOUND',
        error: `AOS_PLAYWRIGHT_CLI is not executable: ${overridePath}`,
        minimum: minimumVersion,
        skipped: [{ source: 'env:AOS_PLAYWRIGHT_CLI', path: overridePath, reason: 'not_executable' }],
        remediation: 'Point AOS_PLAYWRIGHT_CLI at a supported @playwright/cli executable or unset it to use repo-owned runtime discovery.',
      };
    }
    candidates.push({ path: overridePath, source: 'env:AOS_PLAYWRIGHT_CLI' });
  }

  if (env.AOS_PLAYWRIGHT_CLI_DISABLE_REPO !== '1') {
    candidates.push({ path: path.join(repoRoot, 'node_modules', '.bin', 'playwright-cli'), source: 'repo:node_modules/.bin/playwright-cli' });
    candidates.push({ path: path.join(repoRoot, 'scripts', 'aos-playwright-cli'), source: 'repo:scripts/aos-playwright-cli' });
  }

  const fromPath = pathCandidate('playwright-cli', env);
  if (fromPath) candidates.push({ path: fromPath, source: 'PATH' });

  const skipped = [];
  for (const candidate of candidates) {
    if (!candidate.path) continue;
    const executablePath = path.resolve(candidate.path);
    if (!executable(executablePath)) {
      skipped.push({ source: candidate.source, path: executablePath, reason: 'not_executable' });
      continue;
    }
    return {
      ...candidateResult({
        executablePath,
        source: candidate.source,
        env,
        minimumVersion,
      }),
      skipped,
    };
  }

  return {
    status: 'missing',
    code: 'PLAYWRIGHT_CLI_NOT_FOUND',
    error: '@playwright/cli runtime was not found.',
    minimum: minimumVersion,
    skipped,
    remediation: 'Use the repo-owned scripts/aos-playwright-cli wrapper, install a repo-local node_modules/.bin/playwright-cli, or set AOS_PLAYWRIGHT_CLI to a supported executable.',
  };
}

export function runPlaywrightCli(runtime, args, options = {}) {
  return spawnSync(runtime.path, args, {
    encoding: 'utf8',
    env: options.env || process.env,
    maxBuffer: options.maxBuffer || 100 * 1024 * 1024,
  });
}
