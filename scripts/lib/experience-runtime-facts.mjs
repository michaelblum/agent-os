import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {
  experienceEnvironment,
} from './experience-manifest.mjs';
import {
  stateDir as workspaceStateDir,
  stateRoot as workspaceStateRoot,
} from './agent-workspace/core.mjs';

function readJSONIfExists(file) {
  try {
    return { status: 'ok', value: JSON.parse(fs.readFileSync(file, 'utf8')) };
  } catch (error) {
    if (error?.code === 'ENOENT') return { status: 'missing', value: null };
    return { status: 'corrupt', value: null, error: error.message };
  }
}

function run(command, args, { env = process.env, timeout = 15000 } = {}) {
  const result = spawnSync(command, args, {
    cwd: process.cwd(),
    encoding: 'utf8',
    env,
    maxBuffer: 100 * 1024 * 1024,
    timeout,
  });
  return {
    status: result.status ?? 1,
    stdout: result.stdout || '',
    stderr: result.stderr || (result.error ? result.error.message : ''),
  };
}

function runAosJSON(aos, args, {
  env = process.env,
  mode = 'repo',
  timeout = 15000,
} = {}) {
  const result = run(aos, args, {
    env: { ...env, AOS_RUNTIME_MODE: mode },
    timeout,
  });
  if (result.status !== 0) {
    return {
      ok: false,
      status: 'failed',
      exit_code: result.status,
      error: (result.stderr || result.stdout).trim() || `aos ${args.join(' ')} failed`,
    };
  }
  try {
    return {
      ok: true,
      status: 'ok',
      value: JSON.parse(result.stdout),
    };
  } catch (error) {
    return {
      ok: false,
      status: 'invalid_json',
      exit_code: result.status,
      error: error.message,
    };
  }
}

function readActiveExperience(stateDirPath, stateRootPath) {
  const scoped = path.join(stateDirPath, 'experience-state.json');
  const legacy = path.join(stateRootPath, 'experience-state.json');
  for (const file of [scoped, legacy]) {
    const read = readJSONIfExists(file);
    if (read.status === 'ok') {
      return {
        id: read.value?.active_experience || null,
        source_path: file,
        source_status: 'ok',
      };
    }
    if (read.status === 'corrupt') {
      return {
        id: null,
        source_path: file,
        source_status: 'corrupt',
        error: read.error,
      };
    }
  }
  return {
    id: null,
    source_path: scoped,
    source_status: 'missing',
  };
}

function readRuntimeConfig(configFile) {
  const read = readJSONIfExists(configFile);
  return {
    status: read.status,
    path: configFile,
    value: read.value && typeof read.value === 'object' && !Array.isArray(read.value)
      ? read.value
      : {},
    error: read.error,
  };
}

export function collectExperienceRuntimeFacts({
  env = process.env,
  repoRoot = process.cwd(),
} = {}) {
  const runtimeEnv = experienceEnvironment({ env, repoRoot });
  const stateRootPath = workspaceStateRoot(env);
  const stateDirPath = workspaceStateDir(env);
  return {
    runtimeEnv,
    stateRootPath,
    stateDirPath,
    active: readActiveExperience(stateDirPath, stateRootPath),
    config: readRuntimeConfig(path.join(stateDirPath, 'config.json')),
    serviceStatus: runAosJSON(runtimeEnv.aos, ['service', 'status', '--mode', runtimeEnv.mode, '--json'], {
      env,
      mode: runtimeEnv.mode,
    }),
    permissionStatus: runAosJSON(runtimeEnv.aos, ['permissions', 'check', '--json'], {
      env,
      mode: runtimeEnv.mode,
    }),
    contentStatus: runAosJSON(runtimeEnv.aos, ['content', 'status', '--json'], {
      env,
      mode: runtimeEnv.mode,
    }),
    showList: runAosJSON(runtimeEnv.aos, ['show', 'list', '--json'], {
      env,
      mode: runtimeEnv.mode,
    }),
  };
}
