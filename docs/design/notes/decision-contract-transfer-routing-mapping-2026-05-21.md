# Decision Contract Transfer Routing Mapping

**Date:** 2026-05-21
**Status:** docs-only mapping for `decision-contract-transfer-routing-mapping-v0`

## Summary

Foreman transfer routing is a credible second Decision Contract candidate, but
only as a docs-backed candidate. It fits the core shape:

```text
given these inputs and this evidence, classify/choose/route this way
```

The current routing model takes task shape, target actor, source artifact,
branch/base facts, blocker state, and external publication needs as inputs. It
inspects dock contracts, the Foreman session-transfer skill, recipient
references, and work-card rules. It then chooses a transfer kind, storage
location, dispatch shape, recipient dock, stop conditions, and expected evidence.

This strengthens the generic Decision Contract model because it proves the field
sketch is not only a relabeling of `docs/dev/workflow-rules.json`. It also
shows where the field names strain: transfer routing has multiple linked outputs
and actor/session responsibilities, not just one recommendation payload. The
right next step is still docs-only adjustment and at least one more candidate
mapping before any schema sketch.

This note does not implement transfer packets, session trigger, scheduler,
provider dispatch, or async result routing.

## Current Transfer Routing Model

### Inputs

Current transfer routing uses these bounded inputs:

- Current user request, completion report, blocker, or coordination state.
- Target actor or recipient dock: Foreman, GDI, Operator, human, or relay
  authority.
- Transfer purpose: successor continuity, deterministic implementation,
  supervised live evidence, correction, relay, or human-needed recovery.
- Source artifact path, issue, PR, commit, branch, or report.
- Branch/base facts such as `branch_from`, `required_start_ref`, and whether a
  `gdi/*` branch is an output branch or work surface.
- Active workflow profile and whether external mutation, push, PR, GitHub issue
  work, or publication is explicitly assigned.
- Runtime or permission blocker state, especially TCC/input-tap blockers for
  live AOS verification.
- Evidence need: deterministic tests, live screenshots/traces, human judgment,
  GitHub-visible branch/report evidence, or local-only state disclosure.

### Evidence Inspected

The authoritative evidence is currently Markdown and scripts rather than a
machine-readable route manifest:

- `AGENTS.md` for dock-first cold start, entry paths, AOS as shell, and
  repo-wide transfer boundaries.
- `.docks/README.md` for dock launch, clipboard transfer tools, storage matrix,
  and canonical dock responsibilities.
- `.docks/AGENTS.md` for shared transfer vocabulary, GitHub control-surface
  policy, storage rules, and momentum after external changes.
- `.docks/foreman/AGENTS.md` for Foreman next-step loop, transfer-artifact
  classification, work-card routing, and acceptance ladder.
- `.docks/foreman/skills/session-transfer/SKILL.md` for transfer kinds,
  universal transfer header, placement matrix, bad assumption checks, and
  output discipline.
- `.docks/foreman/skills/session-transfer/references/gdi-work-card-authoring.md`
  for GDI work-card slots, branch/base requirements, verification, TCC stall
  handling, and completion-report expectations.
- `.docks/foreman/skills/session-transfer/references/operator.md` for
  supervised/HITL transfer slots and when to use Operator.
- `.docks/foreman/skills/session-transfer/references/foreman.md` for successor
  handoff storage and contents.
- `.docks/gdi/AGENTS.md` for GDI branch/base, commit/push authority,
  human-needed stall handling, and completion-report shape.
- `.docks/operator/AGENTS.md` for Operator supervised execution boundaries and
  stop conditions.
- Work cards under `docs/design/work-cards/` as live examples of branch/base,
  stop-condition, verification, and completion-report contracts.

### Outputs And Decisions

Transfer routing currently emits several coupled decisions:

- Transfer kind: successor handoff, GDI round, Operator run, relay packet,
  correction round, or human-needed packet.
- Recipient/actor: Foreman, GDI, Operator, human, relay authority, or external
  provider-facing route when explicitly configured.
- Storage location: temp/chat/clipboard for successor state, work card under
  `docs/design/work-cards/` for non-trivial GDI or correction rounds, usually
  chat/clipboard for Operator and human-needed packets, or GitHub-visible
  surfaces for relay packets.
