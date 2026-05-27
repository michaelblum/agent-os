# Work Card: AFK Dev Session Trigger Codex Adapter Metadata Mismatch Cleanup V0

**Status:** Accepted 2026-05-23

## Result

- Foreman review: accepted.
- Branch/ref gates passed on
  `gdi/afk-dev-session-trigger-codex-adapter-metadata-mismatch-cleanup-v0` at
  `e4e029f406ae2c452ee61181d9286565d9740ae2`, based on
  `9541e5e8a402c95656bf0a0f66c626bed2d24873`.
- Diff was scoped to:
  - `scripts/afk-launch-attempt-prototype.mjs`;
  - `tests/afk-launch-attempt-prototype.test.mjs`.
- Behavior accepted: metadata-promoted Codex receipts remove stale nested
  `codex_adapter.mismatches[].code=provider_session_id_not_observed` while
  preserving the raw adapter diagnostic in non-promoted cwd/time fallback
  cases.
- Verification rerun by Foreman passed:
  - `./aos ready` returned
    `ready=true mode=repo daemon=reachable tap=active`;
  - `node --test tests/afk-launch-attempt-prototype.test.mjs` with 35/35
    passing;
  - `node --test tests/afk-session-trigger-prototype.test.mjs` with 16/16
    passing;
  - `cd packages/host && npm test` with 63/63 passing;
  - `git diff --check`.
- No live provider launch, transcript body read, provider store/catalog/telemetry
  mutation, gateway/dock runtime mutation, GitHub issue/PR/main mutation, main
  merge, PR creation, or async result routing occurred during this correction.

## Transfer Classification

- Recipient: GDI
- Transfer kind: correction round
- Single next goal: remove stale nested Codex adapter
  `provider_session_id_not_observed` mismatch evidence from completed
  metadata-promoted provider-acceptance receipts, without weakening failure
  reporting for genuinely unobserved or wrong-cwd adapter outcomes.
- Source artifacts:
  - `docs/design/work-cards/operator-afk-dev-session-trigger-goal-prefix-provider-acceptance-live-proof-v0.md`
  - `docs/design/work-cards/afk-dev-session-trigger-codex-goal-prefix-transport-v0.md`
  - `scripts/afk-launch-attempt-prototype.mjs`
  - `tests/afk-launch-attempt-prototype.test.mjs`
  - `packages/host/src/codex-thread-adapter.ts`
  - `packages/host/test/codex-thread-adapter.test.ts`
- Branch/Base:
  - `branch_from: gdi/afk-dev-session-trigger-codex-goal-prefix-transport-v0`
  - `required_start_ref: gdi/afk-dev-session-trigger-codex-goal-prefix-transport-v0`
  - Accepted live-proof route head:
    `09b84c86dda2753f278f9a4079db13b0066a0044`
  - Accepted implementation source head:
    `9b02689b52894fe8d2770606eeda5190ddde6869`
- Branch/output expectation: create or reuse
  `gdi/afk-dev-session-trigger-codex-adapter-metadata-mismatch-cleanup-v0`
  from the required start ref. Commit and push that GDI branch when
  verification passes under the active `agentic_relay` profile. Do not open a
  PR, merge, mutate main, mutate GitHub issues/projects, or start async result
  routing.

## Fresh Context Contract

GDI starts from a fresh context window. Do not assume branch, worktree,
readiness, daemon state, live proof artifacts, or prior implementation state.
Read and rediscover before editing.

## Foreman Review Finding

Operator's supervised no-fixture live proof passed the provider-acceptance gate:

- top-level receipt `status=completed`;
- `provider_acceptance.status=provider_session_observed`;
- concrete Codex session id `019e562f-2fbd-74d3-8cf8-3dd61a1c7095`;
- `provider_acceptance.observation_source=codex_adapter_metadata`;
- `codex_adapter.correlation_status=matched_by_cwd_time_window`;
- `/goal ` prompt transport recorded as `provider_prompt_mode=codex_goal` and
  `provider_prompt_prefix="/goal "`;
- cleanup verified;
- final readiness clean.

The residual defect is receipt-internal consistency:

- top-level `mismatches=[]`;
- but nested `codex_adapter.mismatches` still contains
  `provider_session_id_not_observed` from bridge visibility before metadata
  promotion.

That nested mismatch is useful while provider acceptance remains unobserved, but
it becomes stale after `promoteCodexMetadataProviderAcceptance()` accepts the
same Codex adapter metadata as the provider identity source.

Current source already removes the corresponding top-level mismatch in
`promoteCodexMetadataProviderAcceptance()`. It does not sanitize
`record.codex_adapter.mismatches`.

## Required Behavior

- When metadata-backed Codex adapter promotion changes
  `provider_acceptance.status` to `provider_session_observed`, the completed
  receipt must not retain a nested `codex_adapter.mismatches` entry with
  `code=provider_session_id_not_observed`.
