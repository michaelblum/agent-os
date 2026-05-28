# AOS UX Tree V0

`aos_ux_tree` is the first canonical data shape for inspectable UX
affordances. It represents interface nodes, mode-scoped gesture bindings,
allowlisted command references, and plain JSON settings without changing runtime
behavior by itself.

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
- `settings`: plain JSON subtrees for radial geometry, radial menu config,
  visual overlays, and future override patches.
- `metadata`: producer/runtime notes.

## Safety Rules

Commands are not executable code. A command carries a `handler_ref` string that
an execution adapter may later map to an allowlisted runtime function. Settings
and parameters are plain JSON. Asset-like values must be refs, not embedded
binary or `data:` payloads.

Bindings reference known node and command IDs. The JSON Schema covers the
structural contract; `resolveUxTree()` additionally reports invalid references
in `validation.errors` and can throw in strict mode.
