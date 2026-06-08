# Implementer Work Card: Input Event V2 Sigil Live-Proof Correction V0

## Tracker

- GitHub issue: #431
- Live proof card: `docs/design/work-cards/operator-input-event-v2-live-proof-v0.md`
- Latest Operator artifact directory: `/tmp/aos-input-event-v2-live-proof-v0-rerun/`
- Local prerequisite commit: `490c8922f91a2a2a9caba9192cc643fbe36db51b` (`docs(work-cards): preserve Sigil avatar in live proof`)

## Fresh Context Contract

Implementer starts from a fresh context window. Do not assume branch, checkout, daemon,
canvas, issue, or prior implementation state. Read and rediscover before
editing.

## Branch / Base

- Work in the single checkout at `/Users/Michael/Code/agent-os`.
- Do not create linked git worktrees.
- `branch_from`: local `main` at or after `490c8922f91a2a2a9caba9192cc643fbe36db51b`.
- `required_start_ref`: local `main` containing this work card and the
  `490c8922` Operator-card correction.
- Expected output branch: `implementer/input-event-v2-sigil-live-proof-correction-v0`.

## Goal

Make Sigil's deterministic renderer contracts satisfy the #431 live-proof
evidence shape for handled input: the Sigil probe must count the input paths the
renderer actually handles, and the Sigil `input_region.event` expectation must
either be implemented with tests or explicitly narrowed to the current
child-hit-surface architecture with code-backed rationale.

## Read First

- `AGENTS.md`
- `apps/sigil/AGENTS.md`
- `docs/adr/0015-aos-tcc-capability-broker-boundary.md`
- `docs/design/work-cards/operator-input-event-v2-live-proof-v0.md`
- `docs/design/input-event-v2-toolkit-cutover-v0.md`
- `apps/sigil/renderer/live-modules/main.js`
- `apps/sigil/renderer/live-modules/input-message.js`
- `apps/sigil/renderer/live-modules/surface-transport-probe.js`
- `apps/sigil/renderer/live-modules/input-regions.js`
- `apps/sigil/renderer/live-modules/hit-target.js`
- `packages/toolkit/runtime/input-events.js`
- `packages/toolkit/runtime/desktop-world-hit-region.js`
- `tests/renderer/input-message.test.mjs`
- `tests/renderer/sigil-surface-transport-probe.test.mjs`
- `tests/renderer/sigil-input-regions.test.mjs`

## Rediscover State

```bash
git status --short --branch
git rev-parse --show-toplevel
git rev-parse HEAD
git branch --show-current
./aos service status --mode repo --json
./aos clean --dry-run --json
```

This is deterministic implementation/validation work. Do not run `./aos ready`,
`./aos status`, `./aos service start`, `./aos service restart`, live smoke, or
Operator-style real input unless Foreman explicitly routes a later live run.

If a running repo service already exists, classify it passively from
`./aos service status --mode repo --json` and continue deterministic file/test
work. Do not stop or restart it.

## Evidence To Classify

Read these artifacts if present. If the artifact directory is missing, continue
from source and tests, but report that the local artifact evidence was absent.

```bash
jq '.result | fromjson | {probe:{input_events,recent_input_events,render}}' /tmp/aos-input-event-v2-live-proof-v0-rerun/sigil-input-probe.json
jq '.result | fromjson | {count,stopReason,stages:([.entries[].stage]|group_by(.)|map({stage:.[0],count:length})),first_entries:.entries[:8]}' /tmp/aos-input-event-v2-live-proof-v0-rerun/sigil-visible-avatar-interaction-trace.json
jq '.result | fromjson | {avatarVisible,state,hitTargetInteractive,inputRegions,radialTargetSurface,probe:{input_events:.probe.input_events,recent:.probe.recent_input_events,render:.probe.render}}' /tmp/aos-input-event-v2-live-proof-v0-rerun/sigil-after-visible-avatar-real-input.json
```

Observed Foreman classification before this card:

- Runtime stayed ready/clean; this is not a TCC or AOS runway blocker.
- Surface Inspector and Spatial Telemetry provided usable raw-input evidence.
- Sigil handled daemon-origin pointer input and child hit-canvas messages in
  `sigil-visible-avatar-interaction-trace.json`.
- `window.__sigilDebug.surfaceTransportProbe.snapshot()` still reported
  `input_events: []`.
- Sigil debug snapshots showed `avatarVisible:true` after a bounded visible-path
  probe, but `inputRegions.*.registered:false`.

## Required Behavior

### Probe Contract

