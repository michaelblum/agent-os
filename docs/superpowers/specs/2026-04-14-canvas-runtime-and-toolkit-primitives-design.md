# Canvas Runtime and Toolkit Primitives — Design

**Session:** toolkit-redux
**Date:** 2026-04-14
**Status:** Draft
**Scope:** Refactor `packages/toolkit/_base/` from a monolithic `AosComponent` class into a layered, composable foundation. Extract a universal **canvas runtime** (Layer 1a) consumed by everything that lives in a WKWebView. Build **panel primitives** (Layer 1b) on top of that runtime. Re-express today's three toolkit components as Layer 2 consumers. Build the `Tabs` layout and a dev demo that proves composition end-to-end. This corresponds to **Steps 0–3** of the migration order below.
**Out of scope (deferred to separate sessions):** The Sigil control panel itself (Step 4 — Sigil-owned, separate spec). Migrating the avatar renderer, hit-area, chat, and studio to Layer 1a (Step 5 — coordinated with the surface owners; renderer migration likely involves renderer-strangler). Tear-off + Floating layout (Step 6 — separate spec, depends on Tabs being shipped).

## Problem

`packages/toolkit/components/_base/` today ships a single class, `AosComponent`, that bundles three concerns in one mount call: panel chrome (header + drag), content rendering, and bridge wiring. Three components extend it: `inspector-panel`, `log-console`, `canvas-inspector`. Each gets a panel header it can't opt out of, a single bridge handler it can't share, and a launch path (one `launch.sh` per component) that runs an external event-relay subprocess to forward daemon events into the canvas.

Three forces are pushing this model past its breaking point:

1. **Composition needs.** Multiple tools want to coexist in one canvas (a tabbed workstation: inspector + log + canvas-inspector + Sigil control). Today's `AosComponent` assumes it owns the whole panel; embedding three of them means three competing headers and three bridge handlers fighting over `window.headsup.receive`.

2. **Surface diversity.** Sigil has surfaces that aren't panels at all — the avatar renderer (full-display, transparent, click-through, Three.js scene) and the hit-area (tiny invisible gesture target). Both reimplement bridge plumbing, subscribe handshakes, and child-canvas spawning inline. Today's `_base/bridge.js` is *almost* what they need but lives under a panel framework they correctly skip. So they copy the boilerplate instead.

3. **Daemon capabilities have outgrown the toolkit.** `canvas.create/update/remove` from JS shipped (2026-04-11). `subscribe`/`unsubscribe` shipped (2026-04-12 across `display_geometry`, `input_event`, and `wiki_page_changed`). The manifest convention (`{name, accepts, emits}`) shipped (2026-03-28). Toolkit components don't use any of it — `canvas-inspector/launch.sh` runs a Python subprocess piping `aos show listen` events into the canvas, when the canvas could just `subscribe` directly.

The fix isn't a smarter `AosComponent`. It's separating the concerns it conflates and giving each layer the narrowest surface that does its job.

## Design principles

Lifted from the 2026-04-05 shared-IPC-and-component-scaffold spec, still load-bearing:

- **Composition over inheritance.** No class hierarchy. Small composable modules.
- **Abstractions earn their place.** Every shared type must have at least two real consumers at extraction time. No speculative abstractions.
- **Boundaries and responsibilities, not type names.** This spec defines what each seam owns; exact API names are confirmed during implementation.
- **Incremental migration.** Consumers adopt one at a time. No big-bang rewrite.

Three additions specific to this spec:

- **Two surface shapes, both first-class.** A "panel" (chrome + content) and a "presence surface" (full-canvas, no chrome) are equally legitimate consumers of the foundation. The foundation must serve both without forcing one to wear the other's clothes.
- **Ownership determines location, shape determines composition.** Files for app-bespoke surfaces live in `apps/<app>/`. What they're built from is determined by their shape (panel → consume panel primitives; presence surface → consume runtime helpers directly).
- **Pure functions and small modules over base classes.** Layer 1a is a set of helper functions, not a `Canvas` class. Consumers wire them together rather than inheriting from them.

## Layered model

