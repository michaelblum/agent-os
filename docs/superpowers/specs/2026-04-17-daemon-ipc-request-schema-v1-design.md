# Daemon IPC Request/Response Schema (v1) — Design

**Status:** Proposed
**Date:** 2026-04-17
**Scope:** Wire contract for daemon requests and responses. Request side only. Event side is already standardized (see `shared/schemas/daemon-event.schema.json`) and stays at v1 unchanged.

## Background

The `aos` daemon already publishes events under a standardized envelope (`daemon-event.schema.json` v1): `{v, service, event, ts, data, ref}` over newline-delimited JSON. Event consumers across the repo (toolkit, MCP gateway, renderer) rely on this contract.

The **request side** is not standardized. `src/daemon/unified.swift` dispatches on a flat string `action` field with roughly twenty ad-hoc names:

```
subscribe, perceive, create, update, remove, remove-all, list, eval, post,
tell, coord-register, coord-unregister, coord-who, coord-read, coord-channels,
voice-list, voice-leases, voice-bind, voice-final-response, ping
```

Each action has a bespoke response shape. Some actions are duplicates (`subscribe` and `perceive` are identical handlers). Others are overloaded (`post` dispatches to the canvas manager or a channel relay depending on payload keys). There is no single source of truth that the CLI, a future TypeScript SDK, or the MCP gateway could all generate from.

This spec formalizes the request/response wire contract, normalizes the action vocabulary to the embodied verb taxonomy documented in `ARCHITECTURE.md` and `AGENTS.md`, and binds payloads to the daemon's existing behavior.

## Goals

1. Define a strict JSON envelope for requests and responses that mirrors the existing event envelope structurally.
2. Replace the flat action vocabulary with a two-field `(service, action)` taxonomy aligned to the loop verbs plus a small set of supporting namespaces.
3. Preserve every piece of behavior the daemon implements today. v1 is a faithful contract for current reality.
4. Produce JSON Schema files in `shared/schemas/` that the daemon, CLI, and (future) SDK can validate against.
5. Define a stable error-code vocabulary so consumers can branch on `code` without parsing prose.

## Non-goals

- No code generation (no TS SDK, no CLI generator, no MCP adapter work).
- No CLI rename. Top-level verb surface in `src/main.swift` is untouched by this spec. Renames happen in a later spec if pursued.
- No event envelope change. The existing `daemon-event.schema.json` v1 stays in place. The schema file currently lists the `service` enum as `perceive|display|act|voice`, but the live daemon already emits additional event services (`system` for config changes in `src/daemon/unified.swift:1207`, `coordination` for channel messages in `src/daemon/unified.swift:1487`, and `wiki` for wiki changes in `src/daemon/wiki-change-bus.swift:41`). That drift between the event schema and live traffic predates this spec and is out of scope. Asymmetry between request and event service values is documented below.
- No new capabilities. No aspirational fields. If the daemon does not already implement a behavior, the schema does not expose it.
- No deprecation shim for legacy action names. Unknown action names return a structured error. The same PR that introduces the schema updates the CLI to emit the new names.

## Envelope

### Request

```json
{
  "v": 1,
  "service": "tell",
  "action": "send",
  "data": { "audience": ["human"], "text": "hello" },
  "ref": "r-42"
}
```

| Field    | Type   | Required | Description |
|----------|--------|----------|-------------|
| `v`      | int    | yes      | Envelope version. Integer, not semver. Currently `1`. Bumped only on breaking wire changes. |
| `service`| string | yes      | Top-level namespace. One of `see`, `do`, `show`, `tell`, `listen`, `session`, `voice`, `system`. |
| `action` | string | yes      | Verb within the namespace. Snake_case. See action catalog below. |
| `data`   | object | yes      | Action-specific payload. Always an object, never null. An action with no parameters uses `{}`. |
| `ref`    | string | no       | Optional correlation ID. If present, the response and any correlated events echo it back. |

### Response (success)

```json
{
  "v": 1,
  "status": "success",
  "data": { "channel_id": "4F3D-…" },
  "ref": "r-42"
}
```

| Field    | Type   | Required | Description |
|----------|--------|----------|-------------|
| `v`      | int    | yes      | Matches request envelope version. |
| `status` | string | yes      | `"success"`. |
| `data`   | object | yes      | Response payload. Always an object, never null. |
| `ref`    | string | no       | Present if the request supplied `ref`. |

### Response (error)

