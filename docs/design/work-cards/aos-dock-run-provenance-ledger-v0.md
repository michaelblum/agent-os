# AOS Dock Run Provenance Ledger V0

## Recipient

GDI

## Transfer Kind

GDI round

## Tracker

User concern:

> do we have telemetry to keep an eye on compliance with test harnesses and stuff? I think we're going to need to have some kind of accounting of token use, tool calls, anything we can collect cheaply and deterministically to measure performance over time per dock, task, etc. provence i think it's called.

Correction: the intended term is provenance.

Relevant accepted prerequisite on this branch:

- `c9b4f229 test(aos): isolate Sigil visual harness helpers`
- `648a8b36 docs(sigil): require split harness helpers for trail correction`

## Branch / Base

- branch_from: `gdi/selection-mode-cursor-ancestor-ladder-v0`
- required_start_ref: branch commit containing this card. Foreman dispatch must include the exact start commit.

## Fresh Context Contract

GDI starts from a fresh context window. Do not assume branch, worktree, daemon, provider transcript, dock state, or prior implementation state. Read and rediscover before editing.

## Goal

Create the smallest useful AOS provenance/accounting primitive for dock work:

- capture cheap sanitized per-dock tool-use/run events deterministically;
- summarize tool calls, shell/AOS command usage, elapsed accounting, token telemetry when available, and harness compliance signals;
- make the summary accessible through AOS, not ad-hoc log spelunking;
- keep the hot path lightweight, bounded, and safe for hooks.

The target outcome is not a full observability product. It is a V0 ledger that lets Foreman ask, per dock/session/task: what tools ran, which recommended test batteries were expected versus observed, how much token context was consumed when provider data is available, and what compliance gaps are visible from deterministic data.

## Read First

- `AGENTS.md`
- `.docks/foreman/AGENTS.md`
- `.docks/harness/post-tool-use-runner.sh`
- `.docks/harness/dock-hook-runner.sh`
- `.docks/*/hooks/post-tool-use.sh`
- `.docks/*/hooks/stop.sh`
- `.docks/dock-defaults.json`
- `.docks/gdi/dock.json`
- `.docks/operator/dock.json`
- `.docks/foreman/dock.json`
- `scripts/aos-dev-workflow.mjs`
- `tests/dev-workflow-router.sh`
- `tests/dev-audit.sh`
- `tests/README.md`
- `docs/guides/test-harness-ladder-and-prep.md`
- `packages/host/src/session-telemetry.ts`
- `shared/schemas/agent-session-telemetry.schema.json`
- `packages/toolkit/components/agent-terminal/session-inspector-server.mjs`
- `shared/schemas/aos-work-record-v0.schema.json`
- `packages/toolkit/workbench/work-record-capture.js`

## Rediscover State

Run:

```bash
git status --short --branch
git worktree list --porcelain
./aos status --json
./aos dev recommend --json --files .docks/harness/post-tool-use-runner.sh scripts/aos-dev-workflow.mjs packages/host/src/session-telemetry.ts
```

If live readiness is not needed for the deterministic slice, do not spend time repairing live runtime state. This card is primarily hook, schema, and command-surface work.

## Existing Pieces To Preserve

- `./aos dev recommend --json` already owns expected deterministic batteries for changed files.
- `./aos introspect review --json` records some AOS command usage, but it is narrow and may be empty for dock/provider work.
- `packages/host/src/session-telemetry.ts` already extracts Codex/Claude context-token snapshots from provider transcript/statusline sources.
- `.docks/harness/post-tool-use-runner.sh` already receives post-tool-use payloads and recognizes selected command lifecycle events.
- `.docks/harness/dock-hook-runner.sh` already receives stop payloads and is a bounded hook path.
- `shared/schemas/aos-work-record-v0.schema.json` is a durable evidence/provenance shape, but it is too heavy for every hook event. Treat it as a later export target, not the V0 hot path.

## Required Behavior

### Event Ledger

Add a small append-only JSONL ledger for dock run provenance.

Requirements:

- Store runtime data outside tracked source files, under the repo AOS state area. Prefer the same state-root conventions used by existing AOS state helpers, such as `~/.config/aos/repo/...`.
- Partition by repo and dock, with enough identity to distinguish sessions or runs when the provider hook payload supplies it.
- Append bounded, sanitized records from dock hooks. Hook failures must never break the provider flow.
- Accept malformed, empty, or unknown hook payloads and record at most a diagnostic event or skip cleanly.
- Do not persist full prompts, completion text, shell output, provider transcripts, secrets, environment dumps, or arbitrary raw JSON payloads by default.
- For command events, persist stable cheap metadata such as:
  - observed_at;
  - dock;
  - phase;
  - provider/tool name when available;
  - command kind: shell, aos, git, github, slack, unknown;
  - normalized allowlisted command summary for repo commands;
  - argv or command hash when the command is not allowlisted;
  - exit status/success when available;
  - duration when available;
  - output byte count/hash when available, not output text.
