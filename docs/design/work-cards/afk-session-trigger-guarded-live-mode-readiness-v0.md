# Work Card: AFK Session Trigger Guarded Live Mode Readiness V0

**Status:** Routed 2026-05-22

## Transfer Classification

- Recipient: GDI
- Transfer kind: GDI round
- Single next goal: produce a docs-only readiness note that decides whether and
  how `./aos dev afk-session-trigger` may gain a supervised live provider
  launch mode after the accepted dry-run command.
- Source artifacts:
  - `docs/design/notes/afk-session-trigger-command-readiness-2026-05-22.md`
  - `docs/design/work-cards/afk-dev-session-trigger-dry-run-command-v0.md`
  - `docs/design/work-cards/operator-afk-dev-launch-attempt-command-live-wrapper-v0.md`
  - `docs/design/work-cards/operator-afk-launch-attempt-live-codex-record-rerun-v0.md`
  - `docs/design/notes/afk-session-trigger-scheduler-shape-2026-05-21.md`
  - `docs/design/notes/afk-provider-neutral-dispatch-shape-2026-05-21.md`
- Required start ref: `docs/durable-agent-cognition-v0`
- Branch/output expectation: create a scoped local output branch from
  `docs/durable-agent-cognition-v0`. A suitable branch name is
  `gdi/afk-session-trigger-guarded-live-mode-readiness-v0`. Keep the
  checkpoint local; do not push, open a PR, mutate GitHub, or publish
  externally.

## Tracker

- Workstream:
  `docs/design/durable-agent-cognition-and-afk-primitives.md`
- Accepted dry-run command:
  `docs/design/work-cards/afk-dev-session-trigger-dry-run-command-v0.md`
- Target output note:
  `docs/design/notes/afk-session-trigger-guarded-live-mode-readiness-2026-05-22.md`

## Fresh Context Contract

GDI starts from a fresh context window. Do not assume branch, worktree, daemon,
provider session, bridge process, Codex transcript, gateway state, readiness,
or final live-mode spelling. Read and rediscover before editing.

## Goal

Create a docs-only readiness note that answers this specific question:

```text
What exact guard, command contract, receipt shape, and evidence requirements
must exist before ./aos dev afk-session-trigger may perform a supervised live
provider launch, and what source slice should Foreman route next?
```

The note must not implement live launch. It should either recommend a narrow
guarded-live source slice or explicitly defer source work if the evidence
contract is still insufficient.

## Read First

- `AGENTS.md`
- `.docks/gdi/AGENTS.md`
- `docs/design/durable-agent-cognition-and-afk-primitives.md`
- `docs/design/notes/afk-session-trigger-command-readiness-2026-05-22.md`
- `docs/design/notes/afk-session-trigger-scheduler-shape-2026-05-21.md`
- `docs/design/notes/afk-provider-neutral-dispatch-shape-2026-05-21.md`
- `docs/design/notes/afk-design-consolidation-readiness-2026-05-21.md`
- `docs/design/notes/afk-launch-attempt-record-shape-2026-05-22.md`
- `docs/design/work-cards/afk-dev-session-trigger-dry-run-command-v0.md`
- `docs/design/work-cards/operator-afk-dev-launch-attempt-command-live-wrapper-v0.md`
- `docs/design/work-cards/operator-afk-launch-attempt-live-codex-record-rerun-v0.md`
- `scripts/afk-session-trigger-prototype.mjs`
- `scripts/afk-launch-attempt-prototype.mjs`
- `src/commands/dev.swift`
- `src/shared/command-registry-data.swift`

## Rediscover State

Run:

```bash
git status --short --branch
git rev-parse HEAD docs/durable-agent-cognition-v0
./aos ready
./aos dev recommend --json --paths docs/design/durable-agent-cognition-and-afk-primitives.md,docs/design/notes/afk-session-trigger-command-readiness-2026-05-22.md,docs/design/work-cards/afk-dev-session-trigger-dry-run-command-v0.md,scripts/afk-session-trigger-prototype.mjs,src/commands/dev.swift
```

