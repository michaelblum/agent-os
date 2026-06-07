# Work Card: AFK Sleep Lease Toolkit Surface Clipboard Write Text UX Local Run V0

**Status:** Superseded

## Result

The local away-run attempt stopped at startup with `classification:
human_needed` before branch creation or edits because the provider saw AOS
readiness blockers. After the human returned, Foreman verified
`./aos ready --post-permission` was green and routed the normal GDI work card:

`docs/design/work-cards/toolkit-surface-clipboard-write-and-text-ux-baseline-v0.md`

Use that card for active implementation. This local-only wrapper is no longer
the active route.

## Transfer Classification

- Recipient: GDI
- Transfer kind: GDI round through a sleep-lease provider run
- Single next goal: implement the native-backed AOS surface clipboard write and
  text-selection baseline from
  `docs/design/work-cards/toolkit-surface-clipboard-write-and-text-ux-baseline-v0.md`
  on a local review branch.
- Source artifacts:
  - `docs/design/work-cards/toolkit-surface-clipboard-write-and-text-ux-baseline-v0.md`
  - `docs/design/notes/afk-sleep-lease-safety-contract-2026-05-24.md`
  - `src/daemon/unified.swift`
  - `docs/api/toolkit/runtime.md`
  - `packages/toolkit/runtime/canvas.js`
  - `tests/toolkit/runtime-canvas.test.mjs`
  - `packages/toolkit/components/surface-inspector/index.js`
  - `apps/sigil/renderer/live-modules/main.js`
  - `apps/sigil/diagnostics/interaction-trace/index.js`
  - `apps/sigil/chat/index.html`
  - `packages/toolkit/components/agent-terminal/index.html`
  - `packages/toolkit/components/agent-terminal/terminal-controller.js`
- Branch/Base:
  - `branch_from: origin/main`
  - `required_start_ref: origin/main` with this work card present
- Branch/output expectation: create local branch
  `gdi/toolkit-surface-clipboard-write-and-text-ux-baseline-v0` from
  `origin/main`. Commit verified work locally on that branch. Do not push the
  branch, open a PR, merge, mutate GitHub issues/projects, or route follow-up
  work.

## Sleep Lease

This run is authorized by the local human's `proceed` instruction on
2026-05-24.

Boundaries:

- max provider launches: 1;
- max wall clock: 120 minutes;
- allowed dock: GDI;
- allowed provider: Codex;
- allowed work ref: this work card only;
- external publication policy: none;
- branch push: forbidden;
- main mutation: forbidden;
- result route: local final response plus local git state only.

If the task cannot be completed safely inside these limits, stop with a
completion report that names the blocker and leaves the worktree reviewable.

## Fresh Context Contract

Start from fresh context. Do not assume branch, worktree, readiness, current
clipboard code, current surface CSS, existing tests, provider state, or prior
Foreman notes. Read and rediscover before editing.

## Goal

Follow the implementation and verification contract in:

```text
docs/design/work-cards/toolkit-surface-clipboard-write-and-text-ux-baseline-v0.md
```

This card overrides only the git/publication behavior for sleep-lease safety:
local branch and local commit are allowed; push, PR, GitHub mutation, and
external publication are not allowed.

## Required Startup

Run from `/Users/Michael/Code/agent-os`:

```bash
git status --short --branch
git rev-parse HEAD origin/main
./aos ready
./aos dev recommend --json --paths src/daemon/unified.swift,docs/api/toolkit/runtime.md,packages/toolkit/runtime/canvas.js,tests/toolkit/runtime-canvas.test.mjs,packages/toolkit/components/surface-inspector/index.js,apps/sigil/renderer/live-modules/main.js,apps/sigil/diagnostics/interaction-trace/index.js,apps/sigil/chat/index.html,packages/toolkit/components/agent-terminal/index.html,packages/toolkit/components/agent-terminal/terminal-controller.js
```

If the worktree is dirty before you create your branch, stop and report the
dirty paths. If `HEAD` does not match `origin/main`, stop and report the
mismatch.

If `./aos ready` reports a repo-mode Accessibility, Input Monitoring, or
inactive input-tap blocker, run:

```bash
.docks/gdi/scripts/human-needed-tcc-reset
```

Then stop with `human_needed`. The human is not present for this sleep run, so
do not spin on permission recovery.

## Git Instructions

After startup passes:

```bash
git switch -C main origin/main
git checkout -b gdi/toolkit-surface-clipboard-write-and-text-ux-baseline-v0
```

If that local branch already exists, stop and report the ambiguity instead of
rebasing or overwriting it.

When verification passes, commit locally with a scoped message. Do not push.
Stage only explicit changed paths; do not use `git add .`.

## Verification

Run the verification required by
`docs/design/work-cards/toolkit-surface-clipboard-write-and-text-ux-baseline-v0.md`.
Expected minimum:

```bash
./aos dev build
node --test tests/toolkit/runtime-canvas.test.mjs
node --test tests/renderer/agent-terminal-terminal-controller.test.mjs
node --test tests/renderer/agent-terminal-chrome.test.mjs
git diff --check
```

If `./aos dev recommend` identifies additional focused tests for changed Sigil
or toolkit surfaces, run those too.

Run live smoke only when `./aos ready` is green and the smoke can be done
boundedly without external publication. If live smoke is not safe unattended,
skip it and state the exact remaining manual check.

## Hard Boundaries

- Do not push any branch.
- Do not merge to `main`.
- Do not open PRs or mutate GitHub issues/projects.
- Do not redesign `./aos ready`, status-item startup, Sigil persistent surface
  configuration, or daemon warmup policy.
- Do not implement rich clipboard formats, image clipboard, file promises, or
  clipboard history.
- Do not read provider transcript bodies.
- Do not mutate provider stores, catalogs, telemetry, gateway/dock runtime,
  Codex configuration, dock profiles, hooks, or `.docks` role instructions.
- Do not route follow-up work.

## Completion Report Required

Return:

- classification: complete, partial, human_needed, or blocked;
- branch and head SHA;
- base/start SHA;
- files changed;
- commit SHA if committed locally;
- exact `clipboard.write` request/response shape implemented;
- runtime helper name and behavior;
- surfaces moved to native-backed copy path;
- text selection/key-handler audit summary, including blockers left as
  follow-up;
- verification commands and results;
- live smoke result or exact reason skipped;
- final `git status --short --branch`;
- explicit statement that no push, PR, GitHub mutation, main mutation,
  external notifier, provider-store mutation, transcript body read, or
  follow-up routing occurred.
