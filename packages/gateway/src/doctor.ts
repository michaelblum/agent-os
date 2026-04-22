import { existsSync, readFileSync, statSync, readdirSync } from 'node:fs';
import { dirname, basename } from 'node:path';
import Database from 'better-sqlite3';
import { brokerPaths, mcpPaths, commonPaths } from './paths.js';
import { stateRoot, type RuntimeMode } from './mode.js';

export interface ProcessBlock {
  role: 'mcp' | 'broker';
  pidfile: { path: string; pid: number | null; alive: boolean | null };
  log: { path: string; size_bytes: number; rotations: number; tail?: string[] };
  socket?: { path: string; exists: boolean; stat?: { mtime: string; size: number } };
}

export interface DoctorReport {
  mode: RuntimeMode;
  state_root: string;
  state_dir: string;
  scripts_dir: string;
  db: {
    path: string;
    size_bytes: number;
    row_counts?: {
      sessions: number;
      state: number;
      messages: number;
      integration_jobs: number;
      locks_held: number;
    };
    integrity?: 'ok' | string;
  };
  processes: { mcp: ProcessBlock; broker: ProcessBlock };
  sessions?: Array<{ name: string; role: string; harness: string; last_seen: string }>;
  lock_holders?: Array<{ key: string; owner: string; acquired: string; ttl: number | null }>;
  warnings: string[];
  exit_code: 0 | 1 | 2;
}

export interface CollectOptions {
  quick?: boolean;
  tail?: number;
}

function readPidfile(path: string): { pid: number | null; alive: boolean | null } {
  if (!existsSync(path)) return { pid: null, alive: null };
  try {
    const raw = readFileSync(path, 'utf8').trim();
    const pid = Number.parseInt(raw, 10);
    if (!Number.isFinite(pid) || pid <= 0) return { pid: null, alive: null };
    try {
      process.kill(pid, 0);
      return { pid, alive: true };
    } catch (err: any) {
      if (err?.code === 'EPERM') return { pid, alive: true };
      return { pid, alive: false };
    }
  } catch {
    return { pid: null, alive: null };
  }
}

function readLog(path: string, tail?: number) {
  if (!existsSync(path)) {
    return { path, size_bytes: 0, rotations: 0 };
  }
  const size_bytes = statSync(path).size;
  let rotations = 0;
  const dir = dirname(path);
  const base = basename(path);
  try {
    for (const name of readdirSync(dir)) {
      if (name.startsWith(base + '.')) rotations += 1;
    }
  } catch {}
  let tailLines: string[] | undefined;
  if (tail && tail > 0) {
    try {
      const all = readFileSync(path, 'utf8').split('\n').filter((l) => l.length > 0);
      tailLines = all.slice(-tail);
    } catch {}
  }
  return tail ? { path, size_bytes, rotations, tail: tailLines ?? [] } : { path, size_bytes, rotations };
}

function mcpBlock(env: NodeJS.ProcessEnv, mode: RuntimeMode, opts: CollectOptions, warnings: string[]): ProcessBlock {
  const paths = mcpPaths(mode, env);
  const pidfile = { path: paths.pidPath, ...readPidfile(paths.pidPath) };
  if (pidfile.alive === false) warnings.push(`mcp pidfile ${paths.pidPath} references dead process ${pidfile.pid}`);
  if (pidfile.alive === null) warnings.push(`mcp pidfile absent or unreadable at ${paths.pidPath}`);
  const socketExists = existsSync(paths.socketPath);
  if (!socketExists && pidfile.alive) warnings.push(`mcp socket missing at ${paths.socketPath} though pidfile is live`);
  const socket: ProcessBlock['socket'] = { path: paths.socketPath, exists: socketExists };
  if (socketExists) {
    try {
      const s = statSync(paths.socketPath);
      socket.stat = { mtime: s.mtime.toISOString(), size: s.size };
    } catch {}
  }
  return { role: 'mcp', pidfile, log: readLog(paths.logPath, opts.tail), socket };
}

function brokerBlock(env: NodeJS.ProcessEnv, mode: RuntimeMode, opts: CollectOptions, warnings: string[]): ProcessBlock {
  const paths = brokerPaths(mode, env);
  const pidfile = { path: paths.pidPath, ...readPidfile(paths.pidPath) };
  if (pidfile.alive === false) warnings.push(`broker pidfile ${paths.pidPath} references dead process ${pidfile.pid}`);
  if (pidfile.alive === null) warnings.push(`broker pidfile absent or unreadable at ${paths.pidPath}`);
  return { role: 'broker', pidfile, log: readLog(paths.logPath, opts.tail) };
}

