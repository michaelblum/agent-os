# Architecture Deepening Audit Triage

Status: external/read-only audit input, not an accepted spec.

Date recorded: 2026-05-07

Source: an independent architectural deepening report over `agent-os`, produced
from four read-only exploration passes across Swift core, gateway/host, toolkit,
and Sigil/tests/recipes.

## How To Use This Note

This note preserves the useful signal from the audit without promoting the audit
itself into the roadmap. A candidate below is not approved work just because it
appears here. Promote a candidate only when there is a bounded slice, live repo
evidence, and a clear exit criterion.

The report's strongest useful signal is that several ADR decisions are now ahead
of the code: Subject Browser as a surface kind, Capabilities as named contracts,
Recipe/Playbook/Workflow separation, and Target-with-Ref/State ID vocabulary are
mostly decided but only partially operational. That does not mean the next move
should be a broad refactor. Prefer small platform slices that remove real
duplication discovered while shipping product-facing work.

## Foreman Read

The audit is directionally credible, but it overstates the readiness of some
large refactors. The safest interpretation is:

- Treat toolkit helper and semantic-ref consolidation as immediate platform
  hygiene because current Implementer work is already exercising that seam.
- Treat Capability-to-Control derivation as the next likely platform move after
  low-level helper consolidation.
- Treat Subject Browser, Target Resolver, Work Record consolidation, and
  Recipe/Playbook/Workflow registries as epics that need scoping passes before
  implementation.
- Avoid app-wide Sigil, Slack, voice, provider, or database refactors until a
  product task or second adapter makes the seam real.

## Near-Term Triage

### Now

1. Toolkit helper and semantic-ref consolidation.

The audit's Candidate 16 matches a live pain point: small helper functions and
semantic-target wiring are duplicated across toolkit workbenches. This is already
being handled as a narrow Implementer slice. Keep it mechanical: shared helper module,
two or three consumers, focused tests, no behavior change.

2. Shared Markdown preview presentation.

This has already landed in `packages/toolkit/markdown/preview.css` after the
Artifact Bundle Markdown preview exposed that the renderer was shared but the
preview presentation was not. This is a good example of the right scale:
platform-level enough to prevent UI drift, small enough not to create a broad
Subject Browser rewrite.

### Soon

1. Capability-to-Control derivation.

ADR-0010 says Capabilities are named contracts and Controls are derived, but the
derivation rule still lives in component-specific render logic. The right first
slice is a pure toolkit function that takes a Subject descriptor and returns an
ordered list of proposed Controls. Migrate one or two surfaces only after the
function's shape is proven.

Promotion gate: at least two current surfaces contain duplicate logic deciding
whether to show inspect/edit/verify/export/replay affordances from
`capabilities[]`, `contracts[]`, and `facets[]`.

2. Subject Entry Handle parsing and validation.

This should probably land as a small helper before any Subject Browser deep
module. Do not build a full resolver until there is a second real consumer
outside the Wiki Subject Browser path.

Promotion gate: a second surface opens or routes Subject Entry Handles and would
otherwise duplicate wiki-specific parsing.

3. Work Record module facade.

The audit is right that Work Record code is spread across capture, verification,
adapters, subject projection, and UI. Do not flatten everything immediately. A
first safe slice would be a stable public facade that exports the current
operations while leaving internal files intact.

Promotion gate: a new producer or verifier needs Work Record build/verify/evidence
operations and currently imports from multiple files.

2026-05-07 status: Work Record facade V0 is complete at
`packages/toolkit/workbench/work-record.js`. A current non-test toolkit import
audit found no consumer importing multiple Work Record internal helper files, so
deeper consolidation is deferred until another producer needs the same
build/verify/evidence workflow.

2026-05-07 close-out status: the small toolkit-deepening track is complete.
Recent helpers now cover semantic target attribute stamping, shared Markdown
preview presentation, Capability-to-Control derivation, Subject Entry Handle
parsing/formatting, and the shallow Work Record facade. The remaining safe
adoption moved adjacent Work Record consumers to the facade without changing
behavior. Larger tracks remain deferred: Subject Browser deep module, Target
Resolver plus State ID lifecycle, Work Record deep module, and
Recipe/Playbook/Workflow registry.

## Later Epics

### Subject Browser Deep Module

Candidate 1 is probably true as an architectural direction, but too broad for a
single Implementer session now. Subject Browser should become a deep module only after
smaller primitives are operational: Subject Entry Handle parsing, Capability to
Control derivation, Facet/Host selection, and Navigation Trail state.

Promotion gate: at least three surfaces need the same subject opening, trail,
facet, reference, and control shell, and the smaller helpers above have already
stabilized.

### Unified Target Resolver And State ID Lifecycle

Candidates 6 and 7 are strong core-platform work. They belong together: State ID
enforcement needs a real target-resolution seam. Do not mix this with toolkit UI
work. The first slice should probably be read-only normalization and tests for
existing `browser:`, `canvas:`, `screen:`, and future `ax:` shapes, not immediate
behavioral rejection changes.

