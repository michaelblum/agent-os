# Work Card: AFK Sleep Lease Unattended Live Mode V0

**Status:** Accepted

## Acceptance Result

Accepted on `main` through merge commit
`21788bfbcfe657dc7ce435b2ce798662926dc18e`, after the original Implementer head
`f5f6a65bdf894fab4c0632427b3e2954d19fcfbb` was corrected by
`3449c80b1a53497bbe86313f107c3e006ec1e294`.

Foreman accepted the combined live-mode and route-delivery correction after
verifying:

- distinct `--sleep-lease-live-launch` command shape;
- `record_type="aos.afk_session_trigger_sleep_lease_live"`;
- `scheduler.selected_action="sleep-lease-live-launch"`;
- `dispatch.human_supervision={ required: false, i_am_present: false }`;
- `--sleep-lease`, `--json`, and `--out` are required;
- conflicting `--dry-run`, `--supervised-live-launch`,
  `--warm-dock-tui-reuse`, `--i-am-present`, and
  `--provider-launch-dry-run` are rejected;
- start gates cover dirty worktree, start-ref mismatch, provider/dock/work ref,
  launch budget, wall-clock budget, branch/publication policy, and result-route
  delivery;
- pre-launch and final `--out` receipts are written for accepted runs;
- duplicate/idempotence behavior remains non-launching unless replacement is
  explicit.

The correction requires local artifact result routes to match the confirmed
`--out` path before launch. Non-matching local artifact routes now reject with
`sleep_lease_live_result_route_undeliverable`; stdout and matching `--out`
local artifact routes remain accepted.

Acceptance gates passed:

- `./aos ready`: `ready=true mode=repo daemon=reachable tap=active`;
- `node --test tests/afk-session-trigger-prototype.test.mjs`: 43/43 pass;
- `node --test tests/afk-launch-attempt-prototype.test.mjs`: 50/50 pass;
- `bash tests/dev-workflow-router.sh`: pass;
- `bash tests/help-contract.sh`: pass;
- `./aos dev build --no-restart`: pass / up to date;
- `git diff --check`: pass;
- targeted `sleep-lease live launch` tests: 7/7 pass;
- manual non-matching local artifact route smoke: pass.

Next routed proof:
`docs/design/work-cards/operator-afk-sleep-lease-live-mode-proof-v0.md`.
That proof is now accepted: Operator ran one real Codex/Implementer
`--sleep-lease-live-launch` without `--i-am-present`, observed provider
acceptance through bounded Codex metadata, verified cleanup, completed the
stdout result route, and kept branch push disabled.

## Transfer Classification

- Recipient: Implementer
- Transfer kind: Implementer round
- Single next goal: add a distinct experimental sleep-lease live mode with
  deterministic start gates and receipt updates so a later Operator run can
  attempt the first true overnight Implementer work card without using
  `--i-am-present`.
- Source artifacts:
  - `docs/design/notes/afk-sleep-lease-safety-contract-2026-05-24.md`
  - `docs/design/work-cards/operator-afk-sleep-lease-awake-guarded-live-proof-v0.md`
  - `docs/design/work-cards/afk-sleep-lease-awake-guarded-live-v0.md`
  - `scripts/afk-session-trigger-prototype.mjs`
  - `scripts/afk-launch-attempt-prototype.mjs`
  - `tests/afk-session-trigger-prototype.test.mjs`
  - `tests/afk-launch-attempt-prototype.test.mjs`
  - `src/commands/dev.swift`
  - `src/shared/command-registry-data.swift`
  - `tests/dev-workflow-router.sh`
  - `tests/help-contract.sh`
- Branch/Base:
  - `branch_from: origin/main`
  - `required_start_ref: origin/main` with this work card present
- Branch/output expectation: create
  `implementer/afk-sleep-lease-unattended-live-mode-v0` from `origin/main`. Commit and
  push that Implementer branch when verification passes. Do not open a PR, merge,
  mutate main, mutate GitHub issues/projects, start live providers, or route
  follow-up work.

## Fresh Context Contract

Implementer starts from a fresh context window. Do not assume branch, worktree,
readiness, provider state, current CLI behavior, or prior sleep-lease details.
Read and rediscover before editing.

## Foreman State

The dry-run sleep-lease gate and the short awake guarded-live proof have both
passed. Current source still requires `--supervised-live-launch --i-am-present`
for real provider launch. That is correct for awake proof, but it is not a true
sleep lease because the authorization depends on a human-present guard.

This source slice should create the next mode needed for a later first
overnight Operator run. It must be deterministic and fixture-backed only in
this Implementer round.

## Goal

Add a distinct experimental command shape for sleep-lease live launch. Use this
spelling unless source reading finds a narrower existing convention:

```bash
./aos dev afk-session-trigger \
  --packet <packet.json> \
  --sleep-lease <lease.json> \
  --sleep-lease-live-launch \
  --json \
  --out <receipt.json>
```

The sleep lease is the authorization for this mode. Do not require or accept
`--i-am-present` for `--sleep-lease-live-launch`.

## Required Behavior

1. CLI/action compatibility:

   - Add one new action flag for sleep-lease live launch.
   - Require `--sleep-lease`, `--json`, and `--out` for this action.
   - Reject this action when combined with `--dry-run`,
     `--supervised-live-launch`, `--warm-dock-tui-reuse`, `--i-am-present`, or
     `--provider-launch-dry-run`.
   - Keep existing dry-run, supervised-live, warm-reuse, and awake guarded
     sleep-lease behavior unchanged.
   - Do not add `--background`, `--overnight`, queue aliases, daemonized
     schedulers, or broad run loops.

