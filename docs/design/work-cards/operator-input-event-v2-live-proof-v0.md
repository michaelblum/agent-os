# Operator Input Event V2 Live Proof V0

## Recipient

Operator supervised live/HITL verification round.

## Transfer Kind

Operator run.

## Branch / Base

- required_start_ref: local `main` containing this corrected work card plus
  local #431 commits `490c8922`, `6095427b`, and `647ddfd2`.
- published base: `origin/main` at `36c9b370` with PR #438 merged.
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
and Sigil probe corrections: active `input_event` and `input_region.event`
consumers should receive and handle canonical daemon payloads, and any remaining
dependence on top-level `input_region.event` compatibility fields must be
reported precisely.

Michael approved this live proof run. Live readiness/control is allowed only for
this bounded verification after Foreman/human clears the runtime state. Do not
run service start/restart, permission repair, `./aos ready`, or `./aos dev
build` unless a later Foreman card explicitly assigns it.

## Blocked Run Review

The first Operator run under `/tmp/aos-input-event-v2-live-proof-v0/` did not
reach input observation. Treat it as a blocked live-environment result, not as a
#431 payload regression.

Observed blocker from that run:

- initial `./aos ready --json` was ready on PID `45958`;
- Surface Inspector and Spatial Telemetry launched;
- canonical Sigil launch blocked before observation;
- a follow-up `./aos ready --json` auto-started a new daemon on PID `27724`;
- `./aos status --json` then still reported stale/unmanaged PID `45958`;
- current Foreman passive review found repo service loaded but not running,
  launchd last exit code `11`, and a stale lock for dead PID `27724`.

For the rerun, leave `/tmp/aos-input-event-v2-live-proof-v0/` intact and save
new evidence under `/tmp/aos-input-event-v2-live-proof-v0-rerun/`.

## Read First

- `AGENTS.md`
- `.docks/operator/AGENTS.md`
- `apps/sigil/AGENTS.md`
- `docs/design/input-event-v2-toolkit-cutover-v0.md`
- `docs/design/work-cards/gdi-input-event-v2-native-producer-canonical-emission-v0.md`
- `docs/adr/0015-aos-tcc-capability-broker-boundary.md`
- PR #438 and issue #431.

## Rediscover State

Run and save output under `/tmp/aos-input-event-v2-live-proof-v0-rerun/`:

```bash
mkdir -p /tmp/aos-input-event-v2-live-proof-v0-rerun
git status --short --branch
git rev-parse HEAD origin/main
./aos service status --mode repo --json | tee /tmp/aos-input-event-v2-live-proof-v0-rerun/service-status-before.json
./aos status --json | tee /tmp/aos-input-event-v2-live-proof-v0-rerun/status.json
./aos show list --json | tee /tmp/aos-input-event-v2-live-proof-v0-rerun/show-list-before.json
./aos experience status --json | tee /tmp/aos-input-event-v2-live-proof-v0-rerun/experience-status-before.json
```

If `service-status-before.json` is not `status:"ok"`, `running:true`, and
`target_matches_expected:true`, stop and report `blocked_runtime_not_ready`.
Do not start the service from this card.

If `status.json` reports `runtime_verdict.ready:false`,
`diagnosis=daemon_tcc_grant_stale_or_missing`, `input_tap_not_active`,
`daemon_unmanaged`, `daemon_unreachable`, or a permission blocker, stop and
report the blocker. Do not run `./aos ready`, `./aos clean`, service
start/restart, or a permission repair loop.

If `./aos status --json` reports Sigil status-item target drift and you need the
status-item path for the Sigil proof, run the scoped activation once:

```bash
./aos experience activate sigil
./aos experience status --json | tee /tmp/aos-input-event-v2-live-proof-v0-rerun/experience-status-after-activate.json
```

This activation path is permitted only for restart-free `status_item.*` repair.
It must not rewrite `content.roots.*`, restart the service, or bypass the
fail-closed live-operation guard.

If that command is unavailable or fails, launch Sigil directly with `show
create` below and report status-item proof as blocked.

## Setup

Verify canonical repo content roots without mutating config:

```bash
./aos config get content.roots.toolkit --json | tee /tmp/aos-input-event-v2-live-proof-v0-rerun/content-root-toolkit.json
./aos config get content.roots.sigil --json | tee /tmp/aos-input-event-v2-live-proof-v0-rerun/content-root-sigil.json
./aos content wait --root toolkit --timeout 15s
./aos content wait --root sigil --timeout 15s
```

If either content root is not the canonical repo path (`packages/toolkit` and
`apps/sigil`), stop and report `blocked_content_root_drift`. Do not run `./aos
set`; setting content roots can require a daemon restart, and this rerun is not
allowed to start or restart the daemon.

Do not pass `--auto-start` to `content wait`; the current command policy rejects
auto-start without an explicit start allowance, and this rerun is not allowed to
start the daemon.

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
./aos show get --id avatar-main > /tmp/aos-input-event-v2-live-proof-v0-rerun/avatar-main-before.json
if python3 - /tmp/aos-input-event-v2-live-proof-v0-rerun/avatar-main-before.json <<'PY'
import json, sys
payload = json.load(open(sys.argv[1]))
raise SystemExit(0 if payload.get("exists") else 1)
PY
then
  true
else
  ./aos show create --id avatar-main --url 'aos://sigil/renderer/index.html?toolkit-root=toolkit' --track union
  printf 'created\n' > /tmp/aos-input-event-v2-live-proof-v0-rerun/avatar-main-created-by-run.txt
fi
./aos show wait --id avatar-main --timeout 12s --json
```

Do not remove an existing `avatar-main` just to enable the probe. The Sigil
renderer exposes `window.__sigilDebug.surfaceTransportProbe.enable()` without
requiring the URL flag; preserving the status-item-owned canvas avoids the
remove/recreate lifecycle path that blocked the prior rerun.

Before preserving an existing `avatar-main`, verify that the live renderer was
loaded after the required start ref. The prior rerun started from the right Git
ref but reused an `avatar-main` renderer whose
`window.__sigilDebug.snapshot().runtime.loadedAt` predated the accepted
`647ddfd2` source correction, so the empty probe did not test the current code.

```bash
git show -s --format=%cI HEAD > /tmp/aos-input-event-v2-live-proof-v0-rerun/git-head-commit-time.txt
./aos show eval --id avatar-main --js 'JSON.stringify(window.__sigilDebug?.snapshot?.().runtime ?? null)' \
  > /tmp/aos-input-event-v2-live-proof-v0-rerun/sigil-runtime-before-probe.json
```

If `sigil-runtime-before-probe.json` is missing `loadedAt`, stop and report
`blocked_sigil_runtime_freshness_unknown`. If `loadedAt` is older than the Git
HEAD committer date, perform one non-destructive URL refresh of `avatar-main`
using the existing canvas URL and a temporary `aos-live-proof-ref` cache-buster.
Do not use `show remove`, `show remove-all`, service restart, content-root
mutation, or status-item reactivation for this refresh.

```bash
python3 - /tmp/aos-input-event-v2-live-proof-v0-rerun/avatar-main-before.json > /tmp/aos-input-event-v2-live-proof-v0-rerun/avatar-main-original-url.txt <<'PY'
import json, sys
payload = json.load(open(sys.argv[1]))
url = ((payload.get("canvas") or {}).get("url") or "").strip()
if not url:
    raise SystemExit("missing avatar-main url")
print(url)
PY

python3 - /tmp/aos-input-event-v2-live-proof-v0-rerun/sigil-runtime-before-probe.json /tmp/aos-input-event-v2-live-proof-v0-rerun/git-head-commit-time.txt <<'PY'
import json, sys
from datetime import datetime
runtime = json.loads(json.load(open(sys.argv[1])).get("result") or "null")
loaded_at = (runtime or {}).get("loadedAt")
head_at = open(sys.argv[2]).read().strip()
if not loaded_at:
    raise SystemExit(2)