Promotion gate: another command or dialect change needs target parsing, or stale
coordinate behavior causes another real incident.

### Work Record As One Deep Module

Candidate 2 matters, but the current Work Record pieces have been changing
rapidly as schemas and supervised-run flows matured. Consolidate only once the
interfaces settle enough that the facade can reduce churn instead of hiding it.

Promotion gate: a second producer beyond the current Work Record/Playbook test
line needs the same build/verify/evidence workflow.

### Recipe / Playbook / Workflow Registry

Candidate 5 is a real design direction, especially after ADR-0009, but it should
follow actual use. The supervised-run work intentionally avoided a public
`aos test run` command and broad workflow execution surface. Keep this as a
design/scoping target.

Promotion gate: a workflow or playbook runner needs typed discovery/validation
instead of ad hoc fixture/recipe loading.

## Watch List

- Canvas State Client and Canvas Event Bus: useful when more code crosses
  perceive/act/show boundaries, but not a product-facing blocker today.
- Registry-driven command dispatch: attractive, but not worth interrupting
  feature work unless command/help drift causes another concrete failure.
- Gateway IntegrationBroker decomposition: coordinate with any Subject Browser
  deep-module work; do not split it just for file size.
- CoordinationDB typed facades: reasonable when a caller needs only one domain
  facade or tests start mocking SQL directly.
- Session module consolidation: wait for another session provider or a Subject
  model integration need.
- `aos-proxy` typed client: small cleanup, but low leverage until a second
  backend appears.

## Defer Unless Product Work Forces It

- Sigil renderer split.
- Radial Menu as a host-neutral Subject.
- Appearance Descriptor separated from Studio UI.
- Sigil tests rewritten wholesale around AOS verbs.
- Slack UI/provider merge.
- Voice selection consolidation.

These may be correct, but they are too far from the current workstream to pull
forward without a concrete product or testing trigger. The radial menu work is
the most likely to become relevant when Subject Browser navigation reaches real
Sigil artifact editing.

## Candidate Ledger

| Audit candidate | Disposition | Reason |
|---|---|---|
| 1. Subject Browser as a deep module | Later epic | Correct direction, too broad before smaller helpers stabilize. |
| 2. Work Record as one deep module | Soon/later | Likely useful, but start with a facade after another producer needs it. |
| 3. Capability -> Control derivation | Soon | Direct ADR-0010 operationalization with pure-function testability. |
| 4. Subject Entry Handle resolver | Soon, behind second consumer | Useful helper; avoid standalone overdesign until another surface needs it. |
| 5. Recipe / Playbook / Workflow registry | Later | Needs workflow/playbook runner pressure. |
| 6. Unified Target Resolver | Later core track | Strong, but should be separate from toolkit work. |
| 7. State ID lifecycle | Later core track | Belongs behind Target Resolver. |
| 8. Canvas State Client / Event Bus | Watch | Real seam, not the current bottleneck. |
| 9. Registry-driven command dispatch | Watch | Helpful if command/help drift recurs. |
| 10. Voice selection module | Defer | Local cleanup, low current leverage. |
| 11. IntegrationBroker decomposition | Watch | Pair with Subject Browser contract work, not file-size cleanup. |
| 12. CoordinationDB typed facades | Watch | Wait for caller/test pressure. |
| 13. Session module | Watch | Wait for second provider or Subject alignment. |
| 14. Slack UI/provider merge | Defer | Reasonable deletion-test cleanup, off current path. |
| 15. `AosClient` proxy wrapper | Defer | Low-cost but low urgency. |
| 16. Toolkit helpers / semantic refs | Now | Directly matches active helper-consolidation work. |
| 17. Sigil renderer split | Defer | Too broad without product trigger. |
| 18. Radial Menu as Subject | Later product track | Relevant when Sigil editing enters Subject Browser flow. |
| 19. Appearance Descriptor | Later product track | Good direction, needs avatar/studio workstream. |
| 20. Sigil tests via AOS verbs | Later testing track | Migrate opportunistically when touching Sigil tests. |

## Roadmap Integration

Do not create issues for every candidate. Carry the following roadmap themes
forward:

1. Finish low-level toolkit helper/semantic-ref consolidation.
2. Scope Capability-to-Control derivation as the next toolkit platform slice.
3. Keep Subject Browser deep-module work as an epic, gated by smaller helpers.
4. Keep Target Resolver + State ID as a separate core-platform track.
5. Revisit Work Record module consolidation only when a second producer needs
   the same build/verify/evidence operations.

## Prompt Guidance

When using this report in future Implementer prompts, include only the one relevant
sentence for the active slice. Do not paste the whole audit into a goal prompt.

Example:

> Background only: the architecture audit identified toolkit helper duplication
> as a high-leverage deepening candidate. Treat that as context, not a new spec.
