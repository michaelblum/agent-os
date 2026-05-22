# AFK Provider-Neutral Dispatch Shape

**Date:** 2026-05-21
**Status:** docs-only provider-neutral dispatch sketch

## Summary

This note sketches the future provider-neutral dispatch boundary in the AFK
chain:

```text
session trigger/scheduler
  -> provider-neutral dispatch
  -> provider adapter
  -> docked provider session
  -> scheduler/result-route lifecycle updates
```

It does not add a schema, source change, command behavior change, provider
launch, gateway-owned session lifecycle, scheduler implementation, provider
adapter implementation, transfer packet schema, work/evidence record trial, or
local prototype. It follows the scheduler sketch because dispatch should receive
an already validated packet reference, result-route reference, lease, dock,
cwd/worktree policy, and selected action. It precedes work/evidence record
trials or a local prototype because a worker record needs to know which
provider/session facts dispatch will report, and source work should not bake in
manual clipboard handling or one provider CLI.

The core boundary is: dispatch translates a scheduler-selected action into a
start, resume, dry-run, or rejection attempt for a selected provider against a
dock profile and launch root. It reports the concrete provider session facts
back to scheduler. It does not own packet validation, scheduler lifecycle,
reusable route judgment, gateway job state, work/evidence proof semantics, or
dock role policy.

## Existing Surface Inventory

### Dock Profiles And Launch Roots

`.docks/README.md` defines docks as repo-local session roots for durable roles,
not workflows, task types, entry paths, or provider identities. A local Codex
session can launch from `.docks/gdi`, while source edits and tests still happen
in `/Users/Michael/Code/agent-os`. Remote or undocked sessions must adopt the
dock role explicitly by reading shared dock instructions and the role-local
`AGENTS.md`.

`.docks/<dock>/dock.json` is validated by
`shared/schemas/aos-dock-profile-v0.schema.json`. The profile names the dock,
role, harness, default entry path, allowed entry paths, capability manifest,
allowed capability classes, explicit-assignment requirements, stop notice, and
handoff prefix behavior. It is descriptive. It does not grant permissions,
execute commands, decide provider choice, or replace the human/model operating
contract in `AGENTS.md`.

Provider-neutral dispatch should resolve the dock profile and launch root, then
build a provider command that starts from the same dock/session contract. The
dock identity remains `foreman`, `gdi`, or `operator`; the provider is an
adapter decision for this run.

### Provider Session Catalog And Resume Commands

`shared/schemas/provider-session-catalog.*` and
`packages/host/src/session-catalog.ts` define a read-only local adapter
contract for provider-owned sessions. Current normalized records include
`provider`, `session_id`, `cwd`, optional `branch`, timestamps, `source_file`,
and `resume_command`.

Current provider rules:

- Codex records are read from `~/.codex/sessions/**/rollout-*.jsonl` and
  optional archived session files. Resume shape is
  `["codex", "--no-alt-screen", "resume", "<session_id>"]`.
- Claude Code records are read from `~/.claude/projects/<encoded-cwd>/*.jsonl`
  and `~/.claude/sessions/*.json`. Resume shape is
  `["claude", "--resume", "<session_id>"]`.

The catalog does not mutate provider files and does not make AOS a native
client for either provider. Dispatch can use it to find compatible resume
candidates or to verify that a launched session became discoverable, but the
catalog should remain a read-only observation surface.

### Agent Session Telemetry And Capability Events

`shared/schemas/agent-session-telemetry.*` and
`packages/host/src/session-telemetry.ts` expose provider-neutral telemetry
records, lifecycle events, capabilities, and provider-shape mismatch
diagnostics. Current lifecycle events include `session_started`,
`session_resumed`, `context_compaction_started`, `context_compacted`,
`handoff_started`, `handoff_completed`, and `session_ended`. Capabilities
include `check_in`, `compact`, `handoff`, and `resume`.