```
Layer 0     AOS daemon primitives                                   (Swift, in src/)
              canvas.create/update/remove, subscribe streams, eval, content server,
              parent-child cascade, --interactive toggle, --track flag

Layer 0.5   Conventions                                             (rules, no code)
              {type, payload} envelope, slash-namespaced types,
              manifest:{name, accepts, emits, ...}

Layer 1a    Canvas runtime (in-canvas helpers)                      (packages/toolkit/runtime/)
              wireBridge, emit, subscribe, spawnChild, mutateSelf,
              setInteractive, declareManifest, onReady
              ↑ used by EVERYTHING in a canvas: panels, presence surfaces, gesture targets

Layer 1b    Panel primitives                                        (packages/toolkit/panel/)
              Chrome (header, drag, controls)
              Content contract (render, onMessage, serialize, restore)
              Channel router (manifest-aware message dispatch)
              Layouts (Single, Tabs; future: Split, Floating)
              ↑ used by panels only

Layer 2     Toolkit panel components                                (packages/toolkit/components/)
              inspector-panel, log-console, canvas-inspector
              Each is a Content unit + Manifest, consumable by any host

Layer 3     App-bespoke surfaces                                    (apps/<app>/)
              Sigil renderer (uses 1a only — presence surface)
              Sigil hit-area (uses 1a only — gesture surface)
              Sigil control panel (uses 1a + 1b + 2 — panel surface)
              Sigil studio, chat (panels; would benefit from 1a/1b on retrofit)
```

The panel branch (1b → 2 → 3-panels) is what the toolkit is *for*. The presence/scene branch (1a → 3-presence) is a sibling, not a child. They share Layer 0 and Layer 1a; they diverge above that.

## Layer 1a — Canvas runtime

A small, opinionated module that wraps the daemon's in-canvas wire. Every WKWebView surface — panel, avatar, hit-area, drawing surface, future thing — imports from here instead of reimplementing the bridge.

### Surface

```js
// packages/toolkit/runtime/index.js
//
// All helpers are pure functions or small factories — no classes to extend.

export function wireBridge(handler)            // installs window.headsup.receive
export function emit(type, payload?)            // postToHost wrapper, omits payload if undefined
export function subscribe(events, handler?)     // adds events to the daemon's per-canvas subscription
export function unsubscribe(events)             // inverse
export function spawnChild(opts)                // canvas.create with request_id round-trip; returns Promise
export function mutateSelf(opts)                // canvas.update on self (frame, interactive, etc.); fire-and-forget
export function removeSelf(opts?)               // canvas.remove on self
export function setInteractive(bool)            // sugar over mutateSelf({interactive})
export function declareManifest(manifest)       // assigns to window.headsup.manifest
export function onReady(handler)                // one-shot ready-handshake helper
export function emitReady()                     // sugar: emit('ready', window.headsup.manifest)

// Convenience re-export — used by panel chrome and content alike
export { esc } from './esc.js'
```

### What lives here vs Layer 0

Layer 0 owns the wire (Swift socket + WKWebView messageHandler + the JSON contract). Layer 1a owns the **JS-side ergonomics** — assembling messages, parsing responses, managing subscription lifecycle, providing typed-feeling helpers. Zero new daemon capability; this is purely a packaging layer.

Round-trip semantics for `spawnChild` and `removeSelf` use the existing `request_id` / `canvas.response` mechanism (2026-04-11 spec) — Layer 1a generates the id, attaches a one-shot listener to `headsup.receive` that resolves the returned Promise on response, and times out after a configurable interval (default: 5s).

### Why a module, not a class

A class encourages "is a Canvas" thinking — every surface inherits from `Canvas` and overrides hooks. That's exactly the trap `AosComponent` fell into. Modules encourage "uses canvas" thinking — surfaces compose the helpers they need and ignore the rest. The avatar renderer needs `subscribe` and `spawnChild` but has no use for `declareManifest`; it just doesn't import it.

### Hit-area note

The hit-area is the smallest legitimate Layer 1a consumer (~50 lines today). It needs `wireBridge`, `emit`, possibly `subscribe`. Migrating it is the cheapest validation that Layer 1a's surface is correct. Slated as the second adoption (after the toolkit components themselves).

## Layer 1b — Panel primitives

Built on Layer 1a. Provides the panel-shaped scaffolding: chrome, content slot, message routing.

### Chrome

```js
// packages/toolkit/panel/chrome.js

export function mountChrome(container, { title, draggable = true, controls = [] })
  // Builds: panel wrapper + header (title, drag handle, controls) + content slot.
  // Returns: { panelEl, headerEl, contentEl, setTitle(), addControl() }
  // Drag uses Layer 1a's mutateSelf for position updates.
```

Pure DOM — no message handling, no content concerns. Just the visual scaffold.

### Content contract

A **Content** is a plain object (not a class) implementing four optional methods:

```ts
interface Content {
  render(host): HTMLElement | string    // required: produce the body DOM
  onMessage?(msg, host): void           // optional: receive messages routed by the host
  serialize?(): unknown                 // optional: capture state for tear-off / reload
  restore?(state, host): void           // optional: rehydrate from serialized state
  manifest?: Manifest                   // optional: declare name, accepts, emits, etc.
}
```

The `host` argument is a small handle the host passes in:

```ts
interface ContentHost {
  emit(type, payload?): void           // route an outbound message through the host's channel
  subscribe(events, handler?): void    // subscribe via Layer 1a, scoped to this content
  spawnChild(opts): Promise            // spawn a child canvas owned by this canvas
  contentEl: HTMLElement               // the slot the content was mounted into
}
```

Contents never touch `window.headsup` directly. They go through the host. This is what makes them embeddable: a content doesn't know whether it's the only thing in a panel or one of four tabs in a workstation.

### Manifest

Extensible at the host level, but the contract is:

```ts
interface Manifest {
  name: string                                  // required, unique per canvas
  accepts?: string[]                            // message types this content handles
  emits?: string[]                              // message types this content sends
  // host-recognized extensions (optional, unrecognized fields ignored):
  title?: string                                // human label (used by Tabs as the tab label)
  defaultSize?: { w: number; h: number }        // used by tear-off / standalone hosts
  channelPrefix?: string                        // used by the channel router (see below)
  icon?: string                                 // used by launchers / tab strips
  requires?: string[]                           // event streams to auto-subscribe (display_geometry, etc.)
}
```

The contract field set is intentionally tiny. Hosts can read extension fields they recognize. This keeps the manifest evolvable without breaking the contract every time someone adds a field.

### Channel router

When a host has multiple contents (e.g., Tabs), incoming messages need to reach the right one. The router uses **type-prefix dispatch**, building on the slash-namespaced convention already in place (`aura/intensity`, `colors/face`):

```
incoming message type: "log/append"
  → router checks each content's manifest.channelPrefix
  → finds content with channelPrefix: "log"
  → calls content.onMessage({ type: "append", ... }, host)   // prefix stripped
```

Contents declare a prefix; the router strips it before delivery. A content's `onMessage` sees `{type: "append"}` regardless of whether it's hosted standalone or alongside others. Messages without a recognized prefix are either broadcast to all contents (host-configurable) or dropped with a warning.

This is the cleanest extension of the existing convention. It does require contents in a multi-content host to declare a `channelPrefix`; standalone contents can omit it (the router degenerates to direct dispatch).

### Layouts

Layouts are hosts that arrange contents. v1 ships two:

**Single** — one content, full panel body.

```js
import { mountPanel, Single } from 'aos://toolkit/panel/index.js'
import LogContent from 'aos://toolkit/components/log-console/index.js'

mountPanel({ title: 'Log', layout: Single(LogContent) })
```

**Tabs** — multiple contents, one visible at a time, tab strip in the header.

```js
import { mountPanel, Tabs } from 'aos://toolkit/panel/index.js'
import Inspector from 'aos://toolkit/components/inspector-panel/index.js'
import Log from 'aos://toolkit/components/log-console/index.js'
import CanvasInsp from 'aos://toolkit/components/canvas-inspector/index.js'
import SigilControl from 'aos://sigil/control/index.js'

mountPanel({
  title: 'Sigil Workstation',
  layout: Tabs([Inspector, Log, CanvasInsp, SigilControl])
})
```

Both Single and Tabs are functions that return a *layout instance* — an object the panel knows how to mount. They consume Layer 1a (subscribing on behalf of contents, routing messages, lifecycle bookkeeping) and Layer 1b chrome (titles, tab strip rendering).

Future layouts (`Split`, `Floating`, `Launcher`) follow the same shape. Tear-off is implemented as a Tabs feature that calls `spawnChild` to create a new canvas hosting `Floating(content)`, then removes the tab.

### Lifecycle

Contents have a simple lifecycle, called by the host:

```
mount(host)        — content.render() runs, returned DOM goes into host.contentEl;
                     content.restore(state, host) runs if state was provided;
                     host wires manifest/subscribe/router.
unmount()          — content.serialize() captures state (if defined);
                     content's DOM removed; subscriptions cleaned up.
```

For tear-off: `unmount` on the source tab → serialize → `spawnChild` with state in the URL query or via canvas.eval after creation → new canvas mounts content with that state.

For re-dock: similar, but inbound — the floating canvas serializes itself, posts state to the workstation, removes itself, workstation re-mounts the content into a new tab with the state.

## Migration order

