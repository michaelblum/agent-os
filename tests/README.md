# Test Targets

Use the smallest loop that matches the change. Start with the manifest-backed
router when the right loop is not obvious:

```bash
./aos dev recommend --json
```

Do not rebuild `./aos` by default before every verification step.

For the repo-wide entry-path model behind these choices, see
`docs/recipes/agent-entry-paths-and-verification.md`.

## Rebuild `./aos` First

Rebuild with `./aos dev build` when both of these are true:

- the work changed Swift sources in `src/` or `shared/swift/ipc/`
- the command or test you are about to run executes `./aos`

Use raw `bash build.sh` only when `./aos` is missing or the build command itself
is being repaired.

If you are chaining build + `./aos` verification from automation, prefer:

- `scripts/aos-after-build -- ./aos ...`

That wrapper waits for any in-flight rebuild, ensures the binary is current,
then runs the `./aos` command.

Examples:

- `bash tests/wiki-seed.sh`
- `bash tests/wiki-migrate.sh`
- `bash tests/wiki-write-api.sh`
- `bash tests/content/wiki-list.test.sh`
- `bash tests/daemon-singleton.sh`
- `bash tests/capture-region-perception.sh`
- `bash tests/graph-displays-visible-bounds.sh`
- `bash tests/capture-canvas-surface.sh`
- `bash tests/capture-parallel.sh`
- `./aos runtime status --json`
- `./aos show create ...`

## No `./aos` Rebuild Needed

Stay in the local package or Node loop when the work does not depend on a fresh
`./aos` binary.

Examples:

- `node --test tests/studio/*.test.mjs`
- `node --test tests/renderer/*.test.mjs`
- `node --test tests/toolkit/*.test.mjs`
- `cd packages/gateway && npm test`
- `cd packages/host && npm test`

## Sigil Radial / Wiki / Toolkit Surface Family

Use this focused family when a change touches Sigil radial menu activation, the
Wiki Graph radial item, the graph-first wiki browser/workshop surface, or the
toolkit runtime primitives that route pointer input and target surfaces.

Deterministic radial, renderer, and runtime contract:

```bash
node --test \
  tests/renderer/radial-menu-activation.test.mjs \
  tests/renderer/radial-gesture-menu.test.mjs \
  tests/renderer/radial-gesture-visuals.test.mjs \
  tests/renderer/radial-menu-target-surface.test.mjs \
  tests/renderer/radial-activation-transition.test.mjs \
  tests/renderer/sigil-content-roots.test.mjs \
  tests/toolkit/runtime-radial-gesture.test.mjs \
  tests/toolkit/runtime-radial-menu-config.test.mjs \
  tests/toolkit/runtime-radial-item-transition.test.mjs \
  tests/toolkit/runtime-menu-activation.test.mjs \
  tests/toolkit/runtime-input-events.test.mjs \
  tests/toolkit/runtime-input-region.test.mjs \
  tests/toolkit/runtime-interaction-region.test.mjs \
  tests/toolkit/runtime-desktop-world-hit-region.test.mjs
```

Deterministic wiki browser/workshop and workbench contract:

```bash
node --test \
  tests/toolkit/wiki-kb.test.mjs \
  tests/toolkit/wiki-kb-semantics.test.mjs \
  tests/toolkit/wiki-kb-layout-modes.test.mjs \
  tests/toolkit/wiki-subject-browser.test.mjs \
  tests/toolkit/wiki-subject-opening.test.mjs \
  tests/toolkit/wiki-subject.test.mjs \
  tests/toolkit/workbench-subject.test.mjs \
  tests/toolkit/radial-menu-subject.test.mjs \
  tests/schemas/aos-workbench-subject.test.mjs
```

Launcher and shell checks:

```bash
bash tests/wiki-kb-smoke.sh
bash tests/sigil-workbench-kb.sh
bash tests/sigil-status-item-lifecycle.sh
bash tests/help-contract.sh
bash tests/external-parser-flags.sh
git diff --check
```

Inventory for this family:

| Test or scenario | Class | Contract |
| --- | --- | --- |
| `tests/renderer/radial-menu-activation.test.mjs` | renderer/model | Radial committed item requests, target-surface descriptors, and Wiki Graph routing to the current graph-first browser surface. |
| `tests/renderer/radial-gesture-menu.test.mjs` | renderer/model | Sigil radial gesture state, configured item order, commit/cancel behavior, and fast-travel handoff boundaries. |
| `tests/renderer/radial-gesture-visuals.test.mjs` | renderer/model | 3D radial item visual config, Wiki Brain effect hooks, and default geometry projection. |
| `tests/renderer/radial-menu-target-surface.test.mjs` | renderer/model | Externally observable radial child hit surface geometry, labels, and semantic target payloads. |
| `tests/renderer/radial-activation-transition.test.mjs` | renderer/model | Transition lifecycle for committed radial items and surface fade timing. |
| `tests/renderer/sigil-content-roots.test.mjs` | renderer/model | Worktree-scoped content roots for Sigil child surfaces and the radial Wiki Graph browser URL. |
| `tests/toolkit/runtime-*.test.mjs` in the command above | toolkit model | Shared radial, menu activation, input event, input region, and DesktopWorld hit-region primitives. |
| `tests/toolkit/wiki-kb*.test.mjs` | toolkit component model | Wiki KB graph/radial graph state, semantics, and layout-mode behavior. |
| `tests/toolkit/wiki-subject-browser.test.mjs` | toolkit component model | Graph-first Subject Browser shell, Catalog/Index/Details/Trail semantics, Markdown opening, and root clear behavior. |
| `tests/toolkit/wiki-subject-opening.test.mjs` and `tests/toolkit/wiki-subject.test.mjs` | toolkit workbench model | Wiki subject descriptors and Markdown open request mapping. |
| `tests/toolkit/workbench-subject.test.mjs`, `tests/toolkit/radial-menu-subject.test.mjs`, `tests/schemas/aos-workbench-subject.test.mjs` | toolkit/schema model | Reusable workbench subject descriptors and schema compatibility for radial/wiki surfaces. |
| `tests/wiki-kb-smoke.sh` | isolated-daemon launcher | Wiki KB launcher, content-root setup, sample graph load, radial graph switch, and optional capture. |
| `tests/sigil-workbench-kb.sh` | isolated-daemon launcher | Legacy Sigil workbench KB tab smoke retained as a compatibility boundary, not the radial Wiki Graph product path. |
| `tests/sigil-status-item-lifecycle.sh` | live repo-daemon shell | Status item activation lifecycle and active Sigil canvas ownership. |
| `tests/scenarios/sigil/radial-menu/real-input.sh` | live real-input | User-facing status item, avatar, radial target surface semantics, and native pointer selection path. Requires `AOS_REAL_INPUT_OK=1` and `./aos ready`. |
| `tests/scenarios/sigil/radial-menu/real-input-desktop-world-path.sh` | live real-input | Topology-neutral DesktopWorld fast-travel plus radial selection path. Requires `AOS_REAL_INPUT_OK=1` and `./aos ready`. |

Do not use direct DOM or `show eval` activation as the acceptance proof for
radial menu user behavior. Eval remains useful for observation after native or
realistic input has opened the relevant surface. If `./aos ready` reports a
repo-mode TCC/input-tap blocker, follow the dock stall contract instead of
retrying live real-input scenarios.

## Mixed Work

If a change spans both Swift and JS/package surfaces:

1. Run the smallest local tests first without rebuilding `./aos`.
2. Rebuild once before the first `./aos`-backed verification step.
3. Reuse that binary for the remaining `./aos` checks until Swift changes again.

## Wiki And Content State Safety

Wiki tests that create, delete, seed, reindex, or otherwise rewrite wiki files
must run against an isolated state root. Prefer tests that allocate and export
their own temporary `AOS_STATE_ROOT`, then remove that root on exit. The
destructive wiki integration suite is safe to run directly:

```bash
bash tests/wiki-integration.sh
```

It allocates a temporary state root by default and refuses to run when its
computed wiki directory is the canonical repo wiki at
`~/.config/aos/repo/wiki`. Use the guard test when changing that isolation
contract:

```bash
bash tests/wiki-integration-isolation.sh
```

FSEvents-backed wiki watcher tests may need a repo-local ignored state root
under `.aos-test-tmp/`; system temp roots under `/var/folders` can miss file
watch events on macOS even though they are isolated.

Content-server tests under `tests/content/` may exercise the live repo daemon
when they are explicitly testing HTTP wiki endpoints. Those tests must use
unique test page names, register cleanup before writing, and delete every page
they create on both success and failure. Do not run live wiki/content HTTP tests
concurrently unless the test documents that it is isolated; shared daemon state
can create false failures and leave runtime contamination.

## Shared Repo Daemon Live Canvas Tests

Shell tests that create AOS canvases through the shared repo daemon must run
serially unless they allocate and export an isolated `AOS_STATE_ROOT` and start
their own daemon. The repo daemon and canvas namespace are singleton runtime
resources, so parallel live canvas tests can race on canvas creation, capture,
xray, click, or cleanup and produce false failures.

