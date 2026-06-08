# Work Card: PR 377 AFK Prototype Review Corrections V0

## Transfer Classification

- Recipient: Implementer
- Transfer kind: correction round
- Single next goal: address the concrete PR #377 review-blocking robustness and
  prototype-status findings without changing the accepted AFK runtime semantics.
- Source artifact: PR #377, "Prototype AFK session trigger and cleanup proof".
- Branch/Base:
  - `branch_from: implementer/afk-dev-session-trigger-packet-validation-status-correction-v0`
  - `required_start_ref: implementer/afk-dev-session-trigger-packet-validation-status-correction-v0`
- Branch/output expectation: create or reuse a scoped local output branch from
  the required start ref. A suitable name is
  `implementer/pr-377-afk-prototype-review-corrections-v0`. Keep the checkpoint local
  unless Foreman explicitly asks you to push or update the PR.

## Fresh Context Contract

Implementer starts from a fresh context window. Do not assume branch, worktree, daemon,
PR, bridge process, provider session, transcript/catalog state, or Foreman's
review details beyond this card. Read and rediscover before editing.

## Review Findings To Correct

PR #377 review accepted the headline packet-validation correction and cleanup
proof, but flagged these follow-up issues before merge:

- `apps/sigil/codex-terminal/pty-proxy.py` has no size cap for a pending stdin
  control frame. A malformed or never-closed leading NUL frame can append
  forever, swallow later stdin, and stall input.
- `apps/sigil/codex-terminal/server.mjs` treats any stderr line matching
  `SIGIL_AGENT_PTY_CHILD_PID=<pid>` as the PTY child PID. Make that side channel
  one-shot so future command stderr cannot overwrite `record.commandPid`.
- The AFK `./aos dev` verbs are prototype diagnostics but look like durable CLI
  surface. The current registry already says "experimental" in argument
  summaries; make the prototype/experimental status explicit enough in command
  help and keep tests covering it.
- Optional clarity only: `packages/host/src/codex-thread-adapter.ts` marks the
  index partial with `diagnostics.some(code.startsWith('codex_'))`, but all
  current diagnostic codes are `codex_*`. If you touch that area, prefer the
  clearer equivalent `diagnostics.length > 0`.

## Read First

- `AGENTS.md`
- the implementer native subagent instructions
- `apps/sigil/AGENTS.md`
- `apps/sigil/codex-terminal/pty-proxy.py`
- `apps/sigil/codex-terminal/server.mjs`
- `tests/sigil-agent-terminal-server.test.mjs`
- `src/shared/command-registry-data.swift`
- `src/commands/dev.swift`
- `tests/dev-workflow-router.sh`
- `tests/help-contract.sh`

## Rediscover State

Run:

```bash
git status --short --branch
git rev-parse HEAD
gh pr view 377 --json number,title,state,headRefName,baseRefName,mergeable,isDraft,url
./aos ready
./aos dev recommend --json --paths apps/sigil/codex-terminal/pty-proxy.py,apps/sigil/codex-terminal/server.mjs,tests/sigil-agent-terminal-server.test.mjs,src/shared/command-registry-data.swift,src/commands/dev.swift,tests/dev-workflow-router.sh,tests/help-contract.sh
```

If `./aos ready` reports a repo-mode Accessibility, Input Monitoring, or
inactive input-tap blocker, run:

```bash
the manual TCC blocker report path
```

Then stop with `manual_intervention`. After the human returns with `finished`, run:

```bash
./aos ready --post-permission
```

Only continue if it reports ready.

## Existing Code To Inspect

- `apps/sigil/codex-terminal/pty-proxy.py` - owns stdio-to-PTY forwarding,
  control-frame parsing, resize application, and process-group signal handling.
- `apps/sigil/codex-terminal/server.mjs` - owns PTY proxy process management,
  PID marker parsing, stdin/key/resize calls, and websocket bridge behavior.
- `tests/sigil-agent-terminal-server.test.mjs` - already covers normal
  coalesced and split resize control frames; extend it for malformed/oversized
  pending control behavior and PID marker overwrite behavior if practical.
- `src/shared/command-registry-data.swift`, `src/commands/dev.swift`,
  `tests/dev-workflow-router.sh`, and `tests/help-contract.sh` - own `./aos dev`
  help/registry exposure for the three AFK prototype commands.