- Dispatch shape: thin `follow the instructions in ...` payload for GDI work
  cards, concrete supervised instructions for Operator, compact successor
  state for Foreman, or exact recovery steps for human-needed packets.
- Branch/output expectations: start ref, output branch, local checkpoint, push
  authority, PR/GitHub mutation boundary, and local-only state disclosure.
- Stop conditions: done, failed, stalled, human-needed, misrouted, or blocked
  by external credentials/permissions/product direction.
- Required return evidence: changed files, verification results, live evidence,
  blocker details, branch/SHA, local-only state, and next-owner recommendation.

### Consumers

Current consumers are human and agent sessions:

- Foreman consumes the routing rules to classify work and create/copy transfer
  artifacts.
- GDI consumes work cards and dispatches to execute deterministic rounds.
- Operator consumes supervised transfer instructions to collect live or
  human-in-the-loop evidence.
- Human users consume human-needed packets and clipboard dispatch payloads.
- Future session trigger, transfer packet, and async result-routing primitives
  would consume a structured version of this routing decision if the docs-backed
  model is later promoted.

### Invalidation Triggers

The mapping should be rechecked when any of these change:

- New dock role, role authority boundary, or durable recipient kind.
- New transfer kind, storage surface, or clipboard/handoff helper.
- Changed Foreman acceptance ladder, next-step loop, or external mutation
  policy.
- Changed GDI branch/base, commit, push, or completion-report contract.
- Changed Operator supervised/HITL boundary or stop conditions.
- Workflow profile changes that affect branch, push, PR, or relay authority.
- Introduction of transfer packets, session trigger/scheduler, provider-neutral
  dispatch, async result routing, work records, or evidence records.
- GitHub control-surface changes, especially if GitHub-visible relay evidence
  becomes automated.
- Any move from docs-backed guidance to source-backed manifests or schemas.

## Mapping To The Field Sketch

| Decision Contract field | Current transfer routing docs |
| --- | --- |
| `id` | No single current id exists. Transfer kinds are named in `.docks/foreman/skills/session-transfer/SKILL.md`; work cards provide durable per-round file names. A future contract could use a handle such as `foreman-transfer-routing`, with subrule ids for `gdi-round`, `operator-run`, `successor-handoff`, `relay-packet`, `correction-round`, and `human-needed-packet`. |
| `summary` | The summary is spread across `.docks/AGENTS.md` cross-session transfer vocabulary, `.docks/README.md` clipboard transfer storage, and `.docks/foreman/AGENTS.md` transfer-artifact/work-card routing sections. It decides how actionable state moves between dock sessions and actors. |
| `inputs` | Current inputs are task shape, completion/blocker state, recipient, transfer kind, source artifact, branch/base facts, workflow profile, runtime blocker state, evidence need, and external publication boundary. They are documented in the universal transfer header, GDI work-card authoring slots, GDI git boundary, Operator reference, and successor handoff reference. |
| `required_evidence` | Required evidence is docs-backed: dock contracts, transfer skill and references, work-card examples, `docs/dev/active-profile.json`, `docs/dev/workflow-profiles.json`, and helper scripts such as `scripts/agent-handoff`, `scripts/dock-handoff-clipboard`, `.docks/foreman/scripts/handoff`, and `.docks/gdi/scripts/human-needed-tcc-reset`. There is no current schema or recompute test that proves routing completeness. |
| `decision_outputs` | Outputs are transfer kind, recipient, storage home, dispatch payload shape, branch/output expectations, stop conditions, and return-evidence requirements. Unlike the dev workflow router, these outputs are split across artifact creation, clipboard behavior, and recipient completion contracts. |
| `confidence` | Medium. The model is coherent and actively used, and it is anchored by multiple role-local instruction files. It is lower than `docs/dev/workflow-rules.json` because it is not schema-backed, command-backed, or covered by dedicated route tests. |
| `invalidation_triggers` | New dock roles, transfer kinds, storage homes, helper behavior, workflow-profile semantics, branch/push authority, TCC recovery policy, Operator stop conditions, GitHub relay policy, and future AFK primitives all require review. |
| `recompute_command` | None today. Foreman recomputes by reading current docs and current state. `./aos dev recommend --json` helps choose verification/build posture for changed files, but it does not route transfers. |
| `consumers` | Foreman, GDI, Operator, humans receiving recovery packets, relay authorities, and future transfer-packet/session-trigger/result-routing services. |
| `last_validated_at` | This mapping was inspected on 2026-05-21 against the dock contracts, Foreman session-transfer skill, recipient references, decision-contract sketch, and durable-agent-cognition design note. |

