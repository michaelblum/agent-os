// packages/host/src/tools/read-file.ts
import fs from 'node:fs/promises';
import type { ToolDefinition, ToolExecutor, RegisteredTool } from '../types.ts';

export const MAX_READ_FILE_BYTES = 1024 * 1024;
const READ_FILE_TIMEOUT_MS = 30_000;

const definition: ToolDefinition = {
  name: 'read_file',
  description: 'Read the contents of a file at the given path.',
  inputSchema: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'Absolute path to the file to read' },
    },
    required: ['path'],
  },
  permissions: { default: 'allow' },
  timeout: READ_FILE_TIMEOUT_MS,
  metadata: { type: 'simple', source: 'builtin' },
};

function boundedSignal(signal: AbortSignal): AbortSignal {
  return AbortSignal.any([signal, AbortSignal.timeout(READ_FILE_TIMEOUT_MS)]);
}

const executor: ToolExecutor = async (input, context) => {
  const { path: filePath } = input as { path: string };
  try {
    const signal = boundedSignal(context.signal);
    if (signal.aborted) {
      return { content: 'Read aborted', isError: true };
    }

    const stat = await fs.stat(filePath);
    if (!stat.isFile()) {
      return { content: 'Path is not a regular file', isError: true };
    }
    if (stat.size > MAX_READ_FILE_BYTES) {
      return {
        content: `File exceeds read_file limit of ${MAX_READ_FILE_BYTES} bytes`,
        isError: true,
      };
    }

    const content = await fs.readFile(filePath, { encoding: 'utf-8', signal });
    return { content };
  } catch (err: any) {
    if (err?.name === 'AbortError') {
      return { content: 'Read aborted', isError: true };
    }
    return { content: err.message, isError: true };
  }
};

export const readFileTool: RegisteredTool = { definition, executor };
