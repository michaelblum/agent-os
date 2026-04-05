# Shared IPC Library and Component Scaffold

**Date:** 2026-04-05
**Status:** Draft
**Scope:** Cross-cutting infrastructure for daemon communication and HTML component reuse

## Problem

The codebase has four independent implementations of daemon IPC plumbing:

1. `apps/sigil/avatar-ipc.swift` — hand-rolled socket connect, send, read, reconnect. Hardcoded to `~/.config/heads-up/sock`.
2. `src/commands/inspect.swift` — private `tryInspectConnect()`, `sendInspectJSONAndReadResponse()`, `sendInspectJSONNoResponse()`, daemon auto-start logic.
3. `src/commands/log.swift` — private `tryLogConnect()`, `sendLogJSON()`, `connectToLogDaemon()` with identical auto-start logic.
4. `packages/toolkit/patterns/daemon-subscriber.swift` — `DaemonSubscriber` class with reconnection, ndjson parsing, envelope decoding.

Each reimplements the same transport behaviors: Unix socket connection with timeout, JSON-over-newline framing, optional daemon auto-start, optional reconnection with backoff. They diverge in small ways (error handling, timeout values, response consumption) that create maintenance burden and inconsistency.

Similarly, HTML canvas components (`inspector-panel.html`, `log-console.html`, `avatar.html`) each copy:
- An identical `esc()` function for HTML escaping
- An identical `headsup.receive()` bridge (base64 decode, JSON parse, type dispatch)
- Overlapping dark-theme CSS (backdrop blur, SF Mono, border radius, color palette)

## Design Principles

- **Composition over inheritance.** The shared pieces are small composed types, not a class hierarchy. Inheritance introduces rigidity before the abstractions have settled.
- **Abstractions earn their place.** Every shared type must have at least two consumers at the time it's extracted. No speculative abstractions.
- **Boundaries and responsibilities over type names.** This spec defines what each seam is responsible for. Exact type names and APIs are confirmed during implementation.
- **Incremental migration.** Consumers adopt the shared library one at a time. No big-bang rewrite.

## Decision: Where Shared IPC Lives

**`shared/swift/ipc/`** — a new directory at the repo root.

Rationale:
- `src/shared/` is internal to the `aos` binary. Cross-consumer code doesn't belong there.
- `packages/toolkit/patterns/` reads as "reusable examples," not "core transport library."
- `shared/` already holds cross-tool contracts (`shared/schemas/`). The IPC library is the Swift runtime side of the same idea.
- Decision rule: **if code must be usable by both `aos` and external consumers, it does not live under `src/`.**

## Part 1: Shared Daemon IPC Library

### Responsibilities

The library provides three seams, each handling one responsibility:

**Connection management.** Owns the Unix domain socket lifecycle: connect with configurable timeout, non-blocking connect with poll, restore blocking mode for reads, clean close. Tilde-expands socket paths. This is the lowest layer — no JSON awareness, no protocol knowledge.

**Request/response client.** Two modes over the same primitive:

- **Persistent session:** Opens a connection and keeps it open for repeated request/response cycles over the same fd. Used by Sigil's animation loops (coalesced 30Hz position updates), `inspect` (create canvas then stream eval commands), and any consumer that sends multiple commands per logical operation. This is the primary mode — one-shot is a convenience on top, not the other way around.
- **One-shot convenience:** Connect, send, read response, close. Layered on persistent session for simple cases like Sigil's `sendOneShot()` and `log push`.

Optionally auto-starts the daemon if connection fails (spawn `aos serve`, poll for socket availability with timeout). Used by commands like `inspect`, `log`, and Sigil.

**Event stream.** Subscribes to the daemon and reads a continuous ndjson stream. The stream primitive delivers **raw parsed JSON dictionaries** — no assumption about message shape. Envelope decoding (`{v, service, event, ts, data}`) is an optional adapter layered on top, not baked into the stream itself.

This separation matters because Sigil's subscriber traffic includes non-envelope messages (`{"type":"channel",...}`, `{"type":"event",...}` relays for canvas JS and lifecycle) alongside envelope-format events. A stream that only understands envelopes cannot fully replace Sigil's current subscriber logic.

Reconnects with exponential backoff on disconnect. Fires callbacks per message (raw) and optionally per decoded envelope. Used by `inspect` (perception events), Sigil (channel events + lifecycle relays), and any future subscriber.

### What This Replaces

| Current code | Replaced by |
|---|---|
| `avatar-ipc.swift` `connectSock()`, `readWithTimeout()`, `sendJSON()`, `sendOneShot()` | Connection management + request/response client |
| `inspect.swift` `tryInspectConnect()`, `connectInspectDaemon()`, `sendInspectJSON*()` | Request/response client with auto-start |
| `log.swift` `tryLogConnect()`, `connectToLogDaemon()`, `sendLogJSON()` | Request/response client with auto-start |
| `daemon-subscriber.swift` `DaemonSubscriber` class | Event stream (folded in, not preserved as parallel abstraction) |

### Shared Helpers

These small utilities are used across seams:

- **NDJSON framing.** Read bytes from fd, split on newlines, yield complete lines. Shared between request/response (single line) and event stream (continuous).
- **Socket address construction.** The `sockaddr_un` setup code duplicated in every connect function.
- **Poll-based read with timeout.** Used by both request/response and event stream for non-hanging reads.

### What This Does NOT Include

