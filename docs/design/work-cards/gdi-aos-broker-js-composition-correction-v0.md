# GDI Correction Round: AOS Broker JS Composition

## Tracker

- Governing issue: https://github.com/michaelblum/agent-os/issues/407
- PR under review: https://github.com/michaelblum/agent-os/pull/409
- Source review: https://github.com/michaelblum/agent-os/pull/409#pullrequestreview-4424183272
- Transfer kind: correction round
- Recipient: GDI

## Fresh Context Contract

GDI starts from a fresh context window. Do not assume branch, checkout, daemon,
canvas, issue, or prior implementation state. Read and rediscover before
editing.

## Branch / Base

- Repo root: `/Users/Michael/Code/agent-os`
- Workflow profile: `local_relay`
- Work surface: existing PR branch `gdi/aos-target-addressed-action-ergonomics-v0`
- `branch_from`: `origin/gdi/aos-target-addressed-action-ergonomics-v0`
- `required_start_ref`: `origin/gdi/aos-target-addressed-action-ergonomics-v0`
- PR base: `gdi/radial-compact-snapshot-extraction-integration-v0` (#405 head)
- Do not retarget, rebase, merge #405, or push. Foreman owns publication after
  acceptance.
- Leave the correction as one or more scoped local commits on
  `gdi/aos-target-addressed-action-ergonomics-v0`, or stop and report if the
  checkout cannot be safely prepared without disturbing unrelated work.

## Goal

Resolve the maintainability review blocker by making the external AOS TCC
broker command scripts share one canonical JS composition layer and by adding
deterministic tests for readiness, permissions, and setup-prompt behavior.

## Read First

- `AGENTS.md`
- `.docks/gdi/AGENTS.md`
- `src/AGENTS.md`
- `docs/adr/0015-aos-tcc-capability-broker-boundary.md`
- `docs/design/aos-tcc-capability-broker-refactor-map-v0.md`
- PR review: `gh pr view 409 --json reviews --jq '.reviews[-1].body'`

## Rediscover State

```bash
git status --short --branch
git branch --show-current
git rev-parse --show-toplevel
git rev-parse --short HEAD
gh pr view 409 --json number,title,state,url,baseRefName,headRefName,mergeable
./aos dev recommend --json --paths scripts/aos-ready.mjs scripts/aos-status.mjs scripts/aos-doctor.mjs scripts/aos-permissions.mjs scripts/lib tests/external-command-dispatch.sh tests/ready-fast-healthy-path.sh tests/ready-ownership-mismatch.sh tests/permissions-broker-primitives.sh tests/runtime-readiness-broker-primitives.sh tests/schemas/aos-external-command-manifest-v0.test.mjs
```

If `./aos ready` or a bounded live check reports a repo-mode Accessibility,
Input Monitoring, or inactive input-tap blocker, stop looping and run:

```bash
.docks/gdi/scripts/human-needed-tcc-reset
```

Then report `human_needed` with the script output. Do not reset permissions,
open Settings, or rebuild native code to chase a live TCC blocker.

## Existing Code To Inspect

- `scripts/aos-ready.mjs` - owns public `./aos ready` composition, blockers,
  phases, diagnoses, next actions, and notes.
- `scripts/aos-permissions.mjs` - owns public `./aos permissions
  check|preflight|setup|reset-runtime` composition and the setup prompt loop.
- `scripts/aos-status.mjs` - owns public `./aos status` formatting.
- `scripts/aos-doctor.mjs` - owns top-level public `./aos doctor` formatting.
- `scripts/lib/` - existing home for reusable Node modules.
- `tests/external-command-dispatch.sh` - current external command routing and
  permissions setup skip coverage.
- `tests/ready-fast-healthy-path.sh` and `tests/ready-ownership-mismatch.sh` -
  current shell coverage around ready/status outputs.
- `tests/permissions-broker-primitives.sh` and
  `tests/runtime-readiness-broker-primitives.sh` - private broker primitive
  coverage.

## Required Behavior

### Shared JS Composition Layer

Extract repeated command-surface helpers from the four scripts into
`scripts/lib/` modules. The suggested split from the review is acceptable, but
adjust names only if the local code argues for a clearer boundary:

- `scripts/lib/aos-cli.mjs` - CLI plumbing such as `printJSON`, `exitError`,
  `run`, `repoRoot`, `aosPath`, `currentMode`, `invocationName`,
  `runAOS`, `runNodeScript`, and JSON parsing helpers.
- `scripts/lib/aos-facts.mjs` - broker fact gathering and normalization such
  as permissions facts, daemon health, runtime status facts, setup marker
  state, daemon view, identity, and runtime health notes.
- `scripts/lib/aos-readiness.mjs` - readiness/permission policy shared across
  surfaces: `evaluateReadyForTesting`, permission requirements, recovery
  guidance strings, ready blockers, ready next actions, phases, diagnoses, and
  notes when they are not truly surface-specific.

The four public scripts should become thin surface formatters/orchestrators.
They may keep genuinely surface-specific argument parsing and output shaping,
but they must not retain independent copies of the same readiness verdict,
permission requirement data, input-tap recovery guidance, or broker
fact-gathering blocks. If a small duplicate remains intentionally
surface-specific, call it out in the completion report with the reason.

### Public Output Compatibility

Keep the public JSON keys and exit behavior established by #409:

- `./aos ready --json`
- `./aos status --json`
- `./aos doctor --json`
- `./aos permissions check --json`
- `./aos permissions preflight --json`
- `./aos permissions setup --once --json`
- `./aos permissions reset-runtime --mode repo --dry-run --json`

Internal helpers can use a canonical shape, but each surface must continue to
emit its existing public shape, including the current camelCase vs snake_case
output differences where they are already part of the public command response.
Document the formatting boundary in code or tests so the distinction is
intentional and enforced.

### Deterministic Tests

Add a fixture-driven `node --test` suite for the extracted pure logic. It
should not require native rebuilds, real daemon state, or live macOS TCC grants.
Cover at least:

- daemon-active ready path with setup complete and screen recording granted;
- daemon input tap not active;
- daemon accessibility stale/missing while the CLI view is granted;
- legacy daemon health with absent listen/post/accessibility fields falling
  back correctly;
- setup marker missing;
- stale or unmanaged runtime blockers and resulting next actions;
- `permissionRequirements` output shape;
- cross-surface readiness consistency from one shared verdict source.

Add deterministic coverage for the interactive setup branch without invoking
real macOS prompts. Prefer extracting a small prompt/setup planner or using
dependency injection so tests can assert:

- missing permissions are prompted in the expected order;
- a failed/cancelled prompt stops the loop and reports the correct note;
- the marker is written and services are restarted only when the final CLI
  permission view is complete;
- the already-granted skip branch remains covered.

## Scope

- Owns JS external command composition and deterministic tests.
- Native Swift should not need to change. If Swift changes appear necessary,
  stop and justify the privileged fact/action/stream boundary before editing.
- Docs may be touched only where needed to describe the shared output-format
  boundary or test seam.

## Hard Boundaries / Non-Goals

- Do not move public workflow policy, recovery choreography, help text, or
  presentation back into Swift.
- Do not add compatibility aliases, transitional broad private routes, or old
  `__ready` / `__status` / `__doctor` / broad `__permissions` workflows.
- Do not create linked worktrees.
- Do not clean unrelated untracked files or generated artifacts.
- Do not retarget PR #409 or mutate #405.
- Do not push; Foreman owns publication after review.
- Do not add a broad framework or test harness when a small exported pure
  function and fixture suite will cover the risk.

## Verification

Run deterministic checks first:

```bash
node --test tests/aos-readiness-composition.test.mjs
node --test tests/schemas/aos-external-command-manifest-v0.test.mjs
bash tests/external-parser-flags.sh
bash tests/external-command-dispatch.sh
bash tests/ready-fast-healthy-path.sh
bash tests/ready-ownership-mismatch.sh
bash tests/permissions-broker-primitives.sh
bash tests/runtime-readiness-broker-primitives.sh
git diff --check
```

Run the repo recommendation command after edits and follow it if it asks for
additional focused checks:

```bash
./aos dev recommend --json --paths scripts/aos-ready.mjs scripts/aos-status.mjs scripts/aos-doctor.mjs scripts/aos-permissions.mjs scripts/lib tests
```

If native Swift was not touched, `./aos dev build` is not required unless
`./aos dev recommend` asks for it. If Swift is touched, run `./aos dev build`.

If `./aos ready --json` passes or remains green, run bounded live/public
surface smoke:

```bash
./aos ready --json
./aos permissions check --json
./aos status --json
./aos doctor --json
```

If live readiness is blocked by TCC/input tap state, use the human-needed stop
path above and report the blocker instead of looping.

## Completion Report

Report:

- changed paths that belong to this correction;
- helper modules created and which duplicate helpers were removed from each
  public script;
- tests added and exact pass/fail results;
- whether any intentional duplicate helper logic remains and why;
- live smoke result or the exact readiness/TCC blocker;
- branch status and whether changes were committed locally;
- unrelated dirty/untracked state observed but left untouched;
- any follow-up recommendation for Foreman before #409 is pushed again.
