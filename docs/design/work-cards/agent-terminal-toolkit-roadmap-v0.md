# Agent Terminal Toolkit Roadmap V0

## Recipient

GDI

## Transfer Kind

GDI round

## Fresh Context Contract

GDI starts from a fresh context window. Do not assume branch, worktree, daemon,
canvas, issue, or prior implementation state. Read and rediscover before
editing.

## Goal

Write the broader Agent Terminal/toolkit roadmap after the legacy-doc cleanup
audit. The roadmap should summarize the accepted current state, identify the
remaining decision tracks, and recommend the next concrete slice. This is a
planning-only round; do not implement provider-launch, catalog, bridge, launcher,
or UI behavior.

## Branch / Base

- branch_from: `origin/main`
- required_start_ref: `origin/main` at
  `f62fa5e1d0bdfba867c52ecbe78804cafbcb51d5` or later containing this work
  card
- output_branch: `gdi/agent-terminal-toolkit-roadmap-v0`

## Read First

- `AGENTS.md`
- `docs/design/notes/pre-release-canonical-naming-policy-2026-05-23.md`
- `docs/design/notes/agent-terminal-legacy-doc-cleanup-audit-2026-05-23.md`
- `docs/api/toolkit/components.md`
- `docs/dev/reports/toolkit-surface-audit.md`
- `docs/design/notes/afk-bridge-provider-launch-visibility-diagnosis-2026-05-22.md`
- `docs/design/notes/afk-provider-neutral-dispatch-shape-2026-05-21.md`
- `docs/design/notes/afk-provider-session-observability-map-2026-05-22.md`
- `docs/design/work-cards/toolkit-agent-terminal-foundation-v0.md`
- `docs/design/work-cards/toolkit-agent-terminal-bridge-client-v0.md`
- `docs/design/work-cards/toolkit-agent-terminal-session-rail-model-v0.md`
- `docs/design/work-cards/toolkit-agent-terminal-session-rail-view-v0.md`
- `docs/design/work-cards/toolkit-agent-terminal-session-inspector-model-v0.md`
- `docs/design/work-cards/toolkit-agent-terminal-session-inspector-view-v0.md`
- `docs/design/work-cards/toolkit-agent-terminal-terminal-controller-v0.md`
- `docs/design/work-cards/toolkit-agent-terminal-bridge-server-substrate-v0.md`
- `docs/design/work-cards/sigil-agent-terminal-launcher-compatibility-inversion-v0.md`
- `docs/design/work-cards/toolkit-agent-terminal-neutral-bridge-env-hard-cutover-correction-v0.md`
- `docs/design/work-cards/agent-terminal-legacy-doc-cleanup-audit-v0.md`

Use search after reading these files to find adjacent accepted notes or work
cards if the roadmap needs a precise fact. Do not bulk-rewrite old historical
cards.

## Rediscover State

Run before editing:

```bash
git status --short --branch
git rev-parse HEAD origin/main
```

This slice is docs-only and deterministic. Do not run `./aos ready`; live proof
is not required.

## Required Output

Create a dated roadmap note under `docs/design/notes/`, for example:

- `docs/design/notes/agent-terminal-toolkit-roadmap-2026-05-23.md`

The note should be concise enough to stay useful as a coordination artifact. It
must include these sections or equivalent content:

1. Current accepted state.

   Summarize that the toolkit now owns the Agent Terminal frontend modules,
   bridge client, bridge server, session inspector server, PTY proxy, and
   canonical launcher path. State that Sigil/Codex historical file-path shims
   are compatibility entrypoints only, and that `AGENT_TERMINAL_*` is the active
   bridge env contract.

2. Decision principles.

   Carry forward the pre-release naming rule: clean canonical contracts win
   unless a break blocks current development today. Keep path shims only when
   they reduce immediate operator friction and have a clear retirement gate.

3. Roadmap tracks.

   Cover at least these tracks:

   - provider-launch acceptance visibility before catalog match;
   - catalog and telemetry enrichment after launch-side acceptance exists;
   - wrapper health/live verification boundaries;
   - retirement criteria for historical `apps/sigil/codex-terminal/*` file-path
     shims;
   - frontend/toolkit Agent Terminal follow-ups that remain after the view,
     model, controller, and bridge extractions.

4. Prioritized next slices.

   Identify the smallest next one to three reversible slices. The first slice
   should be the provider-launch acceptance visibility decision/fixture before
   catalog matching, unless your review finds a stronger blocker. For each
   slice, state owner, goal, deterministic evidence, non-goals, and why it comes
   before or after catalog work.

5. Shim retirement gate.

   Define what evidence would make it safe to remove or stop advertising
   `apps/sigil/codex-terminal/*` file-path shims. Keep this as a future
   criterion; do not remove shims in this round.

6. Open questions.

   List only questions that would change the next slice. Avoid generic backlog
   items.

## Hard Boundaries

- Docs/planning only.
- Do not change code, tests, launchers, provider configs, gateway state, dock
  profiles, hooks, GitHub issues, PRs, release state, or runtime artifacts.
- Do not launch or drive Codex, Claude, Gemini, tmux, AOS canvases, or live
  providers.
- Do not read provider transcript bodies.
- Do not implement the provider-launch acceptance fixture in this slice.
- Do not create or route the next work card. Recommend it in the roadmap note
  and completion report so Foreman can review and route.
- Do not reintroduce broad compatibility aliases or describe obsolete bridge
  env names as active contracts.
- Do not spend time rewriting old receipt evidence unless it is necessary to
  avoid teaching the wrong active contract in the new roadmap note.

## Verification

Run:

```bash
git diff --check
rg "AGENT_TERMINAL_" docs/design/notes/agent-terminal-toolkit-roadmap-2026-05-23.md
if rg "SIGIL_AGENT_|SIGIL_CODEX_|CODEX_COMMAND|SIGIL_AGENT_PTY_CHILD_PID" docs/design/notes/agent-terminal-toolkit-roadmap-2026-05-23.md; then exit 1; fi
```

If you choose a different roadmap note filename, substitute that path in the
commands. If the final command prints a match, either remove the active-contract
wording or explicitly justify the historical mention in the completion report.

## Completion Report

Report:

- branch and head SHA;
- base SHA;
- files changed;
- roadmap note path;
- current accepted state summarized in one paragraph;
- prioritized next slices;
- recommended immediate next work-card title and scope;
- any old-contract wording intentionally preserved and why;
- verification commands and pass/fail results;
- local-only state;
- blockers or decisions requiring Foreman/human judgment.
