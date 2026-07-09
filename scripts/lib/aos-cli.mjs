import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export function sanitizeForJSON(value) {
  if (Array.isArray(value)) return value.map(sanitizeForJSON);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value)
      .filter(([, child]) => child !== undefined)
      .map(([key, child]) => [key, sanitizeForJSON(child)]));
  }
  return value;
}

export function omitNulls(value) {
  if (Array.isArray(value)) return value.map(omitNulls);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value)
      .filter(([, item]) => item !== null && item !== undefined)
      .map(([key, item]) => [key, omitNulls(item)]),
  );
}

export function printJSON(value, { omit = false } = {}) {
  const printable = omit ? omitNulls(value) : sanitizeForJSON(value);
  process.stdout.write(`${JSON.stringify(printable, null, 2)}\n`);
}

export function exitError(message, code) {
  process.stderr.write(`{\n  "code" : "${code}",\n  "error" : "${message}"\n}\n`);
  process.exit(1);
}

export function repoRoot() {
  if (process.env.AOS_REPO_ROOT) return path.resolve(process.env.AOS_REPO_ROOT);
  const scriptDir = path.dirname(new URL(import.meta.url).pathname);
  return path.resolve(scriptDir, '..', '..');
}

function resolveGitPath(root, value) {
  if (!value) return undefined;
  return path.resolve(root, value);
}

