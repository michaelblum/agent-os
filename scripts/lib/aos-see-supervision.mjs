import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const aosSeeChildRunnerPath = fileURLToPath(new URL('./aos-see-child-runner.mjs', import.meta.url));

export function aosSeeGuardianEnvironment(env, ownerPID, executablePath) {
  return {
    ...env,
    AOS_INTERNAL_SEE_OWNER_PID: String(ownerPID),
    AOS_PATH: executablePath,
  };
}

export function retireAosSeeProcessGroup(guardianPID, signal = 'SIGKILL') {
  if (!Number.isSafeInteger(guardianPID) || guardianPID <= 1) return false;
  try {
    process.kill(-guardianPID, signal);
    return true;
  } catch (error) {
    if (error?.code === 'ESRCH') return false;
    throw error;
  }
}

export function runNativeSeeSync({
  primitive,
  args,
  executablePath,
  env = process.env,
  maxBuffer = 100 * 1024 * 1024,
}) {
  const result = spawnSync(process.execPath, [aosSeeChildRunnerPath, primitive, ...args], {
    detached: true,
    encoding: 'utf8',
    env: aosSeeGuardianEnvironment(env, process.ppid, executablePath),
    maxBuffer,
  });
  if (result.signal !== null || result.error) retireAosSeeProcessGroup(result.pid);
  return result;
}
