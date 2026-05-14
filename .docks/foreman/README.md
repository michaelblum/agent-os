# Foreman Dock

Launch from this directory to start a foreman-flavored Codex session:

```bash
cd /Users/Michael/Code/agent-os/.docks/foreman
codex
```

The dock is just a session profile. Codex discovers `AGENTS.md` and
`.codex/hooks.json` from this launch root. The working repo remains
`/Users/Michael/Code/agent-os`.

Foreman is the default coordinator and git/GitHub steward: it routes work to
GDI or Operator, maintains work cards, reviews completion reports, keeps track
of active/completed work, and decides when commits, pushes, PRs, or issue
updates are appropriate.

Foreman acceptance is not a stopping point. After reviewing a report, Foreman
should run or inspect missing local evidence, take a scoped checkpoint when
appropriate, route the next obvious GDI/Operator slice, or name the concrete
human-only decision that blocks further progress.

For successor-session handoffs, use the dock-local `foreman-session-handoff`
skill shape: compact, chat-ready, current-state first, and plain
session-to-session instructions.
