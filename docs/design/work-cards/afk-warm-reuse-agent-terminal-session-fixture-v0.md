# AFK Warm Reuse Agent Terminal Session Fixture v0

## Recipient

GDI

## Transfer Kind

GDI round

## Tracker

Active workstream: AFK session trigger provider-acceptance path, currently
moving from cold bridge proof toward warm dock TUI reuse through AOS-owned dock
terminal sessions.

Accepted prerequisite:

- `gdi/dock-terminal-session-cwd-correction-v0` at
  `164b0c7447b03f3c4f577f4c340027c28ca0a5fe`.

## Fresh Context Contract

GDI starts from a fresh context window. Do not assume branch, worktree, daemon,
canvas, issue, provider, or prior implementation state. Read and rediscover
before editing.

## Goal

Make AFK warm dock TUI reuse consume Agent Terminal dock terminal session
observation facts from a deterministic fixture shaped like
`GET /dock-terminal-session`, rather than reconstructing all dock terminal
session facts from loose warm-reuse fixture fields.

This is still a deterministic validation slice. Do not drive a live provider or
start async result routing.

## Branch / Base

- card_branch: `foreman/afk-warm-reuse-agent-terminal-session-fixture-v0`
- branch_from: `gdi/dock-terminal-session-cwd-correction-v0` at
  `164b0c7447b03f3c4f577f4c340027c28ca0a5fe`
- required_start_ref:
  `foreman/afk-warm-reuse-agent-terminal-session-fixture-v0`
- expected_output_branch:
  `gdi/afk-warm-reuse-agent-terminal-session-fixture-v0`

Create or update the expected output branch from the required start ref. Do not
reset to `origin/main`; this card and the prerequisite code are feature-branch
state.

## Read First

- `AGENTS.md`
- `docs/design/dock-terminal-session-agent-terminal-contract-v0.md`
- `shared/schemas/aos-dock-terminal-session-v0.md`
- `scripts/lib/dock-terminal-session-registry.mjs`
- `apps/sigil/codex-terminal/server.mjs`
- `scripts/afk-launch-attempt-prototype.mjs`
- `scripts/afk-session-trigger-prototype.mjs`
- `tests/afk-launch-attempt-prototype.test.mjs`
- `tests/afk-session-trigger-prototype.test.mjs`
- `tests/sigil-agent-terminal-server.test.mjs`

## Rediscover State

Run:

```bash
git status --short --branch
git log --oneline --decorate --max-count=6
./aos ready
```

If `./aos ready` reports a repo-mode Accessibility, Input Monitoring, or
inactive input-tap blocker, run:

```bash
.docks/gdi/scripts/human-needed-tcc-reset
```

Then stop with `human_needed`. After the human returns with `finished`, run:

```bash
./aos ready --post-permission
```

Only continue if it reports ready.

## Existing Code To Inspect

- `apps/sigil/codex-terminal/server.mjs` - owns
  `/dock-terminal-session` response shape and actual-session cwd semantics.
- `scripts/lib/dock-terminal-session-registry.mjs` - owns
  `aos.dock_terminal_session` receipt and Agent Terminal observation helpers.
- `scripts/afk-launch-attempt-prototype.mjs` - currently builds warm reuse
  `terminal_substrate` by calling `createDockTerminalSessionReceipt()`.
- `scripts/afk-session-trigger-prototype.mjs` - wraps launch-attempt output into
  the AFK session trigger receipt.
- `tests/afk-launch-attempt-prototype.test.mjs` and
  `tests/afk-session-trigger-prototype.test.mjs` - warm reuse regression
  coverage.

## Required Behavior

- Add the smallest deterministic way for warm dock TUI reuse to accept a fixture
  shaped like Agent Terminal `GET /dock-terminal-session` output:
  - `dock_terminal_session`;
  - `agent_terminal_observation`.
- The fixture may be provided through a new explicit CLI option or through an
  unambiguous section inside the existing bridge visibility fixture. Choose the
  smallest clear interface after reading the current code.
- When present, AFK warm reuse must copy the dock terminal session identity and
  substrate facts from the fixture:
  - `owner: "aos.dock_terminal_session"`;
  - `dock_terminal_session_id`;
  - `cwd`;
  - `driver` / PTY handle when available;
  - geometry;
  - lease disposition;
  - provider command only in an existing compatible field, or as a new explicit
    field if needed. Do not replace the warm-mode `command` contract unless the
    surrounding tests prove that is the intended shape.
- Preserve existing fallback behavior for older fixture shapes that only provide
  `warm_tui_reuse`, `warmTuiReuse`, or loose warm fields.
- Preserve provider acceptance semantics. Agent Terminal observation remains
  `human_observability_only` and `provider_acceptance.status="not_evidence"`;
  AFK provider acceptance must still come from Codex metadata/catalog/session
  facts or explicit deterministic fixtures.
- Preserve GDI `/goal ` prompt shaping and Operator plain prompt shaping from
  dock inbound contracts.
- Keep the result deterministic. Do not call the live
  `/dock-terminal-session` endpoint in this slice unless it is behind an
  explicit test fixture seam and not exercised by default.

## Hard Boundaries

- Do not drive real dock terminals.
- Do not launch live providers.
- Do not read provider transcript bodies.
- Do not mutate provider stores, catalogs, telemetry, gateway/dock runtime, or
  Codex configuration.
- Do not start async result routing.
- Do not create PRs, mutate GitHub issues, merge to main, or mutate main.
- Do not route Operator live proof.
- Do not remove or relax `--i-am-present`.

## Suggested Implementation Areas

- A small normalizer near the existing warm reuse fixture handling in
  `scripts/afk-launch-attempt-prototype.mjs`.
- Focused tests with a fixture payload copied from the
  `tests/sigil-agent-terminal-server.test.mjs` response shape, without reading
  any live transcript or provider-owned files.
- Only update `scripts/afk-session-trigger-prototype.mjs` if its receipt wrapper
  needs to preserve additional warm reuse fields exposed by launch-attempt.

## Verification

Run:

```bash
./aos ready
node --test tests/sigil-agent-terminal-server.test.mjs
node --test tests/afk-launch-attempt-prototype.test.mjs
node --test tests/afk-session-trigger-prototype.test.mjs
git diff --check
```

If you add schema/docs behavior, also run the matching schema test:

```bash
node --test tests/schemas/aos-dock-terminal-session-v0.test.mjs
```

## Completion Report

Report:

- branch and head SHA;
- base SHA;
- changed files;
- how the warm reuse path consumes Agent Terminal dock session fixture facts;
- how fallback fixture behavior is preserved;
- how provider acceptance remains separate from Agent Terminal observation;
- exact verification commands and results;
- any local-only dirty or generated artifacts;
- remaining risk or recommended follow-up;
- confirmation that no live provider launch, real terminal drive, transcript
  body read, provider mutation, GitHub issue/PR/main mutation, async routing, or
  Operator live proof occurred.