```json
{
  "v": 1,
  "status": "error",
  "error": "session_id or name required",
  "code": "MISSING_ARG",
  "ref": "r-42"
}
```

| Field    | Type   | Required | Description |
|----------|--------|----------|-------------|
| `v`      | int    | yes      | |
| `status` | string | yes      | `"error"`. |
| `error`  | string | yes      | Human-readable description. |
| `code`   | string | yes      | Machine-readable code from the stable vocabulary below. |
| `ref`    | string | no       | Present if the request supplied `ref`. |

### Relationship to the event envelope

The event envelope (`daemon-event.schema.json` v1) uses the same top-level shape (`v`, `service`, `ts`, `data`, `ref`) and replaces `action` with `event`. Request and event envelopes are structurally symmetric except that the event envelope has `ts` and no `status`/`error`/`code`.

The event envelope's `service` field is unchanged by this spec. The schema file's existing enum (`perceive`, `display`, `act`, `voice`) is already understated relative to live traffic: the daemon emits `system`, `coordination`, and `wiki` event services today (see the Non-goals section). Consumers should be prepared for request namespaces (`see`, `show`, `do`, `tell`, `listen`, `session`, `voice`, `system`) and event services (current schema enum plus the live additions noted above) to differ. A future v2 event envelope may reconcile both the schema/live-traffic drift and the request/event asymmetry.

### Why not JSON-RPC 2.0

JSON-RPC 2.0 was considered. The decision is to mirror the existing aos event envelope instead, because:

- The aos ecosystem already has a shipped wire convention (`daemon-event.schema.json` v1). Introducing a second convention for request side would fragment the protocol.
- Two-field `(service, action)` dispatch is faster than splitting a dotted `method` string and maps cleanly to SDK namespaces and CLI subcommands.
- JSON-RPC 2.0 ceremony (`"jsonrpc":"2.0"`, numeric `id`) adds bytes without serving the use case.
- MCP adapter alignment is handled by `packages/gateway/`, which already translates daemon IPC for external consumers. Translating aos envelope to JSON-RPC 2.0 in the gateway is bounded work.

## Namespaces and Actions

The request vocabulary has eight namespaces: seven carry v1 actions, and `do` is reserved with none. `aos do` is implemented today as client-side CGEvent and AppleScript calls that do not require the daemon. `do` is kept in the `service` enum so that adding `do.*` actions in the future is additive.

| Namespace | Actions |
|-----------|---------|
| `see`     | `observe` |
| `do`      | *(reserved, no v1 actions)* |
| `show`    | `create`, `update`, `eval`, `remove`, `remove_all`, `list` |
| `tell`    | `send` |
| `listen`  | `read`, `channels` |
| `session` | `register`, `unregister`, `who` |
| `voice`   | `list`, `leases`, `bind`, `final_response` |
| `system`  | `ping` |

Total: 17 actions across 7 active namespaces (plus `do` reserved).

### Migration table from legacy action names

| Legacy action | Normalized `(service, action)` | Notes |
|---------------|--------------------------------|-------|
| `subscribe` | `see.observe` | Current handler opens a perception attention channel and subscribes the connection. `see.observe` preserves that combined behavior. |
| `perceive` | `see.observe` | Duplicate of the `subscribe` handler. Both collapse into `see.observe` in v1. |
| `post` (canvas branch, `id` present) | `show.create` / `show.update` / `show.remove` / `show.eval` / `show.remove_all` / `show.list` | The branch was already dispatching on the canvas request's inner `action`. v1 flattens: the outer action is the canvas verb. |
| `post` (channel branch, `channel` present) | `tell.send` with `audience: [<channel>]` and `payload` / `text` | Absorbed into unified emit. |
| `create`, `update`, `remove`, `remove-all`, `list`, `eval` (direct forms) | `show.create`, `show.update`, `show.remove`, `show.remove_all`, `show.list`, `show.eval` | Simple rename. |
| `tell` | `tell.send` | The handler (`handleTellAction`) stays; only the envelope changes. |
| `coord-register` | `session.register` | |
| `coord-unregister` | `session.unregister` | |
| `coord-who` | `session.who` | |
| `coord-read` | `listen.read` | |
| `coord-channels` | `listen.channels` | |
| `voice-list` | `voice.list` | |
| `voice-leases` | `voice.leases` | |
| `voice-bind` | `voice.bind` | |
| `voice-final-response` | `voice.final_response` | Retained as its own action in v1 because the payload is a harness-specific hook JSON, not agent-authored text. Future convergence with `tell.send` (purpose `final_response`) is possible in v2. |
| `ping` | `system.ping` | |

