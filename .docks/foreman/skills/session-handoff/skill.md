---
name: foreman-session-handoff
description: Prepare a compact Foreman successor handoff before compaction, thread switch, or end-of-session transfer, especially for agent-os work involving GitHub issues/PRs, GDI or Operator routing, work cards, branch hygiene, verification evidence, and next-slice ownership.
argument-hint: "What should the next Foreman session focus on?"
---

Write a handoff document for the next Foreman session. Save it to a path from
`mktemp -t handoff-XXXXXX.md`; read the new file before writing to it. If the
user explicitly asks for chat-only output, return the handoff in chat instead.

Optimize for successor efficiency. Use state already known from the predecessor
session. Do not run repo/GitHub/runtime discovery commands just to fill a
template; call tools only when a fact is unknown, stale, externally mutable, or
important enough that uncertainty would change the next action.

If the user passed arguments, treat them as the successor's focus and tailor the
handoff to that focus. Label inherited or side-conversation history as
reference-only unless it is still an active instruction.

Include only what Foreman needs to choose and execute the next reversible step:

- Active focus, hard boundaries, and current owner: Foreman, GDI, Operator, or
  human.
- Workstream state: accepted slices, pending correction/review, human-only
  blockers, and the single best next action.
- Git/GitHub hygiene: current branch/base/head if known, dirty or untracked
  state if relevant, issue/PR state, branch cleanup, and paths not to touch.
- Verification/runtime evidence already gathered: commands and results, live
  smoke artifacts, `./aos ready` state, TCC/input blockers, and exact remaining
  checks.
- Durable references by path/URL/issue/PR/commit/branch: work cards, design
  notes, recipes, issues, PRs, commits, diffs, logs, screenshots, or artifacts.
- Ephemeral state only when it cannot be rediscovered.
- Suggested skills for the next session, if any; otherwise `Suggested skills:
  none`.

Do not duplicate content already captured in work cards, PRDs, ADRs, issues,
PRs, commits, diffs, or test artifacts. Reference those artifacts instead.

Keep it compact and operational. Prefer bullets with exact paths, issue numbers,
branches, SHAs, and commands. Do not call it a retirement handoff. Do not add
GDI/Operator command ceremony unless the user explicitly asked for a cross-dock
task handoff.
