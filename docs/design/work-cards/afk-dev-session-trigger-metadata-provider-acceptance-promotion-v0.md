# Work Card: AFK Dev Session Trigger Metadata Provider Acceptance Promotion V0

**Status:** Routed 2026-05-23

## Transfer Classification

- Recipient: GDI
- Transfer kind: correction round
- Single next goal: when the guarded live Codex/GDI path submits the packet
  prompt and then finds exactly one metadata-backed Codex thread for the
  intended launch cwd/time window, promote that concrete thread identity into
  `provider_acceptance.status=provider_session_observed` and the launch
  lifecycle gate.
- Source artifacts:
  - `docs/design/work-cards/afk-dev-session-trigger-live-prompt-submission-observation-v0.md`
  - `docs/design/work-cards/operator-afk-dev-session-trigger-provider-acceptance-live-proof-v0.md`
  - `scripts/afk-launch-attempt-prototype.mjs`
  - `scripts/afk-session-trigger-prototype.mjs`
  - `tests/afk-launch-attempt-prototype.test.mjs`
  - `tests/afk-session-trigger-prototype.test.mjs`
  - `packages/host/src/codex-thread-adapter.ts`
- Branch/Base:
  - `branch_from: foreman/afk-provider-metadata-acceptance-promotion-v0`
  - `required_start_ref: foreman/afk-provider-metadata-acceptance-promotion-v0`
  - Prompt-submission source head:
    `b8808a50e6b718a943bdcd1e8853a02a3f446b10`
  - Prompt-submission base:
    `a3930e8f5197a9a50beb729310a74717e79496de`
- Branch/output expectation: create
  `gdi/afk-dev-session-trigger-metadata-provider-acceptance-promotion-v0` from
  the required start ref. Commit and push that GDI branch when verification
  passes, per the active `agentic_relay` profile. Do not open a PR, merge,
  mutate GitHub state beyond the branch push, or start async result routing.

## Fresh Context Contract

GDI starts from a fresh context window. Rediscover branch, worktree, readiness,
current source, tests, and the prior Foreman review before editing.

## Foreman Review Finding

The prompt-submission branch added bridge `/input` delivery and metadata-only
Codex adapter correlation, but the fallback metadata path still does not close
the provider acceptance gate.

Relevant current behavior:

- `scripts/afk-launch-attempt-prototype.mjs` derives
  `provider_session_observed` only when
  `record.provider_acceptance.status === 'provider_session_observed'` or the
  Codex adapter status is `matched_by_provider_session_id`.
- A no-fixture live run whose terminal snapshot lacks a provider session id can
  only prove identity through the adapter as `matched_by_cwd_time_window`.
- `tests/afk-launch-attempt-prototype.test.mjs` currently asserts
  `matched_by_cwd_time_window` while still expecting the
  `provider_session_id_not_observed` mismatch.

That means a live Codex/GDI run can submit the packet prompt and find exactly
one concrete Codex thread for the intended launch cwd/time window, but still
return `provider_acceptance_unobserved`. This preserves the original blocker
even after successful metadata correlation.

## Required Behavior

- When the Codex adapter returns `matched_by_cwd_time_window` with one concrete
  thread for the intended launch cwd or workspace root in the launch time
  window, and prompt submission succeeded, promote that thread identity into
  `record.provider_acceptance`.
- The promoted provider acceptance should include:
  - `status: provider_session_observed`;
  - `provider_session_id` equal to the matched Codex thread id;
  - metadata-derived cwd when available;
  - branch/head/version/model fields when available, otherwise the existing
    not-observed values;
  - reviewable evidence refs that point to the bounded Codex adapter/thread
    reference, not transcript bodies.
- The launch lifecycle should become `provider_session_observed` from that
  promoted metadata identity, and the top-level session trigger should be able
  to complete when cleanup is also verified.
- Do not keep a stale `provider_session_id_not_observed` or
  `provider_acceptance_unobserved` mismatch after a valid metadata promotion.
