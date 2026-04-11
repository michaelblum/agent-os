// packages/host/test/tools/shell-exec.test.ts
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { shellExecTool } from '../../src/tools/shell-exec.ts';

describe('shell_exec tool', () => {
  const ctx = {
    sessionId: 'test',
    signal: AbortSignal.timeout(5000),
    emit: () => {},
  };

  it('has correct definition', () => {
    assert.equal(shellExecTool.definition.name, 'shell_exec');
    assert.equal(shellExecTool.definition.permissions?.default, 'deny');
    assert.equal(shellExecTool.definition.permissions?.dangerous, true);
  });

  it('executes a command', async () => {
    const result = await shellExecTool.executor({ command: 'echo hello' }, ctx);
    const output = result.content as { stdout: string; stderr: string; exitCode: number };
    assert.equal(output.stdout.trim(), 'hello');
    assert.equal(output.exitCode, 0);
  });

  it('captures stderr', async () => {
    const result = await shellExecTool.executor({ command: 'echo err >&2' }, ctx);
    const output = result.content as { stdout: string; stderr: string; exitCode: number };
    assert.equal(output.stderr.trim(), 'err');
  });

  it('captures non-zero exit code', async () => {
    const result = await shellExecTool.executor({ command: 'exit 42' }, ctx);
    const output = result.content as { stdout: string; stderr: string; exitCode: number };
    assert.equal(output.exitCode, 42);
    assert.equal(result.isError, true);
  });

  it('respects timeout from tool definition', async () => {
    const result = await shellExecTool.executor(
      { command: 'sleep 10' },
      { ...ctx, signal: AbortSignal.timeout(500) }
    );
    assert.equal(result.isError, true);
  });
});
