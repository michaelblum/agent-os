# Work Card: AFK Sleep Lease Awake Guarded Live V0

**Status:** Ready for GDI

## Transfer Classification

- Recipient: GDI
- Transfer kind: GDI round
- Single next goal: allow the experimental AFK session trigger to combine a
  valid sleep lease with the existing human-present supervised-live launch path
  for one short awake proof, without enabling unattended or overnight behavior.
- Source artifacts:
  - `docs/design/notes/afk-sleep-lease-safety-contract-2026-05-24.md`
  - `docs/design/work-cards/afk-sleep-lease-safety-contract-v0.md`
  - `docs/design/work-cards/afk-sleep-lease-dry-run-validation-v0.md`
  - `docs/design/work-cards/afk-sleep-lease-result-route-compat-correction-v0.md`
  - `docs/design/work-cards/afk-dev-session-trigger-guarded-live-codex-launch-v0.md`
  - `scripts/afk-session-trigger-prototype.mjs`
  - `tests/afk-session-trigger-prototype.test.mjs`
  - `src/commands/dev.swift`
  - `src/shared/command-registry-data.swift`
  - `tests/dev-workflow-router.sh`
  - `tests/help-contract.sh`
- Branch/Base:
  - `branch_from: origin/main`
  - `required_start_ref: origin/main` with this work card present
- Branch/output expectation: create
  `gdi/afk-sleep-lease-awake-guarded-live-v0` from `origin/main`. Commit and
  push that GDI branch when verification passes. Do not open a PR, merge,
  mutate main, mutate GitHub issues/projects, start live providers, or route
  follow-up work.

## Fresh Context Contract

GDI starts from a fresh context window. Do not assume branch, worktree,
readiness, provider state, current CLI behavior, or prior sleep-lease details.
Read and rediscover before editing.

## Foreman State

The deterministic sleep-lease dry-run gate is accepted on `main` at
`fe5cb7be11c22b3287438aec9bcc95ca1df64433`.

The accepted safety sequence says the next gate is a short awake guarded-live
sleep-lease proof. Current source still rejects `--sleep-lease` when combined
with `--supervised-live-launch`, which is correct for the prior slice but now
blocks the next proof.

This source slice should add the guarded-live sleep-lease contract and
deterministic fixture coverage only. A later Operator card will run the real
short awake proof after Foreman accepts this branch.

## Goal

Make this shape valid when the lease and packet authorize exactly the selected
Codex/GDI supervised launch:

```bash
./aos dev afk-session-trigger \
  --packet <packet.json> \
  --sleep-lease <lease.json> \
  --supervised-live-launch \
  --i-am-present \
  --json
```

The command must still reject any attempt to use a sleep lease as an
unattended, background, warm-reuse, or overnight shortcut.

## Required Behavior

1. CLI/action compatibility:

   - Keep existing accepted dry-run sleep-lease behavior unchanged.
   - Allow `--sleep-lease` with
     `--supervised-live-launch --i-am-present --json`.
   - Preserve the existing `--i-am-present` guard. A sleep lease does not
     replace human presence for this awake proof.
   - Continue rejecting `--sleep-lease` with `--warm-dock-tui-reuse`.
   - Continue rejecting `--sleep-lease` with `--provider-launch-dry-run`.
   - Continue rejecting missing `--json`, missing action flags, conflicting
     action flags, unsupported provider, or unsupported dock through existing
     mismatch conventions.
   - Do not add `--unattended`, `--background`, `--overnight`, or any alias
     that launches without human presence.

2. Lease validation for supervised live:

   - Reuse the accepted dry-run lease validation for authorization fields,
     expiry, allowed docks/providers/work refs, branch policy, publication
     policy, result-route compatibility, and stop conditions.
   - For `supervised-live-launch`, require `max_provider_launches >= 1`.
     A lease with `max_provider_launches: 0` is still valid for dry-run but
     must reject before supervised launch with a named sleep-lease mismatch.
   - Keep `external_publication_policy="none"` required.
   - Keep `allow_main_mutation=false` required.
   - Keep `provider_budget.status="not_enforceable_yet"` informational for
     now, but preserve it in the receipt as wake-up disclosure evidence.
   - If any sleep-lease mismatch exists, no launch attempt should be created.

