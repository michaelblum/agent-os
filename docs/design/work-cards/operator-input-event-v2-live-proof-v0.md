# Operator Input Event V2 Live Proof V0

## Recipient

Operator supervised live/HITL verification round.

## Transfer Kind

Operator run.

## Branch / Base

- required_start_ref: local `main` at or after `5f6445a4`
  (`feat(daemon): canonicalize input region source events`).
- published review PR: #438
  https://github.com/michaelblum/agent-os/pull/438
- tracker issue: #431
  https://github.com/michaelblum/agent-os/issues/431
- work in `/Users/Michael/Code/agent-os`, not in `.docks/`.
- use the single local checkout. Do not create linked git worktrees.

## Fresh Context Contract

Operator starts from a fresh context window. Do not assume daemon, canvas,
permission, display, branch, issue, or prior verification state. Read and
rediscover before observing.

This is supervised live evidence collection only. Do not implement fixes,
create commits, push branches, open/close issues, mutate PRs, or broaden into
GDI work.

## Goal

Collect bounded live evidence for #431 after the deterministic native-producer
slice: active `input_event` and `input_region.event` consumers should receive
and handle canonical daemon payloads, and any remaining dependence on top-level
`input_region.event` compatibility fields must be reported precisely.

Michael approved this live proof run. Live readiness/control is allowed only for
this bounded verification. Do not run service start/restart, permission repair,
or `./aos dev build` unless a later Foreman card explicitly assigns it.

## Read First

- `AGENTS.md`
- `.docks/operator/AGENTS.md`
- `apps/sigil/AGENTS.md`
- `docs/design/input-event-v2-toolkit-cutover-v0.md`
- `docs/design/work-cards/gdi-input-event-v2-native-producer-canonical-emission-v0.md`
- `docs/adr/0015-aos-tcc-capability-broker-boundary.md`
- PR #438 and issue #431.

## Rediscover State

Run and save output under `/tmp/aos-input-event-v2-live-proof-v0/`:

```bash
mkdir -p /tmp/aos-input-event-v2-live-proof-v0
git status --short --branch
git rev-parse HEAD origin/main
./aos ready --json | tee /tmp/aos-input-event-v2-live-proof-v0/ready.json
./aos status --json | tee /tmp/aos-input-event-v2-live-proof-v0/status.json
./aos show list --json | tee /tmp/aos-input-event-v2-live-proof-v0/show-list-before.json
./aos experience status --json | tee /tmp/aos-input-event-v2-live-proof-v0/experience-status-before.json
```

If `./aos ready --json` reports `ready:false`,
`diagnosis=daemon_tcc_grant_stale_or_missing`, `input_tap_not_active`, or a
permission blocker, stop and report the blocker. Do not improvise a permission
repair loop.

If `./aos status --json` reports Sigil status-item target drift and you need the
status-item path for the Sigil proof, run the scoped activation once:

```bash
./aos experience activate sigil
./aos experience status --json | tee /tmp/aos-input-event-v2-live-proof-v0/experience-status-after-activate.json
```

If that command is unavailable or fails, launch Sigil directly with `show
create` below and report status-item proof as blocked.

## Setup

Use canonical repo content roots:

```bash
./aos set content.roots.toolkit packages/toolkit
./aos set content.roots.sigil apps/sigil
./aos content wait --root toolkit --auto-start --timeout 15s
./aos content wait --root sigil --auto-start --timeout 15s
```

Do not run `./aos show remove-all` unless you have confirmed no existing canvas
is human-owned or needed as evidence. Prefer removing only surfaces created for
this run during cleanup.

Launch the active consumers:

```bash
packages/toolkit/components/surface-inspector/launch.sh
./aos show wait --id surface-inspector --manifest surface-inspector --timeout 10s --json

packages/toolkit/components/spatial-telemetry/launch.sh
./aos show wait --id spatial-telemetry --manifest spatial-telemetry --timeout 10s --json

apps/sigil/sigilctl-seed.sh --mode repo
./aos show remove --id avatar-main 2>/dev/null || true
./aos show create --id avatar-main --url 'aos://sigil/renderer/index.html?aos-surface-transport-probe=1' --track union
./aos show wait --id avatar-main --timeout 12s --json
```

Enable and reset the Sigil transport probe before interaction:

```bash
./aos show eval --id avatar-main --js 'JSON.stringify(window.__sigilDebug?.surfaceTransportProbe?.enable?.() ?? null)' \
  > /tmp/aos-input-event-v2-live-proof-v0/sigil-probe-enable.json
./aos show eval --id avatar-main --js 'JSON.stringify(window.__sigilDebug?.surfaceTransportProbe?.reset?.() ?? null)' \
  > /tmp/aos-input-event-v2-live-proof-v0/sigil-probe-reset.json
```

## Required Observations

### Raw `input_event` Active Subscribers

Use real pointer/scroll/key input while Surface Inspector, Spatial Telemetry,
and Sigil are present.

Required evidence:

- Surface Inspector has `inputSubscriptionActive:true`, updated cursor/native
  cursor state, and no visible error state after real pointer and scroll input.
- Spatial Telemetry records recent `input_event` entries and updates cursor
  state after real pointer and scroll input.
- Sigil's transport probe records input events after real pointer interaction
  with `avatar-main`.

Capture:

