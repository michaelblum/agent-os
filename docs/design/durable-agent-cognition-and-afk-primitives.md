# Durable Agent Cognition And AFK Primitives

**Status:** design note, not an implementation contract
**Date:** 2026-05-21

## Thesis

Agent-os should optimize for **reliable, efficient agent cognition**. Tokens
should be spent freely when an agent is learning a new surface, making a real
judgment, or resolving ambiguity. The reusable result of that work should then
be preserved as compact, typed, evidence-backed artifacts so future sessions do
not repeat the same discovery or inherit a bulky transcript dump.

This is the durable form of the existing principle in `README.md`: agent tokens
are for decisions, not plumbing. AOS should make repeated decisions cheaper and
more reliable by turning stable context, operating lessons, and route choices
into inspectable artifacts.

The same principle applies in two common cases:

1. An exploratory browser-control session spends many tokens learning how to
   operate NotebookLM, Gemini Canvas, Comet, or another live surface with a
   human. That cost can be worthwhile, but the learned entry assumptions,
   human gates, target landmarks, timing, failure modes, recovery moves, and
   evidence should not die with the session.
2. A relay workstream such as Foreman -> GDI -> Foreman -> GDI should not force
   every fresh worker to rediscover stable repo facts or previous synthesis.
   It also should not overload each transfer with a complete history. Each
   session should receive the smallest salient packet plus deterministic entry
   points and durable evidence.

## Existing Ground Truth

The repo already has most of the artifact vocabulary:

- Docks are role/persona session roots, not workflows
  (`.docks/README.md`).
- GDI work cards are bounded execution contracts for worker rounds
  (`docs/design/work-cards/`).
- Recipes are role-neutral repeated procedures, with Markdown SOPs under
  `docs/recipes/` and source-backed executable manifests under `recipes/*.json`
  (`docs/recipes/README.md`).
- ADR 0009 keeps Recipe, Playbook, and Workflow distinct:
  Recipe is a bounded procedure, Playbook is agent-operable
  `see -> resolve -> do -> see -> verify`, and Workflow is orchestration across
  actors, systems, or gates.
- Work records already describe one run as intent plus execution map plus
  evidence plus health (`docs/design/aos-work-records-and-self-healing-recipes.md`).
- Remote/session control already sketches provider-neutral session records and
  typed control actions (`docs/design/remote-session-control.md`).
- The integration gateway already has a Slack provider, workflow catalog,
  broker, HTTP API, SDK socket, and persisted integration jobs
  (`packages/gateway/src/integrations/providers/slack.ts`,
  `packages/gateway/src/integrations/broker.ts`,
  `packages/gateway/src/integrations/http-api.ts`,
  `packages/gateway/src/db.ts`).

The missing piece is not "more recipes" by itself. The missing piece is a
clear path for repeated **judgment** and repeated **session launch/result
routing** to become durable without becoming core product-specific logic.

## Ownership Boundary

Agent-os core should own the primitives that make unattended, configurable
agent roles possible:

- inbound message ingestion through provider adapters such as Slack;
- session handoff and transfer packet protocol;
- provider-neutral session launch/resume;
- integration jobs and async result routing;
- evidence and work record schemas;
- multi-provider CLI dispatch;
- decision/evidence artifact graph primitives when they become stable.

User or repo configuration should own the behavior layered on top:

- Researcher dock or persona;
- signal synthesis skill;
- "link -> project signal" recipe;
- output artifact routing rules;
- which provider runs which role;
- project-specific synthesis, ranking, and report formats.

The synthesis skill should not move into `agent-os` source as hard-coded
Researcher logic. If it becomes part of the agent-os operating model, it should
be represented as dock-native or user-managed configuration that consumes core
AOS primitives.

## Durable Artifact Stack

The useful artifact stack looks like this:

| Artifact | Owns |
| --- | --- |
| Transfer packet | Minimal fresh-session launch context and routing metadata. |
| Work card | One bounded worker goal with files, boundaries, evidence, and stop conditions. |
| Work record | What happened in one run: intent, execution map, evidence, and health. |
| Evidence record | Immutable or append-only proof: traces, screenshots, outputs, status, citations, logs, or result links. |
| Decision contract / inference block | Reusable judgment: given evidence and inputs, classify, choose, or route. |
| Skill | Repeated agent behavior with judgment, often dock-local or user-managed. |
| Recipe | Reusable bounded procedure, docs-only or source-backed. |
| Playbook | Agent-operable procedure over live surfaces with target resolution and verification. |
| Workflow | Orchestration across actors, sessions, systems, approvals, and artifacts. |

This stack is deliberately not a hierarchy where everything must graduate to a
Workflow. A NotebookLM operating lesson might become a dock skill. A changed
file routing rule might become a decision contract. A verified browser action
sequence might become a playbook. A one-time capture remains a work record.

