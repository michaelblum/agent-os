@../AGENTS.md

# Tests

## Purpose

`tests/` contains repo verification assets: shell smokes, Node tests, Python
helpers, fixtures, browser checks, daemon checks, toolkit checks, and scenario
tests.

## Ownership

- Root-level tests cover cross-cutting `./aos` and runtime behavior.
- Subdirectories group tests by surface or fixture type.
- Test helpers belong in `tests/lib/`.

## Local Contracts

- Keep tests deterministic by default. Live input, daemon, or TCC-dependent
  checks must advertise prerequisites through env vars or scenario docs.
- Keep deterministic canvas lifecycle stress and guarded concurrent-input
  stress in separate scenario drivers over shared lifecycle support.
- Do not weaken assertions to match stale behavior; update the owning contract
  or source when behavior intentionally changes.
- Core Target Handle V1 acceptance tests use isolated state roots, fake Playwright/AOS
  executables, and pure Swift selection harnesses. They must prove original-pair
  validation plus fail-closed browser no-dispatch, independently verified
  minting-backend implementation-closure identity, V0 byte-preserving rejection,
  exact-one Locator behavior, one-shot and native-session state rejection, and
  schema-valid native handle emission or omission, and the absence of
  reacquisition or first-match helpers without executing `./aos`.
- Policy drift guards must name the exact active source surfaces and prohibited
  doctrine they protect. Do not globally ban mechanically valid terms such as
  `dry-run`, `authorization`, `allowlist`, `redaction`, Gate, or Work Record.
- Preserve cleanup for canvases, daemon state, temporary files, and live
  resources.
- Proofs that exercise global process cleanup must fail fast while an unrelated
  raw repo daemon is live; they may never stop that runtime as test setup.
- Artifact-producing proof harnesses under `tests/manual/` must write stable
  machine-readable summaries and explicit cleanup evidence when they create
  `/tmp` proof roots.
- Voice transport unit tests must use disposable Swift or fake-socket harnesses
  by default. Live microphone, global-hotkey, and audio-output proof is a
  separate manual/TCC-sensitive gate and must not rebuild `./aos` implicitly.
- DesktopWorld gesture and scene-follow tests must use deterministic clocks,
  fake input-region bridges, disposable sockets, and schema fixtures. Static
  scene contract work must not execute the repo AOS binary or require TCC.
- The desktop-pixel native baseline compares a standalone control with the
  DesktopWorld-hosted AOS sheet increment. It proves that the native sheet
  reuses the stage topology and windows, resolves by exact identity, bounds its
  deformable geometry, and leaves no installed sheet, geometry buffer, texture,
  or shared GPU resource after cleanup. It has source, full Swift integration,
  and runtime Metal-shader compilation coverage plus a supervised TCC-sensitive
  proof. Its focused lifecycle harness must reject blank/stale frames, prove
  producer advancement, compensate partial startup through the production
  coordinator, and keep the development-probe gate closed by default. Static
  verification must never invoke capture or treat these checks as native
  presentation evidence.
- Public-capture ownership proofs remain offline and TCC-free. They must cover
  warm quiesce/still/restore ordering, current and stale terminal callbacks,
  public explicit-exclusion policy, callback deadline quarantine, strict IPC,
  and ordered digest-verified transfer above the normal 32 MiB socket budget by
  compiling focused production owners rather than copied algorithms.
- Public-capture reader proof must use the production `DaemonSession` over
  disposable socketpairs to cover partial valid frames, byte-drip deadline
  exhaustion, and bounded oversized-frame rejection. It must also exercise the
  production event-stream read and reconnect loops so an oversized unterminated
  frame cannot wedge a subscription.
- Status-item host contract tests must use disposable fake sockets and schema
  fixtures, model startup admission ordering, and prove registration output
  precedes initial events. Fake sockets must emit the complete daemon envelope
  and complete invocation result so tests also prove the CLI's canonical public
  projection. Concurrency, exhaustion, dry-run, and failed-delivery admission
  proofs must exercise the focused production admission component used by the
  native manager, not a copied fake allocator. A static AppKit harness may
  exercise production menu rendering and callback binding without opening a
  status item; native menu-bar acceptance remains a separate build/runtime gate.
- Display-topology identity proof must compile the focused production Swift
  helper with `-Onone`, remain offline and daemon/TCC-free, and cover raw
  enumeration permutations, every mapping fact, UUID fallback, invalid inputs,
  direct and saved explicit/interactively selected region response wiring,
  `state_id` separation, and the single-observation source guard. It must also
  reject missing/duplicate live NSScreen sources, selected/provider membership
  drift, UUID/runtime-ID swaps, fallback-ID drift, provider frame/point size and
  production filter-scale drift,
  fractional/unrepresentable pixel dimensions, and captured full-display pixel
  mismatch. Saved region and interactive summaries must validate through the
  common workspace validator with the canonical sibling topology schema
  registered by `$id`. Static guards must prove interactive selection uses only
  frozen bounds and rejoins the validated region path with no screen
  re-enumeration, filter recreation, or external image capture. Native region
  capture remains a separate permission-sensitive test.
- PNG file comparison proof must compile only its focused Swift source and
  disposable harness with explicit `-Onone`, generate fixed fixtures under a
  private temporary root, reject special files under a bounded watchdog, and
  prove exact identical, sparse-change, and dense-change metrics plus optional
  grayscale change-map/mask samples, hashes, target validation, expectation
  retention, parent-identity drift rejection, checked-receipt rollback, normal
  rollback, explicit cleanup-failure reporting, unrelated-file preservation,
  and bounded 3840x2160 artifact output. It must render direct text help so
  malformed required-group topology cannot self-pass, and exercise the
  production runtime-path helper, dispatcher, and comparator through absolute,
  PATH, and relative executable invocations from an external caller directory.
  It must not execute the repo AOS binary, capture pixels, start services, or
  require TCC.
- `tests/dev-workflow-router.sh` runs its public `./aos` rejection checks by
  default. Use `AOS_SKIP_LIVE_CLI_CHECKS=1` only for explicit static-only
  validation while the repo artifact is absent or waiting at ADR 0023's human
  TCC checkpoint; the live checks remain required after readiness recovers.

## Work Guidance

- Name tests after the behavior or contract they protect.
- Prefer existing harness helpers in `tests/lib/`.
- Keep agent workspace fixture helpers split by domain under
  `tests/lib/agent-workspace-fixtures/`; `tests/lib/agent-workspace-fixtures.sh`
  is only the compatibility shim that sources those files.
- Keep Target Handle V1 deterministic coverage in
  `target-handle-runtime.test.mjs`, `agent-workspace-v1.test.mjs`, and
  `native-target-locator-selection.sh`; guarded legacy live proofs are not V1
  acceptance evidence.

## Verification

- Run the focused test for the changed path.
- Use `git diff --check` for test-only edits when no executable check is
  relevant.

## Child DOX Index

- `browser/` contains browser adapter tests.
- `content/` contains content/wiki tests.
- `daemon/` contains daemon and gate tests.
- `design/` contains design-contract fixture tests.
- `fixtures/` contains test fixtures; `fixtures/legacy-sigil/product/AGENTS.md`
  governs the frozen historical Sigil payload.
- `gateway/` contains gateway tests.
- `lib/` contains shared test harness helpers.
- `manual/` contains manual or environment-sensitive checks.
- `renderer/` contains renderer/module tests.
- `scenarios/` contains scenario tests.
- `schemas/` contains schema tests.
- `toolkit/` contains toolkit tests.