This is a docs-only slice. Do not run live provider sessions. `./aos ready` is
included only because the next workstream step may be live-dependent and
Foreman needs readiness state for routing.

If repo-mode TCC/input-tap readiness blocks, run:

```bash
.docks/gdi/scripts/human-needed-tcc-reset
```

Then stop with `human_needed`. After the human returns with `ready`, run:

```bash
./aos ready --post-permission
```

## Required Readiness Decisions

The note must make these decisions explicit:

1. Whether the live mode should remain under experimental
   `./aos dev afk-session-trigger` or wait for final `aos session ...`
   spelling.
2. The exact live-mode flag shape and guard. The decision must avoid ambiguous
   flags such as bare `--start` and should require explicit human-supervised
   intent.
3. Whether the first live mode may launch only Codex from `.docks/gdi`, or
   should stay provider-neutral with unavailable-provider results for Claude,
   Gemini, or other providers.
4. How the command proves human approval and prevents unattended launch.
5. How duplicate prevention and idempotence should work before and after a
   provider process is started.
6. What cleanup proof is mandatory when the command uses a bridge or terminal
   substrate.
7. What provider-owned transcript/catalog boundaries must be preserved.
8. How the live-mode receipt extends
   `aos.afk_session_trigger_dry_run` without collapsing scheduler intent,
   dispatch attempt, terminal substrate, provider acceptance, Codex adapter
   correlation, result route, and work/evidence receipt ownership.
9. Whether the live command should reuse
   `./aos dev afk-launch-attempt` internally, call the underlying prototype, or
   share lower-level helpers in a later refactor.
10. The next source work card Foreman should route after accepting this note:
    title, likely files, behavior, verification, live/Operator evidence, and
    stop conditions.

## Expected Output

Add:

- `docs/design/notes/afk-session-trigger-guarded-live-mode-readiness-2026-05-22.md`

Update only if needed:

- `docs/design/durable-agent-cognition-and-afk-primitives.md`

The note should include:

- context from the accepted dry-run command and live launch-attempt wrapper
  proof;
- command surface decision;
- explicit human-supervised launch gate;
- first live-mode provider/dock scope;
- receipt extension sketch;
- duplicate/idempotence and cleanup rules;
- provider transcript/catalog boundary;
- verification and Operator evidence plan for the next source slice;
- recommended next work-card title and one-paragraph goal.

## Hard Boundaries

- Do not implement source behavior.
- Do not add or modify schemas.
- Do not launch Codex, Claude, Gemini, tmux, process sessions, provider
  terminals, or live bridges.
- Do not mutate provider config, provider session files, provider transcripts,
  provider catalogs, telemetry stores, gateway jobs, dock profiles, hooks, or
  `.docks` role instructions.
- Do not read real `~/.codex` transcripts; use accepted work-card summaries as
  the live evidence source for this docs slice.
- Do not push, open a PR, mutate GitHub issues, or publish externally.
- Do not create a Researcher dock.
- Do not turn this into a broad AFK rewrite or a final schema proposal.

## Verification

Required:

```bash
git diff --check
./aos dev recommend --json --paths docs/design/notes/afk-session-trigger-guarded-live-mode-readiness-2026-05-22.md,docs/design/durable-agent-cognition-and-afk-primitives.md
```

If the recommendation names docs-only/manual inspection only, report that. If
it recommends a deterministic docs or schema check because of the files you
changed, run the smallest relevant check or explain why it is not applicable.

## Completion Report

Report:

- branch and head SHA;
- files changed;
- command surface decision;
- live-mode guard decision;
- provider/dock scope decision;
- duplicate/idempotence and cleanup requirements;
- the first implementable guarded-live source slice recommendation, or the
  reason source work remains deferred;
- any unresolved product/architecture decisions for Foreman or human judgment;
- checks run and exact results;
- `./aos ready` result;
- confirmation that no source behavior, schema, provider files, gateway state,
  dock profiles/hooks, GitHub state, push, PR, or live provider launch changed.