### Actions removed in v1

- The duplicate `perceive` / `subscribe` handler pair is collapsed: only one handler remains, exposed as `see.observe`. The other dispatch case is deleted.
- `post` — both branches are reabsorbed into `show.*` and `tell.send`.

### Behavioral changes in v1

Most of v1 is a rename plus an envelope. One deliberate narrowing is worth calling out explicitly because it is not pure renaming:

- **`session.register` requires `session_id`.** The legacy `coord-register` handler at `src/daemon/unified.swift:1072` accepts either `session_id` or `name` and falls back to `name` as the canonical session id when `session_id` is absent. v1 narrows this: `session_id` becomes the only canonical key on registration, and `name` is demoted to a pure display alias. The motivation is the architectural rule in `ARCHITECTURE.md` ("Session presence is keyed by canonical `session_id` / thread id. Human-readable names remain ancillary metadata"). The daemon still accepts legacy identifiers on `session.unregister` and `tell.send` audiences during the transition, so in-flight sessions registered under a `name` can still be addressed until they re-register.

Any request with `service` and `action` not listed in the catalog returns `code: "UNKNOWN_ACTION"`.

## Action Catalog

Each action is specified with its request `data` shape, its response `data` shape, and any constraints. Field types are JSON Schema. Fields marked `?` are optional.

### `see.observe`

Opens a perception attention channel for the connection and subscribes it to pushed events. This is the normalized form of the legacy `subscribe` and `perceive` handlers, which are identical in `src/daemon/unified.swift:955` and `src/daemon/unified.swift:971` and collapse into one in v1.

Request `data`:

| Field | Type | Default | Notes |
|-------|------|---------|-------|
| `depth` | int (0–3) | `config.perception.default_depth` | |
| `scope` | string | `"cursor"` | |
| `rate` | string | `"on-settle"` | |
| `events` | array of string | `[]` | Optional event-name filter for the snapshot replay. Does not filter the live stream today. |
| `snapshot` | bool | `false` | Replay current state for snapshot-capable streams after the success response. |

Response `data`: `{ "channel_id": string }`.

### `show.create`

Request `data`:

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `id` | string | yes | Canvas id. |
| `at` | `[x, y, w, h]` of numbers | conditional | Global CG coordinates. |
| `anchor_window` | int | conditional | CGWindowID to track. |
| `anchor_channel` | string | conditional | Focus channel id. |
| `offset` | `[x, y, w, h]` of numbers | conditional | Offset relative to anchor, in LCS. |
| `track` | string | conditional | Tracking target, e.g. `"union"`. |
| `html` | string | conditional | HTML content. |
| `url` | string | conditional | URL to load. Accepts `aos://` prefixes, which the daemon rewrites to its local content server. |
| `interactive` | bool | no (default `false`) | |
| `focus` | bool | no (default `false`) | Activate app and make window key. |
| `ttl` | number | no | Seconds until auto-remove. Omit for no expiry. |
| `scope` | string | no (default `"global"`) | `"connection"` or `"global"`. |
| `auto_project` | string | no | `"cursor_trail"`, `"highlight_focused"`, `"label_elements"`. |
| `parent` | string | no | Parent canvas id. |
| `cascade` | bool | no (default `true`) | Lifecycle cascade from parent. |
| `suspended` | bool | no (default `false`) | Create hidden/suspended. |

Constraints (JSON Schema `oneOf`):

- Exactly one geometry source: `at`, or `track`, or (`anchor_window` + `offset`), or (`anchor_channel` + `offset`).
- Exactly one content source: `html` or `url`.

Response `data`: the created `CanvasInfo` (see `src/display/protocol.swift`).

### `show.update`

Request `data`:

| Field | Type | Required |
|-------|------|----------|
| `id` | string | yes |
| `at` | `[x, y, w, h]` | no |
| `html` | string | no |
| `url` | string | no |
| `interactive` | bool | no |
| `ttl` | number \| null | no |
| `track` | string | no |

Response `data`: updated `CanvasInfo`.

### `show.eval`

Request `data`: `{ "id": string (required), "js": string (required) }`.
Response `data`: `{ "result": string }` — the JS return value serialized to string.

### `show.remove`

