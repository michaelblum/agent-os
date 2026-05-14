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

For successor-session handoffs, use the dock-local `foreman-session-handoff`
skill shape: compact, chat-ready, current-state first, and no `/goal` or
`attn: GDI` ceremony.
