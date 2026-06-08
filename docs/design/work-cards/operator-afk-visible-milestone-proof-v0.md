# Work Card: Operator AFK Visible Milestone Proof V0

**Status:** Superseded 2026-05-24

## Supersession Notice

Do not route this card as written. It still uses the old pointer-shaped
warm-dock sentinel, which was superseded because the no-command boundary was
not visible until Implementer inspected a file.

The same milestone evidence was split into smaller accepted proofs:

- Headless scheduler/provider proof:
  `docs/design/work-cards/operator-afk-session-trigger-headless-scheduler-live-proof-v0.md`.
- Stdout route-object compatibility correction:
  `docs/design/work-cards/afk-session-trigger-stdout-route-object-normalization-v0.md`.
- Strict warm Implementer terminal reuse proof with inline no-command sentinel:
  `docs/design/work-cards/operator-afk-warm-dock-tui-reuse-live-proof-v2.md`.

If a future user-visible milestone packet is needed, draft a new V1 card using
the inline payload from the implementer native prompt contract; do not revive this
pointer-shaped warm sentinel flow.

## Transfer Classification

- Recipient: Operator
- Transfer kind: Operator run, supervised live/HITL evidence collection
- Single next goal: produce a user-believable AFK milestone report on current
  `main` by checking both the no-fixture headless AFK receipt path and the
  existing warm dock Implementer terminal path, or classify the exact blocker.
- Source artifacts:
  - `docs/design/work-cards/operator-afk-dev-session-trigger-prompt-prefix-provider-acceptance-live-proof-v0.md`
  - `docs/design/work-cards/afk-dev-session-trigger-codex-adapter-metadata-mismatch-cleanup-v0.md`
  - `docs/design/work-cards/afk-warm-dock-tui-reuse-contract-v0.md`
  - `docs/design/work-cards/operator-afk-warm-dock-tui-reuse-live-proof-v0.md`
  - `docs/design/work-cards/afk-warm-dock-tui-reuse-live-sentinel-v0.md`
  - `scripts/afk-session-trigger-prototype.mjs`
  - `scripts/afk-launch-attempt-prototype.mjs`
  - `scripts/dock-inbound-message-contract`
- Required start ref: `origin/main` with this work card present.
- Output expectation: no source, docs, config, provider config, provider store,
  gateway, dock runtime, GitHub, branch, PR, main, or async routing mutation.
  Return a Foreman chat report only.

## Why This Exists

The prior no-fixture Codex/Implementer proof passed as an Operator receipt, but it was
not a visible product milestone for the user. The prior warm dock TUI proof was
blocked by a loop-prone one-shot prompt shape, not by the warm-reuse contract
itself.

This run is deliberately milestone-shaped:

- headless AFK must prove itself with a real no-fixture receipt on current
  `main`;
- the existing Implementer terminal must prove a warm `/clear` plus `` work-card
  pointer path without launching a cold provider or bridge;
- do not overclaim that the Sigil Agent Terminal UI shows AFK unless the same
  AFK attempt is actually visible there. Current source is expected to use a
  private temporary bridge for cold supervised launches and tear it down after
  the run.

## Fresh Context Contract

Start from fresh context. Rediscover branch, worktree, readiness, current
provider process state, and Codex metadata state before acting. Do not assume
the previous live-proof state still applies.

## Setup And Preflight

Run from `/Users/Michael/Code/agent-os`:

```bash
git status --short --branch
git rev-parse HEAD origin/main
./aos ready
node --test tests/afk-session-trigger-prototype.test.mjs
node --test tests/afk-launch-attempt-prototype.test.mjs
git diff --check
```

Stop if the worktree is dirty, `HEAD` is not on current `main`/`origin/main`,
or readiness reports a repo-mode Accessibility, Input Monitoring, or inactive
input-tap blocker. For readiness blockers, stop and report `manual_intervention` with
the exact blocker and the standard human action:

```text
Run ./aos permissions setup --once, grant the requested macOS permission if
prompted, then return and run ./aos ready --post-permission.
```

## Native Prompt Contract Check

Validate the Implementer sentinel payload before asking the human to send it:

```bash
payload='follow the instructions in docs/design/work-cards/afk-warm-dock-tui-reuse-live-sentinel-v0.md'
printf '%s' "$payload" | scripts/dock-inbound-message-contract --target-dock implementer --json
```

Expected:

- `ok=true`;
- `provider_entry_prefix=""`;
- `provider_entry_preview` starts with `follow the instructions in ...`;
- no error diagnostics;
- no `reply exactly` or `proof only` warning.

