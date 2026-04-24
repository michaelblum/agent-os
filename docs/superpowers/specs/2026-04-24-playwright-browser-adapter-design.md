# Playwright Browser Adapter — Design

**Date:** 2026-04-24
**Session:** playwright-spacesuit
**Status:** Draft for review
**Scope:** Make a browser a first-class target for `aos see`, `aos do`, and `aos show`, using Microsoft's `playwright-cli` as the underlying primitive. No changes to the daemon IPC schema. No new top-level verbs. All additions are additive to existing CLI surfaces.

## Context

aos already exposes an embodied verb model — `see`, `do`, `show`, `tell`, `listen`, `say` — over a unified Swift binary. The agent's "control surface" today covers macOS apps: `see capture` uses ScreenCaptureKit, `do click` uses CGEvent, `show create` uses WebKit canvases anchored by CGWindowID. A browser tab running inside Chrome is out of reach of that surface: the agent can screenshot the window as pixels, but it cannot perceive DOM structure, cannot interact by element, and cannot anchor overlays to page content that scrolls.

Microsoft's `playwright-cli` (9.2k⭐, active) is a token-efficient CLI wrapper over Playwright. It ships ref-first interaction (`click e21`, `fill e34 "hello"`), snapshot-derived YAML element trees, named in-memory sessions with `-s=<name>` + `--persistent` profiles, attach modes for already-running Chrome (`attach --extension`, `attach --cdp=chrome`), and a visual session dashboard. Its own README frames its design tradeoff cleanly: CLI for high-throughput coding agents (token-efficient, per-call), MCP for "specialized agentic loops that benefit from persistent state, rich introspection, and iterative reasoning." aos's primary use case is the former.

**Co-presence is a primary mode.** The user and agent often share one browser: the user demonstrates a flow, the agent observes and annotates, the user refines, the agent replays. This is not a follow-up capability — it shapes v1. The agent cannot live in a sibling headless browser while the user works in their real Chrome; the workflow loop requires both acting in the same tab.

**The design thesis.** aos wraps `playwright-cli` the same way it already wraps CGEvent, AppleScript, and AX: as an adapter at the seam, not a replacement. Agents get unified verbs (`aos see capture browser:…`, `aos do click browser:…`, `aos show create --anchor browser:…`). Raw `playwright-cli` remains directly callable as an escape hatch for Playwright-native primitives aos doesn't surface (tracing, codegen, route mocking, `run-code`). The space-suit metaphor is literal: one verb grammar, a browser-flavored "visor and claws" swap in under the hood when the target is a browser.

## Goals

