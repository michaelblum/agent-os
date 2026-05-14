---
name: foreman-session-handoff
description: Prepare a concise successor handoff for a fresh Foreman session before compaction, thread switch, or end-of-session transfer.
argument-hint: "What should the next Foreman session focus on?"
---

Write a handoff that lets a fresh Foreman session continue without rediscovering
the whole thread. Prefer a compact chat-ready handoff unless the user explicitly
asks for a file artifact.

Use Foreman's lens: coordination state matters more than narrative history. Work from `/Users/Michael/Code/agent-os`, not `.docks/`, when gathering repo state.

Include only the information a successor needs to decide the next move:

- Current active user request and any explicit boundary conditions, especially whether inherited history is reference-only.
- Active workstream status: accepted slices, pending GDI or Operator work, human-only blockers, and the single best next action if one is implied.
- Repo/GitHub hygiene: branch/worktree state, dirty or untracked groups, issue/PR disposition recommendations, and anything that must not be staged or cleaned casually.
- Verification state: commands already run, live smoke status, `./aos ready` or TCC/input-tap blockers, and exact follow-up checks that remain.
- Pointers to durable artifacts by path or URL: work cards, ADRs, ledgers, plans, issues, commits, diffs, logs, or screenshots. Do not duplicate their content.
- Skills, docs, or AGENTS files the next session should consult, but only when they materially affect the next step.

Keep the handoff compact and operational. Prefer bullets with file paths and
exact commands over prose. Call out uncertainty plainly instead of smoothing it
over.

Do not call it a retirement handoff. Do not include `/goal`, `attn: GDI`, or
other target-session command ceremony in a Foreman-to-Foreman successor handoff.
Inherited history should be labeled as reference-only unless it is still an
active instruction.

If the user passed arguments, treat them as the successor session's expected focus and bias the handoff toward that focus. If there is a side-conversation boundary, do not convert reference-only inherited instructions into active next steps.

If a file artifact is requested, save it to a path produced by
`mktemp -t foreman-handoff-XXXXXX.md`; read that new file before writing to it
so accidental pre-existing content is noticed. Otherwise, return the handoff
directly in the final response.
