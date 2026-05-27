# Operator AFK Dev Session Trigger Goal Prefix Provider Acceptance Live Proof V0

**Status:** Accepted with residual deterministic follow-up 2026-05-23

## Result

- Classification:
  `provider_acceptance_live_proof_passed_with_residual_adapter_mismatch`.
- Foreman review: accepted as closing the live provider-acceptance gate for the
  supervised Codex/GDI path. The run proved provider-native `/goal ` prompt
  submission, metadata-backed provider acceptance, concrete Codex session
  identity, verified cleanup, completed top-level receipt state, and clean final
  readiness.
- Branch/ref gates passed on
  `gdi/afk-dev-session-trigger-codex-goal-prefix-transport-v0` at
  `09b84c86dda2753f278f9a4079db13b0066a0044`, which contains accepted source
  SHA `9b02689b52894fe8d2770606eeda5190ddde6869`.
- Preflight passed: `./aos ready`; `node --test
  tests/afk-session-trigger-prototype.test.mjs` with 16/16 passing; `node
  --test tests/afk-launch-attempt-prototype.test.mjs` with 35/35 passing;
  `node --test tests/sigil-agent-terminal-server.test.mjs` with 14/14 passing;
  and `cd packages/host && npm test` with 63/63 passing.
- Trigger receipt: exit code `0`; top-level `status=completed`;
  `packet.validation_status=valid`; `scheduler.lifecycle_state=completed`;
  `dispatch.provider_launch_allowed=true`; `dispatch.launch_root=.docks/gdi`;
  terminal driver `process`; cwd `/Users/Michael/Code/agent-os/.docks/gdi`;
  command `codex --no-alt-screen`.
- Input submission evidence: submitted with
  `provider_prompt_mode=codex_goal`, `provider_prompt_prefix="/goal "`,
  `text_accepted=true`, `key_accepted=true`, and
  `provider_execution_observed=true`. Bounded prompt evidence confirmed the
  prompt builder emitted `/goal Your work card is at ...`.
- Provider acceptance: `provider_acceptance.status=provider_session_observed`;
  session id `019e562f-2fbd-74d3-8cf8-3dd61a1c7095`; source
  `codex_adapter_metadata`; `codex_adapter.status=observed`;
  `codex_adapter.correlation_status=matched_by_cwd_time_window`;
  `matched_cwd_basis=intended_launch_cwd`; reported cwd
  `/Users/Michael/Code/agent-os/.docks/gdi`. Branch, head, and version were not
  observed; model held loading-state text.
- Residual finding: top-level `mismatches=[]`, but
  `codex_adapter.mismatches` still contained
  `provider_session_id_not_observed` from bridge visibility before metadata
  promotion. The clean-pass criteria required no stale
  `provider_session_id_not_observed` mismatch, so Foreman routed
  `docs/design/work-cards/afk-dev-session-trigger-codex-adapter-metadata-mismatch-cleanup-v0.md`.
- Cleanup proof passed: `cleanup.status=verified`, including
  `owned_bridge_process_exit`,
  `owned_bridge_health_unreachable_after_teardown`,
  `owned_process_driver_child_exit`, and
  `owned_provider_command_child_exit`. Post-run process comparison showed no
  remaining `codex --no-alt-screen`, bridge `server.mjs`, or `pty-proxy.py`;
  only pre-existing Codex app/Sparkle processes remained.
- Bounded Codex metadata: new matching rollout
  `/Users/Michael/.codex/sessions/2026/05/23/rollout-2026-05-23T14-53-13-019e562f-2fbd-74d3-8cf8-3dd61a1c7095.jsonl`;
  mtime `2026-05-23T14:53:16-0400`; size `67823`;
  `session_meta.payload.id` matched the provider session and matched thread id;
  `session_meta.payload.cwd=/Users/Michael/Code/agent-os/.docks/gdi`.
- Final `./aos ready` reported
  `ready=true mode=repo daemon=reachable tap=active`; final git status was
  clean on the same branch; temporary packet/output files under
  `/tmp/aos-operator-afk-live-proof-v0` were removed.
