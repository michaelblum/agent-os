# AFK Session Trigger Command Readiness

**Date:** 2026-05-22
**Status:** docs-only command-readiness decision

## Summary

The accepted `./aos dev afk-launch-attempt` wrapper proof is enough to route
the first source slice for a session trigger/dispatch command, but not enough
to promote AFK to final runtime command spelling or unattended provider launch.

The first implementable command should remain an explicitly experimental repo
development surface. It should validate a transfer packet, claim a scheduler
run, select a dry-run dispatch action, resolve dock launch roots, and emit a
machine-readable scheduler/dispatch receipt. It must not launch Codex, Claude,
Gemini, tmux, process sessions, provider terminals, gateway jobs, or final AOS
session-control state.

Recommended next source surface:

```bash
./aos dev afk-session-trigger --packet <packet.json> --provider codex --dock gdi --dry-run --json
```

This command is a dry-run trigger/dispatch contract probe. It is not final
`aos session ...` API, and it is not a provider-launch command.

## Context From Accepted Wrapper Proof

The accepted live wrapper proof in
`docs/design/work-cards/operator-afk-dev-launch-attempt-command-live-wrapper-v0.md`
proved that:

- the bridge can launch a supervised nested Codex process from `.docks/gdi`;
- bounded PTY resize/input evidence can be captured through the process driver;
- a separate Codex rollout can materialize with the expected dock cwd;
- `./aos dev afk-launch-attempt` can consume live bridge evidence plus explicit
  read-only Codex-home correlation;
- the wrapper can emit `provider_session_observed` with exact Codex adapter
  correlation;
- the wrapper did not itself launch Codex and left source, docs, configs,
  gateway state, dock profiles/hooks, GitHub state, push, and PR state
  untouched.

That proof closes the wrapper-readiness question. It does not close the
scheduler command question because the proof still depends on an Operator-run
supervised launch outside the wrapper. The next source slice should therefore
exercise trigger/scheduler ownership in dry-run mode while reusing the
launch-attempt record vocabulary.

## Command Surface And Launch Policy

| Decision | Answer | Reason |
| --- | --- | --- |
| Final command spelling | Do not use final `aos session ...` yet. | The scheduler lifecycle, receipt storage, packet validation, route update semantics, and launch permission gate are not source-backed enough to become stable runtime API. |
| First source surface | Use `./aos dev afk-session-trigger`. | It matches the existing governed repo-development surface used by `afk-dry-run` and `afk-launch-attempt`, and keeps the slice visibly experimental. |
| First implementation mode | Dry-run-only. | The next slice needs deterministic packet/scheduler/dispatch receipts before any command may launch a provider automatically. |
| Fixture-backed mode | Allowed for deterministic catalog, bridge, or prior launch-attempt evidence only if it remains read-only. | Fixtures can prove correlation and output shape without reading real provider transcripts or starting sessions. |
| Supervised live-capable | Not in the first source slice. | Supervised live evidence already exists for the wrapper; trigger command source should first prove deterministic scheduler boundaries. |
| Automatic provider launch | Explicitly disallowed. | The hard boundary remains: no unattended provider launch until a later source card deliberately adds and verifies a guarded live mode. |

## First Implementable Command Contract

Proposed command:

```bash
./aos dev afk-session-trigger \
  --packet <packet.json> \
  --provider <name> \
  --dock <dock> \
  --dry-run \
  --json
```

The first slice should:

- parse and validate a local transfer packet JSON path;
- resolve `--provider` and `--dock` as overrides or confirm they match packet
  hints when supplied;
- resolve `--repo`, cwd/worktree facts, `required_start_ref`, and source
  artifact presence without changing branches;
- create deterministic scheduler and dispatch ids from packet, selected dock,
  provider, repo/worktree, required start ref, result route refs, and action;
- choose the scheduler action `dry-run`;
- resolve the dock profile and launch root;
- construct the dispatch intent that would be handed to
  `./aos dev afk-launch-attempt` or a later dispatch primitive;
- emit one receipt that separates packet validation, scheduler lifecycle,
  dispatch attempt intent, launch policy, and result-route status;
- return wrapper-level argument errors through existing `exitError` patterns;
- expose command registry/help metadata and `dev audit` claims.

The command should not call `./aos dev afk-launch-attempt` in the first slice
unless the implementation can do so without starting bridges or providers and
without collapsing the scheduler receipt into the launch-attempt record. It may
reuse field names and validation helpers from the launch-attempt prototype.

## Responsibility Boundaries

