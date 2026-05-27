# Operator AFK Dev Session Trigger Provider Acceptance Live Proof V1

**Status:** Partial pass accepted 2026-05-23

## Result

- Classification: `provider_acceptance_unobserved_still_open`.
- Foreman review: accepted as live evidence that deterministic prompt
  submission and metadata promotion are still not enough to close provider
  acceptance in the real no-fixture path.
- Branch/ref gates passed on
  `foreman/afk-provider-acceptance-live-proof-v1` at
  `746c18a032c438d0e9b236d6672e7ddddab18885`, with accepted source SHA
  `f94bc43bb50b5d5bb274ef8e2d2a8a4c6990f223`.
- Preflight passed: `./aos ready`; `node --test
  tests/afk-session-trigger-prototype.test.mjs` with 16/16 passing;
  `node --test tests/afk-launch-attempt-prototype.test.mjs` with 30/30
  passing; `node --test tests/sigil-agent-terminal-server.test.mjs` with 14/14
  passing; and `cd packages/host && npm test` with 63/63 passing.
- Trigger receipt: exit code `1`, top-level
  `status=provider_acceptance_unobserved`,
  `packet.validation_status=valid`, `scheduler.lifecycle_state=rejected`,
  `dispatch.provider_launch_allowed=true`, `dispatch.launch_root=.docks/gdi`,
  `terminal_substrate.status=observed`, driver `process`, cwd
  `/Users/Michael/Code/agent-os/.docks/gdi`, command
  `codex --no-alt-screen`, and
  `terminal_substrate.snapshot_ref=inline:terminal_substrate.snapshot_summary`.
- Input submission evidence: `status=submitted`, `text_accepted=true`,
  `enter_sent=true`, `enter_accepted=true`, and
  `submitted_observed=true`.
- Snapshot evidence: bounded excerpt showed the AOS GDI transfer prompt with
  the expected goal, packet id, source artifact, and required start ref. That
  proves bridge byte delivery into the terminal, but not provider prompt
  execution.
- Provider acceptance remained unobserved:
  `provider_acceptance.status=provider_acceptance_unobserved`,
  `provider_session_id=not_observed`, provider cwd/branch/head/version all
  `not_observed`, and model was only `loading`.
- Codex adapter remained unobserved:
  `codex_adapter.status=observed`,
  `codex_adapter.correlation_status=not_observed`,
  `matched_thread_id=not_observed`, and `candidate_thread_ids=[]`.
- Mismatch: `provider_session_id_not_observed`.
- Bounded provider metadata: the only modified rollout in the trigger window
  was
  `/Users/Michael/.codex/sessions/2026/05/23/rollout-2026-05-23T11-52-21-019e5589-992e-71b2-85ee-6695b2d1bb8a.jsonl`,
  with `session_meta.payload.cwd` equal to
  `/Users/Michael/Code/agent-os/.docks/operator`. No `.docks/gdi` rollout was
  observed, and no transcript bodies were copied.
- Cleanup proof passed: `cleanup.status=verified`, with
  `owned_bridge_process_exit`,
  `owned_bridge_health_unreachable_after_teardown`,
  `owned_process_driver_child_exit`, and
  `owned_provider_command_child_exit`. Owned process child PID `87312` and
  provider command process group `87313` exited. No owned `codex
  --no-alt-screen`, bridge `server.mjs`, or `pty-proxy.py` remained.
- Final `./aos ready` reported
  `ready=true mode=repo daemon=reachable tap=active`; final git status was
  clean on `foreman/afk-provider-acceptance-live-proof-v1`; temporary
  packet/output files were removed.
- Boundary confirmed: no source, docs, config, provider config/session/catalog,
  telemetry, gateway, dock profile, hook, GitHub, push, PR, merge, external
  publication mutation, or async result routing occurred.
- Foreman source reading after the report found the remaining gap: the current
  bridge `/input` result proves bytes and Enter were written to the PTY, but the
  live Codex UI still showed the prompt text rather than an executing session.
  The next source correction is
  `docs/design/work-cards/afk-dev-session-trigger-provider-prompt-execution-observation-v0.md`.

## Transfer Classification

- Recipient: Operator
- Transfer kind: Operator run, supervised live/HITL evidence collection
- Single next goal: run one bounded no-fixture supervised live
  `./aos dev afk-session-trigger` Codex/GDI proof from the accepted metadata
  promotion source and report whether provider acceptance now closes in the
  real live path with verified cleanup.