loaded = datetime.fromisoformat(loaded_at.replace("Z", "+00:00"))
head = datetime.fromisoformat(head_at.replace("Z", "+00:00"))
raise SystemExit(0 if loaded < head else 1)
PY
case "$?" in
  0)
    python3 - "$(cat /tmp/aos-input-event-v2-live-proof-v0-rerun/avatar-main-original-url.txt)" "$(git rev-parse --short HEAD)" > /tmp/aos-input-event-v2-live-proof-v0-rerun/avatar-main-refresh-url.txt <<'PY'
import sys
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit
url, ref = sys.argv[1], sys.argv[2]
parts = urlsplit(url)
query = dict(parse_qsl(parts.query, keep_blank_values=True))
query["aos-live-proof-ref"] = ref
print(urlunsplit((parts.scheme, parts.netloc, parts.path, urlencode(query), parts.fragment)))
PY
    ./aos show update --id avatar-main --url "$(cat /tmp/aos-input-event-v2-live-proof-v0-rerun/avatar-main-refresh-url.txt)" --track union
    printf 'refreshed\n' > /tmp/aos-input-event-v2-live-proof-v0-rerun/avatar-main-refreshed-by-run.txt
    ./aos show wait --id avatar-main --timeout 12s --json \
      > /tmp/aos-input-event-v2-live-proof-v0-rerun/avatar-main-wait-after-refresh.json
    ./aos show eval --id avatar-main --js 'JSON.stringify(window.__sigilDebug?.snapshot?.().runtime ?? null)' \
      > /tmp/aos-input-event-v2-live-proof-v0-rerun/sigil-runtime-after-refresh.json
    ;;
  1)
    printf 'fresh\n' > /tmp/aos-input-event-v2-live-proof-v0-rerun/avatar-main-fresh-by-run.txt
    ;;
  2)
    printf 'blocked_sigil_runtime_freshness_unknown\n' \
      > /tmp/aos-input-event-v2-live-proof-v0-rerun/avatar-main-freshness-blocker.txt
    exit 1
    ;;
esac
```

Enable and reset the Sigil transport probe before interaction:

```bash
./aos show eval --id avatar-main --js 'JSON.stringify(window.__sigilDebug?.surfaceTransportProbe?.enable?.() ?? null)' \
  > /tmp/aos-input-event-v2-live-proof-v0-rerun/sigil-probe-enable.json
./aos show eval --id avatar-main --js 'JSON.stringify(window.__sigilDebug?.surfaceTransportProbe?.reset?.() ?? null)' \
  > /tmp/aos-input-event-v2-live-proof-v0-rerun/sigil-probe-reset.json
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
- Sigil's transport probe records handled input after real pointer interaction
  with `avatar-main`, including daemon-origin pointer input. Child hit-surface
  canvas-origin evidence must come from a path that the parent renderer handles,
  such as opening avatar controls with real input and then interacting with the
  controls surface through the visible child hit target.

Capture:

```bash
./aos show eval --id surface-inspector --js 'JSON.stringify({inputSubscriptionActive: window.__canvasInspectorState?.inputSubscriptionActive ?? null, cursor: window.__canvasInspectorState?.cursor ?? null, nativeCursor: window.__canvasInspectorState?.nativeCursor ?? null, eventCount: window.__canvasInspectorState?.eventCount ?? null})' \
  > /tmp/aos-input-event-v2-live-proof-v0-rerun/surface-inspector-input-state.json

./aos show eval --id spatial-telemetry --js 'JSON.stringify({cursor: window.__spatialTelemetryState?.raw?.cursor ?? null, recentEvents: window.__spatialTelemetryState?.events?.slice(-20) ?? null})' \
  > /tmp/aos-input-event-v2-live-proof-v0-rerun/spatial-telemetry-input-state.json

./aos show eval --id avatar-main --js 'JSON.stringify(window.__sigilDebug?.surfaceTransportProbe?.snapshot?.({windowMs: 10000}) ?? null)' \
  > /tmp/aos-input-event-v2-live-proof-v0-rerun/sigil-input-probe.json
```

Payload-field proof requirement: if any existing surface or AOS command exposes
the full received `input_event` payload, capture enough fields to show
`input_schema_version: 2`, `event_kind`, `sequence`, and kind-specific required
fields for pointer, scroll, and key. If the current surfaces only expose
summaries/counters, report that as a remaining observability gap instead of
claiming payload-field proof.

