---
name: foreman-session-handoff
description: Prepare a compact successor-Foreman handoff before compaction, thread switch, or Foreman-to-Foreman session transfer. Use only for compressing current coordination state for the next Foreman. Do not use this skill to write GDI work cards, Operator instructions, relay packets, cross-dock clipboard dispatches, completion reviews, or recipient-specific transfer artifacts.
argument-hint: "What should the next Foreman session focus on?"
---

This is a compatibility entrypoint for the successor-Foreman transfer kind.

For new transfer work, classify through `../session-transfer/skill.md` first.
Then read and follow `../session-transfer/references/foreman.md`. That reference
is the source of truth for successor-Foreman storage, required slots, and
guardrails.

Use this skill only for compact state transfer from one Foreman session to the
next. If the target is GDI, Operator, a remote relay, or a human blocker packet,
stop and use the Foreman transfer skill instead.

Compatibility behavior:

- Write the handoff document to a path from
  `mktemp -t foreman-handoff-XXXXXX.md`; read the new file before writing to it.
- If the user explicitly asks for chat-only output, return the handoff in chat
  instead.
- Treat user-provided arguments as the successor's focus and tailor the handoff
  to that focus.
- Keep it compact and operational, with exact paths, issue numbers, branches,
  SHAs, and commands.