## Decision Contracts

A **Decision Contract** or **Inference Block** is a compact, source-backed
judgment artifact. It answers:

```text
given these inputs and this evidence, classify/choose/route this way
```

It is durable judgment that can be reused by Foreman, GDI, Operator, a future
Researcher, or an unattended scheduler. It remains docs-only vocabulary for
now. The inventory, shape sketch, transfer routing mapping, and verification
routing consolidation show the concept is useful across one machine-readable
router and two docs-backed policy clusters, but they also show that a generic
schema should wait until AFK/session primitives define where transfer packets,
work records, evidence records, and current-state runtime proof belong. See
`docs/design/notes/decision-contract-verification-routing-consolidation-2026-05-21.md`.

### Artifact Vocabulary

Decision Contract is adjacent to several existing artifact types, but it should
not absorb them:

| Artifact | Distinction from Decision Contract |
| --- | --- |
| Recipe | A reusable bounded procedure: how to do something again. A recipe may contain decision tables, but its primary contract is still a procedure. |
| Playbook | An agent-operable procedure over live surfaces, usually `see -> resolve -> do -> see -> verify`. It encodes action and verification, not only judgment. |
| Workflow | Orchestration across actors, sessions, systems, approvals, gates, and artifacts. It may invoke Decision Contracts, but orchestration is the workflow's job. |
| Work card | One assigned worker round with scope, files, boundaries, verification, and stop conditions. It is a transfer/execution contract, not reusable judgment. |
| Work record | What happened in one run: intent, execution map, evidence, and health. It records execution history rather than deciding a future route by itself. |
| Evidence record | Immutable or append-only proof: traces, screenshots, outputs, status, citations, logs, or result links. A Decision Contract depends on evidence; it is not the evidence. |
| Skill | Repeated agent behavior with judgment, often dock-local or user-managed. A skill may consume a Decision Contract, but it also carries behavioral instructions. |
| Transfer packet | Minimal fresh-session launch context and result-routing metadata. It moves work between sessions; it does not itself define the reusable classification rule. |

`docs/dev/workflow-rules.json` is the strongest current machine-readable
candidate because it already takes changed files as inputs and emits routing,
commands, verification, and notes. It is still the current dev workflow router
manifest, not a renamed Decision Contract, and should remain under its existing
schema and command contract for now.

Researcher and synthesis behavior should also stay layered above AOS
primitives as user or dock configuration. The core platform should provide the
session, transfer, evidence, and routing primitives that such behavior consumes,
not hard-code project-specific source logic for a Researcher role.

Candidate fields:

- `id`
- `summary`
- `inputs`
- `required_evidence`
- `decision_outputs`
- `confidence`
- `invalidation_triggers`
- `recompute_command`
- `consumers`
- `last_validated_at`

Existing hidden examples:

- `docs/dev/workflow-rules.json`: changed files in, recommended verification
  and routing out.
- Dock selection: task shape in, Foreman/GDI/Operator role out.
- Live versus deterministic verification: evidence need plus TCC/readiness
  state in, GDI/Operator/human-needed route out.
- Recipe recommendation: changed files and task kind in, relevant SOPs out.
- `docs/recipes/context-doc-maintenance.md`: proposed context change in,
  adopt/adapt/reject/defer out.

The inventory, shape sketch, transfer routing mapping, and verification routing
consolidation keep this as docs-only vocabulary for now. A schema should wait
until a design-only descriptor sketch has separated stable Decision Contract
metadata from transfer-packet outputs, work/evidence records, and volatile
runtime evidence.

## AFK Primitives

The gateway can already receive Slack commands and track workflow jobs. The AFK
gap is the path from an inbound event or sibling completion to a docked provider
session, and then from that session's result back to a durable route.

### Session Trigger / Scheduler

Proposed shape:

```bash
aos session trigger --dock <dock> --packet <transfer-ref>
```

This would create or resolve a transfer packet, choose a provider/session
runtime, and launch or resume a docked session without a human copying text
between terminals.

Potential triggers:

- cron or scheduled prompt;
- Slack message or command through `packages/gateway`;
- webhook;
- sibling session completion;
- local Foreman dispatch;
- queued workflow job.

Important fields:

- dock name and active role kind;
- provider hint or explicit provider;
- transfer packet path or embedded packet id;
- source event and requester;
- cwd/worktree/branch policy;
- result route;
- timeout and stop conditions;
- evidence requirements.

The gateway should not become the session authority. Its own store says the
daemon owns agent/session communication and the gateway store is scoped to
provider adapters, workflow launches, and presentation state. The session
trigger primitive belongs with AOS session control and can be invoked by the
gateway.

