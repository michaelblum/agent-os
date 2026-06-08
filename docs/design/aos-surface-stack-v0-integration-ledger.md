# AOS Surface Stack V0 Integration Ledger

**Date:** 2026-05-12
**Status:** Integration checkpoint after Foreman issue reconciliation
**Epic:** #223 AOS Surface System

This ledger turns the completed surface-stack slices, live-smoke evidence, and
Foreman issue reconciliation into historical rationale for the V0 checkpoint.
Foreman reviewed and updated related GitHub issues on 2026-05-12. Query GitHub
for current issue titles, states, and labels before acting on any issue ID
listed here.

## Completed Slices

| Tracker | Work card | V0 result |
| --- | --- | --- |
| #304 | `docs/design/work-cards/toolkit-stage-backed-minimized-chips-v0.md` | Default minimized chips moved to passive DesktopWorld stage layers plus daemon input regions, with WebView chips retained only as explicit fallback. |
| #304, #122 | `docs/design/work-cards/toolkit-stage-affordance-extraction-v0.md` and `docs/design/work-cards/toolkit-stage-affordance-subscription-cleanup-correction-v0.md` | `createStageAffordance` became the reusable visual-hit binding, backed by deterministic cleanup and shared-subscription retention. |
| #122, #304 | `docs/design/work-cards/toolkit-surface-resource-scope-v0.md` | `createResourceScope` now owns child canvases, stage layers, input regions, subscriptions, bridge handlers, and custom cleanup callbacks. |
| #122, #223 | `docs/design/work-cards/toolkit-surface-interaction-decision-tree-v0.md` | `docs/guides/aos-surface-interaction-decision-tree.md` is the routing recipe for DOM, toolkit panel/windowing, StageAffordance, passive stage layers, full WebViews, private renderers, and daemon primitives. |
| #261 | `docs/design/work-cards/toolkit-panel-window-normalization-v0.md` | `createPanelWindowController` is the public toolkit path for panel placement, drag, resize, minimize, maximize, restore, close, and fallback behavior. |
| #261, #305 | `docs/design/work-cards/sigil-radial-item-workbench-panel-controller-v0.md` | Sigil radial item workbench now consumes `createPanelWindowController` for drag, resize, maximize, minimize, and close while preserving its 3D radial item preview as app-owned product UI. |
| #123 | `docs/design/work-cards/canvas-lifecycle-warm-suspend-resume-contract-v0.md` | `warmCanvas`, readiness waiting, `canvas.info`, suspend, resume, and lifecycle metadata form the V0 lifecycle baseline. |
| #120 | `docs/design/work-cards/daemon-toolkit-input-event-identity-contract-v0.md`, `docs/design/work-cards/toolkit-child-hit-surface-source-identity-v0.md`, and `docs/design/work-cards/toolkit-child-hit-surface-normalization-gate-correction-v0.md` | Routed input now carries source identity, child hit-surface identity, capture identity, and toolkit-normalized coordinate authority. |
| #303 | `docs/design/work-cards/daemon-generic-input-region-contract-v0.md` and `docs/design/work-cards/daemon-sigil-input-path-retirement-v0.md` | Daemon input regions are generic and Sigil-named daemon product branches have been retired. |
| #305 | `docs/design/work-cards/sigil-platform-input-region-adapter-v0.md`, `docs/design/work-cards/toolkit-desktop-world-hit-region-controller-v0.md`, and `docs/design/work-cards/sigil-avatar-hit-target-toolkit-controller-v0.md` | Sigil has bounded second-client groundwork through the input-region adapter, toolkit DesktopWorld hit-region controller, avatar/radial physical lifecycle migration, and child source identity cleanup. |
| #223 | `docs/design/work-cards/surface-inspector-surface-resource-visibility-v0.md` | Surface Inspector can show stage layers, input regions, affordance/resource metadata, owners, and stale/incomplete resource hints. |

## Verification Evidence