```bash
./aos show eval --id surface-inspector --js 'JSON.stringify({inputSubscriptionActive: window.__canvasInspectorState?.inputSubscriptionActive ?? null, cursor: window.__canvasInspectorState?.cursor ?? null, nativeCursor: window.__canvasInspectorState?.nativeCursor ?? null, eventCount: window.__canvasInspectorState?.eventCount ?? null})' \
  > /tmp/aos-input-event-v2-live-proof-v0/surface-inspector-input-state.json

./aos show eval --id spatial-telemetry --js 'JSON.stringify({cursor: window.__spatialTelemetryState?.raw?.cursor ?? null, recentEvents: window.__spatialTelemetryState?.events?.slice(-20) ?? null})' \
  > /tmp/aos-input-event-v2-live-proof-v0/spatial-telemetry-input-state.json

./aos show eval --id avatar-main --js 'JSON.stringify(window.__sigilDebug?.surfaceTransportProbe?.snapshot?.({windowMs: 10000}) ?? null)' \
  > /tmp/aos-input-event-v2-live-proof-v0/sigil-input-probe.json
```

Payload-field proof requirement: if any existing surface or AOS command exposes
the full received `input_event` payload, capture enough fields to show
`input_schema_version: 2`, `event_kind`, `sequence`, and kind-specific required
fields for pointer, scroll, and key. If the current surfaces only expose
summaries/counters, report that as a remaining observability gap instead of
claiming payload-field proof.

### Routed `input_region.event` Active Consumers

Use Surface Inspector's panel chrome and Sigil's input regions to prove routed
delivery is live.

Required evidence:

- Surface Inspector / panel chrome can minimize into a stage-backed chip, then
  restore or close via real pointer interaction on the chip region.
- Surface Inspector resource state shows stage layers/input regions/affordances
  during the minimized state and cleanup after restore/close.
- Sigil registers input regions and receives routed/input-region activity during
  real pointer interaction, or reports a precise blocker.
- No consumer-visible failure indicates dependence on top-level-only
  `input_region.event` fields instead of canonical `routed_input`.

Suggested capture around minimize/restore:

```bash
./aos show eval --id surface-inspector --js 'JSON.stringify(window.__canvasInspectorState?.surfaceResources ?? null)' \
  > /tmp/aos-input-event-v2-live-proof-v0/surface-resources-before-minimize.json

./aos show eval --id surface-inspector --js 'JSON.stringify(window.__aosPanelWindowController?.getState?.() ?? null)' \
  > /tmp/aos-input-event-v2-live-proof-v0/surface-inspector-panel-before-minimize.json
```

After real pointer minimize and before restore:

```bash
./aos show list --json > /tmp/aos-input-event-v2-live-proof-v0/show-list-minimized.json
./aos show eval --id surface-inspector --js 'JSON.stringify(window.__canvasInspectorState?.surfaceResources ?? null)' \
  > /tmp/aos-input-event-v2-live-proof-v0/surface-resources-minimized.json
```

After real pointer restore or close:

```bash
./aos show list --json > /tmp/aos-input-event-v2-live-proof-v0/show-list-after-restore-or-close.json
./aos show eval --id avatar-main --js 'JSON.stringify(window.__sigilDebug?.snapshot?.() ?? null)' \
  > /tmp/aos-input-event-v2-live-proof-v0/sigil-debug-after-input-region.json
```

Payload-field proof requirement: if a surface exposes the full
`input_region.event.routed_input`, capture enough fields to show
`routed_schema_version: 1`, `source_event` as a raw v2 object when available,
`delivery_role`, `region_id`, `owner_canvas_id`, capture identity for captured
delivery, and DesktopWorld coordinates. If current surfaces only expose
resource/counter evidence, report that payload-field visibility remains blocked
without adding instrumentation.

## Pass / Partial / Fail

Pass:

- repo AOS is ready with active input tap;
- Surface Inspector, Spatial Telemetry, and Sigil launch;
- all three active raw `input_event` consumers show live input activity;
- Surface Inspector/panel chrome and Sigil input-region paths show routed live
  behavior with no visible compatibility failure;
- full payload fields are captured, or the report clearly distinguishes the
  remaining payload-field observability gap.

Partial pass:

- active consumers behave correctly, but full payload fields are not observable
  through existing surfaces/tools.

Fail:

- readiness blocks;
- an active consumer fails to launch;
- real pointer/scroll/key input does not reach an expected consumer;
- routed input-region interaction fails;
- a consumer visibly depends on top-level-only `input_region.event` fields.

## Hard Boundaries / Non-Goals

- Do not implement fixes or add temporary instrumentation.
- Do not run `./aos dev build`.
- Do not run permission repair, TCC reset, or repeated service restart loops.
- Do not create commits, branches, PRs, issue comments, or issue closure.
- Do not use raw daemon HTTP, direct socket control, `tmux`, or launchd state
  unless an `./aos` command is missing or broken; state the bypass reason if you
  must use one.
- Do not broaden into general UI regression coverage.

## Cleanup

Remove only surfaces created for this run unless preserving them is necessary
evidence:

```bash
./aos show remove --id spatial-telemetry 2>/dev/null || true
./aos show remove --id surface-inspector 2>/dev/null || true
./aos show remove --id avatar-main 2>/dev/null || true
./aos show list --json | tee /tmp/aos-input-event-v2-live-proof-v0/show-list-final.json
```

## Completion Report

Report:

- exact `git status --short --branch`;
- exact `./aos ready --json` verdict summary;
- whether Sigil status-item drift was present and whether `./aos experience
  activate sigil` was needed or successful;
- surfaces launched and commands used;
- raw `input_event` result for Surface Inspector, Spatial Telemetry, and Sigil;
- routed `input_region.event` result for panel chrome/stage affordance and Sigil;
- whether full payload fields were captured, with artifact paths, or the exact
  observability gap that prevented payload-field proof;
- pass/partial/fail classification;
- artifact directory path;
- cleanup result and any stale canvases, stage layers, input regions, or
  blockers;
- next recommended dock: Foreman for acceptance/routing, GDI only if a
  deterministic fix is now implied, or Operator rerun only if the result was
  blocked by live environment state.