### Background Dispatch With Async Result Routing

Parent agents need to dispatch child sessions without blocking and without a
human as message courier.

The existing work-card plus dock-dispatch model is the right manual shape. The
missing async shape is:

```text
parent session
  -> create transfer packet or work card
  -> start background docked session
  -> receive result at route
```

Result routes should include:

- work record or evidence record;
- integration job result;
- Slack thread or DM via the gateway notifier;
- Foreman inbox;
- issue/PR comment when explicitly configured;
- local artifact path.

When a background session finishes, its final report should update the route
with status, evidence, artifacts, and any next-owner recommendation. The parent
should not need to poll a terminal transcript.

### Provider-Neutral CLI Dispatch

Proposed shape:

```bash
aos session start --dock <dock> --provider codex|claude|gemini
```

The dock and transfer packet should be provider-neutral. Provider choice is a
runtime argument or policy resolution, not a permanent dock property. The repo
already keeps parallel provider discovery/config surfaces such as `.codex/`,
`.claude/`, `CLAUDE.md`, and `GEMINI.md`; AOS should treat provider CLIs as
adapters around the same dock/session contract.

Provider-neutral dispatch should report why a provider was selected, whether it
is authenticated/available, where the session was launched, and how results
will return.

## Experience Distillation

After an expensive exploratory run, the next question should be:

```text
what reusable thing did this session learn?
```

For a browser/model/canvas control session, the distilled artifact should not
be the whole transcript. It should be a compact control note or work record
with:

- entry URL or app assumptions;
- required auth and human gates;
- stable visual, DOM, AX, or app landmarks;
- successful action sequence;
- waits, timing, and readiness checks;
- fragile points and failure modes;
- recovery steps;
- evidence captured;
- invalidation triggers.

Then promote the reusable part only as far as it has earned:

```text
ad hoc run
  -> work/evidence record
  -> distilled skill, recipe, playbook, or decision contract
  -> workflow only when orchestration across actors/systems is real
```

This is the practical meaning of token economics: expensive cognition is fine
when it produces reusable, inspectable learning.

## Role-Kind Vocabulary

The external "AI system engineering" loop is useful as a role-kind lens:

- Researcher: scans external/internal material and emits ranked hypotheses.
- Planner: owns state, queue, next slice, and transfer routing.
- Worker: executes one bounded goal and reports evidence.
- Reviewer: checks correctness, staleness, duplication, and acceptance.
- Reporter: observes runtime state and preserves telemetry/evidence.
- Human Gate: collects bounded human decisions.

Do not rename Foreman, GDI, and Operator yet. Instead, layer role kinds over the
current docks:

- Foreman is Planner-compatible, with Reviewer and Git/GitHub hygiene duties.
- GDI is Worker-compatible.
- Operator is Reporter/Human-Gate-compatible.
- Researcher should begin as configuration or a dock mode before becoming a
  first-class dock.

Create a new dock only when the role needs a durable authority boundary,
distinct handoff contract, separate runtime/session policy, or different
human-supervision posture.

## Corrected Opportunity Sequence

1. Write this design note for durable agent cognition and token economics.
2. Inventory hidden decision contracts, starting with `docs/dev/workflow-rules.json`.
3. Define a Decision Contract shape and invalidation model.
4. Consolidate Decision Contract field guidance across dev workflow routing,
   transfer routing, and live-versus-deterministic verification routing.
5. Sketch a docs-only Decision Contract descriptor and its boundaries with
   transfer packets, work records, evidence records, and AFK/session
   primitives.
6. Add role-kind vocabulary over Foreman, GDI, and Operator without renaming.
7. Design the AFK transfer packet/result-route shape between integration jobs,
   docked provider sessions, work/evidence records, and notifier completion.
8. Design the session trigger/scheduler primitive.
9. Design provider-neutral dispatch over the dock/session contract.
10. Trial Researcher on a real community-signal intake.
11. Extend the evidence-record model for live browser/model/canvas control
    runs.

Researcher is intentionally after the AFK primitives. Without session trigger
and async result routing, Researcher is just another manually launched dock and
does not test unattended agent operation.

## Typed Artifact Graph

If agent-os gains a wiki-like browser for these artifacts, it should be a typed
artifact graph, not a prose knowledge base.

The human is the first audience and agents are the second. Nodes should be
small, typed, and machine-linkable:

- ADR;
- design note;
- work card;
- work record;
- evidence record;
- decision contract;
- recipe;
- playbook;
- workflow;
- transfer packet;
- issue or PR.

Edges should carry meaning:

- `produced_by`
- `guided_by`
- `invalidates`
- `supersedes`
- `requires_evidence`
- `routes_to`
- `implements`
- `blocks`
- `verified_by`

