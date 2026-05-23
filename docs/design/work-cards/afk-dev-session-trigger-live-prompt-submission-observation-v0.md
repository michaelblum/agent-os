# Work Card: AFK Dev Session Trigger Live Prompt Submission Observation V0

**Status:** Correction required 2026-05-23

## Transfer Classification

- Recipient: GDI
- Transfer kind: correction round
- Single next goal: make the guarded live Codex/GDI trigger path actually submit
  the packet goal/prompt to the launched Codex terminal and observe a concrete
  provider session identity from live evidence, instead of only observing that
  the Codex UI started.
- Source artifacts:
  - `docs/design/work-cards/operator-afk-dev-session-trigger-provider-acceptance-live-proof-v0.md`
  - `docs/design/work-cards/afk-dev-session-trigger-provider-acceptance-observation-v0.md`
  - `scripts/afk-launch-attempt-prototype.mjs`
  - `scripts/afk-session-trigger-prototype.mjs`
  - `apps/sigil/codex-terminal/server.mjs`
  - `packages/host/src/codex-thread-adapter.ts`
- Branch/Base:
  - `branch_from: foreman/afk-provider-prompt-submission-observation-v0`
  - `required_start_ref: foreman/afk-provider-prompt-submission-observation-v0`
  - Accepted parser source head:
    `1a1eba69db7e8a00976c6daddadee35b0f5502b5`
  - Latest Operator evidence checkpoint:
    `682a56ba5ceeeba1678fda6a35d5382fb845efc6`
- Branch/output expectation: create
  `gdi/afk-dev-session-trigger-live-prompt-submission-observation-v0` from the
  required start ref. Commit and push that GDI branch when verification passes,
  per the active `agentic_relay` profile. Do not open a PR, merge, close issues,
  mutate GitHub state beyond the branch push, or start async result routing.

## Foreman Review Result

GDI completed this round at
`b8808a50e6b718a943bdcd1e8853a02a3f446b10`. Deterministic verification passed:

```bash
./aos ready
node --test tests/afk-session-trigger-prototype.test.mjs
node --test tests/afk-launch-attempt-prototype.test.mjs
node --test tests/sigil-agent-terminal-server.test.mjs
git diff --check a3930e8f5197a9a50beb729310a74717e79496de..b8808a50e6b718a943bdcd1e8853a02a3f446b10
```

Foreman did not accept the slice as closing provider acceptance. The new
Codex metadata fallback records `matched_by_cwd_time_window`, but
`deriveLifecycleState()` only treats `provider_session_observed` or
`matched_by_provider_session_id` as closing the gate. Existing tests also assert
the fallback match while preserving the `provider_session_id_not_observed`
mismatch. Route the correction in
`docs/design/work-cards/afk-dev-session-trigger-metadata-provider-acceptance-promotion-v0.md`.

## Fresh Context Contract

GDI starts from a fresh context window. Do not assume branch, worktree, daemon,
bridge process, provider session, transcript/catalog state, or prior
implementation state. Read and rediscover before editing.

## Foreman Review Finding

The accepted parser change made live `/snapshot` parsing possible, but the
Operator no-fixture proof still returned:

```text
status=provider_acceptance_unobserved
packet.validation_status=valid
scheduler.lifecycle_state=rejected
terminal_substrate.status=observed
terminal_substrate.cwd=/Users/Michael/Code/agent-os/.docks/gdi
terminal_substrate.command=codex --no-alt-screen
terminal_substrate.snapshot_ref=inline:terminal_substrate.snapshot_summary
provider_acceptance.status=provider_acceptance_unobserved
cleanup.status=verified
mismatch_classes=provider_acceptance_unobserved
```

The snapshot showed a live Codex UI from `.docks/gdi`, but no parseable provider
session id. Bounded provider metadata showed no new `.docks/gdi` rollout; the
only modified rollout in the window belonged to the Operator session cwd. That
means the current live path has proven provider UI launch and cleanup, but not
that the provider received and started executing the packet prompt.

Source reading points to the missing step: in
`scripts/afk-launch-attempt-prototype.mjs`, `observeProviderTerminalSubstrate()`
starts the bridge and ensures the `codex --no-alt-screen` process, then polls
`/snapshot`. It does not submit the packet goal/prompt through the bridge
`/input` endpoint, nor does it observe a Codex rollout for the intended
`.docks/gdi` launch cwd.

This is not a regex-only correction. Do not mark provider acceptance observed
just because the Codex UI is visible. Acceptance means the provider received the
bounded prompt and a concrete provider session/thread identity was observed from
snapshot text, Codex metadata, or another reviewable provider-session signal.

