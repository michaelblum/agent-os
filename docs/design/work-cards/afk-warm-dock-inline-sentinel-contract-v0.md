# Work Card: AFK Warm Dock Inline Sentinel Contract V0

**Status:** Accepted 2026-05-24

## Result

- Foreman review: accepted.
- Branch/ref gates passed on
  `implementer/afk-warm-dock-inline-sentinel-contract-v0` at
  `4e6c42541b9802401f33fb32d15f7ce97ae1b2a9`, based on
  `f6a7dbd089da73aba0f4ce51a502f17f91f66fa1`.
- Diff was scoped to:
  - the implementer native prompt contract;
  - `shared/schemas/aos-dock-inbound-message-contract-v0.md`;
  - `tests/schemas/aos-dock-inbound-message-contract-v0.test.mjs`;
  - `docs/design/work-cards/afk-warm-dock-tui-reuse-live-sentinel-v0.md`.
- Behavior accepted: the Implementer native subagent prompt contract now declares
  `warm_dock_validation_inline_instruction` for short supervised live
  validation where the no-command boundary must be visible in the prompt
  itself, and the old pointer sentinel is marked superseded for no-command
  warm-dock validation.
- Verification rerun by Foreman passed:
  - `node --test tests/schemas/aos-dock-inbound-message-contract-v0.test.mjs`
    with 10/10 passing;
  - direct inline payload validation with `ok=true`,
    `provider_entry_prefix=""`, and `diagnostics=[]`;
  - `git diff --check origin/main...HEAD`.
- Existing `reply exactly` and `proof only` loop-risk warnings remained covered.
- Follow-up routed and accepted:
  `docs/design/work-cards/operator-afk-warm-dock-tui-reuse-live-proof-v2.md`.
- No live provider launch, transcript body read, provider store/catalog/
  telemetry mutation, gateway/dock runtime mutation, GitHub issue/PR/main
  mutation, main merge, PR creation, external notifier, durable work/evidence
  record, unsupervised trigger, or live terminal driving occurred during this
  deterministic Implementer correction beyond the expected Implementer branch push.

## Transfer Classification

- Recipient: Implementer
- Transfer kind: correction round
- Single next goal: make the warm-dock validation sentinel strict by putting the
  no-command boundary in the Implementer prompt itself, with native subagent prompt contract coverage,
  so a future Operator run does not require Implementer to inspect a file before seeing
  that commands are forbidden.
- Source artifacts:
  - `docs/design/work-cards/operator-afk-warm-dock-tui-reuse-live-proof-v1.md`
  - `docs/design/work-cards/afk-warm-dock-tui-reuse-live-sentinel-v0.md`
  - the implementer native prompt contract
  - `shared/schemas/aos-dock-inbound-message-contract-v0.md`
  - `tests/schemas/aos-dock-inbound-message-contract-v0.test.mjs`
  - `scripts/dock-inbound-message-contract`
- Branch/Base:
  - `branch_from: origin/main`
  - `required_start_ref: origin/main` with this work card present
- Branch/output expectation: create
  `implementer/afk-warm-dock-inline-sentinel-contract-v0` from `origin/main`. Commit
  and push that Implementer branch when verification passes. Do not open a PR, merge,
  mutate main, mutate GitHub issues/projects, or route the next Operator run.

## Fresh Context Contract

Implementer starts from a fresh context window. Do not assume branch, worktree,
readiness, daemon state, live terminal state, or prior proof state. Read and
rediscover before editing.

## Foreman Review Finding

The V1 warm-dock Operator run proved the functional behavior:

- existing warm Implementer terminal was reused;
- `/clear` then `<pointer>` was sent;
- the sentinel was accepted;
- no stale-goal/repeated-completion behavior occurred;
- no mutation occurred.

But it was not a strict pass because the sentinel was a file pointer:

```text
follow the instructions in docs/design/work-cards/afk-warm-dock-tui-reuse-live-sentinel-v0.md
```

Implementer had to inspect the file before seeing:

```text
Do not run shell commands.
```

That caused a contract exception: Implementer ran a command to inspect the work card
before seeing the no-command instruction. The fix is not to retry live proof.
The fix is to define a validation-only inline Implementer payload whose prompt itself
contains the no-command boundary.

## Goal

Add a deterministic contract shape for a warm-dock validation sentinel that is
safe to paste after `/clear` as `<payload>` and does not require Implementer to
read a file.

Use this payload shape unless source reading finds a narrower local convention:

```text
Warm dock TUI reuse validation only. Do not run shell commands, edit files, read provider transcript files, open GitHub, create branches, commit, push, or route follow-up work. Reply with a concise confirmation that this prompt was accepted in the current warm Implementer terminal and whether stale-goal or repeated-completion behavior occurred.
```