- **Animation primitives.** Sigil's `runAnimation`, `moveTo`, `scaleTo` stay in Sigil. No second consumer exists yet.
- **Canvas orchestration.** The "own a canvas, drive its state" pattern is visible but not extractable until a second consumer validates the shape.
- **Factory layer.** Ergonomic entry points (`AOS.connect(.subscribe)`) are a future convenience once the underlying pieces stabilize.
- **Actor-based concurrency.** The codebase is synchronous + GCD. An async/await pivot is out of scope.

## Part 2: HTML Component Scaffold

### Problem

Every HTML component that runs inside a heads-up/aos canvas reimplements the same bridge and chrome. The bridge is identical. The chrome is near-identical.

### Responsibilities

**Bridge JS.** A shared JavaScript file (or inline-able snippet) that:
- Sets up `window.headsup.receive()` with base64 decode and JSON parse
- Dispatches to a component-defined handler by message type
- Provides `esc()` for HTML escaping
- Provides `sendToHost()` if/when components need to message back

**Base CSS.** A shared stylesheet (or inline-able snippet) providing:
- Transparent background boilerplate (`html, body { background: transparent !important }`)
- Dark-theme tokens (background, border, text colors, blur backdrop)
- Typography defaults (SF Mono / system monospace, base font size)
- Scrollbar styling

Components import or inline these shared assets and define only their unique rendering logic.

### What This Does NOT Include

- A component "framework" or lifecycle system
- Server-side rendering or templating
- Any build step (components remain self-contained HTML files)

### Delivery Format

The shared assets live adjacent to the components they serve. Likely location: `packages/toolkit/components/shared/` or `packages/toolkit/components/_base/`. The exact structure is confirmed during implementation based on how the import/inline mechanism works (HTML files loaded via `file://` have constraints on relative imports that need testing).

## Part 3: Build Script Changes

Both `build.sh` (aos binary) and `apps/sigil/build-avatar.sh` need to compile files from `shared/swift/ipc/`.

### aos build (`build.sh`)

Currently compiles `src/**/*.swift`. Add `shared/swift/ipc/*.swift` to the source list.

### Sigil build (`apps/sigil/build-avatar.sh`)

Currently compiles `apps/sigil/*.swift`. Add `shared/swift/ipc/*.swift` to the source list.

### Collision Risk

Both builds will include the shared IPC code. Need to verify no symbol conflicts with `src/shared/helpers.swift` (which defines `withSockAddr`, `kAosSocketPath`, etc. that the shared IPC layer will subsume or reference). The `aos` binary's helpers may need to be refactored: socket path constants and `withSockAddr` move to shared IPC, while aos-specific helpers (envelope formatting, duration parsing) stay in `src/shared/`.

## Migration Order

Migration is incremental. Each step is independently shippable.

### Step 1: Create shared IPC library

Write the three seams in `shared/swift/ipc/`. Test by compiling standalone (no consumers yet). The existing `DaemonSubscriber` in `packages/toolkit/patterns/` is the starting material — decompose it into the three responsibilities, don't start from scratch.

### Step 2: Migrate `log.swift`, then `inspect.swift`

Migrate `log` first — it is the purest request/response consumer (create canvas, send eval commands, done). `inspect` mixes request/response (create canvas, send evals) with event stream subscription (perception events), making it a more complex second consumer that exercises both seams.

Replace their private IPC helpers with the shared library. Verify `aos log` and `aos inspect` work identically.

### Step 3: Migrate Sigil

Replace `avatar-ipc.swift` internals with the shared library. This also requires updating the socket path from `~/.config/heads-up/sock` to `~/.config/aos/sock`. Test that `avatar-sub` works against `aos serve`.

### Step 4: Retire `daemon-subscriber.swift`

Once Sigil uses the shared event stream, the standalone `DaemonSubscriber` in `packages/toolkit/patterns/` is redundant. Remove it or replace it with a thin wrapper that re-exports from `shared/swift/ipc/` for backwards compatibility.

### Step 5: HTML component scaffold

Extract shared bridge JS and base CSS from `inspector-panel.html` and `log-console.html`. Retrofit both components. Verify rendering is identical.

### Step 6 (Future): Sigil event tap migration

Separate concern from IPC migration. Sigil's CGEventTap should eventually subscribe to the unified daemon's perception stream instead of running its own tap. This is an architectural change, not an IPC change, and depends on the perception stream providing the input events Sigil needs (mouse down/up/drag, not just cursor position). Not in scope for this spec.

## Open Questions

1. **HTML import mechanism.** `file://` URLs have CORS restrictions. Can a component HTML file `<link>` or `<script src>` a sibling file when loaded via WKWebView's `loadFileURL`? If not, the shared assets need to be inlined at build time or injected by the daemon. Needs testing.

2. **Socket path configuration.** Resolved: default to `~/.config/aos/sock`, allow explicit override via parameter. Do not read `config.json` for the socket path — no real second source of truth exists, and adding config-file dependency to the transport layer is unnecessary coupling.

3. **Symbol overlap (blocks step 2).** `src/shared/helpers.swift` defines `withSockAddr`, `kAosSocketPath`, `sendJSON(to:_:)`. Resolution strategy: move socket-path constants and `withSockAddr` to `shared/swift/ipc/`. **Do not** collapse `sendJSON(to:_:)` from `helpers.swift` into the shared IPC layer — that function is server-side response writing (daemon sends response to client fd), which is a different responsibility from client-side request sending. Rename if needed to make the distinction clear, but do not merge them under one name.