Live repo-daemon canvas tests should source `tests/lib/live-canvas-serial.sh`,
call `aos_live_canvas_acquire_serial_lock` before the first `./aos show create`
or other canvas mutation, and release the lock from their existing cleanup trap
with `aos_live_canvas_release_serial_lock`. The known semantic target/ref-click
smokes use this guard:

```bash
bash tests/aos-semantic-targets-xray.sh
bash tests/aos-semantic-targets-xray-retry.sh
bash tests/aos-canvas-ref-click.sh
```

Run those focused live tests as separate commands, not through a parallel test
runner. Isolated canvas tests that use `tests/lib/isolated-daemon.sh` may keep
their existing isolated workflow.

## Situational Hardware Tests

Some display tests depend on real hardware topology and OS permissions. Those
tests should skip cleanly when the environment does not qualify.

These tests should also run in an isolated `AOS_STATE_ROOT` and tear down their
own temp-root daemon state so they do not leave duplicate `aos` windows behind
if a run is interrupted.

Do not call daemon auto-starting commands such as `aos doctor`, `aos show ping`,
or `aos graph displays` before isolated tests finish writing required config like
`content.roots.toolkit`. Preflight checks should use non-daemon surfaces such as
`aos permissions check --json`, then start the isolated daemon explicitly and
wait on the isolated socket helper in `tests/lib/isolated-daemon.sh`.

Once the daemon is intentionally running, prefer the canonical readiness
commands over ad hoc polling:

- `aos content wait --root <name> ...`
- `aos show wait --id <canvas> [--manifest <name>] [--js <condition>]`

For tests or manual harnesses that need visual context, use the shared fixture
in `tests/lib/visual-harness.sh` instead of reimplementing canvas setup. It
wraps the isolated daemon helpers and provides named launch steps for common
surfaces:

- `aos_visual_start_isolated_daemon "$ROOT" toolkit packages/toolkit sigil apps/sigil`
- `aos_visual_launch_canvas_inspector surface-inspector`
- `aos_visual_launch_sigil_avatar avatar-main`
- `aos_visual_launch_sigil_with_inspector avatar-main surface-inspector`

Visual Sigil scenarios should default to launching `surface-inspector` beside the
surface under test unless the test is specifically measuring canvas lifecycle,
window count, or placement without auxiliary canvases.

## Manual Disruptive TCC Recovery Test

The repo-mode TCC reset recovery path has an explicit manual test because a full
passing run can trigger macOS privacy prompts and temporarily disrupt AOS input
control. Do not add this test to broad or default test runners.

Use the non-mutating preview after changing the permission handoff contract:

```bash
bash tests/manual/tcc-reset-agent-user-path.sh --dry-run
```

Run the disruptive agent/user path only when intentionally validating stale TCC
recovery on the current Mac:

```bash
AOS_RUN_DISRUPTIVE_TCC_TEST=1 \
  bash tests/manual/tcc-reset-agent-user-path.sh
```

Service-wide TCC reset is not part of normal recovery because it can affect other
apps. Treat it as break-glass only. Run the emergency path only when Michael
explicitly asks for emergency recovery:

```bash
AOS_RUN_DISRUPTIVE_TCC_TEST=1 AOS_ALLOW_EMERGENCY_TCC_SERVICE_RESET=1 \
  bash tests/manual/tcc-reset-agent-user-path.sh
```

The script writes an artifact directory with the tested agent message, human
responses, command JSON, and transcript. By default it stops the repo daemon on
exit; set `AOS_TCC_TEST_KEEP_DAEMON=1` only when the live ready state is needed
after the test.

## Test Authoring Discipline

Test code follows the same primitives-first rule as product code. Do not create
an ad hoc scenario by copying display math, launch plumbing, input injection, or
semantic-target parsing into a new script. Start with the existing primitive,
molecule, or template that owns the behavior:

- **Test primitives** in `tests/lib/` wrap AOS primitives such as readiness,
  canvas lifecycle, Surface Inspector visibility, DesktopWorld topology, real
  pointer injection, and semantic-target capture.
- **Test molecules** compose primitives into reusable fixtures such as "visible
  Surface Inspector plus Sigil avatar" or "real-input surface scenario with
  cleanup and diagnostics."
- **Scenario templates** describe one product behavior using those molecules and
  keep only product-specific intent and assertions locally.

Add a new test primitive only when there is a clear reusable pattern, a second
caller, or a boundary that should not be reimplemented by future scenarios. If a
single scenario needs a one-off assertion, keep it local, but do not let local
code own platform knowledge such as display DPI, native display origins, content
root setup, daemon readiness, or generic semantic-target extraction.

Test primitives that perform input should prefer shorthand over public AOS
actions. If a scenario needs a gesture that `aos do` cannot express cleanly,
record the missing action primitive instead of letting a private test gesture
language become the real contract.

