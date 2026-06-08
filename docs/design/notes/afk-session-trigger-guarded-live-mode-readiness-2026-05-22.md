# AFK Session Trigger Guarded Live Mode Readiness

**Date:** 2026-05-22
**Status:** docs-only guarded-live readiness decision

## Summary

The accepted dry-run `./aos dev afk-session-trigger` command and the accepted
live `./aos dev afk-launch-attempt` wrapper proof are sufficient to route one
narrow source slice for a supervised live provider launch mode. They are not
sufficient to promote final `aos session ...` command spelling or unattended
provider launch.

The next source slice should keep live launch under the experimental developer
surface and require an explicit human-supervised launch gate:

```bash
./aos dev afk-session-trigger \
  --packet <packet.json> \
  --provider codex \
  --dock implementer \
  --supervised-live-launch \
  --i-am-present \
  --json
```

The command must reject ambiguous launch flags such as bare `--start`,
`--live`, or `--launch-provider`. A provider process may start only after the
command has validated packet/current-state facts, resolved `the implementer native subagent`, proved
human-supervised intent from explicit flags, claimed the idempotence key, and
created a pre-launch receipt that can prevent duplicate launches.

## Context

The accepted dry-run command in
`docs/design/work-cards/afk-dev-session-trigger-dry-run-command-v0.md` proves
the trigger command can validate a local transfer packet, model scheduler
intake, model provider-neutral dispatch intent, resolve the dock launch root,
and emit `aos.afk_session_trigger_dry_run` with
`provider_launch_allowed=false`, terminal substrate `not_attempted`, and result
route `not_attempted`.

The accepted live wrapper proof in
`docs/design/work-cards/operator-afk-dev-launch-attempt-command-live-wrapper-v0.md`
proves a supervised bridge launch can start nested Codex from `the implementer native subagent`,
capture PTY/input evidence, materialize a provider-owned Codex rollout, and
feed read-only live evidence through `./aos dev afk-launch-attempt` as
`provider_session_observed` with exact Codex adapter correlation. It also
proved cleanup: the bridge port was unreachable afterward and no matching
nested Codex, `pty-proxy.py`, or bridge server process remained.

Together those proofs close the "can we model trigger intent" and "can the
wrapper consume supervised live evidence" questions. They do not close
unattended launch, final scheduler persistence, final route delivery,
provider-neutral fallback, or provider transcript/catalog ownership questions.

## Command Surface Decision

| Decision | Answer | Reason |
| --- | --- | --- |
| Command family | Keep the first live launch under `./aos dev afk-session-trigger`. | The command remains experimental and repo-development scoped while scheduler lifecycle, receipt storage, and route delivery stay pre-schema. |
| Final spelling | Defer final `aos session ...`. | Final spelling should wait until guarded live launch, duplicate prevention, cleanup proof, and result-route evidence have source-backed behavior. |
| Live flag shape | Use `--supervised-live-launch` plus `--i-am-present`. | The flags make intent explicit and avoid ambiguous verbs such as bare `--start`. |
| Dry-run compatibility | Preserve existing `--dry-run`; reject combining it with `--supervised-live-launch`. | A single invocation should have one selected action. |
| JSON review output | Require `--json` for the first source slice. | Foreman and Operator need machine-readable receipts to verify boundaries. |
| Provider launch default | Launch remains disallowed unless `--supervised-live-launch` and `--i-am-present` are both present. | Human presence is a launch permission, not an inferred mode. |

The command should not add `--start`, `--live`, `--launch-provider`,
`--unattended`, `--background`, or final session-control aliases in this slice.

## Human-Supervised Launch Gate

The first live mode may launch a provider only when all gate checks pass:

- `--supervised-live-launch` is present.
- `--i-am-present` is present in the same invocation.
- `--json` is present.
- `--provider codex` is selected explicitly or by a packet hint confirmed by
  `--provider codex`.
