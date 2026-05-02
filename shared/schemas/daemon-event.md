# Daemon Event Envelope

Standard wire format for events pushed by agent-os daemons to subscribers.

## Wire Format

Newline-delimited JSON (ndjson) over Unix socket. One JSON object per line.

## Envelope

```json
{"v":1,"service":"perceive","event":"cursor_moved","ts":1712345678.123,"data":{"x":450,"y":320,"display":1}}
```

| Field     | Type   | Required | Description |
|-----------|--------|----------|-------------|
| `v`       | int    | yes      | Envelope version. Currently `1`. Bump only on breaking wire changes. |
| `service` | string | yes      | Emitting aos subsystem: `"perceive"`, `"display"`, `"act"`, `"voice"`. |
| `event`   | string | yes      | Event name. Snake_case, service-specific. |
| `ts`      | number | yes      | Unix timestamp, millisecond precision. |
| `data`    | object | yes      | Event payload. Structure is service + event specific. Always an object. |
| `ref`     | string | no       | Correlation ID linking event to a prior request. |

## Scope

The envelope covers **pushed events only** — the subscriber stream. Request/response protocols (e.g. `{"action":"create",...}` → `{"status":"success",...}`) remain service-specific and are not enveloped.

Why: requests and responses are internal to each daemon's API surface. Events are the shared public interface that any consumer can parse uniformly.

## Subscribing

Send on any daemon connection:
```json
{"action":"subscribe"}
```

Response: `{"status":"success"}`. All subsequent events on that connection use the envelope format.

Optional event filter (daemon may ignore if unsupported):
```json
{"action":"subscribe","events":["cursor_moved","element_focused"]}
```

Optional initial replay for snapshot-capable streams:
```json
{"action":"subscribe","events":["display_geometry","canvas_lifecycle"],"snapshot":true}
```

Today `snapshot:true` replays current state for `display_geometry` and
`canvas_lifecycle` immediately after the success response. For
`canvas_lifecycle`, the replay uses the same payload shape as live events,
including canvas metadata such as `parent`, `track`, `interactive`, `window_level`, `scope`,
`owner`, `windowNumbers`, the nested `canvas` object, and `segments` for DesktopWorld surfaces. For a
DesktopWorld surface, snapshot replay sends `canvas_topology_settled` before
the synthetic `created` lifecycle event so segment-aware renderers can identify
their topology before normal boot side effects run.

## Events by Service

### perceive

| Event | Data | Trigger |
|-------|------|---------|
| `cursor_moved` | `{x, y, display, velocity}` | Cursor position changed (tier 0) |
| `cursor_settled` | `{x, y, display, idle_ms}` | Cursor stopped moving for threshold ms |
| `window_entered` | `{window_id, app, pid, bounds}` | Cursor crossed into a different window (tier 1) |
| `window_moved` | `{window_id, bounds}` | Tracked window moved or resized |
| `app_entered` | `{app, pid, bundle_id}` | Cursor crossed into a different app (tier 1) |
| `focus_changed` | `{pid, window_id}` | Frontmost app/window changed |
| `channel_updated` | `{id}` | Focus channel state changed |
| `element_focused` | `{role, title, label, value, bounds, context_path}` | AX element under cursor changed (tier 2) |
| `element_detail` | `{...element_focused fields, children, parent, siblings}` | Subtree around element (tier 3, on demand) |

### display

| Event | Data | Trigger |
|-------|------|---------|
| `canvas_message` | `{id, payload}` | Canvas JS called postMessage |
| `canvas_lifecycle` | `{canvas_id, action, at, parent?, track?, interactive, window_level?, scope?, ttl?, cascade?, suspended?, owner?, windowNumbers?, canvas}` | Canvas created/removed/updated |
| `canvas_segment_added` | `{canvas_id, display_id, index, dw_bounds, native_bounds}` | DesktopWorld surface gained a display-backed segment |
| `canvas_segment_removed` | `{canvas_id, display_id, index, dw_bounds, native_bounds}` | DesktopWorld surface lost a display-backed segment |
| `canvas_segment_changed` | `{canvas_id, display_id, index, dw_bounds, native_bounds}` | DesktopWorld surface segment ordering or bounds changed |
| `canvas_topology_settled` | `{canvas_id, segments}` | Full ordered segment snapshot after a DesktopWorld surface topology batch |
| `channel_post` | `{channel, payload}` | Channel message relayed |

### act

| Event | Data | Trigger |
|-------|------|---------|
| `action_complete` | `{action, target, result}` | An action finished executing |
| `context_changed` | `{pid, window_id, bounds}` | Session context changed |

## Shared Types

`Bounds` from `annotation.schema.json`: `{x, y, width, height}`. Coordinate space depends on context — global CG for topology events, window-relative when scoped.

## Design Decisions

**Integer version, not semver.** The envelope is a wire protocol, not a package. Consumers check `v === 1`, not parse semver. Schema file has its own semver for tooling.

**`data` is always an object.** Never null, never a bare scalar. Consumers can always destructure without null checks.

**Event names are flat, not namespaced.** `cursor_moved` not `perceive.cursor.moved`. The `service` field already provides the namespace. Flat names are easier to match and less error-prone.

**No `type` field in the envelope.** The presence of `v` + `service` + `event` fields IS the type discriminator. Responses don't have these fields — they have `status` or `error`. Consumers check for `v` to distinguish envelope events from responses on the same socket.
