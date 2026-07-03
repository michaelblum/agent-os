// packages/host/src/tools/list-files.ts
import fs from 'node:fs/promises';
import type { ToolDefinition, ToolExecutor, RegisteredTool } from '../types.ts';

export const MAX_LIST_FILES_ENTRIES = 1000;
const LIST_FILES_TIMEOUT_MS = 30_000;

const definition: ToolDefinition = {
  name: 'list_files',
  description: 'List files and directories at the given path.',
  inputSchema: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'Absolute path to the directory to list' },
    },
    required: ['path'],
  },
  permissions: { default: 'allow' },
  timeout: LIST_FILES_TIMEOUT_MS,
  metadata: { type: 'simple', source: 'builtin' },
};

function boundedSignal(signal: AbortSignal): AbortSignal {
  return AbortSignal.any([signal, AbortSignal.timeout(LIST_FILES_TIMEOUT_MS)]);
}

const executor: ToolExecutor = async (input, context) => {
  const { path: dirPath } = input as { path: string };
  try {
    const signal = boundedSignal(context.signal);
    if (signal.aborted) {
      return { content: 'List aborted', isError: true };
    }

    const entries = await fs.readdir(dirPath, { withFileTypes: true });
    if (signal.aborted) {
      return { content: 'List aborted', isError: true };
    }
    if (entries.length > MAX_LIST_FILES_ENTRIES) {
      return {
        content: `Directory exceeds list_files limit of ${MAX_LIST_FILES_ENTRIES} entries`,
        isError: true,
      };
    }

    const result = entries.map(entry => ({
      name: entry.name,
      type: entry.isDirectory() ? 'directory' : 'file',
    }));
    return { content: { items: result } };
  } catch (err: any) {
    return { content: err.message, isError: true };
  }
};

export const listFilesTool: RegisteredTool = { definition, executor };
