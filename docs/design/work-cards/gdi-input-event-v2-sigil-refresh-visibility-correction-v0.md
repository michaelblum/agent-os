# GDI Work Card: Input Event V2 Sigil Refresh Visibility Correction V0

## Recipient

GDI correction round.

## Transfer Kind

Correction round for #431.

## Tracker

- GitHub issue: #431
- Live proof card:
  `docs/design/work-cards/operator-input-event-v2-live-proof-v0.md`
- Latest Operator artifact directory:
  `/tmp/aos-input-event-v2-live-proof-v0-rerun/`
- Local prerequisite commits:
  - `490c8922` `docs(work-cards): preserve Sigil avatar in live proof`
  - `6095427b` `docs(work-cards): route Sigil live proof correction`
  - `647ddfd2` `fix(sigil): record handled input in live proof probe`
  - `ed9702e8` `docs(work-cards): guard Sigil live proof stale renderer`

## Fresh Context Contract

GDI starts from a fresh context window. Do not assume branch, checkout, daemon,
canvas, issue, Operator artifact, or prior implementation state. Read and
rediscover before editing.

## Branch / Base

- Work in the single checkout at `/Users/Michael/Code/agent-os`.
- Do not create linked git worktrees.
- `branch_from`: local `main` containing this work card and the local #431
  prerequisite commits through `ed9702e8`.
- `required_start_ref`: local `main` containing this work card.
- Published base: `origin/main` at `36c9b37080c420f47ea8e1fa8c5396201c41f2a5`.
- Expected output branch:
  `gdi/input-event-v2-sigil-refresh-visibility-correction-v0`.

## Goal

Make the #431 Sigil live-proof setup reach a fresh, visible avatar with an
interactive child hit surface after a stale-renderer URL refresh, so the next
Operator run can prove the handled avatar-controls child path instead of only
recording raw daemon input and ignored/scroll-only hit-canvas traffic.

## Read First

- `AGENTS.md`
- `apps/sigil/AGENTS.md`
- `docs/adr/0015-aos-tcc-capability-broker-boundary.md`
- `docs/design/input-event-v2-toolkit-cutover-v0.md`
- `docs/design/work-cards/operator-input-event-v2-live-proof-v0.md`
- `docs/design/work-cards/gdi-input-event-v2-sigil-live-proof-correction-v0.md`
- `apps/sigil/renderer/live-modules/main.js`
- `apps/sigil/renderer/live-modules/input-message.js`
- `apps/sigil/renderer/live-modules/surface-transport-probe.js`
- `apps/sigil/renderer/live-modules/input-regions.js`
- `apps/sigil/renderer/live-modules/hit-target.js`
- `tests/renderer/input-message.test.mjs`
- `tests/renderer/sigil-surface-transport-probe.test.mjs`
- `tests/renderer/sigil-input-regions.test.mjs`
- `tests/sigil-avatar-interactions.sh`

## Rediscover State

```bash
git status --short --branch
git rev-parse --show-toplevel
git branch --show-current
git rev-parse HEAD origin/main
./aos service status --mode repo --json
./aos clean --dry-run --json
```

This is deterministic implementation and proof-contract correction work. Do not
run `./aos ready`, `./aos status`, `./aos service start`, `./aos service
restart`, mutating `./aos clean` without `--dry-run`, live smoke, or
Operator-style real input unless Foreman explicitly routes a later live run.

If a running repo service already exists, classify it passively from
`./aos service status --mode repo --json` and continue deterministic file/test
work. Do not stop or restart it.

## Evidence To Classify

Read these artifacts if present. If the artifact directory is missing, continue
from source and tests, but report that local proof artifacts were absent.