`window.__sigilDebug.surfaceTransportProbe` must count every input path Sigil
actually handles as input during the live proof, not only messages whose
normalized envelope remains `input_event`.

At minimum, deterministic tests must prove the probe records:

- daemon `input_event` / bare pointer messages handled by `handleInputEvent`;
- routed `input_region.event` messages normalized by toolkit input events;
- canvas-origin child hit-surface messages that Sigil normalizes and handles.

Prefer a small helper or adapter-level seam over scattering probe calls across
unrelated renderer branches. Preserve the existing interaction trace behavior.

### Sigil Routed Input-Region Evidence

Resolve the mismatch between the live-proof card and current Sigil architecture.

Current source disables the parent avatar input region while the higher-fidelity
hit canvas is interactive:

```js
avatarRegionEnabled: () => !hitTarget.hit.interactive && !liveJs.avatarParking
```

Do one of the following, based on the architecture after reading the code:

1. Implement and test a canonical Sigil `input_region.event` path for the
   visible avatar without regressing the child hit-surface UX.
2. Narrow the Operator card and deterministic tests so the accepted Sigil proof
   target is the child hit-surface canvas-origin path, with an explicit
   rationale that parent avatar `input_region.event` is intentionally not active
   while the child hit target owns ergonomic input capture.

Do not leave the card requiring Sigil `input_region.event` evidence if source
and tests intentionally keep that region unregistered during the visible-avatar
path.

### Payload-Field Proof

If you touch probe snapshot shape, expose enough deterministic fields for the
later Operator run to prove canonical v2 identity without needing raw daemon log
inspection. This may be a compact recent-event sample in the probe snapshot, but
avoid broad payload dumps that make the debug surface unstable.

The later live proof needs enough fields to distinguish canonical input-event-v2
or routed-v1 identity, such as `input_schema_version`, `event_kind`, `sequence`,
`coordinate_authority`, `source_origin`, `source_canvas_id`, `owner_canvas_id`,
`region_id`, and `routed_schema_version` when present.

## Scope

Owned scope:

- Sigil renderer debug/probe behavior.
- Sigil input-region adapter behavior when needed.
- Toolkit input-event normalization only if required to preserve canonical
  identity for Sigil.
- Focused deterministic renderer/toolkit tests.
- The Operator live-proof work card only to align expected evidence with the
  corrected deterministic contract.

## Hard Boundaries / Non-Goals

- Do not run live AOS readiness/control or real-input smoke in this Implementer round.
- Do not edit Swift/native daemon code.
- Do not run `./aos dev build`.
- Do not change TCC, permissions, launchd, service lifecycle, or runtime
  recovery behavior.
- Do not push, open PRs, close issues, or mutate GitHub state.
- Do not route Operator or update the clipboard.
- Do not reintroduce broad legacy input compatibility aliases; query #431 before
  changing that cutover lane.

## Suggested Implementation Areas

Likely starting points:

- `apps/sigil/renderer/live-modules/main.js` around `handleHostMessage`,
  `handleHitCanvasEvent`, `handleInputEvent`, and `__sigilDebug.snapshot()`.
- `apps/sigil/renderer/live-modules/surface-transport-probe.js` for compact
  recent-event samples and canonical identity fields.
- `apps/sigil/renderer/live-modules/input-regions.js` only if parent
  `input_region.event` remains the intended proof path.
- `tests/renderer/input-message.test.mjs`,
  `tests/renderer/sigil-surface-transport-probe.test.mjs`, and
  `tests/renderer/sigil-input-regions.test.mjs` for deterministic coverage.
- `docs/design/work-cards/operator-input-event-v2-live-proof-v0.md` for the
  later Operator evidence commands and completion expectations.

## Verification

Run focused checks:

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
rg -n "surfaceTransportProbe|input_region\\.event|canvas-origin|hit-surface|Payload" docs/design/work-cards/operator-input-event-v2-live-proof-v0.md
```

Add or adjust tests where the corrected contract requires them. If one of the
listed tests becomes irrelevant because the contract legitimately moved, update
the test rather than deleting coverage silently.

## Completion Report

Return a concise report with:

- changed paths;
- whether the fix implements parent Sigil `input_region.event` proof or narrows
  the live proof to child hit-surface canvas-origin evidence, with rationale;
- exact verification commands and pass/fail results;
- whether `/tmp/aos-input-event-v2-live-proof-v0-rerun/` artifacts were present
  and how they informed the fix;
- confirmation that no live AOS control, native build, TCC work, GitHub
  mutation, or Operator routing was performed;
- any remaining blocker or the recommended next Operator live proof command for
  Foreman to route after acceptance.