- `--dock implementer` is selected explicitly or by a packet recipient confirmed by
  `--dock implementer`.
- The packet source artifact exists, `required_start_ref` resolves, and the
  current repo/worktree facts match the accepted launch policy.
- implementer session metadata and `the implementer native subagent` resolve.
- No in-process or receipt-backed duplicate launch exists for the idempotence
  key.
- The receipt writer can persist or emit the pre-launch receipt before starting
  a terminal substrate.

If any gate fails before a provider process starts, the command should emit a
`rejected` or `blocked` receipt and must not start a bridge, terminal, tmux,
provider process, gateway job, or result route.

The gate is intentionally explicit rather than a security boundary. It proves a
human deliberately requested a supervised run from the active terminal. It does
not authorize background or unattended scheduling.

## Provider And Dock Scope

The first live source slice should be Codex-only and Implementer-only:

```text
provider: codex
dock: implementer
launch root: the implementer native subagent
terminal substrate: supervised local bridge or lower-level helper that exposes
  equivalent bridge health, session handle, PTY/input, and cleanup evidence
```

Claude, Gemini, and other providers should remain provider-neutral receipt
outcomes, not live launch targets. If selected, they should return
`provider_unsupported_for_supervised_live` or an equivalent unavailable-provider
result without launching a provider. This keeps the command shape
provider-neutral while avoiding fake parity for providers that lack accepted
live evidence in this workstream.

## Duplicate Prevention And Idempotence

Duplicate prevention must happen before a provider process starts. The live
mode should extend the dry-run idempotence key with live action and supervised
launch policy:

```text
hash(packet_id_or_ref, scheduler_run_id, selected_dock, selected_provider,
     launch_root, intended_worktree, required_start_ref, result_route_refs,
     action=supervised-live-launch, human_gate=present)
```

Rules:

- If the same idempotence key already has `terminal_started`,
  `provider_acceptance_unobserved`, `provider_session_observed`, or
  `completed`, return the existing launch-attempt state or `duplicate`; do not
  start a second provider.
- If a prior attempt is `rejected`, `failed`, `expired`, or `blocked`, require
  a fresh scheduler run, dispatch attempt, or explicit replacement/supersession
  field before another launch.
- If the receipt output cannot be written before launch, fail with
  `receipt_write_failed` and do not launch.
- The duplicate key must not depend on provider session id, catalog source
  file, transcript path, telemetry ref, or terminal snapshot because those are
  post-launch observations.

This source slice may keep the registry in process plus an optional local
receipt lookup if durable storage is not ready. It must still report exactly
which duplicate surface was checked.

## Cleanup Proof

Any live mode that uses a bridge or terminal substrate must prove cleanup before
returning a terminal success receipt:

- bridge health endpoint unreachable or stopped;
- no matching nested `codex --no-alt-screen` process started by this attempt;
- no matching `pty-proxy.py` process started by this attempt;
- no matching bridge server process started by this attempt;
- temporary packet, bridge fixture, and receipt scratch files removed when they
  are owned by the command;
- provider-owned Codex transcript and catalog files left untouched.

If cleanup cannot be proven, the command should not report terminal
`completed`. It should return `blocked` or `failed` with a
`cleanup_unverified` mismatch and include the process, port, or file evidence
that still requires human or Operator handling.

## Provider Transcript And Catalog Boundary

The live command may observe provider-owned Codex files only through explicit,
read-only adapter/correlation paths that match the accepted wrapper proof. It
must not edit, delete, move, normalize, or summarize full provider transcripts
as its own state.

Allowed boundaries:

- record provider session id, source file path, mtime, size, cwd metadata, and
  bounded marker/correlation status when explicitly requested by the live
  evidence contract;
- report catalog and telemetry as `not_observed` unless a read-only adapter
  actually observes them;
- store links or refs to provider-owned evidence, not copied transcript
  content.

Disallowed boundaries:

- reading real `~/.codex` transcript bodies as a default trigger behavior;
- mutating provider session files, provider catalogs, telemetry stores, or
  provider config;
- treating provider transcript content as the transfer packet, scheduler
  state, work receipt, or result route.

## Receipt Extension

The live receipt should extend `aos.afk_session_trigger_dry_run` without
collapsing ownership between scheduler intent, dispatch attempt, terminal
substrate, provider acceptance, Codex adapter correlation, result route, and
work/evidence receipts.

Sketch:

```json
{
  "record_type": "aos.afk_session_trigger_supervised_live",
  "schema_status": "not_a_schema",
  "status": "provider_session_observed",
  "packet": {
    "packet_ref": "<path>",
    "packet_id": "<packet id or not_observed>",
    "source_artifact": "<path or not_observed>",
    "validation_status": "valid"
  },
  "scheduler": {
    "scheduler_run_id": "scheduler-<stable-id>",
    "idempotence_key": "<stable-key>",
    "lifecycle_state": "launching|running|blocked|failed",
    "selected_action": "supervised-live-launch",
    "lease": "not_enforced"
  },
  "dispatch": {
    "dispatch_attempt_id": "dispatch-<stable-id>",
    "launch_attempt_id": "launch-attempt-<stable-id>",
    "selected_provider": "codex",
    "selected_dock": "implementer",
    "dock_profile_ref": "implementer session metadata",
    "launch_root": "the implementer native subagent",
    "action": "supervised-live-launch",
    "provider_launch_allowed": true,
    "human_supervision": {
      "status": "confirmed",
      "flags": ["--supervised-live-launch", "--i-am-present"]
    }
  },
  "terminal_substrate": {
    "status": "observed",
    "driver": "process|tmux",
    "session_handle": "<handle>",
    "geometry": "100x31",
    "cleanup_status": "verified|cleanup_unverified"
  },
  "provider_acceptance": {
    "status": "provider_session_observed|not_observed",
    "provider_session_id": "<id or not_observed>",
    "provider_reported_cwd": "the implementer native subagent or not_observed"
  },
  "codex_adapter": {
    "status": "observed|not_observed",
    "correlation_status": "matched_by_provider_session_id|not_observed",
    "confidence": "exact|not_observed",
    "matched_thread_ref": "codex-thread:<id>|not_observed",
    "matched_deeplink": "codex://threads/<id>|not_observed"
  },
  "catalog": {
    "status": "not_observed"
  },
  "telemetry": {
    "status": "not_observed"
  },
  "result_route": {
    "status": "not_attempted",
    "refs": []
  },
  "work_receipt": {
    "status": "not_attempted",
    "reason": "launch-only source slice"
  },
  "evidence": {
    "required_before_completed": [
      "human_supervision_confirmed",
      "terminal_substrate_observed",
      "provider_acceptance_or_explicit_timeout",
      "cleanup_verified"
    ],
    "observed_refs": []
  },
  "mismatches": []
}
```

Status vocabulary should include existing dry-run statuses plus
`provider_session_observed`, `provider_acceptance_unobserved`,
`cleanup_unverified`, and `provider_unsupported_for_supervised_live`.

## Reuse Decision

The live trigger command should share lower-level helpers with
`./aos dev afk-launch-attempt` or delegate to the underlying prototype logic
only if the implementation can preserve separate receipt sections. It should
not shell out to `./aos dev afk-launch-attempt` as an opaque subcommand if that
would hide scheduler gate decisions, duplicate prevention, human-supervision
flags, or cleanup proof.

Recommended implementation direction:

- keep `afk-session-trigger` as scheduler/guard owner;
- reuse receipt normalization, idempotence, dock/provider validation, and
  Codex correlation helpers from the launch-attempt prototype where practical;
- refactor shared helper modules only when needed to avoid copying live
  evidence logic;
- preserve `afk-launch-attempt` as the dispatch/launch-attempt record owner for
  diagnostic fixture and live evidence correlation.

