# Daemon IPC v1 — Reference

> **See also:** [`CONTRACT-GOVERNANCE.md`](./CONTRACT-GOVERNANCE.md) for the
> rules governing daemon ↔ CLI capability contracts.

Wire contract between the `aos` CLI (and future SDK/MCP adapter) and the unified daemon. Canonical source: `shared/schemas/daemon-request.schema.json` and `shared/schemas/daemon-response.schema.json`. Historical design rationale: `docs/archive/superpowers/specs/2026-04-17-daemon-ipc-request-schema-v1-design.md`.

## Transport

Unix domain socket at `aosSocketPath()` (see `shared/swift/ipc/runtime-paths.swift`). Newline-delimited JSON. One request line produces one terminal response line; an action may emit schema-owned events before that response. Event stream (pushed events) follows `daemon-event.schema.json` v1 and shares the same connection once `see.observe`, private `see.capture`, or a future subscribe action opens it.

## Envelope

Request:
```json
{"v":1,"service":"tell","action":"send","data":{"audience":["human"],"text":"hi"},"ref":"r-42"}
```

Success response:
```json
{"v":1,"status":"success","data":{"routes":[{"audience":"human","route":"voice","delivered":true}]},"ref":"r-42"}
```

Validated no-side-effect response:
```json
{
  "v": 1,
  "status": "dry_run",
  "data": {
    "owner": "io.example.app",
    "item_id": "tool",
    "action_id": "activate",
    "generation": 7,
    "descriptor_revision": 3,
    "action_sequence": 1,
    "event_type": "primary_activation",
    "bounds": { "x": 1, "y": 2, "width": 24, "height": 24, "origin_x": 13, "origin_y": 14, "display_id": 1 },
    "anchor": {
      "schema_version": "aos.status_item.anchor.v1",
      "anchor_id": "native-status-item/io.example.app/tool",
      "host": "native_status_item",
      "coordinate_space": "global_display_top_left",
      "visible": true,
      "bounds": { "x": 1, "y": 2, "width": 24, "height": 24, "origin_x": 13, "origin_y": 14, "display_id": 1 },
      "display": {
        "id": 1,
        "frame": { "x": 0, "y": 0, "width": 1920, "height": 1080, "origin_x": 960, "origin_y": 540 },
        "visible_frame": { "x": 0, "y": 24, "width": 1920, "height": 1056, "origin_x": 960, "origin_y": 552 }
      },
      "topology": { "display_count": 1, "display_ids": [1], "truncated": false }
    }
  },
  "ref": "r-43"
}
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
| `see.capture` | Private single-owner native still transaction; emits ordered `see.capture_chunk` events before a metadata-only response. | `capture_id`, `display_topology`, `displays`, `display_ids`, `excluded_window_ids`, `window_targets`, `maximum_pixels_per_display`, `shows_cursor`. |
| `show.create` | Create a canvas. | `id` + one geometry source (`at`, `track`, `surface`, `anchor_window+offset`, `anchor_channel+offset`) + one content source (`html`, `url`). |
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
| `voice.list` | List voice registry entries. | optional `provider`; optional `speakable_only`. |
| `voice.assignments` | List session-centric voice assignments. | (none) |
| `voice.refresh` | Re-enumerate voices from all providers. | (none) |
| `voice.providers` | List providers with availability and catalog counts. | (none) |
| `voice.bind` | Bind a voice to a session. | `session_id`; optional `voice_id`; optional simple filter fields (`provider`, `gender`, `locale`, `language`, `region`, `kind`, `quality_tier`, `tags`). |
| `voice.next` | Cycle the session voice forward within the filtered pool and audition it. | `session_id`. |
| `voice.final_response` | Harness-ingress for final-response TTS. | `hook_payload` (optionally `session_id`, `harness`). |
| `status_item.register` | Acquire a connection-scoped native status-item lease. | `descriptor` (`aos.status_item.descriptor.v1`). |
| `status_item.update` | Compare-and-swap a lease descriptor. | `owner`, `item_id`, `generation`, `current_revision`, `descriptor`. |
| `status_item.inspect` | Inspect an exact lease generation and descriptor revision. | `owner`, `item_id`, `generation`, `descriptor_revision`. |
| `status_item.invoke` | Atomically admit and invoke a declared status-item action. | `owner`, `item_id`, `action_id`, `generation`, `descriptor_revision`, `action_sequence`. |
| `status_item.invoke_dry_run` | Validate an invocation without reserving its action sequence. | Same as `status_item.invoke`; returns a `dry_run` response envelope. |
| `operation.list` | List operations in the mechanically authenticated owner set, narrowed by optional metadata filters. | `request_id`, `canonical_parameter_digest`, `filters`. |
| `operation.inspect` | Inspect one exact operation generation. | `request_id`, `canonical_parameter_digest`, `selector`. |
| `operation.status` | Read compact status for one exact operation generation. | `request_id`, `canonical_parameter_digest`, `selector`. |
| `operation.recent` | List bounded recent terminal operations for the authenticated owner set. | `request_id`, `canonical_parameter_digest`, `filters`. |
| `operation.cancel` | Request cooperative cancellation of one exact owned operation. | `request_id`, `canonical_parameter_digest`, `selector`. |
| `operation.kill` | Force-stop one exact owned operation and retain cleanup visibility. | `request_id`, `canonical_parameter_digest`, `selector`. |
| `operation.kill_owner` | Stop the authenticated owner-set intersection selected by optional attribution/capability filters. | `request_id`, `canonical_parameter_digest`, `filters`. |
| `operation.tap` | Return current typed tap unavailability without opening or sampling a tap. | `request_id`, `canonical_parameter_digest`. |
| `operation.artifact_reveal\|artifact_remove\|artifact_release\|artifact_retain` | Return current typed artifact-custody unavailability without lookup or mutation. | `request_id`, `canonical_parameter_digest`. |
| `operation.stop_all` | Same-effective-UID stop over the immutable registered-set snapshot at the expected barrier generation. | `schema_version`, `action`, `request_id`, `canonical_parameter_digest`, `expected_barrier_generation`. |
| `operation.barrier_status` | Read the current host barrier snapshot, progress, and residual facts. | `schema_version`, `action`, `request_id`, `canonical_parameter_digest`. |
| `operation.reopen` | Reopen admission after prior and current registered sets reconcile. | `schema_version`, `action`, `request_id`, `canonical_parameter_digest`, `expected_barrier_generation`. |
| `system.ping` | Daemon health, identity, and uptime. | (none) |
| `focus.list` | List focus channels. | (none) |
| `focus.create` | Create an exact native focus channel. | `id`, `window_id`; optional owner assertion `pid`, exact AX `subtree`, and `depth`. |
| `focus.update` | Update an exact native focus channel. | `id`; optional exact AX `subtree` and `depth`. |
| `focus.remove` | Remove a focus channel. | `id`. |
| `graph.displays` | Display topology graph. | (none) |
| `graph.windows` | Window topology graph. | (none; optional `display`). |

Native focus-channel creation validates the current layer-zero CG window owner,
then resolves exactly one AX window root and exactly one requested subtree
before publishing state. Traversal depth is an integer from 0 through 15. A
supplied PID is an assertion and must equal the live owner; it is never
alternate authority. Refresh requires non-empty evidence and an identical
second live owner/integral-bounds/display/scale observation after AX traversal.
Candidate state, atomic file replacement, removal, and callbacks are serialized;
rejection never refreshes the last good timestamp or file. Native Accessibility
access is therefore required for native focus-channel publication; browser
focus sessions use their separate browser registry path.

`see.capture.data` is closed at every nesting level. `display_topology` is the
complete canonical `aos.display-topology.v1` snapshot. Each `displays[]` item is
only `{display_id,index,topology_ordinal}`; it maps runtime native IDs to the
canonical member and carries no independent geometry or identity authority. The
daemon rebuilds the topology identity and native/DesktopWorld geometry before
admission. Window targets bind a unique positive window ID to its positive
owner PID, canonical integral expected live bounds, selected display, and
`fallback` policy. A
`display` target preserves best-effort window capture and may return the
full-display still with explicit fallback metadata. A `none` target admits only
an exact current owner/bounds match fully contained by the selected display;
the daemon prepares no display still and fails the transaction if exact window
pixels are unavailable. Targets may not name excluded windows. Counts, exact
integers, finite geometry, selection order, and checked per-display/aggregate
pixel budgets are bounded.

One admitted transaction owns warm quiescence, still callbacks, and restoration
under a 24-second monotonic daemon deadline. For `fallback=display`, a requested
window is preferred; missing, moved, invalid, or failed window capture uses the
full-display still from the same content observation and broker transaction.
For `fallback=none`, any such mismatch or failure ends the transaction before
display bytes are streamed. Final frame metadata
is closed and labels `capture_source="display"|"window"`,
`window_fallback`, and `window_id` only for a window source. The consumer uses
one 25-second monotonic foreground budget inside its 30-second outer deadline.
| `graph.deepen` | Expand a graph node. | `id`. |
| `graph.collapse` | Collapse a graph node. | `id`. |
| `content.status` | Query content server status (port + roots). | (none) |

Status-item invoke data is validated from the original envelope `data` object
at the typed request boundary, before generic envelope shaping or action
admission. The field set is closed; caller-supplied `action`, `__envelope_ref`,
and `__envelope_active` are rejected. The shared IPC parser uses
`JSONSerialization` and materializes each JSON object as a dictionary before
that boundary; duplicate raw keys are therefore not independently detectable
or rejected there. This contract enforces the resulting typed key set, not raw
duplicate-key occurrence.

Operation request data is closed and action-specific. The public caller never
sends an owner root, PID/PGID, effective UID, caller-origin evidence,
`human_initiated`, approval, or policy field. The daemon attaches immutable
socket-peer and caller-origin context after schema validation, recomputes
`canonical_parameter_digest`, and rejects stale daemon, operation, resource,
adapter-registry, or barrier generations before mutation. `filters` contain
attribution and adapter-selected capability metadata only; they intersect the
mechanically authenticated ordinary owner set.

`operation.tap` and the four `operation.artifact_*` actions are parameterless
apart from the CLI-attached request identity and canonical parameter digest.
Tap returns `OPERATION_TAP_UNAVAILABLE`; every artifact action returns
`OPERATION_ARTIFACT_CUSTODY_UNAVAILABLE`. These current routes perform no tap
sampling, artifact lookup, or custody mutation.

The private `operation.external_spawn_intent`,
`operation.external_spawn_child_admit`, `operation.external_spawn_abandon`, and
`operation.external_spawn_finalize` actions bind only the invocation-scoped
registered `listen --source microphone` adapter; non-microphone `listen` never
enters this plane. Intent carries only content-free executable/script/argv
digests, the reviewed dependency-set digest, the exact signed-Node identity,
and registration revisions. The daemon durably prepares the operation and
exclusive microphone claim before spawn, then returns one opaque parent-only
lifecycle token.

The dispatcher starts tokenless Node as a blocked `--input-type=module -`
process. Child admission requires the exact authenticated intent-parent
generation, token, child PID generation and parent edge. The daemon dynamically
validates the live SecCode guest against Apple generic anchor, signing identifier
`node`, Node.js Foundation team `HX7739G8FX`, and hardened-runtime signing flag;
then it compares the 20-byte SHA-256 platform CDHash (algorithm label
`sha256_truncated_cdhash_20_bytes`) and mapped main-executable vnode device/inode
to the intent. Only after that durable admission does the exact AOS dispatcher
write the reviewed in-memory module bundle. No script or helper pathname reaches
the child.

Finalize is tokenless. The daemon resolves exactly one admitted intent from the
mechanically authenticated child peer generation, revalidates the admitted edge,
live executable and closed argv shape, and consumes it once. The durable record
and receipt retain content-free hashes only; raw dependency identities and the
token are never returned to the child. Parent-authenticated abandon, bounded
server expiry, and boot recovery remove the pending intent and terminalize the
prepared operation and claim without authority. Abandon replay is bounded and
idempotent; abandon after finalize fails closed and never stops active authority.

## Error Codes

| Code | Meaning |
|------|---------|
| `MISSING_ARG` | Required field absent or empty. |
| `INVALID_ARG` | Field has unacceptable value. |
| `UNKNOWN_ACTION` | `(service, action)` not in catalog. |
| `UNKNOWN_SERVICE` | `service` is not one of the declared request namespaces. |
| `PARSE_ERROR` | Request not JSON, schema violation, or non-envelope request. |
| `SESSION_NOT_FOUND` | Referenced `session_id` is not registered. |
| `MISSING_SESSION_ID` | Daemon could not resolve a session id for an action that requires one. |
| `VOICE_NOT_FOUND` | `voice.bind` target URI does not exist in the registry snapshot, or the `voice.next` filtered pool resolved to zero voices. |
| `VOICE_NOT_SPEAKABLE` | `voice.bind` target exists but cannot synthesize in this version. |
| `VOICE_NOT_ALLOCATABLE` | `voice.bind` target exists and is speakable, but policy or availability blocks selection. |
| `CANVAS_NOT_FOUND` | Referenced canvas `id` does not exist. |
| `PERMISSION_DENIED` | macOS permission (Accessibility, Screen Recording) missing. |
| `DESKTOP_FRAME_BUSY` | Another daemon-owned native pixel transaction is active. |
| `DESKTOP_FRAME_CAPTURE_FAILED` | The admitted native capture or transfer failed. |
| `DESKTOP_FRAME_DISPLAY_NOT_FOUND` | A selected native display disappeared. |
| `DESKTOP_FRAME_PERMISSION_DENIED` | The daemon lacks Screen Recording permission. |
| `DESKTOP_FRAME_RETIREMENT_UNCERTAIN` | Native ownership did not settle authoritatively by its logical deadline. |
| `DESKTOP_FRAME_TOPOLOGY_MISMATCH` | Canonical topology validation or frozen-source restoration detected drift. |
| `INPUT_TAP_NOT_ACTIVE` | Daemon is reachable but its global input tap is not active. Emitted by `do`-family preflight when the daemon's `system.ping` reports `input_tap.status != "active"`, and surfaced as `reason` in service install/start/restart responses when the tap-inactive branch is hit. |
| `OPERATION_TAP_UNAVAILABLE` | The current operation plane exposes no tap sampling route. |
| `OPERATION_ARTIFACT_CUSTODY_UNAVAILABLE` | The current operation plane exposes no artifact lookup or custody mutation route. |
| `INTERNAL` | Unexpected daemon error. |
| `INVALID_STATUS_ITEM_DESCRIPTOR` | Descriptor data is missing or malformed. |
| `INVALID_STATUS_ITEM_INSPECT` | Inspect identity is missing or malformed. |
| `INVALID_STATUS_ITEM_INVOKE` | Invoke data is missing, malformed, or contains an unsupported field. |
| `INVALID_STATUS_ITEM_MENU` | Descriptor menu data is malformed. |
| `INVALID_STATUS_ITEM_SCHEMA` | Descriptor schema version is unsupported. |
| `INVALID_STATUS_ITEM_UPDATE` | Update identity or descriptor data is missing or malformed. |
| `STATUS_ITEM_NOT_FOUND` | Requested status-item lease identity was not found. |
| `STATUS_ITEM_UNAVAILABLE` | The native status-item lease is unavailable. |
| `STATUS_ITEM_LEASE_BUSY` | Another connection owns the native status-item lease. |
| `STATUS_ITEM_UPDATE_REQUIRED` | A live lease must advance through the update operation. |
| `STATUS_ITEM_IDENTITY_MISMATCH` | Descriptor owner or item differs from the requested lease. |
| `STATUS_ITEM_REVISION_CONFLICT` | One descriptor revision names conflicting content. |
| `STATUS_ITEM_REVISION_NOT_ADVANCED` | An update descriptor did not advance the current revision. |
| `STATUS_ITEM_STALE_GENERATION` | Requested status-item lease generation is no longer active. |
| `STATUS_ITEM_STALE_REVISION` | Requested descriptor revision is no longer active within the lease generation. |
| `STATUS_ITEM_STALE_ACTION_SEQUENCE` | Requested action admission was already consumed or is not the current sequence. |
| `STATUS_ITEM_ACTION_NOT_FOUND` | Requested action is not declared by the active descriptor. |
| `STATUS_ITEM_ACTION_DISABLED` | Requested menu action is currently disabled. |
| `STATUS_ITEM_ANCHOR_UNAVAILABLE` | The native status-item anchor could not be derived. |
| `STATUS_ITEM_ACTION_SEQUENCE_EXHAUSTED` | The active lease generation cannot allocate another action sequence. |
| `STATUS_ITEM_EVENT_UNAVAILABLE` | Action admission was consumed, but event delivery failed; callers must not retry the consumed sequence. |

## Voice Payload Shapes

## Show Canvas Payload Notes

`show.create` accepts `surface:"desktop-world"` as the canonical logical
DesktopWorld surface request. It is mutually exclusive with `at`, `track`,
`anchor_window`, and `anchor_channel`. For compatibility, `track:"union"`
creates the same logical surface.

`show.create` and `show.update` accept optional `window_level` for native
canvas layering. Valid values are `automatic`, `floating`, `status_bar`, and
`screen_saver`; `automatic` preserves the daemon default for the canvas'
interactive mode.

The official `aos show create` client attaches optional `owner` metadata to
new canvases. This is diagnostic caller metadata, not a permission boundary or
lease scheduler. The daemon stores it with the canvas, child canvases inherit it
when they are created through a parent canvas, and it is exposed through
`show.list`, `show.get`, and `canvas_lifecycle` so consumers can quickly identify
which agent/session/worktree produced a visible surface. Current fields are
`consumer_id`, `harness`, `pid`, `cwd`, optional `worktree_root`, and
`runtime_mode`.

`show.list`, `show.get`, and `canvas_lifecycle` metadata include
`windowNumbers`, the native macOS window number or numbers backing a canvas.
Normal canvases report one entry. DesktopWorld surfaces keep one logical canvas
id while the daemon backs that id with one physical segment per active display;
for those surfaces `windowNumbers` is ordered to match `segments`.
`show.list`, `show.get`, and `canvas_lifecycle` metadata include `segments` for
DesktopWorld surfaces:

```json
{
  "id": "avatar-main",
  "owner": {
    "consumer_id": "codex-abc123",
    "harness": "codex",
    "pid": 4242,
    "cwd": "/Users/Michael/Code/agent-os-worktrees/example",
    "worktree_root": "/Users/Michael/Code/agent-os-worktrees/example",
    "runtime_mode": "repo"
  },
  "track": "union",
  "windowNumbers": [91234],
  "segments": [
    {
      "display_id": 1,
      "index": 0,
      "dw_bounds": [0, 0, 1512, 982],
      "native_bounds": [0, 0, 1512, 982]
    }
  ]
}
```

The ordered `segments` array is absent for normal canvases.

`daemon-response.schema.json` now includes `$defs.VoiceRecord` for the registry-backed voice payload returned by `voice.list`, `voice.refresh`, `voice.bind`, and the nested `voice` objects inside `voice.assignments`.

`VoiceRecord` fields:

- `id`, `provider`, `provider_voice_id`, `name`
- optional `display_name`, `locale`, `language`, `region`
- `gender`, `kind`, `quality_tier`, `tags`
- `capabilities { local, streaming, ssml, speak_supported }`
- `availability { installed, enabled, reachable }`
- `metadata` as JSON-safe passthrough values

`voice.providers` returns `ProviderInfo[]` with `name`, `availability { reachable, reason? }`, `voice_count`, and `enabled`.

## Versioning

## `system.ping` Payload

`system.ping` is the daemon-owned health/identity probe. In addition to `uptime`,
the response may include:

- `pid` — the serving daemon pid
- `mode` — `repo` or `installed`
- `socket_path` — the socket the daemon is currently serving
- `lock_owner_pid` — pid recorded in `daemon.lock` for the current mode
- `perception_channels` — total active perception attention channels
- `canvas_perception_channels` (array) — daemon-owned perception attention
  channels created from canvas event subscriptions. Each item includes
  `canvas_id`, `channel_id`, `depth`, `scope`, and `rate`.
- `input_tap` (object) — daemon-sourced structured view of the global input tap. Always present.
  - `status` — `active`, `retrying`, or `unavailable`.
  - `attempts` — startup attempt count.
  - `listen_access` (bool) — `CGPreflightListenEventAccess()` evaluated **inside the daemon process**. The CLI must not fabricate this from its own preflight.
  - `post_access` (bool) — `CGPreflightPostEventAccess()` evaluated inside the daemon.
  - `last_error_at` (string|null) — ISO 8601 timestamp of the most recent `CGEventTap` failure. `null` when no failure has occurred since daemon start.
  - `panic_passthrough_active` (bool) — whether the Force Quit input safety passthrough window is active.
  - `panic_passthrough_until` (string|null) — input safety passthrough deadline.
  - `panic_trigger` (string|null) — last safety shortcut trigger, currently `"cmd_opt_escape"` when set.
  - `panic_trigger_count` (int) — input safety shortcut trigger count.
- `permissions` (object) — daemon-sourced TCC view. Always present.
  - `accessibility` (bool) — `AXIsProcessTrusted()` evaluated inside the daemon.
  - `screen_capture_direct` (object) — bounded, process-lifetime direct
    capture consent state. It contains `capability="screen_capture_direct"`,
    `status=ready|permission_required|unsupported|failed`,
    `capture_persisted=false`, and a nullable typed `error_code`. Arbitrary
    native diagnostics and the discarded setup frame remain outside this
    status contract. Reading this object never invokes
    ScreenCaptureKit or macOS permission UI.

These fields are additive and intended for operator surfaces such as `status`,
`doctor`, and startup hooks that need to distinguish a healthy current daemon
from ownership mismatch or perception degradation.

Envelope `v` is an integer, currently `1`. Adding an action or an optional field does not bump `v`. Breaking wire changes bump `v`.

## Event Envelope Note

The event envelope (`daemon-event.schema.json` v1) uses `service` values
`perceive|display|act|voice|scene|annotation|status_item|see|operation`. The private `see`
service carries only ordered `capture_chunk` data with capture/topology identity,
bounded base64 bytes, exact integer metadata, byte counts, and SHA-256; it never
carries a path. Its correlated final success response is metadata-only and uses
the closed `SeeCaptureResponseData` shape. Capture consumers enforce one
absolute read deadline and a bounded NDJSON frame size. The `voice` service carries
generic dictation, microphone-capture, meter, and streamed-system-speech
lifecycle events. Media bytes, spoken text, and local paths remain on their
owning capture, transcription, speech, or playback channels and outside the
bounded lifecycle event envelope; their exclusion is not an ADR 0040 raw-output
gap. Transcription and product behavior remain consumer-owned.

The `operation` service emits only the closed content-free
`aos-operation-event-v1` vocabulary: `snapshot`, `state`, `progress`,
`terminal`, `residual`, and `barrier`. Every event binds daemon generation,
operation id/generation, sequence, timestamp, digest, and one typed detail
variant. It never carries raw operation data, media, text, URLs, paths, or
artifacts. The current `operation.tap` route exposes no raw observation and
returns `OPERATION_TAP_UNAVAILABLE`.

Public `aos listen --source hotkey|microphone --follow` and
`aos say --follow` are the sanctioned adapters for these connection-scoped
streams. Their internal v1 request actions are `listen.hotkey`,
`listen.microphone`, `listen.stop`, `listen.cancel`, `voice.speak`, and
`voice.cancel`. Disconnect cancels owned capture or speech and releases the
hotkey lease.

The daemon also owns internal `voice.microphone_authorization_status` and
`voice.microphone_authorization_request` actions. Their
`microphone_authorization` payload preserves `not_determined`, `restricted`,
`denied`, and `authorized`; request calls are attempted only from
`not_determined`. `system.ping.permissions` includes both boolean `microphone`
and exact `microphone_state`. Public readiness must fail closed when those live
daemon fields are absent, unknown, or non-authorized, regardless of foreground
CLI preflight.

The daemon similarly owns closed `permissions.screen_capture_direct_status` and
`permissions.screen_capture_direct_prime` actions. Status is passive. Prime is
the only action allowed to request screen-capture authorization and probe
ScreenCaptureKit while direct capture is unprimed, and returns no pixels,
paths, handles, or desktop facts. Both actions return their capability facts
under `data.screen_capture_direct`; this keeps the capability's `status`
distinct from the response envelope's transport status.

The live daemon additionally emits `system`, `coordination`, and `wiki` event
services outside the canonical event schema. Request-side namespaces differ
from event-side service values; that distinction remains explicit in v1.