The accepted #304 real-pointer stage-chip proof is now part of the integration
baseline. The smoke ran after readiness reported `ready=true mode=repo
daemon=reachable tap=active`. The shared `aos-desktop-world-stage` already
existed and was owned by `__log__`, which exercised cross-owner shared-stage
readiness. The minimize path used the stage path with
`stageEnsureStatus.status: "already_exists"`, sent the stage-layer upsert,
registered body, restore, and close regions, and avoided the default
`aos-chip-*` WebView fallback.

No `FORBIDDEN ... may not eval aos-desktop-world-stage` or
`ready_check_failed` evidence appeared. The recorded hot-path timing was prompt:
real pointer click start `1778589123.978`; region registrations
`1778589124.545`, `.548`, and `.552`; source suspended `1778589124.648`;
controller timing `stageEnsureDurationMs: 0`,
`inputRegionRegistrationDurationMs: 9`, `sourceSuspendDurationMs: 167`, and
`totalElapsedMs: 178`.

Restore and close through chip regions removed the chip layer and all three
regions. Duplicate minimize produced one layer/region set rather than
duplicates. Final cleanup left no `surface-inspector`, no `aos-chip-*`, and the
shared DesktopWorld stage active with `layers: []`.

Deterministic coverage also exists across the surface-stack tests named by the
work cards, including toolkit runtime/resource scope, StageAffordance, panel
chrome/controller, input-region identity, lifecycle, Surface Inspector resource
visibility, and the decision-tree contract tests.

## Issue Disposition

| Issue | Foreman disposition |
| --- | --- |
| #304 | Closed as accepted V0. Default minimized chips now satisfy the DesktopWorld stage/input-region/prompt-cleanup scope; fallback retirement is a separate confidence/telemetry decision. |
| #303 | Closed as accepted V0. Generic daemon input regions exist, ownership/metadata/cleanup are in place, Sigil product-named daemon input branches are retired, and toolkit chips consume the primitive. |
| #122 | Closed as accepted V0. The toolkit DesktopWorld hit-region controller owns physical child hit-surface lifecycle and Sigil avatar/radial lifecycle migration uses it. Broader pointer-capture/router claims stay under #118/#119. |
| #120 | Closed as accepted V0. Input-event identity, routed/captured identity, child hit-surface source identity, and toolkit normalization are documented and tested; Sigil no longer uses `fromHitTarget` or `assumeInside` as semantic glue. |
| #123 | Closed as accepted V0. `warmCanvas`, readiness/status helpers, `canvas.info`, suspend/resume, and lifecycle metadata provide the primitive baseline. |
| #261 | Closed as accepted V0. The closure audit classifies daemon `drag_end` finalization as native mechanics that applies the toolkit-requested frame, not competing placement policy. Agent Terminal/editor/workbench migrations are landed, legacy chat is parked, and deterministic placement coverage now includes off-left/off-right/off-bottom clamp cases. |
| #305 | Closed as accepted V0. Sigil has reusable AOS-derived real-input surface test primitives, canonical radial verification, and topology-neutral DesktopWorld path radial coverage; future Sigil work should use exact follow-up cards rather than a broad remodel umbrella. |
| #118 | Closed as accepted V0. The generic interaction-router baseline exists in toolkit runtime and is consumed by Sigil context menu; the remaining child claims have moved to #120, #122, #123, #303, #304, or #305. |
| #119 | Closed as folded V0. The older epic's child claims are now accepted under the narrower trackers, the mega-canvas drift question is resolved, and future Sigil adoption belongs in exact follow-up cards. |
| #45 | Open but parked as historical/native-chrome exploration unless a future design explicitly chooses opt-in native macOS chrome. |

## #118 And #119 Closure Audit

The #118 DesktopWorld interaction-router exit criteria are satisfied by current
code and deterministic tests. `packages/toolkit/runtime/index.js` re-exports
`createDesktopWorldInteractionRouter`; `packages/toolkit/runtime/interaction-region.js`
implements logical region registration, region picking, pointer capture,
source identity, duplicate non-captured stream suppression, outside-pointer
callbacks, hover, unregister cancellation, and explicit capture release.
`tests/toolkit/runtime-interaction-region.test.mjs` covers those claims,
including duplicate hit/global stream suppression, trusted child source
identity, outside clicks, hover/leave, unregister cancellation, and explicit
release. Sigil's context menu imports and routes through that primitive in
`apps/sigil/context-menu/menu.js`, and its range mapping is delegated to
`packages/toolkit/runtime/range-drag.js` instead of app-local slider math.
`tests/renderer/input-message.test.mjs` guards that live Sigil source no longer
uses `fromHitTarget` or passes `assumeInside`; remaining `assumeInside`
references are toolkit compatibility coverage only.