## Verification And Operator Evidence Plan

The next source slice should have deterministic checks and one supervised
Operator evidence round.

Deterministic verification:

- focused Node tests for valid gated live receipt construction, missing
  `--i-am-present`, unsupported provider, duplicate idempotence, and cleanup
  failure classification;
- help and audit checks proving the new flags are explicit and no ambiguous
  launch aliases appear;
- command-level smoke with a temp packet that uses a no-provider or fixture
  terminal substrate and proves no provider is launched unless the supervised
  gate is present;
- existing `afk-session-trigger` dry-run smoke still passes.

Operator evidence:

- run exactly one supervised Codex launch from `the implementer native subagent`;
- record `./aos ready` before launch;
- capture bridge health, `/ensure`, resize/input or equivalent substrate
  evidence;
- verify Codex acceptance or explicit provider-acceptance timeout;
- run read-only Codex adapter correlation only within the accepted evidence
  window;
- verify cleanup with port/process checks;
- confirm no source, schema, provider config, gateway state, dock profile/hook,
  GitHub state, push, PR, or unattended launch changed.

Stop conditions:

- TCC/Input Monitoring readiness blocks;
- provider auth prompt or install prompt appears;
- the command cannot write its pre-launch receipt;
- duplicate idempotence cannot be checked before launch;
- cleanup cannot be proven;
- selected provider is not Codex or selected dock is not Implementer.

## Recommended Next Work Card

Title:

```text
AFK Dev Session Trigger Guarded Live Codex Launch V0
```

Goal:

```text
Add a guarded, supervised-live Codex-only mode to experimental
./aos dev afk-session-trigger. The command must require
--supervised-live-launch and --i-am-present, validate the packet/current-state
facts proven by the dry-run command, prevent duplicate launches before starting
any provider process, launch only Codex from the implementer native subagent through the accepted
terminal substrate path, emit a no-schema supervised-live receipt that preserves
scheduler/dispatch/terminal/provider/correlation/result-route ownership, and
prove cleanup before reporting terminal success.
```

Likely files:

- `scripts/afk-session-trigger-prototype.mjs`
- `scripts/afk-launch-attempt-prototype.mjs`
- `tests/afk-session-trigger-prototype.test.mjs`
- `tests/afk-launch-attempt-prototype.test.mjs`
- `src/commands/dev.swift`
- `src/shared/command-registry-data.swift`
- `tests/dev-workflow-router.sh`
- `tests/help-contract.sh`

Behavior:

- preserve the accepted dry-run path unchanged;
- add Codex/Implementer-only supervised live launch behind explicit human-present
  flags;
- return unavailable-provider receipts for Claude, Gemini, or other providers;
- emit duplicate/idempotence, cleanup, provider acceptance, and Codex adapter
  correlation sections;
- leave result route and work receipt delivery as `not_attempted` in this
  launch-only source slice.

Verification:

- `node --test tests/afk-session-trigger-prototype.test.mjs`;
- `node --test tests/afk-launch-attempt-prototype.test.mjs` if shared helpers
  change;
- `bash tests/dev-workflow-router.sh`;
- `bash tests/help-contract.sh`;
- `./aos dev build --no-restart`;
- provider-free guarded-live rejection/fixture smoke;
- one Operator supervised live Codex evidence round.

The source slice should stop and return to Foreman if it cannot preserve
pre-launch duplicate prevention, explicit human supervision, cleanup proof, or
the provider-owned transcript/catalog boundary.

## Deferred Decisions

- Final `aos session trigger` or `aos session dispatch` spelling.
- Unattended/background launch policy.
- Persistent scheduler queues, durable leases, and heartbeat storage.
- Gateway result-route delivery.
- Claude, Gemini, or multi-provider live launch behavior.
- Committed schemas for transfer packets, scheduler runs, launch attempts, work
  receipts, and evidence receipts.
