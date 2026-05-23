# Work Card: AFK Dev Session Trigger Packet Validation Status Correction V0

**Status:** Accepted 2026-05-22

## Foreman Acceptance

Accepted correction commit:
`8b65c536ae12fbd827632e17f8f8e38cabe11490`
(`fix(afk): separate packet validation from runtime status`).

The correction satisfies Foreman's packet-validation finding:

- `packet.validation_status` is now based on packet/current-state/pre-launch
  intake mismatches captured before duplicate/runtime/provider/cleanup
  mismatches are appended;
- runtime outcomes such as `provider_acceptance_unobserved` and
  `cleanup_unverified` remain visible in top-level `status`,
  `scheduler.lifecycle_state`, and `mismatches`;
- valid supervised provider timeout receipts with verified cleanup now keep
  `packet.validation_status=valid`;
- valid cleanup-failure receipts now keep `packet.validation_status=valid`
  while still returning `status=cleanup_unverified`;
- guard failures and invalid intake facts still return
  `packet.validation_status=invalid` and do not permit launch.

Verification:

```text
git status --short --branch
## gdi/afk-dev-session-trigger-packet-validation-status-correction-v0

./aos ready
ready=true mode=repo daemon=reachable tap=active

node --test tests/afk-session-trigger-prototype.test.mjs
15 tests passed

git diff --check 37f81c517522255bad56ed57f1ef8a914f994c81..HEAD
passed
```

Foreman reran the deterministic repro that found the issue. With a valid
packet, present source artifact, resolving durable ref, internal provider
dry-run, and verified cleanup fixture, the receipt now returns:

```json
{
  "status": "provider_acceptance_unobserved",
  "packet_validation_status": "valid",
  "cleanup_status": "verified",
  "mismatch_classes": ["provider_acceptance_unobserved"]
}
```

No live provider launch, real transcript read, provider config/session/catalog
mutation, gateway state, dock profile/hook mutation, GitHub state, push, PR, or
external publication happened during Foreman acceptance.

## Transfer Classification

- Recipient: GDI
- Transfer kind: correction round
- Single next goal: correct the AFK session-trigger receipt so
  `packet.validation_status` reflects packet/current-state intake validation,
  not runtime/provider outcome mismatches such as
  `provider_acceptance_unobserved`.
- Source artifacts:
  - `docs/design/work-cards/operator-afk-dev-session-trigger-cleanup-proof-live-v0.md`
  - `docs/design/work-cards/afk-dev-session-trigger-live-cleanup-proof-v0.md`
  - `docs/design/work-cards/afk-dev-session-trigger-live-cleanup-process-correction-v0.md`
- Branch/Base:
  - `branch_from: docs/durable-agent-cognition-v0`
  - `required_start_ref: docs/durable-agent-cognition-v0`
- Branch/output expectation: create or reuse a scoped local output branch from
  `docs/durable-agent-cognition-v0`. A suitable branch name is
  `gdi/afk-dev-session-trigger-packet-validation-status-correction-v0`. Keep
  the checkpoint local; do not push, open a PR, mutate GitHub, or publish
  externally.

## Fresh Context Contract

GDI starts from a fresh context window. Do not assume branch, worktree, daemon,
bridge process, provider session, transcript/catalog state, Operator evidence,
or Foreman's review details beyond this card. Read and rediscover before
editing.

## Foreman Review Finding

The accepted Operator cleanup-proof live run returned the expected non-completed
runtime state:

```text
status=provider_acceptance_unobserved
provider_acceptance.status=provider_acceptance_unobserved
cleanup.status=verified
cleanup proof kinds included:
  owned_bridge_process_exit
  owned_bridge_health_unreachable_after_teardown
  owned_process_driver_child_exit
  owned_provider_command_child_exit
```

No helper-owned bridge, PTY, owned process group, or nested
`codex --no-alt-screen` remained after the run.

However, the receipt also reported:

```text
packet.validation_status=invalid
```

That is misleading. The packet itself was valid enough to pass the guarded
pre-launch checks and start the real supervised branch. Foreman reproduced the
same issue deterministically without a live provider: a valid packet, present
source artifact, resolving `docs/durable-agent-cognition-v0`, internal
provider-launch dry-run, and verified cleanup fixture still returned
`packet.validation_status=invalid` solely because the final mismatch list
contained `provider_acceptance_unobserved`.

The likely cause is in `scripts/afk-session-trigger-prototype.mjs`: the code
sets `packet.validation_status` from the full `mismatches` list after appending
runtime/launch-attempt mismatches. Packet validation should not be invalidated
by a valid non-completed provider outcome.