The #119 epic can close as folded because its child claims now have accepted V0
homes. Physical avatar/radial hit-surface lifecycle is toolkit-owned through
`createDesktopWorldHitRegionController`, consumed by
`apps/sigil/renderer/live-modules/hit-target.js` and
`apps/sigil/renderer/live-modules/radial-menu-target-surface.js`, with focused
coverage in `tests/toolkit/runtime-desktop-world-hit-region.test.mjs`,
`tests/renderer/hit-target.test.mjs`, and
`tests/renderer/radial-menu-target-surface.test.mjs`. Input identity and child
hit-surface identity are accepted under #120; warm/suspend/resume lifecycle is
accepted under #123; generic daemon input regions and Sigil product-branch
retirement are accepted under #303; default minimized-chip stage/input-region
behavior is accepted under #304. The single-mega-canvas decision is no longer
open: keep `avatar-main` as Sigil's justified private 3D/product renderer, but
do not use it as the generic composition pattern for ordinary panels or simple
DesktopWorld layers. Future Sigil-as-second-client platform adoption should
stay in #305 bounded slices.

## #305 Second-Client Surface Inventory

The Sigil second-client audit finds no additional obvious live private platform
path to migrate in this slice. The active surfaces either consume accepted
daemon/toolkit primitives, are Sigil product expression, or are parked legacy
paths that should not be migrated without a new product decision.

| Surface | Primary bucket | Boundary evidence |
| --- | --- | --- |
| `apps/sigil/renderer/live-modules/main.js` / `avatar-main` | Product expression | Owns the Three.js avatar renderer, radial state machine, effects, agent appearance, utility activation, and product lifecycle. It consumes daemon `display_geometry`, `input_event`, `canvas_lifecycle`, generic `input_region.*`, and toolkit DesktopWorld helpers. The private full-coverage DesktopWorld canvas remains justified only for Sigil's distinct 3D/product renderer lifecycle. |
| `apps/sigil/renderer/live-modules/input-regions.js` | Platform consumer | Centralizes Sigil's generic daemon `input_region.*` claims for avatar and context-menu native capture, including owner selection, register/update/remove recovery, metadata, and suspend cleanup. No daemon Sigil-named product branch is required. |
| `apps/sigil/renderer/live-modules/hit-target.js` | Platform consumer | Avatar child hit-surface lifecycle and DesktopWorld placement are delegated to toolkit `createDesktopWorldHitRegionController`; Sigil keeps only avatar semantics and sizing. |
| `apps/sigil/renderer/live-modules/radial-menu-target-surface.js` | Platform consumer | Radial semantic target lifecycle and placement use toolkit `createDesktopWorldHitRegionController`; Sigil keeps radial item labels, actions, active-item mapping, and semantic target payloads. |
| `apps/sigil/renderer/hit-area.html` | Platform consumer | Minimal absorber/semantic child surface emits canvas-origin identity back to the parent; product interaction decisions are normalized in the renderer instead of owned by the child WebView. |
| `apps/sigil/renderer/radial-menu-surface.html` | Platform consumer | Minimal semantic target child surface uses toolkit semantic-target attributes and canvas-origin identity; it does not own radial product state. |
| `apps/sigil/context-menu/menu.js` | Platform consumer | Live avatar menu content remains Sigil-owned, while pointer routing uses toolkit `createDesktopWorldInteractionRouter` and range dragging uses toolkit range-drag helpers. |
| `apps/sigil/agent-terminal/` and `apps/sigil/codex-terminal/` | Platform consumer | Agent Terminal is the canonical launch path; the historical Codex terminal path is a compatibility wrapper around the canonical Agent Terminal/toolkit bridge substrate. The live shell uses toolkit `mountChrome`, panel drag/resize/minimize/maximize policy, and `createFixedSidebarPane`; provider/session content remains app-owned. |
| `apps/sigil/radial-item-editor/` | Platform consumer | Window movement uses toolkit `createPanelWindowController`; Three.js orbit/object manipulation and radial item editing remain Sigil product expression. |
| `apps/sigil/radial-item-workbench/` | Platform consumer | Drag, resize, maximize, minimize, and close use toolkit `createPanelWindowController`; split-pane and object-transform controls come from toolkit while 3D radial preview/editing remains app-owned. |
| `apps/sigil/studio/` | Parked legacy | Historical avatar configuration URL/path. It is useful for compatibility and old workflows, but it should not receive platform migration work unless a new product decision revives it. |
| `apps/sigil/workbench/` | Parked legacy | Historical multi-tab Sigil shell. It already consumes toolkit `mountPanel`/`Tabs`, but it is not the standard launch or verification path for current Sigil work. |
| `apps/sigil/chat/` | Parked legacy | Legacy conversational canvas still contains raw `drag_start` / `move_abs` / `drag_end` window movement, but the surface is explicitly superseded by Agent Terminal. Do not spend #305 migration work here unless Sigil Chat 2 is chosen as a new product path. |