Request `data`: `{ "id": string (required) }`.
Response `data`: `{}`.

### `show.remove_all`

Request `data`: `{}`.
Response `data`: `{}`.

### `show.list`

Request `data`: `{ "scope"?: "connection" | "global" }`.
Response `data`: `{ "canvases": [CanvasInfo] }`.

### `tell.send`

The unified emit action. Absorbs the legacy `tell` action, the channel branch of legacy `post`, and the pattern `aos tell human …`.

Request `data`:

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `audience` | array of string | yes, non-empty | Each element is `"human"`, a channel name, or a canonical session id. The daemon routes per element. Multi-element arrays fan out. |
| `text` | string | conditional | Human-readable message. |
| `payload` | object | conditional | Structured message alternative. |
| `from_session_id` | string | no | Sending session's canonical id. Resolves lease-based shaping (e.g. voice selection). |
| `from` | string | no | Display-name override. Falls back to the sending session's display name, then to `"cli"`. |
| `purpose` | string | no | Shaping policy hint, e.g. `"final_response"`. |

Constraint: exactly one of `text` or `payload` is required (JSON Schema `oneOf`).

Response `data`: `{ "routes": [{ "audience": string, "route": string, "delivered": bool, ...route-specific fields }] }`.

Implementation note: `handleTellAction` already supports comma-separated audience strings today. Under v1, the wire form is a JSON array; the daemon normalizes both forms during the transition window inside the handler, but the schema only advertises the array form.

### `listen.read`

Request `data`:

| Field | Type | Required | Default |
|-------|------|----------|---------|
| `channel` | string | yes | |
| `since` | string | no | Message id cursor. |
| `limit` | int | no | `50` |

Response `data`: `{ "channel": string, "messages": [Message] }`.

### `listen.channels`

Request `data`: `{}`.
Response `data`: `{ "channels": [ChannelInfo] }`.

### `session.register`

Request `data`:

| Field | Type | Required | Default |
|-------|------|----------|---------|
| `session_id` | string | yes | |
| `name` | string | no | |
| `role` | string | no | `"worker"` |
| `harness` | string | no | `"unknown"` |

Response `data`: the coordination.registerSession result (existing shape), including canonical `session_id`, effective `role`, `harness`, lease state.

Note: this is a deliberate narrowing from legacy `coord-register`, which accepted either `session_id` or `name`. See the "Behavioral changes in v1" section above for rationale.

### `session.unregister`

Request `data`:

| Field | Type | Required |
|-------|------|----------|
| `session_id` | string | one-of |
| `name` | string | one-of |

At least one of `session_id` or `name` is required (JSON Schema `anyOf`).

Response `data`: `{}`.

### `session.who`

Request `data`: `{}`.
Response `data`: `{ "sessions": [SessionInfo] }`.

### `voice.list`

Request `data`: `{}`.
Response `data`: `{ "voices": [VoiceInfo], "voice_count": int, "leased_count": int }`.

### `voice.leases`

Request `data`: `{}`.
Response `data`: `{ "leases": [LeaseInfo], "lease_count": int }`.

### `voice.bind`

Request `data`: `{ "session_id": string (required), "voice_id": string (required) }`.
Response `data`: coordination.bindVoice result.

### `voice.final_response`

Harness-ingress action for final-response TTS. The payload is the raw hook JSON the harness emits at the end of a turn; the daemon extracts the assistant text and applies the configured shaping policy.

Request `data`:

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `session_id` | string | no | Canonical id of the session whose final response this is. If omitted, the daemon attempts to recover it from the hook payload. |
| `harness` | string | no | `"codex"` or `"claude-code"`. Selects the hook-payload extractor. |
| `hook_payload` | object | yes | Raw harness hook JSON. Field name matches `src/daemon/unified.swift:1511`. |

Response `data`: `{ "delivered": bool, "session_id": string }`.

### `system.ping`

Request `data`: `{}`.
Response `data`: `{ "uptime": number, "perception_channels": int, ...daemon health fields }`.

## Error Codes

The daemon emits `code` from this stable vocabulary. Consumers should branch on `code`, never on the prose in `error`. New codes can be added in subsequent schema revisions without bumping the envelope version.