### Routed `input_region.event` Active Consumers

Use Surface Inspector's panel chrome/stage affordances to prove routed delivery
is live. For Sigil, the visible-avatar proof target is the child hit-surface
canvas-origin path recorded by `window.__sigilDebug.surfaceTransportProbe`.
Sigil intentionally removes the parent avatar input region while the
higher-fidelity hit canvas is interactive:
`avatarRegionEnabled: () => !hitTarget.hit.interactive && !liveJs.avatarParking`.
Do not fail the Sigil proof solely because the parent avatar region is
unregistered during the visible-avatar path.

Required evidence:

- Surface Inspector / panel chrome can minimize into a stage-backed chip, then
  restore or close via real pointer interaction on the chip region.
- Surface Inspector resource state shows stage layers/input regions/affordances
  during the minimized state and cleanup after restore/close.
- Sigil records canvas-origin handled input for a child hit-surface path during
  real pointer interaction, or reports a precise blocker. Parent
  `input_region.event` evidence is expected only for Sigil modes that actually
  keep a parent region registered, such as avatar controls or selection mode.
  A child hit-canvas trace entry ignored as `controls-closed` is useful
  diagnostic evidence but is not handled canvas-origin proof.
- No consumer-visible failure indicates dependence on top-level-only
  `input_region.event` fields instead of canonical `routed_input`.

Suggested capture around minimize/restore:

```bash
./aos show eval --id surface-inspector --js 'JSON.stringify(window.__canvasInspectorState?.surfaceResources ?? null)' \
  > /tmp/aos-input-event-v2-live-proof-v0-rerun/surface-resources-before-minimize.json

./aos show eval --id surface-inspector --js 'JSON.stringify(window.__aosPanelWindowController?.getState?.() ?? null)' \
  > /tmp/aos-input-event-v2-live-proof-v0-rerun/surface-inspector-panel-before-minimize.json
```

After real pointer minimize and before restore:

```bash
./aos show list --json > /tmp/aos-input-event-v2-live-proof-v0-rerun/show-list-minimized.json
./aos show eval --id surface-inspector --js 'JSON.stringify(window.__canvasInspectorState?.surfaceResources ?? null)' \
  > /tmp/aos-input-event-v2-live-proof-v0-rerun/surface-resources-minimized.json
```

After real pointer restore or close:

```bash
./aos show list --json > /tmp/aos-input-event-v2-live-proof-v0-rerun/show-list-after-restore-or-close.json
./aos show eval --id avatar-main --js 'JSON.stringify(window.__sigilDebug?.snapshot?.() ?? null)' \
  > /tmp/aos-input-event-v2-live-proof-v0-rerun/sigil-debug-after-input-region.json
```

For Sigil child hit-surface proof, first use real pointer input to put Sigil in
a mode whose child hit surface forwards handled input through the parent
renderer. The expected path is:

1. Real pointer hover/click on the visible avatar to prove daemon-origin input.
2. Real right-click on the avatar to open avatar controls.
3. Real left pointer interaction inside the opened controls so the child hit
   surface forwards canvas-origin input through `handleInputEvent`.
4. Capture the probe and debug snapshots below.

```bash
./aos show eval --id avatar-main --js 'JSON.stringify(window.__sigilDebug?.surfaceTransportProbe?.snapshot?.({windowMs: 300000}) ?? null)' \
  > /tmp/aos-input-event-v2-live-proof-v0-rerun/sigil-probe-after-child-hit-input.json
```

Payload-field proof requirement: if a surface exposes the full
`input_region.event.routed_input`, capture enough fields to show
`routed_schema_version: 1`, `source_event` as a raw v2 object when available,
`delivery_role`, `region_id`, `owner_canvas_id`, capture identity for captured
delivery, and DesktopWorld coordinates. If current surfaces only expose
resource/counter evidence, report that payload-field visibility remains blocked
without adding instrumentation.

For Sigil child hit-surface proof, use the transport probe's compact
`input_events` sample. It should distinguish canvas-origin identity with
`routed_schema_version`, `event_kind`, `sequence`, `coordinate_authority`,
`source_origin`, `source_canvas_id`, `owner_canvas_id`, and `region_id` when the
renderer handles normalized child input.

