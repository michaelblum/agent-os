# Agent Terminal Provenance Hot Path Correction V0

## Recipient

GDI

## Transfer Kind

Correction round

## Tracker

Source implementation under review:

- commit: `d0b52ac53c5af466207da05aef828dffbcbb4c85`
- source card:
  `docs/design/work-cards/agent-terminal-session-boundary-provenance-v0.md`

Foreman review finding:

- `scripts/aos-provenance-ledger.mjs:408-412` appends an Agent Terminal
  provenance event and then calls `materializeSummariesForEvents`.
- `materializeSummariesForEvents` at `scripts/aos-provenance-ledger.mjs:656-668`
  reads all raw events for the dock/date set and rewrites daily summary files.
- The Agent Terminal call sites include input delivery paths such as
  `packages/toolkit/components/agent-terminal/terminal-session-manager.mjs:429-502`.
  That makes input/session accounting do unbounded ledger traversal and summary
  rewrites in the hot path.

Tests passed, so this is not a functional failure. It is an acceptance failure
against the collection-budget contract: collection must stay cheap mechanical
accounting, bounded, and append-oriented.

## Branch / Base

- branch_from: `gdi/aos-dock-run-provenance-ledger-v0`
- required_start_ref: `d0b52ac53c5af466207da05aef828dffbcbb4c85`
- output branch expectation: continue on `gdi/aos-dock-run-provenance-ledger-v0`
  and add a small correction commit.

## Fresh Context Contract

GDI starts from a fresh context window. Do not assume Foreman chat context beyond
this correction card. Read and rediscover before editing.

## Goal

Remove unbounded summary materialization from the Agent Terminal provenance
recording hot path while preserving the accepted behavior:

- Agent Terminal session and input events still append sanitized raw events.
- `./aos dev provenance summary --json` still reports Agent Terminal counts from
  raw events and retained daily summaries.
- `./aos dev provenance prune --apply` still owns summary materialization needed
  for raw-event retention.

## Read First

- `AGENTS.md`
- `.docks/gdi/AGENTS.md`
- `docs/design/work-cards/agent-terminal-session-boundary-provenance-v0.md`
- `scripts/aos-provenance-ledger.mjs`
- `tests/provenance-ledger.sh`
- `packages/toolkit/components/agent-terminal/terminal-session-manager.mjs`
- `packages/toolkit/components/agent-terminal/bridge-observation-routes.mjs`

## Rediscover State

Run:

```bash
git status --short --branch
git log --oneline --decorate -4
```

This is deterministic Node/test work. Do not spend time repairing live AOS
readiness.

## Required Behavior

- `appendAgentTerminalProvenanceEvent` must be append-only, aside from bounded
  sanitization/build work needed to produce one event.
- Do not call `materializeSummariesForEvents`, `readRawEventsByDate`,
  `readEvents`, `readDailySummaries`, `listFiles`, or equivalent full-ledger
  traversal from Agent Terminal recording paths.
- Do not write daily summary files during Agent Terminal session/input
  recording.
- Summary generation may continue to aggregate raw events at query time.
- Prune apply may continue to materialize summaries before deleting raw events.
- Preserve privacy behavior: no raw input text, `utf8_hex`, terminal output, or
  provider transcripts in provenance records.

## Suggested Implementation

- Remove the `materializeSummariesForEvents({ ...options, dock: event.dock })`
  call from `appendAgentTerminalProvenanceEvent`.
- Add or adjust a deterministic test proving that appending Agent Terminal
  events does not create summary files before an explicit prune/materialization
  path.
- Keep the existing summary assertions so raw-event aggregation remains covered.

## Verification

Run:

```bash
git diff --check
bash tests/provenance-ledger.sh
node --test tests/schemas/aos-dock-provenance-ledger-v0.test.mjs
node --test tests/sigil-agent-terminal-server.test.mjs
node --check scripts/aos-provenance-ledger.mjs
node --check packages/toolkit/components/agent-terminal/terminal-session-manager.mjs
node --check packages/toolkit/components/agent-terminal/bridge-observation-routes.mjs
```

## Completion Report

Report:

- changed paths;
- exact hot-path behavior changed;
- test evidence;
- whether any Agent Terminal record path still traverses or rewrites summaries;
- current branch/head;
- unrelated dirty or untracked state left in the worktree.