```bash
jq '.result | fromjson' /tmp/aos-input-event-v2-live-proof-v0-rerun/sigil-runtime-before-probe.json
jq '.result | fromjson' /tmp/aos-input-event-v2-live-proof-v0-rerun/sigil-runtime-after-refresh-second.json
jq '.result | fromjson' /tmp/aos-input-event-v2-live-proof-v0-rerun/sigil-debug-visibility-before-input.json
jq '.result | fromjson | {avatarVisible,hitTargetFrame,hitTargetInteractive,inputRegions}' /tmp/aos-input-event-v2-live-proof-v0-rerun/sigil-before-child-hit-current.json
jq '.result | fromjson' /tmp/aos-input-event-v2-live-proof-v0-rerun/sigil-debug-after-child-hit-current.json
jq '{total,recent,byEnvelope,byOrigin,daemonKinds,canvasOriginSamples}' /tmp/aos-input-event-v2-live-proof-v0-rerun/sigil-probe-after-child-hit-input-summary.json
```

Foreman classification before this card:

- Runtime stayed ready/clean; this is not a TCC or AOS runway blocker.
- The refreshed Sigil renderer was fresh on the second post-refresh runtime
  check: `loadedAt: 2026-06-07T14:13:42.533Z`, after local `HEAD`
  committer time `2026-06-07T10:09:17-04:00`.
- After refresh, Sigil reported `avatarVisible:false`,
  `hitTargetInteractive:false`, no Sigil input regions registered, and the hit
  target parked at `[-10000,-10000,80,80]`.
- Sigil's probe now records raw daemon-origin v2 input correctly, including
  pointer, scroll, key, and right-click samples.
- The probe also recorded six routed-v1 canvas-origin scroll samples from
  `sigil-hit-avatar-main`, but the required handled controls path did not open.
- Surface Inspector and Spatial Telemetry passed enough of their live evidence
  paths that the next correction should stay focused on Sigil refresh/visibility
  and handled child hit-surface proof.

## Required Behavior

### Refresh Visibility Contract

After the Operator card refreshes a stale status-item-owned `avatar-main` with
`./aos show update --id avatar-main --url <cache-busted-existing-url> --track
union`, the proof setup must have a deterministic path to reach all of these
states before real child-path input:

- `window.__sigilDebug.snapshot().runtime.loadedAt` is fresh relative to the
  required local start ref.
- `window.__sigilDebug.snapshot().avatarVisible === true`.
- The avatar hit target is not parked offscreen and is interactive.
- The expected child hit canvas is the active ergonomic input surface.
- The proof can open avatar controls with real right-click and interact inside
  the controls surface through a handled child path.

Choose the narrowest correct fix after reading the source:

1. If refresh should replay or preserve the visible status-item state in source,
   implement that behavior with deterministic tests.
2. If the existing source behavior is correct and the live proof setup should
   explicitly show Sigil again after refresh, update the Operator card and add
   deterministic coverage or static guard tests for the required wait/checks.

Do not accept scroll-only canvas-origin probe entries as the handled
child-surface proof. They are useful identity evidence, but they do not replace
opening avatar controls and interacting inside the controls surface.

### Probe Contract Preservation

Preserve the accepted `647ddfd2` behavior: Sigil's transport probe must keep
recording handled input at the normalized `handleInputEvent` boundary, including
daemon-origin raw input and canvas-origin routed input identity fields.

If the refresh visibility fix touches probe or input-message code, keep or add
deterministic tests proving compact canonical fields such as:

- `input_schema_version`
- `routed_schema_version`
- `event_kind`
- `sequence`
- `coordinate_authority`
- `source_origin`
- `source_canvas_id`
- `owner_canvas_id`
- `region_id`

### Adjacent Observations To Preserve

Michael observed three live-run signals that should not be lost, but they are
not the primary goal of this card:

- A live input sequence may have interrupted the Codex CLI TUI, plausibly by
  sending a key such as Escape while the TUI or VS Code had keyboard focus.
- The mini-map showed an avatar panel outline while the avatar was not visible.
- Surface Inspector minimize targeting appeared to hover over draggable chrome;
  chrome buttons should occlude title-bar drag behavior and expose a pointer
  cursor when the button is the target.

Do not broaden this card into a full live-harness focus sink, mini-map
reconciliation, or panel-chrome hit-test correction. If the Sigil fix directly
explains or touches any of these signals, report it. Otherwise preserve them as
follow-up recommendations for Foreman.

