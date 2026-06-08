# Implementer Work Card: AOS One-World Phase 1 — Co-location Probe V0

## Routing Status

Planned — Phase 1 of the AOS One-World workstream. Unblocked by Phase 0.
Not yet dispatched.

## Tracker

- Workstream goal contract: `docs/design/aos-surface-world-prompt-contract-v0.md`
- Handoff and code anchors: `docs/design/aos-surface-world-workstream-handoff-v0.md`
- Phase 0 measurement artifact: `docs/dev/reports/aos-surface-transport-stack-measurement-v0.md`
- Phase 0 work card (closed): `docs/design/work-cards/implementer-aos-surface-transport-stack-measurement-v0.md`
- Related parked card (not ready to route from this slice):
  `docs/design/work-cards/implementer-sigil-avatar-panel-resource-contract-migration-v0.md`

## Branch / Base

- `branch_from`: Phase 0 completion HEAD on the surface-world line (set at dispatch)
- `required_start_ref`: set at dispatch — base is the commit closing
  `implementer/aos-surface-transport-stack-measurement-v0`
- `expected_output_branch`: `implementer/aos-one-world-phase1-co-location-probe-v0`

Do not create linked worktrees. Use the single checkout at
`/Users/Michael/Code/agent-os`.

## Fresh Context Contract

Implementer starts from a fresh context window. Do not assume branch, checkout,
daemon, canvas, issue, or prior implementation state. Read and rediscover
before editing.

## What / Why (scope)

Phase 0 confirmed the separation tax is real and material:

- 82.8 cross-canvas IPC messages/s (control_change + snapshot) during a
  slider drag
- ~31 publishState/s fired unconditionally at the render loop rate (~30.6fps,
  100% structural frames) regardless of slider activity
- 97.5 daemon input events/s delivered to avatar-main
- All of this traffic exists only because the owner (avatar-main) and the
  compact panel (sigil-avatar-controls-avatar-main) are in separate process heaps

Phase 1 probes whether one pair — the avatar owner ↔ compact panel — can be
co-located as two layers in one WKWebView document binding to a shared
in-heap signal store, eliminating the daemon serialization boundary between
them. This is the narrowest useful probe of the One-World premise before any
substrate is built.

## Prototype Target

Two layers in one WKWebView document. The avatar owner and the compact panel
become co-residents of a single document: the owner renders the avatar scene;
the panel renders avatar controls. They share a signal store in-heap — no
cross-canvas IPC, no daemon serialization between them during a slider drag.

The shared signal store for this probe is **minimal and possibly throwaway**.
It exists to prove the pair co-locates correctly, not to establish the Phase 2
World substrate. Do not commit to a signals library or reactive framework based
on this probe alone.

This prototype does not replace the existing separated canvases. It is a
parallel branch exploration.

## What To Measure

Re-run the Phase 0 probe instruments (`surfaceTransportProbe` /
`__sigilAvatarPanelDebug`) against the co-located prototype during an
equivalent slider drag:

- `control_change` count between owner and panel layers (target: ~0; baseline:
  82.8 cross-canvas IPC/s)
- `snapshot` count between owner and panel layers (target: ~0; same baseline)
- `publishState` calls during the drag window (target: ~0 between layers;
  baseline: ~31/s)
- Structural frame classification: does the structural over-mark persist, or
  does in-heap binding eliminate it?
- Slider drag latency: does the avatar update in-heap directly, with no
  daemon round-trip visible in event counts?

If the probe instruments need adjustment for the co-located document (the two
layers share one heap), update them minimally — do not rearchitect the probe
surface.

## Exit Gate (checkable)

All three must hold:

1. **Deletable traffic → ~0.** During a slider drag, `control_change` /
   `snapshot` / `publishState` crossing the daemon serialization boundary
   between the owner and panel approach 0 — confirmed against the Phase 0
   baseline using the same probe instruments and a comparable drag scenario.

2. **Slider-drag is direct.** The avatar responds to slider movement
   in-heap with no daemon IPC round-trip. The probe counters confirm it
   (cross-canvas IPC stays flat while drag is active).

3. **Focus and fault behavior acceptable.** The co-located pair stays
   focusable (input reaches the slider; focus does not escape the pair
   unexpectedly). A fault in one layer does not silently kill both (minimal
   fault isolation check, not the full focus-group manager).

If all three hold, Phase 1 is complete and Phase 2 (World substrate) is
unblocked.

## Gate Failure Case

If the probe shows co-location is not feasible for this pair — traffic does
not approach 0, or focus/fault behavior is unacceptably broken in ways that
cannot be cheaply mitigated — it reshapes the World/Browser-Host boundary:

- Some surfaces may have to remain Browser-Host nodes rather than World nodes.
- The Phase 2 substrate design must account for which surfaces cannot co-locate
  and why.
- Return the failure evidence and a characterization of the blocker to Foreman
  before routing Phase 2.

Do not paper over a gate failure with scope expansion. Honest failure here
is more valuable than a nominal pass.

## Code Anchors

Use these instead of re-searching. From handoff §6:

Owner side:
- `apps/sigil/avatar-controls/compact-surface-session.js:80` —
  `routeChangedControls` → `syncState()` + `publishSnapshot()` (the traffic
  source)
