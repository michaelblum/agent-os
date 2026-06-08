# Sigil Agent Terminal Repo Root Wrapper Correction

## Tracker

- Source inventory: `BROKE.md`
- Prior inventory branch: `implementer/pr392-breakage-inventory-next-v0`
- Current base: `main` at or after `fb7f1ddb`
- Transfer kind: Implementer correction round

## Fresh Context Contract

Implementer starts from a fresh context window. Do not assume branch, worktree, daemon, canvas, issue, or prior implementation state. Read and rediscover before editing.

## Goal

Make the remaining deterministic top-level PR #392 breakage pass:

```bash
node --test tests/sigil-agent-terminal-server.test.mjs
```

The failing contract is `Sigil Agent Terminal bridge > passes stable repo root to bridge server startup paths`. It currently expects the Sigil Agent Terminal launch surface to carry explicit `AGENT_TERMINAL_REPO_ROOT` startup evidence.

## Read First

- `AGENTS.md`
- `apps/sigil/AGENTS.md`
- `BROKE.md`
- `tests/sigil-agent-terminal-server.test.mjs`
- `apps/sigil/agent-terminal/launch.sh`
- `apps/sigil/agent-terminal/bridge-launch.sh`
- `apps/sigil/aos-app.json`
- `packages/toolkit/components/agent-terminal/bridge-server.mjs`
- `packages/toolkit/components/agent-terminal/launch.sh`

## Rediscover State

```bash
git status --short --branch
git log -1 --oneline
node --test tests/sigil-agent-terminal-server.test.mjs
```

Expected inventory evidence:

- `node --test tests/sigil-agent-terminal-server.test.mjs` reports 18/19 pass.
- Failing assertion reads `apps/sigil/agent-terminal/launch.sh` and does not find:
  - `"AGENT_TERMINAL_REPO_ROOT=" + shlex.quote(repo_root)`
  - `AGENT_TERMINAL_REPO_ROOT="$REPO_ROOT" \`

Foreman's local checkout has unrelated `.codex/config.toml` dirt. Do not modify or revert it. If any AFK top-level tests appear red in the dirty checkout, rerun from a clean temporary worktree before classifying them.

## Required Behavior

- The Sigil Agent Terminal bridge startup path must pass a stable repo root to the toolkit bridge server through `AGENT_TERMINAL_REPO_ROOT`.
- The canonical Sigil Agent Terminal entrypoint remains `apps/sigil/agent-terminal/launch.sh`.
- The bridge startup implementation may live in `bridge-launch.sh` if that is the current app manifest contract, but the deterministic test should assert the actual canonical startup path rather than stale/dead shell content.
- Do not reintroduce old `SIGIL_AGENT_REPO_ROOT` vocabulary.
- Keep compatibility wrappers narrow. Prefer the current canonical `aos launch sigil agent-terminal` path unless the test proves the app manifest bridge script is no longer reachable.

## Scope

- Sigil Agent Terminal launch/test contract only.
- Likely files:
  - `tests/sigil-agent-terminal-server.test.mjs`
  - `apps/sigil/agent-terminal/launch.sh`
  - `apps/sigil/agent-terminal/bridge-launch.sh`
  - possibly `apps/sigil/aos-app.json` if the manifest points at the wrong startup script.
- Do not change toolkit bridge-server semantics unless the Sigil startup path cannot pass the existing environment contract.
- Do not touch AFK scheduler/session-trigger code in this slice.

## Verification

Run:

```bash
node --test tests/sigil-agent-terminal-server.test.mjs
node --test tests/*.test.mjs
git diff --check
```

If `node --test tests/*.test.mjs` is red only because the local checkout is dirty and AFK clean-worktree tests pass, report that explicitly and include the clean-worktree command/result.

## Completion Report

Return:

- Files changed.
- Which canonical startup path now carries/asserts `AGENT_TERMINAL_REPO_ROOT`.
- Exact test commands and pass/fail counts.
- Whether any top-level failures remain, with exact failing test names and first assertion/error.
- Any local-only dirty state such as `.codex/config.toml`.
