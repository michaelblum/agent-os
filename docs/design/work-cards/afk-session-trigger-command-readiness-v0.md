# Work Card: AFK Session Trigger Command Readiness V0

**Status:** Accepted 2026-05-22

## Transfer Classification

- Recipient: Implementer
- Transfer kind: Implementer round
- Single next goal: produce a docs-only command-readiness note that decides the
  first implementable session trigger/dispatch command contract after the live
  `./aos dev afk-launch-attempt` wrapper proof.
- Source artifacts:
  - `docs/design/durable-agent-cognition-and-afk-primitives.md`
  - `docs/design/notes/afk-transfer-packet-result-route-shape-2026-05-21.md`
  - `docs/design/notes/afk-session-trigger-scheduler-shape-2026-05-21.md`
  - `docs/design/notes/afk-provider-neutral-dispatch-shape-2026-05-21.md`
  - `docs/design/notes/afk-design-consolidation-readiness-2026-05-21.md`
  - `docs/design/work-cards/afk-dev-launch-attempt-command-v0.md`
  - `docs/design/work-cards/operator-afk-dev-launch-attempt-command-live-wrapper-v0.md`
- Required start ref: `docs/durable-agent-cognition-v0`
- Branch/output expectation: create a scoped local output branch from
  `docs/durable-agent-cognition-v0`. A suitable branch name is
  `implementer/afk-session-trigger-command-readiness-v0`. Keep the checkpoint local; do
  not push, open a PR, mutate GitHub, or publish externally.

## Tracker

- Workstream:
  `docs/design/durable-agent-cognition-and-afk-primitives.md`
- Accepted live wrapper proof:
  `docs/design/work-cards/operator-afk-dev-launch-attempt-command-live-wrapper-v0.md`
- Target output note:
  `docs/design/notes/afk-session-trigger-command-readiness-2026-05-22.md`

## Fresh Context Contract

Implementer starts from a fresh context window. Do not assume branch, worktree, daemon,
provider session, bridge process, Codex transcript, prior launch evidence, or
final command spelling. Read and rediscover before editing.

## Goal

Create a docs-only readiness note that answers this specific question:

```text
After the accepted live launch-attempt wrapper proof, what is the first
implementable AOS session trigger/dispatch command contract, and what exact
source slice should or should not be implemented next?
```

The note must not implement the command. It should freeze enough of the
contract for Foreman to route the next source slice without re-litigating
packet, scheduler, dispatch, provider, result-route, and live-proof ownership.

## Read First

- `AGENTS.md`
- the implementer native subagent instructions
- `docs/design/durable-agent-cognition-and-afk-primitives.md`
- `docs/design/notes/afk-transfer-packet-result-route-shape-2026-05-21.md`
- `docs/design/notes/afk-session-trigger-scheduler-shape-2026-05-21.md`
- `docs/design/notes/afk-provider-neutral-dispatch-shape-2026-05-21.md`
- `docs/design/notes/afk-design-consolidation-readiness-2026-05-21.md`
- `docs/design/notes/afk-launch-attempt-record-shape-2026-05-22.md`
- `docs/design/work-cards/afk-dev-launch-attempt-command-v0.md`
- `docs/design/work-cards/operator-afk-dev-launch-attempt-command-live-wrapper-v0.md`
- `src/commands/dev.swift`
- `src/shared/command-registry-data.swift`

## Rediscover State

Run:

```bash
git status --short --branch
git rev-parse HEAD docs/durable-agent-cognition-v0
./aos dev recommend --json --paths docs/design/durable-agent-cognition-and-afk-primitives.md,docs/design/notes/afk-session-trigger-scheduler-shape-2026-05-21.md,docs/design/notes/afk-provider-neutral-dispatch-shape-2026-05-21.md,docs/design/notes/afk-design-consolidation-readiness-2026-05-21.md,docs/design/work-cards/afk-dev-launch-attempt-command-v0.md,docs/design/work-cards/operator-afk-dev-launch-attempt-command-live-wrapper-v0.md
```

This is a docs-only slice. Do not run live provider sessions. `./aos ready` is
not required unless you choose to run it as a quick environment sanity check.
If a live readiness check is attempted and reports repo-mode TCC/input-tap
blockers, use:

```bash
the manual TCC blocker report path
```

Then stop with `manual_intervention` instead of retrying live checks.

## Required Readiness Decisions

The note must make these decisions explicit:

1. Whether the next source command should use a final `aos session ...`
   spelling now, remain under `./aos dev ...`, or use another explicitly
   experimental surface.
2. Whether the first implementation is dry-run-only, fixture-backed, supervised
   live-capable, or allowed to launch a provider automatically.
3. Which boundary owns each first-slice responsibility:
   - packet resolution and validation;
   - scheduler run id, idempotence key, lease, and lifecycle state;
   - provider-neutral dispatch attempt id and selected action;
   - dock launch-root resolution;
   - terminal substrate facts;
   - provider catalog/Codex adapter correlation;
   - result-route updates;
   - work/evidence receipt output.
4. The minimum required inputs and flags for the first source slice.
5. The output record or receipt shape for the first source slice, including
   status vocabulary and mismatch/error classes.
6. What existing `./aos dev afk-launch-attempt` behavior should be reused,
   referenced, or kept separate.
7. The exact hard boundary that prevents unattended provider launch until it is
   deliberately allowed by a later source card.
8. The next source work card Foreman should route after accepting this note:
   title, likely files, behavior, verification, and stop conditions.

## Expected Output

Add:

- `docs/design/notes/afk-session-trigger-command-readiness-2026-05-22.md`

Update only if needed:

- `docs/design/durable-agent-cognition-and-afk-primitives.md`

The note should include:

- context from the accepted live wrapper proof;
- decision table for command surface and launch policy;
- first implementable command contract;
- input and output summary;
- safety/non-goals;
- verification plan for the next source slice;
- a recommended next work-card title and one-paragraph goal.

## Hard Boundaries

- Do not implement source behavior.
- Do not add or modify schemas.
- Do not launch Codex, Claude, Gemini, tmux, process sessions, provider
  terminals, or live bridges.
- Do not mutate provider config, provider session files, provider transcripts,
  provider catalogs, telemetry stores, gateway jobs, dock profiles, hooks, or
  `.docks` role instructions.
- Do not read real `~/.codex` transcripts; the accepted Operator report is the
  live evidence source for this slice.
- Do not push, open a PR, mutate GitHub issues, or publish externally.
- Do not create a Researcher dock.
- Do not turn this into a broad rewrite of the AFK notes.

## Verification

Required:

```bash
git diff --check
./aos dev recommend --json --paths docs/design/notes/afk-session-trigger-command-readiness-2026-05-22.md,docs/design/durable-agent-cognition-and-afk-primitives.md
```

If the recommendation names docs-only/manual inspection only, report that. If
it recommends a deterministic docs or schema check because of the files you
changed, run the smallest relevant check or explain why it is not applicable.

## Completion Report

Report:

- branch and head SHA;
- files changed;
- the command surface decision;
- launch policy decision;
- the first implementable source slice recommendation;
- any unresolved product/architecture decisions that require Foreman or human
  judgment;
- checks run and exact results;
- confirmation that no source behavior, schema, provider files, gateway state,
  dock profiles/hooks, GitHub state, push, or PR changed.

## Foreman Acceptance

Accepted on 2026-05-22 at Implementer commit
`fe1cef33aab1e49480c5f3d2968de7a8efd6d115`.

Review summary:

- Scope matched the card: the output was docs-only, added
  `docs/design/notes/afk-session-trigger-command-readiness-2026-05-22.md`,
  and updated the durable AFK tracker pointer.
- The note explicitly keeps the first source surface under experimental
  `./aos dev afk-session-trigger`, not final `aos session ...` spelling.
- The launch policy is dry-run-only and disallows unattended provider launch,
  provider terminal startup, live bridge startup, gateway mutation, schemas, and
  real provider transcript reads.
- The next source slice is concrete enough to route as
  `docs/design/work-cards/afk-dev-session-trigger-dry-run-command-v0.md`.

Foreman verification:

```bash
git diff --check 768e9bd394f7f8564c71f15c7ef37cc50278089a..HEAD
./aos dev recommend --json --paths docs/design/notes/afk-session-trigger-command-readiness-2026-05-22.md,docs/design/durable-agent-cognition-and-afk-primitives.md
./aos dev recommend --json --paths docs/design/work-cards/afk-session-trigger-command-readiness-v0.md,docs/design/notes/afk-session-trigger-command-readiness-2026-05-22.md,docs/design/durable-agent-cognition-and-afk-primitives.md
```

All checks passed. The dev router classified the changed files as docs-only and
recommended docs review with no runtime verification.