Avoid the known loop-prone wording:

- do not say `reply exactly`;
- do not say `proof only`.

## Required Behavior

- Add an explicit allowed Implementer inbound payload kind for bounded validation-only
  inline instructions that do not require reading a work card.
- Preserve the normal Implementer implementation-routing preference for durable
  work-card pointers. This inline shape is only for short supervised live
  validation where reading a file would violate the proof contract.
- Ensure the proposed inline payload validates through
  `scripts/dock-inbound-message-contract --target-dock implementer --json` with:
  - `ok=true`;
  - `provider_entry_prefix=""`;
  - `provider_entry_preview` equal to  plus the inline payload;
  - no `implementer_one_shot_reply_exactly_risk`;
  - no `repeated_completion_loop_risk`;
  - no errors.
- Update `docs/design/work-cards/afk-warm-dock-tui-reuse-live-sentinel-v0.md`
  so it is not used as the Implementer prompt for no-command validation. It may remain
  as context, but it must say the V1 pointer shape was superseded because it
  required a command to inspect before learning the no-command boundary.
- Do not create the next Operator proof card. Foreman will route the V2 live
  proof after accepting this deterministic correction.

## Read First

- `AGENTS.md`
- the implementer native subagent instructions
- the implementer native prompt contract
- `shared/schemas/aos-dock-inbound-message-contract-v0.md`
- `tests/schemas/aos-dock-inbound-message-contract-v0.test.mjs`
- `scripts/lib/dock-inbound-message-contract.mjs`
- `docs/design/work-cards/operator-afk-warm-dock-tui-reuse-live-proof-v1.md`
- `docs/design/work-cards/afk-warm-dock-tui-reuse-live-sentinel-v0.md`

## Rediscover State

Run:

```bash
git status --short --branch
git rev-parse HEAD origin/main
./aos ready
./aos dev recommend --json --paths the implementer native prompt contract,shared/schemas/aos-dock-inbound-message-contract-v0.md,tests/schemas/aos-dock-inbound-message-contract-v0.test.mjs,scripts/lib/dock-inbound-message-contract.mjs,docs/design/work-cards/afk-warm-dock-tui-reuse-live-sentinel-v0.md
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

## Existing Code And Docs To Inspect

- the implementer native prompt contract - owns allowed payload descriptions,
   provider prefix, forbidden loop-prone prompt shapes, and recovery
  guidance.
- `tests/schemas/aos-dock-inbound-message-contract-v0.test.mjs` - owns schema
  and sample payload contract tests.
- `scripts/lib/dock-inbound-message-contract.mjs` - owns actual validation and
  diagnostic behavior.
- `docs/design/work-cards/afk-warm-dock-tui-reuse-live-sentinel-v0.md` - the
  old pointer-shaped sentinel context that needs supersession guidance.

## Hard Boundaries

- Do not run a live Operator or Implementer proof.
- Do not drive real Foreman/Implementer/Operator terminals.
- Do not read provider transcript bodies.
- Do not mutate provider store, catalog, telemetry, gateway, dock runtime,
  GitHub issues, PRs, or main.
- Do not implement gateway/broker, Slack, Foreman inbox, GitHub issue/PR
  comment, or external notifier routes.
- Do not change the normal Implementer implementation work-card pointer flow.
- Do not remove the existing warnings for `reply exactly` or `proof only`.

## Verification

Run and report:

```bash
git status --short --branch
./aos ready
node --test tests/schemas/aos-dock-inbound-message-contract-v0.test.mjs
printf '%s' 'Warm dock TUI reuse validation only. Do not run shell commands, edit files, read provider transcript files, open GitHub, create branches, commit, push, or route follow-up work. Reply with a concise confirmation that this prompt was accepted in the current warm Implementer terminal and whether stale-goal or repeated-completion behavior occurred.' | scripts/dock-inbound-message-contract --target-dock implementer --json
git diff --check
```

The direct `scripts/dock-inbound-message-contract` output must show `ok=true`
and no warnings/errors for the new inline payload.

## Completion Report Required

Return:

- branch and head SHA;
- base/start SHA;
- files changed;
- tests/commands run with pass/fail results;
- exact inline validation payload;
- native subagent prompt contract JSON result summary for that payload;
- confirmation that existing `reply exactly` and `proof only` warnings remain
  covered;
- confirmation that the old pointer sentinel is marked superseded or
  redirected for no-command validation;
- explicit statement that no live provider launch, transcript body read,
  provider store/catalog/telemetry mutation, gateway/dock runtime mutation,
  GitHub issue/PR/main mutation, main merge, PR creation, external notifier,
  durable work/evidence record, unsupervised trigger, or live terminal driving
  occurred beyond the expected Implementer branch push.
