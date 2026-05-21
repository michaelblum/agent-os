# GDI Conditional Stop Notices V0

## Transfer Contract

- Recipient: GDI
- Transfer kind: GDI round
- Source artifact: Foreman review of GDI `/goal` lifecycle gaps and Michael's
  follow-up request on human-entered CLI commands.
- Single next goal: make GDI's TCC/human-needed stop path produce deterministic
  condition-specific audio and a concise, consistent human-action chat tail.
- Branch/base: `branch_from: main`; `required_start_ref: origin/main`
- Workflow profile: `agentic_relay`
- Output expectation: create `gdi/gdi-conditional-stop-notices-v0`, commit
  scoped changes, push the branch, and report branch name plus HEAD SHA. Do not
  merge to `main`.
- Stop conditions: complete with evidence, fail with the technical blocker,
  stall only for permissions/credentials/product direction, or report misroute
  if Codex hook behavior makes the requested chat-tail insertion impossible.

## Fresh Context Contract

GDI starts from a fresh context window. Do not assume branch, worktree, daemon,
TCC state, hook trust state, or prior Foreman/GDI discussion. Read and
rediscover before editing.

## Context

GDI runs as a Codex dock with `features.goals = true`, and Michael manually
prepends `/goal` when pasting Foreman's thin dispatch into the CLI. Do not
change `requires_goal_prefix`; do not add `/goal` to Foreman's copied dispatch.

The current GDI TCC path has two useful pieces but they are not connected well:

- `.docks/gdi/scripts/human-needed-tcc-reset` prints useful permission recovery
  instructions and currently speaks a generic "User needed" notice directly.
- `.docks/harness/dock-hook-runner.sh` later speaks the dock's generic Stop
  notice, so a TCC stall can end with "GDI finished" instead of a specific
  "GDI needs TCC reset" notice.

Michael's requested product behavior is:

- if GDI stops because a TCC/Accessibility/Input Monitoring/input-tap blocker
  requires human action, the audio should be condition-specific, such as
  "GDI needs TCC reset";
- the tail visible in the GDI chat should consistently remind the human exactly
  what CLI commands/actions to enter next;
- normal GDI completion should keep a normal completion signal and should not
  imply TCC action;
- the mechanism should reduce dependence on the human remembering `/goal`
  lifecycle commands.

## Read First

- `AGENTS.md`
- `.docks/AGENTS.md`
- `.docks/gdi/AGENTS.md`
- `.docks/gdi/README.md`
- `.docks/gdi/.codex/config.toml`
- `.docks/gdi/.codex/hooks.json`
- `.docks/gdi/dock.json`
- `.docks/gdi/hooks/stop.sh`
- `.docks/gdi/scripts/human-needed-tcc-reset`
- `.docks/harness/dock-hook-runner.sh`
- `.docks/foreman/skills/session-transfer/SKILL.md`
- `.docks/foreman/skills/session-transfer/references/gdi.md`
- `.docks/foreman/skills/session-transfer/references/gdi-work-card-authoring.md`
- `tests/dock-hook-isolation.sh`
- `tests/dock-handoff-clipboard.sh`
- `tests/help-contract.sh`
- `shared/schemas/aos-dock-profile-v0.schema.json`
- `tests/schemas/aos-dock-profile-v0.test.mjs`

## Rediscover State

Run:

```bash
git fetch origin
git status --short --branch
codex --version
codex features list | rg -n "goals|hooks" -S
bash tests/dock-hook-isolation.sh
```

Use official Codex hook docs only as behavior reference if needed. The important
constraints from current docs are that `Stop` hooks receive
`last_assistant_message`, must return JSON on stdout, and may return
`systemMessage`; plain text stdout is invalid for `Stop`.

## Required Behavior

Build a deterministic, testable GDI stop-condition path for TCC/human-needed
stalls.

At minimum, the accepted implementation must provide:

1. A deterministic condition signal that the GDI TCC helper and GDI Stop hook
   can share. Prefer a small dock-local or temp-runtime marker that includes the
   repo root/dock identity, a short expiry, and the condition name. If a marker
   is not feasible, use an explicit sentinel in `last_assistant_message`, but
   document why that is the narrower reliable option.
2. A condition-specific Stop TTS path. When the condition is the TCC permission
   reset stall, GDI should speak a specific notice such as `GDI needs TCC
   reset.` instead of the generic `GDI finished.` Stop notice. Avoid duplicate
   or contradictory speech from both the helper and the Stop hook.
