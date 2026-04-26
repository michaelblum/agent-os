# `aos` CLI API

Consumer-facing reference for the unified `aos` binary.

Use this doc when you are:

- writing agents that shell out to `aos`
- building wrappers around `aos`
- reviewing changes that affect the public CLI contract

For architecture and philosophy, see [ARCHITECTURE.md](../../ARCHITECTURE.md).

## Repo Development Entry Points

When you are developing inside the `agent-os` repo, invoke the binary as
`./aos`, not bare `aos`.

Start here:

```bash
./aos ready
./aos help <command> [--json]
./aos introspect review
```

`./aos ready` is the primary runtime readiness entrypoint. It starts/checks the
managed daemon and exits non-zero when AOS is not ready. Use `./aos status` for
a read-only runtime snapshot after that. Use `doctor`, `daemon-snapshot`, and
`clean` when you need deeper diagnostics or explicit cleanup, not as the default
first move.

## Contract

`aos` is a single binary with Unix-style subcommand groups.

Examples:

```bash
aos see cursor
aos show create --id demo --at 100,100,300,200 --html '<div>hello</div>'
aos do click 500,300
aos say "Hello"
aos tell handoff "task complete"
aos listen handoff
```

### Success / Failure

Success is emitted on `stdout` with exit code `0`.

```json
{
  "status": "success"
}
```

Failure is emitted on `stderr` with exit code `1`.

```json
{
  "error": "Human-readable description",
  "code": "MACHINE_READABLE_CODE"
}
```

Consumers should treat the JSON envelope and exit code as the contract, not incidental log text.

## Top-Level Surface

The current top-level commands are:

| Command | Role |
| --- | --- |
| `aos ready` | front-door readiness gate; starts/checks AOS and reports blockers |
| `aos status` | read-only runtime/session status snapshot |
| `aos ops` | source-backed operator recipes: list, explain, dry-run, run |
| `aos see` | Perception: cursor state, captures, observation streams, zones |
| `aos do` | Action: mouse, keyboard, AX actions, AppleScript, session mode |
| `aos show` | Projection: canvas create/update/remove/list/eval/render |
| `aos focus` | Focus-channel management |
| `aos graph` | Display/window graph queries |
| `aos introspect` | Session self-review over recent `./aos` usage |
| `aos help` | Registry and command-specific help |
| `aos say` | Voice output |
| `aos tell` | Communication output: human, channel, or direct session routing |
| `aos listen` | Communication input: channel or direct session reads/follow |
| `aos wiki` | local knowledge-base workflows |
| `aos config` | Discoverable runtime configuration (`get`, `set`, dump) |
| `aos set` | Runtime configuration |
| `aos content` | Content-server status |
| `aos serve` | Unified daemon |
| `aos service` | launchd lifecycle for the daemon |
| `aos runtime` | packaged runtime utilities |
| `aos permissions` | preflight and onboarding |
| `aos doctor` | detailed runtime and permission diagnostics |
| `aos clean` | explicit stale daemon / canvas cleanup |
| `aos reset` | cleanup/reset workflows |
| `aos daemon-snapshot` | daemon state snapshot |
| `aos inspect` | live AX inspector overlay |
| `aos log` | log overlay |

## Core Usage Patterns

### 1. Perceive, Then Act

```bash
aos see cursor
aos see capture main --base64
aos see capture --canvas canvas-inspector --perception --out /tmp/inspector.png
aos see capture --region 1172,442,320,480 --perception --out /tmp/inspector.png
aos do click 500,300
```

Typical consumer loop:

1. Use `aos see` to gather state.
2. Decide externally.
3. Use `aos do` or `aos show`.
4. Re-perceive if needed.

### 2. Create a Persistent Canvas

```bash
aos show create \
  --id demo \
  --at 100,100,320,200 \
  --interactive \
  --html '<div style="padding:16px;color:white">hello</div>'
```

Common follow-ups:

```bash
aos show update --id demo --at 150,120,320,200
aos show eval --id demo --js 'document.body.style.opacity = "0.7"'
aos show remove --id demo
```

### 3. Load Toolkit Content Through the Content Server

```bash
aos set content.roots.toolkit packages/toolkit
aos content wait --root toolkit --auto-start
aos show create \
  --id inspector \
  --at 100,100,320,250 \
  --interactive \
  --url 'aos://toolkit/components/inspector-panel/index.html'
aos show wait --id inspector --manifest inspector-panel
aos show post --id inspector --event '{"type":"inspector-panel/bootstrap","payload":{"note":"hello"}}'
```