- Boundary confirmed: async result routing was not started, and Operator made
  no source, docs, config, provider, GitHub, push, PR, main, or async routing
  mutation.

## Transfer Classification

- Recipient: Operator
- Transfer kind: Operator run, supervised live/HITL evidence collection
- Single next goal: run one bounded no-fixture supervised live
  `./aos dev afk-session-trigger` Codex/GDI proof from the accepted goal-prefix
  source and report whether provider acceptance now closes in the real live path
  with verified cleanup.
- Source artifacts:
  - `docs/design/work-cards/afk-dev-session-trigger-codex-goal-prefix-transport-v0.md`
  - `docs/design/work-cards/afk-dev-session-trigger-codex-goal-prefix-receipt-source-correction-v0.md`
  - `docs/design/work-cards/operator-afk-dev-session-trigger-provider-acceptance-live-proof-v1.md`
  - `.docks/foreman/packets/to-operator-afk-dev-session-trigger-goal-prefix-provider-acceptance-live-proof-v0.json`
  - `scripts/afk-launch-attempt-prototype.mjs`
  - `scripts/afk-session-trigger-prototype.mjs`
  - `tests/afk-launch-attempt-prototype.test.mjs`
  - `tests/afk-session-trigger-prototype.test.mjs`
- Branch/Base:
  - `branch_from: gdi/afk-dev-session-trigger-codex-goal-prefix-transport-v0`
  - `required_start_ref: gdi/afk-dev-session-trigger-codex-goal-prefix-transport-v0`
  - Accepted deterministic source head:
    `9b02689b52894fe8d2770606eeda5190ddde6869`
  - Start from the local branch head that contains this Operator card and
    packet. The remote branch may lag if Foreman has not pushed this routing
    checkpoint.
- Expected output: stay local on the required start ref. Make no source, docs,
  config, provider config/session/catalog, telemetry, gateway, dock profile,
  hook, GitHub, push, PR, merge, main, or external publication changes. Return a
  Foreman chat report only.

Provider-owned Codex transcript/catalog metadata may be created by the
supervised launch and read only for bounded metadata diagnosis. Do not edit,
delete, move, clean, or paste full transcript bodies from provider-owned Codex
files.

## Fresh Context Contract

Operator starts from a fresh context window. Do not assume branch, worktree,
daemon, bridge process, provider session, transcript/catalog state, or prior
proof state. Read and rediscover before acting.

## Prior Evidence

- V1 live proof launched Codex from `.docks/gdi`, verified cleanup, and proved
  bridge byte delivery, but the Codex UI still showed the prompt text rather
  than executing it. Provider acceptance remained unobserved.
- GDI then isolated live prompt submission timing and switched to
  character-by-character input with a separate final Enter.
- GDI then added provider-owned Codex/GDI `/goal ` prefixing and corrected the
  actual live receipt source so the submitted prompt and receipt profile are
  aligned.
- Foreman accepted the deterministic correction at
  `9b02689b52894fe8d2770606eeda5190ddde6869` after:
  - `./aos ready`;
  - `node --test tests/afk-launch-attempt-prototype.test.mjs` with 35/35
    passing;
  - `node --test tests/afk-session-trigger-prototype.test.mjs` with 16/16
    passing;
  - `node --test tests/sigil-agent-terminal-server.test.mjs` with 14/14
    passing;
  - `cd packages/host && npm test` with 63/63 passing;
  - `git diff --check`.

## Goal

Prove the accepted no-fixture source path, not a fixture or dry-run hook, can
submit the provider-native Codex `/goal ` prompt and observe provider acceptance
from live evidence:

```bash
./aos dev afk-session-trigger \
  --packet <temp-packet.json> \
  --provider codex \
  --dock gdi \
  --supervised-live-launch \
  --i-am-present \
  --json \
  --timestamp <iso> \
  --idempotence-salt operator-goal-prefix-provider-acceptance-live-proof-v0 \
  --out <temp-output.json>
```

Passing evidence for this Operator run is:

- `terminal_substrate.input_submission.status=submitted` or equivalent accepted
  text/Enter evidence;