Dispatch should report what it knows at launch time and should pass through
telemetry or mismatch facts without converting them into scheduler policy.
Partial or missing telemetry is a dispatch/result fact for scheduler to handle,
not a reason for dispatch to redefine the packet or proof requirements.

### Sigil Agent Terminal And Codex Terminal Bridge

`apps/sigil/agent-terminal/launch.sh` delegates to the historical
`apps/sigil/codex-terminal/launch.sh`. That launcher starts a local bridge,
ensures content roots, and opens the Sigil Agent Terminal canvas. It can start
new Codex or Claude sessions, use `codex --no-alt-screen resume` or
`codex --no-alt-screen resume --last`, and runs the bridge through tmux when
available with a background process fallback.

`apps/sigil/codex-terminal/server.mjs` is a useful substrate example. It can
ensure a named tmux or process session, capture output, send input, list
provider catalog records, and expose bridge health. It prefers tmux for
durable reattach but can run a process-backed pseudo-terminal when tmux is not
available.

That bridge is product surface and terminal substrate, not the future primitive
boundary. Provider-neutral dispatch can learn from its command, driver,
session, cwd, and health facts, but should not make Sigil or the gateway the
owner of provider session lifecycle.

### Provider-Specific Config Files

Current provider-specific surfaces include:

- `.codex/config.toml`: repo-scoped Codex configuration, model, effort,
  features, approval policy, and sandbox mode.
- `.claude/settings.json`: Claude Code permissions, hooks, final-response
  integration, and statusline command.
- `CLAUDE.md`: compatibility pointer to `AGENTS.md`.
- `GEMINI.md`: compatibility pointer to `AGENTS.md` and one user-managed skill.

Dispatch should respect provider-local configuration as part of availability
and launch behavior, but it should not copy provider-specific instructions into
the packet or dock profile. Provider config is an adapter input; dock role
policy stays in dock instructions and profiles.

### Host Provider Adapter Concept

`packages/host/src/provider/adapter.ts`, `packages/host/src/types.ts`, and
`packages/host/src/provider/anthropic.ts` define an existing provider adapter
concept for model streaming over the Vercel AI SDK style interface. That adapter
turns messages, tools, system text, and model config into stream events.

Provider-neutral session dispatch is related but not the same thing. It is a
CLI/session adapter boundary for launching or resuming a docked provider
session in a cwd/worktree with packet and route references. It may later share
provider availability checks or naming, but it should not be conflated with
model-streaming adapters.

## Dispatch Responsibility Sketch

Provider-neutral dispatch owns one provider/session launch attempt after
scheduler has selected an action.

Inputs should include:

- scheduler run id and dispatch attempt id;
- selected action: `start`, `resume`, `dry-run`, or `reject`;
- packet reference and packet id;
- result-route reference;
- lease or launch deadline;
- selected dock and optional role kind;
- cwd, worktree, branch policy, and required start ref facts already validated
  by scheduler;
- explicit provider requirement, provider hint, provider policy, or allowed
  provider set;
- local-only, no-external-publish, or push policy from scheduler/workflow
  context.

Dispatch responsibilities:

- receive scheduler-selected `start`, `resume`, `dry-run`, or `reject`;
- resolve the dock profile and launch root without treating the dock as a
  provider identity;
- select a provider from explicit requirement, hint, local policy, catalog
  compatibility, or availability;
- build the provider command for start or resume;
- pass packet and result-route references to the worker session through the
  design-selected mechanism, such as environment variables, command arguments,
  launch prompt text, or a session control record reference;
- establish terminal/session substrate expectations, including driver, session
  handle, cwd, worktree, attachability, and transcript/capture assumptions;
- preserve local-only and no-external-publish policy in command construction
  and result reporting;
- report provider session id, command, cwd/worktree, driver, catalog source,
  availability/auth status, and capability facts back to scheduler;
- emit structured rejection or mismatch facts when provider selection,
  authentication, cwd/worktree, or session discovery fails.

