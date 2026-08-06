import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';

export const MIN_PLAYWRIGHT_CLI_VERSION = '0.1.8';
export const OBSERVATION_REF_IDENTITY_REVIEWED_VERSION = '0.1.15';
const MAX_OBSERVATION_IDENTITY_PACKAGES = 256;
const MAX_OBSERVATION_IDENTITY_FILES = 50_000;
const MAX_OBSERVATION_IDENTITY_BYTES = 512 * 1024 * 1024;

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

function packageMetadataFromPath(candidatePath, expectedName = null) {
  let dir = path.dirname(candidatePath);
  for (let i = 0; i < 20; i += 1) {
    const pkg = path.join(dir, 'package.json');
    try {
      const parsed = JSON.parse(fs.readFileSync(pkg, 'utf8'));
      if (
        (!expectedName || parsed?.name === expectedName)
        && typeof parsed?.name === 'string'
        && typeof parsed.version === 'string'
      ) {
        return {
          path: fs.realpathSync(pkg),
          root: fs.realpathSync(dir),
          name: parsed.name,
          version: parsed.version,
          parsed,
        };
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

function packageMetadata(binaryPath) {
  return packageMetadataFromPath(resolveSymlinks(binaryPath), '@playwright/cli');
}

function packageVersion(binaryPath) {
  return packageMetadata(binaryPath)?.version ?? null;
}

function sha256File(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function hashPackageTree(root, budget) {
  const hash = crypto.createHash('sha256');
  function visit(directory, relativeDirectory = '') {
    const entries = fs.readdirSync(directory, { withFileTypes: true })
      .filter((entry) => entry.name !== 'node_modules')
      .sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      const relative = path.posix.join(relativeDirectory, entry.name);
      const absolute = path.join(directory, entry.name);
      const stat = fs.lstatSync(absolute);
      if (entry.isSymbolicLink()) {
        throw new Error(`browser Observation Ref package closure contains unsupported symlink: ${relative}`);
      }
      hash.update(`${entry.isDirectory() ? 'd' : 'f'}\0${relative}\0${stat.mode & 0o777}\0`);
      if (entry.isDirectory()) {
        visit(absolute, relative);
        continue;
      }
      if (!entry.isFile()) {
        throw new Error(`browser Observation Ref package closure contains unsupported entry: ${relative}`);
      }
      budget.files += 1;
      if (budget.files > MAX_OBSERVATION_IDENTITY_FILES) {
        throw new Error(`browser Observation Ref package closure exceeds ${MAX_OBSERVATION_IDENTITY_FILES} files`);
      }
      const contents = fs.readFileSync(absolute);
      if (contents.length !== stat.size) {
        throw new Error(`browser Observation Ref package changed while fingerprinting: ${relative}`);
      }
      budget.bytes += contents.length;
      if (budget.bytes > MAX_OBSERVATION_IDENTITY_BYTES) {
        throw new Error(`browser Observation Ref package closure exceeds ${MAX_OBSERVATION_IDENTITY_BYTES} bytes`);
      }
      hash.update(`${contents.length}\0`);
      hash.update(contents);
      hash.update('\0');
    }
  }
  visit(root);
  return hash.digest('hex');
}

function dependencyMetadata(owner, dependency) {
  const requireFromOwner = createRequire(owner.path);
  try {
    const packageJSON = requireFromOwner.resolve(`${dependency}/package.json`);
    return packageMetadataFromPath(packageJSON, dependency);
  } catch {
    try {
      const entry = requireFromOwner.resolve(dependency);
      return packageMetadataFromPath(fs.realpathSync(entry), dependency);
    } catch {
      return null;
    }
  }
}

function packageClosureIdentity(rootPackage) {
  const packages = [];
  const edges = [];
  const visited = new Set();
  const budget = { files: 0, bytes: 0 };

  function visit(metadata) {
    if (visited.has(metadata.root)) return;
    visited.add(metadata.root);
    if (visited.size > MAX_OBSERVATION_IDENTITY_PACKAGES) {
      throw new Error(`browser Observation Ref package closure exceeds ${MAX_OBSERVATION_IDENTITY_PACKAGES} packages`);
    }
    packages.push({
      name: metadata.name,
      version: metadata.version,
      root_realpath: metadata.root,
      tree_sha256: hashPackageTree(metadata.root, budget),
    });

    const required = { ...(metadata.parsed.dependencies ?? {}) };
    const optional = { ...(metadata.parsed.optionalDependencies ?? {}) };
    const peers = { ...(metadata.parsed.peerDependencies ?? {}) };
    const dependencyNames = [...new Set([
      ...Object.keys(required), ...Object.keys(optional), ...Object.keys(peers),
    ])].sort();
    for (const dependency of dependencyNames) {
      const resolved = dependencyMetadata(metadata, dependency);
      const isOptional = Object.hasOwn(optional, dependency)
        || metadata.parsed.peerDependenciesMeta?.[dependency]?.optional === true;
      if (!resolved) {
        if (!isOptional && (Object.hasOwn(required, dependency) || Object.hasOwn(peers, dependency))) {
          throw new Error(`browser Observation Ref package dependency is unresolved: ${metadata.name} -> ${dependency}`);
        }
        edges.push({ from: metadata.root, dependency, resolution: 'absent_optional' });
        continue;
      }
      edges.push({ from: metadata.root, dependency, to: resolved.root });
      visit(resolved);
    }
  }

  visit(rootPackage);
  packages.sort((left, right) => left.root_realpath.localeCompare(right.root_realpath));
  edges.sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)));
  return crypto.createHash('sha256')
    .update(JSON.stringify({ packages, edges }))
    .digest('hex');
}

function repoWrapperPinnedVersion(executablePath, source) {
  if (source !== 'repo:scripts/aos-playwright-cli') return null;
  try {
    const contents = fs.readFileSync(executablePath, 'utf8');
    return contents.match(/@playwright\/cli@([0-9]+\.[0-9]+\.[0-9]+)/)?.[1] ?? null;
  } catch {
    return null;
  }
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
  const pkgVersion = packageVersion(executablePath) ?? repoWrapperPinnedVersion(executablePath, source);
  let version = pkgVersion;
  let versionSource = pkgVersion
    ? (source === 'repo:scripts/aos-playwright-cli' ? 'repo-wrapper-pin' : 'package.json')
    : 'binary-version';
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

export function reviewedObservationRuntimeIdentity(runtime) {
  if (runtime?.status !== 'ok' || runtime.version !== OBSERVATION_REF_IDENTITY_REVIEWED_VERSION) {
    throw new Error(`reviewed @playwright/cli ${OBSERVATION_REF_IDENTITY_REVIEWED_VERSION} is required`);
  }
  if (runtime.version_source !== 'package.json') {
    throw new Error('browser Observation Ref identity requires package-backed runtime provenance');
  }
  const executableRealpath = fs.realpathSync(runtime.path);
  const pkg = packageMetadata(runtime.path);
  if (!pkg) throw new Error('browser Observation Ref package metadata is unavailable');
  return {
    schema_version: 'aos.browser-backend-identity.v1',
    adapter: '@playwright/cli',
    version: runtime.version,
    version_source: runtime.version_source,
    executable_realpath: executableRealpath,
    executable_sha256: sha256File(executableRealpath),
    package_root_realpath: pkg.root,
    package_closure_sha256: packageClosureIdentity(pkg),
  };
}

export function resolveReviewedObservationRuntime(options = {}) {
  const runtime = resolvePlaywrightCliRuntime(options);
  if (runtime.status !== 'ok') return runtime;
  if (runtime.version !== OBSERVATION_REF_IDENTITY_REVIEWED_VERSION) {
    return {
      ...runtime,
      status: 'unsupported',
      code: 'TARGET_ACTION_UNSUPPORTED',
      error: `browser Observation Ref actions require reviewed @playwright/cli ${OBSERVATION_REF_IDENTITY_REVIEWED_VERSION}; found ${runtime.version}`,
    };
  }
  try {
    return { ...runtime, observation_identity: reviewedObservationRuntimeIdentity(runtime) };
  } catch (error) {
    return {
      ...runtime,
      status: 'unsupported',
      code: 'TARGET_ACTION_UNSUPPORTED',
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export function runPlaywrightCli(runtime, args, options = {}) {
  return spawnSync(runtime.path, args, {
    encoding: 'utf8',
    env: options.env || process.env,
    maxBuffer: options.maxBuffer || 100 * 1024 * 1024,
  });
}
