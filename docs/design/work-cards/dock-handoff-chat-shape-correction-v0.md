# Dock Handoff Chat Shape Correction V0

**Status:** Routed 2026-05-22

## Transfer Classification

- Recipient: GDI
- Transfer kind: correction round
- Source artifact: Foreman triage after a long Operator dispatch exceeded the
  CLI goal limit and the final chat response failed to preserve the standard
  handoff block shape.
- Required start ref: `docs/durable-agent-cognition-v0`
- Branch/output expectation: reuse the current local work surface or create a
  scoped GDI output branch from the required start ref. Keep the checkpoint
  local; do not push, open a PR, mutate GitHub, or run live provider checks.

## Triage Findings

The repo already has centralized clipboard tooling:

- `.docks/foreman/scripts/handoff` delegates to
  `scripts/dock-handoff-clipboard`.
- `scripts/dock-handoff-clipboard` delegates to `scripts/agent-handoff`.
- `scripts/agent-handoff` copies only the raw payload and prints a gated,
  timestamped chat-visible block.

The regression is not that gates or timestamps disappeared from the tool. The
current tests prove they still exist:

- `tests/agent-handoff.sh`
- `tests/dock-handoff-clipboard.sh`
- `tests/foreman-handoff-wrapper.sh`

The actual gaps are:

- The dock-target wrapper accepts `--target-dock`, but the standardized
  chat-visible output does not include the recipient dock. That leaves the
  recipient line up to model memory.
- `.docks/AGENTS.md` says agents must use the printed block in final chat, but
  there is no tool-level recipient header and no Foreman-local instruction that
  makes the final response shape hard to forget.
- Recent Foreman docs used imprecise wording around "thin" instructions. The
  real distinction is: detailed instructions may be long, but they must live in
  a Markdown file or other durable artifact; the clipboard goal prompt must stay
  under the CLI limit, currently observed at 4,000 characters.

## Goal

Make cross-session transfer formatting tool-owned and test-backed:

- Detailed transfer instructions for non-trivial GDI or Operator rounds live in
  Markdown files or equivalent durable artifacts.
- The clipboard payload is a concise, goal-safe prompt pointing at that file.
- The chat-visible output produced by dock handoff tooling includes the target
  recipient, gated clipboard payload text, `(copied to clipboard)`, and a
  human-readable timestamp.

## Read First

- `.docks/AGENTS.md`
- `.docks/README.md`
- `.docks/foreman/AGENTS.md`
- `.docks/foreman/skills/session-transfer/SKILL.md`
- `.docks/foreman/skills/session-transfer/references/operator.md`
- `.docks/foreman/scripts/handoff`
- `scripts/dock-handoff-clipboard`
- `scripts/agent-handoff`
- `tests/agent-handoff.sh`
- `tests/dock-handoff-clipboard.sh`
- `tests/foreman-handoff-wrapper.sh`

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

It is acceptable for `scripts/agent-handoff` to remain target-agnostic if
`scripts/dock-handoff-clipboard` owns the recipient header. It is also
acceptable to add a general option to `scripts/agent-handoff` if that produces a
cleaner contract. In either case, preserve the existing clipboard behavior and
keep formatting centralized in scripts rather than relying on the model to
reconstruct it.

Clarify docs/SOP wording:

- Do not say detailed instructions themselves need to be "thin."
- Say non-trivial transfer instructions should live in Markdown or another
  durable artifact.
- Say the copied clipboard prompt must be concise and stay under the CLI goal
  limit; use 4,000 characters as the observed upper bound.
- Say final chat responses should include the exact chat-visible block printed
  by the handoff tool, including recipient, gates, copy notice, and timestamp.

## Scope And Boundaries

- Do not change provider config, gateway state, dock profiles, hooks, GitHub
  state, or live runtime state.
- Do not alter clipboard payload semantics by adding recipient labels to the
  copied payload.
- Do not remove the legacy `/goal ` prefix cleanup unless tests and docs make a
  deliberate replacement contract.
- Do not route or run the pending Operator live proof in this slice.

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
