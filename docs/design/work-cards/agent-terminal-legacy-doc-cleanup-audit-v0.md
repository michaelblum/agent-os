# Agent Terminal Legacy Doc Cleanup Audit V0

## Recipient

Implementer

## Transfer Kind

Implementer round

## Fresh Context Contract

Implementer starts from a fresh context window. Do not assume branch, worktree, daemon,
canvas, issue, or prior implementation state. Read and rediscover before
editing.

## Goal

Perform a deliberate legacy-doc cleanup audit after the Agent Terminal bridge env
hard cutover. Update current docs so they teach the canonical
`AGENT_TERMINAL_*` toolkit bridge contract and historical file-path shim shape,
while preserving old work-card/manual-receipt evidence where it is clearly
historical.

This comes before the broader Agent Terminal/toolkit roadmap. Do not start the
roadmap in this slice.

## Branch / Base

- branch_from: `origin/main`
- required_start_ref: `origin/main` at
  `a0171375018401cf2ed71182ae2aa6ffe07faa67` or later with this work card
- output_branch: `implementer/agent-terminal-legacy-doc-cleanup-audit-v0`

## Read First

- `AGENTS.md`
- `docs/design/notes/pre-release-canonical-naming-policy-2026-05-23.md`
- `docs/design/work-cards/toolkit-agent-terminal-neutral-bridge-env-hard-cutover-correction-v0.md`
- `docs/api/toolkit/components.md`
- `docs/dev/reports/toolkit-surface-audit.md`
- `docs/design/aos-surface-stack-v0-integration-ledger.md`
- `docs/design/aos-panel-window-placement-contract.md`
- `docs/design/notes/afk-provider-neutral-dispatch-shape-2026-05-21.md`
- `docs/design/notes/afk-provider-session-observability-map-2026-05-22.md`
- `docs/design/notes/afk-bridge-provider-launch-visibility-diagnosis-2026-05-22.md`

## Rediscover State

Run before editing:

```bash
git status --short --branch
git rev-parse HEAD origin/main
```

This slice is docs-only and deterministic. Do not run `./aos ready`; live proof
is not required.

## Audit Commands

Run and use these to classify the cleanup surface:

```bash
rg "SIGIL_AGENT_|SIGIL_CODEX_|CODEX_COMMAND|SIGIL_AGENT_PTY_CHILD_PID" docs -n
rg "codex-terminal|Codex terminal|Sigil/Codex terminal" docs -n
```

Do not treat every hit as a cleanup target. Many work cards and manual receipts
are historical artifacts.

## Required Behavior

1. Create a concise audit note.

   Add a dated note under `docs/design/notes/`, for example:

   - `docs/design/notes/agent-terminal-legacy-doc-cleanup-audit-2026-05-23.md`

   The note should summarize:

   - canonical active contract: `AGENT_TERMINAL_*`;
   - historical path-shim contract: `apps/sigil/codex-terminal/*` may remain as
     clearly historical compatibility entrypoints;
   - obsolete env names removed from active code/tests:
     `SIGIL_AGENT_*`, `SIGIL_CODEX_*`, `CODEX_COMMAND`, and
     `SIGIL_AGENT_PTY_CHILD_PID`;
   - classification of remaining doc hits into current docs, superseded work
     cards, historical/manual receipts, and future roadmap candidates.

2. Update current docs that teach the active contract.

   Current docs should not say or imply that:

   - `apps/sigil/agent-terminal/` delegates through the old
     `apps/sigil/codex-terminal/` implementation;
   - `SIGIL_AGENT_*`, `SIGIL_CODEX_*`, `CODEX_COMMAND`, or
     `SIGIL_AGENT_PTY_CHILD_PID` are active bridge env names;
   - `apps/sigil/codex-terminal/server.mjs` owns the bridge implementation
     rather than delegating to the toolkit bridge server.

   Likely current-doc cleanup targets include:

   - `docs/api/toolkit/components.md`
   - `docs/dev/reports/toolkit-surface-audit.md`
   - `docs/design/aos-surface-stack-v0-integration-ledger.md`
   - `docs/design/aos-panel-window-placement-contract.md`
   - the three AFK observability/dispatch notes listed under Read First

   Update only the lines needed to make current behavior clear.

3. Treat historical work cards carefully.

   Do not rewrite old work-card requirements wholesale. If a work card is
   superseded and still teaches the wrong active contract, prefer adding or
   preserving a short superseded/historical note over editing its old requested
   commands. The existing superseded alias card is an example of an acceptable
   historical artifact.

4. Treat manual receipts as evidence.

   Manual receipts that quote commands actually run in the past may remain with
   the old env names. If a receipt is likely to be copied as a current command,
   add a brief note that the command reflects historical evidence and that the
   current bridge env contract is `AGENT_TERMINAL_*`. Do not spend large effort
   rewriting old receipts.

5. Do not perform roadmap planning in this slice.

   If the audit reveals broader Agent Terminal/toolkit roadmap items, list them
   as candidates in the audit note and completion report. Do not create the
   roadmap work card unless Foreman routes it after review.

## Hard Boundaries

- Docs-only unless a tiny test/docs reference update is required to keep the
  docs honest.
- Do not change code behavior.
- Do not launch or drive live Codex, Claude, tmux, AOS canvases, or providers.
- Do not read provider transcript bodies.
- Do not mutate provider configs, keymaps, stores, catalogs, telemetry,
  gateway/dock runtime, GitHub state, or unrelated Sigil renderer code.
- Do not remove historical file-path compatibility docs solely because they
  mention `apps/sigil/codex-terminal/`.
- Do not remove or relax `--i-am-present`.

## Verification

Run:

```bash
rg "SIGIL_AGENT_|SIGIL_CODEX_|CODEX_COMMAND|SIGIL_AGENT_PTY_CHILD_PID" docs -n
rg "codex-terminal|Codex terminal|Sigil/Codex terminal" docs -n
git diff --check
```

Report how remaining hits are classified. If you add a lightweight docs
assertion or script, run it and report the exact command.

## Completion Report

Report:

- branch and head SHA;
- base SHA;
- files changed;
- audit note path;
- current docs updated;
- remaining legacy env-name hits and their classification;
- remaining `codex-terminal` hits and their classification;
- whether any docs still teach obsolete env names as active contract;
- verification commands and pass/fail results;
- local-only state;
- recommended next slice for the broader Agent Terminal/toolkit roadmap.
