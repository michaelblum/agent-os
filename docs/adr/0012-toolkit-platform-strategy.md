# Toolkit Platform Strategy

Status: Accepted
Date: 2026-05-15
Related: [#328](https://github.com/michaelblum/agent-os/issues/328), [#325](https://github.com/michaelblum/agent-os/issues/325), [#326](https://github.com/michaelblum/agent-os/issues/326), [#327](https://github.com/michaelblum/agent-os/issues/327)

Originally recorded as `docs/decisions/ADR-001-toolkit-platform-strategy.md`
with title `ADR-001: Toolkit Platform Strategy`; migrated into the canonical
ADR namespace on 2026-05-20.

## Context

Agent-OS toolkit surfaces currently use a small vanilla JavaScript layer for
controls, panel chrome, layouts, and in-canvas runtime messaging. The layer is
working for first-party surfaces, but #328 asks whether that should become the
platform contract or whether Agent-OS should delegate generic UI behavior to a
headless library and define a runtime-agnostic surface protocol instead.

This decision is based on:

- reading `packages/toolkit/controls/`
- reading `packages/toolkit/panel/layouts/`
- auditing `packages/toolkit/runtime/manifest.js`,
  `packages/toolkit/runtime/bridge.js`, `packages/toolkit/panel/router.js`,
  and the content-host contract in `docs/api/toolkit/content-host.md`
- reviewing `packages/toolkit/components/_base/theme.css`,
  `packages/toolkit/controls/defaults.css`, and
  `packages/toolkit/panel/defaults.css`
- reviewing the sibling `../open-design` checkout
- a throwaway branch spike, `spike/ark-ui-surface-probe`, using
  `/tmp/aos-ark-ui-spike`

The Ark UI spike installed `@ark-ui/react@5.36.2`, `@zag-js/*@1.40.0`,
`react@19.1.0`, and `react-dom@19.1.0` outside the repo. It server-rendered an
Ark `Switch` and `Select` with AOS classes and `host.emit(...)` callbacks wired
through component props. The rendered switch produced `data-scope`,
`data-part`, `data-state`, and a hidden checkbox when `Switch.HiddenInput` was
present. The rendered select produced a combobox trigger, listbox content,
options, and a hidden native `<select>`.

## Decision

Agent-OS surfaces are runtime-agnostic HTML/JavaScript modules at the daemon
boundary. The platform contract is the surface manifest, bridge message shape,
event subscriptions, lifecycle readiness, and token contract. It is not a
single component framework.

First-party toolkit code should keep owning AOS-specific behavior: canvas
lifecycle, `host.emit` / `onMessage`, manifest aggregation, panel/window
policy, split-pane/tabs composition, workbench shells, DesktopWorld affordances,
input-region routing, and accessibility semantics that cross the daemon/toolkit
boundary.

Generic, custom interactive primitives should not be expanded in-house. For
new complex generic primitives, prefer a headless-library adapter. For
third-party surfaces, allow authors to bring React, Vue, Svelte, Solid, Web
Components, or vanilla JavaScript as long as the surface emits and receives the
Agent-OS protocol and honors the token/accessibility contract.

## 1. Surface Runtime Contract

Agent-OS should support any browser runtime that can run inside the WKWebView
content server and can call the bridge:

- vanilla JavaScript modules
- React
- Vue
- Svelte
- Solid
- Web Components
- bundled framework output from third-party build systems

The stable platform boundary is framework-neutral:

- `declareManifest(manifest)` stores a plain object on
  `window.headsup.manifest`.
- `emitReady()` emits `ready` with that manifest.
- `emit(type, payload?)` posts `{ type, payload }` to
  `window.webkit.messageHandlers.headsup`.
- `wireBridge(handler)` installs inbound delivery through
  `window.headsup.receive(base64Json)`.
- content objects expose `manifest`, `render(host)`, `onMessage(msg, host)`,
  `serialize()`, and `restore(state, host)`.
- panel routers dispatch by `manifest.channelPrefix`, stripping
  `prefix/` from matched message types and broadcasting unmatched messages.

Nothing in the manifest or message protocol requires React, virtual DOM,
custom elements, or vanilla DOM constructors. The current protocol is already
framework-agnostic in practice. Runtime-specific adapters are useful for
developer ergonomics, but they should compile down to the same manifest and
message-passing contract.

## 2. Toolkit Layer Architecture

Own these layers in Agent-OS:

- runtime bridge, manifest declaration, lifecycle readiness, subscriptions,
  child canvas creation, mutation, and eval helpers
- panel/window policy: chrome, drag, resize, close, minimize, maximize,
  restore, placement, safe defaults, and stage affordances
- layouts that compose AOS content units and aggregate manifests, especially
  `Single`, `Tabs`, and `SplitPane`
- workbench shells and subject-aware surfaces
- DesktopWorld visuals, input regions, routed input normalization, and
  surface-resource ownership
- token naming and default AOS visual language

Delegate or adapt these layers:

- generic custom select, combobox, menu, popover, dialog, switch, tabs,
  toggle-group, slider, and roving-focus behavior
- focus trapping, typeahead, dismissal, positioning, and complex ARIA state
  machines
- framework-specific component APIs for third-party authors

Keep these existing vanilla controls for first-party compatibility:

- native control wrappers such as text field, textarea, native select,
  checkbox group, toggle, and button
- string-render helpers only where current first-party string surfaces need
  them
- number-field wheel/key behavior where AOS surfaces already depend on it

Do not turn `packages/toolkit/controls/` into a full design-system component
library. Its job is a compatibility and low-level semantic wrapper layer until
the platform has explicit adapters for headless primitives.

## 3. Headless Library Recommendation

Adopt an allowed-list policy now. Do not migrate all first-party surfaces to a
headless library yet.

| Library | License | Runtime fit | npm package evidence | Assessment |
| --- | --- | --- | --- | --- |
| Radix UI | MIT | React-only primitives | `@radix-ui/react-select@2.2.6`, unpacked package about 328 KB, React/React DOM peers | Strong React accessibility library, but not a platform default because it excludes non-React surfaces. Good for React third-party surfaces. |
| Ark UI / Zag.js | MIT | Ark supports React/Vue/Solid/Svelte wrappers; Zag provides framework-neutral machines | `@ark-ui/react@5.36.2` unpacked about 3.2 MB and depends on many `@zag-js/*` packages; targeted Zag packages such as `@zag-js/core`, `@zag-js/switch`, and `@zag-js/select` installed to about 3.8 MB in the spike before React, about 41 MB with Ark React plus React/React DOM installed | Best strategic fit. Zag's state-machine model maps cleanly to AOS's event-driven protocol, but vanilla first-party use needs an adapter layer. Ark React works when a surface chooses React. |
| React Aria | Apache-2.0 | React-only | `react-aria-components@1.17.0`, unpacked about 5.9 MB, React/React DOM peers | Deep accessibility coverage and internationalization, but too React-specific and too broad for the default toolkit layer. Good for sophisticated React surfaces. |
| Ariakit | MIT | React-only | `ariakit@2.0.0-next.44`, unpacked about 1.5 MB, React 17/18 peers | Accessible React primitives, but current package line is `next` and less aligned with AOS's framework-neutral contract. Allow, but do not standardize on it. |

Recommendation:

- allow third-party surfaces to use Radix, Ark, React Aria, Ariakit, or other
  compatible browser-side libraries
- prefer Ark UI / Zag.js for any first-party adapter experiment because Zag's
  finite-state-machine model is closest to AOS message routing
- do not make Ark React the default first-party toolkit dependency
- create a small `packages/toolkit/adapters/zag/` only when a real first-party
  complex primitive needs it

## 4. open-design Disposition

Do not absorb the whole `open-design` repo into Agent-OS as toolkit code.

`../open-design` is a local-first design product with a web app, daemon,
agent-adapter concept, skill registry, artifact store, and `DESIGN.md`
resolver. Its root package is private, Apache-2.0, and product-scoped. That is
larger than the Agent-OS toolkit token question.

Absorb only the token/schema concept as `packages/design-tokens`, with a future
published package name of `@agent-os/tokens` when stable. Keep open-design as a
separate product/repo unless a later workstream explicitly merges product
responsibilities.

The existing toolkit CSS is close to a deployable token contract but not yet a
published one:

- `components/_base/theme.css` defines `--aos-*` font, type, panel, control,
  focus, icon, and window-control tokens.
- `controls/defaults.css` and `panel/defaults.css` consume those tokens.
- legacy aliases such as `--bg-panel`, `--font-ui`, and `--radius-panel` still
  exist for compatibility.

Gaps before publishing:

- extract source-of-truth tokens into DTCG-style JSON
- define stable categories for color, typography, spacing, radius, shadow,
  focus, z/layer, and motion
- separate semantic tokens from current Nexus-themed values
- generate CSS custom properties from JSON instead of treating CSS as the
  source
- publish a token-only usage contract for surfaces that bring their own
  component library

A token-only third-party surface should import or generate the AOS tokens, use
its own component library, and map visual decisions to `--aos-*` semantic
properties. It does not need to use `packages/toolkit/controls/`.

## 5. Impact On In-Flight Work

#325 should be redirected, not closed.

The redirected scope should be:

- add only the missing string helpers needed to remove current first-party
  `controlHtml()` workarounds
- keep signatures aligned with the existing low-level helpers
- document the helpers as first-party compatibility utilities, not as a signal
  that Agent-OS is building a full bespoke headless component system
- avoid adding richer custom ARIA behavior to this layer

#325 should not proceed under the motivation "complete the bespoke render layer
for every control type." It may proceed as a narrow compatibility patch because
current string-rendered surfaces need symmetry and the cost is low.

#326 should proceed, but its rationale is different. Split-pane is AOS-specific
because it composes content manifests, prefixes routed messages, emits
`split-pane/resized`, and belongs to panel/workbench policy. It should not wait
for headless-library migration.

#327 should stay on hold until `packages/design-tokens` and the helper boundary
are explicit. Workbench-shell helpers are more likely to become AOS-specific
layout policy plus token usage than generic control render helpers.

## Consequences

- Third-party surface authors are not forced into vanilla JavaScript.
- Agent-OS has one protocol contract instead of one contract per framework.
- First-party surfaces can keep shipping with the current vanilla controls.
- Complex future controls should use headless-library adapters instead of
  hand-rolled ARIA behavior.
- Token work becomes a platform package, not a wholesale open-design merge.
- The toolkit stays layered: daemon primitives below, toolkit policy in the
  middle, app/product expression above.
