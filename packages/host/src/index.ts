// packages/host/src/index.ts
import path from 'node:path';
import fs from 'node:fs';
import { HostServer } from './server.ts';
import { SessionStore } from './session-store.ts';
import { ToolRegistry } from './tool-registry.ts';
import { AgentLoop } from './agent-loop.ts';
import { AnthropicAdapter } from './provider/anthropic.ts';
import { registerAdapter, getAdapter } from './provider/adapter.ts';
import { readFileTool } from './tools/read-file.ts';
import { listFilesTool } from './tools/list-files.ts';
import { shellExecTool } from './tools/shell-exec.ts';
import type { StreamEvent } from './types.ts';

function getStateDir(): string {
  const mode = process.env.AOS_MODE ?? 'repo';
  const dir = path.join(
    process.env.HOME ?? '/tmp',
    '.config', 'aos', mode,
  );
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

async function main() {
  const stateDir = getStateDir();
  const dbPath = path.join(stateDir, 'host.db');
  const socketPath = path.join(stateDir, 'host.sock');

  const store = new SessionStore(dbPath);
  const registry = new ToolRegistry();
  const anthropic = new AnthropicAdapter();
  registerAdapter(anthropic);

  registry.register(readFileTool.definition, readFileTool.executor);
  registry.register(listFilesTool.definition, listFilesTool.executor);
  registry.register(shellExecTool.definition, shellExecTool.executor);

  const activeStreams = new Map<string, AbortController>();

  const handler = async (
    method: string,
    params: Record<string, unknown>,
    streamCallback: (event: StreamEvent) => void,
  ): Promise<unknown> => {
    switch (method) {
      case 'chat.create': {
        const session = store.createSession(params as any);
        return session;
      }

      case 'chat.send': {
        const { sessionId, text } = params as { sessionId: string; text: string };
        const session = store.getSession(sessionId);
        if (!session) throw new Error(`Session not found: ${sessionId}`);

        const adapter = getAdapter(session.provider);
        const loop = new AgentLoop(store, registry, adapter, {
          maxIterations: (params.maxIterations as number) ?? 25,
        });

        const controller = new AbortController();
        activeStreams.set(sessionId, controller);

        try {
          for await (const event of loop.send(sessionId, text, controller.signal)) {
            streamCallback(event);
          }
        } finally {
          activeStreams.delete(sessionId);
        }
        return { ok: true };
      }

      case 'chat.stop': {
        const { sessionId } = params as { sessionId: string };
        const controller = activeStreams.get(sessionId);
        if (controller) controller.abort();
        return { ok: true };
      }

      case 'chat.list': {
        return store.listSessions();
      }

      case 'tools.list': {
        return registry.getDefinitions();
      }

      default:
        throw new Error(`Unknown method: ${method}`);
    }
  };

  const server = new HostServer(handler);
  await server.listen(socketPath);
  console.log(`aos-host listening on ${socketPath}`);

  const shutdown = async () => {
    console.log('Shutting down...');
    for (const controller of activeStreams.values()) {
      controller.abort();
    }
    await server.close();
    store.close();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
