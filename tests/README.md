# Test Targets

Use the smallest loop that matches the change. Do not rebuild `./aos` by
default before every verification step.

## Rebuild `./aos` First

Rebuild with `bash build.sh` when both of these are true:

- the work changed Swift sources in `src/` or `shared/swift/ipc/`
- the command or test you are about to run executes `./aos`

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

## Mixed Work

If a change spans both Swift and JS/package surfaces:

1. Run the smallest local tests first without rebuilding `./aos`.
2. Rebuild once before the first `./aos`-backed verification step.
3. Reuse that binary for the remaining `./aos` checks until Swift changes again.

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
- `aos_visual_launch_canvas_inspector canvas-inspector`
- `aos_visual_launch_sigil_avatar avatar-main`
- `aos_visual_launch_sigil_with_inspector avatar-main canvas-inspector`

Visual Sigil scenarios should default to launching `canvas-inspector` beside the
surface under test unless the test is specifically measuring canvas lifecycle,
window count, or placement without auxiliary canvases.

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
- `bash tests/canvas-inspector-move-abs.sh`
- `bash tests/canvas-inspector-cross-display-drag.sh`
- `bash tests/canvas-inspector-tint.sh`
- `bash tests/panel-tabs-activation.sh`
- `bash tests/voice-session-leases.sh`
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

- `canvas-inspector`
- `spatial-telemetry`

Default placement is deterministic:

- `spatial-telemetry` flush bottom-left of the main display's visible bounds
- `canvas-inspector` flush bottom-right of the main display's visible bounds

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
