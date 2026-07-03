# AOS Dock Inbound Message Contract v0

Dock inbound message contracts historically lived at
`.docks/<dock>/inbound-contract.json`. There are no current canonical runtime
files for this schema; `.docks/foreman/` is the only current named dock, and the
old GDI/Operator clipboard and goal-command transfer path is retired. The schema
is retained to validate historical records and prevent stale references from
being mistaken for live dock files.

The retained contract is descriptive and deterministic. It does not launch
providers, read transcripts, mutate provider stores, or write to the clipboard
by itself. Historical tools used it to preview or validate:

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
- `provider_entry_prefix` is the historical interactive provider prefix, such as
  `/goal ` for old GDI Codex work goals or an empty string for Operator
  supervised instructions.
- `allowed_payloads` lists the durable pointer or supervised instruction shapes
  expected by the dock. GDI normally prefers durable work-card or transfer
  pointers; a short inline validation-only instruction is allowed only for
  supervised live checks where reading a file before seeing the boundary would
  invalidate the check.
- `forbidden_prompt_shapes` lists prompt shapes that must be rejected when they
  violate a dock or provider boundary, or surfaced as warnings before dispatch
  when they are policy risks.
- `loop_recovery_guidance` records the deterministic recovery sequence when a
  provider loop or stale goal state is observed.

## V0 Semantics

Retired GDI/Codex used `/goal ` for interactive work-goal entry, but copied
transfer payloads remained plain pointers. A copied payload that already started
with `/goal ` could be cleaned for compatibility; that cleanup was not the
canonical payload shape.

GDI inline validation-only prompts are a narrow exception to the durable pointer
preference. They must carry their own bounded no-command instruction in the
prompt text and are for supervised live validation where the act of opening a
work-card pointer would violate the proof boundary.

Retired Operator/Codex received plain supervised instructions or durable
pointers. It did not receive GDI `/goal` prompts and did not route
implementation work or branch strategy.

Foreman/Codex receives plain successor handoff or coordination payloads.

GDI one-shot proof prompts such as `Reply exactly...` or `Reply with exactly...`
are loop-prone V0 prompt shapes because they can repeatedly satisfy a stale goal
without advancing a durable work contract. The contract surfaces those shapes as
warnings unless they also violate a true dock or provider boundary. They may be
valid when Foreman is deliberately testing the contract or live mechanics and
the prompt carries clear success and stop criteria.

Foreman routing policy, not the dock contract, decides whether GDI is the right
tool for a slice. GDI is the right target when `/goal` adds value through
autonomous iteration, verification, or durable work-card execution. Ordinary
one-shot coordination should stay with Foreman or Operator unless the one-shot
prompt is itself the object of a deliberate contract or liveness test.
