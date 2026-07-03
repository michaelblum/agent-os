// packages/host/src/provider/anthropic.ts
import { streamText, jsonSchema } from 'ai';
import type { CoreAssistantMessage, CoreMessage, CoreToolMessage, CoreUserMessage } from 'ai';
import { createAnthropic } from '@ai-sdk/anthropic';
import type {
  ProviderAdapter, ProviderMessage, ProviderConfig,
  ToolDefinition, StreamEvent, JSONValue,
} from '../types.ts';

export function toAnthropicCoreMessages(messages: ProviderMessage[]): CoreMessage[] {
  return messages.map((msg, index) => {
    if (msg.role === 'tool' || msg.content.every(block => block.type === 'tool_result')) {
      return {
        role: 'tool',
        content: msg.content.flatMap(block => {
          if (block.type !== 'tool_result') return [];
          return [{
            type: 'tool-result' as const,
            toolCallId: block.tool_use_id,
            toolName: block.tool_name ?? inferToolName(messages, index, block.tool_use_id),
            result: block.content,
            isError: block.is_error,
          }];
        }),
      } satisfies CoreToolMessage;
    }

    if (msg.role === 'assistant') {
      const content: CoreAssistantMessage['content'] = [];
      for (const block of msg.content) {
        if (block.type === 'text') {
          content.push({ type: 'text', text: block.text });
        } else if (block.type === 'tool_use') {
          content.push({
            type: 'tool-call',
            toolCallId: block.id,
            toolName: block.name,
            args: block.input as Record<string, unknown>,
          });
        }
      }
      return {
        role: 'assistant',
        content,
      } satisfies CoreAssistantMessage;
    }

    const content: CoreUserMessage['content'] = [];
    for (const block of msg.content) {
      if (block.type === 'text') {
        content.push({ type: 'text', text: block.text });
      }
    }
    return {
      role: 'user',
      content,
    } satisfies CoreUserMessage;
  });
}

function inferToolName(messages: ProviderMessage[], beforeIndex: number, toolCallId: string): string {
  for (let i = beforeIndex - 1; i >= 0; i--) {
    for (const block of messages[i]?.content ?? []) {
      if (block.type === 'tool_use' && block.id === toolCallId) {
        return block.name;
      }
    }
  }
  return 'unknown_tool';
}

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

    const aiMessages = toAnthropicCoreMessages(messages);

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
      messages: aiMessages as CoreMessage[],
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
