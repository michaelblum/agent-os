# Work Card: AFK Dev Session Trigger Codex Goal Prefix Receipt Source Correction V0

**Status:** Routed 2026-05-23

## Transfer Classification

- Recipient: Implementer
- Transfer kind: correction round
- Single next goal: make the real live Codex/Implementer AFK prompt submission receipt
  record `provider_prompt_mode=codex_goal` and
  `provider_prompt_prefix=""` from the same source used by the actual
  submission call path, not only from direct helper tests.
- Source artifacts:
  - `docs/design/work-cards/afk-dev-session-trigger-codex-prompt-prefix-transport-v0.md`
  - `.docks/foreman/packets/to-implementer-afk-dev-session-trigger-codex-prompt-prefix-receipt-source-correction-v0.json`
  - Implementer implementation commit:
    `6d83b6ee07dbffd6d9e93b6101caf288674c3aca`
  - `scripts/afk-launch-attempt-prototype.mjs`
  - `tests/afk-launch-attempt-prototype.test.mjs`
  - `tests/afk-session-trigger-prototype.test.mjs`
- Branch/Base:
  - `branch_from: implementer/afk-dev-session-trigger-codex-prompt-prefix-transport-v0`
  - `required_start_ref: implementer/afk-dev-session-trigger-codex-prompt-prefix-transport-v0`
  - Required implementation input head:
    `6d83b6ee07dbffd6d9e93b6101caf288674c3aca`
  - Start from the local branch head that contains this work card. Do not reset
    to `origin/implementer/afk-dev-session-trigger-codex-prompt-prefix-transport-v0` if
    that would remove this correction card.
- Branch/output expectation: reuse
  `implementer/afk-dev-session-trigger-codex-prompt-prefix-transport-v0`, add a focused
  correction commit, and push that Implementer branch when verification passes under
  the active `agentic_relay` profile. Do not open a PR, merge, mutate main, or
  mutate GitHub issues/projects. Do not start async result routing.

## Fresh Context Contract

Implementer starts from a fresh context window. Do not assume branch, worktree,
readiness, daemon state, or the prior review result. Read and rediscover before
editing.

## Foreman Review Finding

The current Implementer commit builds the Codex/Implementer live prompt with  because
`buildAttemptContext()` passes `selectedProvider` and `selectedDock` into the
prompt construction context.

The receipt source passed to the actual live submission path is different:
`liveProviderPromptSource` omits `selectedProvider` and `selectedDock`, then
`observeProviderTerminalSubstrate()` passes it to `submitLiveProviderPrompt()`.
That function calls `inputSubmissionRecord()` with
`providerPromptProfile(promptSource)`, so the real submission receipt can record
`provider_prompt_mode: "plain"` and `provider_prompt_prefix: ""` even while the
typed prompt starts with .

Minimal Foreman probe against the current head:

```json
{
  "firstTyped": "/",
  "provider_prompt_mode": "plain",
  "provider_prompt_prefix": ""
}
```

The direct helper test added by the Implementer commit does not catch this because it
passes `selectedProvider: "codex"` and `selectedDock: "implementer"` directly into
`submitLiveProviderPrompt()`.

## Required Behavior

- Preserve the accepted prompt construction behavior:
  - Codex/Implementer AFK PTY prompt starts with `Your work card is at ...`;
  - Foreman native dispatches remain plain pointers with no ``;
  - Operator and other providers remain unprefixed unless explicitly configured.
- Repair the actual live submission receipt source so Codex/Implementer records:
  - `provider_prompt_mode=codex_goal`;
  - `provider_prompt_prefix=""`.
- Keep slash prefix typing through the same character-by-character path from
  the first `/`.
- Add deterministic coverage for the boundary that failed. Do not rely only on
  a direct `submitLiveProviderPrompt()` test where the test manually supplies
  provider and dock fields that the real call path did not supply.
- Provider acceptance remains gated on snapshot identity or Codex metadata, not
  on prefix/key transport.

## Read First

- `AGENTS.md`
- the implementer native subagent instructions
- `docs/dev/active-profile.json`
- `docs/dev/workflow-profiles.json`
- `docs/design/work-cards/afk-dev-session-trigger-codex-prompt-prefix-transport-v0.md`
- `scripts/afk-launch-attempt-prototype.mjs`
- `tests/afk-launch-attempt-prototype.test.mjs`
- `tests/afk-session-trigger-prototype.test.mjs`

## Rediscover State

Run:

```bash
git status --short --branch
git rev-parse HEAD implementer/afk-dev-session-trigger-codex-prompt-prefix-transport-v0 6d83b6ee07dbffd6d9e93b6101caf288674c3aca
./aos ready
./aos dev recommend --json --paths scripts/afk-launch-attempt-prototype.mjs,tests/afk-launch-attempt-prototype.test.mjs,tests/afk-session-trigger-prototype.test.mjs
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

## Suggested Implementation Areas

- `scripts/afk-launch-attempt-prototype.mjs`
  - likely fix: carry the selected provider/dock or computed prompt profile into
    `liveProviderPromptSource`, or otherwise make the live submission receipt
    use the same prompt profile as prompt construction.
- `tests/afk-launch-attempt-prototype.test.mjs`
  - add a focused regression test for the actual source boundary that failed.
- `tests/afk-session-trigger-prototype.test.mjs`
  - update only if the corrected receipt source changes session-trigger fixture
    expectations.

## Hard Boundaries

- Do not run a live Codex provider launch in this correction.
- Do not read provider transcript bodies.
- Do not mutate provider store, catalog, telemetry, gateway, dock runtime,
  GitHub issues, PRs, or main.
- Do not mutate Codex config/keymaps.
- Do not remove or relax `--i-am-present`.
- Do not start async result routing.

## Verification

Run and report:

```bash
git status --short --branch
./aos ready
node --test tests/afk-launch-attempt-prototype.test.mjs
node --test tests/afk-session-trigger-prototype.test.mjs
node --test tests/sigil-agent-terminal-server.test.mjs
cd packages/host && npm test
git diff --check
```

## Completion Report Required

Return:

- branch and head SHA;
- base/start SHA;
- files changed;
- tests run and pass/fail counts;
- exact behavior change;
- how the actual live submission receipt source now records
  `provider_prompt_mode=codex_goal` and `provider_prompt_prefix=""`;
- what deterministic test would have failed before this correction;
- remaining need for Operator supervised live proof;
- explicit statement that no live provider launch, transcript body read,
  provider store/catalog/telemetry mutation, gateway/dock runtime mutation,
  GitHub issue/PR/main mutation, main merge, PR creation, or async result
  routing occurred beyond the expected Implementer branch push.