function gitOutput(root, args) {
  const result = spawnSync('/usr/bin/git', ['-C', root, ...args], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (result.status !== 0) return undefined;
  return result.stdout.trim() || undefined;
}

export function repoGitWorktreeFacts(root = repoRoot(), env = process.env) {
  if (env.AOS_TEST_FORCE_LINKED_WORKTREE === '1') {
    const canonicalRoot = env.AOS_TEST_CANONICAL_REPO_ROOT
      ? path.resolve(env.AOS_TEST_CANONICAL_REPO_ROOT)
      : root;
    return {
      repo_root: root,
      git_dir: path.join(canonicalRoot, '.git', 'worktrees', path.basename(root) || 'agent-os-worktree'),
      git_common_dir: path.join(canonicalRoot, '.git'),
      linked_worktree: true,
      forced: true,
    };
  }

  const gitDir = resolveGitPath(root, gitOutput(root, ['rev-parse', '--git-dir']));
  const gitCommonDir = resolveGitPath(root, gitOutput(root, ['rev-parse', '--git-common-dir']));
  if (!gitDir || !gitCommonDir) {
    return {
      repo_root: root,
      linked_worktree: false,
      unavailable_reason: 'git metadata unavailable',
    };
  }
  return {
    repo_root: root,
    git_dir: gitDir,
    git_common_dir: gitCommonDir,
    linked_worktree: gitDir !== gitCommonDir,
  };
}

export function defaultStateRoot(env = process.env) {
  const home = env.HOME || os.homedir();
  return path.resolve(home, '.config/aos');
}

export function explicitStateRootOverride(env = process.env) {
  if (!env.AOS_STATE_ROOT) return false;
  if (env.AOS_TEST_CLASSIFY_STATE_ROOT_AS_NORMAL === '1') return false;
  return path.resolve(env.AOS_STATE_ROOT) !== defaultStateRoot(env);
}

export function agentOSWorktreePolicy({ mode = currentMode(), root = repoRoot(), env = process.env } = {}) {
  if (mode !== 'repo') return { allowed: true, reason: 'not_repo_mode' };
  if (explicitStateRootOverride(env)) return { allowed: true, reason: 'explicit_state_root', state_root: path.resolve(env.AOS_STATE_ROOT) };

  const facts = repoGitWorktreeFacts(root, env);
  if (!facts.linked_worktree) return { allowed: true, reason: 'primary_checkout', worktree: facts };
  return {
    allowed: false,
    id: 'agent_os_worktree_default_runtime',
    reason: 'linked_git_worktree_default_runtime_forbidden',
    message: 'agent-os linked git worktrees cannot use the default repo runtime. Run AOS from the primary checkout, or set an explicit AOS_STATE_ROOT for isolated runtime tests.',
    worktree: facts,
  };
}

export function aosPath() {
  return process.env.AOS_PATH || path.join(repoRoot(), 'aos');
}

export function invocationName() {
  return process.env.AOS_INVOCATION_DISPLAY_NAME || './aos';
}

export function currentMode() {
  const override = process.env.AOS_RUNTIME_MODE?.toLowerCase();
  if (override === 'repo' || override === 'installed') return override;
  return 'repo';
}

export function installAppPath() {
  return process.env.AOS_INSTALL_PATH || path.join(os.homedir(), 'Applications/AOS.app');
}

export function expectedBinaryPath(mode = currentMode()) {
  if (process.env.AOS_SERVICE_BINARY) return path.resolve(process.env.AOS_SERVICE_BINARY);
  if (mode === 'installed') return path.join(installAppPath(), 'Contents/MacOS/aos');
  return path.join(repoRoot(), 'aos');
}

export function run(executable, args, options = {}) {
  const result = spawnSync(executable, args, {
    cwd: options.cwd ?? repoRoot(),
    env: options.env ?? process.env,
    encoding: 'utf8',
  });
  return {
    exitCode: result.status ?? 127,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? (result.error ? `${result.error.message}\n` : ''),
  };
}

export function parseJSONOutput(result, label, {
  failureCode = 'PRIMITIVE_FAILED',
  jsonCode = 'PRIMITIVE_JSON_INVALID',
  requireZeroExit = true,
} = {}) {
  if (requireZeroExit && result.exitCode !== 0) {
    const detail = (result.stderr || result.stdout).trim();
    exitError(`${label} failed${detail ? `: ${detail}` : ''}`, failureCode);
  }
  try {
    return JSON.parse(result.stdout);
  } catch {
    const detail = !requireZeroExit ? (result.stderr || result.stdout).trim() : '';
    exitError(`${label} did not return JSON${detail ? `: ${detail}` : ''}`, jsonCode);
  }
}

export function runAOS(args) {
  return run(aosPath(), args, {
    env: { ...process.env, AOS_RUNTIME_MODE: currentMode() },
  });
}

export function runNodeScript(script, args) {
  return run('/usr/bin/env', ['node', script, ...args], {
    env: {
      ...process.env,
      AOS_RUNTIME_MODE: currentMode(),
      AOS_PATH: aosPath(),
      AOS_INVOCATION_DISPLAY_NAME: invocationName(),
    },
  });
}

export function compactProcessDetail(output) {
  const combined = [output.stderr, output.stdout]
    .map((part) => String(part || '').trim())
    .filter(Boolean)
    .join('\n')
    .trim();
  if (!combined) return undefined;

  try {
    const object = JSON.parse(combined);
    if (object.error && typeof object.error === 'object') {
      const code = object.error.code ?? 'unknown';
      const message = object.error.message ?? '';
      return message ? `error=${code}: ${message}` : `error=${code}`;
    }
    const parts = [
      object.status ? `status=${object.status}` : null,
      object.reason ? `reason=${object.reason}` : null,
      object.input_tap?.status ? `tap=${object.input_tap.status}` : null,
      object.input_tap?.attempts !== undefined ? `attempts=${object.input_tap.attempts}` : null,
    ].filter(Boolean);
    if (parts.length) return parts.join(' ');
  } catch {
    // Fall through to clipped text.
  }

  const clipped = combined.split(/\r?\n/).slice(0, 6).join('\n');
  return clipped.length <= 700 ? clipped : `${clipped.slice(0, 700)}...`;
}

export function repoCommitShort() {
  const result = run('/usr/bin/git', ['-C', repoRoot(), 'rev-parse', '--short', 'HEAD']);
  return result.exitCode === 0 ? result.stdout.trim() : undefined;
}

export function binaryTimestamp(file) {
  try {
    return fs.statSync(file).mtime.toISOString().replace(/\.\d{3}Z$/, 'Z');
  } catch {
    return undefined;
  }
}

export function binaryCDHash(file) {
  const result = run('/usr/bin/codesign', ['-dvvv', file]);
  if (result.exitCode !== 0) return undefined;
  const match = `${result.stdout}\n${result.stderr}`.match(/^CDHash=(\S+)/m);
  return match?.[1];
}

export function binaryFileIdentity(file) {
  try {
    const stat = fs.statSync(file);
    return {
      path: file,
      exists: true,
      mtime: stat.mtime.toISOString().replace(/\.\d{3}Z$/, 'Z'),
      mtime_ms: stat.mtimeMs,
      size_bytes: stat.size,
      cdhash: binaryCDHash(file),
    };
  } catch {
    return {
      path: file,
      exists: false,
    };
  }
}