| Responsibility | First-slice owner |
| --- | --- |
| Packet resolution and validation | `afk-session-trigger` command prototype, acting as scheduler intake. |
| Scheduler run id | Scheduler intake logic in the new dev command. |
| Idempotence key | Scheduler intake plus dispatch intent fields. |
| Lease and lifecycle state | Scheduler receipt only; no background lease enforcement yet. |
| Provider-neutral dispatch attempt id | Dispatch-intent section of the new dev command. |
| Selected action | Scheduler chooses `dry-run`; dispatch reports the received action. |
| Dock launch-root resolution | Dispatch-intent logic, using `.docks/<dock>/dock.json` and launch root facts. |
| Terminal substrate facts | `not_attempted` or `not_applicable: dry-run-only` in this slice. |
| Provider catalog/Codex adapter correlation | Not attempted except optional read-only fixtures explicitly passed to the command. |
| Result-route updates | Not delivered; receipt records `not_attempted` and configured route refs. |
| Work/evidence receipt output | Command stdout and optional `--out` local receipt file. |

The gateway remains provider ingress, job history, and notifier. It is not part
of this first source slice. The dock remains role identity; provider remains a
runtime adapter choice.

## Minimum Inputs And Flags

Required:

- `--packet <path>`;
- `--dry-run`;
- `--json` for machine-readable review output in tests and smoke checks.

Optional:

- `--provider <name>`: explicit provider override or confirmation;
- `--dock <dock>`: explicit dock override or confirmation;
- `--repo <path>`: repository root for path and ref validation;
- `--timestamp <iso>`: deterministic receipt timestamp;
- `--out <path>`: write the same receipt to a local file;
- `--result-route <ref>`: optional override only if the packet omits a route;
- `--idempotence-salt <value>`: optional deterministic test input if the base
  idempotence key is otherwise too coarse for fixtures.

Do not add any flag that launches Codex, Claude, Gemini, tmux, process-driver
bridges, gateway jobs, or provider terminals. Do not add `--live`,
`--launch-provider`, `--start`, or equivalent behavior in this source slice.

## Output Receipt Shape

The command should emit a single JSON receipt:

```json
{
  "record_type": "aos.afk_session_trigger_dry_run",
  "schema_status": "not_a_schema",
  "status": "dry_run_ready",
  "created_at": "2026-05-22T00:00:00.000Z",
  "packet": {
    "packet_ref": "<path>",
    "packet_id": "<packet id or not_observed>",
    "source_artifact": "<path or not_observed>",
    "validation_status": "valid"
  },
  "scheduler": {
    "scheduler_run_id": "scheduler-<stable-id>",
    "idempotence_key": "<stable-key>",
    "lifecycle_state": "accepted",
    "selected_action": "dry-run",
    "lease": "not_enforced"
  },
  "dispatch": {
    "dispatch_attempt_id": "dispatch-<stable-id>",
    "selected_provider": "codex",
    "selected_dock": "gdi",
    "dock_profile_ref": ".docks/gdi/dock.json",
    "launch_root": ".docks/gdi",
    "action": "dry-run",
    "provider_launch_allowed": false
  },
  "terminal_substrate": {
    "status": "not_attempted",
    "reason": "dry-run-only"
  },
  "result_route": {
    "status": "not_attempted",
    "refs": []
  },
  "mismatches": []
}
```

Status vocabulary:

| Status | Meaning |
| --- | --- |
| `dry_run_ready` | Packet validated, scheduler accepted, dispatch intent emitted, no launch attempted. |
| `rejected` | Input or current-state validation failed before dispatch intent. |
| `duplicate` | Same idempotence key already has an in-process receipt when duplicate modeling is enabled. |
| `blocked` | Required local fact needs human or external action, such as missing dock profile or unreadable packet. |
| `failed` | Command-level failure after accepted intake, such as receipt write failure. |

Mismatch/error classes:

- `missing_packet`;
- `invalid_packet_json`;
- `missing_source_artifact`;
- `unknown_dock`;
- `dock_profile_missing`;
- `provider_missing`;
- `provider_unsupported`;
- `repo_missing`;
- `required_start_ref_unresolved`;
- `worktree_mismatch`;
- `result_route_missing`;
- `launch_policy_violation`;
- `receipt_write_failed`.

## Reuse And Separation From `afk-launch-attempt`

Reuse:

- record vocabulary: scheduler run id, dispatch attempt id, idempotence key,
  selected provider, selected dock, launch root, result-route status, mismatch
  objects;
