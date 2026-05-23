# AOS Dock Inbound Message Contract Policy Split v0

## Recipient

GDI

## Transfer Kind

Correction round

## Goal

Refine the AOS dock inbound message contract so the contract owns provider and
dock mechanics while Foreman routing policy owns the judgment of when GDI is the
right tool.

The previous slice is useful and accepted as the foundation. The correction is
that `reply exactly` or similarly trivial goals should not be categorically
invalid just because they are trivial. They can be valid when the goal has clear
success and stop criteria, especially for deliberate contract or liveness tests.

## Branch / Base

- branch_from: current local `gdi/aos-dock-inbound-message-contract-v0` routing head
- required_start_ref: current local `gdi/aos-dock-inbound-message-contract-v0` routing head
- accepted_source_head: `64764f19d38e3f4a5e1c5c70acc186dd4bb554e2`
- expected_output_branch: `gdi/aos-dock-inbound-message-contract-policy-split-v0`

## Read First

- `.docks/gdi/inbound-contract.json`
- `.docks/foreman/AGENTS.md`
- `scripts/dock-inbound-message-contract`
- `scripts/dock-handoff-clipboard`
- `shared/schemas/aos-dock-inbound-message-contract-v0.md`
- `tests/schemas/aos-dock-inbound-message-contract-v0.test.mjs`
- `tests/dock-handoff-clipboard.sh`

## Required Behavior

Preserve the useful parts of the current implementation:

- GDI clipboard payloads stay plain and preview as `/goal <payload>`.
- Accidental GDI `/goal ` clipboard prefixes are cleaned as compatibility.
- Operator payloads stay plain with no `/goal` prefix.
- Dock-local contracts remain separate V0 contract artifacts, not dock profile
  schema changes unless a small compatibility edit is truly needed.

Adjust the over-broad part:

- Do not make every GDI `reply exactly` or `proof only` prompt a hard contract
  error solely because it is trivial.
- Treat loop-prone one-shot GDI prompt shapes as visible warnings or policy
  diagnostics unless they violate a real dock/protocol boundary.
- Keep true boundary violations as hard errors, for example GDI being asked to
  self-accept architecture, product, or branch-strategy decisions if that is
  still the clearest local boundary.
- Ensure `dock-handoff-clipboard` does not silently swallow non-error
  diagnostics. Warnings should be visible to Foreman during dispatch output
  while still allowing clipboard copy when the contract result is otherwise OK.

Clarify policy/prose:

- The dock contract defines valid goal message shape, reset semantics, stop
  conditions, evidence/reporting expectations, and provider-specific mechanics.
- Foreman policy decides when GDI is the right tool.
- Foreman should use GDI when `/goal` adds value through autonomous iteration,
  verification, or durable work-card execution.
- Foreman should avoid GDI for ordinary one-shot coordination unless the slice
  is deliberately testing the contract or live mechanics.

## Tests

Update or add focused tests proving:

- Valid GDI transfer packet and work-card pointers still format as plain
  clipboard payloads with `/goal ` provider previews.
- A GDI one-shot `Reply with exactly...` prompt is no longer blanket-rejected
  solely for that wording; it produces a visible warning/policy diagnostic or is
  accepted when it includes clear success/stop criteria.
- A truly invalid GDI boundary violation is still rejected.
- Operator pointer payloads stay plain.
- `dock-handoff-clipboard` surfaces non-error diagnostics.

Run:

```bash
node --test tests/schemas/aos-dock-inbound-message-contract-v0.test.mjs
node --test tests/schemas/aos-dock-profile-v0.test.mjs
bash tests/agent-handoff.sh
bash tests/dock-handoff-clipboard.sh
git diff --check
```

## Boundaries

- Do not drive real dock terminals.
- Do not launch live providers.
- Do not read provider transcript bodies.
- Do not mutate provider stores, catalogs, telemetry, gateway/dock runtime, or
  Codex configuration.
- Do not start async result routing.
- Do not create PRs, mutate GitHub issues, merge to main, or mutate main.

## Completion Report

Report:

- branch and head SHA
- base SHA
- changed files
- policy/contract boundary chosen
- verification commands and results
- any remaining risk or follow-up
- statement confirming the boundaries above were respected
