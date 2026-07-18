# Test Targets

Use the smallest loop that matches the change. Start with the manifest-backed
router when the right loop is not obvious:

```bash
node scripts/aos-dev-workflow.mjs recommend --json
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
  content-root handling, or visual diagnostics need a
  repeatable workspace. They do not replace assertions for product semantics or
  real input. Reuse generic helpers in `tests/lib/visual-harness.sh`,
  `tests/visual-harness-boundary.sh`, and
  `tests/visual-harness-content-preflight.sh`, plus named visual launch helpers
  such as `aos_visual_launch_canvas_inspector`. External products own their
  launch compositions and product semantics. Escalate when a human must judge
  a visual result or when the bug appears only through host pointer/keyboard use.
- Status-item owner/click harnesses: use when menu-bar ownership, status-item
  PID scoping, duplicate-item diagnostics, or status-item click delivery is the
  contract. They do not prove arbitrary app behavior after launch unless the
  scenario asserts that behavior through the canonical surface. Reuse
  `tests/lib/status-item.sh` and neutral status-item fixtures. Escalate when
  renderer state or `show eval` activation would skip the status-item/user-input
  path under test.
- Real-input scenarios: use when real mouse or keyboard delivery, input taps,
  coordinate conversion, DesktopWorld/native boundaries, semantic targets, or
  action latency is the variable under test. They do not belong in broad
  default loops and should skip or stop cleanly when required permissions are
  missing. Reuse `tests/lib/real-input-surface-primitives.mjs` and named
  scenarios gated by `AOS_REAL_INPUT_OK=1`. Unexpected user input may
  invalidate and retry a measurement sample; it must not be a correctness
  precondition. Escalate to supervised/HITL only when automated evidence cannot
  answer the visual or human-observation question.
- Supervised/HITL harnesses: use when the contract requires explicit human
  observation, approval, or live-provider acceptance around an otherwise bounded
  run. They do not replace deterministic checks and should not become the
  default for routine harness selection. Reuse `tests/lib/supervised-run*.sh`,
  `tests/lib/supervised-run-artifact.py`, `tests/run-puck-hitl-plan.sh`, and
  manual tests under `tests/manual/`. Escalate to this level only with a clear
  human-needed question and artifact path.

## Proof-Worth Ratchet

New or touched executable tests, test helpers, fixtures, and proof reports must
be covered by `docs/dev/test-proof-registry.json`. Start from the primitive
contract, choose the cheapest harness level that preserves the defect variable,
name the replacement proof for any older asset, then add the registry entry
with the exact command and guard posture.
`node scripts/aos-dev-workflow.mjs recommend --json` enforces this only for
changed proof assets; untouched legacy tests remain runnable debt.

For cross-backend agent workspace saved-ref regressions, use:

```bash
bash tests/agent-workspace-cross-backend-proof.sh
```

That deterministic fixture lane wraps
`tests/manual/cross-backend-saved-ref-regression-proof.sh` and verifies the
artifact shape for browser, AOS canvas, and native AX rows. Manual or live
reruns must preserve the same `/tmp` proof root, `summary.json`, per-backend
artifact directories, row statuses, build telemetry, and cleanup evidence.
For a guarded repo-runtime proof with allowed `blocked_runtime` classifications,
run:

```bash
AOS_SAVED_REF_PROOF_MODE=guarded-live bash tests/manual/cross-backend-saved-ref-regression-proof.sh
```

In guarded-live mode, browser rows use `./aos browser _check-version` for
runtime resolution. The resolver order is `AOS_PLAYWRIGHT_CLI`, repo-local
`node_modules/.bin/playwright-cli`, repo-owned `scripts/aos-playwright-cli`, and
then `playwright-cli` on `PATH`. Browser `click` and `fill` run against a
harness-owned local HTTP fixture; raw Playwright is allowed only for setup,
readback, and cleanup, while the mutation path must dispatch through saved-ref
validation.

## Rebuild `./aos` First

Rebuild with `node scripts/aos-dev-build.mjs build --no-restart --json` when
both of these are true:

- the work changed Swift sources in `src/` or `shared/swift/ipc/`
- the command or test you are about to run executes `./aos`

The build gate is content-based for Swift runtime inputs. Touching a Swift file
without changing its content, or editing build tooling alone, should not replace
the TCC-owning `./aos` binary. Passing `--force`, changing Swift runtime input
content, changing build mode, or missing output can still rebuild it. A real
rebuild emits `Rebuilt: ./aos` and the ADR 0023 first-launch checkpoint; it
does not prove that TCC is stale.

After a real rebuild, the immediately following command must be
`./aos help --json`. Do not inspect, hash, attest, copy, sign, or run readiness
against the live artifact first, and stop immediately on exit `137`. If help
succeeds, stop immediately for the human TCC checkpoint without inspecting the
artifact or running readiness. After the user manually resets/regrants TCC and
replies `finished`, run exact
`./aos ready --repair --post-permission --json` with no intervening command.
That resume path performs at most one identity-checked managed restart before
its bounded live recheck.

Run this rebuild only from the primary checkout. If the current task cannot
mutate the native binary, return the work to the maintainer.

Use raw `bash build.sh` only when `./aos` is missing or the build command itself
is being repaired.

If you are serializing an up-to-date check with `./aos` verification, prefer:

- `scripts/aos-after-build -- ./aos ...`

That wrapper waits for any in-flight rebuild and runs the command when the
artifact was already current. If it performs a real rebuild, it rejects every
next command except exact `./aos help --json`.

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

- `node --test tests/renderer/*.test.mjs`
- `node --test tests/toolkit/*.test.mjs`
- `node --test tests/bundled-whisper-stt.test.mjs`
- `cd packages/gateway && npm test`
- `cd packages/host && npm test`

## DesktopWorld Scene Engine And DevTools

Use this static family for cartridge, interaction, route, DevTools session,
host-neutral view, and compatibility-projection changes. It does not execute
the repo AOS binary or require TCC:

```bash
bash tests/daemon-desktop-world-devtools-session.sh
node --test \
  tests/daemon-desktop-world-devtools-contract.test.mjs \
  tests/toolkit/desktop-world-devtools-model.test.mjs \
  tests/toolkit/desktop-world-devtools-view.test.mjs \
  tests/toolkit/desktop-world-devtools-compat.test.mjs \
  tests/toolkit/desktop-world-scene-interaction-runtime.test.mjs \
  tests/toolkit/desktop-world-scene-outlet.test.mjs \
  tests/toolkit/scene-interaction.test.mjs \
  tests/toolkit/scene-interaction-visual.test.mjs
```

The DevTools session owns one interactive canvas host at a time. Model tests
must prove revision conflicts, transfer rollback, bounded content-free
snapshots, disabled instrumentation with no scheduler, and focused historical
views projected from the same canonical snapshot.

## Toolkit Radial / Wiki Surface Family

Use this focused family when a change touches generic radial-menu projection,
the graph-first wiki browser surface, or toolkit runtime primitives that route
pointer input and target surfaces.

Deterministic radial and runtime contract:

```bash
node --test \
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
bash tests/help-contract.sh
bash tests/external-parser-flags.sh
git diff --check
```

Inventory for this family:

| Test or scenario | Class | Contract |
| --- | --- | --- |
| `tests/toolkit/runtime-*.test.mjs` in the command above | toolkit model | Shared radial, menu activation, input event, input region, and DesktopWorld hit-region primitives. |
| `tests/toolkit/wiki-kb*.test.mjs` | toolkit component model | Wiki KB graph/radial graph state, semantics, and layout-mode behavior. |
| `tests/toolkit/wiki-subject-browser.test.mjs` | toolkit component model | Graph-first Subject Browser shell, Catalog/Index/Details/Trail semantics, Markdown opening, and root clear behavior. |
| `tests/toolkit/wiki-subject-opening.test.mjs` and `tests/toolkit/wiki-subject.test.mjs` | toolkit workbench model | Wiki subject descriptors and Markdown open request mapping. |
| `tests/toolkit/workbench-subject.test.mjs`, `tests/toolkit/radial-menu-subject.test.mjs`, `tests/schemas/aos-workbench-subject.test.mjs` | toolkit/schema model | Reusable workbench subject descriptors and schema compatibility for radial/wiki surfaces. |
| `tests/wiki-kb-smoke.sh` | isolated-daemon launcher | Wiki KB launcher, content-root setup, sample graph load, radial graph switch, and optional capture. |

## Harness Composability Contracts

Some harnesses use or mutate shared live resources and must acquire a guard
before they start. Source `tests/lib/harness-contracts.sh` when a shell harness
needs to declare one of these classes:

| Class | Meaning | Current examples |
| --- | --- | --- |
| `repo-daemon-live` | Requires the live repo daemon and status item to remain stable for the run. | Guarded generic live-canvas scenarios |
| `repo-service-mutator` | Stops, starts, or otherwise changes the repo-mode service/status-item owner. | Explicit runtime service tests |
| `status-item-owner` | Owns an AOS status item for PID-scoped click evidence. | Status-item real-input smokes and live radial real-input scenarios |
| `real-input-pointer` | Posts real pointer/keyboard events and requires human idle input. | Real-input scenarios gated by `AOS_REAL_INPUT_OK=1` |

The guard records owner metadata (`pid`, script, cwd, start time, contract, and
exclusive groups) and fails fast with a `harness-contract conflict` diagnostic
instead of letting incompatible runs invalidate each other mid-run. It does not
kill other harnesses. Release guards from an `EXIT` trap.

Proofs that invoke the global stale-process scanner or create process fixtures
visible to it must source `tests/lib/process-cleanup-serial.sh` and call
`aos_process_cleanup_reexec_serial` before creating fixtures. The helper wraps
the complete script lifetime with macOS `lockf -k -t 120`, providing ordered,
kernel-released exclusion across shells and worktrees. Unlike the fail-fast
live-resource contracts, this bounded lock waits so normal parallel validation
becomes serial rather than failing or killing a peer's fixture.

Use `aos_harness_repo_service_stop_for_isolated_test` and
`aos_harness_repo_service_restore_if_needed` when a test intentionally stops the
repo service. That helper records whether the repo service was running, stops it
through `./aos service stop --mode repo --json`, and restores it only when the
test changed a running service.

Focused proof:

```bash
bash tests/harness-composability-contracts.sh
```


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
live in `tests/lib/visual-harness.sh`; external products own app-specific
compositions. The generic harness provides named launch steps for AOS surfaces:

- `aos_visual_start_isolated_daemon "$ROOT" toolkit packages/toolkit`
- `aos_visual_toolkit_url <path> [query]`
- `aos_visual_launch_canvas_inspector surface-inspector`

Visual URL helpers own the canonical `aos://...` launch/update contract. Runtime
evidence may contain resolved localhost URLs; compare those with
`aos_visual_assert_url_equivalent` instead of raw string equality. Reload
URL-backed canvases with `aos_visual_update_canvas_url`, which rejects resolved
localhost inputs by default. Branch-scoped keys are for explicit isolated proofs
with `AOS_STATE_ROOT` and `AOS_VISUAL_CONTENT_ROOT_SCOPE=branch`. Use
`aos_visual_assert_canvas_worktree` for owner metadata.

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
- **Test molecules** compose primitives into reusable fixtures such as a visible
  Surface Inspector or a real-input surface scenario with cleanup and diagnostics.
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

Product real-input, status-item, and renderer acceptance belongs in the external
product repository. AOS keeps only generic input, canvas, status-item, and
Surface Inspector scenarios with neutral fixtures.

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