- `terminal_substrate.input_submission.provider_prompt_mode=codex_goal`;
- `terminal_substrate.input_submission.provider_prompt_prefix="/goal "`;
- snapshot or bounded prompt evidence shows the prompt starts with
  `/goal Your work card is at ...`;
- `provider_acceptance.status=provider_session_observed`;
- `provider_acceptance.provider_session_id` is a concrete observed id from
  either live snapshot text or promoted Codex metadata;
- if metadata promotion closes the gate,
  `provider_acceptance.observation_source=codex_adapter_metadata` and
  `codex_adapter.correlation_status=matched_by_cwd_time_window`;
- provider acceptance carries any observed cwd, branch, head, version, and model
  fields available from bounded snapshot or metadata;
- `terminal_substrate.snapshot_ref` is reviewable and
  `terminal_substrate.snapshot_summary.text_excerpt` is bounded;
- `cleanup.status=verified`;
- top-level receipt `status=completed` and
  `scheduler.lifecycle_state=completed`;
- no `provider_acceptance_unobserved`, `provider_session_id_not_observed`, or
  stale prompt-profile mismatch remains in a pass.

If provider acceptance remains unobserved with verified cleanup, classify the
run as `provider_acceptance_unobserved_still_open`, not pass. If provider
acceptance is observed but cleanup is not verified, classify as
`cleanup_unverified`.

## Setup And Preflight

Run from `/Users/Michael/Code/agent-os`:

```bash
git status --short --branch
git rev-parse HEAD gdi/afk-dev-session-trigger-codex-goal-prefix-transport-v0 9b02689b52894fe8d2770606eeda5190ddde6869
./aos ready
node --test tests/afk-session-trigger-prototype.test.mjs
node --test tests/afk-launch-attempt-prototype.test.mjs
node --test tests/sigil-agent-terminal-server.test.mjs
cd packages/host && npm test
```

Stop if the worktree is dirty, or if `HEAD` does not contain the accepted source
SHA `9b02689b52894fe8d2770606eeda5190ddde6869`.

If repo-mode TCC or input-tap readiness blocks, run:

```bash
.docks/operator/scripts/human-needed-tcc-reset
```

Then stop with `human_needed`. After the human returns with `finished`, run:

```bash
./aos ready --post-permission
```

Only continue if readiness reports
`ready=true mode=repo daemon=reachable tap=active`.

## Baseline Process And Metadata Snapshot

Before the trigger run, capture bounded baseline state:

```bash
ps -axo pid=,ppid=,pgid=,command= | rg 'server.mjs|pty-proxy.py|codex --no-alt-screen|Codex' || true
find /Users/Michael/.codex/sessions /Users/Michael/.codex/archived_sessions \
  -type f -newermt '<iso-now-minus-10-minutes-local>' -print | sort
```

Also record the newest five rollout files under the current
`/Users/Michael/.codex/sessions/YYYY/MM/DD` directory with mtimes and sizes.
Do not open or paste full transcript bodies.

## Packet And Trigger Run

Create temporary packet and output paths outside the repo. The packet should
use:

- `packet_id`: `operator-afk-dev-session-trigger-goal-prefix-provider-acceptance-live-proof-v0`
- `source_artifact`:
  `docs/design/work-cards/operator-afk-dev-session-trigger-goal-prefix-provider-acceptance-live-proof-v0.md`
- `requested_recipient`: `gdi`
- `cwd` and `worktree`: `/Users/Michael/Code/agent-os`
- `required_start_ref`: `gdi/afk-dev-session-trigger-codex-goal-prefix-transport-v0`
- `provider_hint`: `codex`
- `result_route`: one local stdout route
- `external_publication_policy`: `local-only`
- `goal`: `bounded live provider acceptance proof for guarded session trigger after provider-native /goal prompt submission`

Run exactly one no-fixture trigger attempt:

```bash
./aos dev afk-session-trigger \
  --packet <temp-packet.json> \
  --provider codex \
  --dock gdi \
  --supervised-live-launch \
  --i-am-present \
  --json \
  --timestamp <iso> \
  --idempotence-salt operator-goal-prefix-provider-acceptance-live-proof-v0 \
  --out <temp-output.json>
```