3. Receipt behavior:

   - Supervised live with an accepted sleep lease should keep
     `record_type="aos.afk_session_trigger_supervised_live"`.
   - `scheduler.lease` should summarize the accepted/rejected sleep lease, not
     fall back to `not_enforced`.
   - `sleep_lease.status` should be `accepted`, `rejected`, or `expired`
     consistently with dry-run behavior.
   - `dispatch.provider_launch_allowed` may become `true` only when all normal
     supervised-live guards, duplicate checks, and sleep-lease gates pass.
   - Rejected or expired leases must keep `provider_launch_allowed=false`,
     terminal `not_attempted`, and a named mismatch.
   - Preserve result-route receipt behavior: local stdout routes complete;
     unsupported external routes stay unsupported and cannot satisfy the lease.

4. Idempotence and duplicate safety:

   - Include sleep-lease identity in the idempotence material when a sleep
     lease is present. At minimum include `lease_id` and `lease_ref`.
   - Preserve existing duplicate suppression behavior.
   - Add focused coverage proving different lease ids for the same packet and
     action do not collide, while the same lease/work/action remains stable.

5. Deterministic launch evidence only:

   - Use the existing fixture-backed supervised-live tests and launch-attempt
     prototype behavior. Do not start a real Codex provider, bridge, tmux
     session, Agent Terminal surface, or live scheduler in this GDI round.
   - The branch should make the later Operator live proof possible; it should
     not perform that proof itself.

## Read First

- `AGENTS.md`
- `.docks/gdi/AGENTS.md`
- `docs/design/notes/afk-sleep-lease-safety-contract-2026-05-24.md`
- `docs/design/work-cards/afk-sleep-lease-safety-contract-v0.md`
- `docs/design/work-cards/afk-sleep-lease-dry-run-validation-v0.md`
- `docs/design/work-cards/afk-sleep-lease-result-route-compat-correction-v0.md`
- `docs/design/work-cards/afk-dev-session-trigger-guarded-live-codex-launch-v0.md`
- `scripts/afk-session-trigger-prototype.mjs`
- `tests/afk-session-trigger-prototype.test.mjs`
- `src/commands/dev.swift`
- `src/shared/command-registry-data.swift`
- `tests/dev-workflow-router.sh`
- `tests/help-contract.sh`

## Rediscover State

Run:

```bash
git status --short --branch
git rev-parse HEAD origin/main
./aos ready
./aos dev recommend --json --paths scripts/afk-session-trigger-prototype.mjs,tests/afk-session-trigger-prototype.test.mjs,src/commands/dev.swift,src/shared/command-registry-data.swift,tests/dev-workflow-router.sh,tests/help-contract.sh,docs/design/notes/afk-sleep-lease-safety-contract-2026-05-24.md,docs/design/work-cards/afk-sleep-lease-dry-run-validation-v0.md
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

## Hard Boundaries

- Do not start live providers, tmux sessions, terminal bridges, Agent Terminal
  surfaces, or live schedulers.
- Do not remove or relax `--i-am-present`.
- Do not add or enable unattended, background, or overnight live launch
  behavior.
- Do not allow sleep leases with warm dock TUI reuse in this slice.
- Do not read provider transcript bodies.
- Do not mutate provider stores, catalogs, telemetry, gateway/dock runtime,
  Codex configuration, dock profiles, hooks, or `.docks` role instructions.
- Do not implement gateway/broker, Slack, Foreman inbox, GitHub issue/PR
  comment, external notifier, or non-local async routes.
- Do not promote durable schemas.
- Do not create durable work/evidence records beyond existing local receipt
  output behavior.
- Do not create PRs, mutate GitHub issues/projects, merge to main, or route
  follow-up work.

## Verification

Run and report:

```bash
git status --short --branch
./aos ready
node --test tests/afk-session-trigger-prototype.test.mjs
bash tests/dev-workflow-router.sh
bash tests/help-contract.sh
./aos dev build --no-restart
git diff --check
```

If `scripts/afk-launch-attempt-prototype.mjs` or shared launch-attempt helpers
change unexpectedly, also run:

```bash
node --test tests/afk-launch-attempt-prototype.test.mjs
```

## Completion Report Required

Return:

- branch and head SHA;
- base/start SHA;
- files changed;
- exact sleep-lease compatibility behavior for dry-run and supervised live;
- exact mismatch emitted for `max_provider_launches: 0` with supervised live;
- idempotence material changes and duplicate-safety evidence;
- deterministic verification commands and results;
- `./aos ready` result or exact readiness blocker;
- explicit statement that no real provider launch, transcript body read,
  provider store/catalog/telemetry mutation, gateway/dock runtime mutation,
  GitHub issue/PR/main mutation, external notifier, durable work/evidence
  record, unattended trigger, or follow-up routing occurred beyond the expected
  GDI branch push.
