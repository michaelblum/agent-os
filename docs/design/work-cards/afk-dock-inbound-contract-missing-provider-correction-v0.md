# AFK Dock Inbound Contract Missing Provider Correction v0

## Recipient

GDI

## Transfer Kind

Correction round

## Goal

Prevent missing dock inbound provider declarations from crashing AFK prompt
construction before existing structured guard receipts can run.

The prior slice is directionally right: AFK prompt construction should use the
dock inbound message contract. The correction is about error containment and
receipt shape when the selected provider is supported by the prototype but not
declared by the target dock inbound contract.

## Branch / Base

- branch_from: `gdi/afk-dock-inbound-contract-prompt-source-v0`
- required_start_ref:
  `gdi/afk-dock-inbound-contract-prompt-source-v0` at
  `ceaf38ef267c20b1f8f3ffd6d4db39a8d7ca64ad`
- expected_output_branch:
  `gdi/afk-dock-inbound-contract-missing-provider-correction-v0`

## Review Finding

`scripts/afk-launch-attempt-prototype.mjs:426` now calls
`validateDockInboundMessage()` for any `SUPPORTED_PROVIDERS` provider/dock when
`repoRoot` is present. Current dock inbound contracts only declare `codex`.

That means a supported non-Codex provider such as `claude` with the `operator`
dock throws:

```text
provider claude is not declared by .docks/operator/inbound-contract.json
```

In a CLI path such as `--provider claude --dock operator --json`, this bypasses
the established structured guard receipt and returns a failed envelope on
stderr. The existing guard logic should still be the thing that classifies
unsupported-for-live or unsupported-for-mode combinations.

## Required Behavior

Keep the accepted behavior:

- Codex/GDI prompt construction uses `.docks/gdi/inbound-contract.json`.
- Codex/GDI receipts preserve `provider_prompt_mode=codex_goal` and
  `provider_prompt_prefix="/goal "`.
- Operator/Codex remains plain with empty prefix.
- GDI contract-declared self-acceptance errors still block before typed input.
- Contract warnings remain visible and non-blocking.

Fix the missing-provider path:

- A missing provider declaration in a dock inbound contract must not escape as
  an uncaught exception from `buildLiveProviderPrompt()` or
  `buildAttemptContext()`.
- Preserve structured evidence in the prompt profile or validation record. A
  diagnostic code such as `dock_inbound_provider_not_declared` is fine.
- Existing guard receipts should retain their normal JSON shape and lifecycle
  classification.
- Do not add full Claude/Gemini dock inbound provider contracts in this slice
  unless the local code already has an obvious minimal contract fixture pattern.
  The goal is containment, not provider expansion.

## Tests

Add or update focused tests proving:

- `buildLiveProviderPrompt({ repoRoot, selectedProvider: "claude",
  selectedDock: "operator", ... })` does not throw.
- A launch/session path that uses `--provider claude --dock operator` still
  returns the existing structured guard receipt instead of a failed uncaught
  contract exception.
- Codex/GDI contract-backed prompt tests still pass.
- Contract-declared GDI self-acceptance errors still block before bridge typing.

Run:

```bash
./aos ready
node --test tests/schemas/aos-dock-inbound-message-contract-v0.test.mjs
node --test tests/afk-launch-attempt-prototype.test.mjs
node --test tests/afk-session-trigger-prototype.test.mjs
bash tests/dock-handoff-clipboard.sh
git diff --check
```

If `./aos ready` reports a repo-mode permission blocker, use the standard GDI
human-needed path and stop instead of routing around it:

```bash
.docks/gdi/scripts/human-needed-tcc-reset
./aos ready --post-permission
```

## Boundaries

- Do not drive real dock terminals.
- Do not launch live providers.
- Do not read provider transcript bodies.
- Do not mutate provider stores, catalogs, telemetry, gateway/dock runtime, or
  Codex configuration.
- Do not start async result routing.
- Do not create PRs, mutate GitHub issues, merge to main, or mutate main.
- Do not route Operator live proof in this slice.

## Completion Report

Report:

- branch and head SHA
- base SHA
- changed files
- exact missing-provider behavior chosen
- verification commands and results
- any remaining risk or follow-up
- statement confirming the boundaries above were respected
