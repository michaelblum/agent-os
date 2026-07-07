# AOS Dock Profile v0

Dock profiles were the machine-readable seed for historical
`.docks/<dock>/dock.json` files. They are retained for old fixtures and
migration context only. Do not add new canonical dock profiles under the active
repo tree.

The profile shape is intentionally descriptive. It does not grant permissions,
execute commands, select project-agent roles, or replace the human/model
operating contract in `AGENTS.md`.

## Fields

- `name` is the historical dock directory identity.
- `role` is the historical authority boundary used by old capability manifests.
- `default_entry_path` is the compatibility field for the default capability
  route assumed before the task asks for a deeper route.
- `allowed_entry_paths` is the compatibility field for the bounded set of
  capability routes the dock may move through when the task justifies it.
- `capability_manifest` points to the capability vocabulary, currently
  `docs/dev/agent-capabilities.json`.
- `allowed_capability_classes` is a coarse envelope over mutability classes.
- `allowed_capabilities` is an optional fine-grained allowlist for named
  capabilities in the manifest.
- `requires_explicit_assignment_for` records classes that should not be treated
  as ambient even when they are inside the dock envelope.
- `metadata.execution_topology` may record how the historical dock normally ran.
- `metadata.agent_runner_team` may record an old AOS-owned runner roster.
- `metadata.agent_runner_team.model_policy` records whether provider role
  material must declare its own model and reasoning effort. Child runs should
  not inherit Foreman's expensive coordination model/effort by default.
- `metadata.normal_launch_root` records whether a human historically started
  Codex from that dock directory.

There is no current `./aos dev docks` command. Historical profiles can be
validated through this schema and fixture tests only.
