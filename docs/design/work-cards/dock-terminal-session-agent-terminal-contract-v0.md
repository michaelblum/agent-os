# Dock Terminal Session Agent Terminal Contract v0

## Recipient

Implementer

## Transfer Kind

Implementer round

## Goal

Design the reversible AOS dock terminal session and Agent Terminal headful
observability contract so AFK, humans, and Agent Terminal share one dock-owned
PTY substrate.

The product direction is:

- AOS owns dock terminal sessions.
- Agent Terminal renders them as the headful surface.
- AFK uses the same PTY input path the human would use.
- Provider acceptance still comes from structured evidence, not visual scraping.

This is a design/contract slice. Do not run Operator live proof and do not start
async result routing.

## Branch / Base

- branch_from: current local
  `implementer/afk-dock-native subagent prompt contract-missing-provider-correction-v0` routing head
- required_start_ref: current local
  `implementer/afk-dock-native subagent prompt contract-missing-provider-correction-v0` routing head
- accepted_source_head: `76e341c93bad31461cdbe786b176b8013e5bd7aa`
- expected_output_branch: `implementer/dock-terminal-session-agent-terminal-contract-v0`

## Read First

- `apps/sigil/codex-terminal/server.mjs`
- `apps/sigil/codex-terminal/index.html`
- `apps/sigil/codex-terminal/pty-proxy.py`
- `apps/sigil/agent-terminal/index.html`
- `tests/sigil-agent-terminal-server.test.mjs`
- `tests/renderer/agent-terminal-chrome.test.mjs`
- `scripts/afk-launch-attempt-prototype.mjs`
- `scripts/afk-session-trigger-prototype.mjs`
- `shared/schemas/aos-dock-inbound-message-contract-v0.md`
- `.docks/AGENTS.md`
- `.docks/foreman/AGENTS.md`
- the implementer native subagent instructions
- `the operator native subagent contract`
- `docs/design/work-cards/afk-warm-dock-tui-reuse-contract-v0.md`

## Required Design Boundary

Define a V0 contract that separates these concerns:

- **Dock terminal session ownership:** AOS owns the long-lived dock terminal
  session for each dock, including cwd, provider command, PTY handle, lifecycle,
  lease/disposition, and identity.
- **Provider conversation boundary:** provider-specific reset commands such as
  `/clear` define conversation boundaries inside a reused provider process.
  They do not imply process restart.
- **Inbound message formatting:** `native subagent prompt contract` remains
  the source of provider entry shape, such as Implementer Codex  versus
  Operator plain input.
- **Input path:** human input and AFK input go through the same dock-owned PTY
  path. AFK must not create a competing Terminal.app, VSCode terminal, or screen
  automation layer.
- **Headful observability:** Agent Terminal renders the dock terminal session
  and can expose session rail/status/telemetry. It observes the same substrate;
  it does not become the acceptance oracle.
- **Provider acceptance:** acceptance remains structured evidence from
  provider metadata, catalog/session records, cwd/time correlation, receipts,
  and cleanup/lease disposition. Visual output may help humans inspect but must
  not be the machine proof.

## Expected Artifact

Create a concise durable design/contract artifact. Suggested path:

```text
docs/design/dock-terminal-session-agent-terminal-contract-v0.md
```

It should include:

- problem statement and product direction;
- named components and ownership boundaries;
- proposed receipt/schema fields for dock terminal sessions and Agent Terminal
  observability;
- how AFK prompt/input routing consumes the existing dock native subagent prompt contract;
- how warm TUI reuse maps onto dock terminal session lifecycle;
- what Agent Terminal must render and what it must not infer;
- migration notes from cold `codex --no-alt-screen` bridge proof toward
  AOS-owned warm dock sessions;
- smallest next implementation slice after the design is accepted;
- tests expected for that next slice.

Keep this crisp. Prefer one contract document plus minimal references or tests
if there is an obvious doc test pattern. Do not implement a broad runtime in
this slice.

## Verification

Run the bounded checks relevant to a design/contract slice:

```bash
./aos ready
node --test tests/sigil-agent-terminal-server.test.mjs
node --test tests/renderer/agent-terminal-chrome.test.mjs
node --test tests/afk-launch-attempt-prototype.test.mjs
node --test tests/afk-session-trigger-prototype.test.mjs
git diff --check
```

If `./aos ready` reports a repo-mode permission blocker, use the standard Implementer
manual-intervention path and stop instead of routing around it:

```bash
the manual TCC blocker report path
./aos ready --post-permission
```

## Boundaries

- Do not drive real dock terminals.
- Do not launch live providers.
- Do not read provider transcript bodies.
- Do not mutate provider stores, catalogs, telemetry, gateway/dock runtime, or
  Codex configuration.
- Do not start async result routing.
- Do not create PRs, mutate GitHub issues, merge to main, or mutate main.
- Do not route Operator live proof in this slice.
- Do not propose VSCode terminal, Terminal.app automation, or a parallel
  screen-control layer as the primary headful path.

## Completion Report

Report:

- branch and head SHA
- base SHA
- changed files
- design/contract artifact path
- chosen ownership and evidence boundaries
- next proposed implementation slice
- verification commands and results
- any remaining risk or follow-up
- statement confirming the boundaries above were respected
