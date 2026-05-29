# Test Targets

Use the smallest loop that matches the change. Start with the manifest-backed
router when the right loop is not obvious:

```bash
./aos dev recommend --json
```

Do not rebuild `./aos` by default before every verification step.

For the repo-wide entry-path model behind these choices, see
`docs/guides/agent-entry-paths-and-verification.md`.

For runtime, canvas, input, status-item, lifecycle, or cross-layer work, choose
the cheapest canonical-path representative harness that preserves the variable
at risk. Use `docs/guides/test-harness-ladder-and-prep.md` when the harness is
not obvious or when a new test primitive, fixture, helper, or scenario may be
needed.

## Foundational Harness Ladder

Use this ladder before reaching for app-specific examples. Escalate only when
the lower level fakes away the defect variable, cannot observe the relevant
contract, or would need private test plumbing that already exists one level up.

- Model/unit tests: use for pure reducers, parsers, schemas, renderer state,
  toolkit helpers, and package logic. They do not cover daemon lifecycle,
  content serving, real canvas frames, host permissions, or native input. Reuse
  `tests/renderer/*.test.mjs`, `tests/toolkit/*.test.mjs`,
  `tests/daemon/*.test.mjs`, `tests/schemas/*.test.mjs`, and package-local
  test loops. Escalate when the behavior depends on `./aos`, persisted runtime
  state, a served URL, display topology, or native event delivery.
- Toolkit/component contract tests: use for reusable browser-surface policy,
  runtime primitives, subject descriptors, workbench shell behavior, and
  component contracts that can be proven without a live daemon. They do not
  cover content-root registration, canvas lifecycle, native window placement, or
  end-to-end app activation. Reuse `tests/toolkit/runtime-*.test.mjs`,
  `tests/toolkit/*subject*.test.mjs`, and adjacent schema tests. Escalate when
  the contract crosses into daemon-backed canvases or host-owned input.
- Isolated daemon tests: use when the behavior needs `./aos`, daemon IPC,
  content roots, canvas lifecycle, wiki/content state, voice/session state, or
  a browser canvas without sharing the repo daemon. They do not prove
  singleton repo-daemon behavior, live status-item ownership, or real user
  input. Reuse `tests/lib/isolated-daemon.sh` and tests that allocate
  `AOS_STATE_ROOT`. Escalate when the defect depends on the shared repo daemon,
  live canvas namespace, or an existing user-facing runtime surface.
- Shared repo-daemon live canvas tests: use when the canonical path is the live
  repo daemon or when the shared canvas namespace, content roots, xray, capture,
  ref-click, or cleanup behavior is the variable under test. They do not
  tolerate parallel canvas mutation and do not prove native pointer behavior by
  themselves. Reuse `tests/lib/live-canvas-serial.sh`,
  `tests/aos-semantic-targets-xray.sh`,
  `tests/aos-semantic-targets-xray-retry.sh`, and
  `tests/aos-canvas-ref-click.sh`. Escalate when visual placement, status-item
  ownership, or real input is the defect variable.
- Visual harness tests: use when canvas placement, Surface Inspector visibility,
  app launch composition, stale content roots, or visual diagnostics need a
  repeatable workspace. They do not replace assertions for product semantics or
  real input. Reuse generic helpers in `tests/lib/visual-harness.sh`,
  app-specific compositions such as `tests/lib/sigil/visual-harness.sh`,
  `tests/visual-harness-content-preflight.sh`, and named visual launch helpers
  such as `aos_visual_launch_canvas_inspector` and
  `aos_visual_launch_sigil_with_inspector`. Escalate when a human must judge a
  visual result or when the bug appears only through host pointer/keyboard use.
- Status-item owner/click harnesses: use when menu-bar ownership, status-item
  PID scoping, duplicate-item diagnostics, or status-item click delivery is the
  contract. They do not prove arbitrary app behavior after launch unless the
  scenario asserts that behavior through the canonical surface. Reuse
  `tests/lib/status-item.sh`, `tests/sigil-status-item-lifecycle.sh`,
  `tests/sigil-real-input-status-avatar.sh`, and
  `tests/sigil-context-menu-real-input.sh`. Escalate when renderer state or
  `show eval` activation would skip the status-item/user-input path under test.
- Real-input scenarios: use when real mouse or keyboard delivery, input taps,
  coordinate conversion, DesktopWorld/native boundaries, semantic targets, or
  action latency is the variable under test. They do not belong in broad
  default loops and should skip or stop cleanly when permissions or human idle
  state are missing. Reuse `tests/lib/real-input-surface-harness.sh`,
  `tests/lib/real-input-surface-primitives.mjs`,
  `tests/lib/real_input_surface_primitives.py`, and named scenarios gated by
  `AOS_REAL_INPUT_OK=1`. Escalate to supervised/HITL only when automated
  evidence cannot answer the visual or human-observation question.
- Supervised/HITL harnesses: use when the contract requires explicit human
  observation, approval, or live-provider acceptance around an otherwise bounded
  run. They do not replace deterministic checks and should not become the
  default for routine harness selection. Reuse `tests/lib/supervised-run*.sh`,
  `tests/lib/supervised-run-artifact.py`, `tests/run-puck-hitl-plan.sh`, and
  manual tests under `tests/manual/`. Escalate to this level only with a clear
  human-needed question and artifact path.

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

