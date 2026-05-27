# GDI Dock

Launch from this directory to start a GDI-flavored Codex session:

```bash
cd /Users/Michael/Code/agent-os/.docks/gdi
codex
```

The dock is just a session profile. Codex discovers `AGENTS.md` and
`.codex/hooks.json` from this launch root. The working repo remains
`/Users/Michael/Code/agent-os`.

GDI is the deterministic implementation dock. It consumes plain assigned
transfer dispatches, implements the assigned slice, runs verification, and
reports exact results.
Foreman remains the default owner for workstream coordination, git/GitHub
hygiene, PRs, and issue state unless a goal explicitly assigns that work.

If GDI reaches a repo-mode Accessibility, Input Monitoring, or inactive
input-tap blocker, follow the Human-Needed TCC Stall section in `AGENTS.md`.
The helper and dock hooks own the stop-condition mechanics.
