# Dock Hook Isolation Stop-Only Correction

## Transfer Contract

- Recipient: Implementer
- Transfer kind: correction round
- Source artifact: `tests/dock-hook-isolation.sh` failure on `main`
- Single next goal: make the dock hook isolation test and adjacent verification
  docs match the current Stop-only dock harness model.
- Branch/base: `branch_from: main`; `required_start_ref: main`
- Output expectation: create a scoped Implementer branch if edits are needed; do not
  mutate GitHub issues or PRs.
- Stop conditions: complete with evidence, fail with the technical blocker,
  stall only for permissions/credentials/product direction, or report misroute
  if the accepted model is ambiguous.

## Fresh Context Contract

Implementer starts from a fresh context window. Do not assume branch, worktree, daemon,
or prior implementation state. Read and rediscover before editing.

## Observed Failure

`bash tests/dock-hook-isolation.sh` currently fails immediately with:

```text
FAIL: shared dock runner missing 'aos_resolve_session_id'
```

Foreman inspection found this is not caused by the transfer-skill cleanup. The
current accepted dock model on `main` is Stop-only:

- `.docks/{foreman,implementer,operator}/.codex/hooks.json` only declares `Stop`.
- `.docks/{foreman,implementer,operator}/hooks/` only contains `stop.sh`.
- `.docks/foreman/hooks/stop.sh` only accepts `stop <dock>`.
- `.docks/AGENTS.md` says not to add startup hooks for git posture, session
  registration, or context snapshots.

The failing test and old work-card verification still assert the previous
session-start/shared-session-id runner shape. Correct that drift without
resurrecting startup registration.

## Read First

- `AGENTS.md`
- `.docks/AGENTS.md`
- `.docks/AGENTS.md`
- `.docks/foreman/hooks/stop.sh`
- `.docks/{foreman,implementer,operator}/.codex/hooks.json`
- `.docks/{foreman,implementer,operator}/hooks/stop.sh`
- `tests/dock-hook-isolation.sh`
- `docs/design/work-cards/dock-shared-harness-v0.md`
- `.docks/AGENTS.md`

## Rediscover State

Run:

```bash
git status --short --branch
bash tests/dock-hook-isolation.sh
```

Use `git show --stat --oneline cfac95c -- .docks/foreman/hooks/stop.sh session hooks tests/dock-hook-isolation.sh docs/design/work-cards/dock-shared-harness-v0.md`
only as historical context for the simplification. Do not revert the commit.

## Required Behavior

`tests/dock-hook-isolation.sh` should verify the model that is actually
documented and present on `main`:

- shared `.docks/foreman/hooks/stop.sh` exists and remains executable;
- the runner sources `.agents/hooks/session-common.sh` only for bounded command
  helpers that the Stop path still uses;
- the runner invokes bounded `aos say --voice-slot ...` Stop notices using
  merged dock defaults and dock-local `session metadata` metadata;
- no Stop path calls `aos voice bind`, `aos voice final-response`, derives
  clipboard content from final chat text, or requires a resolved session id;
- dock-local hooks only route through isolated `stop.sh` wrappers;
- startup hooks are absent from the current Codex hook model and should not be
  required by the test;
- optional dock extension checks should align with current docs, which mention
  `pre-stop.sh` and `post-stop.sh`, not session-start extension points.

If adjacent docs or the old work card still describe required session-start
behavior as current, update them narrowly to reflect the Stop-only model. Keep
historical design notes historical; do not expand this into a broad docs rewrite.

## Scope And Hard Boundaries

- Own test/doc drift around the dock hook harness only.
- Do not restore `session hooks/session-start.sh`.
- Do not reintroduce `aos_resolve_session_id` requirements to the shared
  runner.
- Do not change transfer-skill routing or resurrect
  `foreman-session-handoff`.
- Do not alter voice selection policy beyond what is needed for the existing
  Stop-only test.
- Do not mutate GitHub issues, PRs, or branch hygiene.

## Verification

Run:

```bash
bash tests/dock-hook-isolation.sh
bash tests/dock-handoff-clipboard.sh
bash tests/help-contract.sh
node --test tests/schemas/aos-dock-profile-v0.test.mjs
git diff --check
```

If one of the broader shell tests exposes an unrelated pre-existing failure,
stop after the focused evidence is clear and report the exact failing command,
first failing line, and why it appears unrelated.

## Completion Report

Report:

- changed files;
- which stale session-start assertions were removed or replaced;
- exact verification commands and pass/fail results;
- any unrelated dirty state or pre-existing blocker;
- whether any follow-up should return to Foreman for coordination.
