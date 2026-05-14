import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { mkdirSync, watch, type FSWatcher } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { EngineRouter } from './engine/router.js';
import { NodeSubprocessEngine } from './engine/node-subprocess.js';
import { createLogger, type Logger } from './logger.js';
import { detectMode } from './mode.js';
import { migrateFromEnv } from './migrate.js';
import { mcpPaths } from './paths.js';
import { ScriptRegistry } from './scripts.js';
import { startSDKSocket } from './sdk-socket.js';
import { acquirePidLock, PeerAliveError, type PidLock } from './singleton.js';
import { registerExecutionTools } from './tools/execution.js';
// @ts-expect-error JS adapter lives outside src so MCP hosts can exercise it directly.
import { userSignalSurface, userSignalSurfaceTool } from '../tools/user-signal-surface.js';

const scriptPath = fileURLToPath(import.meta.url);
const mode = detectMode(scriptPath);
const paths = mcpPaths(mode);

const migrateResult = migrateFromEnv({ env: process.env, target: paths.stateDir });
mkdirSync(paths.stateDir, { recursive: true });

const logger: Logger = createLogger({ logPath: paths.logPath });
logger.info('gateway starting', {
  role: 'mcp',
  mode,
  stateDir: paths.stateDir,
  pidPath: paths.pidPath,
  logPath: paths.logPath,
  migrate: migrateResult,
});

let pidLock: PidLock | undefined;
try {
  pidLock = acquirePidLock(paths.pidPath);
} catch (err: any) {
  if (err instanceof PeerAliveError) {
    logger.error('peer gateway alive, exiting', { message: err.message });
  } else {
    logger.error('failed to acquire pidfile', { message: err.message });
  }
  logger.close();
  process.exit(1);
}

let sdkServer: ReturnType<typeof startSDKSocket> | undefined;
try {
  sdkServer = startSDKSocket({ socketPath: paths.socketPath });
} catch (err: any) {
  logger.error('init failed', { message: err.message });
  pidLock?.release();
  logger.close();
  process.exit(1);
}

sdkServer!.on('error', (err: Error) => {
  logger.error('sdk socket error', { message: err.message });
  shutdown(1);
});

const engine = new NodeSubprocessEngine();
const router = new EngineRouter();
router.register(engine);
const registry = new ScriptRegistry(paths.scriptsDir);

const execTools = registerExecutionTools(router, registry, paths.socketPath);
const allHandlers: Record<string, (args: any) => any> = {
  ...execTools,
  user_signal_surface: userSignalSurface,
};

const TOOL_DEFS = [
  { name: 'run_os_script', description: 'Execute a TS/JS script against the aos SDK. Runs off-stage.',
    inputSchema: { type: 'object' as const, properties: {
      script: { type: 'string' }, script_id: { type: 'string' }, params: { type: 'object' },
      intent: { type: 'string', enum: ['perception','action','automation','mixed'] },
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
    inputSchema: { type: 'object' as const, properties: { namespace: { type: 'string' } } } },
  userSignalSurfaceTool,
];

const server = new Server({ name: 'aos-gateway', version: '0.1.0' }, { capabilities: { tools: {} } });

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOL_DEFS }));
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  const handler = allHandlers[name];
  if (!handler) return { content: [{ type: 'text', text: JSON.stringify({ error: `Unknown tool: ${name}` }) }] };
  try {
    const result = await handler(args ?? {});
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
  } catch (err: any) {
    return { isError: true, content: [{ type: 'text', text: JSON.stringify({ error: err.message }) }] };
  }
});

const transport = new StdioServerTransport();
await server.connect(transport);
logger.info('aos-gateway started');

let distWatcher: FSWatcher | undefined;
if (mode === 'repo') {
  const distDir = dirname(scriptPath);
  let notified = false;
  try {
    distWatcher = watch(distDir, { recursive: true }, (_event, filename) => {
      if (notified || !filename?.endsWith('.js')) return;
      notified = true;
      logger.info('dist changed — restart session to load new code', { filename });
    });
    distWatcher.on('error', (err) => {
      logger.warn('dist watcher error (non-fatal)', { error: err.message });
      try { distWatcher?.close(); } catch {}
    });
  } catch (err: any) {
    logger.warn('dist watcher unavailable (non-fatal)', { error: err.message });
  }
}

void sdkServer;

let shuttingDown = false;
function shutdown(code: number): void {
  if (shuttingDown) return;
  shuttingDown = true;
  try { distWatcher?.close(); } catch {}
  try { sdkServer?.close(); } catch {}
  try { pidLock?.release(); } catch {}
  try { logger.close(); } catch {}
  process.exit(code);
}
process.on('SIGTERM', () => shutdown(0));
process.on('SIGINT', () => shutdown(0));
process.on('exit', () => {
  try { pidLock?.release(); } catch {}
});
