import { existsSync, mkdirSync, readdirSync, renameSync, rmdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { hasExplicitStateRootOverride } from './mode.js';

export interface MigrateResult {
  migrated: boolean;
  skipped?: 'no-legacy' | 'explicit-state-root-override';
}

export interface MigrateOptions {
  legacyDir: string;
  target: string;
  env: NodeJS.ProcessEnv;
  exitFn?: (code: number) => never;
}

const SUBSTANTIVE_FILES = [
  'gateway.db', 'gateway.db-wal', 'gateway.db-shm', 'sdk.sock',
  'gateway.pid', 'broker.pid', 'gateway.log', 'broker.log',
];

export function defaultLegacyDir(): string {
  return join(homedir(), '.config', 'aos-gateway');
}

export function hasSubstantiveFiles(dir: string): boolean {
  if (!existsSync(dir)) return false;
  for (const name of SUBSTANTIVE_FILES) {
    if (existsSync(join(dir, name))) return true;
  }
  const scripts = join(dir, 'scripts');
  if (existsSync(scripts)) {
    try {
      if (readdirSync(scripts).length > 0) return true;
    } catch {}
  }
  return false;
}

export function migrate(opts: MigrateOptions): MigrateResult {
  const exit = opts.exitFn ?? (((code: number) => { process.exit(code); }) as (code: number) => never);

  if (!existsSync(opts.legacyDir)) {
    return { migrated: false, skipped: 'no-legacy' };
  }

  if (hasSubstantiveFiles(opts.target)) {
    process.stderr.write(
      `aos-gateway: legacy state at ${opts.legacyDir} but target ${opts.target} has existing state; manual resolution needed\n`,
    );
    exit(1);
    throw new Error('unreachable');
  }

  if (!existsSync(opts.target)) mkdirSync(opts.target, { recursive: true });

  let entries: string[];
  try {
    entries = readdirSync(opts.legacyDir);
  } catch {
    entries = [];
  }

  for (const name of entries) {
    try {
      renameSync(join(opts.legacyDir, name), join(opts.target, name));
    } catch (err: any) {
      if (err?.code === 'ENOENT' || err?.code === 'EEXIST') continue;
      throw err;
    }
  }

  try {
    rmdirSync(opts.legacyDir);
  } catch (err: any) {
    if (err?.code !== 'ENOENT' && err?.code !== 'ENOTEMPTY') throw err;
  }

  process.stderr.write(`aos-gateway: migrated legacy state ${opts.legacyDir} → ${opts.target}\n`);
  return { migrated: true };
}

export interface MigrateFromEnvOptions {
  env: NodeJS.ProcessEnv;
  target: string;
  legacyDirOverride?: string;
  statFn?: (path: string) => unknown;
  exitFn?: (code: number) => never;
}

export function migrateFromEnv(opts: MigrateFromEnvOptions): MigrateResult {
  if (hasExplicitStateRootOverride(opts.env)) {
    return { migrated: false, skipped: 'explicit-state-root-override' };
  }
  const legacy = opts.legacyDirOverride ?? defaultLegacyDir();
  return migrate({ legacyDir: legacy, target: opts.target, env: opts.env, exitFn: opts.exitFn });
}
