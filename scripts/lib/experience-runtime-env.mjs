import os from 'node:os';
import path from 'node:path';
import {
  runtimeMode,
} from './agent-workspace/core.mjs';

function envValue(env, key) {
  const value = env[key];
  return typeof value === 'string' && value && !value.startsWith('$') ? value : null;
}

export function experienceRuntimeEnv({
  env = process.env,
  repoRoot = process.cwd(),
} = {}) {
  const resolvedRepoRoot = path.resolve(repoRoot);
  const stateRoot = envValue(env, 'AOS_STATE_ROOT')
    ? path.resolve(envValue(env, 'AOS_STATE_ROOT'))
    : path.join(os.homedir(), '.config', 'aos');
  const mode = runtimeMode(env);
  const aos = envValue(env, 'AOS_PATH')
    ? envValue(env, 'AOS_PATH')
    : path.join(resolvedRepoRoot, 'aos');
  const experiencesRoot = envValue(env, 'AOS_EXPERIENCES_DIR')
    ? path.resolve(envValue(env, 'AOS_EXPERIENCES_DIR'))
    : path.join(resolvedRepoRoot, 'experiences');
  const stateDir = path.join(stateRoot, mode);
  const normalizedEnv = {
    ...env,
    AOS_EXPERIENCES_DIR: experiencesRoot,
    AOS_PATH: aos,
    AOS_RUNTIME_MODE: mode,
    AOS_STATE_ROOT: stateRoot,
  };
  return {
    aos,
    configPath: path.join(stateDir, 'config.json'),
    env: normalizedEnv,
    experienceStatePath: path.join(stateDir, 'experience-state.json'),
    experiencesRoot,
    legacyExperienceStatePath: path.join(stateRoot, 'experience-state.json'),
    mode,
    repoRoot: resolvedRepoRoot,
    stateDir,
    stateRoot,
  };
}