### 4. Coordinate Through Channels or Direct Session Messaging

```bash
aos tell handoff "task complete"
aos tell handoff --from wiki-focus "task complete"
aos tell --session-id 019d97cc-2f15-7951-b0bd-3a271d7fb97c "ready for review"
aos tell --register --session-id 019d97cc-2f15-7951-b0bd-3a271d7fb97c --name wiki-focus --role worker --harness codex
echo 'queued update' | aos tell handoff
aos tell --who
aos listen handoff
aos listen --session-id 019d97cc-2f15-7951-b0bd-3a271d7fb97c --follow
```

## Subcommand Reference

## IPC Contract

Wire-level request/response contract between the CLI and daemon is specified in
[`shared/schemas/daemon-ipc.md`](../../shared/schemas/daemon-ipc.md). Agents and
tools that talk to the daemon directly (SDKs, MCP adapters) should use the v1
envelope there.

## `aos see`

Primary public verbs:

| Subcommand | Purpose |
| --- | --- |
| `cursor` | inspect what is under the cursor |
| `capture` | capture a target display/window/region |
| `observe` | stream perception events from the daemon |
| `list` | enumerate capture/display targets |
| `selection` | interactive region selection |
| `zone` | zone helpers |

Shorthand capture is supported:

```bash
aos see main
aos see external 1
aos see capture --canvas canvas-inspector --perception
aos see capture --region 1172,442,320,480 --perception
```

Useful capture modifiers include:

- `--window` to restrict `user_active`/window captures to the window frame
- `--region <x,y,w,h>` for explicit CG-coordinate regions
- `--canvas <id>` / `--channel <id>` for surface-relative captures
- `--exclude-window <CGWindowID>` to omit specific windows from a display/region capture
- `--perception` to attach spatial metadata alongside the image payload

`--perception` augments the capture response with:

- global capture bounds
- local capture bounds in the emitted image
- composite capture scale
- per-display surface segments when a region/canvas/channel spans multiple displays
- a `spatial-topology` snapshot for the same moment

## `aos show`

Primary public verbs:

| Subcommand | Purpose |
| --- | --- |
| `create` | create a canvas |
| `update` | mutate an existing canvas |
| `remove` | remove one canvas |
| `remove-all` | remove all canvases |
| `list` | list active canvases |
| `get` | fetch one canvas by id |
| `exists` | existence check for one canvas |
| `eval` | run JavaScript in a canvas |
| `render` | render HTML to an image without a persistent canvas |
| `listen` | persistent daemon stream / command pipe |
| `ping` | daemon liveness |
| `to-front` | raise canvas z-order |
| `post` | channel message post |

`create` accepts the main consumer-facing placement/content modes:

- `--id <name>`
- `--at x,y,w,h`
- `--html <html>`
- `--file <path>`
- `--url <url>`
- `--interactive`
- `--focus`
- `--ttl <duration>`
- `--scope connection|global` (default: `global`)
- `--track union`
- `--surface desktop-world` — canonical alias for `--track union`

`--surface desktop-world` and legacy `--track union` create one logical
DesktopWorld surface backed by one physical segment per active display. The
canvas keeps a single `id`; `show list` exposes a `segments` array with ordered
`{display_id,index,dw_bounds,native_bounds}` entries. Normal panels and `--at`
canvases are unchanged and do not carry `segments`. Existing normal canvases
cannot be converted into DesktopWorld surfaces with `show update`; remove and
recreate the canvas so it boots with the segmented backing.

## `aos ops`

`ops` is the source-backed operator recipe surface. It sits above primitive
verbs such as `status`, `show`, and `see`, but it keeps those primitive command
references visible so agents can inspect what will run.

| Subcommand | Purpose |
| --- | --- |
| `list` | list discoverable source-backed recipes |
| `explain <id>` | show the structured recipe plan |
| `dry-run <id>` | statically expand and validate a recipe without side effects |
| `run <id>` | execute a recipe |

V1 examples:

```bash
aos ops list --json
aos ops explain runtime/status-snapshot --json
aos ops dry-run runtime/status-snapshot --json
aos ops run runtime/status-snapshot --json
```

`ops dry-run` is static in v1: it does not start daemons, create canvases,
mutate resources, or run read-only observation probes. It validates the recipe,
resolves declared resources, verifies command-registry references, and returns
the planned steps. Without `--json`, it emits a concise text plan.

