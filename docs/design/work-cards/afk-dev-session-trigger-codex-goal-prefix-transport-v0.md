# Work Card: AFK Dev Session Trigger Codex Goal Prefix Transport V0

**Status:** Routed 2026-05-23

## Transfer Classification

- Recipient: GDI
- Transfer kind: correction round
- Single next goal: add provider-native prompt prefix support for AFK PTY
  automation so Codex/GDI live launches type `/goal ` before the short
  file-backed work-card pointer, while preserving the human clipboard convention
  that dispatches stay plain pointers with no `/goal`.
- Source artifacts:
  - `docs/design/work-cards/afk-dev-session-trigger-provider-prompt-execution-observation-v0.md`
  - `scripts/afk-launch-attempt-prototype.mjs`
  - `scripts/afk-session-trigger-prototype.mjs`
  - `tests/afk-launch-attempt-prototype.test.mjs`
  - `tests/afk-session-trigger-prototype.test.mjs`
- Branch/Base:
  - `branch_from: foreman/afk-provider-native-goal-prefix-v0`
  - `required_start_ref: foreman/afk-provider-native-goal-prefix-v0`
  - Accepted input-timing source head:
    `47647c316d6d78a98ce525641ecb4aa05c7fc72e`
  - Input-timing source base:
    `9e80f6de66bbeb419840ce3b1c438fcfb24df2ef`
- Branch/output expectation: create
  `gdi/afk-dev-session-trigger-codex-goal-prefix-transport-v0` from the
  required start ref. Commit and push that GDI branch when verification passes,
  per the active `agentic_relay` profile. Do not open a PR, merge, mutate
  GitHub state beyond the branch push, or start async result routing.

## Fresh Context Contract

GDI starts from a fresh context window. Rediscover branch, worktree, readiness,
current source, tests, and this work card before editing.

## Foreman Review Finding

The accepted input-timing branch intentionally made the live prompt short and
file-backed:

```text
Your work card is at docs/design/work-cards/<slug>.md. Read it first, then begin.
```

That satisfies the pointer-prompt transport work, but it misses the newer
provider-adapter rule: AFK PTY automation should allow the provider adapter to
own provider-native execution syntax. For Codex/GDI, the default execution mode
should type:

```text
/goal Your work card is at docs/design/work-cards/<slug>.md. Read it first, then begin.
```

The old "do not add `/goal`" guidance remains correct for Foreman clipboard
dispatches because humans paste and can recover manually. It should not govern
AFK PTY automation, where the trigger layer types characters into an empty
composer after startup settle and submits with an isolated final Enter.

## Required Behavior

- Keep Foreman clipboard dispatches unchanged: plain pointer text, no `/goal`.
- Add provider-owned AFK PTY prompt prefixing:
  - Codex/GDI default execution mode: `/goal`;
  - Operator default: no slash command unless explicitly configured;
  - other providers: no slash command unless explicitly configured.
- The Codex/GDI AFK PTY prompt should be:

```text
/goal Your work card is at docs/design/work-cards/<slug>.md. Read it first, then begin.
```

- Preserve the accepted input transport mechanics:
  - file-backed work card pointer;
  - centralized timing profile;
  - startup settle before typing;
  - character-by-character typing from the first `/`;
  - no short-prompt fast path;
  - isolated final `/key Enter`.
- Keep the prompt short, still around the same bound as the pointer prompt. The
  `/goal ` prefix should not reintroduce full payload transport.
- Record provider prompt mode and prefix in receipt evidence. Use names like:
  - `provider_prompt_mode=codex_goal`;
  - `provider_prompt_prefix="/goal "`;
  - `prompt_transport=file_pointer`;
  - `prompt_ref=docs/design/work-cards/<slug>.md`.
- Acceptance remains unchanged: slash prefix typing and key delivery are
  transport evidence only. Provider acceptance still requires snapshot identity
  or metadata-backed Codex thread identity.

## Read First

- `AGENTS.md`
- `.docks/gdi/AGENTS.md`
- `docs/dev/active-profile.json`
- `docs/dev/workflow-profiles.json`
- `docs/design/work-cards/afk-dev-session-trigger-provider-prompt-execution-observation-v0.md`
- `scripts/afk-launch-attempt-prototype.mjs`
- `scripts/afk-session-trigger-prototype.mjs`
- `tests/afk-launch-attempt-prototype.test.mjs`
- `tests/afk-session-trigger-prototype.test.mjs`

## Rediscover State

Run:

```bash
git status --short --branch
git rev-parse HEAD foreman/afk-provider-native-goal-prefix-v0 47647c316d6d78a98ce525641ecb4aa05c7fc72e
./aos ready
./aos dev recommend --json --paths scripts/afk-launch-attempt-prototype.mjs,scripts/afk-session-trigger-prototype.mjs,tests/afk-launch-attempt-prototype.test.mjs,tests/afk-session-trigger-prototype.test.mjs
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

## Deterministic Tests To Add Or Update

- Add or update a launch-attempt test proving Codex/GDI live prompt construction
  starts with `/goal Your work card is at ...`.
- Add or update character-typing tests proving the first typed character is `/`
  and the slash prefix is typed through the same `typeCharacters()` path.
- Add receipt assertions for `provider_prompt_mode=codex_goal` and
  `provider_prompt_prefix="/goal "`.
- Add or preserve a non-Codex/non-GDI case proving the prefix is not applied
  where it is not configured.
- Preserve existing tests for pointer prompt bounds, timing constants, isolated
  submit, provider-execution-unobserved, metadata promotion, cleanup, and
  duplicate suppression.

## Verification

Run and report:

```bash
git status --short --branch
./aos ready
node --test tests/afk-session-trigger-prototype.test.mjs
node --test tests/afk-launch-attempt-prototype.test.mjs
node --test tests/sigil-agent-terminal-server.test.mjs
cd packages/host && npm test
git diff --check
```

Do not run a live Codex provider launch in this GDI round. Foreman will route
the next Operator supervised proof after accepting this deterministic
correction.

## Stop Conditions

- Repo-mode TCC/Input Monitoring readiness blocks after the standard GDI helper.
- The correction requires a live Codex launch.
- The correction requires provider transcript body reads or provider-owned store
  mutation.
- The correction requires Codex config/keymap mutation.
- Scope expands into async result routing, final session command design,
  GitHub mutation, PR creation, or removing `--i-am-present`.

## Completion Report Required

Return:

- branch and head SHA;
- base/start SHA;
- files changed;
- tests run and pass/fail counts;
- exact behavior change;
- whether Codex/GDI AFK prompt now includes `/goal `;
- how receipt evidence records provider prompt mode and prefix;
- remaining need for Operator supervised live proof;
- explicit statement that no live provider launch, transcript body read,
  provider store/catalog/telemetry mutation, gateway/dock/GitHub mutation,
  main merge, PR creation, or async result routing occurred.
