# Docked Session Contract

Docks are repo-local session roots for durable agent roles. They are portable
role/profile boundaries, not workflows, task types, skills, or entry paths.

Work in `/Users/Michael/Code/agent-os` unless the task explicitly changes dock
configuration, hooks, skills, or local instructions under `.docks/`.

## Roles And Entry Paths

Keep the axes separate:

- A dock defines who the agent is for the session: authority, handoff contract,
  stop conditions, lifecycle hooks, and default responsibility.
- An entry path defines the active capability layer for the current task:
  Agent harness, AOS developer, testing, visual diagnostics, user-input
  diagnostics, or a narrower app-specific layer.
- `./aos dev` is the control surface for the AOS developer entry path. It is not
  a dock identity.

State the active entry path when it changes what the session will read, modify,
test, or skip. A role can enter or leave capability layers during a session
without becoming a different dock.

## AOS As Agent Shell

Docked sessions should treat AOS as the agent shell. Prefer typed `./aos`
control surfaces over raw provider-native shell access when a surface exists.
Raw host shell, Node, npm, Python, and arbitrary process execution belong to the
AOS developer or testing entry paths; they are not ambient capabilities of every
docked role.

Provider appendages are not competing shells. Gateway, Slack, future chat
providers, and MCP adapters should be treated as external ingress or workflow
surfaces around AOS. For agent, human, session, and channel communication, use
daemon-native `./aos tell`, `./aos listen`, and the session service behind
`./aos tell --register` and `./aos tell --who`.

When raw process execution is necessary, keep it tied to the active task: use
the repo root or the narrowest relevant cwd, avoid open-ended scripts, preserve
reviewable side effects, and let command failures surface instead of papering
over them with repeated retries.

## Dock Creation Rule

Do not create a new dock for a recurring task, skill, checklist, workflow,
tool preference, or entry path. Create a dock only when the role needs a durable
authority boundary, distinct handoff contract, separate runtime/session policy,
or different human-supervision posture.

Keep common dock behavior here. Keep role-specific authority and stop
conditions in each dock's own `AGENTS.md`. Treat `dock.json` as the
machine-readable profile seed and `AGENTS.md` as the human/model operating
contract.

Use `./aos dev docks explain <dock> --json` or
`./aos dev docks capabilities <dock> --json` when the active session needs
machine-readable role, entry-path, or capability-envelope context. These
commands are discovery surfaces only; they do not execute capabilities or
change permissions.

## GitHub Control Surface

Use `./aos dev gh` for GitHub operations when GitHub work is in scope. It shells
out to the authenticated local `gh` CLI and should be preferred over
connector-backed GitHub app or plugin routes in this repo.

Keep GitHub operations thin and intentional:

- use `./aos dev gh context --json` once when local branch, repo, auth, or PR
  context is unclear;
- use body files for issue and PR comments instead of inline shell strings;
- use `./aos dev gh ci inspect --pr <n> --json` when a PR check fails and you
  need failed GitHub Actions logs;
- use `./aos dev gh review-comments --pr <n> --json` when review-thread
  resolution state matters.

Do not turn GitHub work into repeated preflight loops. Let `gh` errors surface,
then handle them with normal software-development judgment. Use external
connector tools only when the user explicitly asks for them or when `gh` cannot
represent the needed operation.

Foreman is the default git/GitHub steward. GDI and Operator should perform
GitHub operations only when the assigned goal or handoff explicitly includes
that work.

## Cross-Session Handoffs

For cross-session handoffs, pipe the raw target message through
`scripts/dock-handoff-clipboard --target-dock <dock>` from the repo root and use
the script output as the final chat reply. The chat reply must include the
handoff between `----- BEGIN HANDOFF -----` and `----- END HANDOFF -----`
markers so the human can recover it from chat if the clipboard is lost.
Handoffs are plain instructions for every target dock; do not prepend command
prefixes or addressee ceremony.