- Preserve top-level mismatch cleanup already done by
  `promoteCodexMetadataProviderAcceptance()`.
- Preserve adapter failure diagnostics for non-promoted cases:
  - no usable time window;
  - no matching metadata candidate;
  - multiple candidates;
  - wrong cwd;
  - metadata unreadable;
  - provider acceptance still unobserved.
- Do not remove `provider_session_id_not_observed` from raw
  `packages/host/src/codex-thread-adapter.ts` results unless the code review
  shows that is the narrower correct layer. The likely narrow fix is in the
  launch-attempt receipt post-promotion shaping, because the adapter result is
  still accurately describing the bridge-only observation before promotion.
- Add deterministic coverage proving a metadata-promoted completed receipt has:
  - `record.mismatches` with no `provider_session_id_not_observed`;
  - `record.codex_adapter.mismatches` with no
    `provider_session_id_not_observed`;
  - `provider_acceptance.status=provider_session_observed`;
  - `codex_adapter.correlation_status=matched_by_cwd_time_window`.
- Preserve existing tests that assert adapter-level missing provider id
  diagnostics remain present when no metadata promotion occurs.

## Read First

- `AGENTS.md`
- `.docks/gdi/AGENTS.md`
- `docs/dev/active-profile.json`
- `docs/dev/workflow-profiles.json`
- `docs/design/work-cards/operator-afk-dev-session-trigger-goal-prefix-provider-acceptance-live-proof-v0.md`
- `scripts/afk-launch-attempt-prototype.mjs`
- `tests/afk-launch-attempt-prototype.test.mjs`
- `packages/host/src/codex-thread-adapter.ts`
- `packages/host/test/codex-thread-adapter.test.ts`

## Rediscover State

Run:

```bash
git status --short --branch
git rev-parse HEAD gdi/afk-dev-session-trigger-codex-goal-prefix-transport-v0 09b84c86dda2753f278f9a4079db13b0066a0044 9b02689b52894fe8d2770606eeda5190ddde6869
./aos ready
./aos dev recommend --json --paths scripts/afk-launch-attempt-prototype.mjs,tests/afk-launch-attempt-prototype.test.mjs,packages/host/src/codex-thread-adapter.ts,packages/host/test/codex-thread-adapter.test.ts
```

If `./aos ready` reports a repo-mode Accessibility, Input Monitoring, or
inactive input-tap blocker, run:

```bash
.docks/gdi/scripts/human-needed-tcc-reset
```

Then stop with `human_needed`. After the human returns with `finished`, run:

```bash
./aos ready --post-permission
```

Only continue if it reports ready.

## Suggested Implementation Areas

- `scripts/afk-launch-attempt-prototype.mjs`
  - likely fix: when `promoteCodexMetadataProviderAcceptance()` removes stale
    top-level missing-provider-id/provider-execution mismatches, also remove the
    stale nested `provider_session_id_not_observed` entry from
    `record.codex_adapter.mismatches`.
- `tests/afk-launch-attempt-prototype.test.mjs`
  - likely coverage: extend the existing metadata promotion test to assert the
    nested adapter mismatch is also absent after promotion.
- `packages/host/src/codex-thread-adapter.ts`
  - inspect only to preserve adapter-level behavior; avoid changing it unless
    the launch-attempt layer cannot own the cleanup cleanly.

## Hard Boundaries

- Do not run a live Codex provider launch in this GDI round.
- Do not read provider transcript bodies.
- Do not mutate provider store, catalog, telemetry, gateway, dock runtime,
  GitHub issues, PRs, or main.
- Do not mutate Codex config/keymaps.
- Do not remove or relax `--i-am-present`.
- Do not start async result routing.
- Do not broaden into unsupervised trigger design.

## Verification

Run and report:

```bash
git status --short --branch
./aos ready
node --test tests/afk-launch-attempt-prototype.test.mjs
node --test tests/afk-session-trigger-prototype.test.mjs
cd packages/host && npm test
git diff --check
```

If you change terminal bridge behavior unexpectedly, also run:

```bash
node --test tests/sigil-agent-terminal-server.test.mjs
```

## Completion Report Required

Return:

- branch and head SHA;
- base/start SHA;
- files changed;
- tests run and pass/fail counts;
- exact behavior change;
- proof that metadata-promoted completed receipts no longer retain nested
  `codex_adapter.mismatches[].code=provider_session_id_not_observed`;
- proof that non-promoted adapter diagnostics still behave correctly;
- explicit statement that no live provider launch, transcript body read,
  provider store/catalog/telemetry mutation, gateway/dock runtime mutation,
  GitHub issue/PR/main mutation, main merge, PR creation, or async result
  routing occurred beyond the expected GDI branch push.
