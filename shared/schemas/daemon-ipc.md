# Daemon IPC v1 — Reference

Wire contract between the `aos` CLI (and future SDK/MCP adapter) and the unified daemon. Canonical source: `shared/schemas/daemon-request.schema.json` and `shared/schemas/daemon-response.schema.json`. Design rationale: `docs/superpowers/specs/2026-04-17-daemon-ipc-request-schema-v1-design.md`.

## Transport

Unix domain socket at `aosSocketPath()` (see `shared/swift/ipc/runtime-paths.swift`). Newline-delimited JSON. One request line → one response line. Event stream (pushed events) follows `daemon-event.schema.json` v1 and shares the same connection once `see.observe` or a future subscribe action opens it.

## Envelope

Request:
```json
{"v":1,"service":"tell","action":"send","data":{"audience":["human"],"text":"hi"},"ref":"r-42"}
```

Success response:
```json
{"v":1,"status":"success","data":{"routes":[{"audience":"human","route":"voice","delivered":true}]},"ref":"r-42"}
```

Error response:
```json
{"v":1,"status":"error","error":"audience required","code":"MISSING_ARG","ref":"r-42"}
```

## Action Catalog

| (service, action) | Purpose | Required data fields |
|-------------------|---------|----------------------|
| `see.observe` | Open a perception attention channel and subscribe connection to events. | (none) |
| `see.snapshot` | Spatial snapshot from the daemon. | (none) |
| `show.create` | Create a canvas. | `id` + one geometry source (`at`, `track`, `anchor_window+offset`, `anchor_channel+offset`) + one content source (`html`, `url`). |
| `show.update` | Mutate canvas fields. | `id`. |
| `show.eval` | Evaluate JS inside a canvas. | `id`, `js`. |
| `show.post` | Post a message to a canvas. | `id`. |
| `show.remove` | Destroy a canvas. | `id`. |
| `show.remove_all` | Destroy all canvases. | (none) |
| `show.list` | List current canvases. | (none; optional `scope`). |
| `tell.send` | Emit to one or more audiences. | `audience` (non-empty array); exactly one of `text` or `payload`. |
| `listen.read` | Read recent channel messages. | `channel`. |
| `listen.channels` | List known channels. | (none) |
| `session.register` | Register session presence. | `session_id`. |
| `session.unregister` | Remove session presence. | `session_id` or `name`. |
| `session.who` | List online sessions. | (none) |
| `voice.list` | List voice bank. | optional `provider`; optional `speakable_only`. |
| `voice.assignments` | List session-centric voice assignments. | (none) |
| `voice.refresh` | Re-enumerate voices and reseed allocator order. | (none) |
| `voice.providers` | List providers with availability and catalog counts. | (none) |
| `voice.bind` | Bind a voice to a session. | `session_id`, `voice_id` (URI or bare id accepted). |
| `voice.final_response` | Harness-ingress for final-response TTS. | `hook_payload` (optionally `session_id`, `harness`). |
| `system.ping` | Daemon health, identity, and uptime. | (none) |
| `focus.list` | List focus channels. | (none) |
| `focus.create` | Create a focus channel. | `id`, `window_id`. |
| `focus.update` | Update a focus channel. | `id`. |
| `focus.remove` | Remove a focus channel. | `id`. |
| `graph.displays` | Display topology graph. | (none) |
| `graph.windows` | Window topology graph. | (none; optional `display`). |
| `graph.deepen` | Expand a graph node. | `id`. |
| `graph.collapse` | Collapse a graph node. | `id`. |
| `content.status` | Query content server status (port + roots). | (none) |

## Error Codes

| Code | Meaning |
|------|---------|
| `MISSING_ARG` | Required field absent or empty. |
| `INVALID_ARG` | Field has unacceptable value. |
| `UNKNOWN_ACTION` | `(service, action)` not in catalog. |
| `UNKNOWN_SERVICE` | `service` not one of the eleven known namespaces. |
| `PARSE_ERROR` | Request not JSON, schema violation, or legacy flat-string request. |
| `SESSION_NOT_FOUND` | Referenced `session_id` is not registered. |
| `MISSING_SESSION_ID` | Daemon could not resolve a session id for an action that requires one. |
| `VOICE_NOT_FOUND` | `voice.bind` target URI does not exist in the registry snapshot. |
| `VOICE_NOT_SPEAKABLE` | `voice.bind` target exists but cannot synthesize in this version. |
| `VOICE_NOT_ALLOCATABLE` | `voice.bind` target exists and is speakable, but policy or availability blocks allocation. |
| `CANVAS_NOT_FOUND` | Referenced canvas `id` does not exist. |
| `PERMISSION_DENIED` | macOS permission (Accessibility, Screen Recording) missing. |
| `INTERNAL` | Unexpected daemon error. |

## Voice Payload Shapes

`daemon-response.schema.json` now includes `$defs.VoiceRecord` for the registry-backed voice payload returned by `voice.list`, `voice.refresh`, `voice.bind`, and the nested `voice` objects inside `voice.assignments`.

`VoiceRecord` fields:

- `id`, `provider`, `provider_voice_id`, `name`
- optional `display_name`, `locale`, `language`, `region`
- `gender`, `kind`, `quality_tier`, `tags`
- `capabilities { local, streaming, ssml, speak_supported }`
- `availability { installed, enabled, reachable }`
- `metadata` as JSON-safe passthrough values

`voice.providers` returns `ProviderInfo[]` with `name`, `rank`, `availability { reachable, reason? }`, `voice_count`, and `enabled`.

## Versioning

## `system.ping` Payload

`system.ping` is the daemon-owned health/identity probe. In addition to `uptime`,
the response may include:

- `pid` — the serving daemon pid
- `mode` — `repo` or `installed`
- `socket_path` — the socket the daemon is currently serving
- `lock_owner_pid` — pid recorded in `daemon.lock` for the current mode
- `input_tap_status` — `active`, `retrying`, or `unavailable`
- `input_tap_attempts` — startup attempt count for the global input tap

These fields are additive and intended for operator surfaces such as `status`,
`doctor`, and startup hooks that need to distinguish a healthy current daemon
from ownership mismatch or perception degradation.

Envelope `v` is an integer, currently `1`. Adding an action or an optional field does not bump `v`. Breaking wire changes bump `v`.

## Transitional Carve-Outs

Bare `{"action":"subscribe"}` (non-envelope format) is still accepted for backward compatibility with streaming consumers like `aos listen --follow`. This will be cleaned up in a follow-up spec as clients migrate to the v1 envelope.

## Event Envelope Note

The event envelope (`daemon-event.schema.json` v1) uses `service` values `perceive|display|act|voice` in its enum today. The live daemon additionally emits `system`, `coordination`, and `wiki` event services. The request-side namespaces defined here (`see|do|show|tell|listen|session|voice|system`) differ from the event-side service values. Reconciling both sides is deferred to a v2 event envelope.
