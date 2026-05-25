# Docks

Docks are the normal way to run agent sessions in this repo. A dock is a
repo-local Codex session root for a durable role: instructions, config, hooks,
inbound message contracts, and stop behavior live with the dock instead of in
the root `AGENTS.md`.

A dock is not a Workflow. A Workflow is an AOS/domain Subject such as the
Employer Brand Comparative Audit. A dock is only the session boundary that
selects role-local instructions and harness behavior.

## Launch

Start local Codex sessions from the dock directory:

```bash
cd .docks/gdi
codex
```

Equivalent:

```bash
codex --cd .docks/gdi
```

Codex discovers the dock's `AGENTS.md`, `.codex/config.toml`,
`.codex/hooks.json`, and local hook scripts from that launch root. Source edits
and tests still belong in `/Users/Michael/Code/agent-os` unless the dock task
explicitly targets dock configuration or harness files.

Remote or undocked agents cannot inherit the launch root automatically. They
should adopt the requested dock persona explicitly, read shared
`.docks/AGENTS.md`, then read the role-local `.docks/<dock>/AGENTS.md`. If no
role is named and the task is coordination, review, routing, or git/GitHub
hygiene, use Foreman.

## Instruction Ownership

The active instruction ladder for docked sessions is:

1. root `AGENTS.md` for repo-wide signage and invariants;
2. shared `.docks/AGENTS.md` for common docked-session contracts;
3. role-local `.docks/<dock>/AGENTS.md` for authority, transfer, and stop
   conditions.

Keep common docked-session behavior in `.docks/AGENTS.md`. Keep role files
focused on that role's authority. Keep procedures that are repeatable across
roles in `docs/recipes/`.

Docks do not select the active development workflow profile. Resolve git,
branch, PR, review, and merge posture from `docs/dev/active-profile.json` and
`docs/dev/workflow-profiles.json`, then apply any explicit user override that
is safe for the current session.

## Harness Ownership

Hook mechanics are code-owned. Do not duplicate hook behavior as long-form
markdown instructions.

- `.docks/<dock>/.codex/hooks.json` declares provider hook entry points.
- `.docks/<dock>/hooks/*.sh` are thin role-local wrappers.
- `.docks/harness/*.sh` owns shared hook behavior such as build checkpoint
  pauses, short-lived stop conditions, human-needed surfaces, and stop notices.
- `.docks/<dock>/dock.json` and `.docks/dock-defaults.json` own dock metadata,
  capability envelopes, and voice policy.
- `.docks/<dock>/inbound-contract.json` owns provider-specific entry syntax,
  reset semantics, allowed payload shapes, and rejected prompt shapes.

Use the scripts and JSON files as the source of truth when hook behavior,
provider entry, or dock metadata changes. Markdown should explain ownership and
link to the owning surface, not mirror the implementation.

Inspect profiles with:

```bash
./aos dev docks list --json
./aos dev docks explain foreman --json
./aos dev docks capabilities gdi --json
```

## Transfers

Use precise transfer language so dock roles do not inherit the wrong workflow.

- **Handoff** is successor-session state.
- **Dispatch** is the concise payload that starts a target dock on an existing
  artifact.
- **Work card** is a durable Markdown task contract for an assigned round.
- **Round** is one recipient session's attempt at one goal.
- **Relay** is a GitHub-visible branch/report exchange.

For cross-session clipboard payloads, use the repo handoff tools instead of
letting hooks infer payloads from chat text:

```bash
scripts/agent-handoff --text "$transfer_payload" --options-json '{"timestamp":true,"gateStringStart":"----- BEGIN HANDOFF -----","gateStringEnd":"----- END HANDOFF -----","addPostInstructions":"(copied to clipboard)","addHRTimestamp":true}'

printf '%s' "$transfer_payload" | scripts/dock-handoff-clipboard --target-dock gdi
printf '%s' "$transfer_payload" | scripts/dock-handoff-clipboard --target-dock foreman
printf '%s' "$transfer_payload" | scripts/dock-handoff-clipboard --target-dock operator
```

Choose durable storage by transfer kind:

| Transfer kind | Normal storage |
| --- | --- |
| Foreman successor handoff | Clipboard/chat or a temp file from `mktemp -t foreman-handoff-XXXXXX.md`; do not commit it. |
| GDI work card | `docs/design/work-cards/<card>.md`, with a concise dispatch pointing at the card. |
| Operator run | Clipboard/chat unless a durable capture plan is explicitly needed. |
| Human-needed packet | Clipboard/chat unless the recovery path should become reusable SOP. |

Do not store successor-Foreman handoffs under `docs/design/work-cards/`. If a
handoff needs durable follow-up, create a separate work card, issue, PR comment,
or design note and reference it from the handoff.

## Canonical Docks

- `foreman/` coordinates work, reviews completion reports, writes/routes work
  cards, and owns git/GitHub hygiene by default.
- `gdi/` performs assigned deterministic implementation or validation rounds
  and reports exact evidence. It does not own next-work selection, PRs, issues,
  or branch hygiene unless the goal explicitly assigns that work.
- `operator/` performs bounded supervised human-in-the-loop evidence collection
  and locator review. It does not own implementation or git/GitHub scope unless
  the transfer explicitly assigns that responsibility.

For non-trivial GDI work, Foreman should prefer a Markdown work card under
`docs/design/work-cards/` plus a concise dispatch:

```text
follow the instructions in docs/design/work-cards/<card>.md
```