## Read First

- `AGENTS.md`
- `.docks/gdi/AGENTS.md`
- `docs/design/durable-agent-cognition-and-afk-primitives.md`
- `docs/design/work-cards/operator-afk-dev-session-trigger-cleanup-proof-live-v0.md`
- `docs/design/work-cards/afk-dev-session-trigger-live-cleanup-proof-v0.md`
- `scripts/afk-session-trigger-prototype.mjs`
- `tests/afk-session-trigger-prototype.test.mjs`

## Rediscover State

Run:

```bash
git status --short --branch
git rev-parse HEAD docs/durable-agent-cognition-v0
./aos ready
./aos dev recommend --json --paths scripts/afk-session-trigger-prototype.mjs,tests/afk-session-trigger-prototype.test.mjs
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

## Existing Code To Inspect

- `scripts/afk-session-trigger-prototype.mjs` - owns packet/current-state
  validation, launch-attempt mismatch aggregation, receipt status, and
  `packet.validation_status`.
- `tests/afk-session-trigger-prototype.test.mjs` - owns deterministic receipt
  expectations for dry-run, guarded live, cleanup, duplicate, and non-completed
  provider outcomes.

## Required Behavior

- `packet.validation_status` must describe packet/current-state/pre-launch
  intake validation only.
- A valid packet that reaches the supervised provider branch and returns
  `provider_acceptance_unobserved` with `cleanup.status=verified` must keep
  `packet.validation_status=valid`.
- A valid packet that reaches the supervised provider branch and returns
  `cleanup_unverified` because cleanup proof failed may keep top-level
  `status=cleanup_unverified`, but packet validation should remain `valid`
  unless the packet/current-state intake facts are invalid.
- Invalid packet/current-state facts must still set
  `packet.validation_status=invalid` and must not permit launch.
- Top-level receipt `status`, `scheduler.lifecycle_state`, and `mismatches`
  should continue to report runtime/provider outcomes such as
  `provider_acceptance_unobserved` and `cleanup_unverified`.
- Do not remove or hide the runtime mismatch; separate its meaning from packet
  validation.

## Scope And Hard Boundaries

- This is a deterministic source correction for receipt classification.
- Do not run a live Codex, Claude, Gemini, tmux, provider terminal, or real
  bridge session in this GDI round.
- Do not read real provider transcript bodies.
- Do not mutate provider configs, provider session files, provider transcripts,
  provider catalogs, telemetry stores, gateway state, dock profiles, hooks,
  GitHub state, pushes, or PRs.
- Do not add final `aos session ...` spelling, unattended scheduling, prompt
  submission, gateway result-route delivery, schema promotion, or multi-provider
  live parity.

## Suggested Implementation Areas

- Consider separating pre-launch packet/current-state mismatch tracking from
  post-launch/runtime mismatch tracking in
  `scripts/afk-session-trigger-prototype.mjs`.
- Add focused tests in `tests/afk-session-trigger-prototype.test.mjs` for valid
  packet plus provider timeout, valid packet plus cleanup failure, and invalid
  packet/current-state facts.

## Verification

Required:

```bash
git status --short --branch
./aos ready
node --test tests/afk-session-trigger-prototype.test.mjs
git diff --check
```

Run if router/help surfaces change:

```bash
bash tests/dev-workflow-router.sh
bash tests/help-contract.sh
./aos dev build --no-restart
```

Do not run live provider verification in this GDI round. If deterministic
verification passes, report whether another Operator run is needed. Foreman's
current expectation is that no second live cleanup proof is needed solely for
this receipt-classification fix unless the implementation changes launch or
cleanup behavior.

## Stop Conditions

Stop and report instead of broadening scope if:

- repo-mode TCC/Input Monitoring readiness blocks;
- fixing the field would require changing the experimental receipt schema in a
  broad or incompatible way;
- proving behavior would require a live provider launch, transcript body read,
  prompt submission, gateway delivery, or provider-owned state mutation.

## Completion Report

Report:

- branch and head SHA;
- changed paths, path-scoped to this correction;
- exact semantics chosen for `packet.validation_status` versus runtime
  mismatches;
- provider-timeout, cleanup-failure, invalid-packet, duplicate, and guard
  behavior after the change;
- tests/checks run with exact pass/fail results;
- `./aos ready` result or exact human-needed blocker;
- confirmation that no live provider launch, real transcript read, provider
  config/session/catalog mutation, gateway state, dock profile/hook mutation,
  GitHub state, push, PR, or external publication happened;
- whether the source branch is ready for Foreman acceptance without another
  Operator run.