## Read First

- `AGENTS.md`
- `.docks/gdi/AGENTS.md`
- `docs/dev/active-profile.json`
- `docs/dev/workflow-profiles.json`
- `docs/design/durable-agent-cognition-and-afk-primitives.md`
- `docs/design/work-cards/operator-afk-dev-session-trigger-provider-acceptance-live-proof-v0.md`
- `docs/design/work-cards/afk-dev-session-trigger-provider-acceptance-observation-v0.md`
- `docs/design/work-cards/afk-codex-provider-session-adapter-v0.md`
- `docs/design/notes/afk-codex-provider-session-adapter-contract-2026-05-22.md`
- `scripts/afk-launch-attempt-prototype.mjs`
- `scripts/afk-session-trigger-prototype.mjs`
- `apps/sigil/codex-terminal/server.mjs`
- `tests/afk-launch-attempt-prototype.test.mjs`
- `tests/afk-session-trigger-prototype.test.mjs`
- `tests/sigil-agent-terminal-server.test.mjs`
- `packages/host/src/codex-thread-adapter.ts`
- `packages/host/test/codex-thread-adapter.test.ts`

## Rediscover State

Run:

```bash
git status --short --branch
git rev-parse HEAD foreman/afk-provider-prompt-submission-observation-v0 1a1eba69db7e8a00976c6daddadee35b0f5502b5
./aos ready
./aos dev recommend --json --paths scripts/afk-launch-attempt-prototype.mjs,scripts/afk-session-trigger-prototype.mjs,apps/sigil/codex-terminal/server.mjs,tests/afk-launch-attempt-prototype.test.mjs,tests/afk-session-trigger-prototype.test.mjs,tests/sigil-agent-terminal-server.test.mjs,packages/host/src/codex-thread-adapter.ts,packages/host/test/codex-thread-adapter.test.ts
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

- `scripts/afk-launch-attempt-prototype.mjs`
  - `buildAttemptContext()` - has packet goal/source context and launch timing.
  - `observeProviderTerminalSubstrate()` - starts the real provider branch but
    currently does not submit the packet goal/prompt.
  - `providerObservationFromBridgeSnapshot()` and
    `waitForProviderObservationSnapshot()` - current snapshot observation path.
  - `runCodexAdapterCommand()` and `buildCodexAdapterRecord()` - existing bridge
    to the repo-owned Codex adapter when `codexHome` is available.
- `apps/sigil/codex-terminal/server.mjs`
  - `/input`, `/key`, `/resize`, `/snapshot`, `/sessions`, and
    `/session-inspector` endpoints are already available for bounded terminal
    interaction and provider metadata checks.
- `packages/host/src/codex-thread-adapter.ts`
  - read-only Codex metadata correlation; supports exact provider session id
    and cwd/time fallback from explicit Codex roots.
- `tests/sigil-agent-terminal-server.test.mjs`
  - process-driver `/input`, `/key`, and resize tests.
- `tests/afk-launch-attempt-prototype.test.mjs` and
  `tests/afk-session-trigger-prototype.test.mjs`
  - launch attempt and trigger receipt expectations.

## Required Behavior

- The accepted guarded live Codex/GDI branch must submit a bounded prompt to the
  launched provider after the bridge session is ensured and the terminal is
  ready.
- The submitted prompt should be derived from the transfer packet goal/source
  artifact and be safe to execute in a supervised prototype run. Keep it concise
  enough for the CLI goal limit and do not include hidden transcript bodies.
- Record input evidence under `terminal_substrate.input_submission`, including
  text/enter acceptance and any extra Enter or key needed by the TUI path.
- After submission, observe provider acceptance from a concrete identity:
  - parseable provider session id in live snapshot text, or
  - a Codex session/catalog/adapter record for the intended launch cwd and
    launch time window, or
  - another explicit provider-session source with a reviewable evidence ref.
- If Codex metadata is used, read only bounded metadata such as `session_meta`
  and file refs. Do not read or paste full transcript bodies.
- A successful live proof should be able to produce:
  - `provider_acceptance.status=provider_session_observed`;
  - a concrete `provider_acceptance.provider_session_id`;
  - provider-reported or metadata-derived cwd/branch/head/version/model when
    available;
  - no `provider_acceptance_unobserved` mismatch;
  - `cleanup.status=verified`;
  - top-level trigger `status=completed` only when both provider acceptance and
    cleanup are true.
- If prompt submission fails, report a structured mismatch such as
  `provider_prompt_submission_unobserved` or equivalent; do not collapse it into
  packet validation.
- If prompt submission succeeds but no provider session id or metadata appears
  in the bounded window, preserve `provider_acceptance_unobserved` with a
  reviewable evidence ref and keep cleanup honest.
- Preserve duplicate suppression before any provider launch or prompt
  submission.
- Preserve the current live launch guard. Do not remove or relax
  `--i-am-present` in this GDI slice.

## Scope And Hard Boundaries

- This is a source and deterministic-test correction for the experimental AFK
  trigger/launch-attempt prototypes.
- Do not start async result routing.
- Do not remove, relax, rename, or bypass `--i-am-present`.
- Do not add final `aos session ...` command spelling.
- Do not broaden beyond the first Codex/GDI live path.
- Do not mark provider acceptance observed from UI presence alone.
- Do not read provider transcript bodies outside bounded metadata needed for
  session identity.
- Do not mutate provider configs, provider session stores, provider catalogs,
  telemetry stores, gateway state, dock profiles, hooks, GitHub issues, PRs, or
  main.
- Do not run a live Codex provider launch in this GDI round. If deterministic
  verification passes, report that a follow-up Operator live proof is required.

## Suggested Implementation Areas

- Consider carrying a `prompt` or `dispatch_payload` field in the launch-attempt
  context from packet `goal`, `source_artifact`, and result-route context.
- Consider adding a helper that submits text through bridge `/input`, optionally
  uses `/key` for an extra Enter when the TUI needs it, and records a bounded
  `input_submission` section.
- Consider polling `/snapshot` after input submission for either:
  - explicit provider session id text; or
  - a TUI state that proves submission was accepted, plus Codex metadata
    correlation for the intended cwd/time window.
- If using Codex metadata by default in the live supervised branch, keep it
  metadata-only and fixture-testable. Reuse the existing adapter rather than
  ad hoc JSONL scans where practical.
- For deterministic tests, use a fake provider command or fixture bridge that
  echoes provider-session evidence after input. Keep any test-only command hook
  internal to the prototype script and do not expose it through the Swift
  `./aos dev afk-session-trigger` wrapper.
- Preserve existing fixture-backed tests; update them only to reflect new input
  evidence if the production record shape changes.

## Verification

Required:

```bash
git status --short --branch
./aos ready
node --test tests/afk-session-trigger-prototype.test.mjs
node --test tests/afk-launch-attempt-prototype.test.mjs
node --test tests/sigil-agent-terminal-server.test.mjs
git diff --check
```

Run if host adapter files change:

```bash
node --test --experimental-strip-types packages/host/test/codex-thread-adapter.test.ts
node --test --experimental-strip-types packages/host/test/session-catalog.test.ts
npm --prefix packages/host run check
```

Run if router/help/Swift surfaces change:

```bash
bash tests/dev-workflow-router.sh
bash tests/help-contract.sh
./aos dev build --no-restart
```

Do not run live provider verification in this GDI round. If the implementation
cannot be verified without a live Codex launch, stop and report the missing
testability boundary.

## Stop Conditions

Stop and report instead of broadening scope if:

- repo-mode TCC/Input Monitoring readiness blocks and the GDI helper reports
  `human_needed`;
- live provider launch appears necessary to finish implementation;
- the implementation would require reading provider transcript bodies or
  mutating provider-owned stores;
- the fix requires async result routing, final session command design, or
  removing the human-presence guard;
- deterministic tests become flaky due to real provider timing or live process
  dependence.

## Completion Report

Report:

- profile from `docs/dev/active-profile.json`;
- branch and head SHA;
- base ref/SHA used;
- changed paths, path-scoped to this slice;
- exact prompt submission behavior added to the live Codex/GDI path;
- exact provider-session identity source used after submission;
- receipt/status behavior for submission success, observed provider session,
  unobserved provider session, and cleanup failure;
- how deterministic tests cover prompt submission and provider-session
  observation without executing Codex;
- exact tests/checks run with pass/fail results;
- `./aos ready` result or exact `human_needed` blocker;
- whether an Operator supervised live proof is still required before Foreman
  considers the provider-acceptance gate closed;
- confirmation that no live provider launch, provider transcript body read,
  provider store/catalog/telemetry mutation, gateway state, dock profile/hook
  mutation, GitHub issue/PR mutation, main merge, or async result routing
  occurred.

If this GDI session reused a completed goal, remind the human to run
`/goal clear` before retiring or starting unrelated work.
