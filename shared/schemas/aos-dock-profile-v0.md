# AOS Dock Profile v0

Dock profiles are the machine-readable seed for `.docks/<dock>/dock.json`.
They describe the durable session role, default entry path, and capability
envelope for a docked agent session.

The profile is intentionally descriptive. It does not grant permissions,
execute commands, or replace the human/model operating contract in
`AGENTS.md`. It gives AOS and agents a stable way to answer: "who is this dock,
what path does it start from, and which capability classes are in-bounds when
the task explicitly calls for them?"

## Fields

- `name` is the dock directory identity, such as `foreman`, `gdi`, or
  `operator`.
- `role` is the durable authority boundary used by capability manifests.
- `default_entry_path` is the entry path assumed before the task asks for a
  deeper layer.
- `allowed_entry_paths` is the bounded set the dock may move through when the
  task justifies it.
- `capability_manifest` points to the capability vocabulary, currently
  `docs/dev/agent-capabilities.json`.
- `allowed_capability_classes` is a coarse envelope over mutability classes.
- `allowed_capabilities` is an optional fine-grained allowlist for named
  capabilities in the manifest.
- `requires_explicit_assignment_for` records classes that should not be treated
  as ambient even when they are inside the dock envelope.

Use `./aos dev docks explain <dock> --json` to inspect a profile and
`./aos dev docks capabilities <dock> --json` to resolve the profile against the
canonical capability manifest.
