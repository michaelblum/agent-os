// packages/host/src/agent-loop.ts
import type {
  ProviderAdapter, StreamEvent, ToolResult, ProviderMessage,
  ProviderContentBlock, AgentLoopConfig, JSONValue,
} from './types.ts';
import type { SessionStore } from './session-store.ts';
import type { ToolRegistry } from './tool-registry.ts';

export class AgentLoop {
  private store: SessionStore;
  private registry: ToolRegistry;
  private adapter: ProviderAdapter;
  private config: AgentLoopConfig;

  constructor(
    store: SessionStore,
    registry: ToolRegistry,
    adapter: ProviderAdapter,
    config: AgentLoopConfig,
  ) {
    this.store = store;
    this.registry = registry;
    this.adapter = adapter;
    this.config = config;
  }

  async *send(
    sessionId: string,
    text: string,
    signal?: AbortSignal,
  ): AsyncGenerator<StreamEvent> {
    const session = this.store.getSession(sessionId);
    if (!session) throw new Error(`Session not found: ${sessionId}`);

    // Append user message
    this.store.appendMessage(sessionId, 'user', [{ type: 'text', text }]);

    // Build message history
    let messages = this.buildMessages(sessionId);
    let iterations = 0;

    while (iterations < this.config.maxIterations) {
      iterations++;

      if (signal?.aborted) {
        // Persist any partial text accumulated from prior iterations
        yield { type: 'finish', reason: 'stop' };
        return;
      }

      // Collect tool calls and text blocks from this turn
      const toolCalls: Array<{ toolCallId: string; toolName: string; args: JSONValue }> = [];
      const textParts: string[] = [];

      try {
        const stream = this.adapter.stream({
          messages,
          tools: this.registry.getDefinitions(),
          system: session.system,
          config: { model: session.model },
        });

        for await (const event of stream) {
          if (signal?.aborted) {
            if (textParts.length > 0) {
              this.store.appendMessage(sessionId, 'assistant',
                [{ type: 'text', text: textParts.join('') }]);
            }
            yield { type: 'finish', reason: 'stop' };
            return;
          }

          switch (event.type) {
            case 'text-delta':
              textParts.push(event.text);
              yield event;
              break;
            case 'tool-call':
              toolCalls.push(event);
              yield event;
              break;
            case 'finish':
              break;
            case 'error':
              yield event;
              break;
          }
        }
      } catch (err: any) {
        // Persist any partial text before reporting error/stop
        if (textParts.length > 0) {
          this.store.appendMessage(sessionId, 'assistant',
            [{ type: 'text', text: textParts.join('') }]);
        }
        if (signal?.aborted) {
          yield { type: 'finish', reason: 'stop' };
          return;
        }
        yield { type: 'error', error: err.message };
        return;
      }

      // No tool calls — conversation turn complete
      if (toolCalls.length === 0) {
        const assistantBlocks: ProviderContentBlock[] = [];
        if (textParts.length > 0) {
          assistantBlocks.push({ type: 'text', text: textParts.join('') });
        }
        this.store.appendMessage(sessionId, 'assistant', assistantBlocks);
        yield { type: 'finish', reason: 'end_turn' };
        return;
      }

      // Has tool calls — persist assistant message with tool_use blocks, then execute
      const assistantBlocks: ProviderContentBlock[] = [];
      if (textParts.length > 0) {
        assistantBlocks.push({ type: 'text', text: textParts.join('') });
      }
      for (const tc of toolCalls) {
        assistantBlocks.push({
          type: 'tool_use',
          id: tc.toolCallId,
          name: tc.toolName,
          input: tc.args,
        });
      }
      this.store.appendMessage(sessionId, 'assistant', assistantBlocks);

      // Execute each tool call
      const toolResultBlocks: ProviderContentBlock[] = [];
      for (const tc of toolCalls) {
        const result = await this.executeTool(tc, sessionId, signal);
        toolResultBlocks.push({
          type: 'tool_result',
          tool_use_id: tc.toolCallId,
          content: typeof result.content === 'string'
            ? result.content
            : JSON.stringify(result.content),
        });
        yield {
          type: 'tool-result',
          toolCallId: tc.toolCallId,
          result,
        };
      }

      // Persist tool results as user message (Anthropic expects tool_result in user turn)
      this.store.appendMessage(sessionId, 'user', toolResultBlocks);

      // Rebuild messages for next iteration
      messages = this.buildMessages(sessionId);
    }

    // Hit max iterations
    yield { type: 'finish', reason: 'max_iterations' };
  }

  private async executeTool(
    toolCall: { toolCallId: string; toolName: string; args: JSONValue },
    sessionId: string,
    signal?: AbortSignal,
  ): Promise<ToolResult> {
    const permission = this.registry.checkPermission(toolCall.toolName);

    if (permission === 'deny') {
      return {
        content: `Tool '${toolCall.toolName}' denied by permission policy`,
        isError: true,
      };
    }

    if (permission === 'ask') {
      return {
        content: `Tool '${toolCall.toolName}' requires approval (not yet implemented)`,
        isError: true,
      };
    }

    const tool = this.registry.get(toolCall.toolName);
    if (!tool) {
      return { content: `Unknown tool: ${toolCall.toolName}`, isError: true };
    }

    try {
      const context = {
        sessionId,
        signal: signal ?? AbortSignal.timeout(tool.definition.timeout ?? 30_000),
        emit: () => {},
      };
      return await tool.executor(toolCall.args, context);
    } catch (err: any) {
      return { content: `Tool execution error: ${err.message}`, isError: true };
    }
  }

  private buildMessages(sessionId: string): ProviderMessage[] {
    const stored = this.store.getMessages(sessionId);
    return stored.map(msg => ({
      role: msg.role,
      content: JSON.parse(msg.content) as ProviderContentBlock[],
    }));
  }
}
