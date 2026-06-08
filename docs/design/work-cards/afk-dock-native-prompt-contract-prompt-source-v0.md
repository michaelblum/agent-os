# AFK Dock Native Prompt Contract Prompt Source v0

## Recipient

Implementer

## Transfer Kind

Implementer round

## Goal

Make AFK session-trigger prompt construction consume the native prompt message
contract instead of carrying a separate hard-coded provider prompt profile.

This keeps the new contract operational: Foreman/Implementer/Operator message shape
should come from `native subagent prompt contract`, not one path for
clipboard handoff and another path inside the AFK prototypes.

## Branch / Base

- branch_from: current local
  `implementer/aos-dock-inbound-message-contract-policy-split-v0` routing head
- required_start_ref: current local
  `implementer/aos-dock-inbound-message-contract-policy-split-v0` routing head
- accepted_source_head: `6a56ec05f439f1c4ced70d16beec42a01f9eeebf`
- expected_output_branch: `implementer/afk-dock-native subagent prompt contract-prompt-source-v0`

## Read First

- the implementer native prompt contract
- the operator native prompt contract
- `scripts/dock-inbound-message-contract`
- `scripts/dock-handoff-clipboard`
- `scripts/afk-launch-attempt-prototype.mjs`
- `scripts/afk-session-trigger-prototype.mjs`
- `tests/schemas/aos-dock-inbound-message-contract-v0.test.mjs`
- `tests/afk-launch-attempt-prototype.test.mjs`
- `tests/afk-session-trigger-prototype.test.mjs`
- `docs/design/work-cards/afk-warm-dock-tui-reuse-contract-v0.md`

## Required Behavior

Preserve the already accepted behavior:

- Implementer/Codex AFK prompt entry starts with .
- Implementer receipt records `provider_prompt_mode=codex_goal` and
  `provider_prompt_prefix=""`.
- Operator/Codex prompt entry remains plain and records an empty
  `provider_prompt_prefix`.
- The copied Foreman handoff payload remains plain; do not make Foreman copy
  ``.
- Slash-prefixed Implementer provider entry is still typed through the same
  character-by-character path from the first character.

Change the source of truth:

- AFK prompt construction must derive provider entry prefix, reset command,
  stale-goal recovery command, and prompt diagnostics from the target dock
  native subagent prompt contract.
- Prefer a shared JS module used by both `scripts/dock-inbound-message-contract`
  and AFK code if that is the smallest maintainable option. A narrow helper is
  fine; do not introduce a broad framework.
- If shelling out to the existing contract script is the smallest safe step,
  keep error handling explicit and deterministic.
- Contract warnings, such as one-shot proof prompt risks, should be preserved in
  prompt/dispatch receipt evidence while still allowing submission.
- Contract errors, such as Implementer self-acceptance boundary violations, must block
  prompt submission before any typed input path is attempted.
- Receipts should include enough evidence to prove which contract was used,
  for example contract path, provider entry prefix, provider entry preview, and
  diagnostics. Keep existing field names stable where practical.

## Tests

Add or update focused deterministic tests. Cover at least:

- Implementer/Codex prompt source built through the dock contract yields  in
  `provider_entry_preview`, `provider_prompt_mode=codex_goal`, and
  `provider_prompt_prefix=""`.
- Operator/Codex prompt source built through the dock contract yields a plain
  provider entry preview and empty prefix.
- A warning-producing Implementer one-shot proof prompt records warning diagnostics but
  does not fail validation solely for that wording.
- A contract-error Implementer prompt blocks before live prompt submission or typed
  input.
- Existing warm TUI reuse receipt tests still pass.

Run:

```bash
./aos ready
node --test tests/schemas/aos-dock-inbound-message-contract-v0.test.mjs
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

## Completion Report

Report:

- branch and head SHA
- base SHA
- changed files
- how AFK prompt construction now obtains dock contract data
- receipt fields added or preserved
- verification commands and results
- any remaining risk or follow-up
- statement confirming the boundaries above were respected