Do not pass `--bridge-visibility-fixture`, `--cleanup-proof-fixture`,
`--provider-session-id`, `--codex-home`, or the internal
`--provider-launch-dry-run` script flag. Do not start async result routing.

Record:

- command exit code;
- top-level `status`;
- `packet.validation_status`;
- `scheduler.lifecycle_state`;
- `dispatch.provider_launch_allowed`;
- `dispatch.launch_root`;
- `terminal_substrate.status`, `driver`, `cwd`, and `command`;
- `terminal_substrate.input_submission` status and accepted fields;
- `terminal_substrate.input_submission.provider_prompt_mode`;
- `terminal_substrate.input_submission.provider_prompt_prefix`;
- whether the first visible prompt character is `/`, using only bounded
  snapshot/prompt evidence;
- `terminal_substrate.snapshot_ref`;
- bounded `terminal_substrate.snapshot_summary` fields, especially
  `text_excerpt`;
- `provider_acceptance.status`;
- `provider_acceptance.provider_session_id`;
- `provider_acceptance.observation_source`;
- `provider_acceptance.provider_reported_cwd`;
- `provider_acceptance.provider_reported_branch`;
- `provider_acceptance.provider_reported_head`;
- `provider_acceptance.provider_version`;
- `provider_acceptance.model`;
- `codex_adapter.status`, `correlation_status`, `matched_thread_id`,
  `matched_cwd_basis`, and bounded evidence refs;
- `catalog.status` and `telemetry.status`;
- `cleanup.status`, `cleanup.reason`, `cleanup.scope`, and cleanup proof item
  kinds;
- whether proof includes `owned_bridge_process_exit`,
  `owned_bridge_health_unreachable_after_teardown`,
  `owned_process_driver_child_exit`, and
  `owned_provider_command_child_exit`;
- mismatch classes.

## Post-Run Cleanup Proof

After the command returns, capture the same bounded process snapshot:

```bash
ps -axo pid=,ppid=,pgid=,command= | rg 'server.mjs|pty-proxy.py|codex --no-alt-screen|Codex' || true
find /Users/Michael/.codex/sessions /Users/Michael/.codex/archived_sessions \
  -type f -newermt '<pre-trigger local time>' -print | sort
```

For any likely nested Codex or bridge process, report PID, PPID, cwd, and
command using read-only commands such as `ps` and
`lsof -a -p <pid> -d cwd`. Do not kill unrelated pre-existing provider
sessions.

If a new or modified rollout file appears in the window, report only:

- file path;
- mtime;
- size;
- `session_meta.payload.id`;
- `session_meta.payload.timestamp`;
- `session_meta.payload.cwd`;
- whether the id matches `provider_acceptance.provider_session_id` or
  `codex_adapter.matched_thread_id`.

Do not copy transcript bodies.

## Final Checks

Run:

```bash
./aos ready
git status --short --branch
```

Remove only temporary packet/output files you created outside the repo. Do not
delete provider-owned Codex files.

## Boundaries

- This is one supervised live proof.
- Do not run more than one trigger attempt without returning to Foreman.
- Do not start async result routing.
- Do not remove or relax `--i-am-present`.
- Do not mutate source, docs, provider config/session/catalog, telemetry,
  gateway, dock profiles, hooks, GitHub state, PRs, main, or provider transcript
  bodies.
- Do not route the result to GDI or merge anything.

## Completion Report Required

Return a concise Foreman report with:

- branch and HEAD;
- accepted source SHA;
- preflight results;
- trigger exit code and receipt field summary;
- classification:
  - `provider_acceptance_live_proof_passed`;
  - `provider_acceptance_unobserved_still_open`;
  - `cleanup_unverified`;
  - `human_needed`;
  - or another precise blocker class;
- bounded provider metadata summary;
- cleanup proof and post-run process comparison;
- final readiness and git status;
- explicit statement that async result routing was not started and no forbidden
  mutation occurred.