- no-schema JSON receipt style;
- `--packet`, `--provider`, `--dock`, `--repo`, `--timestamp`, `--out`, and
  `--json` option pattern;
- command registry/help/audit coverage pattern.

Keep separate:

- `afk-launch-attempt` owns launch-attempt records and provider/bridge
  correlation facts;
- `afk-session-trigger` owns packet intake, scheduler claim, selected action,
  and dry-run dispatch intent;
- the first trigger command must not consume real `--codex-home` or live bridge
  evidence by default;
- launch-attempt fixture flags should not be copied unless the first trigger
  tests require read-only fixture correlation.

## Safety And Non-Goals

Hard boundary:

```text
No source command may launch an unattended provider until a later source card
explicitly changes the launch policy, names the live mode, proves the human
gate, and verifies duplicate prevention, cleanup, result-route behavior, and
provider-owned transcript boundaries.
```

Non-goals for the next source slice:

- final `aos session`, `aos afk`, scheduler, runtime, or gateway API spelling;
- transfer packet, scheduler, dispatch, work receipt, or evidence receipt
  schemas;
- provider launch, tmux/process bridge startup, or provider terminal control;
- real `~/.codex` transcript reads;
- gateway job mutation or notifier delivery;
- dock profile, hook, role instruction, provider config, or GitHub mutation;
- Researcher dock creation;
- broad AFK documentation rewrite.

## Verification Plan For The Next Source Slice

Minimum deterministic verification:

```bash
bash tests/dev-workflow-router.sh
bash tests/help-contract.sh
./aos dev build --no-restart
./aos dev afk-session-trigger --packet <temp-packet.json> --provider codex --dock gdi --dry-run --json
./aos help dev --json
./aos help dev afk-session-trigger --json
./aos dev audit --json
git diff --check
./aos dev recommend --json
```

If the implementation adds a Node prototype, also add and run a focused
`node --test` file for packet validation, idempotence key construction,
unknown dock/provider rejection, unresolved start-ref rejection, and dry-run
receipt shape.

The command-level smoke should prove:

- exit code 0 for a valid packet;
- `record_type=aos.afk_session_trigger_dry_run`;
- `status=dry_run_ready`;
- scheduler lifecycle is `accepted`;
- selected action is `dry-run`;
- selected provider/dock are `codex`/`gdi`;
- dock profile and launch root are resolved;
- terminal substrate is `not_attempted`;
- `provider_launch_allowed=false`;
- result route is `not_attempted`;
- no provider session id, provider transcript, gateway job, or route delivery
  is created.

Stop conditions:

- any test or smoke fails;
- command requires final `aos session` spelling to pass;
- implementation needs to launch a provider to prove its contract;
- packet validation needs a schema migration;
- repo-mode TCC/input-tap blocks a required live check. This should not happen
  for the dry-run slice, but if it does, use the GDI human-needed path rather
  than retrying.

## Recommended Next Work Card

Title:

```text
AFK Dev Session Trigger Dry-Run Command V0
```

One-paragraph goal:

Add an experimental `./aos dev afk-session-trigger --packet <packet.json>
--provider codex --dock gdi --dry-run --json` command that validates a local
transfer packet, creates deterministic scheduler and dispatch intent ids,
resolves the dock launch root, emits a no-schema dry-run trigger/dispatch
receipt, and exposes registry/help/audit coverage without implementing final
`aos session` command spelling, schemas, gateway routing, provider launch,
terminal bridge startup, or real provider transcript reads.

Likely files:

- `src/commands/dev.swift`;
- `src/shared/command-registry-data.swift`;
- `tests/dev-workflow-router.sh`;
- `tests/help-contract.sh`;
- optional `scripts/afk-session-trigger-prototype.mjs`;
- optional `tests/afk-session-trigger-prototype.test.mjs`.

Behavior:

- deterministic dry-run scheduler/dispatch receipt;
- no provider launch or route delivery;
- wrapper-level argument errors through existing `exitError` patterns;
- help and audit metadata for the experimental dev command.

Verification:

- focused Node tests if a script is added;
- `bash tests/dev-workflow-router.sh`;
- `bash tests/help-contract.sh`;
- `./aos dev build --no-restart`;
- provider-free command-level smoke with a temp packet;
- help/audit JSON checks;
- `git diff --check`;
- `./aos dev recommend --json`.

Stop conditions:

- source behavior requires unattended launch;
- final runtime spelling becomes necessary;
- schemas or gateway mutations become necessary;
- real provider transcript reads become necessary;
- required source artifact or start ref is missing.
