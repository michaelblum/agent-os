# Foreman Dock

Launch from this directory to start a foreman-flavored Codex session:

```bash
cd /Users/Michael/Code/agent-os/.docks/foreman
codex
```

The dock is the Foreman team root. Codex discovers `AGENTS.md`,
`.codex/hooks.json`, and hook scripts from this launch root. The native
subagent roster lives in repo-root `.codex/agents/`; this Foreman launch
`.codex/config.toml` registers those same root agent files for dock-launched
sessions. The working repo remains `/Users/Michael/Code/agent-os`.

Foreman is the default coordinator and git/GitHub steward: it routes work to
the native subagent team, maintains work cards, reviews completion reports,
keeps track of active/completed work, and decides when commits, pushes, PRs, or
issue updates are appropriate.

Generic helpers are not a role. Before broad native subagent fan-out, translate
helper/scanner/second-pass requests to a registered role, use
`./aos dev subagent plan` to produce the role-selection contract, and use
`./aos dev subagent validate-proof` to fail closed on missing role selection,
`default` role, voice-label, or Foreman model/effort inheritance evidence. Use
`agent_type=<role>` when the live spawn tool exposes it; otherwise start with
`Use the custom agent named <role>.` A blocked generic spawn followed by a
correct retry is still a routing mistake to fix.

Workflow mechanics belong to the active profile in `docs/dev/active-profile.json`
and `docs/dev/workflow-profiles.json`. Foreman should follow that profile
instead of growing this dock README with branch, publication, or cleanup
procedure.

For transfer artifacts, classify through the Foreman-local `Foreman transfer guidance`
skill first. Use its Foreman, Implementer, Operator, and specialist-subagent references
or patterns to keep successor handoffs, durable work cards, and supervised run
packets separate.

Successor-session handoffs are ephemeral Foreman continuity state: use the
Foreman transfer reference for compact, chat-ready, current-state-first
instructions. Do not store those handoffs under `docs/design/work-cards/` or
commit them.
