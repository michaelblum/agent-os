// src/index.ts
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { CoordinationDB } from './db.js';
import { EngineRouter } from './engine/router.js';
import { NodeSubprocessEngine } from './engine/node-subprocess.js';
import { ScriptRegistry } from './scripts.js';
import { startSDKSocket } from './sdk-socket.js';
import { registerCoordinationTools } from './tools/coordination.js';
import { registerExecutionTools } from './tools/execution.js';
import { mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const STATE_DIR = join(homedir(), '.config', 'aos-gateway');
mkdirSync(STATE_DIR, { recursive: true });

const DB_PATH = join(STATE_DIR, 'gateway.db');
const SOCKET_PATH = join(STATE_DIR, 'sdk.sock');
const SCRIPTS_DIR = join(STATE_DIR, 'scripts');

const db = new CoordinationDB(DB_PATH);
const sdkServer = startSDKSocket({ socketPath: SOCKET_PATH, db });
const engine = new NodeSubprocessEngine();
const router = new EngineRouter();
router.register(engine);
const registry = new ScriptRegistry(SCRIPTS_DIR);

const coordTools = registerCoordinationTools(db);
const execTools = registerExecutionTools(router, registry, SOCKET_PATH);
const allHandlers: Record<string, (args: any) => any> = { ...coordTools, ...execTools };

const TOOL_DEFS = [
  { name: 'register_session', description: 'Register this agent session on the coordination bus.',
    inputSchema: { type: 'object' as const, properties: {
      name: { type: 'string' }, role: { type: 'string' }, harness: { type: 'string' },
      capabilities: { type: 'array', items: { type: 'string' } },
    }, required: ['name', 'role', 'harness'] } },
  { name: 'set_state', description: 'Write to the shared key-value store. Supports set, cas, acquire_lock, release_lock.',
    inputSchema: { type: 'object' as const, properties: {
      key: { type: 'string' }, value: {}, mode: { type: 'string', enum: ['set','cas','acquire_lock','release_lock'] },
      expected_version: { type: 'number' }, owner: { type: 'string' }, ttl: { type: 'number' },
    }, required: ['key'] } },
  { name: 'get_state', description: 'Read from the shared key-value store. Exact key or glob.',
    inputSchema: { type: 'object' as const, properties: {
      key: { type: 'string' },
    }, required: ['key'] } },
  { name: 'post_message', description: 'Post a message to a channel.',
    inputSchema: { type: 'object' as const, properties: {
      channel: { type: 'string' }, payload: {}, from: { type: 'string' },
    }, required: ['channel', 'payload', 'from'] } },
  { name: 'read_stream', description: 'Read messages from a channel.',
    inputSchema: { type: 'object' as const, properties: {
      channel: { type: 'string' }, since: { type: 'string' }, limit: { type: 'number' },
    }, required: ['channel'] } },
  { name: 'run_os_script', description: 'Execute a TS/JS script against the aos SDK. Runs off-stage.',
    inputSchema: { type: 'object' as const, properties: {
      script: { type: 'string' }, script_id: { type: 'string' }, params: { type: 'object' },
      intent: { type: 'string', enum: ['perception','action','coordination','mixed'] },
      timeout: { type: 'number' }, engine: { type: 'string', enum: ['auto','node-subprocess'] },
    } } },
  { name: 'save_script', description: 'Save a script for reuse.',
    inputSchema: { type: 'object' as const, properties: {
      name: { type: 'string' }, script: { type: 'string' }, description: { type: 'string' },
      intent: { type: 'string' }, portable: { type: 'boolean' },
      overwrite: { type: 'boolean' }, note: { type: 'string' },
    }, required: ['name', 'script', 'description', 'intent'] } },
  { name: 'list_scripts', description: 'List saved scripts.',
    inputSchema: { type: 'object' as const, properties: {
      intent: { type: 'string' }, query: { type: 'string' },
    } } },
  { name: 'discover_capabilities', description: 'Returns SDK namespaces and method signatures.',
    inputSchema: { type: 'object' as const, properties: {
      namespace: { type: 'string' },
    } } },
];

const server = new Server({ name: 'aos-gateway', version: '0.1.0' }, {
  capabilities: { tools: {} },
});

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOL_DEFS }));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  const handler = allHandlers[name];
  if (!handler) return { content: [{ type: 'text', text: JSON.stringify({ error: `Unknown tool: ${name}` }) }] };

  try {
    const result = await handler(args ?? {});
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
  } catch (err: any) {
    return { content: [{ type: 'text', text: JSON.stringify({ error: err.message }) }] };
  }
});

const transport = new StdioServerTransport();
await server.connect(transport);
console.error('aos-gateway started');

// Keep a reference to prevent GC
void sdkServer;