2. Lease/start gates:

   Reuse accepted sleep-lease validation, then add gates specific to live
   unattended mode:

   - `max_provider_launches >= 1`;
   - command timestamp is before `expires_at`;
   - `max_wall_clock_minutes > 0`;
   - selected dock/provider/work ref/result route are authorized;
   - `external_publication_policy="none"`;
   - `allow_branch_push=false` for V0;
   - `allowed_branch_policy.allow_main_mutation=false`;
   - current worktree is clean. For V0, reject any dirty or untracked paths
     instead of accepting a dirty baseline;
   - current `HEAD` equals the resolved `required_start_ref`;
   - selected provider remains `codex` and selected dock remains `implementer`;
   - result route must normalize to local stdout or a local artifact path
     supported by the existing classifier.

   If any gate fails, no launch attempt should be created and the receipt must
   name the mismatch.

3. Receipt behavior:

   - Add a distinct record type such as
     `aos.afk_session_trigger_sleep_lease_live`.
   - Add `scheduler.selected_action="sleep-lease-live-launch"`.
   - Add `dispatch.human_supervision={ required: false, i_am_present: false }`.
   - Keep `scheduler.lease` and `sleep_lease` populated with accepted/rejected
     lease details.
   - Include the accepted start-gate facts needed for wake-up review:
     current branch, current head, required start ref/SHA, dirty-state status,
     branch push policy, provider launch count budget, lease expiry, selected
     work ref, selected dock/provider, and result route.
   - Rejected gates must keep `dispatch.provider_launch_allowed=false` and
     terminal substrate `not_attempted`.
   - Accepted fixture-backed runs may use existing launch-attempt fixtures to
     produce completed receipts.

4. Pre-launch and final `--out` receipts:

   - For `--sleep-lease-live-launch`, require `--out`.
   - Write a pre-launch receipt before creating a launch attempt. It should
     record that the lease and start gates were accepted and that provider
     launch is about to start.
   - Update the same `--out` path with the final receipt after launch attempt,
     provider acceptance classification, result-route classification, and
     cleanup classification.
   - Tests may verify this with fixtures and a temp output path. Do not create
     committed receipt artifacts.

5. Idempotence and duplicate safety:

   - Include action, packet/work ref, selected dock/provider, required start
     SHA, result route, lease id, and lease ref in idempotence material.
   - Preserve existing duplicate suppression for live terminal states.
   - A repeated sleep-lease live invocation with a completed compatible receipt
     must not relaunch unless `--replacement-for` is explicit and valid under
     existing replacement rules.

6. Deterministic only in this Implementer round:

   - Use fixture-backed launch evidence for tests.
   - Do not run a real Codex provider, bridge, tmux session, Agent Terminal
     surface, or live scheduler in this Implementer round.
   - The next Operator card will run the real first proof after Foreman accepts
     this branch.

## Read First

- `AGENTS.md`
- the implementer native subagent instructions
- `docs/design/notes/afk-sleep-lease-safety-contract-2026-05-24.md`
- `docs/design/work-cards/operator-afk-sleep-lease-awake-guarded-live-proof-v0.md`
- `docs/design/work-cards/afk-sleep-lease-awake-guarded-live-v0.md`
- `scripts/afk-session-trigger-prototype.mjs`
- `scripts/afk-launch-attempt-prototype.mjs`
- `tests/afk-session-trigger-prototype.test.mjs`
- `tests/afk-launch-attempt-prototype.test.mjs`
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
./aos dev recommend --json --paths scripts/afk-session-trigger-prototype.mjs,scripts/afk-launch-attempt-prototype.mjs,tests/afk-session-trigger-prototype.test.mjs,tests/afk-launch-attempt-prototype.test.mjs,src/commands/dev.swift,src/shared/command-registry-data.swift,tests/dev-workflow-router.sh,tests/help-contract.sh,docs/design/notes/afk-sleep-lease-safety-contract-2026-05-24.md
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

## Hard Boundaries

- Do not start live providers, tmux sessions, terminal bridges, Agent Terminal
  surfaces, or live schedulers.
- Do not remove or relax `--i-am-present` for existing supervised live mode.
- Do not make `--supervised-live-launch` act as an overnight mode.
- Do not enable queues, automatic follow-up card selection, branch push, PR
  creation, GitHub issue mutation, Slack/gateway notification, or external
  publication.
- Do not read provider transcript bodies.
- Do not mutate provider stores, catalogs, telemetry, gateway/dock runtime,
  Codex configuration, dock profiles, hooks, or `.docks` role instructions.
- Do not promote durable schemas.
- Do not create durable work/evidence records beyond the explicit local `--out`
  receipt path used in tests.
- Do not create PRs, mutate GitHub issues/projects, merge to main, or route
  follow-up work.

## Verification

Run and report:

```bash
git status --short --branch
./aos ready
node --test tests/afk-session-trigger-prototype.test.mjs
node --test tests/afk-launch-attempt-prototype.test.mjs
bash tests/dev-workflow-router.sh
bash tests/help-contract.sh
./aos dev build --no-restart
git diff --check
```

## Completion Report Required

Return:

- branch and head SHA;
- base/start SHA;
- files changed;
- exact CLI shape implemented;
- accepted sleep-lease live start gates;
- rejected gate examples and mismatch names, including dirty worktree and start
  ref mismatch;
- pre-launch and final `--out` receipt behavior;
- idempotence/duplicate behavior;
- deterministic verification commands and results;
- `./aos ready` result or exact readiness blocker;
- explicit statement that no real provider launch, transcript body read,
  provider store/catalog/telemetry mutation, gateway/dock runtime mutation,
  GitHub issue/PR/main mutation, external notifier, durable work/evidence
  record beyond temp/local `--out`, unattended live trigger, or follow-up
  routing occurred beyond the expected Implementer branch push.