1. Make a browser tab a valid target for `see capture`, `do <action>`, and `show create --anchor …` using a single target-addressing grammar (`browser:<session>[/<ref>]`).
2. Support both user-attached sessions (agent joins the user's running Chrome) and agent-launched sessions (headed or headless), with attach-mode as the primary codepath.
3. Map `playwright-cli` sessions 1:1 onto aos focus channels so the same channel-id vocabulary that addresses window/AX trees also addresses browser sessions.
4. Anchor `show` canvases to browser page elements using the existing `show.create --anchor_window + --offset` contract. v1 anchors are **static**: computed once at create time and re-tracked only for Chrome window movement (which the daemon already handles via `anchor_window`). Scroll, in-viewport resize, zoom change, and navigation invalidate the overlay until the agent re-issues `show update --anchor …`.
5. Preserve `playwright-cli` as a directly-callable escape hatch; never shadow or hide it.
6. Retire the `chrome-harness` skill in favor of a single aos-authored browser skill that wraps this adapter.

## Non-Goals

- No changes to the daemon IPC schema (`shared/schemas/daemon-request.schema.json`). All new behavior lives in the CLI process and the browser adapter subtree.
- No in-page overlay injection in v1 (option B from brainstorming). External window-anchored overlays only. In-page injection is a separate future spec.
- No workflow recording / replay / codegen wrapper in v1. `tracing-start`, `video-start`, and codegen remain raw `playwright-cli` escape-hatch calls.
- No MCP-native binding to `playwright-mcp`. aos does not consume Playwright's MCP server.
- **No MCP gateway exposure in v1.** `packages/gateway/sdk/aos-sdk.d.ts` ships typed helpers (`aos.click({x,y})`, `aos.capture({display,window,xray,...})`, `aos.createCanvas({at,...})`), not opaque-target wrappers. The gateway surfaces roughly ten tools total; browser targets do not transparently ride through them. Adding browser support to MCP requires explicit SDK and tool updates and is deferred to a follow-up spec.
- **No dynamic overlay re-anchoring in v1.** Canvases anchored to browser elements do not follow page scroll, in-viewport resize, zoom change, or navigation. See Goal 4. A dynamic overlay watcher (polling or CDP subscription) requires a durable process context that the CLI-one-shot model doesn't provide and is explicitly future work.
- **No tab addressing in v1.** `browser:<s>/tab/<index>` is not part of the v1 target grammar. Multi-tab work uses the escape hatch.
- No new top-level verb. No `aos browser` subtree. Browser support is flags and target forms on existing verbs.
- No `do.*` daemon actions. `do` remains CLI-client-side as the 04-17 IPC spec prescribes.
- No embedded Playwright SDK (no Node bundled into aos). We shell out.
- No headless-mode default. v1 prefers attach-mode and agent-launched headed sessions; headless is supported as a flag but not the primary path.

## Architecture

### The seam

```
┌──────────────────────────────────────────────────────────────┐
│  aos CLI process                                             │
│                                                              │
│  ┌─────────────┐   ┌─────────────┐   ┌──────────────────┐    │
│  │ see capture │   │ do <action> │   │ show create      │    │
│  │  dispatcher │   │  dispatcher │   │  anchor resolver │    │
│  └──────┬──────┘   └──────┬──────┘   └────────┬─────────┘    │
│         │                 │                   │              │
│         ▼                 ▼                   ▼              │
│   ┌─────────────────────────────────────────────────┐        │
│   │  target parser (ax:… / browser:… / canvas:… …) │        │
│   └─────────────────────────────────────────────────┘        │
│                          │                                   │
│       ┌──────────────────┴───────────────────┐               │
│       │  macOS path        browser path      │               │
│       ▼                     ▼                │               │
│  ScreenCaptureKit      ┌────────────────┐   │               │
│  CGEventTap            │ BrowserAdapter │   │               │
│  AppleScript /AX       │ (Swift)        │   │               │
│                        └───────┬────────┘   │               │
│                                │            │               │
│                                ▼            │               │
│                        spawns `playwright-  │               │
│                        cli -s=<session> …`  │               │
└────────────────────────────────┼────────────┴───────────────┘
                                 │
                                 ▼
                      ┌────────────────────┐
                      │  playwright-cli    │
                      │  (Node subprocess) │
                      └─────────┬──────────┘
                                │
                    ┌───────────┴───────────┐
                    ▼                       ▼
            attach-mode               agent-launched
            (user's Chrome)           (fresh browser)
```

- The seam is one Swift component (`BrowserAdapter`) inside the aos CLI process.
- It owns: spawning `playwright-cli`, parsing its stdout + snapshot YAML, translating results into aos's existing `see`/`do`/`show` response shapes, and (for `show`) feeding offset updates to the daemon as `show.update` calls.
- The daemon is uninvolved for perception and action on browser targets (consistent with `see capture` and `do.*` already being CLI-client-side per the 04-17 IPC spec). The daemon handles `show` exactly as it does today; it doesn't know the anchored window is a Chrome tab.

### Subprocess lifecycle

- One long-running `playwright-cli` session per aos focus channel. Session name = focus channel id (or `PLAYWRIGHT_CLI_SESSION` env var, whichever resolves first).
- aos does **not** daemonize `playwright-cli`. `playwright-cli` manages its own background browser process via its built-in session machinery (`list`, `close-all`, `kill-all`). aos simply issues subprocess commands with `-s=<session>` and lets `playwright-cli` route them to the right browser.
- Per-command invocation model: `aos do click browser:<session>/e21` → spawns `playwright-cli -s=<session> click e21`, waits for exit, parses stdout/stderr, returns aos-shaped JSON. This is intentionally stateless on the aos side — session state lives in `playwright-cli`'s process, not in ours.
- **Every aos CLI invocation returns and exits.** The aos CLI is one-shot by design (see the daemon/CLI split in `ARCHITECTURE.md` and `src/CLAUDE.md`). No aos CLI subcommand may spawn a long-lived foreground watcher; v1 anchors are static (see Goal 4 and Non-Goals).
- When an aos focus channel is removed via the CLI-local registry, the adapter calls `playwright-cli -s=<session> close` if the session is agent-launched. User-attached sessions are not closed (the user owns Chrome lifecycle).
- **Snapshot/screenshot calls use deterministic filenames.** Every `playwright-cli snapshot` and `playwright-cli screenshot` invocation passes `--filename=<aos-allocated-tmp-path>` so the adapter reads from a known path rather than parsing timestamped defaults out of stdout.

### Why not embed Playwright's SDK

- Bundling Node and `@playwright/test` into aos would double the binary size and introduce a second runtime.
- `playwright-cli` ships binaries via npm; subprocess invocation works across macOS architectures without aos vendoring anything.
- Subprocess parsing is proven in-repo: the daemon already spawns `aos see capture` as a child process (`src/daemon/canvas-inspector-bundle.swift:350`). Same pattern.

## Target Addressing Grammar

A single grammar for browser targets, parseable at the CLI layer and consumed by all three verbs:

```
browser:<session>            # current (active) tab of the session
browser:<session>/<ref>      # element by playwright-cli ref in the active tab
```

- `<session>` is any identifier valid for `playwright-cli -s=<name>`. Sessions are namespaced by `playwright-cli`; aos does not impose its own naming convention beyond "the session name matches the focus channel id."
- `<ref>` is a ref string emitted by the most recent `playwright-cli snapshot` against that session (e.g., `e21`, `e34`). Refs are valid until the next structural DOM change.
- Refs are opaque to aos. The adapter does not re-derive or rewrite them; it passes them through to `playwright-cli`.
- **Tab addressing is out of scope for v1.** `browser:<session>/tab/<index>` is not accepted. Multi-tab targeting requires a tab introspection primitive we're deferring; in v1 the adapter always operates on whichever tab `playwright-cli` considers active for the session, matching `playwright-cli`'s own default semantics. Agents that need to switch tabs use the escape hatch (`playwright-cli -s=<session> tab-select <index>`), then subsequent `aos` calls target the newly-active tab.
- Frame-aware addressing (`browser:<session>/frame/<id>/<ref>`) is **deferred** — v1 addresses only main-frame elements. Iframed content is an explicit follow-up.

### Relationship to macOS AX refs

Both macOS AX elements and browser DOM elements are "things with role/title/label/bounds and an opaque identifier." To keep the space-suit metaphor honest, the CLI target parser should eventually accept `ax:<path>` alongside `browser:<session>/<ref>` as a uniform element-ref grammar. **v1 only implements `browser:…`**; the parallel macOS-side `ax:<path>` capture is tracked as a separate follow-up ("first-class element capture for macOS AX"). Shipping both under one `--ref <target>` positional form on `see capture` is a natural future consolidation.

## Session Lifecycle

Two classes of browser session, both modeled as aos focus channels.

### User-attached (primary)

```
aos focus create --target browser://attach [--extension | --cdp=chrome | --cdp=<url>]
```

- Binds to an already-running Chrome/Edge that the user launched normally.
- `--extension` uses `playwright-cli attach --extension` (browser-extension bridge; friendliest setup path for end users).
- `--cdp=chrome` uses `playwright-cli attach --cdp=chrome` (attaches to Chrome launched with `--remote-debugging-port=<N>`).
- `--cdp=<url>` attaches to an arbitrary CDP endpoint for advanced use.
- Lifecycle is **user-owned**: the focus channel's session survives until the user closes Chrome (or explicitly runs `aos focus remove <id>`, which detaches without closing the browser).
- This is the codepath for the "user and agent in the same tab" workflow that shapes v1.

### Agent-launched

```
aos focus create --target browser://new [--headed | --headless] [--url=<initial>] [--persistent]
```

- Spawns a fresh `playwright-cli -s=<session>` session.
- Lifecycle is **aos-owned**: closed when the focus channel is removed.
- Used for batch runs, tests, scraping, and any workflow where the user doesn't need to be visually present.

### Session-to-channel binding

- `aos focus create --target browser://…` returns a focus channel id `ch-<uuid>`. That id becomes the `<session>` in `browser:<session>` target strings for the lifetime of the channel.
- Browser focus channels and window focus channels have **different record shapes**. `SpatialChannelSummary` (`src/perceive/spatial.swift:738`) has a required `window_id: Int` that headless browser sessions cannot supply. The shapes cannot be unified without schema change.
- `aos focus list` emits a typed union. Each entry carries a `kind` discriminator and only the fields valid for that kind:

  ```json
  {"kind": "window",  "id": "…", "window_id": 12345, "app": "Finder",  "elements_count": 23, "updated_at": "…"}
  {"kind": "browser", "id": "…", "session": "todo-app", "mode": "attach|launched", "attach": "extension|cdp", "browser_window_id": 67890, "active_url": "…", "updated_at": "…"}
  ```
  The `kind` field is present on every entry for forward compatibility. `browser_window_id` is the Chrome/Edge window's CGWindowID when it can be resolved (always for attach-mode and headed launched; null for headless). Consumers discriminate on `kind` before reading kind-specific fields.
- Under the hood `aos focus list` issues the daemon `focus.list` IPC call (returns `SpatialChannelSummary[]` → tagged with `kind: "window"`) and reads the CLI-local browser registry (tagged with `kind: "browser"`), then emits the merged list. Order is daemon entries first, then browser entries, preserving existing caller expectations.
- The `PLAYWRIGHT_CLI_SESSION` env var, when set in the aos CLI environment, resolves the default session for bare `browser:` targets (no session segment). This matches `playwright-cli`'s own convention and lets `PLAYWRIGHT_CLI_SESSION=todo-app aos see capture browser: --xray` work.

### Multi-tab handling

Deferred. See Target Addressing Grammar above — v1 operates on whichever tab `playwright-cli` treats as active for the session. Tab selection uses the escape hatch.

## Verb Mapping

### `see`

| aos invocation | `playwright-cli` call (deterministic filename always passed via `--filename=<tmp>`) |
|---|---|
| `aos see capture browser:<s>` | `playwright-cli -s=<s> screenshot --filename=<tmp>` |
| `aos see capture browser:<s>/<ref>` | `playwright-cli -s=<s> screenshot <ref> --filename=<tmp>` |
| `aos see capture browser:<s> --xray` | `playwright-cli -s=<s> snapshot --filename=<tmp>` → parse YAML → emit `AXElementJSON[]` with a new `ref` field per element |
| `aos see capture browser:<s> --xray --label` | snapshot + screenshot + overlay composition client-side (same as macOS path) |

**Xray schema.** The existing `AXElementJSON` shape in `src/perceive/models.swift:225` is flat (no `children`) and has these fields:

```swift
struct AXElementJSON: Encodable {
  let role: String
  let title: String?
  let label: String?
  let value: String?
  let enabled: Bool
  let context_path: [String]
  let bounds: BoundsJSON
}
```

For browser targets the adapter emits the same flat shape with one additive field: `ref: String?`. Population rules:

| Field | macOS source | Browser source (from snapshot YAML) |
|---|---|---|
| `role` | AX role | ARIA role / tag-derived role |
| `title` | AX title | `name` from snapshot |
| `label` | AX label | `description` / `aria-label` from snapshot |
| `value` | AX value | `value` for form fields, text content otherwise |
| `enabled` | AX enabled | not-disabled / not-[aria-disabled] |
| `context_path` | AX ancestor roles | snapshot ancestor role/ref chain |
| `bounds` | AX frame in LCS | viewport rect from snapshot (LCS, viewport-relative) |
| `ref` | `nil` (macOS path does not populate) | `"e21"` etc. |

The `ref` field is optional at the schema level so macOS xray output is unchanged. An earlier iteration of this spec described `role/name/bounds/children` — that was wrong. The actual output is flat; we preserve that.

- The `bounds` field is in Local Coordinate System (LCS) relative to the captured viewport — matching the coord model documented in `ARCHITECTURE.md`.
- `see observe` streaming on browser channels (DOM mutation events, console, navigation) is **deferred** to v1.5. v1 delivers only stateless `see capture`.

### `do`

Verb mapping must respect existing aos `do` semantics (`src/shared/command-registry-data.swift`):

- `aos do press --pid <pid> --role <role>` is **AX element activation** (macOS). It is not keyboard input. The spec does **not** overload `do press` with a browser meaning.
- `aos do key <combo>` is **keyboard input** (combos like `cmd+s`). Browser keyboard work maps through this verb.
- `aos do type <text>` is **text entry**. Browser text entry maps through this verb.

| aos invocation | `playwright-cli` call |
|---|---|
| `aos do click browser:<s>/<ref>` | `playwright-cli -s=<s> click <ref>` |
| `aos do click browser:<s>/<ref> --right` | `playwright-cli -s=<s> click <ref> right` |
| `aos do click browser:<s>/<ref> --double` | `playwright-cli -s=<s> dblclick <ref>` |
| `aos do hover browser:<s>/<ref>` | `playwright-cli -s=<s> hover <ref>` |
| `aos do drag browser:<s>/<ref1> browser:<s>/<ref2>` | `playwright-cli -s=<s> drag <ref1> <ref2>` |
| `aos do type browser:<s> "<text>"` | `playwright-cli -s=<s> type "<text>"` |
| `aos do fill browser:<s>/<ref> "<text>"` | `playwright-cli -s=<s> fill <ref> "<text>"` |
| `aos do key browser:<s> <combo>` | `playwright-cli -s=<s> press <combo>` (single keys or combos; modifier translation happens in the adapter) |
| `aos do check browser:<s>/<ref>` | `playwright-cli -s=<s> check <ref>` |
| `aos do uncheck browser:<s>/<ref>` | `playwright-cli -s=<s> uncheck <ref>` |
| `aos do select browser:<s>/<ref> <value>` | `playwright-cli -s=<s> select <ref> <value>` |
| `aos do scroll browser:<s> <dx>,<dy>` | `playwright-cli -s=<s> mousewheel <dx> <dy>` |
| `aos do navigate browser:<s> <url>` | `playwright-cli -s=<s> goto <url>` |
| `aos do click <x,y>` (no browser target) | unchanged — CGEventTap on macOS |

**Not wrapped in v1 (use escape hatch):**
- `playwright-cli upload <file>` — takes a file path, not a ref; doesn't fit the `do <verb> <ref>` shape cleanly. Agents upload by calling `playwright-cli -s=<s> upload <file>` directly.
- `keydown` / `keyup` / `mousedown` / `mouseup` — low-level pair primitives; not common enough in coding-agent workflows to justify aos verbs. Escape hatch covers them.
- `dialog-accept` / `dialog-dismiss`, `go-back` / `go-forward` / `reload` — minor navigation affordances; escape hatch. `do navigate` is the v1 one that's worth having ergonomically because URL navigation is the common case.

Pixel-level verbs (`aos do click <x,y>` without a `browser:` target) work regardless of what's on screen. They do **not** need browser-flavored equivalents — a coordinate click inside a Chrome window already works via the existing CGEvent path. Browser-target verbs always speak refs; pixel-target verbs always speak desktop coords. The mode is selected by the target argument's shape.

### `show`

```
aos show create --id <canvas> --anchor browser:<s>/<ref> --offset 0,0,W,H --html ...
```

**Static-anchor resolution (v1).** The CLI parses `browser:<s>/<ref>` and computes a one-shot anchor:

1. **Resolve the Chrome content window's CGWindowID** via macOS AX: the browser adapter asks `playwright-cli` for the session's browser type + window title (or CDP target), then finds the matching window in `aos`'s spatial topology. For attach-mode sessions this is direct; for headed launched sessions we find the Playwright-owned window that came up. For headless launched sessions this resolution fails — `show` anchoring is not supported on headless targets in v1.
2. **Get the element viewport rect** via `playwright-cli -s=<s> eval "(e) => { const r = e.getBoundingClientRect(); return {x: r.left, y: r.top, w: r.width, h: r.height}; }" <ref>`. `getBoundingClientRect()` is **viewport-relative**; it already accounts for current scroll. We do not add scroll on top.
3. **Compute the content-view inset.** The Chrome content window we track via CGWindowID may include the page viewport only (when AX exposes the web content area as its own AX window), or it may include the tab strip + address bar. The adapter picks the narrowest AX window that maps to the content viewport to minimize the inset. Any residual inset comes from `Page.getLayoutMetrics` (via `playwright-cli eval`) or is measured once per session by comparing the AX window frame to the viewport rect of a known-positioned element.
4. **Page zoom + device scale.** `window.devicePixelRatio` and `document.documentElement.clientWidth` vs layout viewport are queried via `playwright-cli eval` and folded into the offset. Values are frozen at create time; v1 does not re-measure on zoom change.
5. **Call `show.create`** with `anchor_window=<contentWindowID>`, `offset=[x, y, w, h]` where x/y are the element's LCS position inside the content window and w/h are the caller's size hints. The daemon's existing CGWindowID tracking keeps the overlay aligned when the user drags the Chrome window.

**Updates preserve the anchor.** When the agent wants to reposition the overlay (re-anchor after scrolling, say), it calls `aos show update --id <canvas> --anchor browser:<s>/<ref> --offset …`. The adapter re-runs steps 2–4 and issues `show.update` with **`anchor_window` + `offset`** (never `at`). Verified in `src/display/canvas.swift:1022–` — the update handler already accepts `(anchor_window, offset)` and preserves the anchor; in contrast, passing `at` at `src/display/canvas.swift:963–966` clears `anchorWindowID`, `anchorChannelID`, and `offset`, turning the canvas into a free-floating rect. No daemon schema change is required; the `(anchor_window, offset)` update path already exists. The 04-17 IPC spec's `show.update` table under-documents this (it lists `at` and `track` but not `anchor_window`/`offset`) — that's pre-existing spec/code drift this design does not try to fix.

**No dynamic watcher in v1.** As stated in Non-Goals and Subprocess Lifecycle, the CLI is one-shot; `aos show create` returns and the process exits. There is no foreground polling loop, no CLI-spawned background process, no eval-at-30Hz. Scroll/zoom/nav/resize invalidate the overlay's apparent position; the agent is responsible for re-issuing `show update` when it needs to re-anchor. Dynamic anchor tracking is future work (see Out of Scope).

## Daemon / IPC Relationship

**No changes to `shared/schemas/daemon-request.schema.json` in v1.**

The daemon's existing behaviors cover browser anchoring:
- `show.create` already accepts `anchor_window: int` + `offset: [x,y,w,h]`.
- `show.update` already accepts `at: [x,y,w,h]` for position updates (used today for non-browser canvases).
- `focus.create` is **not** used for browser focus channels in v1 — it's keyed on `window_id: int (CGWindowID)` and would require schema extension. Browser focus channels live in the CLI process's own registry (see "Focus channel registry" below).

This means the 04-17 IPC v1 catalog is unchanged by this spec. A future v2 could promote browser focus channels into the daemon (so other aos processes can subscribe to the same channel), but v1 treats them as CLI-process-local state.

### Focus channel registry

Browser focus channels live in a small CLI-side registry (probably `src/browser/session-registry.swift`) backed by a state file under `${AOS_STATE_ROOT or ~/.config/aos}/{mode}/browser/sessions.json`. The registry tracks:
- Channel id ↔ `playwright-cli` session name (currently 1:1)
- Creation mode (attach vs launched, CDP/extension flags)
- Last-known active tab index

This state is CLI-local; aos's daemon does not read or write it. Every aos CLI invocation reads the state file to resolve `browser:<session>` target strings and to surface browser channels in `focus list`.

**Dispatch split on `focus create` and `focus list`:** the daemon's `focus.create` action takes `window_id: int` (CGWindowID) and only supports macOS window focus channels — see the 04-17 IPC spec. Browser focus channels therefore **do not go through the daemon's `focus.create`**. The CLI-side `aos focus create` dispatches on target form:
- `--target window:<id>` or bare `<window-id>` → daemon IPC `focus.create` (existing path).
- `--target browser://…` → CLI-local path: the browser adapter creates the channel, starts the `playwright-cli` session, writes to the registry, and returns a channel id to the caller. No daemon call.

Similarly `aos focus list` issues the daemon `focus.list` IPC call *and* reads the browser registry, then emits a merged list. `aos focus remove <id>` inspects the registry first and routes to the daemon only if the id is not a browser channel.

**Rationale for CLI-local state:** keeps the daemon's responsibility scope pure (macOS spatial + coordination). When/if we need cross-process browser-channel subscription, we migrate the registry into the daemon with a schema change — but that's a capability we don't have evidence we need in v1.

## CLI Surface Additions

All additive. No existing command shape changes.

- `aos focus create --target browser://new [--headed|--headless] [--url=<u>] [--persistent]`
- `aos focus create --target browser://attach [--extension | --cdp=chrome | --cdp=<url>]`
- `aos focus list` — now includes browser channels alongside window channels.
- `aos focus remove <id>` — closes agent-launched sessions; detaches user-attached.
- `aos see capture <target>` — accepts `browser:<session>[/<ref>]` as `<target>` (no tab/frame segments in v1).
- `aos see capture browser:<s> --xray [--label]` — DOM xray with playwright refs.
- `aos do <action> <target>` — all existing do-actions accept `browser:…` targets where semantically valid.
- `aos do navigate <browser-target> <url>` — new action specific to browser targets.
- `aos show create --anchor browser:<s>/<ref> --offset …` — browser-flavored anchor.

Tab introspection (listing tabs, switching active tab) is **not** exposed as an aos verb in v1. Agents use the escape hatch: `playwright-cli -s=<session> tab-list` / `tab-select` / `tab-new`. A future `aos see list --target browser:<s>` or equivalent is deferred (see Out of Scope).

The command registry (`src/shared/command-registry-data.swift`) gains descriptors for each of these forms so `aos help --json` exposes them to agents.

## MCP Adapter

**Out of scope for v1.** Verified against `packages/gateway/sdk/aos-sdk.d.ts` and `packages/gateway/CLAUDE.md`:

- The gateway SDK ships **typed helpers**, not opaque-target wrappers. `aos.click({x, y})` takes typed coordinates, `aos.capture({display, window, xray, ...})` takes typed options, `aos.createCanvas({at, html, ...})` takes a typed canvas spec. None of these accept a free-form target string that could carry `browser:<s>/<ref>`.
- The gateway surfaces ~10 tools total (`register_session`, `set_state`, `get_state`, `post_message`, `read_stream`, `who_is_online`, `run_os_script`, `save_script`, `list_scripts`, `discover_capabilities`). Verb-per-verb CLI parity is not the gateway's design.
- Browser target support via MCP therefore requires **explicit SDK/tool additions**: either extending the typed helpers with browser variants (e.g., `aos.clickBrowser({session, ref})`, `aos.captureBrowser({session, ref?, xray?})`) or adding new top-level helpers. The right shape is itself a design question that belongs in a follow-up spec, not this one.
- Users who specifically want Microsoft's `playwright-mcp` can run it in parallel to aos's MCP gateway and use both. aos does not consume or re-export `playwright-mcp`.

This spec is strictly about the **CLI-layer** adapter. MCP gateway parity is deferred to a separate spec.

## Escape Hatch + chrome-harness Retirement

`playwright-cli` remains directly callable by the agent. aos-side conveniences:
- aos focus channels are named such that `playwright-cli -s=<channel-id>` works against them.
- The aos browser skill explicitly documents: "for tracing, codegen, `run-code`, route mocking, and other Playwright-native primitives, call `playwright-cli` directly." aos does not wrap them.

**chrome-harness retirement:**
- No in-repo code references chrome-harness today — verified via grep. It's a plugin-cache skill only.
- A new skill (`skills/browser-adapter/SKILL.md` or similar location) supersedes it, documenting:
  1. Installing `playwright-cli` (`npm install -g @playwright/cli@latest`).
  2. Creating a browser focus channel via `aos focus create --target browser://…`.
  3. Common see/do/show patterns with browser targets.
  4. When to drop to raw `playwright-cli` for Playwright-native primitives.
- The deprecated chrome-harness skill file is left to be removed by the skill's maintainer; aos doesn't manage plugin-cache contents.

## Files and Deliverables

The following files are the intended artifacts of the implementation plan that follows this spec. The plan (via writing-plans) will break them into tasks with code-level detail.

| File | Role |
|------|------|
| `src/browser/` | New subtree for the adapter. |
| `src/browser/browser-adapter.swift` | Spawns `playwright-cli`, parses output, routes commands. |
| `src/browser/snapshot-parser.swift` | Converts `playwright-cli snapshot` YAML into aos `Element[]` JSON. |
| `src/browser/session-registry.swift` | CLI-local registry mapping focus channel id ↔ `playwright-cli` session. |
| `src/browser/target-parser.swift` | Parses `browser:<session>[/<ref>]` target strings (no tab/frame segments in v1). |
| `src/browser/anchor-resolver.swift` | One-shot resolution of `browser:<s>/<ref>` → `(CGWindowID, offset)` for `show create` / `show update`. No watcher; pure resolution. |
| `src/browser/playwright-version-check.swift` | Detects installed `@playwright/cli` version and validates it meets the minimum requirement (the plan will pin the exact version once it's been verified). |
| `src/browser/CLAUDE.md` | Subtree-local guidance for future work. |
| `src/perceive/capture-pipeline.swift` | Add dispatch to browser adapter when target is `browser:…`. |
| `src/act/act-cli.swift` (+ helpers) | Add dispatch to browser adapter for `do` actions on browser targets. |
| `src/display/client.swift` or equivalent | Recognize `--anchor browser:…` in `show create` and resolve to `anchor_window + offset` before the daemon call. |
| `src/perceive/focus-commands.swift` | Recognize `--target browser://…` in `focus create`. |
| `src/shared/command-registry-data.swift` | Register new flags/forms for agent introspection. |
| `ARCHITECTURE.md` | Brief note that browser joins macOS as a supported target medium. |
| `skills/browser-adapter/SKILL.md` (or equivalent) | Agent-facing usage guide. |
| `tests/browser/` | Integration tests with `playwright-cli` mocked or (optionally) against a fixture page. |

## Open Questions for Planning

These are genuinely open and should be answered during the writing-plans phase, not punted:

1. **Subtree placement.** One unified `src/browser/` subtree (my preference) vs. split across `src/perceive/browser/`, `src/act/browser/`, `src/display/browser/`. Single subtree is cheaper to evolve; split mirrors existing verb directories.
2. **Default attach mode.** `--extension` (friendlier user setup) vs. `--cdp=chrome` (no extension install, but requires `--remote-debugging-port` flag on the user's Chrome). The spec currently leaves this to the user on every `focus create`; the plan should decide whether one is the default when `--target browser://attach` is given without a sub-flag.
3. **Minimum `@playwright/cli` version and detection UX.** The spec requires `attach --extension` and `attach --cdp`, which some older versions of `@playwright/cli` (e.g., `0.1.1`) don't ship. The plan must: (a) identify the exact minimum version that supports both flags from upstream release notes, (b) pin it in `playwright-version-check.swift`, (c) decide the error UX when the version is too old or the tool is missing (one-line structured error with install/upgrade instructions vs. auto-invoke `npm install -g @playwright/cli@latest` vs. fall back to `npx`).
4. **Launched-session default: headed vs. headless.** `playwright-cli` is headless by default. For `aos focus create --target browser://new` without `--headed`/`--headless`, does aos default to headed (matches v1's primary co-presence mode and supports anchored overlays) or headless (matches `playwright-cli`'s own default)? The spec currently implies headed; the plan must commit. Note: `show` anchoring is only supported on headed targets (step 1 of static-anchor resolution requires a CGWindowID, which headless sessions don't have).
5. **Chrome content-viewport geometry source.** Step 3 of static-anchor resolution depends on measuring the content-view inset. Options: (a) pick the narrowest AX window that maps to the web content area (works when Chrome exposes it as a child AX window; not guaranteed cross-version), (b) query `Page.getLayoutMetrics` via `playwright-cli eval`, (c) calibrate per-session by comparing a known-positioned element's viewport rect to its AX rect. The plan picks one or a fallback chain and documents the observed reliability.
6. **Session persistence across aos CLI restarts.** The registry file persists channel-id ↔ session-name mappings, but `playwright-cli` sessions themselves live in the `playwright-cli` process. After an aos CLI restart, `playwright-cli -s=<name>` still finds the existing session. Do we rehydrate channels automatically, or require the user to `focus create --target browser://attach --session-name <name>`? Probably the latter for v1.
7. **Concurrency.** Multiple aos CLI invocations running against the same session simultaneously (e.g., two agent workers, or an agent + an overlay re-anchor). `playwright-cli` presumably serializes via its session-process; the plan needs a quick check + test, and a documented race-resolution behavior for our side.

## Out of Scope (Future Work)

- **Dynamic overlay tracking.** Canvases anchored to browser elements automatically following page scroll, in-viewport resize, zoom change, and navigation. Requires a durable process context (a new small daemon, a daemon-side browser subsystem, or a long-lived "browser channel" process) that the v1 CLI-one-shot model doesn't provide. Biggest item on the follow-up list — closes the gap between "space suit" aspiration and v1's static-anchor reality.
- **In-page overlay injection** (option B from brainstorming). Page-sandboxed shadow-DOM overlays for scroll-stable composition inside scrolling containers.
- **MCP gateway parity.** Extending the gateway SDK (`packages/gateway/sdk/aos-sdk.d.ts`) with browser-aware helpers so MCP consumers can address browser targets. Requires typed-helper additions; own spec.
- **Workflow recording, replay, codegen.** The "lock in" endgame — user demonstrates, aos captures via `playwright-cli tracing-start`/`codegen`, stores as a replayable workflow in aos wiki/memory with canvas provenance. Large enough for its own spec.
- **`see observe` browser channels.** DOM-mutation / console / network streaming via `playwright-cli` background subscription. Complements `see capture` for continuous perception.
- **Frame-aware addressing.** `browser:<s>/frame/<id>/<ref>` for iframed content.
- **Tab addressing and introspection as aos verbs.** `browser:<s>/tab/<index>` grammar, `aos see list --target browser:<s>` returning tabs, or `aos do tab-select/tab-new/tab-close` as first-class aos actions. v1 routes all tab work through the escape hatch.
- **First-class `see capture --ref` for macOS AX elements.** Closes the gap identified in brainstorming: macOS AX elements are emitted by `--xray` but not directly capturable as targets. Parallel follow-up to this spec, not inside it.
- **Daemon-side browser focus channels.** Migrating the session registry into the daemon so non-CLI processes can subscribe. Requires an IPC schema extension (`focus.create` must accept a polymorphic target). Deferred until a concrete consumer needs it.
- **MCP consumption of `playwright-mcp`.** aos consuming Playwright's MCP server as an alternative binding. Not on the roadmap.
- **Headless-first batch automation UX.** Polishing the agent-launched headless path as a first-class test-runner story. v1 supports it; a follow-up can invest in the polish (reporting, parallelism, CI integration).

## Open Questions Resolved During Brainstorming

- **Primary binding: CLI subprocess, not MCP, not SDK.** Microsoft's own README frames the tradeoff explicitly; aos's token-efficient coding-agent use case maps to the CLI path.
- **Ref-first, not pixel-first, for browser interaction.** Pixel verbs still work for macOS-style clicks; browser verbs take refs from prior snapshots. Same "bimodal claws" grammar `playwright-cli` itself uses.
- **External overlays only for v1.** In-page injection is deferred; the space-suit metaphor is preserved (same overlay substrate across macOS and browser targets).
- **Full wrap, not thin wrap.** Agent speaks one verb vocabulary; context-switching cost in co-presence workflows is too high to justify thin-wrap.
- **Attach-mode is v1-primary, not v1-secondary.** Co-presence between user and agent is a primary mode, not a follow-up.
- **No daemon IPC schema change in v1.** The existing `show.create --anchor_window + --offset` contract and the `show.update --anchor_window + --offset` update path (verified in `src/display/canvas.swift:1022`) are sufficient for static browser overlay anchoring.
- **Static overlays only for v1.** Dynamic re-anchoring requires a durable process context incompatible with aos's one-shot CLI. Ambition honestly descoped: canvases stay static until the agent re-issues `show update`.
- **Tab addressing deferred.** The `/tab/<index>` grammar is cut from v1 because aos cannot discover tab indices without introducing tab-listing primitives; rather than ship a half-functional grammar, v1 always operates on the active tab.
- **Browser focus channels have their own shape.** They cannot share `SpatialChannelSummary`. `aos focus list` returns a typed union with a `kind` discriminator.
- **Verb mapping respects existing semantics.** `do press` (AX activation) is not reused for keyboard; browser keyboard goes through `do key`. Missing primitives (`upload`, low-level key/mouse pairs, dialog and navigation affordances beyond `goto`) are not wrapped — escape hatch covers them.
- **MCP parity is out of v1.** The gateway SDK's typed-helper shape requires explicit additions, not transparent ride-through. Separate spec.
- **chrome-harness retired, not kept.** `playwright-cli` is a more mature, professionally-maintained primitive; no in-repo code depends on chrome-harness.
