# Work Card: AFK Dev Session Trigger Provider Prompt Execution Observation V0

**Status:** Routed 2026-05-23

## Transfer Classification

- Recipient: GDI
- Transfer kind: correction round
- Single next goal: make the guarded live Codex/GDI path prove provider-level
  prompt execution, not just bridge byte delivery, so a real no-fixture launch
  creates observable `.docks/gdi` Codex session identity and can close provider
  acceptance.
- Source artifacts:
  - `docs/design/work-cards/operator-afk-dev-session-trigger-provider-acceptance-live-proof-v1.md`
  - `docs/design/work-cards/afk-dev-session-trigger-metadata-provider-acceptance-promotion-v0.md`
  - `docs/design/work-cards/afk-dev-session-trigger-live-prompt-submission-observation-v0.md`
  - `scripts/afk-launch-attempt-prototype.mjs`
  - `scripts/afk-session-trigger-prototype.mjs`
  - `apps/sigil/codex-terminal/server.mjs`
  - `tests/afk-launch-attempt-prototype.test.mjs`
  - `tests/afk-session-trigger-prototype.test.mjs`
  - `tests/sigil-agent-terminal-server.test.mjs`
  - `packages/host/src/codex-thread-adapter.ts`
- Branch/Base:
  - `branch_from: foreman/afk-provider-prompt-execution-observation-v0`
  - `required_start_ref: foreman/afk-provider-prompt-execution-observation-v0`
  - Accepted source head:
    `f94bc43bb50b5d5bb274ef8e2d2a8a4c6990f223`
  - Latest Operator evidence checkpoint:
    `746c18a032c438d0e9b236d6672e7ddddab18885`
- Branch/output expectation: create
  `gdi/afk-dev-session-trigger-provider-prompt-execution-observation-v0` from
  the required start ref. Commit and push that GDI branch when verification
  passes, per the active `agentic_relay` profile. Do not open a PR, merge,
  mutate GitHub state beyond the branch push, or start async result routing.

## Fresh Context Contract

GDI starts from a fresh context window. Rediscover branch, worktree, readiness,
current source, tests, and the Operator v1 evidence before editing.

## Foreman Review Finding

The v1 Operator proof shows the live bridge now writes the packet-derived prompt
into the Codex terminal:

```text
terminal_substrate.input_submission.status=submitted
text_accepted=true
enter_sent=true
enter_accepted=true
submitted_observed=true
snapshot excerpt showed the AOS GDI transfer prompt
```

But provider acceptance still did not close:

```text
provider_acceptance.status=provider_acceptance_unobserved
provider_session_id=not_observed
codex_adapter.correlation_status=not_observed
candidate_thread_ids=[]
cleanup.status=verified
```

The only modified Codex rollout in the trigger window belonged to
`.docks/operator`, not `.docks/gdi`. That means the bridge successfully wrote
bytes to the PTY, but the live Codex provider did not accept/execute the prompt
in a way that created a provider session identity.

Source reading points to the risk:

- `buildLiveProviderPrompt()` currently builds a multi-line prompt.
- `submitLiveProviderPrompt()` sends that multi-line prompt through bridge
  `/input` with `enter: true`.
- `apps/sigil/codex-terminal/server.mjs` writes process-driver input bytes and
  one carriage return, then reports PTY write acceptance.
- The current `input_submission.status=submitted` therefore proves bridge write
  acceptance, not provider-level prompt execution.

Do not treat the Codex UI displaying the prompt text as successful provider
acceptance. The prompt must be submitted to the provider and produce a concrete
live session/thread signal.

## Required Behavior

- Distinguish bridge byte delivery from provider prompt execution in the live
  record.
- Make the live Codex/GDI submission path robust enough that the no-fixture
  Operator run can submit the prompt to Codex, not merely leave the prompt text
  visible in the composer.
- After provider-level submission, observe one of:
  - a parseable provider session id from live snapshot text; or
  - a metadata-backed Codex adapter match for `.docks/gdi` in the launch window,
    promoted to `provider_acceptance.status=provider_session_observed`.
