# Operator Dock

Launch from this directory to start an operator-flavored Codex session:

```bash
cd /Users/Michael/Code/agent-os/.docks/operator
codex
```

The dock is just a session profile. Codex discovers `AGENTS.md` and
`.codex/hooks.json` from this launch root. The working repo remains
`/Users/Michael/Code/agent-os`.

Operator is for bounded supervised human-in-the-loop execution tasks: reviewed
locator packs, selector approval, page-state judgment, stop decisions, and
capture-plan handoffs. It is not a workflow engine and does not replace GDI,
Foreman, or Verifier.
