# AOS Subject Capabilities

Status: v-next registry sketch. The live `aos.workbench.subject` JSON Schema is
still `2026-05-03`; this document defines the target vocabulary for the schema
design pass and migration.

## Purpose

`capabilities[]` on an `aos.workbench.subject` names high-level contracts that a
consumer can negotiate against. A Capability is not a button label, not a Facet
name, and not an event or operation string. It tells a Subject Browser,
verifier, replay harness, exporter, or editor shell which behavior class the
Subject promises to implement.

Concrete projections live in `facets[]`. Concrete commands, events, and patch
messages live in operation contracts, proposed as `contracts[]` in the v-next
subject shape.

## V0 Capabilities

| Capability | Contract |
| --- | --- |
| `inspectable` | The Subject can be opened read-only by a Subject Browser. It has stable identity, label, `subject_type`, and at least one Facet or legacy view that exposes narrative, descriptor, artifact, or health information. |
| `editable` | The Subject has at least one controls/editor Facet plus a persistence or patch path. Consumers must inspect `contracts[]`, Facet-local contracts, or `persistence` before attempting a save or patch. |
| `verifier-target` | The Subject exposes enough health, evidence, claims, postconditions, or verifier metadata for a verifier to evaluate it. For Work Records, verifier output should be expressed as Claim Results plus Verifier Health. |
| `replayable` | The Subject has execution knowledge that can be re-run under policy: a Playbook, Workflow, source-backed Recipe, or repairable Work Record execution map. Consumers must check origin, preconditions, and allowed tools before replay. |
| `exportable` | The Subject exposes serializable artifacts or bundles through an artifacts/evidence Facet or artifact registry. Consumers must use the advertised artifact contract rather than scraping rendered UI. |

`navigable` is intentionally not a v0 Capability. Being an
`aos.workbench.subject` already means a Subject Browser may open it unless
policy or permissions say otherwise.

## Operation Contracts

Operation contracts are narrower than Capabilities. They name specific message,
event, patch, or invocation shapes that a Subject or Facet supports.

Examples currently found in descriptors include:

- `markdown_document.text.patch`
- `wiki.invoke`
- `workflow.project`
- `work_record.execution_map.edit`
- `canvas_object.transform.patch`
- `canvas_object.effects.patch`
- `sigil.radial_item_editor.lock_in`

The v-next direction is to store these strings in `contracts[]`, while leaving
`capabilities[]` for the high-level vocabulary above.

```json
{
  "capabilities": ["inspectable", "editable"],
  "contracts": [
    "markdown_document.text.patch",
    "wiki.invoke"
  ]
}
```

Facet-local contracts should be used when only one projection supports the
operation:

```json
{
  "facets": [
    {
      "key": "markdown-source",
      "layer": "controls",
      "contracts": ["markdown_document.text.patch"]
    }
  ]
}
```

## Migration Rules

The current `2026-05-03` schema accepts optional `contracts[]`, `facets[]`, and
`subject_references[]` while preserving `capabilities[]`, `views[]`, and
`controls[]`. During migration:

1. Keep accepting existing dotted strings in `capabilities[]`.
2. Add high-level Capability strings in a backward-compatible way.
3. Add optional `contracts[]` in the v-next schema sketch and helpers.
4. For migrated writer helpers, stop duplicating dotted operation/event strings
   in raw `capabilities[]`; emit them through top-level and Facet-local
   `contracts[]` while keeping reader fallback through `subjectContracts()`.
5. Treat `views[]` and `controls[]` as legacy summaries derived from Facets,
   Capabilities, and operation contracts.

## Adding A Capability

Add a new Capability only when a consumer can bind to a reusable contract across
Subject types. Prefer an operation contract when the behavior is just one
message or patch shape. Prefer a Facet when the question is "what can I open?"

Each new Capability should define:

- the behavior class it promises;
- the minimum descriptor fields or Facets required;
- the policy checks a consumer must perform before acting;
- how failures or unsupported cases are reported.
