# PR 382 Thermo-Nuclear Review — Round 2

Reviewer: Foreman (thermo-nuclear code-quality bar).
PR: https://github.com/michaelblum/agent-os/pull/382 (`implementer/context-selection-mode-recording-follow-through-v0`).
Base: `main`. Scope reviewed: +15,074 / −143 across 98 files; deep structural read of the new Sigil renderer runtime, the UX-tree command adapter, the toolkit context-session/selection-mode shapers, the context-session schema, and the UX-tree readiness audit.

## Verdict

Do not accept as-is. This is round 2; round 1
(`pr-382-thermo-nuclear-review-corrections-v0.md`) flagged two blockers.

- **Blocker 2 (embedded `data:`/`blob:` asset refs): genuinely fixed, with
  runtime↔schema parity.** Credit — see "Verified clean."
- **Blocker 1 (main.js owns too much): only partially addressed.** Line count
  dropped (4,778 → 4,411) but the file is still +485 over `main` and still hosts
  the feature behind wrappers. More importantly, the *mechanism* used to "route"
  features — the UX-tree command adapter plus a per-site fallback — is now the
  dominant new maintainability problem and clears the thermo-nuclear bar as a
  structural regression in its own right.

Headline: the command-adapter "cutover" did not replace the handwritten input
paths; it layered a second path on top of them. At every cutover site except
Selection-Mode Escape, the registry handler and the inline fallback resolve to
the **same** runtime behavior, so the adapter changes nothing at runtime — it
adds concepts, duplicates behavior across two code paths, and routes through a
gate that controls nothing, because the fallback runs whenever the adapter
declines.

## Findings (severity order)

### 1. [Structural regression] Adapter + same-behavior fallback: added concepts, zero behavior change, fail-open gate

The new pattern at every avatar/selection/radial/context-menu site is
`executeXCommand(INPUT, …, { fallback })`, where the registry handler and the
`fallback` resolve to the **same** underlying behavior.

Evidence (HEAD line numbers):

- Registry instance, `apps/sigil/renderer/live-modules/main.js:2560-2611`. Each
  handler and its matching call-site fallback perform the same state mutations —
  equivalent effect, not identical source. The adapter path adds only a `pointer`
  guard and a return value (e.g. `avatarPressBegin` reads `pointer.x/pointer.y`
  and returns `{ state, pointer }`; the fallback reads `x, y` and returns
  nothing). Modulo that cosmetic wrapper they are two copies of one behavior:
  - `avatarPressBegin` (`main.js:2561-2567`) ≡ fallback in `handleLeftMouseDown`
    IDLE (`main.js:3079-3090`): both set `mousedownPos` / `mousedownAvatarPos` /
    `setInteractionState('PRESS', …)`.
  - `avatarGotoBegin` (`:2568-2575`) ≡ fallback in `handleLeftMouseUp`
    (`:3117-3135`).
  - `radialBegin` (`:2576-2588`) ≡ fallback in `handleMouseMove` (`:3205-3219`).
  - `selectionModeEnter` (`:2589-2596`) ≡ fallback in `handleLeftMouseDown` GOTO
    (`:3091-3105`).
- Selection-mode keys: `selection-mode-runtime.js:382-409` (`handleInput`) passes
  `fallbackForRoute(route)` (`:362-380`); that fallback calls
  `commit/cycleTarget/acquire` — the **same** runtime methods the registry
  handlers (`main.js:2598-2604`) call.
- Radial items: `executeRadialItemCommand` (`main.js:1564-1586`) routes through
  the registry handler `radialReleaseItem` and, on decline, calls
  `radialItemActionDispatcher.dispatch(...)`. Both terminate in the same
  `dispatch` (`radial-item-action-dispatch.js:71-118`, `commandHandlers:132-152`).
- Right-click: `contextMenuToggle` handler (`main.js:2607-2611`) ≡ the toggle
  fallback (`main.js:3315-3322`); `contextMenuOpen` handler →
  `dispatchContextMenuOpen` → `openContextMenuAt` ≡ the open fallback
  (`main.js:3323-3331`).

Why it fails the bar:

- **(a) Duplicated bodies.** Two copies of each effect must be kept in sync; edit
  one and behavior silently diverges based on whether the UX-tree resolves — a
  far-away condition. (Skill: "fallback behavior duplicates the primary path
  rather than sharing a single implementation.")
- **(b) The adapter is non-authoritative — its gate has no behavioral effect.**
  `executeSigilUxTreeCommand` (`ux-tree-command-registry.js:237-316`) fails closed
  *as a component*: it returns `executed:false` for `invalid_tree` /
  `binding_not_found` / `command_not_found` / `command_not_allowlisted` /
  `handler_not_registered` / `handler_error`, and never executes values embedded in
  the tree. But at every cutover site that decline immediately fires the fallback,
  which performs the action anyway. So the adapter never becomes the owner of
  dispatch — whatever it declines still happens — and its allowlist/validation
  result changes nothing at runtime today. (Skill: "an adapter layer calls back into
  the same old local branches instead of becoming the actual owner of dispatch.")
  To be precise about what this is *not*: it is not a security hole. The cutover
  card's "fail closed" guards against executing untrusted values embedded in the UX
  tree, and the fallback runs trusted hardcoded local JS, not tree content. The
  defect is that the gate is inert, not that it leaks.
- **(c) Concept count went up, not down.** Before: `input → runtime method`. Now:
  `input → resolveRoute → executeCommand → binding lookup → allowlist → registry
  handler → runtime method`, *plus* the parallel `fallback → same runtime method`.
  (Skill core bar: "moves complexity around without reducing the number of
  concepts a maintainer must hold.")
- **(d) Only Escape is a real cutover.** `fallbackForRoute`
  (`selection-mode-runtime.js:362-380`) has no branch for `escape`, so Escape's
  fallback is a no-op and it fails closed. That exactly matches the sanctioned
  slice in `sigil-ux-tree-command-adapter-cutover-v0.md` ("first live cutover:
  Selection Mode Escape"). Every other binding exceeded that slice but kept the
  old handwritten path alive as a fallback.

Pre-empting the expected defense ("the fallback is migration safety"): round 1's
correction card deferred removal "unless focused tests prove the adapter path and
fallback path are equivalent and the removal reduces complexity." They are
equivalent **by construction** — handler and fallback resolve to the same behavior
(for selection-mode commit/cycle/acquire and radial items, the very same runtime
call) — so that precondition is already met. The skill rejects standing
exception/mode/wrapper paths outright.

Cleaner direction (choose one and apply it consistently):

- If the adapter is meant to own dispatch: delete the per-site fallbacks; make each
  registry handler the single implementation; let a genuine resolution failure fail
  closed (record + no-op) with tests covering each decline reason. The Sigil UX tree
  is static, so resolution for these bindings can be guaranteed.
- If the adapter exists only for inspectability/telemetry: don't gate behavior on
  it. Call the runtime method directly at the site and let the adapter observe and
  record around it.
- Non-negotiable either way: a handler and any retained safety path must share one
  function body, never a copy.

### 2. [Missed simplification / ownership] main.js still owns the feature behind wrappers

- `main.js` 3,926 (`main`) → 4,411 (HEAD), +485 net. This is **not** a crosses-1,000
  case (it was already huge); the applicable concern is that the file round 1
  explicitly asked to slim absorbed +485 net of new feature orchestration.
- The entire `sigilUxCommandRegistry` instance — ~15 handlers closing over main.js
  internals — is defined inline at `main.js:2560-2611`. So
  `ux-tree-command-registry.js` is a thin factory + input constants while the command
  *behavior* still lives in main.js. The lookup/adapter policy moved; the behavior
  did not.
- Five near-identical execute wrappers, each = `executeSigilUxTreeCommand(snapshot)
  + recordUxCommandRuntime + optional fallback`:
  `executeRadialItemCommand` (`:1564`), `executeSelectionModeCommand` (`:2638`),
  `executeSelectionModeRouteCommand` (`:2656`),
  `executeContextMenuRightClickCommand` (`:2664`), `executeAvatarCommand` (`:2678`).
  Collapse to one `runUxCommand(input, { context, fallback })`.
- ~13 pure forwarding wrappers to the extracted runtimes/tracker
  (`createContextKeyframeForSession`, `setActiveContextProvider`,
  `updateActiveContextFromReticle`, `appendContextRecording*`, `enterSelectionMode`,
  `exitSelectionMode`, `acquire/cycle/commit/setNodeComment/createContextFromDebugInput/
  handleSelectionModeInput`, and the double-click `consume/reset/mark/clear` set).
  Some are justified to preserve `window.__sigilDebug` names; many are pure
  indirection.

Cleaner direction: give `createSigilUxTreeCommandRegistry` its dependencies so it
builds and owns the registry plus the single execute wrapper; main.js keeps
lifecycle wiring, projection, and the debug-API surface. Keep only the forwarders
that genuinely back a preserved debug-API name.

### 3. [Validation surface false-certifies] readiness audit reports "routed" from handler registration alone

`ux-tree-readiness.js:152-189, 275-312`: a binding is certified
`routed_through_ux_command_adapter` (and counts toward `ok:true`) iff its id is in
the hand-maintained `DEFAULT_ROUTED_BINDING_IDS` set (`:12-25`) **and** its command
has a registered handler. It never verifies that the call site actually routes
through the adapter, nor that a fallback isn't doing the real work.

Given Finding 1, this audit will report every avatar/selection/radial/context-menu
binding as healthily "routed through the adapter" even when, at runtime, the inline
fallback serves it (whenever tree resolution declines). That is precisely the
skill's "a readiness, validation, or debug surface can falsely certify incomplete or
invalid state" — it certifies the cutover as done while it is structurally a
parallel path.

Compounding: `registryHandler` (`ux-tree-readiness.js:94-115` and the twin in
`ux-tree-command-registry.js:140-160`) accepts `handler_ref` OR `id`, against a Map
OR plain object OR nested `.handlers` — a loose multi-shape contract that makes
"registered" cheap to satisfy. (Skill: "loosely typed boundary relies on silent
fallback.")

Cleaner direction: derive routed-ness from the registry itself rather than a
hand-maintained id mirror, and tie `ok` to a single routing source of truth (which
Finding 1's resolution provides).

### 4. [Spaghetti growth] right_mouse_down branch got more conditional, not less

`main.js:3305-3345`: a 3-branch block became route-resolution + four branches +
nested `result.executed` checks + `contextMenuOpenCommandOpened` + a retained
`openContextMenuAt` fallback + duplicated `close`/`cancelInteraction` in both the
handler and the fallback. Net: harder to follow, identical behavior. Resolution is
subsumed by Findings 1–2 (one execute path, no duplicated fallback).

## Verified clean (credit / no action)

- **Blocker 2 fully resolved with parity.** `context-session.js:258-274` rejects
  `data:`/`blob:` case-insensitively after `trimStart()` for string refs and object
  `uri` refs, and rejects `base64`/`binary`/`image_data` keys.
  `aos-context-session-v0.schema.json:369-399` mirrors this:
  `"not": { "pattern": "^\\s*([Dd][Aa][Tt][Aa]|[Bb][Ll][Oo][Bb]):" }` on both the
  string branch and the object `uri`, `additionalProperties:false` on the object,
  and a case-insensitive `propertyNames` guard. Runtime and schema agree on the
  required cases. Only asymmetry: JS additionally deep-scans nested objects for
  `data:image/` via `JSON.stringify`; the schema instead forbids unknown nested
  props (`additionalProperties:false`) — effectively equal-or-stricter. No action.
- **Canonical layering is correct.** App `selection-mode-runtime.js` and
  `context-recording-runtime.js` **consume** the toolkit canonical shapers
  (`packages/toolkit/workbench/selection-mode.js`,
  `packages/toolkit/workbench/context-session.js`) via dynamic import instead of
  reimplementing them. Toolkit owns the data shape; the app owns the state
  machine/lifecycle — matches the architecture compass. No duplication finding here.

## Residual risk / evidence gaps

- Structural review only. I did not re-run the renderer/toolkit/schema tests or
  `./aos ready` in this pass (the PR lists them; not re-verified here). The findings
  are about maintainability, not a behavior regression — by inspection, behavior is
  preserved.
- `src/daemon/surface-inspector-bundle.swift` (1,307 lines, +202) and
  `packages/toolkit/components/surface-inspector/index.js` (3,357 lines, +41) grew
  but were not deep-read; large pre-existing files with small-to-moderate additions.
  Flag for a follow pass if they keep growing.

## Routing

Recommend a reversible round-2 correction: collapse the adapter/fallback duplication
(Finding 1) as the gating fix; Findings 2–4 largely fall out of it. This is a
structural correction, not a behavior change — Selection Mode, context recording,
radial, and context-menu semantics and the `window.__sigilDebug` API names stay
intact. Do not merge until Finding 1 is resolved.