## Pass / Partial / Fail

Pass:

- repo AOS is already running and `./aos status --json` reports ready with
  active input tap;
- Surface Inspector, Spatial Telemetry, and Sigil launch;
- all three active raw `input_event` consumers show live input activity;
- Surface Inspector/panel chrome/stage-affordance routed paths show live
  behavior with no visible compatibility failure;
- Sigil's child hit-surface canvas-origin path records handled input in the
  transport probe, including canonical identity fields when available;
- full payload fields are captured, or the report clearly distinguishes the
  remaining payload-field observability gap.

Partial pass:

- active consumers behave correctly, but full payload fields are not observable
  through existing surfaces/tools.

Fail:

- passive service/status readiness blocks;
- the daemon stops, becomes unreachable, or is reclassified unmanaged mid-run;
- an active consumer fails to launch;
- real pointer/scroll/key input does not reach an expected consumer;
- routed input-region interaction fails for Surface Inspector/panel
  chrome/stage affordances;
- Sigil child hit-surface canvas-origin input is not recorded by the transport
  probe after a handled child path such as avatar controls is opened and
  interacted with using real pointer input;
- a consumer visibly depends on top-level-only `input_region.event` fields.

## Hard Boundaries / Non-Goals

- Do not implement fixes or add temporary instrumentation.
- Do not run `./aos dev build`.
- Do not run `./aos ready`; it auto-starts the daemon by design.
- Do not run `./aos clean`, permission repair, TCC reset, or service
  start/restart loops.
- Do not run `./aos set` or direct `./aos config set` mutations for
  `content.roots.*` or any restart-triggering config. The only allowed config
  mutation is the scoped `./aos experience activate sigil` status-item repair
  above, which must remain restart-free and fail closed without start
  permission.
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
if [[ -f /tmp/aos-input-event-v2-live-proof-v0-rerun/avatar-main-created-by-run.txt ]]; then
  ./aos show remove --id avatar-main 2>/dev/null || true
elif [[ -f /tmp/aos-input-event-v2-live-proof-v0-rerun/avatar-main-refreshed-by-run.txt ]]; then
  ./aos show update --id avatar-main --url "$(cat /tmp/aos-input-event-v2-live-proof-v0-rerun/avatar-main-original-url.txt)" --track union 2>/dev/null || true
fi
./aos show list --json | tee /tmp/aos-input-event-v2-live-proof-v0-rerun/show-list-final.json
```

## Completion Report

Report:

- exact `git status --short --branch`;
- exact `./aos service status --mode repo --json` summary;
- exact `./aos status --json` runtime verdict summary;
- confirmation that `./aos ready` was not run;
- confirmation that no `content.roots.*` or other restart-triggering config was
  mutated;
- whether Sigil status-item drift was present and whether `./aos experience
  activate sigil` was needed or successful;
- whether `avatar-main` was reused, created, or non-destructively URL-refreshed;
  include `sigil-runtime-before-probe.json`, `git-head-commit-time.txt`, and
  `sigil-runtime-after-refresh.json` when present, and confirm that an existing
  status-item-owned `avatar-main` was not removed for probe setup;
- surfaces launched and commands used;
- raw `input_event` result for Surface Inspector, Spatial Telemetry, and Sigil;
- routed `input_region.event` result for panel chrome/stage affordance;
- Sigil child hit-surface canvas-origin result from
  `sigil-probe-after-child-hit-input.json`, including whether parent avatar
  `inputRegions.avatar.registered:false` was expected because the child hit
  canvas was interactive, and whether any child hit-canvas messages were ignored
  as `controls-closed` before the handled child path was opened;
- whether full payload fields were captured, with artifact paths, or the exact
  observability gap that prevented payload-field proof;
- pass/partial/fail classification;
- artifact directory path;
- cleanup result and any stale canvases, stage layers, input regions, or
  blockers;
- next recommended dock: Foreman for acceptance/routing, GDI only if a
  deterministic fix is now implied, or Operator rerun only if the result was
  blocked by live environment state.