`ops run` initially supports the read-only `runtime/status-snapshot` recipe.
Mutating canvas smokes are intentionally deferred until ownership, cleanup,
TTL, timeout, and dry-run behavior are covered by tests. Without `--json`, it
emits a concise text summary on success.

`--json` follows the global process contract: success and dry-run success emit
JSON on stdout with exit code `0`; failure or partial cleanup emits JSON on
stderr with non-zero exit.

## `aos do`

Primary public verbs:

| Subcommand | Purpose |
| --- | --- |
| `click` | click at coordinates |
| `hover` | move cursor |
| `drag` | drag between coordinates |
| `scroll` | scroll at a point |
| `type` | type text |
| `key` | key combo |
| `press` | semantic AX press |
| `set-value` | semantic AX set-value |
| `focus` | semantic AX focus |

## `aos graph`

Primary public verbs:

| Subcommand | Purpose |
| --- | --- |
| `displays` | enumerate displays with logical `bounds`, `visible_bounds`, scale, and main-display marker |
| `windows` | enumerate visible windows, optionally scoped to one display |
| `deepen` | expand one focus-channel subtree |
| `collapse` | collapse one focus-channel subtree |

Example:

```bash
aos graph displays --json
```

`displays[].visible_bounds` uses the same top-left-origin logical coordinate
space as `bounds`, but reflects the usable display area after macOS menu bar /
dock insets.
| `raise` | raise an app/window |
| `move` | move a window |
| `resize` | resize a window |
| `tell` | AppleScript verb |
| `session` | interactive action session |
| `profiles` | inspect behavior profiles |

## `aos say`

Voice output surface:

```bash
aos say "Hello"
aos say --list-voices
```

`aos say` is sugar for `aos tell human ...`. Consumers that need one communication surface should prefer `aos tell`.

## `aos voice`

Inspect the registry-backed session voice catalog, provider availability, live
assignments, and final-response ingress:

```bash
aos voice list [--provider <name>] [--speakable-only]
aos voice assignments
aos voice bind --session-id <id> [--voice <voice-id>]
aos voice next --session-id <id>
aos voice refresh
aos voice providers
printf '%s' "$HOOK_JSON" | aos voice final-response --harness codex --session-id <id>
```

`aos voice` is backed by a provider-pluggable `VoiceRegistry`. The default
catalog includes:

- `system` — local `NSSpeechSynthesizer` voices
- `elevenlabs` — a catalog-only stub provider used for selection, validation,
  and future remote synthesis wiring

Voice selection is intentionally simple. A session keeps its explicitly bound
voice when it has one; otherwise the daemon rotates through a filtered pool of
speakable voices using a persistent integer cursor. The filter is driven by
`voice.filter.language` (default `en`) and `voice.filter.tiers` (default
`["premium", "enhanced"]`) in `config.json`; the cursor lives in `voice/policy.json`
and advances by one on each session-start assignment. Voices are reusable across
sessions. If the filter yields zero matches, the daemon falls back to a random
allocatable voice and records a `filter_empty` voice event. Cursor-picked
restored sessions whose persisted voice is no longer in the filtered pool have
that voice dropped on daemon startup (recorded as a `restore_voice_dropped`
voice event); the next session re-register re-picks through the cursor.
Explicit `voice.bind` assignments are treated as user-pinned and survive
restore-time revalidation regardless of the current filter. There is no
reservation, lease, or promotion model.

Voice identifiers are canonical URIs of the form
`voice://<provider>/<provider_voice_id>`. Commands accept either URI form or
legacy bare ids on input; responses emit canonical URIs for descriptor `id`
while keeping `provider_voice_id` as the provider-native suffix.

`aos voice list` returns the current registry snapshot. Use `--provider` to
filter to one provider and `--speakable-only` to drop catalog-only entries that
cannot currently synthesize. Records include provider metadata, canonical `id`,
provider-native `provider_voice_id`, availability, capabilities, locale, and
quality tier.

`aos voice assignments` returns the active session-centric assignments.

`aos voice bind` stores a concrete voice for a live session. If you omit
`--voice`, it will choose a random enabled + speakable voice, optionally
filtered by simple fields such as `--provider`, `--gender`, `--tag`, `--kind`,
`--locale`, `--language`, `--region`, or `--quality-tier`. Bind failures return
one of three machine codes:

- `VOICE_NOT_FOUND`
- `VOICE_NOT_SPEAKABLE`
- `VOICE_NOT_ALLOCATABLE`

`aos voice next --session-id <id>` cycles the session's voice forward within the
filtered pool without touching the global cursor, and auditions the new voice
by speaking `"Hi, I'm <name>."` through the system speech engine. If the
session's current voice is in the filtered pool, the next pick is the neighbour
one step ahead (wrapping around); if it is not in the pool (for example because
tiers changed), the daemon advances the global cursor to pick the next
rotation voice instead. `aos voice next` returns `SESSION_NOT_FOUND` when the
session is unknown and `VOICE_NOT_FOUND` when the pool is empty.

`aos voice refresh` forces a fresh provider enumeration. `aos voice providers`
lists provider reachability, policy enablement, and voice counts.

Voice policy lives at `~/.config/aos/{mode}/voice/policy.json` and is split
into four sections:

- `providers` — per-provider enable/disable gates
- `voices.disabled` — canonical voice ids to suppress from rotation, random fallback, and filter-based selection
- `session_preferences` — durable `session_id -> voice_uri` bindings
- `voice_cursor` — integer rotation cursor advanced on each new-session assignment

`aos voice final-response` is unchanged as the daemon-owned ingress for harness
final-response events. It resolves the final assistant text, applies the
configured `final_response` speech policy, and routes speech through the
session's assigned voice while keeping daemon cancel controls active.

Voice deliveries and final-response ingress failures append local JSONL records to
`~/.config/aos/{mode}/voice-events.jsonl` so operators can inspect which session,
voice, purpose, and failure code were involved without storing full message bodies.

## `aos config`

Discoverable configuration surface:

```bash
aos config
aos config get voice.enabled
aos config get content.port --json
aos config get see.canvas_inspector_bundle --json
aos config set voice.enabled true
aos config set voice.filter.language en
aos config set voice.filter.tiers premium,enhanced
aos config set see.canvas_inspector_bundle.hotkey cmd+shift+x
```

`aos config` dumps the current runtime config as JSON. `aos config get` defaults
to shell-friendly scalar text and accepts `--json` when you want JSON output.
Discoverable config subtrees include the Canvas Inspector see-bundle surface
under `see.canvas_inspector_bundle.*`, including the export hotkey and bundle
artifact include toggles. `aos set <key> <value>` remains supported as the
shorthand write form.

Failed CLI invocations now append local JSONL records to
`~/.config/aos/{mode}/cli-errors.jsonl`, which makes it easier to review
discoverability misses like unknown commands or missing arguments over time.

## `aos tell`

Primary public forms:

| Form | Purpose |
| --- | --- |
| `<audience>\|--session-id <id> [--json <payload>] [--from <name>] [--from-session-id <id>] [--purpose <name>] [<text>]` | send text or JSON to `human`, a channel, a comma-separated mix, or one canonical session id |
| `--register [<legacy-name>] [--session-id <id>] [--name <name>] [--role <role>] [--harness <harness>]` | register session presence |
| `--unregister [<legacy-name>] [--session-id <id>]` | remove session presence |
| `--who` | list online sessions |

Examples:

```bash
aos tell human "Hello"
aos tell human --from-session-id 019d97cc-2f15-7951-b0bd-3a271d7fb97c --purpose final_response "Done."
aos tell handoff "task complete"
aos tell human,handoff "done"
aos tell handoff --from wiki-focus "task complete"
aos tell --session-id 019d97cc-2f15-7951-b0bd-3a271d7fb97c "ready for review"
aos tell --register --session-id 019d97cc-2f15-7951-b0bd-3a271d7fb97c --name wiki-focus --role worker --harness codex
echo 'queued update' | aos tell handoff
```

If no text args and no `--json` payload are provided, `aos tell` reads plain text from `stdin`.

For `human` delivery, `--from-session-id` lets the daemon resolve that
session's leased voice, and `--purpose final_response` applies the configured
final-response shaping policy before speaking.

Direct routing should prefer canonical session ids. Human-readable names remain display metadata for `aos tell --who` and operator ergonomics.
Presence is lease-based and restored from the runtime snapshot after daemon restart. Discover peers with `aos tell --who`, then keep using direct `--session-id` routing once a peer id is known; direct session messaging does not require `--who` to be non-empty at send time.

## `aos listen`

Primary public forms:

