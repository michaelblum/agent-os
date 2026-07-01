import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const SCHEMA_VERSION = 'aos.agent-workspace.v0';
export const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/;
export const CAPTURE_MODES = new Set(['ax', 'vision', 'som']);
export const JSON_SPACING = 2;

export const DO_VALUE_FLAGS = new Set([
  '--pid', '--role', '--title', '--label', '--identifier',
  '--index', '--near', '--match', '--depth', '--timeout',
  '--profile', '--value', '--to', '--dy', '--dx', '--window',
  '--delay', '--variance', '--dwell', '--steps', '--speed',
  '--state-id', '--by', '--to-value', '--playback',
  '--workspace', '--snapshot',
]);

export function runtimeMode(env = process.env) {
  return env.AOS_RUNTIME_MODE?.toLowerCase() === 'installed' ? 'installed' : 'repo';
}

export function stateRoot(env = process.env) {
  return path.resolve(env.AOS_STATE_ROOT || path.join(os.homedir(), '.config/aos'));
}

export function stateDir(env = process.env) {
  return path.join(stateRoot(env), runtimeMode(env));
}

export function agentWorkspacesRoot(env = process.env) {
  return path.join(stateDir(env), 'agent-workspaces');
}

export function aosPath(env = process.env) {
  return env.AOS_PATH || './aos';
}

export function nowISO() {
  return new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
}

export function randomToken() {
  return Math.random().toString(36).slice(2, 10);
}

export function printJSON(value) {
  process.stdout.write(`${JSON.stringify(value, null, JSON_SPACING)}\n`);
}

export function printError(value) {
  process.stderr.write(`${JSON.stringify(value, null, JSON_SPACING)}\n`);
}

export function exitAgentWorkspaceError(message, code, extra = {}) {
  printError({
    code,
    error: message,
    ...extra,
  });
  process.exit(1);
}

function sortObject(value) {
  if (Array.isArray(value)) return value.map(sortObject);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, sortObject(value[key])]));
  }
  return value;
}

export function readJSON(file, fallback = null) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

export function readJSONExisting(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    exitAgentWorkspaceError(`Workspace state is corrupt or unreadable: ${file}`, 'AGENT_WORKSPACE_STATE_CORRUPT', { path: file });
  }
}

export function writeJSONAtomic(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp-${process.pid}-${randomToken()}`;
  fs.writeFileSync(tmp, `${JSON.stringify(sortObject(value), null, JSON_SPACING)}\n`);
  fs.renameSync(tmp, file);
}

export function writeTextAtomic(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp-${process.pid}-${randomToken()}`;
  fs.writeFileSync(tmp, value);
  fs.renameSync(tmp, file);
}

export function validateLocalID(value, label = 'id') {
  if (typeof value !== 'string' || value.length === 0) {
    exitAgentWorkspaceError(`${label} is required`, 'INVALID_ID');
  }
  if (value !== value.trim()) {
    exitAgentWorkspaceError(`${label} must not contain leading or trailing whitespace`, 'INVALID_ID');
  }
  if (value === '.' || value === '..' || /^\.+$/.test(value)) {
    exitAgentWorkspaceError(`${label} must not be dot-only`, 'INVALID_ID');
  }
  if (!SAFE_ID.test(value)) {
    exitAgentWorkspaceError(
      `${label} must match ${SAFE_ID.source} and use only ASCII letters, numbers, dot, underscore, or dash`,
      'INVALID_ID',
    );
  }
  return value;
}

export function workspaceID(explicit, env = process.env) {
  return validateLocalID(explicit || env.AOS_AGENT_WORKSPACE || 'default', 'workspace id');
}

export function workspaceDir(workspace, env = process.env) {
  return path.join(agentWorkspacesRoot(env), validateLocalID(workspace, 'workspace id'));
}

export function assertUnderWorkspacesRoot(candidate, env = process.env) {
  const root = path.resolve(agentWorkspacesRoot(env));
  const resolved = path.resolve(candidate);
  if (resolved !== root && !resolved.startsWith(`${root}${path.sep}`)) {
    exitAgentWorkspaceError('Refusing path outside AOS agent workspaces state root', 'UNSAFE_STATE_PATH');
  }
  return resolved;
}

export function sessionMetadata(env = process.env) {
  const sessionID = env.AOS_SESSION_ID || env.CODEX_THREAD_ID || env.CLAUDE_CODE_SSE_PORT || null;
  return {
    id: sessionID,
    mode: sessionID ? 'session_scoped' : 'anonymous_global',
    harness: env.AOS_SESSION_HARNESS || (env.CODEX_THREAD_ID ? 'codex' : (env.CLAUDE_CODE_SSE_PORT ? 'claude-code' : 'unknown')),
  };
}

export function defaultWorkspaceMetadata(workspace, env = process.env) {
  return {
    schema_version: SCHEMA_VERSION,
    workspace_id: workspace,
    runtime_mode: runtimeMode(env),
    state_root: stateRoot(env),
    workspace_dir: workspaceDir(workspace, env),
    created_at: nowISO(),
    updated_at: nowISO(),
    retention: {
      policy: 'local_until_explicit_cleanup',
      cleanup_commands: [
        'aos see workspace prune <id> --older-than <duration> --dry-run --json',
        'aos see snapshot delete <snapshot-id> --workspace <id> --i-understand-local-artifacts --json',
        'aos see workspace delete <id> --i-understand-local-artifacts --json',
      ],
    },
    session: sessionMetadata(env),
  };
}

export function directoryBytes(dir) {
  if (!fs.existsSync(dir)) return 0;
  let total = 0;
  const stack = [dir];
  while (stack.length) {
    const current = stack.pop();
    const stat = fs.lstatSync(current);
    if (stat.isSymbolicLink()) {
      total += stat.size;
      continue;
    }
    if (stat.isDirectory()) {
      for (const entry of fs.readdirSync(current)) stack.push(path.join(current, entry));
      continue;
    }
    total += stat.size;
  }
  return total;
}