- `node --test tests/studio/*.test.mjs` for sequestered Studio pure helpers only.
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
| `tests/sigil-real-input-status-avatar.sh` | isolated-daemon real-input | Test-daemon status item click, avatar visibility, shallow context-menu smoke, bounded duplicate status-item overlap evidence, and split click/app-response timing. Uses the native low-latency helper for the status-item click and `aos do` for subsequent surface interactions. |
| `tests/sigil-context-menu-real-input.sh` | isolated-daemon real-input | Owned visible avatar plus deeper context-menu controls through shared `aos do` action helpers. Moves the pointer through `aos do`. |
| `tests/scenarios/sigil/radial-menu/real-input.sh` | live real-input | User-facing status item, avatar, radial target surface semantics, and native pointer selection path. Requires `AOS_REAL_INPUT_OK=1` and `./aos ready`. |
| `tests/scenarios/sigil/radial-menu/real-input-desktop-world-path.sh` | live real-input | Topology-neutral DesktopWorld fast-travel plus radial selection path. Requires `AOS_REAL_INPUT_OK=1` and `./aos ready`. |

Use these named scenarios instead of ad hoc `./aos do` sequences in new
real-input verification. The shared helpers under `tests/lib/` own readiness,
wait/retry, AOS command execution, canvas/DOM-to-native target resolution, and
real click/scroll/key wrappers.

Duplicate AOS status items are a red flag. Isolated status-item tests can create
a second AOS status item while the live repo daemon has its own item. The real
status-item smoke targets its isolated daemon PID and fails if another matching
status item overlaps that target, so global menu-bar ambiguity is bounded and
reported instead of silently contaminating the click.

Do not use direct DOM or `show eval` activation as the acceptance proof for
radial menu user behavior. Eval remains useful for observation after native or
realistic input has opened the relevant surface. If `./aos ready` reports a
repo-mode TCC/input-tap blocker, follow the dock stall contract instead of
retrying live real-input scenarios.

## Harness Composability Contracts

Some harnesses use or mutate shared live resources and must acquire a guard
before they start. Source `tests/lib/harness-contracts.sh` when a shell harness
needs to declare one of these classes:

| Class | Meaning | Current examples |
| --- | --- | --- |
| `repo-daemon-live` | Requires the live repo daemon and status item to remain stable for the run. | `tests/scenarios/sigil/radial-menu/real-input.sh`, `tests/scenarios/sigil/radial-menu/real-input-desktop-world-path.sh` |
| `repo-service-mutator` | Stops, starts, or otherwise changes the repo-mode service/status-item owner. | `tests/sigil-real-input-status-avatar.sh` |
| `status-item-owner` | Owns an AOS status item for PID-scoped click evidence. | Status-item real-input smokes and live radial real-input scenarios |
| `real-input-pointer` | Posts real pointer/keyboard events and requires human idle input. | Real-input scenarios gated by `AOS_REAL_INPUT_OK=1` |

The guard records owner metadata (`pid`, script, cwd, start time, contract, and
exclusive groups) and fails fast with a `harness-contract conflict` diagnostic
instead of letting incompatible runs invalidate each other mid-run. It does not
kill other harnesses. Release guards from an `EXIT` trap.

Use `aos_harness_repo_service_stop_for_isolated_test` and
`aos_harness_repo_service_restore_if_needed` when a test intentionally stops the
repo service. That helper records whether the repo service was running, stops it
through `./aos service stop --mode repo --json`, and restores it only when the
test changed a running service.

Focused proof:

```bash
bash tests/harness-composability-contracts.sh
```

## Sequestered Studio Helper Tests

Studio is defunct as a current Sigil product and launch surface. The
`tests/studio/*.test.mjs` files remain only as pure-helper coverage for
`apps/sigil/_sequestered/studio/...`; they are not Sigil MVP activation tests,
status-item tests, radial-menu tests, or current product launch proof.

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

For tests or manual harnesses that need visual context, use shared harness
fixtures instead of reimplementing canvas setup. Generic AOS/canvas primitives
live in `tests/lib/visual-harness.sh`. App-specific compositions live under
`tests/lib/<app>/`, such as `tests/lib/sigil/visual-harness.sh`. Together they
wrap the isolated daemon helpers and provide named launch steps for common
surfaces:

- `aos_visual_start_isolated_daemon "$ROOT" toolkit packages/toolkit sigil apps/sigil`
- `aos_visual_toolkit_url <path> [query]`
- `aos_visual_sigil_renderer_url`
- `aos_visual_launch_canvas_inspector surface-inspector`
- `aos_visual_launch_sigil_avatar avatar-main`
- `aos_visual_launch_sigil_with_inspector avatar-main surface-inspector`

Visual URL helpers own the canonical `aos://...` launch/update contract. Runtime
evidence may contain resolved localhost URLs; compare those with
`aos_visual_assert_url_equivalent` instead of raw string equality. Reload
URL-backed canvases with `aos_visual_update_canvas_url`, which rejects resolved
localhost inputs by default. In the single-worktree dev workflow, visual helpers
use canonical `sigil` and `toolkit` root keys; branch-scoped keys are for
explicit overrides or true parallel worktree/session isolation. Use
`aos_visual_assert_canvas_worktree` for owner metadata and
`aos_visual_assert_sigil_renderer_fresh` when a live Sigil smoke must prove the
loaded page is newer than or equal to the commit under test.

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

For runtime, canvas, input, status-item, lifecycle, visual, supervised, or
cross-layer slices, report harness choices and reusable artifact candidates when
they matter. Use `harness_selection`, `fixture_blind_spots`,
`new_test_artifact_candidates`, or `why_no_harness_prep_needed` as lightweight
completion-report fields instead of making every small test or docs change
verbose.

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
change. Relaunch the surface or use `tests/lib/sigil/visual-harness.sh`; stale
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
