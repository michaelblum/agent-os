// packages/host/src/tools/list-files.ts
import fs from 'node:fs/promises';
import type { ToolDefinition, ToolExecutor, RegisteredTool } from '../types.ts';

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
  metadata: { type: 'simple', source: 'builtin' },
};

const executor: ToolExecutor = async (input, _context) => {
  const { path: dirPath } = input as { path: string };
  try {
    const entries = await fs.readdir(dirPath, { withFileTypes: true });
    const result = entries.map(entry => ({
      name: entry.name,
      type: entry.isDirectory() ? 'directory' : 'file',
    }));
    return { content: result };
  } catch (err: any) {
    return { content: err.message, isError: true };
  }
};

export const listFilesTool: RegisteredTool = { definition, executor };