The broad #305 remodel claim is no longer carrying an unverified V0 surface
gap: real-input Sigil radial behavior is expressed through reusable AOS-derived
test primitives, and the DesktopWorld path scenario now has topology-neutral
coverage. Future Sigil platform work after that should be split into new exact
cards rather than keeping #305 open as a remodel umbrella. Candidate
future cards are: retire or replace legacy `chat/`, `studio/`, and `workbench/`
paths if product wants them live again; evaluate a shared 3D stage only if a
second app needs Sigil-class 3D DesktopWorld rendering; and retire historical
file-path shims such as `codex-terminal/` only after the compatibility entrypoint
no longer reduces operator friction.

Live real-input verification found one small platform-consumer reliability gap:
the radial child surface could miss its first semantic-target payload if the
parent sent it before the child installed its receive handler, after which
deduplication suppressed replay. The V0 fix keeps the migration boundary intact:
`createDesktopWorldHitRegionController` exposes a generic payload refresh, and
the Sigil radial child requests that refresh when its script is ready.
Foreman reran the canonical real-input scenario twice on 2026-05-12 with
`AOS_REAL_INPUT_OK=1 bash tests/scenarios/sigil/radial-menu/real-input.sh`.
Both runs passed, with Surface Inspector visible/active during the scenario,
avatar fast travel confirmed, radial semantic targets captured, and Wiki
Workbench opened by the final radial release. The clean post-run state was
`__log__`, `aos-desktop-world-stage`, and active `surface-inspector`.
That is accepted as canonical-path evidence. Implementer then rebuilt the real-input
harness around shared DesktopWorld path primitives. The follow-up scenario is no
longer display-seam-specific: it computes the visible DesktopWorld union,
insets it by radial-menu-safe padding, fast-travels the avatar through a
centered four-step X/figure-eight path, reopens the radial menu at the final
padded point, captures the radial child semantic targets, releases on Wiki
Graph, and opens Wiki Workbench. Post-run checks should report no scenario-owned
canvases left in `./aos show list --json`, and `./aos status --json` should
report clean stale resources with the repo daemon and input tap active.

## Next Implementation Recommendation

The next immediate work is not a feature slice. Use
`docs/design/work-cards/surface-stack-integration-checkpoint-hygiene-v0.md` to
turn the large dirty worktree into a reviewable integration checkpoint before
starting new implementation. The checkpoint hygiene run is recorded in
`docs/design/aos-surface-stack-v0-checkpoint-hygiene-report.md`.

After checkpoint hygiene, route retrospective tooling and primitive follow-ups
through `docs/design/work-cards/surface-stack-retrospective-followups-v0.md`.
Split that queue into exact Implementer cards before implementation; do not reopen #305
or revive a broad Sigil remodel umbrella for those items.