## Scope

Owned scope:

- Sigil renderer refresh/visibility/status-item behavior.
- Sigil hit-target and input-region readiness only as needed for the handled
  child path.
- Sigil probe behavior only to preserve the accepted input-event evidence
  contract.
- Focused deterministic renderer/toolkit tests.
- The Operator live-proof work card only to align setup/waits with the corrected
  deterministic contract.

## Hard Boundaries / Non-Goals

- Do not run live AOS readiness/control or real-input smoke in this GDI round.
- Do not edit Swift/native daemon code unless you first identify an explicit
  native-boundary reason under ADR 0015 and stop for Foreman instead of
  implementing it.
- Do not run `./aos dev build`.
- Do not change TCC, permissions, launchd, service lifecycle, content roots, or
  runtime recovery behavior.
- Do not remove/recreate `avatar-main` as the proof strategy.
- Do not push, open PRs, close issues, or mutate GitHub state.
- Do not route Operator or update the clipboard.
- Do not reintroduce broad legacy input compatibility aliases; query #431 before
  changing that cutover lane.

## Suggested Implementation Areas

Likely starting points:

- `apps/sigil/renderer/live-modules/main.js` around `status_item.show`,
  `status_item.hide`, `animateVisibility`, `setAvatarVisibility`,
  `applySurfaceRenderSnapshot`, `surfaceRenderSnapshot`, and
  `syncHitTargetToAvatar`.
- `apps/sigil/renderer/live-modules/input-regions.js` for avatar and controls
  region readiness.
- `apps/sigil/renderer/live-modules/hit-target.js` for child hit-canvas parking
  and interactivity state.
- `apps/sigil/renderer/live-modules/surface-transport-probe.js` only if the
  probe contract needs preservation after the visibility fix.
- `tests/sigil-avatar-interactions.sh` as precedent for explicit
  `status_item.show` plus `avatarVisible === true` wait.
- `tests/renderer/input-message.test.mjs`,
  `tests/renderer/sigil-surface-transport-probe.test.mjs`, and
  `tests/renderer/sigil-input-regions.test.mjs` for deterministic coverage.
- `docs/design/work-cards/operator-input-event-v2-live-proof-v0.md` for the
  later Operator setup and completion requirements.

## Verification

Run focused deterministic checks:

```bash
git diff --check
node --test tests/renderer/input-message.test.mjs
node --test tests/renderer/sigil-surface-transport-probe.test.mjs
node --test tests/renderer/sigil-input-regions.test.mjs
node --test tests/toolkit/runtime-input-events.test.mjs
```

If you modify the Operator card, also run:

```bash
git diff --check -- docs/design/work-cards/operator-input-event-v2-live-proof-v0.md
rg -n "aos-live-proof-ref|status_item\\.show|avatarVisible|hitTargetInteractive|surfaceTransportProbe|canvas-origin|hit-surface|controls-closed|Payload" docs/design/work-cards/operator-input-event-v2-live-proof-v0.md
```

Add or adjust tests where the corrected contract requires them. If the narrow
fix is docs-only, include a focused static assertion that prevents the Operator
card from refreshing a stale renderer and then attempting child hit-surface
proof without first proving visible/interactable Sigil state.

## Completion Report

Return a concise report with:

- changed paths;
- branch and head SHA;
- whether the correction is source behavior, Operator proof setup, or both;
- how the fix makes a fresh renderer reach visible/interactable Sigil state
  before child hit-surface proof;
- exact verification commands and pass/fail results;
- whether `/tmp/aos-input-event-v2-live-proof-v0-rerun/` artifacts were present
  and how they informed the fix;
- confirmation that no live AOS control, native build, TCC work, content-root
  mutation, GitHub mutation, or Operator routing was performed;
- whether Michael's focus-sink, mini-map, or chrome-hit-test observations are
  explained by this slice or should remain separate follow-ups;
- any remaining blocker or the recommended next Operator live-proof command for
  Foreman to route after acceptance.
