// packages/host/src/tools/read-file.ts
import fs from 'node:fs/promises';
import type { ToolDefinition, ToolExecutor, RegisteredTool } from '../types.ts';

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
  metadata: { type: 'simple', source: 'builtin' },
};

const executor: ToolExecutor = async (input, _context) => {
  const { path: filePath } = input as { path: string };
  try {
    const content = await fs.readFile(filePath, 'utf-8');
    return { content };
  } catch (err: any) {
    return { content: err.message, isError: true };
  }
};

export const readFileTool: RegisteredTool = { definition, executor };
