# Work Card: AFK Dev Session Trigger Codex Goal Prefix Receipt Source Correction V0

**Status:** Routed 2026-05-23

## Transfer Classification

- Recipient: GDI
- Transfer kind: correction round
- Single next goal: make the real live Codex/GDI AFK prompt submission receipt
  record `provider_prompt_mode=codex_goal` and
  `provider_prompt_prefix="/goal "` from the same source used by the actual
  submission call path, not only from direct helper tests.
- Source artifacts:
  - `docs/design/work-cards/afk-dev-session-trigger-codex-goal-prefix-transport-v0.md`
  - `.docks/foreman/packets/to-gdi-afk-dev-session-trigger-codex-goal-prefix-receipt-source-correction-v0.json`
  - GDI implementation commit:
    `6d83b6ee07dbffd6d9e93b6101caf288674c3aca`
  - `scripts/afk-launch-attempt-prototype.mjs`
  - `tests/afk-launch-attempt-prototype.test.mjs`
  - `tests/afk-session-trigger-prototype.test.mjs`
- Branch/Base:
  - `branch_from: gdi/afk-dev-session-trigger-codex-goal-prefix-transport-v0`
  - `required_start_ref: gdi/afk-dev-session-trigger-codex-goal-prefix-transport-v0`
  - Required implementation input head:
    `6d83b6ee07dbffd6d9e93b6101caf288674c3aca`
  - Start from the local branch head that contains this work card. Do not reset
    to `origin/gdi/afk-dev-session-trigger-codex-goal-prefix-transport-v0` if
    that would remove this correction card.
- Branch/output expectation: reuse
  `gdi/afk-dev-session-trigger-codex-goal-prefix-transport-v0`, add a focused
  correction commit, and push that GDI branch when verification passes under
  the active `agentic_relay` profile. Do not open a PR, merge, mutate main, or
  mutate GitHub issues/projects. Do not start async result routing.

## Fresh Context Contract

GDI starts from a fresh context window. Do not assume branch, worktree,
readiness, daemon state, or the prior review result. Read and rediscover before
editing.

## Foreman Review Finding

The current GDI commit builds the Codex/GDI live prompt with `/goal ` because
`buildAttemptContext()` passes `selectedProvider` and `selectedDock` into the
prompt construction context.

The receipt source passed to the actual live submission path is different:
`liveProviderPromptSource` omits `selectedProvider` and `selectedDock`, then
`observeProviderTerminalSubstrate()` passes it to `submitLiveProviderPrompt()`.
That function calls `inputSubmissionRecord()` with
`providerPromptProfile(promptSource)`, so the real submission receipt can record
`provider_prompt_mode: "plain"` and `provider_prompt_prefix: ""` even while the
typed prompt starts with `/goal `.

Minimal Foreman probe against the current head:

```json
{
  "firstTyped": "/",
  "provider_prompt_mode": "plain",
  "provider_prompt_prefix": ""
}
```

The direct helper test added by the GDI commit does not catch this because it
passes `selectedProvider: "codex"` and `selectedDock: "gdi"` directly into
`submitLiveProviderPrompt()`.

## Required Behavior

- Preserve the accepted prompt construction behavior:
  - Codex/GDI AFK PTY prompt starts with `/goal Your work card is at ...`;
  - Foreman clipboard dispatches remain plain pointers with no `/goal`;
  - Operator and other providers remain unprefixed unless explicitly configured.
- Repair the actual live submission receipt source so Codex/GDI records:
  - `provider_prompt_mode=codex_goal`;
  - `provider_prompt_prefix="/goal "`.
- Keep slash prefix typing through the same character-by-character path from
  the first `/`.
- Add deterministic coverage for the boundary that failed. Do not rely only on
  a direct `submitLiveProviderPrompt()` test where the test manually supplies
  provider and dock fields that the real call path did not supply.
- Provider acceptance remains gated on snapshot identity or Codex metadata, not
  on prefix/key transport.

## Read First

- `AGENTS.md`
- `.docks/gdi/AGENTS.md`
- `docs/dev/active-profile.json`
- `docs/dev/workflow-profiles.json`
- `docs/design/work-cards/afk-dev-session-trigger-codex-goal-prefix-transport-v0.md`
- `scripts/afk-launch-attempt-prototype.mjs`
- `tests/afk-launch-attempt-prototype.test.mjs`
- `tests/afk-session-trigger-prototype.test.mjs`

## Rediscover State

Run:

```bash
git status --short --branch
git rev-parse HEAD gdi/afk-dev-session-trigger-codex-goal-prefix-transport-v0 6d83b6ee07dbffd6d9e93b6101caf288674c3aca
./aos ready
./aos dev recommend --json --paths scripts/afk-launch-attempt-prototype.mjs,tests/afk-launch-attempt-prototype.test.mjs,tests/afk-session-trigger-prototype.test.mjs
```

If `./aos ready` reports a repo-mode Accessibility, Input Monitoring, or
inactive input-tap blocker, run:

```bash
.docks/gdi/scripts/human-needed-tcc-reset
```

Then stop with `human_needed`. After the human returns with `ready`, run:

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
  `provider_prompt_mode=codex_goal` and `provider_prompt_prefix="/goal "`;
- what deterministic test would have failed before this correction;
- remaining need for Operator supervised live proof;
- explicit statement that no live provider launch, transcript body read,
  provider store/catalog/telemetry mutation, gateway/dock runtime mutation,
  GitHub issue/PR/main mutation, main merge, PR creation, or async result
  routing occurred beyond the expected GDI branch push.
