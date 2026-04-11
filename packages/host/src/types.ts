// packages/host/src/types.ts

// --- JSON primitives ---

export type JSONValue = string | number | boolean | null | JSONValue[] | { [key: string]: JSONValue };
export type JSONSchema = Record<string, unknown>;

// --- Tool interfaces (BORROW PATTERN: MCP tool shape, extended) ---

export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: JSONSchema;
  permissions?: PermissionSpec;
  timeout?: number; // ms, default 30_000
  metadata?: {
    type: 'simple' | 'provider-backed' | 'agent-backed';
    source?: string;
  };
}

export interface ToolContext {
  sessionId: string;
  signal: AbortSignal;
  emit: (event: StreamEvent) => void;
}

export type ToolExecutor = (input: JSONValue, context: ToolContext) => Promise<ToolResult>;

export interface ToolResult {
  content: string | Record<string, unknown>;
  isError?: boolean;
}

export interface RegisteredTool {
  definition: ToolDefinition;
  executor: ToolExecutor;
}

// --- Permission model (BUILD, borrow pattern from Claude Code) ---

export interface PermissionSpec {
  default: 'allow' | 'deny' | 'ask';
  dangerous?: boolean;
}

export interface PermissionOverride {
  tool: string; // glob pattern
  decision: 'allow' | 'deny';
  scope: 'session' | 'persistent';
}

// --- Stream events (ADAPT: Vercel AI SDK stream types, extended) ---

export type StreamEvent =
  | { type: 'text-delta'; text: string }
  | { type: 'tool-call'; toolCallId: string; toolName: string; args: JSONValue }
  | { type: 'tool-result'; toolCallId: string; result: ToolResult }
  | { type: 'tool-progress'; toolCallId: string; message: string }
  | { type: 'finish'; reason: 'end_turn' | 'stop' | 'max_tokens' | 'max_iterations' }
  | { type: 'error'; error: string; code?: string }
  | { type: 'status'; message: string };

// --- Session & messages (BUILD on better-sqlite3) ---

export interface Session {
  id: string;
  provider: string;
  model: string;
  system?: string;
  toolProfile?: string;
  createdAt: string;
  updatedAt: string;
}

export interface SessionConfig {
  provider?: string;  // default: 'anthropic'
  model?: string;     // default: 'claude-sonnet-4-20250514'
  system?: string;
  toolProfile?: string;
}

export interface StoredMessage {
  id: string;
  sessionId: string;
  role: 'user' | 'assistant';
  content: string; // JSON-serialized content blocks
  createdAt: string;
  tokenCount?: number;
}

// --- Provider adapter (ADAPT: wraps Vercel AI SDK) ---

export interface ProviderConfig {
  model: string;
  temperature?: number;
  maxTokens?: number;
}

export interface ProviderMessage {
  role: 'user' | 'assistant';
  content: ProviderContentBlock[];
}

export type ProviderContentBlock =
  | { type: 'text'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: JSONValue }
  | { type: 'tool_result'; tool_use_id: string; content: string };

export interface ProviderAdapter {
  id: string;
  stream(params: {
    messages: ProviderMessage[];
    tools: ToolDefinition[];
    system?: string;
    config: ProviderConfig;
  }): AsyncIterable<StreamEvent>;
}

// --- Agent loop config ---

export interface AgentLoopConfig {
  maxIterations: number; // default: 25
}

// --- Socket protocol (BORROW PATTERN: gateway line-delimited JSON) ---

export interface SocketRequest {
  id: string;
  method: string;
  params: Record<string, unknown>;
}

export interface SocketResponse {
  id: string;
  result?: unknown;
  error?: { message: string; code?: string };
}
