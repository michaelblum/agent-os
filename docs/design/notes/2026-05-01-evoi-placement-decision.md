# EVOI Placement Decision

Status: design note, not implementation.

Input: `memory/scratchpad/EVOI_Project/playbook_prototype.md`.

## Decision

EVOI should not be promoted directly into a live AOS artifact yet. The v0 home
is this provider-neutral design note under `docs/design/notes/`; the raw
prototype stays in scratchpad until a smaller AOS-native artifact is written.

The prototype is best understood as an expected-value-of-information operating
policy for agents: choose the cheapest reliable next observation, prefer
structured perception before pixels, use projection-backed clarification when
that lowers uncertainty, and execute only when confidence is high enough for
the risk. That idea is relevant to AOS, but the current draft uses foreign
tool names, fixed reward numbers, mandatory hidden output structure, and a
single-agent prompt shape that do not match AOS primitives or repo guidance.

## Classification

| Candidate | Decision | Reason |
| --- | --- | --- |
| Docs recipe | Not yet; likely first promotion target. | The useful content is an operating practice, but it needs to be rewritten in AOS vocabulary and grounded in actual `see`, `show`, `tell`, `listen`, and readiness behavior before becoming an SOP. |
| Wiki playbook | Not yet. | AOS has not landed a first-class wiki playbook contract in the current taxonomy, and this policy is cross-app rather than app-local runtime knowledge. |
| Portable agent skill | No. | A portable skill would freeze a prompt around non-AOS abstractions. EVOI should be expressed through AOS primitives and repo contracts, not as an external prompt bundle. |
| Sigil operating mode | No. | Sigil can eventually consume projection or clarification behavior, but the policy belongs below Sigil at the AOS agent/control-surface layer. |
| Schema-backed run-control policy | Later, if thresholds become machine-enforced. | A schema would be appropriate only after AOS defines concrete budget, confidence, observation, clarification, and safety-gate fields. |
| Ops recipe | No for v0. | The prototype is not deterministic executable behavior that `aos ops` can list, explain, dry-run, and run. Future deterministic probes may become ops recipes, but the policy itself is not one. |

## AOS Translation

Use AOS terms instead of importing the prototype vocabulary:

| Prototype term | AOS-native direction |
| --- | --- |
| Perception Tool | `see`, `inspect`, `target.probe`, and adapter-specific expansions. |
| Projection Tool | `show` overlays/canvases plus `tell human` for clarification. |
| Score | A plan, run-control timeline, or future workflow; not a new top-level AOS noun yet. |
| Compute budget | Value-of-information guidance over available expansions, pixel capture, and human interruption. |
| Clarify with Projection | A bounded human clarification turn that uses semantic targets or overlays when spatial disambiguation matters. |
| Expand Semantic / Expand Visual | Explicit, addressable `target.probe.available_expansions` or adapter-specific deeper reads. |

The core reusable rule is:

```text
Prefer the cheapest observation that can change the decision.
Structured target metadata is cheaper than pixels.
Projection-backed clarification is cheaper than guessing when ambiguity is spatial.
Pixels are justified when the task depends on visual state unavailable through structure.
```

## Relationship To Existing Work

This memo depends on the AOS artifact taxonomy in `docs/api/aos-taxonomy.md`.
It does not modify that taxonomy.

Research intake issues #156 and #158 are adjacent only around target
acquisition, intake modes, source packs, and wiki promotion. EVOI is not a
research-intake implementation. If research intake later needs the same
decision policy, it should consume a promoted docs recipe or schema-backed
run-control policy rather than owning EVOI itself.

Issue #129 remains the owner for executable `aos ops` behavior. EVOI should
not become an ops recipe unless a future slice defines a deterministic,
source-backed operator unit with dry-run and cleanup contracts.

## Prerequisites Before Promotion

Before creating any live EVOI artifact, land or identify:

1. AOS-native wording for the policy, avoiding mandatory hidden reasoning
   blocks and foreign tool names.
2. A clear relationship to `target.probe`, especially `available_expansions`,
   privacy, budget, handles, and adapter-specific deeper reads.
3. A projection/clarification pattern that uses `show` and `tell human`
   without creating agent-only visual hints or bypassing accessibility
   semantics.
4. A readiness/preflight rule: when perception or action is blocked, fail
   closed with the concrete AOS blocker instead of guessing.
5. Test scenarios that show when semantic expansion, visual expansion, or
   human clarification is selected.
6. A decision about whether any thresholds belong in schema-backed run-control
   events, a docs recipe, or runtime wiki playbook knowledge.

## Next Artifact

The next durable artifact should be a narrow docs recipe, not a skill or ops
recipe. Suggested working title:

```text
docs/recipes/value-of-information-clarification.md
```

That recipe should describe the AOS-native decision loop for choosing between
structured perception, visual capture, projection-backed clarification, and
execution. It should stay qualitative until AOS has measured budget and
confidence fields worth enforcing.

Do not implement EVOI behavior from this memo. Treat it as placement guidance
for a future design or recipe pass.
