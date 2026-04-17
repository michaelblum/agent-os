# `aos` CLI API

Consumer-facing reference for the unified `aos` binary.

Use this doc when you are:

- writing agents that shell out to `aos`
- building wrappers around `aos`
- reviewing changes that affect the public CLI contract

For architecture and philosophy, see [ARCHITECTURE.md](../../ARCHITECTURE.md).

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
| `aos see` | Perception: cursor state, captures, observation streams, zones |
| `aos show` | Projection: canvas create/update/remove/list/eval/render |
| `aos do` | Action: mouse, keyboard, AX actions, AppleScript, session mode |
| `aos say` | Voice output |
| `aos tell` | Communication output: human, channel, or direct session routing |
| `aos listen` | Communication input: channel or direct session reads/follow |
| `aos set` | Runtime configuration |
| `aos serve` | Unified daemon |
| `aos content` | Content-server status |
| `aos service` | launchd lifecycle for the daemon |
| `aos runtime` | packaged runtime utilities |
| `aos doctor` | health and runtime diagnostics |
| `aos reset` | cleanup/reset workflows |
| `aos clean` | stale daemon / canvas cleanup |
| `aos permissions` | preflight and onboarding |
| `aos focus` | focus-channel management |
| `aos graph` | display/window graph queries |
| `aos daemon-snapshot` | daemon state snapshot |
| `aos inspect` | live AX inspector overlay |
| `aos log` | log overlay |
| `aos wiki` | local knowledge-base workflows |

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
- `--scope connection|global`
- `--track union`

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

## `aos tell`

Primary public forms:

| Form | Purpose |
| --- | --- |
| `<audience>\|--session-id <id> [--json <payload>] [--from <name>] [<text>]` | send text or JSON to `human`, a channel, a comma-separated mix, or one canonical session id |
| `--register [<legacy-name>] [--session-id <id>] [--name <name>] [--role <role>] [--harness <harness>]` | register session presence |
| `--unregister [<legacy-name>] [--session-id <id>]` | remove session presence |
| `--who` | list online sessions |

Examples:

```bash
aos tell human "Hello"
aos tell handoff "task complete"
aos tell human,handoff "done"
aos tell handoff --from wiki-focus "task complete"
aos tell --session-id 019d97cc-2f15-7951-b0bd-3a271d7fb97c "ready for review"
aos tell --register --session-id 019d97cc-2f15-7951-b0bd-3a271d7fb97c --name wiki-focus --role worker --harness codex
echo 'queued update' | aos tell handoff
```

If no text args and no `--json` payload are provided, `aos tell` reads plain text from `stdin`.

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

## Auxiliary Consumer Surfaces

These are still public, but they are more specialized:

| Command | Use when |
| --- | --- |
| `aos inspect` | you want the built-in live AX overlay |
| `aos log` | you want the built-in log console overlay |
| `aos permissions` | you need machine-readable readiness checks |
| `aos doctor` | you need a fuller runtime health snapshot |
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
- `aos serve` is the daemon entry point

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

## Guidance For Consumers

- Prefer structured flags and JSON parsing over scraping help output.
- Treat `docs/api/` as the consumer contract and `docs/superpowers/` as design history, not API reference.
- If you change a public command, update this doc in the same change.
