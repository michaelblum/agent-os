# Decision Contract Shape Sketch

**Date:** 2026-05-21
**Status:** docs-only sketch for `decision-contract-shape-sketch-v0`

## Summary

A Decision Contract in agent-os terms is a compact, source-backed judgment
artifact:

```text
given these inputs and this evidence, classify/choose/route this way
```

It is not a recipe because its primary purpose is not a procedure to run. It is
not a workflow because it does not orchestrate actors, systems, gates, or child
runs. It is not a work card because it is not a single assigned round. It is the
durable shape of reusable judgment that can be recomputed, audited, and cited by
agents or future automation.

This remains docs-only for now. `docs/dev/workflow-rules.json` is the strongest
current machine-readable candidate, but today it is still the dev workflow
router manifest. It should not be renamed, promoted, or generalized until the
Decision Contract vocabulary survives another design pass and at least one
second non-router candidate proves the generic fields are not just a relabeling
of the current router schema.

## Proposed Docs-Only Field Sketch

| Field | Meaning |
| --- | --- |
| `id` | Stable handle for the reusable judgment or for a rule inside a manifest. |
| `summary` | Human-readable description of the decision the contract makes and the boundary it applies to. |
| `inputs` | Bounded facts provided at recompute time, such as changed paths, explicit files, task class, runtime state, or selected manifest. |
| `required_evidence` | Source files, schemas, tests, command outputs, patterns, or claims that must remain true for the decision to be trusted. |
| `decision_outputs` | The classification, route, commands, verification steps, notes, flags, or next-owner recommendation produced from the inputs. |
| `confidence` | Stated strength of the contract and why: schema-backed, command-backed, docs-backed, recently validated, partial, or exploratory. |
| `invalidation_triggers` | Changes that make the cached judgment suspect and require review or recomputation. |
| `recompute_command` | Canonical command, if one exists, that re-runs the decision against current state. |
| `consumers` | Agents, commands, recipes, tests, profiles, or future services that rely on the decision output. |
| `last_validated_at` | Date or evidence pointer showing when the contract was last inspected against current sources. |

## Mapping To The Current Router Manifest

| Decision Contract field | Current `docs/dev/workflow-rules.json` and adjacent evidence |
| --- | --- |
| `id` | Each manifest rule has an `id`, such as `docs-only`, `swift-core`, `schemas`, and `dev-workflow-manifest`. A future generic wrapper could also give the whole manifest a contract id, but no such wrapper exists today. |
| `summary` | The manifest has a top-level `summary`, and every rule has a required `summary` enforced by `shared/schemas/dev-workflow-rules.schema.json`. |
| `inputs` | The live inputs are changed file paths from the repo diff or explicit `--files` / `--paths` arguments, plus the selected manifest path. `src/commands/dev.swift` loads `docs/dev/workflow-rules.json` by default and classifies files against rule `patterns`. |
| `required_evidence` | The rule `patterns` are the immediate matching evidence. The supporting evidence is the schema in `shared/schemas/dev-workflow-rules.schema.json`, the canonical and fixture validation in `tests/schemas/dev-workflow-rules.test.mjs`, router behavior checks in `tests/dev-workflow-router.sh`, and audit claims in `tests/dev-audit.sh`. |
| `decision_outputs` | Rule outputs map directly to `classes`, `actions`, `hot_swappable`, `tcc_identity_sensitive`, `commands`, `verification`, and `notes`. `./aos dev recommend --json` aggregates these into `summary`, `next_commands`, `verification`, and `notes`. |
| `confidence` | High for dev workflow routing as a candidate because it is schema-backed, command-backed, fixture-backed, and covered by shell tests. Lower for treating it as a generic Decision Contract because only this one machine-readable candidate has been mapped. |
| `invalidation_triggers` | File ownership changes, new source or test surfaces, new command contract docs, changes to `src/commands/dev.swift`, schema changes, changed diff-base semantics, new workflow profile policy, and stale or missing patterns in the `dev-workflow-manifest` self-route rule. |
| `recompute_command` | `./aos dev recommend --json` recomputes against current branch diff. `./aos dev recommend --json --files <paths>` recomputes against explicit paths. `./aos dev audit --json` checks evidence-backed claims about the router itself. |
| `consumers` | Local agents and developers use `./aos dev recommend`. `./aos dev audit` consumes the same manifest for grammar claims. Work cards cite the recommendation before choosing rebuilds, runtime readiness, or docs-only verification. `docs/dev/active-profile.json` and `docs/dev/workflow-profiles.json` are adjacent policy inputs but not the same contract. |
| `last_validated_at` | This sketch was validated on 2026-05-21 by inspecting the manifest, schema, schema test, router test, audit test, Swift command references, active profile, and workflow profile manifest, then running `./aos dev recommend --json`. |

## Non-Mapping

These fields or semantics should not be forced into the current router manifest:

- A top-level generic Decision Contract wrapper. The manifest already has a
  concrete schema and command consumer; adding a wrapper now would mostly rename
  stable dev-router vocabulary before the generic concept is proven.
- `confidence`. Current confidence comes from adjacent tests and design review,
  not from a runtime field. Encoding it in the router could make it look more
  precise than the evidence supports.
- `last_validated_at`. The manifest should not gain a timestamp that changes
  whenever a human or agent re-inspects it. Validation evidence belongs in tests,
  audit output, commits, or design notes until a durable evidence record exists.
- Broad `consumers` metadata. The current manifest is intentionally small and
  command-facing. Consumer inventories can drift quickly and should live in docs
  or generated audit evidence before becoming schema.
- General `required_evidence` pointers. Rule `patterns`, `commands`, and
  `verification` belong in the manifest. Broader evidence such as tests, schema
  files, and audit claims are better represented by the existing audit and test
  surfaces.
- Workflow profile semantics. `docs/dev/active-profile.json` and
  `docs/dev/workflow-profiles.json` decide branch, commit, review, PR, merge,
  and release posture. That policy should stay adjacent and should not be
  collapsed into changed-file workflow routing.
- Recipe, playbook, work-card, dock, session-trigger, or async result-routing
  concepts. Those are related durable-agent-cognition artifacts, but they should
  not be packed into the dev workflow router manifest.

## Open Questions

- Is the future schema a generic `decision-contract` descriptor, or an adapter
  layer around specific manifests such as `dev-workflow-rules`?
- Should a Decision Contract require a recompute command, or can docs-backed
  contracts without a command still qualify?
- Is `required_evidence` a static list of source surfaces, an evidence-record
  reference, or both?
- Should `confidence` be a closed enum, a prose note, or a derived property from
  tests/audit status?
- How should invalidation be checked: declared triggers, file watchers, audit
  claims, or work-record evidence?
- Can one contract contain many rules, as `workflow-rules.json` does, or should
  each rule become a separately addressable contract?
- What is the second candidate that can prove the shape is generic: transfer
  routing, tooling-context verification routing, context-doc maintenance, or surface
  interaction routing?

## Recommendation

Do not add a schema yet. Keep Decision Contract as docs-only vocabulary for the
next slice.

The next best step is a docs vocabulary pass that defines Decision Contract
beside recipe, playbook, workflow, work card, work record, and evidence record
without changing executable artifacts. After that, map one second candidate
outside `docs/dev/workflow-rules.json`; transfer routing or tooling-context
verification routing are the strongest options because they already combine
inputs, evidence, stop conditions, and owner/action outputs.

Only after that second mapping should Foreman consider a schema slice. If a
schema becomes warranted, start with a thin descriptor or adapter sketch around
the existing dev workflow router manifest, not a migration of
`docs/dev/workflow-rules.json` itself.
