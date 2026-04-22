import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

export type RuntimeMode = 'repo' | 'installed';

export function detectMode(scriptPath: string, env: NodeJS.ProcessEnv = process.env): RuntimeMode {
  const envMode = env.AOS_RUNTIME_MODE?.toLowerCase();
  if (envMode === 'repo' || envMode === 'installed') return envMode;

  if (looksLikeRepo(scriptPath)) return 'repo';
  if (looksLikeInstalled(scriptPath, env)) return 'installed';

  process.stderr.write('aos-gateway: could not infer runtime mode, defaulting to installed\n');
  return 'installed';
}

function looksLikeRepo(scriptPath: string): boolean {
  let dir = dirname(resolve(scriptPath));
  let nearestPackage: string | undefined;

  while (dir !== dirname(dir)) {
    const candidate = join(dir, 'package.json');
    if (!nearestPackage && existsSync(candidate)) nearestPackage = candidate;
    if (existsSync(join(dir, '.git'))) {
      if (!nearestPackage) return false;
      try {
        const pkg = JSON.parse(readFileSync(nearestPackage, 'utf8'));
        return pkg.name === '@agent-os/gateway';
      } catch {
        return false;
      }
    }
    dir = dirname(dir);
  }
  return false;
}

function looksLikeInstalled(scriptPath: string, env: NodeJS.ProcessEnv): boolean {
  if (scriptPath.includes('.app/Contents/')) return true;
  const installPath = env.AOS_INSTALL_PATH;
  if (installPath && scriptPath.startsWith(resolve(installPath))) return true;
  return false;
}

export function stateRoot(env: NodeJS.ProcessEnv = process.env): string {
  const override = env.AOS_STATE_ROOT;
  if (override && override.length > 0) return resolve(override);
  return join(homedir(), '.config', 'aos');
}

export function hasExplicitStateRootOverride(env: NodeJS.ProcessEnv = process.env): boolean {
  const override = env.AOS_STATE_ROOT;
  if (!override || override.length === 0) return false;
  return resolve(override) !== join(homedir(), '.config', 'aos');
}
