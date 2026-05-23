# Dock Terminal Session Registry v0

## Recipient

GDI

## Transfer Kind

GDI round

## Goal

Implement a deterministic dock terminal session registry/receipt slice so AFK
warm reuse and Agent Terminal can reference an AOS-owned dock PTY substrate
without live provider driving.

This is the first implementation step after
`docs/design/dock-terminal-session-agent-terminal-contract-v0.md`.

## Branch / Base

- branch_from: current local
  `gdi/dock-terminal-session-agent-terminal-contract-v0` routing head
- required_start_ref: current local
  `gdi/dock-terminal-session-agent-terminal-contract-v0` routing head
- accepted_source_head: `0f50360c4e779deae2d10bb13243df31b62e26d7`
- expected_output_branch: `gdi/dock-terminal-session-registry-v0`

## Read First

- `docs/design/dock-terminal-session-agent-terminal-contract-v0.md`
- `apps/sigil/codex-terminal/server.mjs`
- `tests/sigil-agent-terminal-server.test.mjs`
- `scripts/afk-launch-attempt-prototype.mjs`
- `scripts/afk-session-trigger-prototype.mjs`
- `tests/afk-launch-attempt-prototype.test.mjs`
- `tests/afk-session-trigger-prototype.test.mjs`
- `.docks/foreman/inbound-contract.json`
- `.docks/gdi/inbound-contract.json`
- `.docks/operator/inbound-contract.json`

## Required Behavior

Create the smallest deterministic registry/receipt surface that makes
`aos.dock_terminal_session` real enough for AFK and Agent Terminal to reference.

Requirements:

- Add a schema/docs artifact or equivalent first-class contract for
  `aos.dock_terminal_session`.
- Add a deterministic helper/module that can build fixture-backed dock terminal
  session receipts for `foreman`, `gdi`, and `operator`.
- The receipt must include at least:
  - `record_type: "aos.dock_terminal_session"`;
  - dock id;
  - stable `dock_terminal_session_id`;
  - cwd under `.docks/<dock>`;
  - provider and provider command/argv;
  - PTY driver/handle/geometry;
  - lifecycle state and timestamps when supplied by fixtures;
  - lease holder/purpose/disposition.
- Add a narrow Agent Terminal server/read API or helper path that can expose
  dock terminal session identity, cwd, command, geometry, lifecycle, and lease
  disposition without making Agent Terminal the provider acceptance oracle.
- Update AFK warm dock TUI reuse receipt construction so warm-mode
  `terminal_substrate` includes:
  - `owner: "aos.dock_terminal_session"`;
  - `dock_terminal_session_id`;
  - dock terminal cwd/geometry/lease disposition when provided;
  - existing provider prompt contract fields.
- Preserve provider acceptance semantics. Acceptance must still come from
  Codex metadata/catalog/session facts, not Agent Terminal visual output.
- Preserve cold bridge launch/proof behavior as a regression harness.

Prefer focused fixture-backed implementation over broad daemon storage. If a
durable daemon registry is needed, stop and report that as the next product
decision rather than implementing it in this slice.

## Tests

Add or update deterministic tests for:

- fixture-backed `aos.dock_terminal_session` receipts for `foreman`, `gdi`, and
  `operator`;
- Agent Terminal server/API or helper output includes dock terminal session
  identity and does not report provider acceptance from visual state;
- AFK launch/session warm reuse receipts reference
  `owner: "aos.dock_terminal_session"` and a stable
  `dock_terminal_session_id`;
- GDI `/goal ` and Operator plain prompt behavior remain sourced from the dock
  inbound contract;
- provider metadata acceptance and cleanup/lease disposition behavior remain
  unchanged;
- cold bridge PTY input/resize regressions still pass.

Run:

```bash
./aos ready
node --test tests/sigil-agent-terminal-server.test.mjs
node --test tests/afk-launch-attempt-prototype.test.mjs
node --test tests/afk-session-trigger-prototype.test.mjs
git diff --check
```

If `./aos ready` reports a repo-mode permission blocker, use the standard GDI
human-needed path and stop instead of routing around it:

```bash
.docks/gdi/scripts/human-needed-tcc-reset
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
- Do not implement durable daemon storage unless it is already clearly scoped
  by existing local code; fixture-backed deterministic receipts are enough.

## Completion Report

Report:

- branch and head SHA
- base SHA
- changed files
- schema/docs/helper/API paths added or changed
- how AFK warm reuse references dock terminal sessions
- how Agent Terminal observes without becoming acceptance evidence
- verification commands and results
- any remaining risk or follow-up
- statement confirming the boundaries above were respected
