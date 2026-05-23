# Decision Contract Inventory

**Date:** 2026-05-21
**Status:** inventory note for `decision-contract-inventory-v0`

## Summary

The hidden-example hypothesis is confirmed. Agent-os already has several
artifacts where bounded inputs plus inspected evidence produce a classification,
route, or next action. They are not all the same kind of artifact:

- `docs/dev/workflow-rules.json` is the strongest current machine-readable
  Decision Contract candidate because it is schema-backed, command-backed, and
  validated by tests.
- Several recipes and dock contracts are docs-backed decision tables. They are
  useful Decision Contract vocabulary examples, but they should remain recipes
  or transfer policy until repeated use proves a structured contract is worth
  extracting.
- Gateway integration jobs are workflow/job state machines, not Decision
  Contracts. They are relevant to async result routing, but the decision logic
  is mostly command parsing and lifecycle transition enforcement.

The next slice should not add a schema yet. The better move is to keep
"Decision Contract" as docs-only vocabulary, sketch the shape against
`docs/dev/workflow-rules.json`, and promote that router first only after the
inventory vocabulary has survived one more design pass.

## Candidate Inventory

| Artifact | Current form | Inputs | Evidence inspected | Outputs/decisions | Consumers | Invalidation triggers | Recommendation |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `docs/dev/workflow-rules.json` | Source-backed JSON manifest with schema and CLI consumer. | Changed file paths, optional explicit file list, manifest path. | `shared/schemas/dev-workflow-rules.schema.json`, `tests/schemas/dev-workflow-rules.test.mjs`, `src/commands/dev.swift`, `./aos dev recommend --json`. | Rule IDs, classes, actions, hot-swappable flag, TCC sensitivity, commands, verification, notes. | Agents, `./aos dev recommend`, `./aos dev audit`, workflow profile users. | File ownership changes, new test/build surfaces, command contract changes, schema changes, stale manifest patterns. | True Decision Contract candidate and best first machine-readable example. Do not rename it yet; sketch Decision Contract fields around it. |
| `shared/schemas/dev-workflow-rules.schema.json` | JSON Schema for the router manifest. | Manifest JSON. | Schema required fields and rule/step definitions. | Accept/reject manifest shape. | Schema tests, router maintainers. | Added routing fields, changed rule semantics, new manifest version. | Supporting schema, not itself a Decision Contract. It can host future metadata only after the manifest shape proves it needs it. |
| `src/commands/dev.swift` `recommend` path | Swift command implementation over the manifest. | Changed files from git diff or explicit `--files`; decoded manifest. | `aggregateDevWorkflow`, rule matching, audit claims. | JSON recommendation payload with summary, commands, verification, notes. | Local agents and developers. | CLI JSON contract change, manifest schema change, changed diff-base semantics. | Consumer/executor of a Decision Contract. Keep implementation separate from the contract shape. |
| `docs/recipes/context-doc-maintenance.md` | Markdown recipe with closed-set classification. | Proposed context or authority-doc change. | Placement rules, coupled update triggers, stale-phrase checklist, authority conflict ordering. | Adopt, adapt, reject, or defer; target doc surface; stop/report conflict. | Foreman, GDI, docs maintainers. | Context topology changes, new source-of-truth surface, conflict priority changes. | Recipe/SOP with embedded decision table. Good vocabulary example, not first schema target. |
| `.docks/README.md` and `.docks/AGENTS.md` | Repo-local dock and transfer policy docs. | Task shape, named dock, transfer kind, external coordination state. | Dock role descriptions, transfer storage matrix, GitHub control-surface rules. | Foreman/GDI/Operator role adoption; transfer storage choice; whether to copy a dispatch. | All docked sessions. | New durable role boundary, changed transfer storage, new profile/dock capability model. | Transfer/work-card policy. Keep as docs; extract only if session trigger needs machine-readable route selection. |
| `.docks/foreman/AGENTS.md` and `foreman-session-transfer` skill | Foreman policy plus skill-fronted transfer classification. | Completion report, target actor, source artifact, branch/base facts, blocker kind. | Transfer kind list, placement matrix, GDI/Operator recipient references. | Successor handoff, GDI round, Operator run, relay packet, correction round, human-needed packet. | Foreman, handoff scripts, downstream docks. | New recipient kind, changed branch/base contract, new external publication route. | Transfer/work-card policy. Strong Decision Contract candidate later for transfer-packet routing, but not before session trigger/result routes exist. |
| `.docks/gdi/AGENTS.md` git boundary | Role-local deterministic work policy. | Work card, branch_from, required_start_ref, active workflow profile, TCC blocker state. | Work card readability, current branch, profile definitions, verification state. | Misrouted, create branch, commit/push authority, human_needed, completion report. | GDI sessions and Foreman reviewers. | Workflow profile changes, TCC recovery policy changes, GDI branch/push authority changes. | Transfer/work-card policy with decision rules. Keep docs-only until branch/session launch is automated. |
| `docs/recipes/agent-entry-paths-and-verification.md` | Markdown recipe for capability-layer selection. | Task type, evidence need, changed behavior, runtime readiness/TCC state. | Entry path definitions, host-shell boundary, testing guidance, placement rules. | Agent harness, AOS developer, testing, visual diagnostics, user-input diagnostics; test loop choice. | Agents developing or diagnosing AOS. | New entry path, new repo-owned harness, changed runtime verification policy. | Recipe/SOP with embedded decision table. Useful for vocabulary and invalidation fields. |
| `docs/recipes/aos-surface-interaction-decision-tree.md` | Markdown decision tree plus conformance audit table. | Proposed surface/interactivity need; current mechanism and target mechanism. | Seven-choice tree, surface audit, tracker links. | DOM canvas, toolkit panel/windowing, StageAffordance, passive stage, full WebView, private renderer, daemon primitive. | Toolkit/app implementers and reviewers. | New interaction primitive, retired fallback, changed daemon/toolkit/app ownership. | Recipe/SOP with embedded decision table. It is a strong docs-backed example but still tied to implementation architecture prose. |
| `docs/design/user-signal-surface.md` | Design document with gate lifecycle/state machine. | Gate request, timeout, receptor outcome, deferred continuation submission. | Request schema sketch, lifecycle diagram, edge-case table, durable gate record rules. | Answered, dismissed, timeout, error; continuation/resume-event route metadata. | Gate CLI, gateway adapter, future provider adapters. | Gate service moves into daemon, receptor selection policy ships, persistence moves to SQLite. | Mostly design state machine, not current Decision Contract. Good future input for human-gate decision records. |
| `packages/gateway/src/integrations/broker.ts` | TypeScript broker command parser and job transition logic. | Provider message, workflow catalog, workflow result, job start/complete/fail requests. | `parseCommand`, `executeWorkflow`, `assertJobMutable`, notifier routes. | Help/jobs/run/unknown command route; queued/running/succeeded/failed job state; requester notification. | Slack/provider integrations, HTTP API, broker UI. | Workflow catalog command changes, async session dispatch support, new terminal job states. | Workflow/job state machine. Do not promote as first Decision Contract; use as result-route pressure later. |
| `packages/gateway/src/db.ts` integration jobs | SQLite-backed state and job persistence. | Job create/update/list inputs. | `IntegrationJobStatus`, normalized started/completed timestamps, row converters. | Persisted queued/running/succeeded/failed records and filtered job lists. | Gateway broker and presentation surfaces. | Job schema migration, daemon-owned session/result store, new statuses. | Persistence layer for workflow/job state. Not a Decision Contract. |