Strangler-fig pattern, per renderer-strangler's recommendation. Each step is independently shippable, bisection-friendly, behind a per-step commit.

### Step 0 — Lay Layer 1a alongside the existing `_base/`

Create `packages/toolkit/runtime/` with the helpers above. Existing `_base/bridge.js` is the seed — decompose it. `AosComponent` continues to work unchanged.

### Step 1 — Lay Layer 1b alongside `AosComponent`

Create `packages/toolkit/panel/` with `chrome.js`, `content.js` (the contract documentation), `router.js`, `layouts/single.js`, `layouts/tabs.js`. `mountPanel` is the entry point.

### Step 2 — Migrate the three existing toolkit components

Each as its own commit. The shape is roughly:

- `inspector.js` exports a Content object (`{render, onMessage, manifest}`) instead of extending `AosComponent`.
- `index.html` calls `mountPanel({ title: '<>', layout: Single(<Content>) })` instead of instantiating the class.
- `launch.sh` retires its event-relay Python subprocess; the content uses Layer 1a `subscribe` directly.

Order: **canvas-inspector first** (most complex, validates subscribe + child-canvas patterns), **inspector-panel** second, **log-console** last.

Verification per commit: launch the standalone, exercise its primary function, confirm parity. The `launch.sh` subprocess goes away; the components become smaller.

### Step 3 — Build Tabs layout (proof of composition)

With three Content units in hand, build `layouts/tabs.js` and ship a manual test page (`packages/toolkit/components/_dev/tabs-demo/index.html`) that hosts all three. This validates the channel router, manifest-prefix dispatch, and content-host plumbing before any app consumes it.

### Step 4 (separate session — Sigil-owned) — Sigil control panel

Out of scope for this spec's implementation. Lives at `apps/sigil/control/` because it edits Sigil-specific data. Will be built on Layer 1a + 1b once those ship. Following renderer-strangler's guidance:

- Live mode toggles use `canvas.eval` to mutate `state.X` directly in the renderer (low-cost path; no daemon-side stream needed initially).
- Save (or debounced auto-save) writes the agent doc via the wiki write API.
- Renderer's existing `wiki_page_changed` reload path handles persistence.

Mounts as `Single(SigilControl)` for standalone use, can be embedded in a future Sigil Workstation as one of multiple `Tabs(...)`.

### Step 5 (separate session — surface-owner-coordinated) — Migrate non-toolkit canvases to Layer 1a

Each is a separate commit, coordinated with the surface owner. Suggested order (separate session(s)):

- **hit-area** — smallest, easiest. Could be the pilot of Step 5.
- **chat** — replaces its inline bridge plumbing with Layer 1a; manifest is already Layer-0.5-compatible. Probably one tight commit.
- **studio** — its own bespoke shell stays; Layer 1a replaces the bridge plumbing only.
- **renderer** — coordinated with renderer-strangler; touches stable code. Slated last; the win is real but not urgent.

### Step 6 (separate spec) — Tear-off and Floating layout

Once Tabs is shipped and proven, design tear-off as a tabs-strip drag gesture that calls `spawnChild` with serialized state. Re-dock follows the inverse path. Out of scope for this spec.

## Compatibility and risks

### `AosComponent` retirement

`AosComponent` is kept as a thin compatibility wrapper through Step 2 — internally it constructs a Single(Content) panel. After Step 2, it can be deleted; nothing else extends it.

### Cross-state guards (renderer-strangler flag)

Per renderer-strangler's reply: the inline `updateAllColors` in the renderer reads sprite refs the modules now own and uses `if (state.X)` guards to handle the boot-order race. If the Sigil control panel introduces fields read by inline code before module init, similar guards may be needed. Probably non-issue at control-panel scope but documented here.

### Parent-child cascade convention (renderer-strangler flag)