| Code | Meaning |
|------|---------|
| `MISSING_ARG` | A required field in `data` was absent or empty. |
| `INVALID_ARG` | A field was present but had an unacceptable value or type. |
| `UNKNOWN_ACTION` | `(service, action)` pair is not in the catalog. |
| `UNKNOWN_SERVICE` | `service` is not one of the eight known namespaces. |
| `PARSE_ERROR` | The request could not be parsed as JSON, or the envelope failed schema validation. |
| `SESSION_NOT_FOUND` | A referenced `session_id` is not registered. |
| `MISSING_SESSION_ID` | The daemon could not resolve a session id for an action that requires one (used today by `voice.final_response` when extraction from the hook payload fails). |
| `CANVAS_NOT_FOUND` | A referenced canvas `id` does not exist. |
| `PERMISSION_DENIED` | The daemon lacks a required macOS permission (Accessibility, Screen Recording). |
| `INTERNAL` | Unexpected daemon error. The prose in `error` should name the subsystem. |

## Referenced Types

The action catalog above names shapes like `CanvasInfo`, `Message`, `ChannelInfo`, `SessionInfo`, `VoiceInfo`, and `LeaseInfo` without inlining their fields. These are types the daemon already returns today; they live in Swift at `src/display/protocol.swift` (CanvasInfo) and in the coordination subsystem (the rest). The v1 JSON Schema files port their existing field shapes verbatim. No type is introduced or mutated by this spec.

## Versioning

- `v` is a non-negotiable integer on every request and response. Currently `1`. Bumped only for breaking wire changes.
- The JSON Schema files in `shared/schemas/` carry their own semver for tooling (e.g. `$id` and `$version` keys). This is independent of `v`.
- Adding a new action does not bump `v`. Consumers that receive an unknown action in a response they did not initiate treat it as data they do not understand and ignore.
- Adding a new optional field to `data` does not bump `v`. Schemas use `additionalProperties: false` at the envelope level and `additionalProperties: true` inside `data` so consumers can tolerate additive payload fields.

## Files and Deliverables

These files are the intended artifacts of the implementation plan that follows this spec. They are listed here for scope clarity; the plan will break them into tasks with code-level detail.

| File | Role |
|------|------|
| `shared/schemas/daemon-request.schema.json` | JSON Schema for the request envelope, with per-action payload branches (`oneOf` keyed on `service` + `action`). |
| `shared/schemas/daemon-response.schema.json` | JSON Schema for success and error responses. |
| `shared/schemas/daemon-ipc.md` | Human-readable reference that mirrors this spec's action catalog and error table; the canonical doc under `docs/api/` links to it. |
| `src/daemon/unified.swift` | Refactored to dispatch on `(service, action)` via a table, validate against the schema, and normalize legacy behavior into the new handlers. The `perceive` and `post` branches are removed. `handleTellAction` is renamed internally but keeps its current logic. |
| `shared/swift/ipc/request-client.swift` | Helpers updated to build requests in the new envelope shape. |
| `src/commands/*.swift` | CLI call sites updated to emit the normalized action names. The top-level CLI verb surface is unchanged. |
| `tests/daemon-ipc-*.sh` | Contract tests per action, positive and negative. |

## Open Questions Resolved During Brainstorming

- **Namespace for session identity:** `session`, not `tell`, not `listen`. Presence is a separate concern from emit or absorb.
- **Voice namespace status:** top-level, not folded under `config`. Voice bank and leases are a coherent admin subsystem; folding into `config` obscures them.
- **`voice.final_response` placement:** stays its own action in v1 because the payload is a harness-hook envelope, not agent text. Possible convergence with `tell.send` (purpose `final_response`) deferred to v2.
- **Event envelope:** untouched. Request/event service asymmetry is documented, not fixed, in v1.

## Out of Scope (Future Work)

- Event envelope renormalization plus reconciliation of the schema's `service` enum with the live traffic superset (`system`, `coordination`, `wiki`). Deferred to a v2 event envelope.
- TypeScript SDK generation from the schema.
- CLI generation from the schema.
- MCP adapter regeneration.
- Daemon-side `show.wait`. Today `aos show wait` polls client-side in `src/display/client.swift:362`. Promoting it to a daemon action is deferred until there is a concrete consumer that benefits from blocking on the server.
- A daemon-side event-stream-only subscription distinct from `see.observe`. Adding a subscribe action that does not open a perception attention channel would be a new capability.
- `do.*` IPC actions for daemon-mediated input synthesis (if desired).
- Capability declarations on `session.register`.
- Deprecation shim for legacy action names (explicitly rejected in favor of atomic rename alongside CLI update).