## Classification

### True Decision Contract Candidate

- `docs/dev/workflow-rules.json`

This is the only inspected artifact that already resembles the proposed shape:
source-backed rules, declared inputs, required evidence through schema/tests,
decision outputs, consumers, invalidation triggers, and a recompute command
(`./aos dev recommend --json`). It should be the first artifact used to sketch
Decision Contract fields.

### Recipe/SOP With Embedded Decision Table

- `docs/recipes/context-doc-maintenance.md`
- `docs/recipes/agent-entry-paths-and-verification.md`
- `docs/recipes/aos-surface-interaction-decision-tree.md`
- `docs/design/user-signal-surface.md` edge-case and lifecycle tables

These are reusable judgment aids, but their current value is mostly human/agent
guidance. They should not be forced into schema form until a caller needs to
recompute or audit their decisions mechanically.

### Transfer/Work-Card Policy

- `.docks/README.md`
- `.docks/AGENTS.md`
- `.docks/foreman/AGENTS.md`
- `.docks/foreman/skills/session-transfer/SKILL.md`
- `.docks/foreman/skills/session-transfer/references/gdi-work-card-authoring.md`
- `.docks/gdi/AGENTS.md`
- `docs/design/work-cards/decision-contract-inventory-v0.md`

These surfaces classify roles, transfer kinds, branch/base handling, stop
conditions, and completion evidence. They are likely to become structured only
when AOS grows transfer packets, session trigger, and async result routing.

### Workflow/Job State Machine

- `packages/gateway/src/integrations/broker.ts`
- `packages/gateway/src/db.ts`

Gateway job state is important AFK infrastructure, but it is a lifecycle
machine around workflow execution and notification. It consumes decisions more
than it defines reusable judgment.

### Not A Fit

- `shared/schemas/dev-workflow-rules.schema.json` by itself
- `tests/schemas/dev-workflow-rules.test.mjs` by itself
- `src/commands/dev.swift` by itself

These are schema/test/consumer surfaces around the dev workflow router. They
are evidence and enforcement for a Decision Contract candidate, not standalone
Decision Contracts.

## Recommendation For The Next Slice

No schema yet. Keep the concept as docs-only vocabulary for one more slice, and
write a compact schema sketch rather than a committed `shared/schemas/`
contract.

The sketch should use `docs/dev/workflow-rules.json` as the first promotion
candidate because it is already machine-readable, locally validated, and
recomputed by an AOS command. The sketch should name how current fields map to
the candidate Decision Contract fields:

- `id`: manifest rule id or future wrapper id.
- `summary`: existing manifest summary fields.
- `inputs`: changed files and optional explicit file list.
- `required_evidence`: schema, router tests, audit claims, and matched file
  patterns.
- `decision_outputs`: classes, actions, commands, verification, notes, TCC
  sensitivity, hot-swappable flag.
- `invalidation_triggers`: changed ownership patterns, new command surfaces,
  new build/test requirements, schema version changes.
- `recompute_command`: `./aos dev recommend --json`.
- `consumers`: `./aos dev recommend`, `./aos dev audit`, Foreman/GDI routing.

Do not migrate or rename existing artifacts. Do not move recipe decision tables
into JSON. Do not promote gateway job state first: it is a state machine and
async result surface, while `docs/dev/workflow-rules.json` is closer to the
actual "given inputs and evidence, classify/choose/route" definition.

The specific artifact to promote first, when a schema is justified, is the dev
workflow router manifest, either by wrapping it in a generic Decision Contract
descriptor or by adding a minimal design-only adapter sketch. Avoid changing the
live schema until at least one second non-router candidate proves the generic
fields are not just a renamed workflow-rules manifest.