The renderer's hit-area gets free cleanup because it's a child canvas. Tear-off canvases must follow the same convention (created via `spawnChild`, which uses `canvas.create` with the parent's id) so they get the same cleanup if the workstation is closed unexpectedly.

### Channel router scope

The router handles message *delivery* between host and contents. It does not handle inter-content messaging — if Tab A wants to talk to Tab B, that's an explicit choice the host makes (e.g., a host-level event bus). v1 keeps router scope narrow: incoming daemon messages → right content; outgoing content messages → daemon. Cross-tab is a future feature if a real use case appears.

### Manifest discoverability

There is no daemon-side manifest registry. Manifests live in canvas memory only. If a future use case needs "list all canvases and their manifests," that's a Layer 0 enhancement (likely a new `canvas.list --manifests` flag) — out of scope here.

## Testing strategy

Per renderer-strangler's strangler-fig principles:

- **Per-subsystem commits** — Layer 1a, Layer 1b, each component migration, each layout, each app surface migration.
- **Smoke per commit** — daemon restart, launch the affected surface, verify primary function, grep daemon log for JS errors.
- **Pilot before scaling** — Step 2's first migration (canvas-inspector) is the pilot for the Content + Single pattern. If it surfaces friction, defer Steps 2b/2c and revisit.
- **Bisection grain** — each commit small enough that a regression bisects to a focused diff.

Automated tests for JS components are out of scope for this spec; visual smoke is the contract. A future testing harness (`apps/sigil/tests/` shows the seed of one) could grow into a real runner — separate concern.

## Open questions for implementation (not blocking)

1. **`subscribe` event allowlist.** Today's daemon allows `display_geometry`, `input_event`, `wiki_page_changed`. The toolkit components likely want `canvas_lifecycle` (currently broadcast on `aos show listen`). Confirm this is in the allowlist or extend the daemon to include it. If extension is needed, file as a small Layer 0 enhancement before Step 2.

2. **`canvas.eval` ergonomics from JS.** Today `canvas.eval` is socket-only. Sigil control panel using `canvas.eval` to mutate the renderer means going through... what, exactly? Per renderer-strangler's reply, there's room for either piggybacking on existing patterns (probably a new `canvas.eval`-from-JS action mirroring `canvas.create`) or adding a fresh `mode.update` stream. Decision deferred to the Sigil control panel's own spec.

3. **Standalone launcher.** Today each component has a `launch.sh`. After Step 2 these are nearly identical (create canvas, point at component URL). A `mountStandalone(componentId)` helper or a single `aos://toolkit/standalone/<componentId>` URL pattern would replace all of them. v1 keeps the per-component scripts for compatibility; replacement is a follow-up.

4. **Naming of `mountPanel` and the layout functions.** Currently sketched as `mountPanel({ layout: Single(...) })`. Could be `Panel.mount({ layout: ... })` or `panel({ layout: ... })`. Bikeshed at implementation; the shape matters more than the name.

## References

### Specs that informed this design
- `docs/superpowers/specs/2026-03-28-heads-up-message-convention-and-celestial-decoupling.md` — `{type, payload}` envelope, manifest convention, OSC-inspired addressing.
- `docs/superpowers/specs/2026-04-05-shared-ipc-and-component-scaffold.md` — composition over inheritance principle, shared bridge/theme assets, "abstractions earn their place" rule.
- `docs/superpowers/specs/2026-04-08-aos-content-server.md` — `aos://` URL scheme that makes ES-module imports across files work.
- `docs/superpowers/specs/2026-04-11-canvas-mutation-api.md` — `canvas.create/update/remove` from JS, parent-child cascade, response channel.
- `docs/superpowers/specs/2026-04-12-display-geometry-stream.md` — `subscribe`/`unsubscribe` machinery; one of the streams Layer 1a wraps.
- `docs/superpowers/specs/2026-04-12-extended-input-events.md` — sibling subscribe stream.
- `docs/superpowers/specs/2026-04-14-union-canvas-foundation-design.md` — `--track` flag and topology retarget; relevant for tear-off floating canvases that may want to track the workstation.

### Code touchpoints (current)
- `packages/toolkit/components/_base/{base.js,bridge.js,theme.css}` — what gets decomposed into Layer 1a / 1b.
- `packages/toolkit/components/{inspector-panel,log-console,canvas-inspector}/` — Step-2 migration targets.
- `src/daemon/unified.swift:31-188, 137-630` — the canvas mutation API and event subscription wiring this design consumes.
- `src/display/canvas.swift:480-614` — the per-canvas onMessage handler whose contract Layer 1a wraps.

### Coordination
- `handoff` channel pointer `01KP6565358WVTAVKY2TSG8TTX` — renderer-strangler's reply confirming no file-level collision and recommending the hybrid wiki-write + live-message approach for Sigil control panel.

### Issues that touch this work
- **#45** — opt-in canvas window frame. Adjacent: when a tab tears off, the floating panel could opt into native chrome instead of `Layer 1b` painted chrome.
- **#60** — unify anchor + tracking. Adjacent: tear-off floating canvases may want to track the workstation as their parent.
- **#61** — Swarm + Grid renderer migration (renderer-strangler's open follow-up). No direct overlap but uses the same strangler pattern this design adopts for Step 2.
