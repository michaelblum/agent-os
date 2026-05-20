---
name: foreman-session-transfer
description: Use when Foreman creates, revises, or copies any artifact that transfers work or context to another session or role: GDI work cards, Operator runs, successor-Foreman handoffs, relay packets, correction rounds, review rounds, or human-needed blocker packets. Classifies the transfer first, loads only the recipient-specific reference needed, and prevents successor-handoff instructions from being reused for GDI work.
argument-hint: "Recipient and transfer purpose"
---

# Foreman Session Transfer

Use this skill before Foreman creates or revises a transfer artifact. A transfer
artifact is anything meant to let another session act without rereading the
current chat: work cards, clipboard dispatches, successor handoffs, operator
runs, relay packets, correction rounds, and human-needed blocker packets.

## Classify First

Name the transfer kind before writing:

- **Successor handoff:** Foreman to Foreman state compression. Use
  `../session-handoff/skill.md`; do not write GDI work cards from that skill.
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
- **Work card:** durable Markdown task contract, usually for GDI.
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

## Output Discipline

Keep clipboard dispatches thin. Put durable task detail in the referenced work
card or issue. Put successor-Foreman state in the successor handoff. Do not use
the successor handoff skill to author recipient work.
