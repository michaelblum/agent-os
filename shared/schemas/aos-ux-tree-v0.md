# AOS UX Tree V0

`aos_ux_tree` is the first canonical data shape for inspectable UX
affordances. It represents interface nodes, mode-scoped gesture bindings,
generic node relationships, allowlisted command references, and plain JSON
settings without changing runtime behavior by itself.

The intended flow is:

```text
normalized input event
  -> gesture recognition
  -> UX tree node / mode scope
  -> binding lookup
  -> allowlisted command
  -> existing runtime function
```

V0 is read-only and shadow-resolved. Producers can expose current behavior as
data, and tests can prove that a normalized event would map to the same command
the handwritten router already follows. Execution adapters, user overrides, and
persistence are future cutover work.

## Required Top-Level Fields

- `schema`: always `aos_ux_tree`.
- `version`: semantic V0 contract version, currently `0.1.0`.
- `id`, `label`, `owner`: stable identity and ownership.
- `source_refs`: files, URLs, or resource refs used to build the tree.
- `modes`: named mode scopes such as `global`, `goto`, `radial`, and
  `selection_mode`.
- `nodes`: addressable UI affordances.
- `commands`: declarative references to allowlisted handlers.
- `bindings`: gesture-to-command links scoped by node and mode.
- `relations`: generic topology and behavior links between nodes.
- `settings`: plain JSON subtrees for radial geometry, radial menu config,
  visual overlays, and future override patches.
- `metadata`: producer/runtime notes.

## Relations

`relations[]` captures behavior and topology that is not pure containment.
`parent_id` and `children` remain the structural hierarchy; relations describe
how one node triggers, opens, anchors, targets, or owns another node without
implying that a canvas or input region is the conceptual owner.

Each relation has a stable `id`, `relation_type`, `from_node_id`, `to_node_id`,
optional `source_metadata`, and optional `metadata`. The V0 relation vocabulary
is:

- `triggers`: a source node can start behavior associated with another node.
- `opens`: a source node opens another UX node or surface.
- `anchors`: a source node provides placement/topology anchoring for another
  node.
- `targets`: a source node exposes concrete or collection target surfaces used
  for hit testing, input routing, or accessibility.
- `owns`: a generic ownership relation for cases that are conceptual ownership,
  not merely canvas containment.

Concrete `from_node_id` and `to_node_id` values are validated against known
nodes. V0 also allows documented collection targets ending in `.*`, such as
`sigil.avatar.radial_menu.item.*`, only on `targets` relations. Implementation
surfaces and canvas/input-region identifiers belong in plain JSON relation
metadata, for example under `metadata.target_surface`, rather than in
avatar-specific schema fields.

## Safety Rules

Commands are not executable code. A command carries a `handler_ref` string that
an execution adapter may later map to an allowlisted runtime function. Settings
and parameters are plain JSON. Asset-like values must be refs, not embedded
binary, `data:`, or `blob:` payloads.

Bindings reference known node and command IDs. Relations reference known
concrete node IDs, with the documented V0 exception for `targets` collection
refs ending in `.*`. The JSON Schema covers the structural contract;
`resolveUxTree()` additionally reports invalid references in
`validation.errors` and can throw in strict mode.
