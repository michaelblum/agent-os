// packages/host/src/provider/anthropic.ts
import { streamText, jsonSchema } from 'ai';
import { createAnthropic } from '@ai-sdk/anthropic';
import type {
  ProviderAdapter, ProviderMessage, ProviderConfig,
  ToolDefinition, StreamEvent, JSONValue,
} from '../types.ts';

export class AnthropicAdapter implements ProviderAdapter {
  readonly id = 'anthropic';
  private provider = createAnthropic();

  async *stream(params: {
    messages: ProviderMessage[];
    tools: ToolDefinition[];
    system?: string;
    config: ProviderConfig;
  }): AsyncIterable<StreamEvent> {
    const { messages, tools, system, config } = params;

    // Convert our message format to Vercel AI SDK format
    const aiMessages = messages.map(msg => ({
      role: msg.role as 'user' | 'assistant',
      content: msg.content.map(block => {
        if (block.type === 'text') return { type: 'text' as const, text: block.text };
        if (block.type === 'tool_use') return {
          type: 'tool-call' as const,
          toolCallId: block.id,
          toolName: block.name,
          args: block.input as Record<string, unknown>,
        };
        if (block.type === 'tool_result') return {
          type: 'tool-result' as const,
          toolCallId: block.tool_use_id,
          result: block.content,
        };
        return { type: 'text' as const, text: '' };
      }),
    }));

    // Convert tool definitions to Vercel AI SDK format.
    // The SDK requires `parameters` (not `inputSchema`) wrapping the JSON schema
    // via the `jsonSchema()` helper so it doesn't try to validate with Zod.
    const aiTools: Record<string, { description: string; parameters: ReturnType<typeof jsonSchema> }> = {};
    for (const tool of tools) {
      aiTools[tool.name] = {
        description: tool.description,
        parameters: jsonSchema(tool.inputSchema as Parameters<typeof jsonSchema>[0]),
      };
    }

    const result = streamText({
      model: this.provider(config.model),
      messages: aiMessages,
      tools: Object.keys(aiTools).length > 0 ? aiTools : undefined,
      system,
      maxTokens: config.maxTokens,
      temperature: config.temperature,
    });

    for await (const part of result.fullStream) {
      switch (part.type) {
        case 'text-delta':
          yield { type: 'text-delta', text: part.textDelta };
          break;
        case 'tool-call':
          yield {
            type: 'tool-call',
            toolCallId: part.toolCallId,
            toolName: part.toolName,
            args: part.args as JSONValue,
          };
          break;
        case 'finish':
          yield {
            type: 'finish',
            reason: part.finishReason === 'length' ? 'max_tokens' : 'end_turn',
          };
          break;
        case 'error':
          yield { type: 'error', error: String(part.error) };
          break;
        // Intentionally ignore: reasoning, step-start, step-finish,
        // tool-call-streaming-start, tool-call-delta, tool-result, source, file
      }
    }
  }
}
