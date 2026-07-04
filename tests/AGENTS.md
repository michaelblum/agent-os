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
- Do not weaken assertions to match stale behavior; update the owning contract
  or source when behavior intentionally changes.
- Preserve cleanup for canvases, daemon state, temporary files, and live
  resources.
- Artifact-producing proof harnesses under `tests/manual/` must write stable
  machine-readable summaries and explicit cleanup evidence when they create
  `/tmp` proof roots.

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