- Preserve the current mismatch behavior for:
  - no matching metadata thread;
  - multiple current same-cwd candidates;
  - wrong cwd;
  - no usable launch time window;
  - failed prompt submission;
  - fixture or dry-run paths where provider acceptance is not meant to be
    promoted.

## Read First

- `AGENTS.md`
- `.docks/gdi/AGENTS.md`
- `docs/dev/active-profile.json`
- `docs/dev/workflow-profiles.json`
- `docs/design/work-cards/afk-dev-session-trigger-live-prompt-submission-observation-v0.md`
- `docs/design/work-cards/operator-afk-dev-session-trigger-provider-acceptance-live-proof-v0.md`
- `docs/design/notes/afk-codex-provider-session-adapter-contract-2026-05-22.md`
- `scripts/afk-launch-attempt-prototype.mjs`
- `scripts/afk-session-trigger-prototype.mjs`
- `tests/afk-launch-attempt-prototype.test.mjs`
- `tests/afk-session-trigger-prototype.test.mjs`
- `packages/host/src/codex-thread-adapter.ts`
- `packages/host/test/codex-thread-adapter.test.ts`

## Rediscover State

Run:

```bash
git status --short --branch
git rev-parse HEAD foreman/afk-provider-metadata-acceptance-promotion-v0 b8808a50e6b718a943bdcd1e8853a02a3f446b10
./aos ready
./aos dev recommend --json --paths scripts/afk-launch-attempt-prototype.mjs,scripts/afk-session-trigger-prototype.mjs,tests/afk-launch-attempt-prototype.test.mjs,tests/afk-session-trigger-prototype.test.mjs,packages/host/src/codex-thread-adapter.ts,packages/host/test/codex-thread-adapter.test.ts
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

- Add a small helper that converts a strong Codex adapter correlation into a
  provider-acceptance observation only when the bridge prompt submission is
  known to have succeeded.
- Reuse existing merge/mismatch helpers where possible so catalog exact-id
  behavior and snapshot exact-id behavior stay unchanged.
- Keep Codex adapter access metadata-only. Do not read or copy transcript
  bodies.
- Keep the live launch guard. Do not remove or relax `--i-am-present`.

## Deterministic Tests To Add Or Update

- Add an end-to-end launch-attempt test where:
  - there is no snapshot/provider session id;
  - bridge input submission is successful or fixture-equivalent;
  - Codex fixture metadata has exactly one thread in the intended
    `.docks/gdi` cwd/time window;
  - the output has `provider_acceptance.status=provider_session_observed`;
  - `provider_acceptance.provider_session_id` equals the matched thread id;
  - lifecycle is `provider_session_observed`;
  - neither `provider_session_id_not_observed` nor
    `provider_acceptance_unobserved` remains.
- Add or update a session-trigger receipt test showing the trigger can complete
  when metadata-backed provider acceptance and cleanup proof are both present.
- Preserve tests for wrong-cwd, multiple-candidate, no-window, and unobserved
  metadata paths.

## Verification

Run and report:

```bash
git status --short --branch
./aos ready
node --test tests/afk-session-trigger-prototype.test.mjs
node --test tests/afk-launch-attempt-prototype.test.mjs
node --test tests/sigil-agent-terminal-server.test.mjs
git diff --check
```

Do not run a live Codex provider launch in this GDI round. Foreman will route
the next Operator supervised proof after accepting the deterministic correction.

## Stop Conditions

- Repo-mode TCC/Input Monitoring readiness blocks after the standard GDI helper.
- The correction requires a live Codex launch.
- The correction requires provider transcript body reads or provider-owned store
  mutation.
- Scope expands into async result routing, final session command design,
  GitHub mutation, PR creation, or removing `--i-am-present`.

## Completion Report Required

Return:

- branch and head SHA;
- base/start SHA;
- files changed;
- tests run and pass/fail counts;
- exact behavior change;
- whether metadata-backed provider acceptance now promotes
  `provider_acceptance.status`;
- remaining need for Operator supervised live proof;
- explicit statement that no live provider launch, transcript body read,
  provider store/catalog/telemetry mutation, gateway/dock/GitHub mutation,
  main merge, PR creation, or async result routing occurred.