Dispatch should be idempotent for the same scheduler run and dispatch attempt.
If a start command has already produced a compatible session, a repeated
dispatch attempt should report the existing session or refuse with a duplicate
reason instead of launching an unrelated second worker.

## Provider Adapter Comparison

### Codex CLI

Candidate start shape:

```bash
cd .docks/gdi
AOS_TRANSFER_PACKET_REF=<packet-ref> \
AOS_RESULT_ROUTE_REF=<route-ref> \
AOS_SCHEDULER_RUN_ID=<run-id> \
codex --no-alt-screen
```

Candidate resume shape:

```bash
cd /Users/Michael/Code/agent-os
codex --no-alt-screen resume <session_id>
```

Codex currently has rich local session files that the catalog can inspect.
Dispatch can use the catalog to verify cwd, branch, recency, and resume command,
but should still treat transcript shapes as provider-local and drift-prone.

### Claude Code

Candidate start shape:

```bash
cd .docks/gdi
AOS_TRANSFER_PACKET_REF=<packet-ref> \
AOS_RESULT_ROUTE_REF=<route-ref> \
AOS_SCHEDULER_RUN_ID=<run-id> \
claude
```

Candidate resume shape:

```bash
cd /Users/Michael/Code/agent-os
claude --resume <session_id>
```

Claude Code has documented statusline input and repo settings hooks in this
tree. Dispatch can use those as availability and telemetry inputs, while the
session catalog remains the normalized read-only resume surface.

### Gemini Or Future Provider

Gemini is currently represented only by provider-specific instruction discovery
through `GEMINI.md`, not by a session catalog adapter or telemetry schema entry.
A future provider adapter should declare:

- executable name and version check;
- start command shape;
- resume command shape, if supported;
- session discovery source;
- cwd/worktree observability;
- supported telemetry and capabilities;
- authentication check behavior;
- known drift or unsupported states.

Until those facts exist, a Gemini dispatch should be a dry-run or
unavailable-provider result, not an inferred CLI launch.

### Tmux Versus Process Driver

Tmux driver:

- better for durable reattach, transcript capture, and multiple terminal
  clients;
- can preserve a provider CLI after the launching surface exits;
- exposes handles that are easier to list and inspect;
- depends on tmux availability and named-session hygiene.

Process driver:

- works on machines without tmux;
- is simpler for a short-lived local prototype;
- is less durable across bridge restarts and less useful for resume/reattach;
- requires careful output buffer and child-process lifecycle handling.

Dispatch should report the selected driver and why it was selected. Scheduler
should decide what to do if the driver is weaker than policy requires.

### Availability, Authentication, And Drift

Provider adapters should expose checks such as:

- executable present;
- minimum or observed version when available;
- local provider config present;
- authentication likely present or clearly missing;
- session catalog root readable;
- resume command compatible with the selected cwd/worktree;
- telemetry source available, partial, or unknown.

Drift should be reported as facts:

- provider command exists but resume command shape changed;
- catalog record lacks cwd or branch;
- telemetry path missing or renamed;
- provider accepted launch but no catalog record appears;
- session appears in catalog but cwd/worktree no longer matches scheduler
  policy.

Dispatch should not paper over drift by silently switching providers unless the
scheduler request allowed provider fallback.

## Non-Responsibilities

Provider-neutral dispatch should not own:

- packet validation, packet expiry, or lease state;
- scheduler lifecycle decisions or terminal state transitions;
- reusable route judgment or Decision Contract source rules;
- gateway integration job transitions, notifier delivery, or job schema;
- work-record or evidence-record proof semantics;
- final verification interpretation;
- dock role instruction policy;
- Researcher synthesis behavior, ranking logic, or dock creation;
- broad workstream planning, next-slice selection, or GitHub mutation;
- provider transcript storage beyond substrate capture facts needed for session
  control.

## Candidate Command Or API Shape

Design-only command examples:

```bash
aos session dispatch --provider codex --dock gdi --packet <ref>
aos session dispatch --dock gdi --packet <ref> --provider-policy available
aos session dispatch --dock gdi --packet <ref> --resume <session_id>
aos session dispatch --dock gdi --packet <ref> --dry-run --json
```

Dry-run output:

```json
{
  "dispatch_attempt_id": "dispatch-01",
  "scheduler_run_id": "afk-run-01",
  "action": "dry-run",
  "selected_provider": "codex",
  "dock": "gdi",
  "launch_root": ".docks/gdi",
  "cwd": "/Users/Michael/Code/agent-os",
  "worktree": "/Users/Michael/Code/agent-os",
  "driver": "tmux",
  "command": ["codex", "--no-alt-screen"],
  "packet_ref": "packet:afk-01",
  "result_route_ref": "route:afk-01",
  "would_publish_external": false,
  "availability": { "provider_cli": "present", "auth": "unknown" }
}
```

Start output:

```json
{
  "dispatch_attempt_id": "dispatch-01",
  "scheduler_run_id": "afk-run-01",
  "action": "start",
  "state": "accepted_by_provider",
  "provider": "codex",
  "provider_session_id": "019de3a9-2b0b-79f2-bb17-79dfb2c7a706",
  "driver": "tmux",
  "terminal_handle": "agent-os:afk-run-01",
  "cwd": "/Users/Michael/Code/agent-os",
  "worktree": "/Users/Michael/Code/agent-os",
  "command": ["codex", "--no-alt-screen"],
  "capabilities": ["resume", "check_in"],
  "catalog_record": "provider-session-catalog:codex:019de3a9-2b0b-79f2-bb17-79dfb2c7a706"
}
```

Resume output:

```json
{
  "dispatch_attempt_id": "dispatch-02",
  "scheduler_run_id": "afk-run-01",
  "action": "resume",
  "state": "resumed",
  "provider": "claude-code",
  "provider_session_id": "abc123",
  "driver": "tmux",
  "command": ["claude", "--resume", "abc123"],
  "catalog_record": "provider-session-catalog:claude-code:abc123",
  "cwd": "/Users/Michael/Code/agent-os",
  "capabilities": ["resume"]
}
```

Provider mismatch or unavailable-provider output:

```json
{
  "dispatch_attempt_id": "dispatch-03",
  "scheduler_run_id": "afk-run-01",
  "action": "reject",
  "state": "provider_unavailable",
  "requested_provider": "gemini",
  "reason": "no_session_adapter",
  "fallback_allowed": false,
  "route_update_recommended": "failed"
}
```

Idempotence and correlation keys:

```text
scheduler_run_id + dispatch_attempt_id
packet_id + result_route_ref + dock + cwd/worktree + provider + action
provider + provider_session_id, once known
```

The scheduler run id ties dispatch back to lifecycle state. The packet/result
route/dock/worktree/provider key prevents duplicate launch. The provider session
id refines a running or resumed session after the provider accepts ownership.

## Dispatch Lifecycle

### Normal Start

```text
scheduler selects start
  -> dispatch resolves dock profile and launch root
  -> dispatch selects provider and driver
  -> dispatch builds start command with packet/result-route refs
  -> provider session accepts ownership
  -> dispatch reports provider session facts
  -> scheduler records running and route updates
```

### Normal Resume

```text
scheduler selects resume
  -> dispatch verifies catalog/control record compatibility
  -> dispatch builds provider resume command
  -> provider session resumes
  -> dispatch reports resumed session facts and capabilities
  -> scheduler records running or resumed lifecycle
```

### Provider Unavailable Or Auth Missing

Dispatch reports `provider_unavailable`, `auth_missing`, or
`provider_mismatch` with evidence such as missing executable, unreadable
provider root, unsupported provider, or failed auth check. Scheduler decides
whether to fallback, stall, fail, or ask a human.

### Cwd Or Worktree Mismatch At Launch

Scheduler should validate cwd/worktree before dispatch, but dispatch may still
discover mismatch at launch time. Dispatch should reject or report drift when:

- launch root does not exist;
- provider starts in a different cwd than requested;
- catalog record cwd or branch contradicts the scheduler-selected work surface;
- named worktree was removed or replaced after scheduler validation.

Dispatch should not silently correct this by launching from another checkout.

### Provider Accepts But No Heartbeat Or Catalog Record Appears

Dispatch may start a terminal process but fail to observe a provider session id,
catalog record, heartbeat, or telemetry event before the launch deadline. It
should report the command, driver, terminal handle, and missing observation.
Scheduler owns whether that becomes `launching`, `stalled`, `expired`, or
`failed`.

### Provider Drift Or Partial Telemetry

Dispatch should preserve partial facts:

- session launched but telemetry unavailable;
- catalog record present but no token metrics;
- resume supported but check-in capability unknown;
- provider transcript shape mismatch emitted diagnostics.

Partial telemetry should be visible in dispatch output and later evidence. It
should not change proof semantics.

## Boundary Matrix

| Surface | Owns | Does not own |
| --- | --- | --- |
| Provider-neutral dispatch | Selected provider launch/resume/dry-run/reject attempt; dock profile and launch-root resolution; provider command construction; terminal/session driver selection; provider session facts returned to scheduler. | Packet validation, scheduler lifecycle authority, reusable route judgment, gateway job state, proof semantics, dock role policy. |
| Session trigger/scheduler | Packet intake, current-state validation, start/resume decision, lease/timeout/heartbeat policy, lifecycle state, result-route updates. | Provider-specific CLI mechanics, terminal substrate, provider auth, work/evidence proof interpretation. |
| Provider adapter | Provider executable checks, start/resume command shape, auth/availability checks, provider-local catalog and telemetry interpretation. | Permanent dock identity, scheduler lifecycle, gateway routes, role instructions. |
| Dock profile | Durable role identity, default entry path, allowed entry paths, capability envelope, handoff profile seed. | Provider choice, execution grant, command launch, scheduler policy, proof requirements. |
| Docked provider session | Execute one bounded goal under dock instructions; honor packet and stop conditions; emit final report, check-ins, and proof links. | Packet redefinition, provider selection policy, gateway session ownership, reusable route judgment. |
| Provider session catalog | Read-only normalized provider session discovery and resume command facts. | Launch mutation, provider file writes, scheduler state, route updates, proof semantics. |
| Telemetry/capability surface | Provider-neutral session metrics, lifecycle observations, supported actions, mismatch diagnostics. | Rendering policy, lifecycle decisions, provider fallback, terminal proof. |
| Terminal substrate | Tmux/process handle, attachability, capture, input, health, output buffer, process lifetime. | Dock identity, packet validation, provider adapter policy, result-route delivery. |
| Transfer packet and result route | One transfer's launch context and configured lifecycle/result destinations. | Provider process handles, terminal session id before dispatch, scheduler queue state, immutable proof payloads. |

## Explicit Deferrals

This note intentionally preserves these deferrals:

- no dispatch implementation;
- no scheduler implementation;
- no provider adapter implementation;
- no transfer packet schema;
- no source change;
- no tests change;
- no command behavior change;
- no router output change;
- no shared schema change;
- no `docs/dev/workflow-rules.json` change;
- no `.docks` instruction, dock profile, hook, or handoff script change;
- no gateway job schema or API change;
- no work-record or evidence-record implementation;
- no GitHub issue, push, PR, or external publication mutation;
- no Researcher dock creation.

## Recommendation

The next slice should be a design consolidation/readiness pass before a local
prototype.

The packet/result-route, scheduler, and dispatch sketches now define the AFK
path from inbound packet to selected provider session and back to lifecycle
routes. A consolidation pass should align vocabulary, identify duplicate fields,
and decide the minimum work/evidence record receipts needed to prove a manual
trial. After that, a small local prototype can target one provider and one dock
without pretending the single-provider path is the whole primitive.