| Form | Purpose |
| --- | --- |
| `<channel>\|--session-id <id> [--since id] [--limit N]` | read recent channel or direct-session messages |
| `<channel>|--session-id <id> --follow [--since id]` | stream messages as NDJSON |
| `--channels` | list known channels |

Examples:

```bash
aos listen handoff
aos listen handoff --limit 10
aos listen --session-id 019d97cc-2f15-7951-b0bd-3a271d7fb97c
aos listen --session-id 019d97cc-2f15-7951-b0bd-3a271d7fb97c --follow
aos listen --channels
```

One-shot reads return a JSON envelope with a `messages` array. `--follow` emits one message per line as NDJSON.

## `aos wiki`

Primary public verbs for knowledge-base consumers:

| Subcommand | Purpose |
| --- | --- |
| `list` | enumerate indexed wiki entries |
| `show` | fetch one page by path or bare name |
| `graph` | emit the canonical `wiki-kb` graph payload |
| `search` | full-text search across indexed pages |
| `invoke` | invoke a workflow/plugin entry |

`aos wiki graph --json` is the canonical graph projection for KB surfaces. It returns:

- `nodes`
- `links`
- optional `raw` page bodies when `--raw` is requested
- `config` for default graph-view behavior

## Auxiliary Consumer Surfaces

These are still public, but they are more specialized:

| Command | Use when |
| --- | --- |
| `aos inspect` | you want the built-in live AX overlay |
| `aos log` | you want the built-in log console overlay |
| `aos permissions` | you need low-level permission diagnostics |
| `aos doctor` | you need a fuller runtime health snapshot than `aos status` |
| `aos clean` | `aos status` reports stale resources and you want explicit cleanup |
| `aos daemon-snapshot` | you need the low-level spatial snapshot directly |
| `aos focus` / `aos graph` | you are consuming focus channels / display-window topology |
| `aos wiki` | you are consuming the local wiki/plugin system |

## Daemon Model

`aos` subcommands are normally stateless at the call site, but several surfaces rely on the daemon behind the scenes:

- persistent canvases
- perception observation
- focus channels
- content server hosting

Consumers should assume:

- `aos show`, `aos inspect`, and some graph/focus flows may talk to the daemon
- a persistent canvas outlives the creating command unless it is connection-scoped
- `aos serve` is the foreground daemon entry point
- `aos ready` is the front-door managed-daemon readiness gate
- `aos status` / `aos doctor` are observational; they should not be relied on to
  implicitly start a daemon for the current runtime

## Daemon-aware readiness

The daemon's `system.ping` response carries a structured `input_tap` block
and a `permissions` block sourced from inside the daemon process. Because
the launchd-managed daemon is a different process from the CLI, its TCC
grants can diverge from the CLI's. The fields below are the canonical view
when judging whether the daemon can actually observe and inject input.

```json
"input_tap": {
  "status": "active",        // active | retrying | unavailable
  "attempts": 1,
  "listen_access": true,     // CGPreflightListenEventAccess() in daemon
  "post_access": true,       // CGPreflightPostEventAccess() in daemon
  "last_error_at": null      // ISO-8601 of most recent CGEventTap failure
},
"permissions": {
  "accessibility": true      // AXIsProcessTrusted() in daemon
}
```

Consumers:
- `aos ready [--json] [--repair]` starts/checks the managed daemon, evaluates
  the existing readiness contract, exits `0` only when ready, and returns
  structured `phase`, `diagnosis`, `blockers`, `next_actions`, and
  `action_trace` fields for agents. `--repair` runs safe automated recovery
  steps first: restart, wait/recheck, then report plain-English human
  instructions when macOS privacy settings still require manual action. It does
  not open Settings or show permission dialogs by itself.
- `aos permissions check --json` exposes `daemon_view`, `cli_view`,
  `ready_source`, and `disagreement` fields. `ready_for_testing` is computed
  from the daemon view when reachable and from the CLI view as fallback.
  The top-level `permissions` object is the CLI-side view and includes
  `accessibility`, `screen_recording`, `listen_access`, and `post_access`.
  The daemon-side Accessibility and Input Monitoring view remains under
  `daemon_view` / `runtime.input_tap`; daemon Screen Recording is not reported.
- `aos permissions setup --once` checks the full CLI permission set
  (Accessibility, Screen Recording, Input Monitoring listen, Input Monitoring
  post). If the CLI grant is present but the daemon reports stale or missing
  daemon-owned grants, setup returns degraded with remove/re-add guidance
  instead of silently declaring onboarding complete.