export async function collectReport(
  mode: RuntimeMode,
  env: NodeJS.ProcessEnv,
  opts: CollectOptions = {},
): Promise<DoctorReport> {
  const common = commonPaths(mode, env);
  const warnings: string[] = [];

  const db: DoctorReport['db'] = {
    path: common.dbPath,
    size_bytes: existsSync(common.dbPath) ? statSync(common.dbPath).size : 0,
  };

  let sessions: DoctorReport['sessions'];
  let lock_holders: DoctorReport['lock_holders'];

  if (!opts.quick && existsSync(common.dbPath)) {
    let handle: Database.Database | undefined;
    try {
      handle = new Database(common.dbPath, { readonly: true, fileMustExist: true });
      const integrity = handle.pragma('integrity_check', { simple: true }) as string;
      db.integrity = integrity === 'ok' ? 'ok' : String(integrity);
      try {
        db.row_counts = {
          sessions: (handle.prepare('SELECT COUNT(*) AS n FROM sessions').get() as any)?.n ?? 0,
          state: (handle.prepare('SELECT COUNT(*) AS n FROM state').get() as any)?.n ?? 0,
          messages: (handle.prepare('SELECT COUNT(*) AS n FROM messages').get() as any)?.n ?? 0,
          integration_jobs: (handle.prepare('SELECT COUNT(*) AS n FROM integration_jobs').get() as any)?.n ?? 0,
          locks_held: (handle.prepare(
            "SELECT COUNT(*) AS n FROM state WHERE owner IS NOT NULL AND (expires_at IS NULL OR expires_at > CAST(strftime('%s','now') AS INTEGER) * 1000)",
          ).get() as any)?.n ?? 0,
        };
      } catch (err: any) {
        warnings.push(`db row_counts unavailable: ${err.message}`);
      }
    } catch (err: any) {
      db.integrity = err.message || 'open_failed';
    } finally {
      try { handle?.close(); } catch {}
    }
  }

  const mcp = mcpBlock(env, mode, opts, warnings);
  const broker = brokerBlock(env, mode, opts, warnings);

  let exit_code: 0 | 1 | 2 = 0;
  if (db.integrity && db.integrity !== 'ok') exit_code = 2;
  else if (warnings.length > 0) exit_code = 1;

  return {
    mode,
    state_root: stateRoot(env),
    state_dir: common.stateDir,
    scripts_dir: common.scriptsDir,
    db,
    processes: { mcp, broker },
    sessions,
    lock_holders,
    warnings,
    exit_code,
  };
}

export function renderText(r: DoctorReport): string {
  const lines: string[] = [];
  lines.push(`aos-gateway doctor  mode=${r.mode}  state_root=${r.state_root}`);
  lines.push(`state_dir=${r.state_dir}`);
  lines.push(`db=${r.db.path}  size=${r.db.size_bytes}B  integrity=${r.db.integrity ?? 'skipped'}`);
  if (r.db.row_counts) {
    const rc = r.db.row_counts;
    lines.push(
      `  row_counts: sessions=${rc.sessions} state=${rc.state} messages=${rc.messages} integration_jobs=${rc.integration_jobs} locks_held=${rc.locks_held}`,
    );
  }

  for (const [role, block] of Object.entries(r.processes) as Array<['mcp' | 'broker', ProcessBlock]>) {
    lines.push(`[${role}] pidfile=${block.pidfile.path} pid=${block.pidfile.pid ?? '-'} alive=${block.pidfile.alive ?? '-'}`);
    lines.push(`       log=${block.log.path} size=${block.log.size_bytes}B rotations=${block.log.rotations}`);
    if (block.socket) lines.push(`       socket=${block.socket.path} exists=${block.socket.exists}`);
    if (block.log.tail && block.log.tail.length > 0) {
      lines.push('       tail:');
      for (const t of block.log.tail) lines.push(`         ${t}`);
    }
  }

  if (r.warnings.length > 0) {
    lines.push(`warnings (${r.warnings.length}):`);
    for (const w of r.warnings) lines.push(`  - ${w}`);
  }
  lines.push(`exit_code=${r.exit_code}`);
  return lines.join('\n') + '\n';
}