3. A concise human-action boilerplate for the GDI chat tail. The TCC stall path
   should consistently tell the human:
   - run `./aos permissions setup --once`;
   - grant the requested macOS Accessibility/Input Monitoring permission if
     prompted;
   - return to the GDI session and say `ready`;
   - after that, GDI runs `./aos ready --post-permission`;
   - if the active goal is paused or Codex indicates it needs to resume, use
     `/goal resume` rather than starting a new goal.
4. GDI SOP text that makes the tail block mandatory for this deterministic
   stall. The human should not need to infer the command sequence from memory.
5. Foreman transfer guidance that can route TCC-sensitive GDI work without
   adding `/goal` to the copied dispatch. Keep the dispatch plain and make the
   stop branch part of the work card or a plain suffix.
6. Goal lifecycle hygiene: add a low-risk reminder that a reused GDI CLI session
   should clear completed goal state with `/goal clear` before retirement when a
   goal was active.

The Stop hook does not have to literally mutate the assistant message if Codex
does not support that. If the hook can only surface a warning/system message,
use that for deterministic UI reinforcement and make the assistant tail
boilerplate an AGENTS/helper contract. Do not fake support for chat-tail
insertion.

## Suggested Implementation Areas

Inspect first, then choose the narrowest correct layer. Likely areas:

- `.docks/gdi/scripts/human-needed-tcc-reset`
- `.docks/harness/dock-hook-runner.sh`
- `.docks/gdi/AGENTS.md`
- `.docks/gdi/README.md`
- `.docks/foreman/skills/session-transfer/references/gdi.md`
- `.docks/foreman/skills/session-transfer/SKILL.md`
- `.docks/foreman/skills/session-transfer/references/gdi-work-card-authoring.md`
- `tests/dock-hook-isolation.sh`

A reasonable implementation shape is:

- the TCC helper records a short-lived `tcc_permission_reset` stop condition;
- the shared Stop runner consumes that condition for GDI and overrides the Stop
  notice plus optional `systemMessage`;
- GDI AGENTS requires the same condition to be reported in a fixed
  `human_needed` tail block.

If this requires a helper script for marker read/write, keep it small and place
it where the hook runner can call it without broad dependencies. Do not store
runtime condition markers in tracked repo files or leave dirty state after a
normal run.

## Scope And Hard Boundaries

- Own GDI human-needed/TCC stop signaling and adjacent Foreman routing docs.
- Keep the accepted Stop-only dock model. Do not restore session-start hooks.
- Do not reintroduce `aos_resolve_session_id`.
- Do not use `aos voice bind` or `aos voice final-response`.
- Do not change the clipboard handoff model or add `/goal` to Foreman's copied
  dispatch.
- Do not build a broad condition framework for every possible GDI outcome unless
  a tiny table/extension point is the simplest way to avoid hardcoding.
- Do not mutate GitHub issues, open PRs, merge branches, or delete branches.

## Verification

Run the focused and adjacent deterministic checks:

```bash
bash tests/dock-hook-isolation.sh
bash tests/dock-handoff-clipboard.sh
bash tests/help-contract.sh
node --test tests/schemas/aos-dock-profile-v0.test.mjs
git diff --check
```

Add or update deterministic test coverage that simulates the TCC stop condition
without requiring real macOS permission changes. The test should prove:

- normal GDI stop still speaks `GDI finished.`;
- the simulated TCC condition speaks the condition-specific notice;
- the condition marker, if used, is consumed or expires so later normal stops do
  not inherit stale TCC state;
- the human-needed helper output includes the exact command sequence the human
  must enter;
- Stop hook stdout remains valid JSON.

If live AOS readiness is blocked by TCC during this slice, do not chase live
repair loops. Use the deterministic simulation and report the exact live blocker
as local-only state.

## Completion Report

Report:

- profile, branch, HEAD SHA, and base SHA;
- files changed;
- how the TCC condition is signaled from helper to Stop hook;
- exact TTS notices for normal completion and TCC stall;
- the exact human-action chat-tail boilerplate added for TCC stalls;
- exact verification commands and pass/fail results;
- local-only state, including any runtime marker directory used during tests;
- any remaining limitation, especially if Codex hooks cannot insert true chat
  tail text and the implementation uses `systemMessage` plus GDI SOP instead.
