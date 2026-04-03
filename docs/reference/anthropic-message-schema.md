# Anthropic Message Schema Reference

> Reference for building surfaces that render Claude conversations. Used by Track 2 chat overlay.
> This is reference material, not an agent-os convention. agent-os is format-agnostic.

## API Message Envelope

```typescript
// Response from Messages API
{
  id: string;
  type: "message";
  role: "assistant";
  content: ContentBlock[];      // Array of typed content blocks
  model: string;
  stop_reason: "end_turn" | "max_tokens" | "stop_sequence" | "tool_use";
  stop_sequence?: string;
  usage: {
    input_tokens: number;
    output_tokens: number;
    cache_creation_input_tokens?: number;
    cache_read_input_tokens?: number;
  };
}
```

Input message roles: `"user"` and `"assistant"` only. System prompt is a separate top-level parameter.

## Content Block Types (17)

All content blocks discriminate on `type`. Optional `cache_control?: { type: "ephemeral"; ttl?: "5m" | "1h" }`.

### Core (render these first)

| # | type | Key fields | Notes |
|---|------|------------|-------|
| 1 | `text` | `text: string`, `citations?: Citation[]` | Basic text / markdown |
| 2 | `image` | `source: { type: "base64", media_type, data } \| { type: "url", url }` | JPEG, PNG, GIF, WebP |
| 3 | `document` | `source: Base64PDF \| PlainText \| Content \| URLPdf`, `title?`, `context?` | PDFs & text docs |
| 4 | `tool_use` | `id: string`, `name: string`, `input: Record<string, unknown>` | Model requests tool execution |
| 5 | `tool_result` | `tool_use_id: string`, `content?: string \| ContentBlock[]`, `is_error?: boolean` | Tool response |
| 6 | `thinking` | `thinking: string`, `signature: string` | Extended thinking (collapsible) |
| 7 | `redacted_thinking` | `data: string` | Redacted thinking (show placeholder) |

### Search & Web

| # | type | Key fields |
|---|------|------------|
| 8 | `search_result` | `title`, `source`, `content: TextBlockParam[]`, `citations?` |
| 9 | `server_tool_use` | `id`, `name: "web_search" \| "web_fetch" \| "code_execution" \| ...`, `input` |
| 10 | `web_search_tool_result` | `tool_use_id`, `content: WebSearchToolResultBlockItem[] \| error` |
| 11 | `web_fetch_tool_result` | `tool_use_id`, `content: WebFetchResult \| error` |

### Code Execution

| # | type | Key fields |
|---|------|------------|
| 12 | `code_execution_tool_result` | `tool_use_id`, `content: { stdout, stderr, return_code, content[] } \| error` |
| 13 | `bash_code_execution_tool_result` | `tool_use_id`, same shape as code_execution |
| 14 | `text_editor_code_execution_tool_result` | `tool_use_id`, `content: view \| create \| str_replace \| error` |

### Tool Search

| # | type | Key fields |
|---|------|------------|
| 15 | `tool_search_tool_result` | `tool_use_id`, `content: { tool_references[] } \| error` |
| 16 | `tool_reference` | `tool_name: string` |

### Container

| # | type | Key fields |
|---|------|------------|
| 17 | `container_upload` | `file_id: string` |

### Citation Types (on text blocks)

`char_location`, `page_location`, `content_block_location`, `web_search_result_location`, `search_result_location` -- each with `cited_text`, document/source identifiers, and location pointers.

## SDK Message Envelope (SDKMessage)

Claude Code / Agent SDK wraps API messages in a higher-level envelope. 21 types:

### Primary Message Types

```typescript
// Assistant turn (wraps API response)
SDKAssistantMessage {
  type: "assistant";
  uuid: string;
  session_id: string;
  message: BetaMessage;           // <- the API response object above
  parent_tool_use_id: string | null;
  error?: SDKAssistantMessageError;
}

// User turn
SDKUserMessage {
  type: "user";
  uuid?: string;
  session_id: string;
  message: MessageParam;
  parent_tool_use_id: string | null;
  isSynthetic?: boolean;
  tool_use_result?: boolean;
}

// Session result
SDKResultMessage {
  type: "result";
  subtype: "success" | "error_max_turns" | "error_during_execution" | "error_max_budget_usd" | "error_max_structured_output_retries";
  uuid: string;
  session_id: string;
  duration_ms: number;
  duration_api_ms: number;
  is_error: boolean;
  num_turns: number;
  result: string;
  total_cost_usd: number;
  usage: { input_tokens, output_tokens, cache_read_input_tokens, cache_creation_input_tokens };
}
```

### System & Progress Types