- `aos status --json` exposes `runtime.input_tap` (full block) plus the
  legacy flat `runtime.input_tap_status` / `runtime.input_tap_attempts`.
- `aos status` text mode includes `tap=<status>` in the one-line summary.
- `aos doctor --json` exposes top-level `ready_for_testing` and
  `ready_source`.
- `aos service install`, `start`, and `restart` block-and-poll for up to 5s
  after launchctl kickstart and exit non-zero with `reason: "input_tap_not_active"`
  or `"socket_unreachable"` when the daemon is not fully ready.
- `aos do click/type/...` preflight exits with `INPUT_TAP_NOT_ACTIVE` when
  the daemon is reachable but its tap is inactive.

Test entry point: `aos service _verify-readiness [--json] [--budget-ms N]`
runs the readiness probe against the running daemon and emits the same
response shape `service install/start/restart` produce. Used by
`tests/input-tap-readiness-classifier.sh`. Not advertised in user help.

Example readiness response (`service _verify-readiness --json` against a
mock daemon reporting `tap=retrying`):

```json
{
  "status": "degraded",
  "mode": "repo",
  "installed": true,
  "running": true,
  "pid": 12345,
  "launchd_label": "com.agent-os.aos.repo",
  "expected_binary_path": "/Users/.../aos",
  "actual_binary_path": "/Users/.../aos",
  "plist_path": "/Users/.../Library/LaunchAgents/com.agent-os.aos.repo.plist",
  "state_dir": "/Users/.../.config/aos/repo",
  "reason": "input_tap_not_active",
  "input_tap": {
    "status": "retrying",
    "attempts": 3,
    "listen_access": false,
    "post_access": false
  },
  "recovery": [
    "./aos service restart",
    "./aos permissions setup --once",
    "./aos serve --idle-timeout none"
  ],
  "notes": [
    "Input tap is not active (status=retrying, attempts=3). Try: ..."
  ]
}
```

When the readiness probe outcome is `.ok`, the `reason`, `recovery`, and
`input_tap.last_error_at` fields are absent (omitted from JSON via
`encodeIfPresent`). The top-level `status` may still be `"degraded"` if
the launchd-derived base state has unrelated divergences (e.g., plist
binary path mismatch); discriminate `.ok` outcomes by absence of `reason`
plus `input_tap.status == "active"`.

### Legacy daemon interop

A daemon binary that predates this contract emits only the flat
`input_tap_status` / `input_tap_attempts` fields, with no structured
`input_tap` or `permissions` block. The CLI parser falls back to those
flat fields so `status` / `attempts` still propagate. Fields the legacy
daemon doesn't expose — `input_tap.listen_access`, `input_tap.post_access`,
`input_tap.last_error_at`, and `permissions.accessibility` — are
**omitted** from CLI output rather than fabricated as `false`. Consumers
should treat their absence as "unknown, not denied."

In that mode, the source label depends on which side provides the decisive
answer:

- When the reachable legacy daemon reports `input_tap.status == "active"`,
  `aos permissions check` and `aos doctor` fall back to
  `ready_source: "cli"` because daemon accessibility is still unknown.
- When the reachable legacy daemon reports `input_tap.status != "active"`,
  `ready_for_testing` is forced to `false` and `ready_source: "daemon"`
  because the daemon-owned tap status is sufficient to fail readiness
  closed, even though daemon accessibility remains unknown.

**See also:**
- [`shared/schemas/daemon-ipc.md`](../../shared/schemas/daemon-ipc.md) for the canonical `system.ping` payload schema.
- [`shared/schemas/CONTRACT-GOVERNANCE.md`](../../shared/schemas/CONTRACT-GOVERNANCE.md) for the contract rules these consumers follow.

## Content Server Contract

Toolkit and app canvases are typically loaded through `aos://...` URLs backed by the content server.

Minimal setup:

```bash
aos set content.roots.toolkit packages/toolkit
```

Then:

```bash
aos show create \
  --id canvas-inspector \
  --at 200,200,320,480 \
  --interactive \
  --url 'aos://toolkit/components/canvas-inspector/index.html'
```

Read-only virtual wiki graph endpoint:

- `GET /wiki/.graph`
- `GET /wiki/.graph?raw=1`

## Guidance For Consumers

- Prefer structured flags and JSON parsing over scraping help output.
- Treat `docs/api/` as the consumer contract and `docs/superpowers/` as design history, not API reference.
- If you change a public command, update this doc in the same change.
