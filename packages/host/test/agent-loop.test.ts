// packages/host/test/agent-loop.test.ts
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { AgentLoop } from '../src/agent-loop.ts';
import { SessionStore } from '../src/session-store.ts';
import { ToolRegistry } from '../src/tool-registry.ts';
import type { ProviderAdapter, StreamEvent, ToolExecutor } from '../src/types.ts';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

// Mock provider that returns predetermined responses
function createMockAdapter(responses: StreamEvent[][]): ProviderAdapter {
  let callIndex = 0;
  return {
    id: 'mock',
    async *stream() {
      const events = responses[callIndex++] ?? [{ type: 'finish', reason: 'end_turn' }];
      for (const event of events) {
        yield event;
      }
    },
  };
}

describe('AgentLoop', () => {
  let store: SessionStore;
  let registry: ToolRegistry;
  let dbPath: string;

  beforeEach(() => {
    dbPath = path.join(os.tmpdir(), `host-loop-test-${Date.now()}.db`);
    store = new SessionStore(dbPath);
    registry = new ToolRegistry();
  });

  afterEach(() => {
    store.close();
    try { fs.unlinkSync(dbPath); } catch {}
    try { fs.unlinkSync(dbPath + '-wal'); } catch {}
    try { fs.unlinkSync(dbPath + '-shm'); } catch {}
  });

  it('streams a text-only response', async () => {
    const adapter = createMockAdapter([
      [
        { type: 'text-delta', text: 'Hello' },
        { type: 'text-delta', text: ' world' },
        { type: 'finish', reason: 'end_turn' },
      ],
    ]);

    const loop = new AgentLoop(store, registry, adapter, { maxIterations: 25 });
    const session = store.createSession({});
    const events: StreamEvent[] = [];

    for await (const event of loop.send(session.id, 'hi')) {
      events.push(event);
    }

    assert.equal(events.filter(e => e.type === 'text-delta').length, 2);
    assert.equal(events.filter(e => e.type === 'finish').length, 1);

    // Message persisted
    const messages = store.getMessages(session.id);
    assert.equal(messages.length, 2); // user + assistant
    assert.equal(messages[0].role, 'user');
    assert.equal(messages[1].role, 'assistant');
  });

  it('executes tool calls and loops', async () => {
    const echoExec: ToolExecutor = async (input) => {
      return { content: `echoed: ${(input as any).text}` };
    };
    registry.register({
      name: 'echo',
      description: 'Echo',
      inputSchema: { type: 'object', properties: { text: { type: 'string' } } },
      permissions: { default: 'allow' },
    }, echoExec);

    // Turn 1: model calls echo tool
    // Turn 2: model responds with text after seeing tool result
    const adapter = createMockAdapter([
      [
        { type: 'tool-call', toolCallId: 'tc1', toolName: 'echo', args: { text: 'test' } },
        { type: 'finish', reason: 'end_turn' },
      ],
      [
        { type: 'text-delta', text: 'Got it' },
        { type: 'finish', reason: 'end_turn' },
      ],
    ]);

    const loop = new AgentLoop(store, registry, adapter, { maxIterations: 25 });
    const session = store.createSession({});
    const events: StreamEvent[] = [];

    for await (const event of loop.send(session.id, 'echo test')) {
      events.push(event);
    }

    const toolCalls = events.filter(e => e.type === 'tool-call');
    assert.equal(toolCalls.length, 1);

    const toolResults = events.filter(e => e.type === 'tool-result');
    assert.equal(toolResults.length, 1);
    const tr = toolResults[0] as Extract<StreamEvent, { type: 'tool-result' }>;
    assert.equal(tr.result.content, 'echoed: test');

    const textDeltas = events.filter(e => e.type === 'text-delta');
    assert.ok(textDeltas.length > 0);
  });

  it('denies tool calls without permission', async () => {
    registry.register({
      name: 'danger',
      description: 'Dangerous',
      inputSchema: { type: 'object', properties: {} },
      permissions: { default: 'deny' },
    }, async () => ({ content: 'should not run' }));

    const adapter = createMockAdapter([
      [
        { type: 'tool-call', toolCallId: 'tc1', toolName: 'danger', args: {} },
        { type: 'finish', reason: 'end_turn' },
      ],
      [
        { type: 'text-delta', text: 'ok denied' },
        { type: 'finish', reason: 'end_turn' },
      ],
    ]);

    const loop = new AgentLoop(store, registry, adapter, { maxIterations: 25 });
    const session = store.createSession({});
    const events: StreamEvent[] = [];

    for await (const event of loop.send(session.id, 'do danger')) {
      events.push(event);
    }

    const toolResults = events.filter(e => e.type === 'tool-result');
    assert.equal(toolResults.length, 1);
    const tr = toolResults[0] as Extract<StreamEvent, { type: 'tool-result' }>;
    assert.equal(tr.result.isError, true);
    assert.ok((tr.result.content as string).includes('denied'));
  });

  it('enforces max iteration limit', async () => {
    registry.register({
      name: 'echo',
      description: 'Echo',
      inputSchema: { type: 'object', properties: { text: { type: 'string' } } },
      permissions: { default: 'allow' },
    }, async (input) => ({ content: 'echoed' }));

    // Adapter always returns a tool call — should be stopped by max iterations
    const adapter = createMockAdapter(
      Array(10).fill([
        { type: 'tool-call', toolCallId: 'tc', toolName: 'echo', args: { text: 'x' } },
        { type: 'finish', reason: 'end_turn' },
      ])
    );

    const loop = new AgentLoop(store, registry, adapter, { maxIterations: 3 });
    const session = store.createSession({});
    const events: StreamEvent[] = [];

    for await (const event of loop.send(session.id, 'loop forever')) {
      events.push(event);
    }

    const finishEvents = events.filter(e => e.type === 'finish');
    const lastFinish = finishEvents[finishEvents.length - 1] as Extract<StreamEvent, { type: 'finish' }>;
    assert.equal(lastFinish.reason, 'max_iterations');
  });

  it('handles stop via AbortSignal', async () => {
    const controller = new AbortController();

    const adapter: ProviderAdapter = {
      id: 'mock',
      async *stream() {
        yield { type: 'text-delta' as const, text: 'start' };
        await new Promise(r => setTimeout(r, 100));
        yield { type: 'text-delta' as const, text: ' more' };
        yield { type: 'finish' as const, reason: 'end_turn' as const };
      },
    };

    const loop = new AgentLoop(store, registry, adapter, { maxIterations: 25 });
    const session = store.createSession({});
    const events: StreamEvent[] = [];

    setTimeout(() => controller.abort(), 50);

    for await (const event of loop.send(session.id, 'hello', controller.signal)) {
      events.push(event);
    }

    const finishEvents = events.filter(e => e.type === 'finish');
    assert.ok(finishEvents.length > 0);
  });
});
