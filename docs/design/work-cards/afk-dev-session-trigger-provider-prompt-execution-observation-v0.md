# Work Card: AFK Dev Session Trigger Provider Prompt Execution Observation V0

**Status:** Accepted with follow-up 2026-05-23

## Foreman Review Result

Implementer completed this correction at
`47647c316d6d78a98ce525641ecb4aa05c7fc72e` from base
`9e80f6de66bbeb419840ce3b1c438fcfb24df2ef`.

Foreman accepted the source slice against the written input-timing contract. The
live Codex prompt is now a short file-backed pointer, timing constants are
centralized, prompt text is typed character by character from the first
character, final submit is an isolated `/key Enter`, and receipt evidence
separates bridge byte/key acceptance from provider execution. The launch-attempt
tests now cover the pointer prompt, timing profile, isolated submit, and
`provider_execution_unobserved`.

Verification passed locally:

```bash
./aos ready
node --test tests/afk-session-trigger-prototype.test.mjs
node --test tests/afk-launch-attempt-prototype.test.mjs
node --test tests/sigil-agent-terminal-server.test.mjs
cd packages/host && npm test
git diff --check 9e80f6de66bbeb419840ce3b1c438fcfb24df2ef..47647c316d6d78a98ce525641ecb4aa05c7fc72e
```

Foreman is not routing Operator live proof yet. A narrower follow-up is needed
first because AFK Codex/Implementer transport should use the provider-native ``
prefix. The older "do not add ``" rule is scoped to Foreman/human
native dispatches, not AFK PTY automation. Route the correction in
`docs/design/work-cards/afk-dev-session-trigger-codex-prompt-prefix-transport-v0.md`.

## Transfer Classification

- Recipient: Implementer
- Transfer kind: correction round
- Single next goal: change live Codex/Implementer prompt submission to use a
  file-backed pointer prompt, centralized input timing, character-by-character
  typing, startup settle, and an isolated submit key, while still proving
  provider acceptance only from snapshot identity or Codex metadata.
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
  `implementer/afk-dev-session-trigger-provider-prompt-execution-observation-v0` from
  the required start ref. Commit and push that Implementer branch when verification
  passes, per the active `agentic_relay` profile. Do not open a PR, merge,
  mutate GitHub state beyond the branch push, or start async result routing.

## Fresh Context Contract

Implementer starts from a fresh context window. Rediscover branch, worktree, readiness,
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
snapshot excerpt showed the AOS Implementer transfer prompt
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
`the operator native subagent`, not `the implementer native subagent`. That means the bridge successfully wrote
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

## Narrow Hypothesis

The likely root cause is submit timing/semantics, not provider config:

- The bridge writes prompt text and final submit too close together for Codex's
  TUI.
- The PTY accepts both writes.
- Codex interprets the final carriage return as part of paste/composer input,
  or otherwise fails to treat it as a standalone submit key.
- The symptom matches Operator v1: the snapshot showed the transfer prompt in
  the UI, but no `the implementer native subagent` Codex rollout was created.

Lead with the smallest reversible input-layer correction. Do not mutate Codex
provider config or keymaps in this Implementer round. If the revised pointer-prompt and
timed character input proof still fails, a separate follow-up can investigate a
Codex config/keymap path such as `ctrl-enter`.

## Input Layer Requirements

- Keep the detailed payload file-backed. The PTY prompt must be a short
  plain-prose pointer to the work card, not the full transfer payload. Use a
  simple newline-safe envelope such as:

```text
Your work card is at docs/design/work-cards/<slug>.md. Read it first, then begin.
```

- Keep the pointer prompt under about 400 characters. This avoids bracketed
  paste risk, avoids the observed CLI goal-length problem, and keeps the trigger
  transport provider-agnostic.
- Introduce one centralized live input timing config location, with V0 defaults:

```js
{
  startupSettleMs: 2000,
  charDelayMs: 10,
  preSubmitDelayMs: 300,
}
```

- Do not scatter these values across dispatch logic. Do not add random variance
  for V0; deterministic timing is easier to test and compare across live proofs.
- Add one `typeCharacters(prompt, opts)` path for PTY prompt text delivery.
  Every PTY prompt write should use it from the first character. Do not keep a
  fast path for short prompts.
- After the terminal ready signal, wait `startupSettleMs` before typing the
  first character. The current readiness check proves render, not input-handler
  readiness. Stable empty-composer polling can be a future refinement, but do
  not block this slice on it.
- Type the pointer prompt character by character with `charDelayMs` between
  characters.
- After typing, wait `preSubmitDelayMs`, then send `/key Enter` as the final
  isolated submit event.
- Do not concatenate the final submit with the body. Keep any prompt-body
  newlines as body content only; the actual submit must be a separate final key
  event.

## Required Behavior

- Distinguish bridge byte delivery from provider prompt execution in the live
  record.
- Live Codex/Implementer prompt submission should use the file-backed pointer prompt
  and the centralized timing profile:
  1. wait `startupSettleMs` after the terminal ready signal;
  2. type the pointer prompt with `typeCharacters()` and `charDelayMs`;
  3. wait `preSubmitDelayMs`;
  4. send bridge `/key` with `key:"Enter"` as a separate PTY write.
