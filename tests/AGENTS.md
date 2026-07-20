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
- Preserve cleanup for canvases, daemon state, temporary files, and live
  resources.
- Artifact-producing proof harnesses under `tests/manual/` must write stable
  machine-readable summaries and explicit cleanup evidence when they create
  `/tmp` proof roots.
- Voice transport unit tests must use disposable Swift or fake-socket harnesses
  by default. Live microphone, global-hotkey, and audio-output proof is a
  separate manual/TCC-sensitive gate and must not rebuild `./aos` implicitly.
- DesktopWorld gesture and scene-follow tests must use deterministic clocks,
  fake input-region bridges, disposable sockets, and schema fixtures. Static
  scene contract work must not execute the repo AOS binary or require TCC.
- Status-item host contract tests must use disposable fake sockets and schema
  fixtures, model startup admission ordering, and prove registration output
  precedes initial events. Fake sockets must emit the complete daemon envelope
  so tests also prove the CLI's canonical public event projection; native
  menu-bar acceptance remains a separate build/runtime gate.
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
- For cross-backend agent workspace saved-ref regressions, keep the deterministic
  fixture lane in `tests/agent-workspace-cross-backend-proof.sh` aligned with
  the artifact-producing manual harness instead of adding ad hoc proof scripts.

## Verification

- Run the focused test for the changed path.
- Use `git diff --check` for test-only edits when no executable check is
  relevant.

## Child DOX Index

- `browser/` contains browser adapter tests.
- `content/` contains content/wiki tests.
- `daemon/` contains daemon and gate tests.
- `design/` contains design-contract fixture tests.
- `fixtures/` contains test fixtures.
- `gateway/` contains gateway tests.
- `lib/` contains shared test harness helpers.
- `manual/` contains manual or environment-sensitive checks.
- `renderer/` contains renderer/module tests.
- `scenarios/` contains scenario tests.
- `schemas/` contains schema tests.
- `toolkit/` contains toolkit tests.
