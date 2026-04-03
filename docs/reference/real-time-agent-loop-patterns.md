# Real-Time Agent Loop Patterns: Research Report

**Date:** 2026-04-02
**Context:** agent-os has three macOS CLIs (side-eye, hand-off, heads-up) with Unix socket daemons and event streaming. The orchestrating agent (Claude Code) is stuck in request-response, creating 30-60s latency. This report surveys established patterns for event-driven, real-time agent loops.

---

## 1. Anthropic's Agent Loop Architecture

### Claude Code: The Single-Threaded Master Loop

Claude Code's agent loop (internally codenamed "nO") is a **synchronous while-loop**: prompt enters, Claude evaluates, branches to tool calls or final text answer, tool results feed back, repeat until no tool calls remain. One flat list of messages. No concurrency between turns. No swarms.

The critical constraint: **this loop only advances when Claude produces output**. The model must respond before the next tool executes. There is no mechanism for external events to interrupt the loop mid-turn. The loop is inherently request-response at its core.

**What enables streaming:** SSE from the API. Claude Code sets `stream: true` on API requests and receives server-sent events as tokens are generated. This provides real-time *output* streaming, but does not enable real-time *input*.

**Source:** [How the agent loop works (Claude API Docs)](https://platform.claude.com/docs/en/agent-sdk/agent-loop), [Claude Code architecture analysis (ZenML)](https://www.zenml.io/llmops-database/claude-code-agent-architecture-single-threaded-master-loop-for-autonomous-coding)

### Claude Agent SDK: Streaming Input Mode

The Agent SDK adds a significant capability: **async generator input**. Instead of a single prompt string, you pass an `AsyncIterable` of messages that can yield dynamically based on conditions, time delays, or external triggers.

```
query({
  prompt: asyncGeneratorFunction(),  // yields messages over time
  options: { ... }
})
```

This is the closest Anthropic has to event-driven input. The generator can wait on external events and yield new user messages into the running session. However, it still feeds into the same single-threaded loop — the model must finish its current turn before processing the next yielded message.

**Key insight:** The async generator pattern enables *queued injection* of events, not true interrupt-driven processing. Messages queue up and process sequentially.

**Source:** [Streaming Input (Claude API Docs)](https://platform.claude.com/docs/en/agent-sdk/streaming-vs-single-mode)

### Claude Code Channels: The Event Push Mechanism

This is the most relevant pattern for agent-os. Channels are **MCP servers that push events into a running Claude Code session**. The channel stays open bidirectionally for the session's duration.

**Architecture:**
- A channel is an MCP server registered at session start via `--channels`
- External events (Telegram messages, Discord DMs, iMessages, webhooks) arrive at the MCP server
- The MCP server pushes them into the session as `<channel source="...">` events
- Claude reads the event and can reply back through the same channel
- Events only arrive while the session is open

**Transport:** MCP's standard transport (stdio for local plugins, Streamable HTTP for remote). Not a raw WebSocket.

**Limitations:**
- Events arrive into a terminal session — if Claude is mid-turn on a tool chain, the event queues until the current turn completes
- No true interrupt: Claude must finish what it's doing before processing the channel event
- Requires Claude Code running in a persistent terminal/background process
- Currently in research preview (requires v2.1.80+)

**Latency:** Low for idle sessions (event arrives, Claude processes immediately). High for busy sessions (must wait for current tool chain to complete). No sub-second guarantees.

**Applicability to agent-os:** HIGH. This is essentially the pattern we'd want — except it depends on Claude Code as the host, and events still queue behind the current turn. A custom orchestrator could do the same thing with our Unix socket daemons but without the turn-blocking constraint.

**Source:** [Claude Code Channels docs](https://code.claude.com/docs/en/channels), [Channels comparison (MindStudio)](https://www.mindstudio.ai/blog/claude-code-channels-vs-dispatch-vs-remote-control)

### Anthropic Computer Use Demo

The "pool table demo" and computer use system is a **Docker container running Ubuntu with VNC**, using a standard agentic sampling loop: screenshot → model decides action → execute action → screenshot → repeat. It is entirely polling-based with no event-driven component. The model takes a screenshot, counts pixels to determine click coordinates, executes the action, and screenshots again.

**Transport:** Standard API calls. No persistent connection, no event streaming.

**Latency:** Multi-second per cycle (screenshot + API round trip + execution). Not real-time.

**Applicability to agent-os:** LOW for architecture. The perception approach (screenshots + coordinate counting) is similar to side-eye but the orchestration pattern is pure polling.

**Source:** [Anthropic computer use demo (GitHub)](https://github.com/anthropics/anthropic-quickstarts/tree/main/computer-use-demo)

---

## 2. Perplexity Comet: Dual-Channel Architecture

Comet is the most sophisticated real-time agent architecture publicly documented, thanks to Zenity's reverse engineering.

**Architecture: SSE + WebSocket in parallel**

When a user submits a query, Comet opens two independent channels:

1. **SSE stream** (`/rest/sse/perplexity_ask`) — dedicated to the conversational UI. Streams model reasoning, citations, and final answers to the sidepanel.
2. **WebSocket** (`wss://www.perplexity.ai/agent`) — dedicated to browser automation. Handles high-frequency, bidirectional RPC for screenshots, clicks, form fills, and page reads.

The SSE stream delivers an `entropy_request` message (Perplexity's term for automation tasks) containing a `base_url` pointing to the WebSocket endpoint. A Sidecar component receives this, unpacks task parameters, and forwards them to the comet-agent Chrome extension via Chrome's extension messaging API. The extension then opens the WebSocket independently.

**The two channels operate in parallel** — the SSE stream delivers text to the user while the WebSocket simultaneously coordinates multi-step click sequences.

**WebSocket RPC actions:**
- `ComputerBatch` — sequences of clicks, drags, scrolls, keystrokes using pixel coordinates
- `FormInput` — form field manipulation by node reference
- `Navigate` — URL navigation
- `ReadPage` — accessibility tree extraction as YAML
- `GetPageText` — HTML-to-markdown conversion

**Voice:** Uses OpenAI Realtime API (Realtime-1.5) with WebRTC transport. Audio processing: 48kHz mono resampling, Opus codec, WebRTC APM for echo cancellation/noise reduction.

**Latency:** Sub-second for browser automation actions. The WebSocket channel eliminates the serialization overhead of SSE for high-frequency operations while keeping SSE for the lower-frequency conversational stream.

**Applicability to agent-os:** MEDIUM-HIGH. The dual-channel pattern (SSE for orchestrator conversation + WebSocket/Unix socket for tool automation) maps well to our architecture. heads-up already has a Unix socket for persistent connection; side-eye and hand-off could add the same. The orchestrator would maintain SSE/streaming to the LLM API while simultaneously maintaining persistent connections to the tool daemons.

**Source:** [Perplexity Comet: A Reversing Story (Zenity Labs)](https://labs.zenity.io/p/perplexity-comet-a-reversing-story), [Perplexity + OpenAI Realtime (OpenAI Developers)](https://developers.openai.com/blog/realtime-perplexity-computer)

---

## 3. OpenAI Realtime API

**Architecture:** A persistent WebSocket connection to OpenAI's servers. The connection stays open for the full session. Both client and server send JSON events bidirectionally.

**Event model:**
- Client sends: `session.update`, `input_audio_buffer.append`, `conversation.item.create`, `response.create`
- Server sends: `response.audio.delta`, `response.text.delta`, `response.function_call_arguments.delta`, `response.done`
- Interruption: client can send new input mid-response, causing the model to stop and process the interruption

**Transport options:**
- **WebSocket** — server-side, persistent connection, full-duplex JSON events
- **WebRTC** — browser-side, better for audio (handles echo cancellation, jitter buffering)

**Key capability for non-voice use:** The Realtime API supports text-based interactions alongside voice. You can `send_message()` with text, not just audio. Tool calling works the same way — the model emits function call events, the client executes them, and sends results back. All over the persistent WebSocket.

**OpenAI Agents SDK integration:**
```python
# Realtime agents in Python SDK
runner = RealtimeRunner(agent, transport=OpenAIRealtimeWebSocketModel())
# Agent stays connected, processes events in real-time
# Tools execute in background without blocking audio/text stream
```

**Latency:** Sub-second for text and voice. The persistent connection eliminates HTTP overhead. Audio streams bidirectionally with natural interruption.

**Applicability to agent-os:** MEDIUM. The event model is the right shape — persistent connection, bidirectional events, tool calling, interruption support. However, it's designed for OpenAI's models specifically. The architecture pattern (persistent WebSocket with typed JSON events) could be replicated for any model provider. The limitation is that Claude's API doesn't offer a comparable persistent-connection mode — it's still HTTP request/response with SSE streaming.

**Source:** [OpenAI Realtime API guide](https://developers.openai.com/api/docs/guides/realtime), [Realtime API WebSocket docs](https://developers.openai.com/api/docs/guides/realtime-websocket), [OpenAI Agents SDK realtime guide](https://openai.github.io/openai-agents-python/realtime/guide/)

---

## 4. Agent SDK Patterns Comparison

### Anthropic Claude Agent SDK
- **Input mode:** Async generator (streaming input) or single message
- **Event model:** SSE from API, async iteration of message types (SystemMessage, AssistantMessage, UserMessage, StreamEvent, ResultMessage)
- **Real-time support:** Streaming output yes, streaming input via async generator. No persistent connection to the API — each turn is an HTTP request.
- **Interruption:** Can cancel current generation and queue new messages

### OpenAI Agents SDK
- **Input mode:** Persistent WebSocket (Realtime) or HTTP (standard)
- **Event model:** `StreamEvent` objects via `async for event in result.stream_events()`
- **Real-time support:** Full duplex via Realtime API WebSocket. Standard mode is still request-response with SSE streaming.
- **Interruption:** Native in Realtime mode

### Google ADK (Agent Development Kit)
- **Input mode:** `LiveRequestQueue` — an asyncio FIFO queue that accepts any data type
- **Event model:** `run_live()` yields a stream of typed `Event` objects (text, audio, transcription, metadata, tools, errors — 7 types total)
- **Real-time support:** TRUE BIDIRECTIONAL. The queue decouples input arrival from processing. Inputs enqueue asynchronously while the agent processes. No turn boundaries — uses "cues like interruptions, explicit 'complete' signals, or agent transfers to delineate events."
- **Interruption:** Native "barge-in" — agent stops current action to address new input
- **State:** Sessions persist with conversation history, tool calls, media references

**Google ADK is the most architecturally advanced for real-time agent loops.** The `LiveRequestQueue` + `run_live()` pattern is exactly the event-driven model we're looking for. It eliminates the request-response bottleneck by design.

**Source:** [Google ADK streaming docs](https://google.github.io/adk-docs/streaming/), [Beyond Request-Response (Google Developers Blog)](https://developers.googleblog.com/en/beyond-request-response-architecting-real-time-bidirectional-streaming-multi-agent-system/), [ADK event handling guide](https://google.github.io/adk-docs/streaming/dev-guide/part3/)

---

## 5. MCP Streaming and Push Events

### What MCP Supports (Specification)

MCP has two mechanisms for server-to-client push:

1. **Resource Subscriptions:** Client sends `resources/subscribe` with a URI. Server sends `notifications/resources/updated` when that resource changes. But the notification contains ONLY the URI — the client must then request the actual content separately. This is a change notification, not a data push.

2. **Streamable HTTP Transport:** Replaced the older SSE-only transport in March 2025. Servers can use SSE to stream multiple messages back on a single HTTP connection. Supports session resumability via `Last-Event-ID` headers.

3. **Progress Notifications:** For long-running tools, servers can send progress notifications back to the client if the request included a `progressToken`.

### What MCP Does NOT Support

- True pub/sub with data payloads
- Unsolicited event push (server cannot push arbitrary events without a prior subscription)
- Persistent WebSocket connections (Streamable HTTP uses HTTP POST + optional SSE, not WebSocket)
- Real-time event streaming at high frequency

### The Implementation Gap

Despite the specification including resource subscriptions, **this pattern is largely unused in practice**. Most MCP clients (including Claude Code) don't actually leverage the subscribe capability. The notification payload is deliberately lightweight (URI only), making it unsuitable for real-time event data.

**Applicability to agent-os:** LOW for high-frequency events. MCP's notification model is designed for "something changed, go check" — not "here's what happened with full payload." For real-time events from heads-up canvases (clicks, drags, keyboard input), MCP's subscribe-then-poll pattern adds unnecessary round trips.

**However:** Claude Code Channels are MCP servers. So MCP is the *transport* for channel events, even though the events themselves bypass the subscribe/poll pattern by pushing directly into the session.

**Source:** [MCP Transports specification](https://modelcontextprotocol.io/specification/2025-03-26/basic/transports), [MCP Resources specification](https://modelcontextprotocol.io/specification/2025-06-18/server/resources), [MCP notification discussion](https://github.com/modelcontextprotocol/modelcontextprotocol/discussions/1192), [MCP has notifications — why can't your agent watch your inbox? (Mundada)](https://ankitmundada.medium.com/mcp-has-notifications-so-why-cant-your-agent-watch-your-inbox-bb688fde7ac5)

---

## 6. Runtime Server Architectures

### The Seven Hosting Patterns (James Carr)

A taxonomy of agent deployment models, with three relevant to our problem:

**Pattern 1: Persistent Long-Running Agent (Daemon)**
- Continuously executing process maintaining in-memory state
- Fast response times with maintained context
- Risk: process crashes lose state unless checkpointed
- This is what heads-up `serve` mode already is for canvases

**Pattern 2: Event-Driven Agent (Reactive)**
- Activates via webhooks, queue messages, or database changes
- "The bread and butter of most production agent deployments"
- Agents emit and listen for events autonomously
- Trade-off: serverless timeout constraints

**Pattern 3: Self-Scheduling Agent (Adaptive)**
- Agent determines its own next execution based on results
- Useful for monitoring where check frequency should adapt

**Source:** [Seven Hosting Patterns for AI Agents (James Carr)](https://james-carr.org/posts/2026-03-01-agent-hosting-patterns/)

### AG-UI Protocol (CopilotKit)

AG-UI is an open protocol standardizing bidirectional agent-frontend communication:

- **Transport:** SSE over HTTP (primary), optional binary channel
- **Event types:** Messages, tool calls, state patches, lifecycle signals — all self-describing JSON
- **State sync:** Typed shared store between agent and app, with event-sourced diffs and conflict resolution
- **Bi-directional:** Both agent and frontend can initiate events

**Key insight:** AG-UI separates the *agent backend protocol* from the *user interaction protocol*. The agent runs however it wants (ReAct, tree search, whatever). AG-UI is just the event stream between the agent and the UI. This clean separation is directly applicable to agent-os.

**Source:** [AG-UI Protocol (CopilotKit)](https://www.copilotkit.ai/ag-ui), [AG-UI docs](https://docs.ag-ui.com/)

### Letta (MemGPT) Server Architecture

Letta runs agents as persistent server processes behind REST APIs:

- Agent state persists in databases (not in-memory Python variables)
- Core memory blocks are always injected into the agent's prompt
- Agents can explicitly write, update, or delete their own memory
- The server handles session management across interactions

**Letta V1** modernized the agent loop by removing the explicit `send_message` tool and heartbeat mechanism from MemGPT, instead leveraging native model reasoning capabilities.

**Source:** [Letta V1 agent architecture](https://www.letta.com/blog/letta-v1-agent), [Letta GitHub](https://github.com/letta-ai/letta)

---

## 7. Existing Implementations

### Claude Code Channels (Most Directly Relevant)

The closest existing implementation to what we want. A running Claude Code session receives pushed events from external systems (Telegram, Discord, iMessage, webhooks) via MCP channel servers. Claude reacts and replies through the same channel.

**Limitation for agent-os:** The orchestrator IS Claude Code. We can't control the loop's timing, interrupt behavior, or event prioritization. Events queue behind the current turn.

### Open Claude Cowork

Open-source Electron app combining Claude Agent SDK with Composio Tool Router. Native macOS interface, persistent multi-session conversations, 500+ integrated tools. Demonstrates that the Agent SDK can power a desktop app with real-time streaming output.

### OpenClaw / ClawX

Persistent agent service with cron-based scheduling. Agents stay alive across sessions. Express API streams reasoning steps via SSE. Demonstrates the daemon pattern with event streaming.

### Google ADK Bidirectional Streaming Demo

The `bidi-demo` sample in `google/adk-samples` demonstrates true bidirectional streaming with `LiveRequestQueue` and `run_live()`. This is the most complete implementation of a real-time, interrupt-capable agent loop in any SDK.

**Source:** [ADK bidi-demo (GitHub)](https://github.com/google/adk-samples/tree/main/python/agents/bidi-demo)

---

## 8. Synthesis: What Would Work for agent-os

### The Core Problem

Claude's API is HTTP request-response. Even with SSE streaming, each turn requires a new HTTP request. There is no persistent WebSocket connection to Claude (unlike OpenAI Realtime). This means the orchestrator must mediate between:

- **Real-time event sources** (heads-up canvas events, side-eye perception triggers, file system watchers, human input) arriving continuously
- **A batch-oriented LLM API** that processes one turn at a time

### Recommended Architecture: Event Mediator + Async Queue

Modeled on Google ADK's `LiveRequestQueue` pattern, adapted for our Unix socket ecosystem:

```
                                    +------------------+
                                    |   Claude API     |
                                    |  (HTTP + SSE)    |
                                    +--------+---------+
                                             |
                                     Turn-based requests
                                             |
                              +--------------v--------------+
                              |     Orchestrator Process     |
                              |  (persistent, event-driven)  |
                              |                              |
                              |  +------------------------+  |
                              |  | Event Queue (FIFO)     |  |
                              |  | - prioritized          |  |
                              |  | - debounced            |  |
                              |  | - coalesced            |  |
                              |  +------------------------+  |
                              |                              |
                              |  +------------------------+  |
                              |  | State Store            |  |
                              |  | - conversation history |  |
                              |  | - active canvases      |  |
                              |  | - perception cache     |  |
                              |  +------------------------+  |
                              |                              |
                              |  +------------------------+  |
                              |  | Decision Engine        |  |
                              |  | - event → action map   |  |
                              |  | - interrupt policy     |  |
                              |  | - batching policy      |  |
                              |  +------------------------+  |
                              +-+------+------+------+------+
                                |      |      |      |
                         Unix   |      |      |      | Unix
                        socket  |      |      |      | socket
                                |      |      |      |
                          +-----+  +---+--+ +-+---+  +-----+
                          |heads |  |side  | |hand |  |file |
                          | -up |  | -eye | | -off|  |watch|
                          +------+  +------+ +-----+  +-----+
```

**How it works:**

1. **Event Sources** push events to the orchestrator via Unix sockets (already built for heads-up, extendable to side-eye and hand-off)
2. **Event Queue** receives all events, applies prioritization (human button click > mouse move), debouncing (coalesce rapid mouse moves), and batching (group related events)
3. **Decision Engine** decides what to do with queued events:
   - Some events trigger immediate LLM API calls (human clicked a labeled button)
   - Some events are handled locally without LLM (canvas resize)
   - Some events are batched and summarized before the next LLM turn ("user moved mouse to these 5 positions over the last 2 seconds")
4. **LLM Turn** processes the event summary and produces tool calls
5. **Tool calls** dispatch to the appropriate daemon via Unix socket
6. **Loop repeats** — but the event queue keeps filling even while the LLM is processing

### Transport Recommendations

| Connection | Transport | Why |
|-----------|-----------|-----|
| Orchestrator ↔ heads-up | Unix socket (already built) | Low latency, bidirectional, event streaming works |
| Orchestrator ↔ side-eye | Unix socket (add daemon mode) | Same pattern as heads-up |
| Orchestrator ↔ hand-off | Unix socket (add daemon mode) | Same pattern as heads-up |
| Orchestrator ↔ Claude API | HTTP + SSE | Only option Anthropic offers |
| Orchestrator ↔ human UI | WebSocket or AG-UI over SSE | Standard web real-time patterns |

### Latency Analysis

| Scenario | Current (polling) | With event mediator |
|----------|------------------|-------------------|
| Human clicks button in heads-up canvas | 30-60s (sleep + poll) | <1s (event fires immediately to queue, next LLM turn processes it) |
| Continuous mouse tracking | Not feasible | ~2-5s (batch + summarize + LLM turn) |
| Side-eye detects window change | Not feasible | ~1-3s (event → queue → LLM turn) |
| Response to text typed in overlay | 30-60s | <2s |

### Implementation Complexity

| Component | Effort | Notes |
|----------|--------|-------|
| Event mediator process | MEDIUM | New Node.js or Swift process. Core is an async event loop with a FIFO queue. ~500-1000 LOC. |
| side-eye daemon mode | MEDIUM | Follow heads-up's pattern. Unix socket server, subscriber management, event emission on perception changes. |
| hand-off daemon mode | LOW | Simpler — mostly receives commands, rarely emits events. Could remain stateless. |
| Decision engine | HIGH | The hard part. What events deserve an LLM turn? What can be handled locally? What should be batched? This is where policy and intelligence live. |
| AG-UI adapter | LOW-MEDIUM | Optional. Wraps the orchestrator's event stream in AG-UI protocol for any frontend. |

### What We Can Do Today (No New Infrastructure)

1. **Claude Code Channels** — Register heads-up as a channel plugin. Canvas events push directly into the Claude Code session. Requires Claude Code as the orchestrator (we're already using it). Limitation: events queue behind current turn, but this is still dramatically better than sleep+poll.

2. **heads-up `listen` as event bridge** — The `listen` command already opens a persistent connection and streams events to stdout. A wrapper script could pipe these events into Claude Code via the Agent SDK's streaming input mode (async generator). Events arrive as new user messages in the agent loop.

3. **File-based event queue with inotify** — Instead of polling a file on a timer, use `fswatch` or `kqueue` to detect file changes immediately. The file becomes a mailbox — tools write events to it, the orchestrator watches for changes. Latency drops from 30-60s to <1s. Crude but works without any new daemons.

---

## 9. Key Takeaways

1. **No current LLM API offers true event-driven agent loops.** OpenAI Realtime is the closest (persistent WebSocket), but it's designed for voice and limited to OpenAI models. Claude's API is strictly HTTP request-response with SSE output streaming.

2. **The bottleneck is the LLM turn, not the transport.** Even with instant event delivery, the model takes 2-10 seconds per turn. Real-time means "next turn starts immediately when an event arrives," not "sub-100ms response."

3. **Claude Code Channels is the closest existing solution** to what we want. It's literally "push events into a running agent session." The limitation is that we don't control the loop — Claude Code does.

4. **Google ADK's `LiveRequestQueue` is the best architecture pattern.** Decouple event arrival from processing. Queue events asynchronously. Let the agent consume from the queue at its own pace. Support interruption and barge-in.

5. **Our Unix socket infrastructure is the right foundation.** heads-up already has the daemon + subscriber + event push pattern. Extending this to side-eye and hand-off, then connecting all three to an event mediator, gives us real-time without changing any transport.

6. **The decision engine is the real challenge.** Transport is solved. Event delivery is solved (Unix sockets, SSE, WebSockets all work). The hard problem is: given a stream of events, which ones deserve an LLM turn, which can be handled locally, and which should be batched?

7. **Perplexity Comet's dual-channel pattern** (SSE for conversation + WebSocket for automation) validates our direction. Our equivalent: SSE to Claude API for reasoning + Unix sockets to tool daemons for execution.
