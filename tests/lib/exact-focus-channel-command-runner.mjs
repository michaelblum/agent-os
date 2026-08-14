import { spawnSync } from 'node:child_process';

export function createRunProgram({
  ProofError,
  commandClassTimeouts,
  proofEnvironment,
}) {
  const requireCondition = (condition, code) => {
    if (!condition) throw new ProofError(code);
  };
  return function runProgram(
    executable,
    args,
    { cwd, commandClass = 'local', maxBuffer = 64 * 1024 * 1024 } = {},
  ) {
    const timeout = commandClassTimeouts[commandClass];
    requireCondition(Number.isSafeInteger(timeout) && timeout > 0, 'COMMAND_CLASS_INVALID');
    const result = spawnSync(executable, args, {
      cwd,
      encoding: 'utf8',
      env: proofEnvironment(),
      killSignal: 'SIGKILL',
      maxBuffer,
      timeout,
    });
    if (result.error?.code === 'ETIMEDOUT') {
      throw new ProofError('COMMAND_TIMEOUT', { ambiguous: true });
    }
    if (result.error) throw new ProofError('COMMAND_LAUNCH_FAILED', { ambiguous: true });
    if (result.signal !== null || result.status === null) {
      throw new ProofError('COMMAND_INTERRUPTED', { ambiguous: true });
    }
    return result;
  };
}