- Record the input timing and submit shape in the receipt, including fields
  equivalent to:
  - `prompt_transport=file_pointer`;
  - `prompt_ref=docs/design/work-cards/<slug>.md`;
  - `pointer_prompt_bytes`;
  - `startup_settle_ms=2000`;
  - `char_delay_ms=10`;
  - `typed_character_count`;
  - `pre_submit_delay_ms=300`;
  - `submit_key_separate_write=true`;
  - `key_accepted=true` when `/key Enter` is accepted.
- Provider acceptance must remain gated on snapshot identity or Codex metadata,
  not on typing completion or key acceptance alone.
- Make the live Codex/Implementer submission path robust enough that the next
  no-fixture Operator run can submit the prompt to Codex, not merely leave the
  prompt text visible in the composer.
- After provider-level submission, observe one of:
  - a parseable provider session id from live snapshot text; or
  - a metadata-backed Codex adapter match for `the implementer native subagent` in the launch window,
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
- the implementer native subagent instructions
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
the manual TCC blocker report path
```

Then stop with `manual_intervention`. After the human returns with `finished`, run:

```bash
./aos ready --post-permission
```

Only continue if it reports ready.

## Investigation Guidance

Determine why the live Codex prompt stayed visible rather than executing. Plausible
areas to check:

- Prompt shape: the live PTY prompt should be a short pointer to the work card,
  not the full packet or goal payload.
- Incremental input: Codex and other TUIs may route input differently when bytes
  arrive as a chunk versus as keystrokes. Use the same character-by-character
  path for all prompt text.
- Startup readiness: rendering a marker does not prove the composer input
  handler is ready. Add the fixed post-ready settle delay for V0.
- Bridge semantics: `/input` currently means "write bytes to PTY"; it should not
  be the only evidence for provider-level submission.
- Snapshot polling: a post-submit snapshot should detect whether the prompt is
  still sitting in the composer versus a response/session has started.
- Metadata timing: after provider-level submission, the bounded adapter window
  should find a `the implementer native subagent` Codex thread if the provider accepted the prompt.

Prefer a deterministic fixture or fake TUI test that models "text accepted but
not executed until the correct final submit action" before changing live logic.

## Suggested Implementation Areas

- Replace the full PTY prompt body with a pointer to this work card. Keep the
  packet/work-card detail on disk.
- Add or reuse a provider-agnostic `typeCharacters(prompt, opts)` helper and
  route every PTY prompt text write through it.
- Add one centralized live input timing config with `startupSettleMs=2000`,
  `charDelayMs=10`, and `preSubmitDelayMs=300`.
- Record bridge write acceptance, character typing timing, startup settle,
  pre-submit delay, and separate submit-key acceptance.
- Consider adding snapshot classification for "prompt still visible in
  composer" versus "provider has begun executing/responding".
- Keep Codex metadata access bounded to session metadata and refs. Do not read
  or copy transcript bodies.
- Do not mutate Codex config, keymaps, provider settings, or global provider
  state in this Implementer round.

## Deterministic Tests To Add Or Update

- Add a launch-attempt test where bridge input write succeeds but no provider
  execution/session metadata appears. It should not be considered provider
  accepted, and it should carry a structured provider-execution-unobserved
  mismatch.
- Add deterministic coverage proving the live PTY prompt is a file-backed work
  card pointer, remains under about 400 characters, and does not serialize the
  full transfer payload into the terminal.
- Add deterministic coverage proving all PTY prompt writes go through
  `typeCharacters()` from the first character, with no short-prompt fast path.
- Add deterministic coverage for the centralized timing profile:
  `startupSettleMs=2000`, `charDelayMs=10`, and `preSubmitDelayMs=300`.
- Add deterministic coverage proving the final submit is a separate `/key
  Enter` after `preSubmitDelayMs`. Assert receipt fields equivalent to
  `submit_key_separate_write=true`, `pre_submit_delay_ms=300`,
  `startup_settle_ms=2000`, and `char_delay_ms=10`.
- Add or update a fixture that models a TUI requiring the final execution action
  after text delivery.
- Preserve the existing metadata promotion tests and ensure promotion only
  happens after provider-level prompt execution is observed or after the
  metadata thread appears for the intended `the implementer native subagent` launch.
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

Do not run a live Codex provider launch in this Implementer round. Foreman will route
the next Operator supervised proof after accepting the deterministic correction.

## Stop Conditions

- Repo-mode TCC/Input Monitoring readiness blocks after the standard Implementer helper.
- The correction requires a live Codex launch.
- The correction requires provider transcript body reads or provider-owned store
  mutation.
- The correction requires Codex config/keymap mutation. Report that as a
  fallback candidate for a separate Foreman-routed follow-up.
- Scope expands into async result routing, final session command design,
  GitHub mutation, PR creation, or removing `--i-am-present`.

## Completion Report Required

Return:

- branch and head SHA;
- base/start SHA;
- files changed;
- tests run and pass/fail counts;
- exact behavior change;
- how file-backed pointer prompts, startup settle, character typing, and
  isolated submit are represented in the receipt;
- how bridge byte delivery is now distinguished from provider prompt execution;
- whether live no-fixture provider acceptance should now be able to close from
  snapshot or metadata;
- remaining need for Operator supervised live proof;
- explicit statement that no live provider launch, transcript body read,
  provider store/catalog/telemetry mutation, gateway/dock/GitHub mutation,
  main merge, PR creation, or async result routing occurred.
