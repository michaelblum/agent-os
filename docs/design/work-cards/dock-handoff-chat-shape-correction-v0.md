# Dock Handoff Chat Shape Correction V0

**Status:** Routed 2026-05-22; amended before Implementer start 2026-05-22

## Transfer Classification

- Recipient: Implementer
- Transfer kind: correction round
- Source artifact: Foreman triage after a long Operator dispatch exceeded the
  CLI goal limit and the final chat response failed to preserve the standard
  handoff block shape.
- Required start ref: `docs/durable-agent-cognition-v0`
- Branch/output expectation: reuse the current local work surface or create a
  scoped Implementer output branch from the required start ref. Keep the checkpoint
  local; do not push, open a PR, mutate GitHub, or run live provider checks.

## Triage Findings

The repo already has centralized clipboard tooling:

- `.docks/foreman/scripts/handoff` delegates to
  `scripts/dock-handoff-clipboard`.
- `scripts/dock-handoff-clipboard` delegates to `scripts/agent-handoff`.
- `scripts/agent-handoff` copies only the raw payload and prints a gated,
  timestamped handoff block.

The regression is not that gates or timestamps disappeared from the tool. The
current tests prove they still exist:

- `tests/agent-handoff.sh`
- `tests/dock-handoff-clipboard.sh`
- `tests/foreman-handoff-wrapper.sh`

The actual gaps are:

- The dock-target wrapper accepts `--target-dock`, but the standardized
  chat-visible output does not include the recipient dock. That leaves the
  recipient line up to model memory. The implementation should add a
  `recipient` key to `scripts/agent-handoff --options-json` and have
  dock-specific wrappers pass that option, so `scripts/agent-handoff` remains
  the owner of the full chat-visible shape.
- `.docks/AGENTS.md` says agents must use the printed block in final chat, but
  there is no tool-level recipient header and no Foreman-local instruction that
  makes the final response shape hard to forget.
- Recent Foreman docs used imprecise wording around "thin" instructions. The
  real distinction is: detailed instructions may be long, but they must live in
  a Markdown file or other durable artifact; the clipboard goal prompt must stay
  under the CLI limit, currently observed at 4,000 characters.

## Goal

Make cross-session transfer formatting tool-owned and test-backed:

- Detailed transfer instructions for non-trivial Implementer or Operator rounds live in
  Markdown files or equivalent durable artifacts.
- The clipboard payload is a concise, goal-safe prompt pointing at that file.
- The chat-visible output produced by `scripts/agent-handoff` includes the
  target recipient, gated clipboard payload text, `(copied to clipboard)`, and
  a human-readable timestamp when a recipient is supplied through
  `--options-json`.

## Read First

- `.docks/AGENTS.md`
- `.docks/AGENTS.md`
- `.docks/foreman/AGENTS.md`
- `.docks/foreman/skills/session-transfer/SKILL.md`
- `.docks/foreman/skills/session-transfer/references/operator.md`
- `.docks/foreman/scripts/handoff`
- `scripts/dock-handoff-clipboard`
- `scripts/agent-handoff`
- `tests/agent-handoff.sh`
- `tests/dock-handoff-clipboard.sh`
- `tests/foreman-handoff-wrapper.sh`

## Orientation Context

The framing note
`docs/design/2026-05-22-aos-runtime-substrate-framing.md` exists on `main` as
orientation material, not as a work card or required merge target for this
round. Skim it only if a routing question comes up. The relevant design point is
that `scripts/agent-handoff` is the generic cross-session routing primitive, so
recipient-aware output should be owned there rather than baked into
`scripts/dock-handoff-clipboard`.

That same note mentions placeholder interpolation for payloads or headers as a
future shape. Do not implement interpolation in this correction unless it is the
smallest necessary way to satisfy the recipient output contract. If it surfaces
as an obvious follow-up, report it only.

## Required Behavior

Preserve this invariant:

- The system clipboard receives only the raw transfer payload.

Add or restore this centralized chat-visible shape for dock-targeted wrappers:

```text
Recipient: <dock>
----- BEGIN HANDOFF -----
<clipboard payload>
----- END HANDOFF -----

(copied to clipboard)
<human-readable local timestamp>
```

Implement this by adding a `recipient` key to
`scripts/agent-handoff --options-json`. `scripts/dock-handoff-clipboard` should
pass the target dock as that option. Do not create a separate recipient header
format owned only by `scripts/dock-handoff-clipboard`; preserve the invariant
that `scripts/agent-handoff` owns the full chat-visible handoff shape.

Preserve the existing clipboard behavior and keep formatting centralized in
scripts rather than relying on the model to reconstruct it.

Clarify docs/SOP wording:

- Do not say detailed instructions themselves need to be "thin."
- Say non-trivial transfer instructions should live in Markdown or another
  durable artifact.
- Say the copied clipboard prompt must be concise and stay under the CLI goal
  limit; use 4,000 characters as the observed upper bound.
- Say final chat responses should include the exact handoff block printed
  by the handoff tool, including recipient, gates, copy notice, and timestamp.

## Scope And Boundaries

- Do not change provider config, gateway state, dock profiles, hooks, GitHub
  state, or live runtime state.
- Do not alter clipboard payload semantics by adding recipient labels to the
  copied payload.
- Do not remove the legacy  prefix cleanup unless tests and docs make a
  deliberate replacement contract.
- Do not route or run the pending Operator live proof in this slice.
- Do not merge `main` or copy the runtime substrate framing note into this
  branch solely for this correction round.
- Do not implement placeholder interpolation as part of this round unless the
  final solution cannot stay smaller without it.

## Verification

Required:

```bash
bash tests/agent-handoff.sh
bash tests/dock-handoff-clipboard.sh
bash tests/foreman-handoff-wrapper.sh
git diff --check
./aos dev recommend --json
```

If `./aos dev recommend --json` recommends additional focused shell tests for
changed files, run the bounded relevant ones or explain why the three handoff
tests above cover the delta.

## Completion Report

Report:

- branch and head SHA;
- files changed;
- exact final chat-visible output shape now produced for each target dock;
- confirmation that clipboard contents remain raw payload only;
- exact verification commands and results;
- any remaining Foreman/operator SOP ambiguity.
- whether placeholder interpolation should be routed later, if the implemented
  recipient support exposes a concrete need for it.