- For stop/session events, record a summary event if the hook payload provides enough signal.

### Token Telemetry

Token usage must be evidence-based, not estimated by the model.

Requirements:

- Reuse existing session telemetry extraction where possible.
- If provider transcript or statusline source cannot be found from available hook/session context, record `unknown` with a diagnostic reason.
- When available, report start/end/latest context-token metrics and deltas using source precision from the existing telemetry model.
- Do not parse or store transcript text outside the existing extractor path.

### Harness Compliance

Provide a deterministic compliance summary that compares expected versus observed verification commands.

Requirements:

- Use `./aos dev recommend --json` or the underlying dev-workflow module as the source of expected batteries.
- Summarize observed commands from the ledger.
- Report:
  - changed files or explicit files/base used for recommendation;
  - recommended command list;
  - observed matching commands;
  - missing recommended commands;
  - extra notable commands;
  - failed commands;
  - raw lower-level bypass signals when detectable, for example direct `curl` to daemon endpoints or direct `tmux` control in a live AOS task.
- Keep the comparison deterministic. Do not infer from pasted completion-report prose.

### AOS Surface

Expose the summary through AOS.

Preferred shape:

```bash
./aos dev provenance summary --json
./aos dev provenance audit --json --files <paths...>
```

If the existing `./aos dev` command parser makes a nested subcommand too broad for this slice, add the narrowest AOS-accessible equivalent and document the exact follow-up to move it under `./aos dev provenance`.

The command must support fixture/state-root overrides so tests do not read or write the real user ledger.

### Privacy / Safety

Make the default capture intentionally low-content.

Requirements:

- No raw prompts.
- No full shell output.
- No provider transcript copy.
- No secret-bearing environment capture.
- Hash unknown commands or sensitive arguments rather than storing them verbatim.
- Use allowlisted verbatim command summaries only for repo-local deterministic commands where the command itself is useful for compliance, such as `./aos dev recommend ...`, `node --test ...`, `bash tests/...`, `git diff --check`, and `./aos ready ...`.

## Scope

Owned areas:

- dock hook harness;
- AOS dev workflow command surface;
- provider session telemetry adapter reuse;
- deterministic tests and schemas/docs for the new provenance primitive.

## Hard Boundaries / Non-Goals

- Do not implement a dashboard.
- Do not make Work Record generation the hot path.
- Do not record full prompts, full outputs, raw provider transcripts, or large payloads.
- Do not require live AOS runtime readiness for deterministic validation.
- Do not mutate GitHub, push, or open PRs.
- Do not resume Sigil Selection Mode, interdimensional trail, or visual harness feature work from adjacent cards.
- Do not add broad dependencies or a background daemon.

## Suggested Implementation Areas

GDI should inspect first, then choose the narrow layer. Likely areas:

- A small shared recorder module or script under `scripts/` or `.docks/harness/`.
- A schema under `shared/schemas/` for the compact event/summary shape.
- Hook calls from `.docks/harness/post-tool-use-runner.sh` and possibly `.docks/harness/dock-hook-runner.sh`.
- A read-only AOS command branch in `scripts/aos-dev-workflow.mjs`, or the nearest canonical command surface if this file delegates elsewhere.
- Focused tests with fixture hook payloads and fixture ledgers.

## Verification

Run the deterministic recommendation first and include it in the completion report:

```bash
./aos dev recommend --json --files .docks/harness/post-tool-use-runner.sh .docks/harness/dock-hook-runner.sh scripts/aos-dev-workflow.mjs packages/host/src/session-telemetry.ts
```

Expected focused verification should include the new tests plus existing command-surface tests, for example:

```bash
git diff --check
bash tests/dev-workflow-router.sh
bash tests/dev-audit.sh
node --test tests/schemas/agent-session-telemetry.test.mjs
```

Add and run focused tests for:

- valid post-tool-use payload produces a bounded sanitized event;
- malformed payload does not fail the hook;
- unknown/sensitive command stores hash/summary, not raw text;
- allowlisted deterministic commands are visible enough for compliance matching;
- provenance summary reports expected/observed/missing command batteries from fixtures;
- token telemetry reports exact/derived data when fixture transcript context exists and `unknown` with diagnostics otherwise;
- hook write path respects fixture state-root override.

If live AOS readiness is unexpectedly required and `./aos ready` reports a repo-mode TCC/input-tap blocker, stop and use:

```bash
.docks/gdi/scripts/human-needed-tcc-reset
```

Then after the human returns with `finished`:

```bash
./aos ready --post-permission
```

## Completion Report

Report:

- files changed;
- schema/command names added;
- where ledger files are written by default and how tests override that location;
- privacy decisions for captured fields;
- exact verification commands and pass/fail results;
- a sample summarized JSON object or key fields from fixture output;
- whether token telemetry is exact, derived, or unknown for fixture and live cases;
- local-only state, including any generated fixture ledgers;
- remaining follow-up slice if V0 did not include the preferred `./aos dev provenance ...` shape.