- A passing live proof should be able to produce:
  - `terminal_substrate.input_submission.status=submitted`;
  - an additional provider-level signal such as
    `terminal_substrate.input_submission.provider_execution_observed=true` or an
    equivalent bounded field;
  - `provider_acceptance.status=provider_session_observed`;
  - concrete `provider_acceptance.provider_session_id`;
  - `cleanup.status=verified`;
  - top-level trigger `status=completed`;
  - no `provider_acceptance_unobserved` or stale
    `provider_session_id_not_observed` mismatch.
- If bytes are delivered but the prompt remains in the composer or no provider
  metadata appears, preserve a structured mismatch that says provider execution
  was not observed. Do not report plain bridge write acceptance as provider
  prompt submission success.

## Read First

- `AGENTS.md`
- `.docks/gdi/AGENTS.md`
- `docs/dev/active-profile.json`
- `docs/dev/workflow-profiles.json`
- `docs/design/work-cards/operator-afk-dev-session-trigger-provider-acceptance-live-proof-v1.md`
- `docs/design/work-cards/afk-dev-session-trigger-metadata-provider-acceptance-promotion-v0.md`
- `docs/design/work-cards/afk-dev-session-trigger-live-prompt-submission-observation-v0.md`
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
git rev-parse HEAD foreman/afk-provider-prompt-execution-observation-v0 f94bc43bb50b5d5bb274ef8e2d2a8a4c6990f223 746c18a032c438d0e9b236d6672e7ddddab18885
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

## Investigation Guidance

Determine why the live Codex prompt stayed visible rather than executing. Plausible
areas to check:

- Multi-line prompt shape: Codex TUI may treat embedded newlines differently
  from a final submit key. Consider using a single-line bounded prompt, a
  provider-specific paste/submit sequence, or an explicit final `/key Enter`
  after input when the UI requires it.
- Bridge semantics: `/input` currently means "write bytes to PTY"; it should not
  be the only evidence for provider-level submission.
- Snapshot polling: a post-submit snapshot should detect whether the prompt is
  still sitting in the composer versus a response/session has started.
- Metadata timing: after provider-level submission, the bounded adapter window
  should find a `.docks/gdi` Codex thread if the provider accepted the prompt.

Prefer a deterministic fixture or fake TUI test that models "text accepted but
not executed until the correct final submit action" before changing live logic.

## Suggested Implementation Areas

- Consider making `buildLiveProviderPrompt()` generate a single-line bounded
  prompt for the live Codex TUI, while preserving enough packet pointer context.
- Consider adding a provider-specific submit helper that sends text with
  `enter:false`, then sends the exact final key sequence needed to execute in
  Codex, and records both bridge write acceptance and provider execution
  observation separately.
- Consider adding snapshot classification for "prompt still visible in
  composer" versus "provider has begun executing/responding".
- Keep Codex metadata access bounded to session metadata and refs. Do not read
  or copy transcript bodies.

## Deterministic Tests To Add Or Update

- Add a launch-attempt test where bridge input write succeeds but no provider
  execution/session metadata appears. It should not be considered provider
  accepted, and it should carry a structured provider-execution-unobserved
  mismatch.
- Add a test for the corrected submit sequence or prompt shape that models a
  TUI requiring the final execution action after text delivery.
- Preserve the existing metadata promotion tests and ensure promotion only
  happens after provider-level prompt execution is observed or after the
  metadata thread appears for the intended `.docks/gdi` launch.
- Preserve the unobserved, wrong-cwd, multiple-candidate, no-window, cleanup,
  and duplicate-suppression behavior.

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
- how bridge byte delivery is now distinguished from provider prompt execution;
- whether live no-fixture provider acceptance should now be able to close from
  snapshot or metadata;
- remaining need for Operator supervised live proof;
- explicit statement that no live provider launch, transcript body read,
  provider store/catalog/telemetry mutation, gateway/dock/GitHub mutation,
  main merge, PR creation, or async result routing occurred.
