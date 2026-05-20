---
name: foreman-session-transfer
description: The only Foreman skill entrypoint for creating, revising, or copying transfer artifacts to another session or role: GDI work cards, Operator runs, successor-Foreman handoffs, relay packets, correction rounds, review rounds, or human-needed blocker packets. Always classify the transfer first, then load only the recipient-specific reference needed; successor handoff generation is handled through references/foreman.md, not by a separate session-handoff skill.
argument-hint: "Recipient and transfer purpose"
---

# Foreman Session Transfer

Use this skill before Foreman creates or revises a transfer artifact. A transfer
artifact is anything meant to let another session act without rereading the
current chat: work cards, clipboard dispatches, successor handoffs, operator
runs, relay packets, correction rounds, and human-needed blocker packets.

This is the only routable Foreman transfer skill. There is no separate
`foreman-session-handoff` skill entrypoint; successor handoffs are the Foreman
recipient kind inside this workflow and use `references/foreman.md`.

## Classify First

Name the transfer kind before writing:

- **Successor handoff:** Foreman-to-Foreman state compression. Read
  `references/foreman.md`; do not create, update, or commit a work card for
  successor continuity.
- **GDI round:** one GDI session, one deterministic goal, ending in completion,
  failure, or stall. Read `references/gdi.md`.
- **Operator run:** supervised live/HITL observation or action. Read
  `references/operator.md`.
- **Relay packet:** remote/GitHub-visible branch/report exchange under a relay
  profile. Treat this as a GDI or Foreman transfer with explicit remote-visible
  evidence and local-only caveats.
- **Correction round:** a bounded follow-up to fix a specific rejected or
  incomplete slice. Prefer the same recipient only when context reuse helps and
  scope is narrow.
- **Human-needed packet:** a stall transfer whose next actor is the human.
  State the exact blocker and the bounded recovery command path.

## Terms

- **Transfer:** umbrella term for moving actionable context across sessions.
- **Dispatch:** the short clipboard payload that starts a dock session.
- **Work card:** durable Markdown task contract for a GDI/correction/relay
  round; never a successor-Foreman handoff.
- **Round:** one recipient session's attempt at one goal.
- **Handoff:** reserve for successor session state transfer, especially
  Foreman-to-Foreman.
- **Relay:** GitHub-visible review/execution exchange, not a synonym for every
  handoff.
- **Stall:** the round cannot continue without human input, external
  credentials, permission repair, or product direction.

## Universal Transfer Header

Every non-trivial transfer must make these facts explicit in either the work
card or the dispatch:

- recipient dock or actor;
- transfer kind;
- single goal for the next round;
- source artifact path or issue/PR/commit that owns the work;
- required start ref when it is not `origin/main`;
- branch/output expectations;
- stop conditions: done, failed, stalled, or human-needed;
- evidence the recipient should produce.

Bad assumption checks:

- A clean `git status` means no local dirty files; it does not mean the branch
  is the right base.
- Router "changed files" counts often mean branch diff against a base, not a
  dirty worktree.
- A work card or report that exists only on a feature branch requires
  `branch_from` or `required_start_ref`; do not let GDI reset to `origin/main`
  and lose the instructions.
- A `gdi/*` branch can be either an output branch or a work surface. Say which.
- Do not rely on inherited chat memory for branch/base facts. Put them in the
  artifact.

## Placement Matrix

Use path and storage as part of the contract:

| Transfer kind | Durable Markdown home | Clipboard/chat payload |
| --- | --- | --- |
| Successor handoff | Temporary `mktemp -t foreman-handoff-XXXXXX.md` file only, unless the user requests chat-only. Do not commit it. | Full compact handoff via `.docks/foreman/scripts/handoff --target-dock foreman` when another session should start from it. |
| GDI round | `docs/design/work-cards/<card>.md` for non-trivial implementation or validation contracts. | Thin dispatch: `follow the instructions in docs/design/work-cards/<card>.md`. |
| Operator run | Usually no durable Markdown. Use a design note or capture plan only when the evidence plan must persist. | Concrete supervised run instructions. |
| Relay packet | GitHub-visible issue, PR, branch report, or explicitly named durable artifact. | The minimal pointer needed to start the relay. |
| Human-needed packet | Usually chat and clipboard only. Durable docs only when the recovery path becomes reusable SOP. | Exact blocker and bounded recovery command path. |

If a successor-Foreman handoff appears under `docs/design/work-cards/`, treat it
as misplaced session state. Move it to a temp/chat handoff or delete it before
committing unless the human explicitly asks to convert it into a real GDI work
card with a GDI round contract.

## Output Discipline

Keep clipboard dispatches thin. Put durable task detail in the referenced work
card or issue. Put successor-Foreman state in the successor handoff, not in
`docs/design/work-cards/`. Do not use successor handoff content to author
recipient work without first reclassifying it as a GDI, Operator, relay,
correction, or human-needed transfer.
