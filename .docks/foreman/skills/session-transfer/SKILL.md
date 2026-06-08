---
name: Foreman transfer guidance
description: The only Foreman skill entrypoint for creating, revising, or copying transfer artifacts to another session or role: Implementer work cards, Operator runs, successor-Foreman handoffs, relay exchanges, correction rounds, review rounds, or manual-intervention blocker packets. Always classify the transfer first, then load only the recipient-specific reference needed; successor handoff generation is handled through references/foreman.md, not by a separate session-handoff skill.
argument-hint: "Recipient and transfer purpose"
---

# Foreman Session Transfer

Use this skill before Foreman creates or revises a transfer artifact. A transfer
artifact is anything meant to let another session act without rereading the
current chat: work cards, native dispatches, successor handoffs, operator
runs, relay exchanges, correction rounds, and manual-intervention blocker packets.

This is the only routable Foreman transfer skill. There is no separate
`foreman-session-handoff` skill entrypoint; successor handoffs are the Foreman
recipient kind inside this workflow and use `references/foreman.md`.

## Classify First

Name the transfer kind before writing:

- **Successor handoff:** Foreman-to-Foreman state compression. Read
  `references/foreman.md`; do not create, update, or commit a work card for
  successor continuity.
- **Implementer round:** one Implementer session, one deterministic goal, ending in completion,
  failure, or stall. Read `references/implementer.md`.
- **Operator run:** supervised live/HITL observation or action. Read
  `references/operator.md`.
- **Relay exchange:** remote/GitHub-visible branch/report exchange under a relay
  profile. Treat this as a Implementer or Foreman transfer with explicit remote-visible
  evidence and local-only caveats.
- **Correction round:** a bounded follow-up to fix a specific rejected or
  incomplete slice. Prefer the same recipient only when context reuse helps and
  scope is narrow.
- **Manual-intervention packet:** a stall transfer whose next actor is the human.
  State the exact blocker and the bounded recovery command path.

For Implementer, Operator, Explorer, and other specialist subagent dispatches, prefer
native subagent spawning. Use clipboard payloads only for successor-Foreman
handoffs or explicitly legacy terminal/AFK transport.

## Terms

- **Transfer:** umbrella term for moving actionable context across sessions.
- **Dispatch:** the short instruction that starts a target actor, usually a
  native subagent.
- **Work card:** durable Markdown task contract for a Implementer/correction/relay
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

- recipient session or actor;
- transfer kind;
- single goal for the next round;
- source artifact path or issue/PR/commit that owns the work;
- required start ref when it is not `origin/main`;
- branch/output expectations;
- stop conditions: done, failed, stalled, or manual-intervention;
- evidence the recipient should produce.

Bad assumption checks:

- A clean `git status` means no local dirty files; it does not mean the branch
  is the right base.
- Router "changed files" counts often mean branch diff against a base, not a
  dirty checkout.
- A work card or report that exists only on a feature branch requires
  `branch_from` or `required_start_ref`; do not let Implementer reset to `origin/main`
  and lose the instructions.
- A `implementer/*` branch can be either an output branch or a work surface. Say which.
- Do not rely on inherited chat memory for branch/base facts. Put them in the
  artifact.

## Placement Matrix

Use path and storage as part of the contract:

| Transfer kind | Durable Markdown home | Clipboard/chat payload |
| --- | --- | --- |
| Successor handoff | Temporary `mktemp -t foreman-handoff-XXXXXX.md` file only, unless the user requests chat-only. Do not commit it. | Full compact handoff via `.docks/foreman/scripts/handoff --target-dock foreman` when another session should start from it. |
| Implementer round | `docs/design/work-cards/<card>.md` for non-trivial implementation or validation contracts. | Select `implementer` with structured `agent_type=implementer` when available. If structured `agent_type` is unavailable, stop with a subagent-runtime blocker instead of using prompt-prefix fallback. |
| Operator run | `docs/design/work-cards/operator-<card>.md` for non-trivial or long supervised run contracts. Use direct prompts only for short self-contained checks. | Select `operator` with structured `agent_type=operator` when available. If structured `agent_type` is unavailable, stop with a subagent-runtime blocker instead of using prompt-prefix fallback. |
| Specialist subagent probe | Usually none; use a durable artifact only when the role needs reusable instructions or evidence capture. | Select the specialist role with structured `agent_type=<role>` when available. If structured `agent_type` is unavailable, stop with a subagent-runtime blocker instead of using prompt-prefix fallback. |
| Relay exchange | GitHub-visible issue, PR, branch report, or explicitly named durable artifact. | The minimal pointer needed to start the relay. |
| Manual-intervention packet | Usually chat and clipboard only. Durable docs only when the recovery path becomes reusable SOP. | Exact blocker and bounded recovery command path. |

If a successor-Foreman handoff appears under `docs/design/work-cards/`, treat it
as misplaced session state. Move it to a temp/chat handoff or delete it before
committing unless the human explicitly asks to convert it into a real Implementer work
card with a Implementer round contract.

## Output Discipline

Keep dispatches concise. Detailed instructions may be long, but they should
live in the referenced work card, capture plan, issue, or another durable
artifact. For any dispatch that approaches provider prompt limits, move the
instructions into a file and spawn/copy only `follow the instructions in
<path>`. Put successor-Foreman state in the successor handoff, not in
`docs/design/work-cards/`. Do not use successor handoff content to author
recipient work without first reclassifying it as a Implementer, Operator, relay,
correction, or manual-intervention transfer. When a handoff tool prints a chat-visible
block, include that exact block in the final response, including recipient,
gates, copy notice, and timestamp.
