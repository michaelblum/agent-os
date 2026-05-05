# Chat Surface Integration — Spec

## Problem

The chat canvas (`apps/sigil/chat/index.html`) renders agent messages and has full IPC wiring to the AOS daemon, but users can only respond when the agent explicitly asks a question (`AskUserQuestion` tool use). Free-form conversational input is blocked. The chat surface needs to function as a full bidirectional channel — equivalent to the chat panel in Claude Desktop — so users can initiate messages, interrupt, and converse naturally with whatever agent session owns the avatar.

## Context

- The chat canvas is a **projection of an existing agent session**. The agent (running in Claude Code, Desktop, etc.) creates the canvas and pushes messages to it. No new Claude API client is needed.
- A prior session proved this works: a Desktop agent projected itself into the chat canvas and maintained parallel conversations in both the Desktop UI and the canvas, editorializing differently in each.
- The avatar represents the agent. Opening chat from the avatar means the agent is already listening — no session discovery or binding needed.
- User messages are fire-and-forget to the coordination channel. The agent picks them up when it can. If the agent is mid-task, messages queue.

## Changes

### 1. Unlock free-form input

**File:** `apps/sigil/chat/index.html`

The input field and send button are currently disabled by default and only enabled when `pendingToolUseId` is set (agent asked a question). Change to:

- Input field and send button are **always enabled**
- Remove the disable logic from `setIdle()`
- Keep the visual indicator (active dot) to show when the agent is actively engaged vs idle

### 2. Add `user_message` emit type

**File:** `apps/sigil/chat/index.html`

Currently `respond()` emits `{type: 'response', value, tool_use_id?}` for everything. Split into two paths:

- **`response`** — when answering an `AskUserQuestion` (has `pendingToolUseId`). Unchanged from today.
- **`user_message`** — when the user initiates a message unprompted (no `pendingToolUseId`). Payload: `{type: 'user_message', text: string}`.

The `sendUserInput()` / `respond()` function checks whether there's a pending tool use and emits the appropriate type.

### 3. Add `stop` emit type

**File:** `apps/sigil/chat/index.html`

Add a stop button (visible when the agent is actively generating) that emits `{type: 'stop'}`. This gives the user the same interrupt capability as the Desktop app. The button shows when the active dot is pulsing and hides on idle.

### 4. Manifest update

Update the `headsup.manifest.emits` array to include the new types:

```javascript
emits: ['response', 'user_message', 'stop', 'tts', 'ready', 'avatar_toggle']
```

### 5. Agent-side protocol documentation

Document the message protocol so agents know how to drive the chat canvas:

**Sending to canvas** (via `evalCanvas('chat', ...)` or coordination channel):
- `{type: 'assistant', content: [<Anthropic content blocks>]}` — agent message
- `{type: 'user', content: string}` — echo user's message (for display)
- `{type: 'status', text: string}` — status line
- `{type: 'clear'}` — reset conversation

**Receiving from canvas** (via canvas `onMessage` callback):
- `{type: 'response', value: string, tool_use_id: string}` — answer to AskUserQuestion
- `{type: 'user_message', text: string}` — unprompted user input
- `{type: 'stop'}` — user requested interrupt
- `{type: 'ready', ...manifest}` — canvas loaded
- `{type: 'avatar_toggle'}` — user toggled avatar visibility

## What's NOT in scope

- **Radial menu / chat trigger** — how the user opens the chat window is a radial menu design decision, not a chat concern. Currently opened via studio "Open Chat" button.
- **Claude API client** — the agent session already has one. The chat canvas is a display layer, not a conversation engine.
- **Session binding / multi-agent** — the avatar is the agent. One avatar, one agent, one chat.
- **Conversation persistence** — the agent harness owns history. The canvas is stateless (resets on close).
- **Streaming** — the current discrete-message protocol works. The agent can send partial content blocks as they arrive. True token-level streaming is a future enhancement.

## Implementation estimate

This is a small change — primarily JS modifications to `chat/index.html`:
- Unlock input (~5 lines changed)
- Split respond into response/user_message (~10 lines)
- Add stop button + emit (~20 lines HTML/CSS/JS)
- Manifest update (1 line)
- Protocol doc (new section in sigil CLAUDE.md or a standalone reference)