## Required Behavior

- Pending PTY control frames must be bounded. Choose a small cap measured in KB,
  not MB. When the cap is exceeded before a complete JSON object arrives, the
  proxy must not swallow all future stdin indefinitely.
- Define and test the oversize behavior. Acceptable outcomes are either:
  - drop the malformed control frame and resume forwarding later stdin; or
  - flush the malformed bytes as raw PTY input and resume forwarding later
    stdin.
- Valid resize control frames must keep working, including frames coalesced with
  trailing text and frames split across stdin reads.
- The `SIGIL_AGENT_PTY_CHILD_PID=<pid>` stderr marker must only set
  `record.commandPid` when it is still null. Later matching stderr must be
  treated as normal output or ignored by an explicit, tested rule; do not let it
  silently overwrite the command PID.
- The AFK `dev` command help should clearly mark `afk-dry-run`,
  `afk-launch-attempt`, and `afk-session-trigger` as experimental/prototype
  diagnostics. Keep the existing command names and flags; do not introduce a new
  `--experimental` gate in this correction unless the local command framework
  already has a matching pattern.
- Do not change packet validation semantics accepted in
  `8b65c536ae12fbd827632e17f8f8e38cabe11490`.

## Scope And Hard Boundaries

- This is a deterministic PR-review correction, not a new AFK feature slice.
- Do not run a live Codex, Claude, Gemini, tmux provider session, or supervised
  provider launch for this round.
- Do not read real provider transcript bodies or mutate provider configs,
  provider session files, provider catalogs, gateway state, dock profiles,
  hooks, GitHub state, pushes, or PRs.
- Do not refactor the three Swift option-marshaling blocks unless the
  experimental-help correction requires a tiny local helper. The review called
  that duplication acceptable for the prototype.
- Do not archive or reorganize the work-card fan-out in this round.
- Do not rebase the PR branch in this Implementer round. Report whether the branch still
  needs rebase after the corrections pass.

## Suggested Implementation Areas

- Add a `MAX_CONTROL_FRAME_BYTES` constant in `pty-proxy.py` and enforce it both
  when appending to an existing `pending_control` and when starting a new
  pending control frame.
- Add or extend deterministic tests in `tests/sigil-agent-terminal-server.test.mjs`
  around the existing PTY proxy control-frame test.
- In `server.mjs`, make the PID marker path one-shot. If later matching lines
  are surfaced as normal output, add a focused assertion; if they are ignored,
  make that intent explicit.
- For command help, prefer a registry-level text change plus the existing router
  and help contract tests.

## Verification

Required:

```bash
git status --short --branch
./aos ready
node --test tests/sigil-agent-terminal-server.test.mjs
bash tests/dev-workflow-router.sh
bash tests/help-contract.sh
git diff --check
```

Run if `src/commands/dev.swift` changes:

```bash
./aos dev build --no-restart
```

Run if `packages/host/src/codex-thread-adapter.ts` changes:

```bash
npm test -- --runInBand packages/host/test/codex-thread-adapter.test.ts
```

If the exact package test command differs, inspect the repo scripts and run the
focused Codex adapter test with the local standard command.

## Stop Conditions

Stop and report instead of broadening scope if:

- repo-mode TCC/Input Monitoring readiness blocks deterministic verification;
- fixing malformed PTY frames requires changing the control-frame protocol;
- clarifying prototype status would require a product decision about permanent
  command spelling, new command gates, or removing the current verbs;
- verification would require live provider launch, prompt submission, gateway
  delivery, or provider-owned state mutation.

## Completion Report

Report:

- branch and head SHA;
- changed paths, path-scoped to this correction;
- exact malformed/oversized control-frame behavior chosen;
- PID marker overwrite behavior after the change;
- how `./aos dev` help now communicates prototype/experimental status;
- tests/checks run with exact pass/fail results;
- `./aos ready` result or exact manual-intervention blocker;
- whether PR #377 still needs rebase against `origin/main`;
- confirmation that no live provider launch, real transcript read, provider
  config/session/catalog mutation, gateway state, dock profile/hook mutation,
  GitHub state, push, PR update, or external publication happened.
