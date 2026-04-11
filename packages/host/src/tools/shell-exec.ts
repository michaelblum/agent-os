// packages/host/src/tools/shell-exec.ts
import { execFile } from 'node:child_process';
import type { ToolDefinition, ToolExecutor, RegisteredTool } from '../types.ts';

const definition: ToolDefinition = {
  name: 'shell_exec',
  description: 'Execute a shell command. Use with caution.',
  inputSchema: {
    type: 'object',
    properties: {
      command: { type: 'string', description: 'The shell command to execute' },
    },
    required: ['command'],
  },
  permissions: { default: 'deny', dangerous: true },
  timeout: 30_000,
  metadata: { type: 'simple', source: 'builtin' },
};

const executor: ToolExecutor = async (input, context) => {
  const { command } = input as { command: string };

  return new Promise((resolve) => {
    const child = execFile('/bin/sh', ['-c', command], {
      timeout: 30_000,
      maxBuffer: 1024 * 1024,
      signal: context.signal,
    }, (error, stdout, stderr) => {
      if (error && error.name === 'AbortError') {
        resolve({ content: 'Command aborted', isError: true });
        return;
      }

      const exitCode = error ? ((error as any).code ?? 1) : 0;

      resolve({
        content: { stdout, stderr, exitCode },
        isError: exitCode !== 0,
      });
    });
  });
};

export const shellExecTool: RegisteredTool = { definition, executor };