- `apps/sigil/renderer/live-modules/main.js:536` — `scheduleRenderFrame`
  defaults `structural=true`
- `apps/sigil/renderer/live-modules/main.js:5001–5057` — structural block:
  `overlay.draw` (5016) + `desktopWorldSurface.publishState` (5057)
  unconditional
- `apps/sigil/renderer/live-modules/main.js:4729` — owner subscribes to
  `input_event`

Panel side:
- `apps/sigil/avatar-editor/panel.js` — `sigil.avatar_panel.control_change`
  and snapshot emission

Transport path (separation boundary this probe is removing for the pair):
- `apps/sigil/renderer/live-modules/host-runtime.js` — WKWebView bridge
  (post / `headsup.receive` / base64)
- `src/daemon/unified.swift` → `forwardInputEventToCanvases` (799–811),
  `broadcastInputEvent` (3494) — daemon input fan-out
- `src/display/canvas.swift` → `postMessageAsync` / `evalAsync` (2299–2308)
  — canvas eval delivery

## Read First

- `AGENTS.md`
- `apps/sigil/AGENTS.md`
- `packages/toolkit/AGENTS.md`
- `docs/design/aos-surface-world-prompt-contract-v0.md` (§5 Phase 1 gate, §3
  invariants)
- `docs/design/aos-surface-world-workstream-handoff-v0.md` (§4 sequencing,
  §6 code anchors, §7 guardrails)
- `docs/dev/reports/aos-surface-transport-stack-measurement-v0.md` (Phase 0
  baselines and probe instruments)
- `docs/adr/0015-aos-tcc-capability-broker-boundary.md`

## Rediscover State

```bash
git status --short --branch
git rev-parse HEAD
./aos ready --json
./aos status --json
./aos show list --json
./aos dev recommend --json --paths apps/sigil/renderer/live-modules/main.js,apps/sigil/avatar-editor/panel.js,apps/sigil/avatar-controls/compact-surface-session.js,apps/sigil/renderer/live-modules/host-runtime.js
```

## Scope

Allowed:
- A co-location prototype for the avatar owner ↔ compact panel pair only
- A minimal in-heap signal store for this pair (possibly throwaway)
- Adjustments to the Phase 0 probe instruments for the co-located document
- Focused tests for the prototype binding behavior
- A written evidence report capturing probe results vs Phase 0 baseline

Native boundary:
- Do not add new Swift logic to support the co-located pair
- If Swift changes are required, stop with `foreman_rebuild_needed`
- The daemon remains the sole privileged broker; do not route co-located
  surface communication through the daemon

## Hard Boundaries / Non-Goals

This work card does NOT cover:

- The full One-World substrate (Phase 2): one heap/scene/scheduler/resource
  pool for all first-party surfaces
- The World extension API and theming contract (Phase 2 long pole)
- Migrating surfaces other than this one pair
- ADR/CONTEXT/ARCHITECTURE governing-doc edits (Phase 4, owner-approved)
- The CDP browser-overlay geometry-stream upgrade (backlog, must not be lost)
- The focus-group manager, Tab-loop trap, and per-panel focus memory (backlog)
- Retiring `sigil.avatar_panel.*` (backlog Direction E)
- Committing to a signals library or reactive framework
- Fixing visual jank unless a one-line probe bug blocks measurement
- Opening a PR or pushing

## Guardrails

- The One-World proposal is not accepted. Do not start ripping out ADRs or
  editing CONTEXT/ARCHITECTURE.
- Measure before architecting. Confirm traffic → ~0 with probe data before
  designing the Phase 2 substrate.
- Keep the signal store minimal. ADR-0012 warns against a bespoke framework;
  prefer a tiny standalone lib if reactivity is needed. Do not over-build.
- The daemon stays the sole privileged broker (ADR-0015). The probe removes
  the serialization boundary between owner and panel in-heap; it does not
  bypass the daemon for input arbitration or native capability.
- Durable artifacts live in the repo.

## Verification

Run focused deterministic checks for any touched JS:

```bash
node --test tests/renderer/sigil-render-loop.test.mjs tests/renderer/avatar-controls-hit-test.test.mjs tests/renderer/sigil-surface-transport-probe.test.mjs
git diff --check
```

If the prototype or probe adjustments touch additional modules with existing
tests, run those focused tests too.

If `./aos ready --json` is ready after prototype work, run the Phase 1 probe
scenario (equivalent to Phase 0 Test 3: native CGEvent drag with probes
enabled) and record counters in the evidence artifact.

If live readiness reports a TCC or input-tap blocker, stop with:

```bash
the manual TCC blocker report path
```

## Completion Report

Return a path-scoped summary with:

- branch/head used
- files changed
- prototype approach: how the two layers share state in-heap
- signal store choice and rationale (or why it was deferred)
- exact tests run and results
- probe measurements during prototype slider drag (control_change/s,
  snapshot/s, publishState/s) vs Phase 0 baseline
- exit gate assessment: did all three conditions hold?
- focus and fault behavior observed
- live AOS result or readiness blocker
- if gate passed: recommended Phase 2 first step
- if gate failed: characterization of blocker and implication for the
  World/Browser-Host line