Stop if the payload is rejected or warned as loop-prone.

## Headless AFK Proof

Run exactly one no-fixture supervised Codex/Implementer trigger attempt. Create a temp
packet and temp output outside the repo. The packet should use:

- `packet_id`: `operator-afk-visible-milestone-headless-v0`
- `source_artifact`:
  `docs/design/work-cards/operator-afk-visible-milestone-proof-v0.md`
- `requested_recipient`: `implementer`
- `cwd` and `worktree`: `/Users/Michael/Code/agent-os`
- `required_start_ref`: `origin/main`
- `provider_hint`: `codex`
- `result_route`: one local stdout route
- `external_publication_policy`: `local-only`
- `goal`: `current-main headless AFK milestone proof`

Run:

```bash
./aos dev afk-session-trigger \
  --packet <temp-packet.json> \
  --provider codex \
  --dock implementer \
  --supervised-live-launch \
  --i-am-present \
  --json \
  --timestamp <iso> \
  --idempotence-salt operator-afk-visible-milestone-headless-v0 \
  --out <temp-output.json>
```

Passing headless evidence requires:

- exit code `0`;
- top-level `status=completed`;
- `scheduler.lifecycle_state=completed`;
- `terminal_substrate.input_submission.provider_prompt_mode=codex_goal`;
- `terminal_substrate.input_submission.provider_prompt_prefix=""`;
- `provider_acceptance.status=provider_session_observed`;
- concrete `provider_acceptance.provider_session_id`;
- `provider_acceptance.observation_source=codex_adapter_metadata` or another
  concrete live source;
- `cleanup.status=verified`;
- no top-level or nested stale `provider_session_id_not_observed` mismatch.

If this fails, classify the milestone as `headless_afk_not_proven` and include
the bounded receipt fields. Do not run a second attempt without returning to
Foreman.

## Warm Dock Implementer Proof

This proof uses the human's existing Implementer Codex terminal. Do not start a new
Codex process, do not run `codex --no-alt-screen`, and do not start the Sigil
Agent Terminal bridge for this warm proof.

Before the human touches Implementer, collect metadata-only baselines for the newest
Codex `session_meta` records with cwd ending `the implementer native subagent` and
`the operator native subagent`. Do not read or quote transcript bodies.

Ask the human to perform exactly this in the existing Implementer terminal:

```text
/clear
follow the instructions in docs/design/work-cards/afk-warm-dock-tui-reuse-live-sentinel-v0.md
```

After Implementer reports back, collect metadata-only evidence for cwd `the implementer native subagent`
again. Passing warm evidence requires:

- the human confirms the existing Implementer terminal was used;
- the Implementer inbound payload was the allowed work-card pointer shape;
- metadata shows a post-dispatch Codex session for cwd `the implementer native subagent`;
- when a pre-dispatch `the implementer native subagent` session id was visible, the post-dispatch id
  differs from it;
- no proof-owned cold `codex --no-alt-screen`, `server.mjs`, or `pty-proxy.py`
  process was started for the warm proof;
- Implementer did not edit files, run commands, mutate provider state, or loop.

If the Implementer terminal loops or repeats completion, classify
`warm_tui_reuse_blocked_stale_goal_loop` and tell the human to recover with
clear the stale prompt state, then `/clear`.

If metadata cannot prove a new `the implementer native subagent` session after `/clear`, classify
`warm_tui_metadata_unobserved`.

## Agent Terminal UI Classification

Do not claim "Agent Terminal shows AFK" unless the same AFK attempt is visible
through a persistent Agent Terminal surface. If the headless proof passes but
the cold AFK path only exposes a private temporary bridge that is torn down
after the run, classify this explicitly as:

```text
agent_terminal_afk_visibility_not_integrated_yet
```

That is an implementation gap for Foreman/Implementer, not an Operator failure.

## Final Checks

Run:

```bash
./aos ready
git status --short --branch
```

Remove only temporary packet/output files you created outside the repo. Do not
delete provider-owned Codex files.

## Completion Report Required

Return a concise Foreman report with:

- branch/head and clean/dirty status;
- preflight results;
- native subagent prompt contract result for the Implementer sentinel payload;
- headless AFK classification and key receipt fields;
- warm dock Implementer classification and metadata-only before/after summary;
- Agent Terminal UI classification;
- process comparison summary;
- final readiness and git status;
- whether transcript bodies were read, expected answer: no;
- explicit statement that no forbidden mutation or async result routing
  occurred.
