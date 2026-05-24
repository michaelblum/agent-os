# Work Card: AFK Warm Dock Inline Sentinel Contract V0

**Status:** Ready for GDI

## Transfer Classification

- Recipient: GDI
- Transfer kind: correction round
- Single next goal: make the warm-dock validation sentinel strict by putting the
  no-command boundary in the GDI prompt itself, with inbound-contract coverage,
  so a future Operator run does not require GDI to inspect a file before seeing
  that commands are forbidden.
- Source artifacts:
  - `docs/design/work-cards/operator-afk-warm-dock-tui-reuse-live-proof-v1.md`
  - `docs/design/work-cards/afk-warm-dock-tui-reuse-live-sentinel-v0.md`
  - `.docks/gdi/inbound-contract.json`
  - `shared/schemas/aos-dock-inbound-message-contract-v0.md`
  - `tests/schemas/aos-dock-inbound-message-contract-v0.test.mjs`
  - `scripts/dock-inbound-message-contract`
- Branch/Base:
  - `branch_from: origin/main`
  - `required_start_ref: origin/main` with this work card present
- Branch/output expectation: create
  `gdi/afk-warm-dock-inline-sentinel-contract-v0` from `origin/main`. Commit
  and push that GDI branch when verification passes. Do not open a PR, merge,
  mutate main, mutate GitHub issues/projects, or route the next Operator run.

## Fresh Context Contract

GDI starts from a fresh context window. Do not assume branch, worktree,
readiness, daemon state, live terminal state, or prior proof state. Read and
rediscover before editing.

## Foreman Review Finding

The V1 warm-dock Operator run proved the functional behavior:

- existing warm GDI terminal was reused;
- `/clear` then `/goal <pointer>` was sent;
- the sentinel was accepted;
- no stale-goal/repeated-completion behavior occurred;
- no mutation occurred.

But it was not a strict pass because the sentinel was a file pointer:

```text
follow the instructions in docs/design/work-cards/afk-warm-dock-tui-reuse-live-sentinel-v0.md
```

GDI had to inspect the file before seeing:

```text
Do not run shell commands.
```

That caused a contract exception: GDI ran a command to inspect the work card
before seeing the no-command instruction. The fix is not to retry live proof.
The fix is to define a validation-only inline GDI payload whose prompt itself
contains the no-command boundary.

## Goal

Add a deterministic contract shape for a warm-dock validation sentinel that is
safe to paste after `/clear` as `/goal <payload>` and does not require GDI to
read a file.

Use this payload shape unless source reading finds a narrower local convention:

```text
Warm dock TUI reuse validation only. Do not run shell commands, edit files, read provider transcript files, open GitHub, create branches, commit, push, or route follow-up work. Reply with a concise confirmation that this prompt was accepted in the current warm GDI terminal and whether stale-goal or repeated-completion behavior occurred.
```

Avoid the known loop-prone wording:

- do not say `reply exactly`;
- do not say `proof only`.

## Required Behavior

- Add an explicit allowed GDI inbound payload kind for bounded validation-only
  inline instructions that do not require reading a work card.
- Preserve the normal GDI implementation-routing preference for durable
  work-card pointers. This inline shape is only for short supervised live
  validation where reading a file would violate the proof contract.
- Ensure the proposed inline payload validates through
  `scripts/dock-inbound-message-contract --target-dock gdi --json` with:
  - `ok=true`;
  - `provider_entry_prefix="/goal "`;
  - `provider_entry_preview` equal to `/goal ` plus the inline payload;
  - no `gdi_one_shot_reply_exactly_risk`;
  - no `repeated_completion_loop_risk`;
  - no errors.
- Update `docs/design/work-cards/afk-warm-dock-tui-reuse-live-sentinel-v0.md`
  so it is not used as the GDI prompt for no-command validation. It may remain
  as context, but it must say the V1 pointer shape was superseded because it
  required a command to inspect before learning the no-command boundary.
- Do not create the next Operator proof card. Foreman will route the V2 live
  proof after accepting this deterministic correction.

## Read First

- `AGENTS.md`
- `.docks/gdi/AGENTS.md`
- `.docks/gdi/inbound-contract.json`
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
./aos dev recommend --json --paths .docks/gdi/inbound-contract.json,shared/schemas/aos-dock-inbound-message-contract-v0.md,tests/schemas/aos-dock-inbound-message-contract-v0.test.mjs,scripts/lib/dock-inbound-message-contract.mjs,docs/design/work-cards/afk-warm-dock-tui-reuse-live-sentinel-v0.md
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

## Existing Code And Docs To Inspect

- `.docks/gdi/inbound-contract.json` - owns allowed payload descriptions,
  `/goal ` provider prefix, forbidden loop-prone prompt shapes, and recovery
  guidance.
- `tests/schemas/aos-dock-inbound-message-contract-v0.test.mjs` - owns schema
  and sample payload contract tests.
- `scripts/lib/dock-inbound-message-contract.mjs` - owns actual validation and
  diagnostic behavior.
- `docs/design/work-cards/afk-warm-dock-tui-reuse-live-sentinel-v0.md` - the
  old pointer-shaped sentinel context that needs supersession guidance.

## Hard Boundaries

- Do not run a live Operator or GDI proof.
- Do not drive real Foreman/GDI/Operator terminals.
- Do not read provider transcript bodies.
- Do not mutate provider store, catalog, telemetry, gateway, dock runtime,
  GitHub issues, PRs, or main.
- Do not implement gateway/broker, Slack, Foreman inbox, GitHub issue/PR
  comment, or external notifier routes.
- Do not change the normal GDI implementation work-card pointer flow.
- Do not remove the existing warnings for `reply exactly` or `proof only`.

## Verification

Run and report:

```bash
git status --short --branch
./aos ready
node --test tests/schemas/aos-dock-inbound-message-contract-v0.test.mjs
printf '%s' 'Warm dock TUI reuse validation only. Do not run shell commands, edit files, read provider transcript files, open GitHub, create branches, commit, push, or route follow-up work. Reply with a concise confirmation that this prompt was accepted in the current warm GDI terminal and whether stale-goal or repeated-completion behavior occurred.' | scripts/dock-inbound-message-contract --target-dock gdi --json
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
- inbound-contract JSON result summary for that payload;
- confirmation that existing `reply exactly` and `proof only` warnings remain
  covered;
- confirmation that the old pointer sentinel is marked superseded or
  redirected for no-command validation;
- explicit statement that no live provider launch, transcript body read,
  provider store/catalog/telemetry mutation, gateway/dock runtime mutation,
  GitHub issue/PR/main mutation, main merge, PR creation, external notifier,
  durable work/evidence record, unsupervised trigger, or live terminal driving
  occurred beyond the expected GDI branch push.