Surface/app tests should express positions, paths, and expectations in
`DesktopWorld` space whenever possible. Native/AppKit coordinates are allowed in
two cases only: at the final real-input injection boundary where macOS requires
native CGEvent points, or in explicit boundary tests whose purpose is to verify
DesktopWorld/native/window-server behavior.

For Sigil radial-menu, avatar hit-target, status-item launch, or physical
pointer behavior, use the canonical live real-input scenario before creating an
ad hoc canvas or relying only on renderer debug state:

```bash
AOS_REAL_INPUT_OK=1 bash tests/scenarios/sigil/radial-menu/real-input.sh
```

It requires an active repo daemon, exactly one visible AOS status item, and an
idle keyboard/mouse. It opens Sigil through the status item, uses real cursor
movement and drag input to reveal the radial menu, verifies the radial child
surface through AOS semantic targets, and removes `avatar-main`,
`sigil-hit-avatar-main`, `sigil-radial-menu-avatar-main`, and
`sigil-radial-harness-inspector` on exit. Passing runs print a compact `PASS`
summary with the scenario, canvas ids, key semantic proof fields, travel count,
and artifact path. Full proof JSON and failure diagnostics are written under
`${AOS_REAL_INPUT_ARTIFACT_DIR:-${TMPDIR:-/tmp}/aos-real-input-artifacts}` unless
the caller overrides `AOS_REAL_INPUT_ARTIFACT_DIR`; use the reported artifact
before escalating to screenshots, pixel checks, or HITL inspection.

For live or manual Sigil checks after source edits, do not trust an already-open
`avatar-main` unless its debug runtime snapshot proves it was reloaded after the
change. Relaunch the surface or use `tests/lib/visual-harness.sh`; stale
WKWebView canvases can retain old JS modules and create false failures during
real-input verification.

To inspect the running Sigil module identity:

```bash
./aos show eval --id avatar-main \
  --js 'JSON.stringify(window.__sigilDebug.snapshot().runtime)'
```

For a clean live Sigil check:

```bash
./aos show remove --id avatar-main
./aos show remove --id sigil-hit-avatar-main 2>/dev/null || true
./aos show create --id avatar-main \
    --url 'aos://sigil/renderer/index.html' \
    --track union
```

Manual Sigil harnesses can pass `manual-visible` to
`aos_visual_launch_sigil_with_inspector` to place the avatar on a visible
non-main display when available. This avoids repeated false debugging of Sigil
state while tracked union canvases are still unreliable on some display slices.

Examples:

- `bash tests/capture-region-perception.sh`
- `bash tests/capture-canvas-surface.sh`
- `bash tests/capture-union-canvas-surface.sh`
- `bash tests/capture-parallel.sh`
- `bash tests/spatial-telemetry-smoke.sh`
- `bash tests/display-debug-battery-layout.sh`
- `bash tests/surface-inspector-move-abs.sh`
- `bash tests/surface-inspector-cross-display-drag.sh`
- `bash tests/surface-inspector-tint.sh`
- `bash tests/panel-tabs-activation.sh`
- `bash tests/voice-session-leases.sh`
- `bash tests/say-voice-slot.sh`
- `bash tests/voice-bind.sh`
- `bash tests/voice-final-response.sh`
- `bash tests/voice-telemetry.sh`
- `bash tests/final-response-hook.sh`
- `bash tests/config-surface.sh`
- `bash tests/cli-error-log.sh`
- `bash tests/sigil-avatar-interactions.sh`
- `bash tests/sigil-workbench-studio-restage.sh`
- `bash tests/sigil-workbench-launch.sh`

## Recovery

If an interrupted display/toolkit run leaves stale windows or extra non-launchd
daemons behind, use:

- `./aos clean`

## Manual Display-Debug Battery

For live multi-display coordinate work, launch the standard debug pair:

- `bash tests/display-debug-battery.sh`
- `node scripts/spatial-audit.mjs --summary`

That brings up:

- `surface-inspector`
- `spatial-telemetry`

Default placement is deterministic:

- `spatial-telemetry` flush bottom-left of the main display's visible bounds
- `surface-inspector` flush bottom-right of the main display's visible bounds

Those placements are operator convenience only. They do not define
`DesktopWorld`, which is the arranged full-display union.

Use them together when checking union bounds, per-display-local translation,
cursor placement, and `canvas_object.marks`.

The spatial audit is the governance gate for coordinate helper ownership. It
does not eliminate all current duplication yet, but it prevents new ad hoc
helper definitions from spreading outside the tracked allowlist while the
runtime is being consolidated.

The canonical toolkit-side JS spatial runtime now lives at:

- `packages/toolkit/runtime/spatial.js`