## Field Strain

- `id` fits poorly because transfer routing is currently a policy cluster, not a
  single manifest or rule list. A future schema would likely need one contract
  id plus named route rules.
- `decision_outputs` is too singular for transfer routing. The output is a
  bundle: recipient, storage, dispatch shape, branch policy, stop conditions,
  and required result evidence. The field can remain, but examples should call
  out composite outputs.
- `required_evidence` needs to distinguish source authority from run evidence.
  Transfer routing depends on durable instruction files plus current-state
  facts such as branch, worktree, profile, and blocker state.
- `confidence` should account for docs-backed operational maturity separately
  from schema/test backing. Transfer routing is reliable enough to use but not
  mechanically audited.
- `recompute_command` must be optional. Transfer routing has no command today,
  and forcing one would encourage premature automation.
- `consumers` needs room for actor and service consumers. Foreman/GDI/Operator
  are not just passive readers; they each enforce part of the contract.
- `last_validated_at` should probably be an evidence pointer in future machine
  forms. A timestamp alone does not show which role docs and examples were
  inspected.

The field sketch still holds, but the names should be adjusted before schema
work. The most useful adjustment is to describe `decision_outputs` as possibly
composite, and to split examples for `required_evidence` into source authority
and current-state evidence.

## Relationship To AFK Primitives

### Transfer Packet

Transfer routing is the policy that would decide what belongs in a transfer
packet. A packet would carry the selected recipient, source artifact, start ref,
branch/output expectations, stop conditions, result route, and evidence
requirements. The current docs prove the packet shape is needed, but this note
does not implement that packet.

### Session Trigger / Scheduler

A future session trigger would consume transfer-routing output when launching or
resuming a docked session. The route decision would need to say which dock to
start, which provider/session policy applies, what transfer packet to pass, and
what stop conditions matter. Today that remains a manual Foreman clipboard and
work-card path.

### Async Result Routing

Transfer routing already requires return evidence and next-owner
recommendations, but result delivery is manual. Async result routing would turn
completion reports, work records, evidence records, GitHub-visible branch
reports, or human-needed packets into durable result routes. The current docs
identify the needed result content; they do not provide the delivery primitive.

### Provider-Neutral Dispatch

The dispatch rules are provider-neutral in intent: docks, transfer kinds, source
artifacts, and stop conditions are repo-native rather than tied to Codex,
Claude, Gemini, Slack, or GitHub. A future provider-neutral CLI could automate
the launch step while preserving the same routing decision. The current
clipboard helpers are compatibility surfaces, not provider dispatch.

## Recommendation

Keep this docs-only. Transfer routing strengthens the Decision Contract model as
a second non-router candidate, but it does not yet justify a generic schema.

Adjust the field sketch before schema work:

- Clarify that `decision_outputs` may be a composite route packet rather than a
  single classification.
- Clarify that `required_evidence` can include source-authority files and
  current-state evidence.
- Keep `recompute_command` optional for docs-backed contracts.
- Treat `confidence` as derived from backing type: schema-backed,
  command-backed, test-backed, docs-backed, recently validated, or exploratory.

Map one more candidate before preparing a schema sketch. The best next
candidate is live-versus-deterministic verification routing because it crosses
entry paths, runtime readiness, TCC blockers, GDI/Operator boundaries, and
human-needed packets without being identical to transfer routing.

Only after that should Foreman consider a thin generic Decision Contract schema
or descriptor. If schema work begins, it should start as an adapter around
existing artifacts rather than a migration of dock instructions or transfer
scripts.
