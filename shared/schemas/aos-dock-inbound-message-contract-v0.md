# AOS Dock Inbound Message Contract v0

Dock inbound message contracts live at `.docks/<dock>/inbound-contract.json`.
They describe how a target dock wants a provider-specific inbound message to be
formatted without making Foreman, Operator, or another sender hardcode provider
slash syntax.

The contract is descriptive and deterministic. It does not launch providers,
read transcripts, mutate provider stores, or write to the clipboard by itself.
Tools may use it to preview or validate:

```text
target dock + provider + payload -> clipboard payload + provider entry preview + validation
```

## Fields

- `dock` and `role` identify the receiving dock.
- `providers` maps provider keys, initially `codex`, to provider-specific entry
  rules.
- `context_reset_command` is the provider command for a fresh context, such as
  `/clear`.
- `stale_goal_recovery_command` is the provider command for clearing stale goal
  state, such as `/goal clear`, or `null` when the dock does not use goal mode.
- `clipboard_payload_policy` declares that copied transfer payloads stay plain.
- `provider_entry_prefix` is the interactive provider prefix, such as `/goal `
  for GDI Codex work goals or an empty string for Operator supervised
  instructions.
- `allowed_payloads` lists the durable pointer or supervised instruction shapes
  expected by the dock.
- `forbidden_prompt_shapes` lists prompt shapes that must be rejected or
  surfaced as warnings before dispatch.
- `loop_recovery_guidance` records the deterministic recovery sequence when a
  provider loop or stale goal state is observed.

## V0 Semantics

GDI/Codex uses `/goal ` for interactive work-goal entry, but copied transfer
payloads remain plain pointers. A copied payload that already starts with
`/goal ` may be cleaned for compatibility; that cleanup is not the canonical
payload shape.

Operator/Codex receives plain supervised instructions or durable pointers. It
does not receive GDI `/goal` prompts and does not route implementation work or
branch strategy.

Foreman/Codex receives plain successor handoff or coordination payloads.

GDI one-shot proof prompts such as `Reply exactly...` or `Reply with exactly...`
are a forbidden V0 prompt shape because they can repeatedly satisfy a stale
goal without advancing a durable work contract.
