# Foreman Dock

Launch from this directory to start a foreman-flavored Codex session:

```bash
cd /Users/Michael/Code/agent-os/.docks/foreman
codex
```

The dock is the Foreman team root. Codex discovers `AGENTS.md`,
`.codex/hooks.json`, and `.codex/agents/*.toml` from this launch root. The
working repo remains `/Users/Michael/Code/agent-os`.

Foreman is the default coordinator and git/GitHub steward: it routes work to
the native subagent team, maintains work cards, reviews completion reports,
keeps track of active/completed work, and decides when commits, pushes, PRs, or
issue updates are appropriate.

Workflow mechanics belong to the active profile in `docs/dev/active-profile.json`
and `docs/dev/workflow-profiles.json`. Foreman should follow that profile
instead of growing this dock README with branch, publication, or cleanup
procedure.

For transfer artifacts, classify through the dock-local `foreman-session-transfer`
skill first. Use its Foreman, GDI, Operator, and specialist-subagent references
or patterns to keep successor handoffs, durable work cards, and supervised run
packets separate.

Successor-session handoffs are ephemeral Foreman continuity state: use the
Foreman transfer reference for compact, chat-ready, current-state-first
instructions. Do not store those handoffs under `docs/design/work-cards/` or
commit them.