This would let a future browser show how artifacts, decisions, evidence, and
implications connect without asking agents to reread large prose documents.

## Non-Goals

- Do not put project-specific synthesis logic in `agent-os` core.
- Do not create a Researcher dock before proving the authority boundary.
- Do not rename `aos` verbs just to fit current doctrine.
- Do not fill top-level `recipes/` with examples to justify the folder.
- Do not make `packages/gateway` the owner of sessions; keep it as provider
  ingress, workflow/job presentation, and notifier surface around AOS.
- Do not promote every successful exploration into a schema. Preserve first,
  extract after repeated use.

## Near-Term Validation

The next slices should stay reversible:

1. Sketch a docs-only Decision Contract descriptor from the consolidated
   candidate guidance, without adding a committed schema or migrating existing
   manifests.
   The descriptor and AFK boundary sketch now lives at
   `docs/design/notes/decision-contract-descriptor-and-afk-boundary-2026-05-21.md`;
   it keeps Decision Contract as reusable judgment metadata and leaves launch
   context, run receipts, session scheduling, provider dispatch, and async
   notification in their own primitives.
2. Sketch one transfer packet/result route shape that can connect an integration
   job to a docked provider session.
   The packet/result-route sketch now lives at
   `docs/design/notes/afk-transfer-packet-result-route-shape-2026-05-21.md`;
   it keeps gateway/broker ownership to provider ingress, job transitions, and
   notifier delivery while leaving session launch/resume to AOS session control,
   provider dispatch, and future scheduler primitives.
3. Design the session trigger/scheduler primitive that accepts a transfer
   packet, applies lease/timeout policy, starts or resumes a docked provider
   session, and updates lifecycle routes without making the gateway session
   authority.
   The scheduler shape now lives at
   `docs/design/notes/afk-session-trigger-scheduler-shape-2026-05-21.md`;
   it keeps the scheduler focused on packet intake, start/resume decisions,
   leases, heartbeats, lifecycle state, and result-route updates while leaving
   provider-specific launch mechanics to provider-neutral dispatch.
4. Design provider-neutral dispatch over the dock/session contract.
   The dispatch shape now lives at
   `docs/design/notes/afk-provider-neutral-dispatch-shape-2026-05-21.md`;
   it keeps dispatch focused on translating a scheduler-selected start, resume,
   dry-run, or rejection into provider CLI/session facts while leaving
   lifecycle, proof semantics, gateway state, and dock role policy to their own
   surfaces.
5. Run a design consolidation/readiness pass across the AFK packet,
   scheduler, and dispatch sketches before prototyping, so the first source
   slice has a minimal shared vocabulary instead of a single-provider shortcut.
   The consolidation/readiness map now lives at
   `docs/design/notes/afk-design-consolidation-readiness-2026-05-21.md`;
   it assigns duplicate field ownership, defines the minimum manual-trial
   receipt trail, and recommends a docs-only work/evidence receipt shape before
   a deterministic local dry-run prototype.
6. Define the docs-only AFK work/evidence receipt shape that a manual trial and
   deterministic dry-run prototype must leave behind.
   The receipt shape now lives at
   `docs/design/notes/afk-work-evidence-receipt-shape-2026-05-21.md`;
   it separates transfer, scheduler, dispatch, work, and evidence receipts,
   defines mandatory review fields, gives temporary manual storage/naming, and
   led to an experimental no-provider dry-run prototype in
   `scripts/afk-dry-run-prototype.mjs` with focused coverage in
   `tests/afk-dry-run-prototype.test.mjs`.
7. Expose the dry-run prototype through the governed repo-development surface.
   The experimental command is now
   `./aos dev afk-dry-run --packet <packet.json> --provider codex --dock gdi --json`;
   it delegates to the no-provider prototype and keeps AFK runtime/session
   command spelling deferred.
8. Use the dev dry-run command to decide whether the next implementation path
   is receipt contract correction or a first supervised provider/session
   launch. Apply
   `docs/recipes/workstream-checkpoint-continuation.md` so this is a Foreman
   routing decision, not a human-managed preference choice.
   A supervised Operator smoke now has a manual receipt at
   `docs/design/notes/manual-afk-receipts/2026-05-22-afk-provider-session-smoke-gdi-completed.md`;
   it validated dry-run preflight plus one Codex GDI launch and exposed
   provider catalog and telemetry as the next observability gap.
9. Distill one real browser/model-control run into a work/evidence record and
   decide whether it wants a skill, recipe, playbook, or decision contract.
10. Map provider-session observability before automating provider launch, so
   dispatch can report session id, catalog, telemetry, and terminal facts
   without relying on human-visible shutdown text.
11. Trial a Researcher-compatible role only after the session trigger and async
   result route have a credible manual or prototype path.
