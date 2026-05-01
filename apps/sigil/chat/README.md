# Sigil Chat Canvas Protocol

`chat/index.html` is Sigil's bidirectional conversational canvas. Agents project
messages into the canvas through AOS canvas event delivery or a coordination
channel; the canvas does not run its own model runtime or transport adapter.

For generic `aos show` command forms, see
[`docs/api/aos.md`](../../../docs/api/aos.md). For provider-neutral broker
state consumed by toolkit and Sigil surfaces, see
[`docs/api/integration-broker.md`](../../../docs/api/integration-broker.md).

## Incoming Messages

The canvas manifest accepts these incoming message types:

| Message | Payload shape | Effect |
| --- | --- | --- |
| Assistant message | `{type: "assistant", content: [<blocks>]}` | Renders text, thinking, tool use, tool results, images, and execution results. |
| Echo user message | `{type: "user", content: string}` | Shows a user bubble without emitting a new user event. |
| Status line | `{type: "status", text: string}` | Replaces the transient status indicator. |
| Clear | `{type: "clear"}` | Clears conversation display and pending tool response state. |

Assistant `content` is an array of renderer-supported content blocks. Current
compatibility block names are `text`, `thinking`, `redacted_thinking`,
`tool_use`, `tool_result`, `image`, `server_tool_use`,
`web_search_tool_result`, `web_fetch_tool_result`,
`code_execution_tool_result`, and `bash_code_execution_tool_result`.

Special `tool_use` renderers:

- `AskUserQuestion` renders option buttons and routes the answer through a
  `response` event with the original `tool_use_id`.
- `TodoWrite` renders a checklist.
- `ExitPlanMode` renders a plan card.

Adapters should translate provider-native payloads into this renderer contract
before posting to the canvas.

## Outgoing Events

Events emitted through the canvas `emit()` helper are wrapped as:

```json
{ "type": "<name>", "payload": {} }
```

| Event | Payload | When |
| --- | --- | --- |
| `response` | `{value: string, tool_use_id: string}` | User answered an `AskUserQuestion` prompt. |
| `user_message` | `{text: string}` | User sent a free-form message. |
| `stop` | none | User requested interrupt. |
| `ready` | `{name, accepts, emits}` | Canvas loaded and announced its manifest. |
| `avatar_toggle` | none | User clicked the avatar dot in the chat header. |

The drag bridge is a legacy direct host-message path rather than the wrapped
`emit()` helper. It sends `drag_start`, `move_abs`, and `drag_end` messages with
position fields directly to the host message handler.

## Focus And Activity Hooks

The page exposes `focusInput()` so `aos show create --focus` and
`aos show update --focus` can focus the input once the page is ready.

Agents or host code can call `setActive()` while generation is in progress and
`setIdle()` when generation completes. Active state pulses the status dot and
shows the stop button; input remains enabled in either state.
