# Session Contract

This is the canonical runtime/session contract for `agent-os` across both
Codex and Claude Code.

## Authority

Project truth is ordered like this:

1. Running code, tests, and `./aos` runtime behavior
2. Shared schemas, `ARCHITECTURE.md`, and `docs/api/`
3. `AGENTS.md`
4. This file
5. Active `docs/superpowers/` plans and specs
6. Session handoff payloads
7. Provider-specific caches, memories, or local convenience files

Provider-local memory is never canonical project truth.
If something durable is discovered in provider-local memory, promote it into
repo-native docs or issues and stop relying on hidden recall.

## Provider Model

- `AGENTS.md` is the repo-wide contract.
- `CLAUDE.md` files are provider adapters or subtree detail only.
- `.claude/` and `.codex/` config in this repo are the project-scoped runtime
  adapters.
- `.agents/hooks/` is the shared hook implementation layer used by both
  runtimes.
- `scripts/claude-agent-os` is the required Claude entrypoint for this repo so
  Claude config and auto-memory stay repo-scoped to `agent-os`.

If a rule matters to both runtimes, it belongs in repo-native files, not in
provider-specific memory or ad hoc startup text.

## Active Session Surfaces

These are the live session-control files:

- `AGENTS.md`
- `docs/SESSION_CONTRACT.md`
- `docs/session-contract.json`
- `.agents/hooks/session-common.sh`
- `.agents/hooks/session-start.sh`
- `.agents/hooks/check-messages.sh`
- `.agents/hooks/session-stop.sh`
- `.agents/hooks/final-response.sh`
- `.claude/settings.json`
- `.codex/hooks.json`
- `.codex/config.toml`
- `scripts/handoff`
- `scripts/parallel-codex`
- `scripts/claude-agent-os`

## Hook Contract

Both Codex and Claude Code must:

- run the shared session-start hook
- run the shared git-health hook
- run the shared pre/post tool policy hooks
- run the shared inbound-message check hook
- run the shared final-response relay on stop
- run the shared session-stop unregister hook on stop

No runtime-specific persona injection is allowed at startup for `agent-os`.

## Bootstrap Contract

Bootstrap payloads are repo-scoped and runtime-scoped under the AOS coordination
state root, not under ad hoc `/tmp` paths.

- payload path: `$(aos_session_bootstrap_payload_file <session-name>)`
- launcher path: `$(aos_session_bootstrap_launcher_file <session-name>)`
- both resolve under `AOS_STATE_ROOT/<mode>/coordination/bootstrap/`

The startup hook is the only consumer of the bootstrap payload. Launchers only:

- set `AOS_SESSION_NAME`
- start the target runtime
- rely on the shared startup hook to hydrate context

## Handoff Contract

- Handoff briefs are small, structured pointers to repo truth.
- `scripts/handoff` writes the bootstrap payload and launcher in the shared
  coordination bootstrap dir.
- `scripts/parallel-codex` uses the same bootstrap payload format.
- Handoff briefs are supplemental context, not canonical truth.

## Provider-Specific Limits

Some state cannot be fully moved into the repo because the runtimes own it:

- Claude Code install metadata and plugin cache under `~/.claude/`
- Codex trust state under `~/.codex/config.toml`
- user-global PATH / environment setup for the CLI binaries

Those should remain generic. `agent-os` behavior should be determined by the
repo-local config and hooks above.

## Explicit Non-Canonical Surfaces

These must not define project policy:

- provider-local memory files
- provider startup personas like "caveman mode"
- untracked `.claude/settings.local.json`
- untracked `.claude/launch.json`
- historical `docs/superpowers/` archaeology that contradicts this file

## Operating Rule

When Codex and Claude disagree, prefer:

1. shared repo docs
2. shared hook behavior
3. current runtime behavior

Do not patch one runtime locally to compensate for a missing primitive or a bad
project contract.