- Source artifacts:
  - `docs/design/work-cards/afk-dev-session-trigger-metadata-provider-acceptance-promotion-v0.md`
  - `docs/design/work-cards/afk-dev-session-trigger-live-prompt-submission-observation-v0.md`
  - `docs/design/work-cards/operator-afk-dev-session-trigger-provider-acceptance-live-proof-v0.md`
  - `packets/to-operator-afk-dev-session-trigger-provider-acceptance-live-proof-v1.json`
  - `scripts/afk-launch-attempt-prototype.mjs`
  - `scripts/afk-session-trigger-prototype.mjs`
  - `tests/afk-launch-attempt-prototype.test.mjs`
  - `tests/afk-session-trigger-prototype.test.mjs`
- Branch/Base:
  - `branch_from: foreman/afk-provider-acceptance-live-proof-v1`
  - `required_start_ref: foreman/afk-provider-acceptance-live-proof-v1`
  - Accepted source branch:
    `gdi/afk-dev-session-trigger-metadata-provider-acceptance-promotion-v0`
  - Accepted source head:
    `f94bc43bb50b5d5bb274ef8e2d2a8a4c6990f223`
- Expected branch/output: stay local on the required start ref. Make no source,
  docs, config, provider config/session/catalog, telemetry, gateway, dock
  profile, hook, GitHub, push, PR, merge, or external publication changes.
  Return a Foreman chat report only.

Provider-owned Codex transcript/catalog metadata may be created by the
supervised launch and read only for bounded metadata diagnosis. Do not edit,
delete, move, clean, or paste full bodies from provider-owned Codex files.

## Fresh Context Contract

Operator starts from a fresh context window. Do not assume branch, worktree,
daemon, bridge process, provider session, transcript/catalog state, or prior
proof state. Read and rediscover before acting.

## Prior Evidence

- V0 live proof launched the Codex UI from `.docks/gdi` and verified cleanup,
  but no prompt was submitted and no `.docks/gdi` Codex metadata thread appeared.
- GDI then added live prompt submission through bridge `/input`.
- GDI then added metadata-backed promotion so a strong
  `matched_by_cwd_time_window` Codex adapter match after successful prompt
  submission promotes `provider_acceptance.status` to
  `provider_session_observed`.

## Goal

Prove the accepted no-fixture source path, not a fixture or dry-run hook, can
submit the packet prompt and observe provider acceptance from live evidence:

```bash
./aos dev afk-session-trigger \
  --packet <temp-packet.json> \
  --provider codex \
  --dock gdi \
  --supervised-live-launch \
  --i-am-present \
  --json \
  --timestamp <iso> \
  --out <temp-output.json>
```

Passing evidence for this Operator run is:

- `terminal_substrate.input_submission.status=submitted` or equivalent accepted
  text/Enter evidence;
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
- no `provider_acceptance_unobserved` or stale
  `provider_session_id_not_observed` mismatch remains in a pass.

If provider acceptance remains unobserved with verified cleanup, classify the
run as `provider_acceptance_unobserved_still_open`, not pass. If provider
acceptance is observed but cleanup is not verified, classify as
`cleanup_unverified`.

## Setup And Preflight

Run from `/Users/Michael/Code/agent-os`:

```bash
git status --short --branch
git rev-parse HEAD foreman/afk-provider-acceptance-live-proof-v1 f94bc43bb50b5d5bb274ef8e2d2a8a4c6990f223
./aos ready
node --test tests/afk-session-trigger-prototype.test.mjs
node --test tests/afk-launch-attempt-prototype.test.mjs
node --test tests/sigil-agent-terminal-server.test.mjs
cd packages/host && npm test
```

Stop if the worktree is dirty or if `HEAD` and
`foreman/afk-provider-acceptance-live-proof-v1` do not resolve to the same SHA.

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

- `packet_id`: `operator-afk-dev-session-trigger-provider-acceptance-live-proof-v1`
- `source_artifact`:
  `docs/design/work-cards/operator-afk-dev-session-trigger-provider-acceptance-live-proof-v1.md`
- `requested_recipient`: `gdi`
- `cwd` and `worktree`: `/Users/Michael/Code/agent-os`
- `required_start_ref`: `foreman/afk-provider-acceptance-live-proof-v1`
- `provider_hint`: `codex`
- `result_route`: one local stdout route
- `external_publication_policy`: `local-only`
- `goal`: `bounded live provider acceptance proof for guarded session trigger after prompt submission and metadata promotion`

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
  --idempotence-salt operator-provider-acceptance-live-proof-v1 \
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
