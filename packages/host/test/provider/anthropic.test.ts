// packages/host/test/provider/anthropic.test.ts
import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import { AnthropicAdapter, toAnthropicCoreMessages } from '../../src/provider/anthropic.ts';
import type { StreamEvent } from '../../src/types.ts';

describe('AnthropicAdapter', () => {
  let adapter: AnthropicAdapter;

  before(() => {
    if (!process.env.ANTHROPIC_API_KEY) {
      console.log('Skipping Anthropic tests — no API key');
      return;
    }
    adapter = new AnthropicAdapter();
  });

  it('has correct id', () => {
    const a = new AnthropicAdapter();
    assert.equal(a.id, 'anthropic');
  });

  it('converts tool results to AI SDK tool messages with tool names', () => {
    const messages = toAnthropicCoreMessages([
      { role: 'user', content: [{ type: 'text', text: 'echo test' }] },
      {
        role: 'assistant',
        content: [
          { type: 'tool_use', id: 'tc1', name: 'echo', input: { text: 'test' } },
        ],
      },
      {
        role: 'tool',
        content: [
          { type: 'tool_result', tool_use_id: 'tc1', tool_name: 'echo', content: 'echoed: test' },
        ],
      },
    ]);

    assert.equal(messages[2].role, 'tool');
    assert.deepEqual(messages[2].content, [
      {
        type: 'tool-result',
        toolCallId: 'tc1',
        toolName: 'echo',
        result: 'echoed: test',
        isError: undefined,
      },
    ]);
  });

  it('infers tool names for legacy stored user-role tool results', () => {
    const messages = toAnthropicCoreMessages([
      {
        role: 'assistant',
        content: [
          { type: 'tool_use', id: 'tc1', name: 'read_file', input: { path: '/tmp/test.txt' } },
        ],
      },
      {
        role: 'user',
        content: [
          { type: 'tool_result', tool_use_id: 'tc1', content: 'contents' },
        ],
      },
    ]);

    assert.equal(messages[1].role, 'tool');
    assert.equal(messages[1].content[0].toolName, 'read_file');
  });

  it('streams a simple text response', async () => {
    if (!process.env.ANTHROPIC_API_KEY) return;

    const events: StreamEvent[] = [];
    const stream = adapter.stream({
      messages: [{ role: 'user', content: [{ type: 'text', text: 'Say "hello" and nothing else.' }] }],
      tools: [],
      system: 'You are a test assistant. Be extremely brief.',
      config: { model: 'claude-sonnet-4-20250514', maxTokens: 50 },
    });

    for await (const event of stream) {
      events.push(event);
    }

    const textEvents = events.filter(e => e.type === 'text-delta');
    assert.ok(textEvents.length > 0, 'Should have text deltas');

    const finishEvents = events.filter(e => e.type === 'finish');
    assert.equal(finishEvents.length, 1, 'Should have exactly one finish event');
  });

  it('streams a tool call when tools are provided', async () => {
    if (!process.env.ANTHROPIC_API_KEY) return;

    const events: StreamEvent[] = [];
    const stream = adapter.stream({
      messages: [{ role: 'user', content: [{ type: 'text', text: 'Read the file at /tmp/test.txt' }] }],
      tools: [{
        name: 'read_file',
        description: 'Read a file',
        inputSchema: {
          type: 'object',
          properties: { path: { type: 'string' } },
          required: ['path'],
        },
      }],
      system: 'Use tools when appropriate.',
      config: { model: 'claude-sonnet-4-20250514', maxTokens: 200 },
    });

    for await (const event of stream) {
      events.push(event);
    }

    const toolCalls = events.filter(e => e.type === 'tool-call');
    assert.ok(toolCalls.length > 0, 'Should have at least one tool call');
    const tc = toolCalls[0] as Extract<StreamEvent, { type: 'tool-call' }>;
    assert.equal(tc.toolName, 'read_file');
    assert.ok(tc.toolCallId);
  });
});