```typescript
SDKSystemMessage         // type: "system", subtype: "init"
SDKStatusMessage         // type: "system", subtype: "status"
SDKCompactBoundaryMessage // type: "system", subtype: "compact_boundary"
SDKLocalCommandOutputMessage // type: "system", subtype: "local_command_output"
SDKTaskNotificationMessage   // type: "system", subtype: "task_notification"
SDKTaskStartedMessage        // type: "system", subtype: "task_started"
SDKTaskProgressMessage       // type: "system", subtype: "task_progress"
SDKFilesPersistedEvent       // type: "system", subtype: "files_persisted"
SDKHookStartedMessage        // type: "system", subtype: "hook_started"
SDKHookProgressMessage       // type: "system", subtype: "hook_progress"
SDKHookResponseMessage       // type: "system", subtype: "hook_response"
SDKToolProgressMessage       // type: "tool_progress"
SDKToolUseSummaryMessage     // type: "tool_use_summary"
SDKAuthStatusMessage         // type: "auth_status"
SDKRateLimitEvent            // type: "rate_limit_event"
SDKPromptSuggestionMessage   // type: "prompt_suggestion"
```

## Streaming Events

```
message_start        -> { type: "message_start", message: Message }
content_block_start  -> { type: "content_block_start", index: number, content_block: ContentBlock }
content_block_delta  -> { type: "content_block_delta", index: number, delta: Delta }
content_block_stop   -> { type: "content_block_stop", index: number }
message_delta        -> { type: "message_delta", delta: { stop_reason, stop_sequence }, usage }
message_stop         -> { type: "message_stop" }
ping                 -> { type: "ping" }
error                -> { type: "error", error: { type, message } }
```

Delta types: `text_delta` (text), `input_json_delta` (partial_json), `thinking_delta` (thinking), `signature_delta` (signature).

## Client-Rendered Tool Calls

These are standard `tool_use` content blocks. Claude Code renders them as special UI instead of showing raw JSON.

### AskUserQuestion

```typescript
// Input (inside tool_use.input)
{
  questions: Array<{
    question: string;           // Full question text
    header: string;             // Short label, max 12 chars (chip/tag)
    options: Array<{
      label: string;            // 1-5 words
      description: string;      // What this option means
      preview?: string;         // Optional HTML/markdown preview
    }>;                         // 2-4 options per question
    multiSelect: boolean;       // true = multiple selections allowed
  }>;                           // 1-4 questions per call
}

// Output (returned via tool_result)
{
  questions: Array<{...}>;      // Pass-through of original
  answers: Record<string, string>;  // Key = question text, Value = selected label(s)
}
```

- Implicit "Other" option always rendered (free-text input)
- Recommended option goes first with "(Recommended)" appended to label
- `preview` requires `toolConfig.askUserQuestion.previewFormat: "html" | "markdown"`

### TodoWrite

```typescript
// Input
{
  todos: Array<{
    content: string;            // Imperative: "Run tests"
    status: "pending" | "in_progress" | "completed";
    activeForm: string;         // Present continuous: "Running tests"
  }>;
}

// Output
{
  oldTodos: Array<{...}>;
  newTodos: Array<{...}>;
}
```

When `status === "in_progress"`, display `activeForm`. Otherwise display `content`.

### ExitPlanMode

```typescript
// Input
{
  allowedPrompts?: Array<{
    tool: "Bash";
    prompt: string;             // Semantic: "run tests", "install dependencies"
  }>;
}

// Output
{
  plan: string | null;          // Markdown plan text
  isAgent: boolean;
  filePath?: string;
  hasTaskTool?: boolean;
  awaitingLeaderApproval?: boolean;
  requestId?: string;
}
```

## Architecture Notes for Overlay Renderers

1. **Tool calls are content blocks.** TodoWrite, AskUserQuestion, etc. appear as `{ type: "tool_use", name: "TodoWrite", id: "...", input: {...} }` inside `message.content[]`. Results come back as `tool_result` blocks in the next user message.

2. **Discriminate on `type` everywhere.** API content blocks, SDK messages, and streaming events all use `type` (+ optional `subtype` for SDK system messages).

3. **`SDKAssistantMessage.message` IS a `BetaMessage`** -- same shape as raw API response. Reach into `.message.content` for the content blocks.

4. **Critical rendering types:** `text` (with markdown + citations), `tool_use` (special-case TodoWrite, AskUserQuestion, ExitPlanMode; generic card for others), `thinking`/`redacted_thinking` (collapsible), `image`, `tool_result` (can contain text + images).

5. **For a chat overlay MVP:** Handle `text`, `tool_use` (AskUserQuestion special case), `tool_result`, and `thinking`. Everything else can render as a generic collapsed block initially.

---

## OpenAI / Codex Message Schema

> **TODO:** Document OpenAI's message format (ChatCompletionMessage, tool calls, streaming chunks) and Codex CLI's wrapper types for parity. Needed if/when a second chat overlay surface targets GPT models. Not urgent — Track 2 currently uses Claude only.

---

*Compiled April 2026 from Anthropic API docs, Agent SDK reference, Claude Code tools reference.*
