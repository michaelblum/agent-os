import { spawn } from 'node:child_process';
import fs from 'node:fs';
import {
  experienceRuntimeEnv,
} from './experience-runtime-env.mjs';

function readJSONIfExists(file) {
  try {
    return { status: 'ok', value: JSON.parse(fs.readFileSync(file, 'utf8')) };
  } catch (error) {
    if (error?.code === 'ENOENT') return { status: 'missing', value: null };
    return { status: 'corrupt', value: null, error: error.message };
  }
}

function positiveInteger(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function probeTiming(env) {
  return {
    timeout: positiveInteger(env.AOS_EXPERIENCE_RUNTIME_PROBE_TIMEOUT_MS, 15000),
    killGrace: positiveInteger(env.AOS_EXPERIENCE_RUNTIME_PROBE_KILL_GRACE_MS, 500),
  };
}

function run(command, args, {
  cwd = process.cwd(),
  env = process.env,
  timeout = 15000,
  killGrace = 500,
} = {}) {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    let settled = false;
    let closed = false;
    let timedOut = false;
    let killTimer = null;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      clearTimeout(killTimer);
      resolve(value);
    };
    const timeoutResult = (extra = {}) => ({
      status: 124,
      stdout,
      stderr: stderr || `Timed out after ${timeout}ms`,
      timed_out: true,
      timeout_ms: timeout,
      ...extra,
    });
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
      killTimer = setTimeout(() => {
        if (!closed) child.kill('SIGKILL');
        finish(timeoutResult());
      }, killGrace);
    }, timeout);
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    child.on('error', (error) => {
      finish({
        status: 1,
        stdout,
        stderr: stderr || error.message,
      });
    });
    child.on('close', (status, signal) => {
      closed = true;
      if (timedOut) {
        finish(timeoutResult(signal ? { signal } : {}));
        return;
      }
      finish({
        status: status ?? 1,
        stdout,
        stderr,
        ...(signal ? { signal } : {}),
      });
    });
  });
}

async function runAosJSON(aos, args, {
  cwd = process.cwd(),
  env = process.env,
  mode = 'repo',
  timeout = 15000,
  killGrace = 500,
} = {}) {
  const result = await run(aos, args, {
    cwd,
    env: { ...env, AOS_RUNTIME_MODE: mode },
    timeout,
    killGrace,
  });
  if (result.status !== 0) {
    return {
      ok: false,
      status: result.timed_out ? 'timeout' : 'failed',
      exit_code: result.status,
      ...(result.timed_out ? { timeout_ms: result.timeout_ms } : {}),
      ...(result.signal ? { signal: result.signal } : {}),
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

function readActiveExperience(runtimeEnv) {
  for (const file of [runtimeEnv.experienceStatePath, runtimeEnv.legacyExperienceStatePath]) {
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
    source_path: runtimeEnv.experienceStatePath,
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

export async function collectExperienceRuntimeFacts({
  env = process.env,
  repoRoot = process.cwd(),
} = {}) {
  const runtimeEnv = experienceRuntimeEnv({ env, repoRoot });
  const normalizedEnv = runtimeEnv.env;
  const timing = probeTiming(normalizedEnv);
  const collectedAt = new Date().toISOString();
  const [
    serviceStatus,
    permissionStatus,
    contentStatus,
    showList,
  ] = await Promise.all([
    runAosJSON(runtimeEnv.aos, ['service', 'status', '--mode', runtimeEnv.mode, '--json'], {
      cwd: runtimeEnv.repoRoot,
      env: normalizedEnv,
      mode: runtimeEnv.mode,
      ...timing,
    }),
    runAosJSON(runtimeEnv.aos, ['permissions', 'check', '--json'], {
      cwd: runtimeEnv.repoRoot,
      env: normalizedEnv,
      mode: runtimeEnv.mode,
      ...timing,
    }),
    runAosJSON(runtimeEnv.aos, ['content', 'status', '--json'], {
      cwd: runtimeEnv.repoRoot,
      env: normalizedEnv,
      mode: runtimeEnv.mode,
      ...timing,
    }),
    runAosJSON(runtimeEnv.aos, ['show', 'list', '--json'], {
      cwd: runtimeEnv.repoRoot,
      env: normalizedEnv,
      mode: runtimeEnv.mode,
      ...timing,
    }),
  ]);
  return {
    collected_at: collectedAt,
    runtimeEnv,
    active: readActiveExperience(runtimeEnv),
    config: readRuntimeConfig(runtimeEnv.configPath),
    serviceStatus,
    permissionStatus,
    contentStatus,
    showList,
  };
}
